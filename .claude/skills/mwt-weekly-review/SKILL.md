---
name: mwt-weekly-review
description: ทบทวนรายสัปดาห์ของ Market Watch Tool (repo pat-beer/Market-Watch-Tool) คำนวณ SL/TP1/TP2 ของแท็บ daily ใหม่ใน data/analysis.json เช็ก SL หลุด และ key level ของ Elliott Wave, sync TradingView alerts และส่งเป็น patch
---

# Market Watch Tool — Weekly Review

ใช้เมื่อผู้ใช้พูดว่า "ทบทวน", "พ้นสัปดาห์แล้ว", "update SL TP1 TP2", "ตลาดลงหนัก SL ใช้ไม่ได้แล้ว" หรือแอปขึ้น "Failed to fetch prices" ตอบเป็นภาษาไทย สั้น ตรงประเด็น

## ขอบเขต
- แก้เฉพาะบล็อก `daily` ใน `data/analysis.json` (ทุกตัวในแท็บ daily ของ `watchlist.json`: GC=F, BTC-USD, IVV, QQQM, ARKK, ARKW, ARKF, DJP, SMH, DAPP, SILVER_THB_KG)
- ห้ามแตะ `weekly`, `waves`, `demo`, `asof` ระดับบนสุด และห้ามแก้ `data/prices.json`, `data/series.json`, `data/silver_thb_history.json` (บอทอัปเดตเอง)
- Elliott Wave ไม่นับรายสัปดาห์ ทำสิ้นเดือนด้วย skill `mwt-elliott-month-end` แต่รายสัปดาห์ให้ **เช็กอ่านอย่างเดียว** ว่าราคาปิดหลุด `keyLevel` ของ `waves` ตัวไหนหรือยัง ถ้าหลุดให้เตือนผู้ใช้ว่าควรนับใหม่ (ไม่ต้องรอสิ้นเดือน)

## ขั้นตอน
1. `git clone` repo ลง /tmp (อ่านได้ผ่าน https; `gh` token ใน sandbox ใช้ไม่ได้ และ Yahoo Finance เข้าจาก sandbox ไม่ได้ ห้ามพยายามดึงราคาสด) ถ้ามี clone เก่าให้ `git fetch` แล้ว `git reset --hard origin/main`
2. อ่าน `data/prices.json`: ดู `updated`, `session`, `demo`, `failed` ถ้า `demo` เป็น true ให้หยุดและบอกผู้ใช้ ถ้า `failed` มีตัวที่อยู่ใน daily ให้แจ้งว่าตัวนั้นใช้ข้อมูลเก่า
3. ระบุให้ชัดว่าราคาเป็น snapshot จากเวลาไหน (บอทรันประมาณ 06:30Z และ 18:40Z รอบหลังเป็นช่วงกลางตลาด US ไม่ใช่ราคาปิดจริง รอบหลังตลาดปิดคือ ~21:00Z ขึ้นไป) แจ้งผู้ใช้ทุกครั้ง และเสนอคำนวณซ้ำหลังรอบถัดไปถ้าต้องการราคาปิด
4. คำนวณต่อ ticker ด้วย `symbols[t].last` และ `symbols[t].atr` (ATR14):
   - entry = last
   - risk = 1.5 × ATR14
   - SL = entry − risk
   - TP1 = entry + 1.5 × risk (R:R 1:1.5)
   - TP2 = entry + 3 × risk (R:R 1:3)
   - ปัด 2 ทศนิยม
