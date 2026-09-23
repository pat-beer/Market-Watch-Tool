// เทสต์ rules.js — รันด้วย: node scripts/test-rules.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Rules = require("../rules.js");

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  ได้    ${a}\n  ต้องการ ${e}`); }
}

// ---- statusOf ----
eq(Rules.statusOf({vs50: 5, vs200: -3, rsi: 40, adx: 25}).key, "weak", "ใต้200D+RSI<45 -> weak");
eq(Rules.statusOf({vs50: 5, vs200: 3, rsi: 55, adx: 15}).key, "sideways", "ADX<20 -> sideways (ชนะแม้เข้าเกณฑ์แข็งแรง)");
eq(Rules.statusOf({vs50: 2, vs200: 1, rsi: 60, adx: 22}).key, "strong", "เหนือ50/200D, RSI 50-70, ADX>=20 -> strong");
eq(Rules.statusOf({vs50: 5, vs200: 5, rsi: 78, adx: 25}).key, "caution", "RSI>70 -> caution แม้เทรนด์ดี");
eq(Rules.statusOf({vs50: -1, vs200: -5, rsi: 48, adx: 25}).key, "caution", "ใต้200D แต่ RSI>=45 -> caution ไม่ใช่ weak");
eq(Rules.statusOf(null).key, "unknown", "ไม่มีข้อมูล -> unknown");
eq(Rules.statusOf({vs50: 1, vs200: null, rsi: 55, adx: 22}).key, "strong", "vs200 เป็น null (ข้อมูลไม่ถึง 200วัน) ไม่บล็อก strong");

// ลำดับความสำคัญ: weak ต้องชนะ sideways เมื่อเข้าเกณฑ์ทั้งคู่
eq(Rules.statusOf({vs50: -5, vs200: -8, rsi: 30, adx: 10}).key, "weak", "weak ต้องมาก่อน sideways ตามลำดับกฎ");

// ---- trendOf ----
eq(Rules.trendOf({vs50: 2, vs200: 1}), "up", "เหนือทั้งคู่ -> up");
eq(Rules.trendOf({vs50: -2, vs200: -1}), "down", "ใต้ทั้งคู่ -> down");
eq(Rules.trendOf({vs50: 2, vs200: -1}), "flat", "สัญญาณผสม -> flat");
eq(Rules.trendOf({vs50: 2, vs200: null}), "up", "ไม่มี vs200 ใช้ vs50 แทน");

// ---- riskBasket / regimeOf ----
const wl = {
  regime: {includeCats: ["equity", "commodity", "crypto"], riskOnPct: 60, riskOffPct: 40, benchmarkForRegime: "SPY"},
  groups: [
    {id: "sector", items: [{t: "XLK", cat: "equity"}, {t: "XLE", cat: "equity"}]},
    {id: "country", items: [{t: "SPY", cat: "equity"}, {t: "EWJ", cat: "equity"}]},
    {id: "asset", items: [
      {t: "SPY", cat: "equity"}, {t: "TLT", cat: "bond"}, {t: "GC=F", cat: "commodity"},
      {t: "BTC-USD", cat: "crypto"}, {t: "DX-Y.NYB", cat: "dxy"},
    ]},
  ],
};
const basket = Rules.riskBasket(wl);
eq(basket.indexOf("TLT") === -1, true, "basket ไม่รวม bond");
eq(basket.indexOf("DX-Y.NYB") === -1, true, "basket ไม่รวม dxy");
eq(basket.filter((t) => t === "SPY").length, 1, "SPY ไม่ซ้ำแม้อยู่หลายกลุ่ม");

const allAbove = {};
["XLK", "XLE", "SPY", "EWJ", "GC=F", "BTC-USD"].forEach((t) => { allAbove[t] = {vs200: 5}; });
eq(Rules.regimeOf(wl, allAbove).regime.key, "risk-on", "ทุกตัวเหนือ200D + SPY เหนือ200D -> risk-on");

const allBelow = {};
["XLK", "XLE", "SPY", "EWJ", "GC=F", "BTC-USD"].forEach((t) => { allBelow[t] = {vs200: -5}; });
eq(Rules.regimeOf(wl, allBelow).regime.key, "risk-off", "ทุกตัวใต้200D -> risk-off");

const mixedButSpyBelow = {
  XLK: {vs200: 5}, XLE: {vs200: 5}, SPY: {vs200: -1}, EWJ: {vs200: 5}, "GC=F": {vs200: 5}, "BTC-USD": {vs200: 5},
};
eq(Rules.regimeOf(wl, mixedButSpyBelow).regime.key, "risk-off", "แม้ pct>=60% แต่ SPY ใต้200D -> risk-off (กฎ AND)");

const half = {
  XLK: {vs200: 5}, XLE: {vs200: -5}, SPY: {vs200: 5}, EWJ: {vs200: -5}, "GC=F": {vs200: 5}, "BTC-USD": {vs200: -5},
};
eq(Rules.regimeOf(wl, half).regime.key, "neutral", "50% เหนือ200D อยู่กลาง on/off -> neutral");

// ---- groupSummary ----
const items = [{t: "A"}, {t: "B"}, {t: "C"}];
const syms = {
  A: {vs200: 5, vs50: 3, rsi: 60, adx: 25},   // strong
  B: {vs200: -5, vs50: -3, rsi: 30, adx: 25}, // weak
  C: {vs200: 5, vs50: 3, rsi: 55, adx: 10},   // sideways
};
const gs = Rules.groupSummary(items, syms);
eq(gs.counts, {weak: 1, sideways: 1, strong: 1, caution: 0, unknown: 0}, "groupSummary นับสถานะถูกต้อง");
eq(gs.pctAbove200, (2 / 3) * 100, "groupSummary %เหนือ200D ถูกต้อง");

// ---- levels (SL/TP) ----
const lv1 = Rules.levels({bias: "long", entry: 100, sl: 90, tp: 130}, 95);
eq(Math.round(lv1.dSL * 10) / 10, 5.3, "long: ห่าง SL คำนวณถูก");
eq(lv1.rr, 3, "long: R:R = (130-100)/(100-90) = 3");
eq(lv1.st, null, "ยังไม่เข้าเงื่อนไขเตือนใดๆ");

const lv2 = Rules.levels({bias: "long", entry: 100, sl: 90, tp: 130}, 89);
eq(lv2.st.key, "bad", "ราคาต่ำกว่า SL -> ทะลุ SL");

const lv3 = Rules.levels({bias: "short", entry: 100, sl: 110, tp: 80}, 105);
eq(lv3.long, false, "short bias ระบุถูก");
eq(Math.round(lv3.dSL * 10) / 10, 4.8, "short: ห่าง SL คำนวณถูกทิศทาง");

const lv4 = Rules.levels({bias: "long", entry: 100, sl: 90, tp1: 130, tp2: 160}, 100);
eq(lv4.tp1, 130, "tp1 ใช้แทน tp ได้");
eq(lv4.rr, 3, "R:R หลักคำนวณจาก tp1");
eq(lv4.rr2, 6, "R:R2 คำนวณจาก tp2 = (160-100)/(100-90) = 6");
eq(Math.round(lv4.dTP2 * 10) / 10, 60, "ห่าง TP2 คำนวณถูก");

// ---- getTrendStatus (แท็บสะสม: MA200=regime, MA50=เทรนด์ระยะกลาง — ไม่ใช้ MA100) ----
eq(Rules.getTrendStatus({vs200: 5, vs50: 2}).key, "green", "เหนือ 200D และ 50D -> green");
eq(Rules.getTrendStatus({vs200: 5, vs50: -1}).key, "yellow", "เหนือ 200D แต่ใต้ 50D -> yellow (ไม่ใช่ red เต็มๆ)");
eq(Rules.getTrendStatus({vs200: -0.1, vs50: 5}).key, "red", "หลุด 200D แม้เพียงเล็กน้อย -> red (veto ทันที ไม่สนใจ 50D)");
eq(Rules.getTrendStatus({vs200: null}).key, "unknown", "ไม่มีข้อมูล vs200 -> unknown");
eq(Rules.getTrendStatus(null).key, "unknown", "ไม่มีข้อมูล -> unknown");

// ---- getAccumulationZone (trend-agnostic, เทียบ MA100 ล้วนๆ) ----
eq(Rules.getAccumulationZone({vs100: 9}).key, "A", "ห่าง MA100 > +8% -> A");
eq(Rules.getAccumulationZone({vs100: 8}).key, "B", "ห่าง MA100 = +8% (ขอบเขต) -> B ไม่ใช่ A");
eq(Rules.getAccumulationZone({vs100: 5}).key, "B", "+3% < ห่าง <= +8% -> B");
eq(Rules.getAccumulationZone({vs100: 3}).key, "C", "ห่าง MA100 = +3% (ขอบเขต) -> C ไม่ใช่ B");
eq(Rules.getAccumulationZone({vs100: 1}).key, "C", "-3% <= ห่าง <= +3% -> C");
eq(Rules.getAccumulationZone({vs100: -3}).key, "C", "ห่าง MA100 = -3% (ขอบเขต) -> C ไม่ใช่ D");
eq(Rules.getAccumulationZone({vs100: -5}).key, "D", "-8% <= ห่าง < -3% -> D");
eq(Rules.getAccumulationZone({vs100: -8}).key, "D", "ห่าง MA100 = -8% (ขอบเขต) -> D ไม่ใช่ E");
eq(Rules.getAccumulationZone({vs100: -9}).key, "E", "ห่าง MA100 < -8% -> E");
eq(Rules.getAccumulationZone({vs100: null}).key, "unknown", "ไม่มีข้อมูล vs100 -> unknown");

// ---- getADXStrength (ความแรง ไม่ใช่ทิศทาง) ----
eq(Rules.getADXStrength(13.6).key, "weak", "ADX<20 -> weak");
eq(Rules.getADXStrength(22).key, "emerging", "ADX 20-25 -> emerging");
eq(Rules.getADXStrength(30).key, "clear", "ADX 25-40 -> clear");
eq(Rules.getADXStrength(45).key, "strong", "ADX>=40 -> strong");
eq(Rules.getADXStrength(null).key, "unknown", "ไม่มีข้อมูล -> unknown");

// ---- getAccumulationAction (guardrail: เทรนด์ครอบโซนเสมอ) ----
// CASE 1: price > MA50 > MA200, ห่าง MA100 = +5% (zone B), ADX 30 (clear) -> uptrend, สะสมตามแผน
eq(Rules.getAccumulationAction(Rules.getTrendStatus({vs200: 8, vs50: 3}), Rules.getAccumulationZone({vs100: 5})).key, "normal", "CASE1: green+B -> สะสมตามแผน");
// CASE 2: เทรนด์ยังแข็งแรง, ห่าง MA100 = +1% (zone C) -> เพิ่มน้ำหนักสะสม
eq(Rules.getAccumulationAction(Rules.getTrendStatus({vs200: 8, vs50: 3}), Rules.getAccumulationZone({vs100: 1})).key, "increase", "CASE2: green+C -> เพิ่มน้ำหนักสะสม");
// CASE 3: ราคายังเหนือ 200D แต่โครงสร้างระยะกลางอ่อนลง (ใต้ 50D) -> yellow ไม่ใช่ red เต็มๆ
eq(Rules.getTrendStatus({vs200: 4, vs50: -2}).key, "yellow", "CASE3: เหนือ 200D แต่ใต้ 50D -> yellow ไม่ใช่ downtrend เต็มรูปแบบ");
// CASE 4: price < MA100 แต่ยังเหนือ MA200 -> pullback ระมัดระวัง ไม่ใช่ downtrend อัตโนมัติ
eq(Rules.getTrendStatus({vs200: 4, vs50: 2}).key, "green", "CASE4: ใต้ MA100 (ไม่ถูกใช้ตัดสินเทรนด์) แต่ยังเหนือ 200D/50D -> ยัง green");
eq(Rules.getAccumulationZone({vs100: -5}).key, "D", "CASE4: ใต้ MA100 มากกว่า 3% -> zone D (สะสมแบบแบ่งไม้ ไม่ใช่ downtrend)");
// CASE 5: ราคาต่ำกว่า MA200 อย่างมีนัยสำคัญ -> คำเตือนโครงสร้างเสีย
eq(Rules.getTrendStatus({vs200: -10, vs50: -8}).key, "red", "CASE5: หลุด MA200 ชัดเจน -> red");
eq(Rules.getAccumulationAction(Rules.getTrendStatus({vs200: -10, vs50: -8}), Rules.getAccumulationZone({vs100: -10})).key, "pause", "CASE5: red -> ชะลอ/รอความชัดเจน");
// CASE 6: ADX=15 (อ่อน) กับโครงสร้าง MA เป็นบวก -> ยังคง uptrend ทิศทางไม่เปลี่ยนตาม ADX
eq(Rules.getTrendStatus({vs200: 5, vs50: 2}).key, "green", "CASE6: MA บวกล้วน -> green แม้ ADX จะอ่อน");
eq(Rules.getADXStrength(15).key, "weak", "CASE6: ADX=15 -> weak (บอกความแรง ไม่เปลี่ยนทิศทาง)");
// CASE 7 (สำคัญที่สุด): Trend=RED ต้อง veto zone ที่ดูน่าดึงดูด (zone C ปกติจะบอก "เพิ่มน้ำหนักสะสม")
eq(Rules.getAccumulationZone({vs100: 1}).key, "C", "CASE7: ห่าง MA100 +1% เดี่ยวๆ -> zone C");
eq(Rules.getAccumulationAction(Rules.getTrendStatus({vs200: -5, vs50: 3}), Rules.getAccumulationZone({vs100: 1})).key, "pause",
  "CASE7: Trend=RED ต้อง veto zone C เสมอ -> ชะลอ/รอความชัดเจน (ห้ามขึ้น เพิ่มน้ำหนักสะสม ขณะ RED เด็ดขาด)");
// yellow guardrail: zone C ถูกลดระดับจาก "เพิ่มน้ำหนักสะสม" เป็น "สะสมแบบแบ่งไม้"
eq(Rules.getAccumulationAction(Rules.getTrendStatus({vs200: 5, vs50: -2}), Rules.getAccumulationZone({vs100: 1})).key, "scaledIn",
  "yellow+C -> สะสมแบบแบ่งไม้ (ลดระดับจาก เพิ่มน้ำหนักสะสม เพราะเทรนด์ระยะกลางอ่อน)");
eq(Rules.getAccumulationAction(Rules.getTrendStatus({vs200: null}), Rules.getAccumulationZone({vs100: 1})).key, "unknown", "ไม่มีข้อมูลเทรนด์ -> unknown");

console.log(`\n${pass} ผ่าน, ${fail} ไม่ผ่าน`);
process.exit(fail ? 1 : 0);
