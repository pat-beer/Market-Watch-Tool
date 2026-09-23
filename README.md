# Market Structure Watchlist

PWA มือถือ 4 แท็บ: **ภาพรวม** (Risk-On/Off + สรุปรายกลุ่ม) · **รายการ** (sector rotation / ประเทศ / สินทรัพย์ พร้อม RRG) · **รายวัน** (ตัวที่เล่น 5–8 ตัว พร้อม SL/TP1/TP2/R:R) · **สะสม** (สัญญาณซื้อถัวเฉลี่ยระยะยาวตาม MA50/100/200 — กฎล้วนๆ ไม่ใช้ AI)
ราคาและสถานะ (แข็งแรง/ระวัง/ไซด์เวย์/อ่อนแอ) คำนวณจากกฎตายตัวทั้งหมด **ไม่ใช้ AI** ส่วนมุมมองรายสัปดาห์, SL/TP และ Elliott Wave มาจาก Claude ตอนเปิด desktop เท่านั้น
ค่าเริ่มต้นเป็นธีมสว่างเสมอ สลับเป็นธีมมืดได้จากปุ่มมุมขวาบน (ไม่ตามธีมเครื่อง)

## วางขึ้น GitHub (ครั้งเดียว)
1. สร้าง repo → อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ (**รวมโฟลเดอร์ `.github/` ที่ซ่อนอยู่ด้วย**)
2. Settings → Pages → Deploy from branch → `main` / root
3. Settings → Actions → General → Workflow permissions → **Read and write**
4. Actions → update-prices → Run workflow (รันครั้งแรกเพื่อแทนข้อมูลตัวอย่างด้วยราคาจริง)
5. เปิดลิงก์ Pages บนมือถือ → Add to Home Screen

> repo public = ใครก็เห็น ใส่แค่ watchlist/มุมมองทั่วไป ห้ามใส่ข้อมูลลูกค้า/ยอดเงินพอร์ต

## ไฟล์
| ไฟล์ | ใครเขียน | ทำอะไร |
|---|---|---|
| `watchlist.json` | พี่แก้เอง | กลุ่ม (ภาคส่วน/ประเทศ/สินทรัพย์) + หมวด (`cat`) สำหรับคำนวณ Risk-On + ตัวรายวัน + เกณฑ์ Risk-On/Off (`regime`) |
| `data/prices.json` | GitHub Actions | ราคา, ผลตอบแทน (1W–1Y, YTD), RSI, **ADX**, MA, ATR, ตำแหน่ง RRG |
| `data/series.json` | GitHub Actions | ราคาปิด + MA50/MA200 ย้อนหลัง ~300 วัน สำหรับกราฟหน้า Detail |
| `data/analysis.json` | Claude (desktop) | มุมมองรายสัปดาห์, SL/TP รายตัว, **ความเห็น Elliott Wave** |
| `rules.js` | ไฟล์เดียวที่กำหนด "สถานะ" | กฎแดง/เทา/เขียว/เหลือง + Risk-On/Off — ดูเกณฑ์เต็มในแอป (ปุ่ม `?` หน้าภาพรวม) |

Actions แตะเฉพาะ `prices.json`/`series.json` จึงไม่ทับงานวิเคราะห์ของ Claude

