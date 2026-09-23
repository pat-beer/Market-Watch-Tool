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

  /* ---- แท็บ "สะสม" (long-term accumulation, MA50/100/200) ----
   * SSOT: engine, การ์ดหน้าหลัก, หน้า Detail และ Glossary ต้องอ่านค่าธรณี/ป้าย/สีจากที่นี่ที่เดียว
   * แยกหน้าที่ตาม MA ชัดเจน — ห้ามให้ MA100 กลายเป็นอีกหนึ่งเสียงโหวตเทรนด์:
   *   MA200 = regime ระยะยาว, MA50 = เทรนด์ระยะกลาง, MA100 = จุดอ้างอิงจังหวะสะสม, ADX = ความแรง (ไม่ใช่ทิศทาง) */

  var ACCUM_THRESHOLDS = {extended: 8, normal: 3, nearMA: -3, deepPullback: -8}; // % ห่างจาก MA100 (ยังเป็นเกณฑ์เริ่มต้น รอ backtest)
  var ADX_THRESHOLDS = {weak: 20, emerging: 25, strong: 40};
  // TODO: จองไว้สำหรับกลไก hysteresis/persistence ในอนาคต (เช่น ต้องอยู่ต่ำกว่า MA50 ติดกัน N วันก่อนเปลี่ยนเป็นเหลือง)
  // ยังไม่ใช้งานจริงใน V1 — ตอนนี้ Trend/Zone เทียบธรณีแบบ flat ล้วนๆ ไม่มี tolerance/hysteresis ใดๆ
  var TREND_TOLERANCE = 0;

  var TREND_STATUS = {
    green:   {key: "green",   th: "ขาขึ้น",         short: "ขาขึ้น",  arrow: "↗", rank: 0},
    yellow:  {key: "yellow",  th: "อ่อนตัว",        short: "อ่อนตัว", arrow: "≈", rank: 1},
    red:     {key: "red",     th: "ขาลง",           short: "ขาลง",   arrow: "↘", rank: 2},
    unknown: {key: "unknown", th: "ไม่มีข้อมูลพอ", short: "–",       arrow: "",  rank: 3},
  };

  var ACCUM_ZONE = {
    A: {key: "A", th: "สูงกว่าโซนสะสมมาก"},
    B: {key: "B", th: "Trend ปกติ"},
    C: {key: "C", th: "เข้าใกล้ MA100"},
    D: {key: "D", th: "หลุด MA100"},
    E: {key: "E", th: "ระวังแนวโน้มเปลี่ยน"},
    unknown: {key: "unknown", th: "ไม่มีข้อมูลพอ"},
  };

  var ADX_STRENGTH = {
    weak:     {key: "weak",     th: "อ่อน / Sideway"},
    emerging: {key: "emerging", th: "เริ่มมีแนวโน้ม"},
    clear:    {key: "clear",    th: "ชัดเจน"},
    strong:   {key: "strong",   th: "แข็งแรง"},
    unknown:  {key: "unknown",  th: "–"},
  };

  var ACCUM_ACTION = {
    wait:     {key: "wait",     th: "รอจังหวะย่อ",         rank: 0},
    normal:   {key: "normal",   th: "สะสมตามแผน",          rank: 1},
    increase: {key: "increase", th: "เพิ่มน้ำหนักสะสม",     rank: 2},
    scaledIn: {key: "scaledIn", th: "สะสมแบบแบ่งไม้",       rank: 1},
    pause:    {key: "pause",    th: "ชะลอ / รอความชัดเจน", rank: 3},
    unknown:  {key: "unknown",  th: "–",                    rank: 4},
  };

  // โซน A-E -> action พื้นฐาน (ใช้ตรงๆ เมื่อ Trend=GREEN)
  var ZONE_BASE_ACTION = {A: ACCUM_ACTION.wait, B: ACCUM_ACTION.normal, C: ACCUM_ACTION.increase, D: ACCUM_ACTION.scaledIn, E: ACCUM_ACTION.pause};
  // โซน A-E -> action เมื่อ Trend=YELLOW (ลดระดับ C จาก "เพิ่มน้ำหนัก" เป็น "แบ่งไม้" เพราะเทรนด์ระยะกลางเริ่มอ่อน)
  var ZONE_YELLOW_ACTION = {A: ACCUM_ACTION.wait, B: ACCUM_ACTION.normal, C: ACCUM_ACTION.scaledIn, D: ACCUM_ACTION.scaledIn, E: ACCUM_ACTION.pause};

  /** ระยะห่าง % ของราคาจากเส้นค่าเฉลี่ยใดๆ: (price/ma - 1) * 100 */
  function getMADistance(p, ma) {
    if (p == null || ma == null || !ma) return null;
    return (p / ma - 1) * 100;
  }

  /** สถานะเทรนด์ระดับสูง (s = symbols[t]) — ใช้ MA200 (regime) + MA50 (เทรนด์ระยะกลาง) เท่านั้น ไม่ใช้ MA100
   *   GREEN:  price > MA200 AND price > MA50
   *   YELLOW: price > MA200 AND price <= MA50
   *   RED:    price <= MA200 (หลุด 200D = veto ทันที ไม่สนใจ MA50/MA100) */
  function getTrendStatus(s) {
    if (!s || s.vs200 == null) return TREND_STATUS.unknown;
    if (s.vs200 <= 0) return TREND_STATUS.red;
    if (s.vs50 != null && s.vs50 <= 0) return TREND_STATUS.yellow;
    return TREND_STATUS.green;
  }

  /** โซนสะสมตามระยะห่างจาก MA100 ล้วนๆ (trend-agnostic — ไม่ดูเทรนด์ตรงนี้) */
  function getAccumulationZone(s) {
    if (!s || s.vs100 == null) return ACCUM_ZONE.unknown;
    var d = s.vs100;
    if (d > ACCUM_THRESHOLDS.extended) return ACCUM_ZONE.A;
    if (d > ACCUM_THRESHOLDS.normal) return ACCUM_ZONE.B;
    if (d >= ACCUM_THRESHOLDS.nearMA) return ACCUM_ZONE.C;
    if (d >= ACCUM_THRESHOLDS.deepPullback) return ACCUM_ZONE.D;
    return ACCUM_ZONE.E;
  }

  /** ระดับความแรงเทรนด์จาก ADX — บอกความแรง ไม่บอกทิศทาง (ทิศทางมาจาก getTrendStatus) */
  function getADXStrength(adx) {
    if (adx == null) return ADX_STRENGTH.unknown;
    if (adx < ADX_THRESHOLDS.weak) return ADX_STRENGTH.weak;
    if (adx < ADX_THRESHOLDS.emerging) return ADX_STRENGTH.emerging;
    if (adx < ADX_THRESHOLDS.strong) return ADX_STRENGTH.clear;
    return ADX_STRENGTH.strong;
  }

  /** Action สุดท้าย = โซน (จังหวะ) ถูก "ครอบ" ด้วยเทรนด์ (regime) เสมอ — MA200 มีสิทธิ์ veto
   *  GREEN  : ใช้ action พื้นฐานของโซนตรงๆ (A-E)
   *  YELLOW : ลดระดับตาม ZONE_YELLOW_ACTION (โซน C ไม่ใช่ "เพิ่มน้ำหนัก" แล้ว)
   *  RED    : ทุกโซน -> "ชะลอ / รอความชัดเจน" เสมอ ไม่ว่าโซนจะน่าดึงดูดแค่ไหน */
  function getAccumulationAction(trend, zone) {
    if (!trend || !zone || trend.key === "unknown" || zone.key === "unknown") return ACCUM_ACTION.unknown;
    if (trend.key === "red") return ACCUM_ACTION.pause;
    if (trend.key === "yellow") return ZONE_YELLOW_ACTION[zone.key] || ACCUM_ACTION.unknown;
    return ZONE_BASE_ACTION[zone.key] || ACCUM_ACTION.unknown;
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
    statusOf: statusOf,
    trendOf: trendOf,
    riskBasket: riskBasket,
    regimeOf: regimeOf,
    groupSummary: groupSummary,
    levels: levels,
    // แท็บ "สะสม" — SSOT ของ config/labels ต้องอ่านผ่าน Rules เท่านั้น (ดูหมายเหตุ SSOT เหนือ getTrendStatus)
    ACCUM_THRESHOLDS: ACCUM_THRESHOLDS,
    ADX_THRESHOLDS: ADX_THRESHOLDS,
    TREND_TOLERANCE: TREND_TOLERANCE,
    TREND_STATUS: TREND_STATUS,
    ACCUM_ZONE: ACCUM_ZONE,
    ADX_STRENGTH: ADX_STRENGTH,
    ACCUM_ACTION: ACCUM_ACTION,
    getMADistance: getMADistance,
    getTrendStatus: getTrendStatus,
    getAccumulationZone: getAccumulationZone,
    getADXStrength: getADXStrength,
    getAccumulationAction: getAccumulationAction,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Rules;
  } else {
    root.Rules = Rules;
  }
})(typeof window !== "undefined" ? window : this);
