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
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
WATCHLIST = ROOT / "watchlist.json"
PRICES_OUT = ROOT / "data" / "prices.json"
SERIES_OUT = ROOT / "data" / "series.json"
ANALYSIS_OUT = ROOT / "data" / "analysis.json"

SILVER_HISTORY = ROOT / "data" / "silver_thb_history.json"

MAX_FAIL_RATIO = 0.4          # ถ้าดึงพลาดเกินนี้ จะไม่เขียนทับไฟล์เดิม
SPARK_DAYS = 30
SERIES_DAYS = 300             # จำนวนวันทำการล่าสุดที่เก็บลง series.json (ราคา + MA)

# ---------- แท่งเงิน 1 กก. (Bowins) — ไม่ใช่ yfinance ticker ----------
SILVER_KEY = "SILVER_THB_KG"
SILVER_URL = "https://bowinsgroup.com/th/silver-price"
SILVER_MIN_WEEKS = 12         # weekly bars ขั้นต่ำก่อนเลิกใช้ % ชั่วคราว แล้วเปลี่ยนเป็น ATR12 รายสัปดาห์
SILVER_ATR_N = 12
SILVER_PROVISIONAL_RISK = 0.06  # risk ชั่วคราว = 6% ของราคาล่าสุด (ความผันผวนเงิน + premium ร้านค้าปลีก)
SPECIAL_KEYS = {SILVER_KEY}   # key ที่ไม่ส่งให้ yfinance


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
    return sorted(tickers - SPECIAL_KEYS)


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


def macd(close, fast=12, slow=26, signal=9):
    """MACD(12,26,9) มาตรฐาน — คืน (macd_line, signal_line, hist) เป็น Series"""
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    return macd_line, signal_line, macd_line - signal_line


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
    if len(c) >= 35:  # 26 (slow EMA) + 9 (signal) ให้ค่าเริ่มนิ่งพอสมควร
        macd_line, signal_line, hist = macd(c)
        rec["macd"] = rnd(macd_line.iloc[-1], 4)
        rec["macdSignal"] = rnd(signal_line.iloc[-1], 4)
        rec["macdHist"] = rnd(hist.iloc[-1], 4)
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