5. SILVER_THB_KG: ใช้ฟังก์ชันใน `scripts/update_prices.py` (`silver_weekly_bars`, `silver_levels`, `silver_analysis_entry`, flag `--silver-analysis`) ราคาคือราคาขายออก ไม่รวม VAT ของ bowinsgroup หน่วยบาท/กก. ถ้า weekly bars < 12 ใช้โหมด provisional (risk = 6% ของราคา) ถ้า ≥ 12 ใช้ 1.5 × ATR12 จาก weekly bars ระบุโหมดใน note
6. เช็ก SL หลุด: เทียบ SL เดิมในไฟล์กับราคาปิดรายวันใน `series.json` ตั้งแต่รอบทบทวนก่อน ถ้ามีวันปิดต่ำกว่า SL เติมใน note: "(ราคาหลุด SL เดิมที่ X ระหว่างสัปดาห์ — ปิดต่ำกว่าครั้งแรก YYYY-MM-DD)" และสรุปให้ผู้ใช้ว่าตัวไหนหลุด
7. note ใช้ข้อความ "ทบทวนแผนรายสัปดาห์" และคงรูปแบบ field เดิมของแต่ละ entry ทุกอย่าง
8. เขียนไฟล์ด้วยการ splice ข้อความดิบ: แทนที่เฉพาะบล็อก `  "daily": {` ... ด้วยการนับปีกกา ห้าม `json.dump` ทั้งไฟล์ แล้วตรวจว่าส่วนอื่น (`weekly`, `waves`, `demo`, `asof`) เหมือนเดิมทุกไบต์
9. รัน `node scripts/test-rules.mjs` ต้องผ่านทั้งหมด
10. ตรวจเลขซ้ำ: entry ตรง `last` (ส่วนต่าง < 0.01%) และ SL < entry < TP1 < TP2 ทุกตัว

## TradingView alerts (ถ้าเครื่องมือเชื่อมต่ออยู่)
- ถ้าเครื่องมือ TradingView ไม่ถูกโหลด/หลุด ให้บอกผู้ใช้ตรงๆ ว่าอัปเดต alert ไม่ได้รอบนี้ และให้ตารางค่าไปตั้งเอง ห้ามอ้างว่าตั้งแล้ว
- ลบ alert เดิมของ 10 ตัวนี้ แล้วสร้างใหม่ 3 รายการต่อ ticker ความละเอียด 1D หมดอายุ +30 วัน
- ชื่อ: `{SHORT} SL {value} (Risk -X.X%)` (cross_down), `{SHORT} TP1 {value} (R:R 1:1.5)` และ `{SHORT} TP2 {value} (R:R 1:3)` (cross_up)
- สัญลักษณ์: OANDA:XAUUSD, BINANCE:BTCUSDT, AMEX:IVV, NASDAQ:QQQM, CBOE:ARKK, CBOE:ARKW, CBOE:ARKF, AMEX:DJP, NASDAQ:SMH, NASDAQ:DAPP
- SILVER_THB_KG ไม่มี symbol ใน TradingView ข้าม
- ตรวจด้วย list alerts ว่า active ครบ

## ส่งมอบ (push จาก sandbox ไม่ได้: 403)
1. commit ใน clone ท้ายข้อความ commit ใส่บรรทัด attribution ตามที่ระบบกำหนดในแต่ละ session
2. ลอง `git push` ถ้า 403 ให้ใช้ patch: `git diff <base>..HEAD -- <files> > /tmp/weekly-review-YYYY-MM-DD.patch`
3. ตรวจ patch ด้วย `git worktree add` แล้ว `git apply --check` (และรันเทสต์)
4. ส่งไฟล์ด้วย SendUserFile พร้อมคำสั่งให้ผู้ใช้เอาไปใช้กับ Claude Code บนเครื่อง ย้ำว่าต้องใช้ไฟล์ patch ใหม่ที่ดาวน์โหลด ไม่ใช่ patch เก่าที่ค้างในโฟลเดอร์ (เคยทำให้ Claude Code ปฏิเสธเพราะเห็นว่า apply ไปแล้ว) และให้ลบไฟล์ patch เก่าหลัง apply
5. หลังผู้ใช้ push แล้วให้ `git fetch` ตรวจว่า entry ใน analysis.json ตรงกับ prices.json ล่าสุด

## รายงานสุดท้าย (สั้น)
ตาราง entry / SL / TP1 / TP2 ต่อ ticker, ตัวที่ SL หลุด, snapshot เวลาไหน, สถานะ TradingView, เรื่องค้าง (เช่น ticker ที่ดึงราคาล้มเหลว, key level ของ Elliott ที่หลุด) และ 1 บรรทัดว่าถ้าจะคำนวณซ้ำด้วยราคาปิดให้บอก ปิดท้ายว่าเป็นข้อมูลประกอบการตัดสินใจ ไม่ใช่คำแนะนำซื้อขาย
