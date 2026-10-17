#!/usr/bin/env python3
"""เทสต์ส่วนแท่งเงิน (SILVER_THB_KG) ใน update_prices.py — รันด้วย: python scripts/test_silver.py"""
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import update_prices as u  # noqa: E402

passed = failed = 0


def eq(actual, expected, msg):
    global passed, failed
    if actual == expected:
        passed += 1
    else:
        failed += 1
        print(f"FAIL: {msg}\n  ได้    {actual!r}\n  ต้องการ {expected!r}")


def raises(fn, msg):
    global passed, failed
    try:
        fn()
    except ValueError:
        passed += 1
        return
    failed += 1
    print(f"FAIL: {msg} (ไม่ raise ValueError)")


# โครงเดียวกับหน้า bowinsgroup.com/th/silver-price (ตัดมาเฉพาะส่วนที่ parser ใช้)
PAGE = (
    '<div>ขายออก<!-- --> (SELL)</div><div>ราคาเปลี่ยนแปลง</div><div>แท่งเงิน 1 kg.</div>'
    '<span>61,500</span><span>63,000</span><span>*รวมภาษี VAT 7%:</span><span>67,410.00</span>'
    '<script>self.__next_f.push([1,"{\\"initialPrice\\":{\\"id\\":\\"19735\\",\\"created\\":\\"2026-10-16 17:14:06\\",'
    '\\"sell\\":\\"63000.0000\\",\\"buy\\":\\"61500.0000\\",\\"status\\":\\"1\\"}}"])</script>'
)

# ---- parse_bowins ----
eq(u.parse_bowins(PAGE), {"t": "2026-10-16T17:14:06+07:00", "sell": 63000.0, "buy": 61500.0}, "อ่านราคาขายออก ไม่รวม VAT")
raises(lambda: u.parse_bowins(PAGE.replace("initialPrice", "price")), "ไม่มี initialPrice -> error")
raises(lambda: u.parse_bowins(PAGE.replace("(SELL)", "")), "ไม่มีหัวตาราง ขายออก -> error")
raises(lambda: u.parse_bowins(PAGE.replace("<span>63,000</span>", "<span>64,000</span>")), "ตารางไม่ตรงกับ initialPrice -> error")
raises(lambda: u.parse_bowins(PAGE.replace("67,410.00", "63,000.00")), "ราคารวม VAT ไม่ใช่ sell×1.07 -> error")

# ---- history ----
h = {"points": []}
eq(u.append_silver_point(h, {"t": "2026-10-16T17:14:06+07:00", "sell": 63000.0}), True, "จุดใหม่ถูกเพิ่ม")
eq(u.append_silver_point(h, {"t": "2026-10-16T17:14:06+07:00", "sell": 63000.0}), False, "เวลาประกาศซ้ำ ไม่เพิ่มซ้ำ")
eq(len(h["points"]), 1, "history มี 1 จุด")


def pts(n_weeks):
    """จุดข้อมูลวันละ 2 รอบ (จ.-ศ.) ครอบคลุม n_weeks สัปดาห์"""
    out, d = [], dt.datetime(2026, 10, 12, 7, 10)
    while len({(x.isocalendar()[0], x.isocalendar()[1]) for x in [dt.datetime.fromisoformat(p["t"][:19]) for p in out]}) < n_weeks or not out:
        if d.weekday() < 5:
            for hh in (7, 18):
                t = d.replace(hour=hh)
                out.append({"t": t.strftime("%Y-%m-%dT%H:%M:%S+07:00"), "sell": 63000.0 + 400 * ((len(out) % 7) - 3)})
        d += dt.timedelta(days=1)
    return out


# ---- silver_levels: สลับโหมดเองตามจำนวน weekly bars ----
lv = u.silver_levels([{"t": "2026-10-16T17:14:06+07:00", "sell": 63000.0}])
eq((lv["mode"], lv["sl"], lv["tp1"], lv["tp2"]), ("provisional", 59220.0, 68670.0, 74340.0), "1 จุด -> provisional 6%")
eq(u.silver_levels(pts(11))["mode"], "provisional", "11 สัปดาห์ -> ยัง provisional")
lv12 = u.silver_levels(pts(12))
eq((lv12["mode"], lv12["weeks"]), ("atr", 12), "ครบ 12 สัปดาห์ -> เปลี่ยนเป็น ATR12 รายสัปดาห์")
eq(abs(lv12["risk"] - 1.5 * lv12["atr"]) < 0.02, True, "โหมด ATR: risk = 1.5×ATR12")
eq(lv12["tp2"], u.rnd(lv12["entry"] + 3 * (lv12["entry"] - lv12["sl"])), "โหมด ATR: tp2 = entry + 3×risk")
eq(u.silver_levels([]), None, "ไม่มีข้อมูล -> None")
eq("ชั่วคราว" in u.silver_analysis_entry(lv, "2026-10-17")["note"], True, "note โหมด provisional บอกว่าเป็นค่าชั่วคราว")
eq("ATR12" in u.silver_analysis_entry(lv12, "2026-10-17")["note"], True, "note โหมด ATR ระบุ ATR12")

# ---- collect_tickers ไม่ส่ง key พิเศษให้ yfinance ----
eq(u.collect_tickers({"groups": [], "daily": [{"t": "IVV"}, {"t": u.SILVER_KEY}]}), ["IVV"], "SILVER_THB_KG ไม่อยู่ในรายการ yfinance")

print(f"\n{passed} ผ่าน, {failed} ไม่ผ่าน")
sys.exit(1 if failed else 0)
