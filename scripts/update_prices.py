#!/usr/bin/env python3
"""
อัปเดต data/prices.json และ data/series.json (ราคา, ผลตอบแทน, RSI, ADX, MA, RRG) — ไม่ใช้ AI
รันโดย GitHub Actions เช้า/เย็น  |  ทดสอบในเครื่อง:  python scripts/update_prices.py --demo

สำคัญ: สคริปต์นี้ไม่แตะ data/analysis.json (ไฟล์นั้น Claude เขียนตอนวิเคราะห์บน desktop)
ยกเว้นโหมด --demo ที่สร้างข้อมูลตัวอย่างไว้ดู UI

การจัดสถานะ (แข็งแรง/ระวัง/ไซด์เวย์/อ่อนแอ) และ Risk-On/Off คำนวณฝั่งแอป (rules.js)
จากตัวเลขดิบที่ไฟล์นี้ผลิต ไม่ใช่ที่นี่ — ให้มีจุดเดียวที่กำหนดกฎ
"""
import argparse
import datetime as dt
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
WATCHLIST = ROOT / "watchlist.json"
PRICES_OUT = ROOT / "data" / "prices.json"
SERIES_OUT = ROOT / "data" / "series.json"
ANALYSIS_OUT = ROOT / "data" / "analysis.json"

MAX_FAIL_RATIO = 0.4          # ถ้าดึงพลาดเกินนี้ จะไม่เขียนทับไฟล์เดิม
SPARK_DAYS = 30
SERIES_DAYS = 300             # จำนวนวันทำการล่าสุดที่เก็บลง series.json (ราคา + MA)


# ---------- helpers ----------
def rnd(x, n=2):
    if x is None or (isinstance(x, float) and (np.isnan(x) or np.isinf(x))):
        return None
    return round(float(x), n)


def collect_tickers(wl):
    tickers = set()
    for g in wl["groups"]:
        if g.get("benchmark"):
            tickers.add(g["benchmark"])
        tickers.update(i["t"] for i in g["items"])
    tickers.update(i["t"] for i in wl.get("daily", []))
    tickers.update(i["t"] for i in wl.get("accumulate", []))
    return sorted(tickers)


def rsi_wilder(close, n=14):
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = up / dn.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def true_range(df):
    pc = df["Close"].shift(1)
    return pd.concat(
        [df["High"] - df["Low"], (df["High"] - pc).abs(), (df["Low"] - pc).abs()], axis=1
    ).max(axis=1)


def atr_wilder(df, n=14):
    return true_range(df).ewm(alpha=1 / n, adjust=False).mean()


def adx_wilder(df, n=14):
    """Wilder's ADX(14) — คืน (plusDI, minusDI, adx) เป็น Series"""
    up = df["High"].diff()
    dn = -df["Low"].diff()
    plus_dm = np.where((up > dn) & (up > 0), up, 0.0)
    minus_dm = np.where((dn > up) & (dn > 0), dn, 0.0)
    tr = true_range(df).ewm(alpha=1 / n, adjust=False).mean()
    plus_di = 100 * pd.Series(plus_dm, index=df.index).ewm(alpha=1 / n, adjust=False).mean() / tr
    minus_di = 100 * pd.Series(minus_dm, index=df.index).ewm(alpha=1 / n, adjust=False).mean() / tr
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    adx = dx.ewm(alpha=1 / n, adjust=False).mean()
    return plus_di, minus_di, adx


# ---------- RRG (ประมาณแบบ JdK ด้วย z-score — ไม่ใช่สูตรต้นฉบับ) ----------
def rrg_series(sym_close, bench_close, n_smooth=10, z_win=52, mom_win=4):
    """คืน DataFrame คอลัมน์ x (RS-Ratio) และ y (RS-Momentum) รายสัปดาห์"""
    w = pd.concat(
        [sym_close.resample("W-FRI").last(), bench_close.resample("W-FRI").last()], axis=1, join="inner"
    ).dropna()
    if len(w) < z_win + n_smooth + mom_win:
        return None
    rs = w.iloc[:, 0] / w.iloc[:, 1]
    raw = 100 * rs / rs.rolling(n_smooth).mean()
    x = 100 + (raw - raw.rolling(z_win).mean()) / raw.rolling(z_win).std()
    m_raw = 100 * x / x.shift(mom_win)
    y = 100 + (m_raw - m_raw.rolling(z_win).mean()) / m_raw.rolling(z_win).std()
    out = pd.concat([x, y], axis=1, keys=["x", "y"]).dropna()
    return out if len(out) else None


def quadrant(x, y):
    if x >= 100 and y >= 100:
        return "leading"
    if x >= 100:
        return "weakening"
    if y < 100:
        return "lagging"
    return "improving"