## รูปแบบ `data/analysis.json`
```json
{
  "asof": "2026-09-20",
  "weekly": {
    "stance": "risk-on | neutral | risk-off",
    "headline": "ประโยคเดียวสรุปภาพรวม",
    "points": ["ไม่เกิน 3 ข้อ"],
    "views": { "XLK": {"view": "overweight | neutral | underweight", "note": "สั้นๆ"} }
  },
  "daily": {
    "GC=F": {"bias": "long | short", "entry": 3800, "sl": 3720, "tp1": 3950, "tp2": 4100, "note": "สั้นๆ", "asof": "2026-09-20"}
  },
  "waves": {
    "SPY": {
      "asof": "2026-09-20",
      "current": 3,
      "alt": 5,
      "pivots": [{"n": 1, "date": "2024-10-15", "price": 570.2}, "... n สูงสุด 5"],
      "keyLevel": {"price": 640, "note": "หลุด = ทบทวนการนับคลื่น"},
      "note": "สั้นๆ — นี่คือความเห็น ไม่ใช่สัญญาณ"
    }
  }
}
```
คีย์ใน `views`, `daily` และ `waves` ใช้ Yahoo ticker ตาม `watchlist.json` · `waves` ใส่เฉพาะตัวที่ Claude วิเคราะห์ไว้ ตัวอื่นในแอปจะไม่แสดงส่วนนี้ · `tp2` ไม่บังคับ (ใส่เมื่อมีเป้าที่สอง) ถ้าใส่แค่ `tp` เฉยๆ (ไม่มี `tp1`) แอปจะอ่านเป็น TP1 ให้อัตโนมัติ (backward-compatible)

## Prompt สำหรับ Claude Code บน desktop (รันสัปดาห์ละครั้ง / เมื่อต้องปรับ SL-TP หรือนับคลื่น)
```
อ่าน watchlist.json, data/prices.json และ data/series.json แล้วใช้ MCP TradingView ดึง technicals/ข่าวเพิ่ม
วิเคราะห์ภาพรวมรายสัปดาห์ (sector rotation, ประเทศ, ทอง/เงิน/ทองแดง), ระดับ SL/TP ของตัวใน "daily",
และถ้าต้องการ ให้นับ Elliott Wave ของตัวหลัก (ระบุจุด pivot วันที่+ราคา, คลื่นปัจจุบัน, ทางเลือก, จุดเปลี่ยนสำคัญ)
แล้วเขียนทับ data/analysis.json ตามรูปแบบใน README ห้ามแก้ไฟล์อื่น ห้ามใส่ข้อมูลลูกค้า เขียนเป็นภาษาไทยสั้นๆ
เสร็จแล้ว git add data/analysis.json && git commit -m "analysis" && git push
```

## กฎสถานะ (rules.js) — สรุปสั้น เต็มๆ ดูในแอป
ตรวจตามลำดับ: **อ่อนแอ** (ใต้ 200D และ RSI<45) → **ไซด์เวย์** (ADX<20) → **แข็งแรง** (เหนือ 50D/200D, RSI 50–70, ADX≥20) → **ระวัง** (ที่เหลือ)
**Risk-On**: สินทรัพย์เสี่ยง (หุ้น/สินค้าโภคภัณฑ์/คริปโต — ไม่รวมตราสารหนี้/DXY) เหนือ 200D ≥ 60% และ SPY เหนือ 200D
**Risk-Off**: เหนือ 200D ≤ 40% หรือ SPY หลุด 200D · นอกนั้น Neutral
ปรับตัวเลข/หมวดได้ที่ `watchlist.json` → `regime` และ `cat` ของแต่ละสินทรัพย์ (ไม่ต้องแก้โค้ด)

## แท็บ "สะสม" — Trend Status + Accumulation Action (rules.js)
สำหรับพอร์ตสะสม/RMF/Long-term Growth ไม่ใช่เทรดรายวัน — คำนวณจากราคาจริงล้วนๆ ไม่ใช้ AI จึงไม่ต้องรอ Claude วิเคราะห์
Trend (`getTrendStatus`) กับ Action (`getAccumulationAction`) เป็นสองแนวคิดที่แยกกันเสมอ — มารวมกันที่ขั้นตอนสุดท้ายเดียว:
- **Trend** (MA200=regime ระยะยาว, MA50=เทรนด์ระยะกลาง — ไม่ใช้ MA100):
  GREEN ราคา>MA200 และ >MA50 · YELLOW ราคา>MA200 แต่ ≤MA50 · RED ราคา ≤MA200 (veto ทันที)
