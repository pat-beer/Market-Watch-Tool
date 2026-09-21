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

  /** ระยะห่าง SL/TP, R:R และสถานะเตือน จากแผนของ Claude (d) เทียบราคาล่าสุด */
  function levels(d, last) {
    if (!d || d.sl == null || d.tp == null || last == null) return null;
    var long = (d.bias || "long") !== "short";
    var entry = d.entry != null ? d.entry : last;
    var dSL = long ? (last - d.sl) / last * 100 : (d.sl - last) / last * 100;
    var dTP = long ? (d.tp - last) / last * 100 : (last - d.tp) / last * 100;
    var risk = long ? entry - d.sl : d.sl - entry;
    var reward = long ? d.tp - entry : entry - d.tp;
    var rr = risk > 0 && reward > 0 ? reward / risk : null;
    var st = null;
    if (dSL <= 0) st = {key: "bad", th: "ทะลุ SL"};
    else if (dTP <= 0) st = {key: "good", th: "ถึง TP"};
    else if (dSL < 1.5) st = {key: "warn", th: "ใกล้ SL"};
    else if (dTP < 1.5) st = {key: "note", th: "ใกล้ TP"};
    return {long: long, entry: entry, dSL: dSL, dTP: dTP, rr: rr, st: st};
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
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Rules;
  } else {
    root.Rules = Rules;
  }
})(typeof window !== "undefined" ? window : this);