# ---------- per-symbol ----------
def build_symbol(df, bench_close=None, want_spark=False, tail=5):
    df = df.dropna(subset=["Close"])
    if len(df) < 60:
        return None
    c = df["Close"]
    last = c.iloc[-1]

    def ret(n):
        return (last / c.iloc[-1 - n] - 1) * 100 if len(c) > n else None

    def ytd():
        this_year = c[c.index >= pd.Timestamp(year=c.index[-1].year, month=1, day=1)]
        return (last / this_year.iloc[0] - 1) * 100 if len(this_year) > 1 else None

    ma50 = c.rolling(50).mean().iloc[-1]
    ma100 = c.rolling(100).mean().iloc[-1] if len(c) >= 100 else np.nan
    ma200 = c.rolling(200).mean().iloc[-1] if len(c) >= 200 else np.nan
    has_hl = {"High", "Low"} <= set(df.columns)
    rec = {
        "last": rnd(last, 4),
        "chg": rnd(ret(1)),
        "r1w": rnd(ret(5)),
        "r1m": rnd(ret(21)),
        "r3m": rnd(ret(63)),
        "r6m": rnd(ret(126)),
        "r1y": rnd(ret(252)),
        "ytd": rnd(ytd()),
        "rsi": rnd(rsi_wilder(c).iloc[-1], 1),
        "vs50": rnd((last / ma50 - 1) * 100),
        "vs100": rnd((last / ma100 - 1) * 100) if not np.isnan(ma100) else None,
        "vs200": rnd((last / ma200 - 1) * 100) if not np.isnan(ma200) else None,
        "atr": rnd(atr_wilder(df).iloc[-1], 4) if has_hl else None,
        "asof": df.index[-1].strftime("%Y-%m-%d"),
    }
    if has_hl:
        _, _, adx = adx_wilder(df)
        rec["adx"] = rnd(adx.iloc[-1], 1)
    if want_spark:
        rec["spark"] = [rnd(v, 4) for v in c.iloc[-SPARK_DAYS:].tolist()]
    if bench_close is not None:
        r = rrg_series(c, bench_close)
        if r is not None:
            pts = [[rnd(a, 3), rnd(b, 3)] for a, b in r.iloc[-tail:].values]
            rec["rrg"] = {"x": pts[-1][0], "y": pts[-1][1], "quad": quadrant(*pts[-1]), "tail": pts}
    return rec


def build_series(df):
    """เก็บราคาปิด + MA50/MA200 ย้อนหลังสำหรับวาดกราฟหน้า Detail"""
    df = df.dropna(subset=["Close"])
    if len(df) < 60:
        return None
    c = df["Close"]
    ma50 = c.rolling(50).mean()
    ma100 = c.rolling(100).mean()
    ma200 = c.rolling(200).mean()
    tail = df.index[-SERIES_DAYS:]
    return {
        "d": [d.strftime("%Y-%m-%d") for d in tail],
        "c": [rnd(v, 4) for v in c.loc[tail].tolist()],
        "m50": [rnd(v, 4) for v in ma50.loc[tail].tolist()],
        "m100": [rnd(v, 4) for v in ma100.loc[tail].tolist()],
        "m200": [rnd(v, 4) for v in ma200.loc[tail].tolist()],
    }


# ---------- data sources ----------
def fetch_real(tickers):
    import yfinance as yf

    raw = yf.download(
        tickers, period="4y", interval="1d", auto_adjust=True,
        group_by="ticker", progress=False, threads=True,
    )
    frames = {}
    top = set(raw.columns.get_level_values(0)) if isinstance(raw.columns, pd.MultiIndex) else set()
    for t in tickers:
        if t in top:
            f = raw[t].dropna(how="all")
            if len(f):
                frames[t] = f
    return frames


def fetch_demo(tickers, seed=7):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=1100)
    market = rng.normal(0.0004, 0.009, len(idx))
    base = {"GC=F": 3800, "SI=F": 45, "HG=F": 5.1, "CL=F": 62, "BTC-USD": 98000, "DX-Y.NYB": 99,
            "SPY": 640, "IVV": 640, "QQQ": 560, "QQQM": 230, "TLT": 92, "IEF": 96}
    frames = {}
    for t in tickers:
        beta = rng.uniform(0.5, 1.4)
        drift = rng.normal(0.0002, 0.0004)
        vol = rng.uniform(0.004, 0.02) * (3 if t == "BTC-USD" else 1)
        r = beta * market + drift + rng.normal(0, vol, len(idx))
        close = base.get(t, rng.uniform(40, 300)) * np.exp(np.cumsum(r))
        span = np.abs(rng.normal(0, vol, len(idx))) * close
        frames[t] = pd.DataFrame(
            {"Close": close, "High": close + span, "Low": close - span}, index=idx
        )
    return frames