- **Accumulation Zone** (`getAccumulationZone`, อิงระยะห่างจาก MA100 ล้วนๆ ไม่ดูเทรนด์): A>+8% รอย่อ · B(+3%,+8%] สะสมตามแผน · C[-3%,+3%] เพิ่มน้ำหนักสะสม · D[-8%,-3%) แบ่งไม้ · E<-8% ชะลอ
- **Action สุดท้าย** = Zone ถูก Trend ครอบเพดานเสมอ: GREEN ใช้ Zone ตรงๆ, YELLOW ลดระดับ Zone C เป็น "แบ่งไม้", RED บังคับ "ชะลอ/รอความชัดเจน" ทุกโซน (MA200 มีสิทธิ์ veto)
- **ADX** (`getADXStrength`) บอกความแรงของเทรนด์เท่านั้น ไม่บอกทิศทาง แสดงเป็นข้อมูลเสริม ไม่ใช่ตัวตัดสินใจหลัก
ธรณี/ป้าย/สีทั้งหมดอยู่ใน `rules.js` (`ACCUM_THRESHOLDS`, `ADX_THRESHOLDS`) จุดเดียว — Glossary ในแอปอ่านค่าจากที่นี่ตรงๆ ห้ามฮาร์ดโค้ดซ้ำที่อื่น
รายชื่อสินทรัพย์ที่ใช้ระบบนี้แก้ได้ที่ `watchlist.json` → `accumulate` (แก้ไฟล์ตรงๆ เหมือน `daily`/`groups` ไม่มีปุ่มเพิ่มในแอป)
ยังไม่มี hysteresis/persistence (เช่น "ต้องอยู่ต่ำกว่า MA50 ติดกัน N วัน") — ธรณีทั้งหมดเทียบแบบ flat ล้วนๆ ใน V1 (`TREND_TOLERANCE` จองไว้ยังไม่ใช้งาน)

## ทดสอบก่อน deploy
```
python scripts/update_prices.py --demo   # สร้างข้อมูลตัวอย่าง (prices/series/analysis)
node scripts/test-rules.mjs              # เทสต์กฎสถานะ/Risk-On/SL-TP (27 เคส)
python -m http.server 8000               # แล้วเปิด http://localhost:8000
```

## ข้อจำกัดที่ควรรู้
- ราคาจาก yfinance (ไม่เป็นทางการ อาจพังเป็นครั้งคราว) ถ้าดึงพลาดเกิน 40% สคริปต์จะไม่เขียนทับข้อมูลเดิม
- ป้าย "ทะลุ SL/ถึง TP" คำนวณจากราคา ณ รอบอัปเดตล่าสุด ไม่ใช่เรียลไทม์
- Cron ของ GitHub อาจช้า 5–30 นาที
- RRG เป็นการประมาณด้วย z-score รายสัปดาห์ ให้แนวคิดใกล้เคียง Relative Rotation แต่ไม่ใช่สูตรต้นฉบับ (JdK)
- Elliott Wave เป็นความเห็นของ Claude (การนับคลื่นตีความได้หลายแบบ) ไม่ใช่สัญญาณซื้อขาย — แอปมีป้ายเตือนกำกับเสมอ
- เกณฑ์สถานะ/Risk-On เป็นแนวทางวิเคราะห์ที่เรากำหนดเอง ไม่ใช่มาตรฐานอุตสาหกรรม
- ไม่มีข้อมูลระหว่างวัน/เรียลไทม์ และไม่มีปุ่มเพิ่มสินทรัพย์ในแอป (แก้ `watchlist.json` แล้วรอรอบอัปเดตถัดไป หรือกด Run workflow เอง)
- เปิดแอปครั้งแรกต้องมีอินเทอร์เน็ต (โหลดฟอนต์/แคช) หลังจากนั้นใช้ออฟไลน์ได้
- `python scripts/update_prices.py --demo` สร้างข้อมูลสุ่มไว้ทดสอบ UI (ทับ prices.json, series.json และ analysis.json)