# ---------- แท่งเงิน 1 กก. (Bowins Silver, บาท) ----------
# Bowins ไม่มี API/ราคาย้อนหลังให้ จึงเก็บราคาเองทุกรอบที่ workflow รัน (data/silver_thb_history.json)
# แล้วค่อยๆ สะสมเป็น time series — ใช้ราคา "ขายออก" ไม่รวม VAT (ราคาที่ลูกค้าซื้อจากร้าน)
def parse_bowins(html):
    """ดึง {created, sell, buy} จาก initialPrice ที่ฝังในหน้า แล้วเทียบกับตารางที่แสดงจริง
    โครงสร้างเปลี่ยน/ตัวเลขไม่ตรงกัน -> ValueError (ห้ามเดาราคา)"""
    m = re.search(r'\\?"initialPrice\\?"\s*:\s*(\{[^{}]*\})', html)
    if not m:
        raise ValueError("ไม่พบ initialPrice ในหน้า — โครงสร้าง HTML อาจเปลี่ยน")
    p = json.loads(m.group(1).replace('\\"', '"'))
    try:
        sell, buy = float(p["sell"]), float(p["buy"])
        created = dt.datetime.strptime(p["created"], "%Y-%m-%d %H:%M:%S")
    except (KeyError, TypeError, ValueError) as e:
        raise ValueError(f"initialPrice ไม่มีฟิลด์ที่ต้องการ: {e}") from e
    if not (5_000 < sell < 1_000_000 and 0 < buy <= sell):
        raise ValueError(f"ราคาผิดปกติ sell={sell} buy={buy}")
    # ยืนยันกับตารางที่ลูกค้าเห็น: แถวแรกหลังหัวตาราง "ขายออก (SELL)" = รับซื้อ, ขายออก, ราคารวม VAT 7%
    i = html.find("(SELL)")
    if i < 0:
        raise ValueError("ไม่พบหัวตาราง ขายออก (SELL) — โครงสร้าง HTML อาจเปลี่ยน")
    text = re.sub(r"<[^>]+>", " ", html[i:i + 8000])
    nums = [float(x.replace(",", "")) for x in re.findall(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?", text)[:3]]
    if len(nums) < 3 or nums[0] != buy or nums[1] != sell or abs(nums[2] - sell * 1.07) > 0.01:
        raise ValueError(f"ตารางที่แสดง {nums} ไม่ตรงกับ initialPrice sell={sell} buy={buy}")
    return {"t": created.strftime("%Y-%m-%dT%H:%M:%S+07:00"), "sell": rnd(sell), "buy": rnd(buy)}


def fetch_silver():
    import urllib.request

    req = urllib.request.Request(SILVER_URL, headers={"User-Agent": "Mozilla/5.0 (market-watch price-bot)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return parse_bowins(r.read().decode("utf-8", errors="replace"))


def load_silver_history():
    if SILVER_HISTORY.exists():
        return json.loads(SILVER_HISTORY.read_text(encoding="utf-8"))
    return {"key": SILVER_KEY, "source": SILVER_URL, "unit": "THB/kg ขายออก ไม่รวม VAT", "points": []}


def append_silver_point(hist, pt):
    """เพิ่มจุดใหม่ถ้าเวลาประกาศของร้าน (t) ยังไม่เคยบันทึก — คืน True ถ้ามีการเพิ่ม"""
    if any(p["t"] == pt["t"] for p in hist["points"]):
        return False
    hist["points"].append(pt)
    hist["points"].sort(key=lambda p: p["t"])
    return True


def silver_weekly_bars(points):
    """รีแซมเปิลเป็นแท่งรายสัปดาห์ (W-FRI): High/Low = สูง/ต่ำสุดที่บันทึกได้ในสัปดาห์, Close = จุดสุดท้าย"""
    if not points:
        return pd.DataFrame(columns=["High", "Low", "Close"])
    s = pd.Series([p["sell"] for p in points], index=pd.to_datetime([p["t"][:19] for p in points]))
    w = s.resample("W-FRI").agg(["max", "min", "last"]).dropna()
    return w.rename(columns={"max": "High", "min": "Low", "last": "Close"})


def silver_levels(points):
    """SL/TP ระยะยาวของแท่งเงิน — สลับโหมดเองตามจำนวนข้อมูล:
    weekly bars < 12 -> provisional (risk = 6% ของราคา) · ครบแล้ว -> risk = 1.5×ATR12 รายสัปดาห์
    sl = entry − risk, tp1 = entry + 1.5×risk, tp2 = entry + 3×risk"""
    if not points:
        return None
    last = points[-1]
    entry = last["sell"]
    weeks = silver_weekly_bars(points)
    atr = None
    if len(weeks) >= SILVER_MIN_WEEKS:
        atr = float(atr_wilder(weeks, SILVER_ATR_N).iloc[-1])
        mode, risk = "atr", 1.5 * atr
    else:
        mode, risk = "provisional", SILVER_PROVISIONAL_RISK * entry
    return {
        "mode": mode, "weeks": len(weeks), "entry": rnd(entry), "risk": rnd(risk), "atr": rnd(atr),
        "sl": rnd(entry - risk), "tp1": rnd(entry + 1.5 * risk), "tp2": rnd(entry + 3 * risk), "t": last["t"],
    }


def silver_analysis_entry(lv, asof):
    when = lv["t"][:16].replace("T", " ")
    head = f"ถือสะสมระยะยาว — entry = ราคาขายออกล่าสุด ไม่รวม VAT ({lv['entry']:,.0f} บาท, ณ {when})"
    if lv["mode"] == "atr":
        body = f"SL = entry − 1.5×ATR12 รายสัปดาห์ (~{lv['atr']:,.2f}) TP1/TP2 ตามอัตราส่วน R:R 1:1.5 และ 1:3 (ข้อมูล {lv['weeks']} สัปดาห์)"
    else:
        body = (f"risk = 6% ของราคา (~{lv['risk']:,.2f}) TP1/TP2 ตามอัตราส่วน R:R 1:1.5 และ 1:3 · "
                f"SL/TP เป็นค่าประมาณชั่วคราว รอสะสมข้อมูลราคาให้ครบ ~12 สัปดาห์ก่อนเปลี่ยนไปใช้ ATR จริง (ตอนนี้มี {lv['weeks']} สัปดาห์)")
    return {"bias": "long", "entry": lv["entry"], "sl": lv["sl"], "tp1": lv["tp1"], "tp2": lv["tp2"],
            "note": f"{head} {body}", "asof": asof}


def silver_symbol(points):
    """record ใน prices.json จาก history (ไม่มี RSI/ADX/MA เพราะไม่มีแท่งราคารายวันแบบ OHLC)"""
    if not points:
        return None
    sells = [p["sell"] for p in points]
    lv = silver_levels(points)
    return {
        "last": sells[-1],
        "chg": rnd((sells[-1] / sells[-2] - 1) * 100) if len(sells) > 1 else None,
        "asof": points[-1]["t"][:10],
        "updatedAt": points[-1]["t"],
        "spark": sells[-SPARK_DAYS:],
        "atr": None,
        "unit": "THB",
        "weeks": lv["weeks"],
        "levelMode": lv["mode"],
    }


def write_analysis(a):
    out = json.dumps(a, ensure_ascii=False, indent=2)
    # คงรูปแบบ pivot บรรทัดเดียวแบบที่ไฟล์ใช้อยู่
    out = re.sub(r'\{\n\s+"n": (\d+),\n\s+"date": ("[^"]+"),\n\s+"price": ([\d.]+)\n\s+\}', r'{ "n": \1, "date": \2, "price": \3 }', out)
    ANALYSIS_OUT.write_text(out, encoding="utf-8")


def update_silver_analysis():
    """เขียน daily.SILVER_THB_KG ใน analysis.json จาก history (รันตอนทบทวนรายสัปดาห์ — โหมดสลับเอง)"""
    lv = silver_levels(load_silver_history()["points"])
    if not lv:
        print(f"ยังไม่มีข้อมูลใน {SILVER_HISTORY.name} — ไม่แก้ analysis.json", file=sys.stderr)
        sys.exit(1)
    a = json.loads(ANALYSIS_OUT.read_text(encoding="utf-8"))
    a.setdefault("daily", {})[SILVER_KEY] = silver_analysis_entry(lv, dt.date.today().isoformat())
    write_analysis(a)
    print(f"{SILVER_KEY}: โหมด {lv['mode']} ({lv['weeks']} สัปดาห์) entry {lv['entry']} sl {lv['sl']} tp1 {lv['tp1']} tp2 {lv['tp2']}")


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
    ap.add_argument("--silver-analysis", action="store_true",
                    help=f"เขียน daily.{SILVER_KEY} ใน analysis.json จาก history (ไม่ดึงราคา) — ใช้ตอนทบทวนรายสัปดาห์")
    args = ap.parse_args()
    if args.silver_analysis:
        update_silver_analysis()
        return

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

    # แท่งเงิน: scrape ไม่ได้ -> เก็บ history เดิมไว้, แสดงราคาล่าสุดที่มี และขึ้นแบนเนอร์ "ดึงราคาไม่ได้"
    if not args.demo and SILVER_KEY in {i["t"] for i in wl.get("daily", []) + wl.get("accumulate", [])}:
        hist = load_silver_history()
        try:
            pt = fetch_silver()
            pt["fetched"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            if append_silver_point(hist, pt):
                SILVER_HISTORY.write_text(json.dumps(hist, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"{SILVER_KEY}: ขายออก {pt['sell']} (ประกาศ {pt['t']}), history {len(hist['points'])} จุด")
        except Exception as e:  # noqa: BLE001 — เว็บร้านล่ม/เปลี่ยนหน้า ต้องไม่ทำให้ราคาตัวอื่นไม่อัปเดต
            print(f"{SILVER_KEY}: ดึงราคาไม่ได้ — {e}", file=sys.stderr)
            failed.append(SILVER_KEY)
        rec = silver_symbol(hist["points"])
        if rec:
            symbols[SILVER_KEY] = rec

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