# ---------- main ----------
def demo_analysis(wl, symbols):
    daily = {}
    for it in wl.get("daily", []):
        s = symbols.get(it["t"])
        if not s or not s.get("atr"):
            continue
        last, atr = s["last"], s["atr"]
        daily[it["t"]] = {
            "bias": "long",
            "entry": rnd(last, 4),
            "sl": rnd(last - 2 * atr, 4),
            "tp1": rnd(last + 3 * atr, 4),
            "tp2": rnd(last + 5 * atr, 4),
            "note": "ตัวอย่างสำหรับดู UI",
            "asof": dt.date.today().isoformat(),
        }
    sec = {i["t"]: {"view": v, "note": ""} for i, v in zip(wl["groups"][0]["items"][:3], ["overweight", "neutral", "underweight"])}
    waves = {}
    spy = symbols.get("SPY")
    if spy:
        waves["SPY"] = {
            "asof": dt.date.today().isoformat(),
            "current": 3,
            "alt": 5,
            "pivots": [
                {"n": 1, "date": "2024-10-15", "price": rnd(spy["last"] * 0.82, 2)},
                {"n": 2, "date": "2024-12-10", "price": rnd(spy["last"] * 0.78, 2)},
                {"n": 3, "date": "2025-06-01", "price": rnd(spy["last"] * 1.02, 2)},
                {"n": 4, "date": "2025-08-20", "price": rnd(spy["last"] * 0.94, 2)},
                {"n": 5, "date": spy["asof"], "price": rnd(spy["last"], 2)},
            ],
            "keyLevel": {"price": rnd(spy["last"] * 0.86, 0), "note": "หลุด = ทบทวนการนับคลื่น"},
            "note": "ตัวอย่างสำหรับดู UI — ไม่ใช่มุมมองจริง",
        }
    return {
        "demo": True,
        "asof": dt.date.today().isoformat(),
        "weekly": {
            "stance": "neutral",
            "headline": "ข้อมูลตัวอย่าง — ยังไม่ใช่มุมมองจริง",
            "points": ["สั่ง Claude วิเคราะห์บน desktop เพื่อแทนที่ไฟล์นี้"],
            "views": sec,
        },
        "daily": daily,
        "waves": waves,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true", help="สร้างข้อมูลสุ่มไว้ดู UI (ทับ prices.json, series.json และ analysis.json)")
    args = ap.parse_args()

    wl = json.loads(WATCHLIST.read_text(encoding="utf-8"))
    tickers = collect_tickers(wl)

    frames = fetch_demo(tickers) if args.demo else fetch_real(tickers)
    failed = [t for t in tickers if t not in frames]
    if len(failed) > MAX_FAIL_RATIO * len(tickers):
        print(f"ดึงข้อมูลพลาด {len(failed)}/{len(tickers)} — ไม่เขียนทับไฟล์เดิม: {failed}", file=sys.stderr)
        sys.exit(1)

    bench_of = {}
    for g in wl["groups"]:
        if g.get("rrg") and g.get("benchmark"):
            for it in g["items"]:
                bench_of.setdefault(it["t"], set()).add(g["benchmark"])
    daily_set = {i["t"] for i in wl.get("daily", [])}
    accum_set = {i["t"] for i in wl.get("accumulate", [])}

    symbols = {}
    series = {}
    for t, df in frames.items():
        base = build_symbol(df, None, want_spark=(t in daily_set or t in accum_set))
        if base:
            symbols[t] = base
        # RRG เก็บแยกตามกลุ่ม: key เป็น benchmark เพื่อให้ SPY เป็นทั้ง benchmark และสมาชิกกลุ่มประเทศได้
        for b in bench_of.get(t, []):
            if b in frames and b != t:
                rec = build_symbol(df, frames[b]["Close"].dropna())
                if rec and "rrg" in rec:
                    symbols.setdefault(t, {}).setdefault("rrg_by", {})[b] = rec["rrg"]
        s = build_series(df)
        if s:
            series[t] = s

    now = dt.datetime.now(dt.timezone.utc)
    ict = now + dt.timedelta(hours=7)
    out = {
        "updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "session": "morning" if ict.hour < 13 else "evening",
        "demo": bool(args.demo),
        "failed": failed,
        "symbols": symbols,
    }
    PRICES_OUT.parent.mkdir(exist_ok=True)
    PRICES_OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    SERIES_OUT.write_text(json.dumps({"updated": out["updated"], "series": series}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"เขียน {PRICES_OUT.name}: {len(symbols)} ตัว, พลาด {len(failed)} {failed}")
    print(f"เขียน {SERIES_OUT.name}: {len(series)} ตัว")

    if args.demo:
        ANALYSIS_OUT.write_text(json.dumps(demo_analysis(wl, symbols), ensure_ascii=False, indent=2), encoding="utf-8")
        print("เขียน analysis.json (ตัวอย่าง)")


if __name__ == "__main__":
    main()
