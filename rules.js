/*
 * rules.js — กฎเดียวที่กำหนด "สถานะ" ของสินทรัพย์และภาพรวมตลาด
 * ไม่ใช้ AI ทั้งไฟล์ คำนวณจากตัวเลขใน data/prices.json ล้วนๆ
 * ใช้ร่วมกันทั้งหน้าเว็บ (window.Rules) และเทสต์ (Node, module.exports)
 *
 * ลำดับการตัดสินสถานะ (สำคัญ — ต้องเช็กตามลำดับนี้เสมอ):
 *   1. อ่อนแอ (แดง)   — ใต้ 200D และ RSI < 45
 *   2. ไซด์เวย์ (เทา)  — ADX < 20 (ไม่มีเทรนด์ชัดเจน ไม่ว่าราคาจะอยู่ตรงไหน)
 *   3. แข็งแรง (เขียว) — เหนือ 50D และ 200D, RSI 50–70, ADX ≥ 20
 *   4. ระวัง (เหลือง)  — ที่เหลือทั้งหมด (RSI > 70 หรือสัญญาณผสม)
 */
(function (root) {
  "use strict";

  var STATUS = {
    weak:     {key: "weak",     th: "อ่อนแอ",   short: "อ่อนแอ",  rank: 0},
    sideways: {key: "sideways", th: "ไซด์เวย์", short: "ไซด์เวย์", rank: 1},
    strong:   {key: "strong",   th: "แข็งแรง",  short: "แข็งแรง", rank: 2},
    caution:  {key: "caution",  th: "ระวัง",    short: "ระวัง",   rank: 3},
    unknown:  {key: "unknown",  th: "ไม่มีข้อมูลพอ", short: "–",   rank: 4},
  };

  var REGIME = {
    riskOn:  {key: "risk-on",  th: "Risk-On",  short: "เสี่ยงได้"},
    neutral: {key: "neutral",  th: "Neutral",  short: "กลางๆ"},
    riskOff: {key: "risk-off", th: "Risk-Off", short: "ระวัง"},
  };

  var ACCUM = {
    pause: {key: "pause", th: "หลุด 200D — หยุดสะสมชั่วคราว", short: "หยุดชั่วคราว", rank: 0},
    tier2: {key: "tier2", th: "แตะเส้น 100D — ไม้ใหญ่",       short: "ไม้ใหญ่ (100D)", rank: 1},
    tier1: {key: "tier1", th: "แตะเส้น 50D — ไม้ปกติ",        short: "ไม้ปกติ (50D)",  rank: 2},
    none:  {key: "none",  th: "เทรนด์ปกติ ยังไม่ถึงจุดเข้า",   short: "รอจังหวะ",       rank: 3},
    unknown: {key: "unknown", th: "ไม่มีข้อมูลพอ", short: "–", rank: 4},
  };
  var ACCUM_TOL = 2; // % ระยะห่างจากเส้นที่นับว่า "แตะ"

  /** สัญญาณสะสมระยะยาวแบบ buy-the-dip-in-uptrend จาก MA50/100/200 (s = symbols[t])
   *  เทรนด์ถือว่ายังไม่เสียตราบใดที่ราคาสูงกว่าเส้น 200D — หลุด 200D = หยุดสะสมชั่วคราว
   *  ไม่หลุด: แตะ (±ACCUM_TOL%) เส้น 100D ก่อน (ไม้ใหญ่กว่า) แล้วค่อยเช็คเส้น 50D (ไม้ปกติ) */
  function accumSignal(s) {
    if (!s || s.vs200 == null) return ACCUM.unknown;
    if (s.vs200 < 0) return ACCUM.pause;
    if (s.vs100 != null && Math.abs(s.vs100) <= ACCUM_TOL) return ACCUM.tier2;
    if (s.vs50 != null && Math.abs(s.vs50) <= ACCUM_TOL) return ACCUM.tier1;
    return ACCUM.none;
  }

  /** สถานะของสินทรัพย์หนึ่งตัว จากตัวเลขใน prices.json (s = symbols[t]) */
  function statusOf(s) {
    if (!s || s.rsi == null || s.adx == null) return STATUS.unknown;
    var vs200 = s.vs200, vs50 = s.vs50, rsi = s.rsi, adx = s.adx;

    if (vs200 != null && vs200 < 0 && rsi < 45) return STATUS.weak;
    if (adx < 20) return STATUS.sideways;
    if (vs50 != null && vs50 >= 0 && (vs200 == null || vs200 >= 0) && rsi >= 50 && rsi <= 70 && adx >= 20) {
      return STATUS.strong;
    }
    return STATUS.caution;
  }

  /** ลูกศรแนวโน้ม: "up" | "down" | "flat" จากตำแหน่งเทียบ MA50/MA200 */
  function trendOf(s) {
    if (!s) return "flat";
    var a = s.vs50, b = s.vs200;
    if (a == null) return "flat";
    if (b == null) return a >= 0 ? "up" : "down";
    if (a >= 0 && b >= 0) return "up";
    if (a < 0 && b < 0) return "down";
    return "flat";
  }

  /** รวมรายชื่อ ticker ที่นับใน Risk-On basket (equity+commodity+crypto ตาม watchlist.regime) แบบไม่ซ้ำ */
  function riskBasket(wl) {
    var cats = (wl.regime && wl.regime.includeCats) || ["equity", "commodity", "crypto"];
    var seen = {}, out = [];
    wl.groups.forEach(function (g) {
      g.items.forEach(function (it) {
        var cat = it.cat || "equity";
        if (cats.indexOf(cat) === -1) return;
        if (seen[it.t]) return;
        seen[it.t] = true;
        out.push(it.t);
      });
    });
    return out;
  }

  /** ภาพรวมตลาด Risk-On / Neutral / Risk-Off จาก prices.json + watchlist.json */
  function regimeOf(wl, symbols) {
    var basket = riskBasket(wl);
    var above = 0, valid = 0;
    basket.forEach(function (t) {
      var s = symbols[t];
      if (!s || s.vs200 == null) return;
      valid++;
      if (s.vs200 >= 0) above++;
    });
    var pct = valid ? (above / valid) * 100 : null;
    var benchT = (wl.regime && wl.regime.benchmarkForRegime) || "SPY";
    var bench = symbols[benchT];
    var benchAbove = bench && bench.vs200 != null ? bench.vs200 >= 0 : null;
    var onPct = (wl.regime && wl.regime.riskOnPct) || 60;
    var offPct = (wl.regime && wl.regime.riskOffPct) || 40;

    var regime = REGIME.neutral;
    if (pct != null) {
      if (pct <= offPct || benchAbove === false) regime = REGIME.riskOff;
      else if (pct >= onPct && benchAbove === true) regime = REGIME.riskOn;
    }
    return {regime: regime, pct: pct, valid: valid, total: basket.length, benchAbove: benchAbove, benchT: benchT};
  }

  /** สรุปสถานะของกลุ่ม (sector/country ฯลฯ): จำนวนแต่ละสถานะ + % เหนือ 200D + ADX มัธยฐาน */
  function groupSummary(items, symbols) {
    var counts = {weak: 0, sideways: 0, strong: 0, caution: 0, unknown: 0};
    var above200 = 0, valid200 = 0, adxList = [];
    items.forEach(function (it) {
      var s = symbols[it.t];
      var st = statusOf(s);
      counts[st.key]++;
      if (s && s.vs200 != null) { valid200++; if (s.vs200 >= 0) above200++; }
      if (s && s.adx != null) adxList.push(s.adx);
    });
    adxList.sort(function (a, b) { return a - b; });
    var medAdx = adxList.length ? adxList[Math.floor(adxList.length / 2)] : null;
    return {
      counts: counts,
      total: items.length,
      pctAbove200: valid200 ? (above200 / valid200) * 100 : null,
      medianAdx: medAdx,
    };
  }

  /** ระยะห่าง SL/TP1/TP2, R:R และสถานะเตือน จากแผนของ Claude (d) เทียบราคาล่าสุด
   *  รองรับ d.tp1 (ใหม่) หรือ d.tp (เดิม) เป็นเป้าหลัก; d.tp2 เป็นเป้าที่สอง (ไม่บังคับ) */
  function levels(d, last) {
    var tp1 = d ? (d.tp1 != null ? d.tp1 : d.tp) : null;
    if (!d || d.sl == null || tp1 == null || last == null) return null;
    var tp2 = d.tp2 != null ? d.tp2 : null;
    var long = (d.bias || "long") !== "short";
    var entry = d.entry != null ? d.entry : last;
    var dSL = long ? (last - d.sl) / last * 100 : (d.sl - last) / last * 100;
    var dTP = long ? (tp1 - last) / last * 100 : (last - tp1) / last * 100;
    var dTP2 = tp2 == null ? null : (long ? (tp2 - last) / last * 100 : (last - tp2) / last * 100);
    var risk = long ? entry - d.sl : d.sl - entry;
    var reward = long ? tp1 - entry : entry - tp1;
    var rr = risk > 0 && reward > 0 ? reward / risk : null;
    var reward2 = tp2 == null ? null : (long ? tp2 - entry : entry - tp2);
    var rr2 = tp2 != null && risk > 0 && reward2 > 0 ? reward2 / risk : null;
    var st = null;
    if (dSL <= 0) st = {key: "bad", th: "ทะลุ SL"};
    else if (dTP <= 0) st = {key: "good", th: "ถึง TP1"};
    else if (dSL < 1.5) st = {key: "warn", th: "ใกล้ SL"};
    else if (dTP < 1.5) st = {key: "note", th: "ใกล้ TP1"};
    return {long: long, entry: entry, tp1: tp1, tp2: tp2, dSL: dSL, dTP: dTP, dTP2: dTP2, rr: rr, rr2: rr2, st: st};
  }

  var Rules = {
    STATUS: STATUS,
    REGIME: REGIME,
    ACCUM: ACCUM,
    statusOf: statusOf,
    trendOf: trendOf,
    riskBasket: riskBasket,
    regimeOf: regimeOf,
    groupSummary: groupSummary,
    levels: levels,
    accumSignal: accumSignal,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Rules;
  } else {
    root.Rules = Rules;
  }
})(typeof window !== "undefined" ? window : this);
