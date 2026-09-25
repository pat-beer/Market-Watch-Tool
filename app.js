"use strict";
/* Market Structure Watchlist — ตรรกะหน้าเว็บทั้งหมด (ไม่ใช้ AI)
 * กฎสถานะ/Risk-On อยู่ใน rules.js (window.Rules) ไฟล์นี้มีหน้าที่แสดงผลเท่านั้น */

var Q = {
  leading:  {th: "นำตลาด",   hex: "#0E8A4F"},
  weakening:{th: "เริ่มอ่อน", hex: "#C98A0B"},
  lagging:  {th: "ตามหลัง",  hex: "#C62F3B"},
  improving:{th: "กำลังฟื้น", hex: "#2563A8"},
};
var VIEW = {overweight: {th: "เพิ่ม", ic: "▲", cl: "up"}, neutral: {th: "ถือ", ic: "●", cl: ""}, underweight: {th: "ลด", ic: "▼", cl: "down"}};
var GROUP_ICON = {sector: "🏭", country: "🌍", asset: "◆"};
var CAT_TH = {equity: "หุ้น/ETF", commodity: "สินค้าโภคภัณฑ์", bond: "ตราสารหนี้", crypto: "คริปโต", dxy: "ดัชนีดอลลาร์"};

var S = {
  screen: "overview", from: "overview",
  group: "sector", groupView: "rrg", tableMode: "structure", period: "r1m",
  detPeriod: "1y", sel: null,
  wl: null, px: null, series: null, an: null,
  theme: "light", fs: 1,
};

var $ = function (s) { return document.querySelector(s); };
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]; }); }
function pct(v, d) { d = d == null ? 1 : d; return v == null ? "–" : (v > 0 ? "+" : "") + v.toFixed(d) + "%"; }
function price(v) { if (v == null) return "–"; var a = Math.abs(v);
  return v.toLocaleString("en-US", {maximumFractionDigits: a >= 10000 ? 0 : a >= 1000 ? 1 : 2, minimumFractionDigits: a >= 1000 ? 0 : 2}); }
function heat(v, scale) { if (v == null) return "transparent"; var a = Math.min(Math.abs(v) / scale, 1) * .5;
  return v >= 0 ? "color-mix(in srgb, var(--strong) " + Math.round(a * 100) + "%, transparent)" : "color-mix(in srgb, var(--weak) " + Math.round(a * 100) + "%, transparent)"; }
var SCALE = {r1w: 4, r1m: 8, r3m: 15, r6m: 22, r1y: 30, ytd: 25};
var PERIOD_LABEL = {r1w: "1 สัปดาห์", r1m: "1 เดือน", r3m: "3 เดือน", r6m: "6 เดือน", r1y: "1 ปี", ytd: "ตั้งแต่ต้นปี"};
function fmtDate(d) { return new Date(d).toLocaleDateString("th-TH", {day: "numeric", month: "short", timeZone: "Asia/Bangkok"}); }
function fmtDT(d) { return new Date(d).toLocaleString("th-TH", {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok"}); }
function daysAgo(d) { var iso = String(d).length === 10 ? d + "T00:00:00+07:00" : d; return Math.floor((Date.now() - new Date(iso).getTime()) / 864e5); }
var store = {get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }};

function trendArrow(trend) { return trend === "up" ? "↑" : trend === "down" ? "↓" : "→"; }
function statusChip(st, withDot) {
  return '<span class="statuscell ' + st.key + '">' + (withDot === false ? "" : "<i></i>") + esc(st.short) + "</span>";
}

/* ---------- data ---------- */
function getJSON(u) { return fetch(u, {cache: "no-cache"}).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }); }
function load() {
  return Promise.all([getJSON("watchlist.json"), getJSON("data/prices.json")]).then(function (r) {
    S.wl = r[0]; S.px = r[1];
    var opt = [
      getJSON("data/series.json").then(function (d) { S.series = d; }).catch(function () { S.series = {series: {}}; }),
      getJSON("data/analysis.json").then(function (d) { S.an = d; }).catch(function () { S.an = null; }),
    ];
    return Promise.all(opt);
  });
}
function findGroup(id) { return S.wl.groups.filter(function (g) { return g.id === id; })[0] || S.wl.groups[0]; }
function groupItems(g) {
  return g.items.map(function (it) {
    var s = S.px.symbols[it.t]; if (!s) return null;
    return Object.assign({}, it, {disp: it.s || it.t, s: s, rrg: g.rrg ? (s.rrg_by || {})[g.benchmark] : null,
      status: Rules.statusOf(s), trend: Rules.trendOf(s), view: S.an && S.an.weekly && S.an.weekly.views ? S.an.weekly.views[it.t] : null});
  }).filter(Boolean);
}

/* ---------- header / nav ---------- */
function setHeader(title, sub, showBack) {
  $("#pageTitle").textContent = title;
  var parts = [sub, S.freshText].filter(Boolean);
  var subEl = $("#pageSub");
  subEl.textContent = parts.join(" · ");
  subEl.classList.toggle("old", !!S.freshOld);
  $("#backBtn").hidden = !showBack;
}
function renderFresh() {
  if (!S.px) return;
  var h = (Date.now() - new Date(S.px.updated)) / 36e5;
  S.freshText = fmtDT(S.px.updated) + (S.px.demo ? " · ตัวอย่าง" : "");
  S.freshOld = h > 30;
}

/* ================= OVERVIEW ================= */
function overviewHTML() {
  var reg = Rules.regimeOf(S.wl, S.px.symbols);
  var o = regimeCard(reg);
  o += weeklyNote();

  o += '<div class="sectionhd"><h2>ภาพรวมรายกลุ่ม</h2></div>';
  o += '<div class="tiles">';
  S.wl.groups.forEach(function (g) {
    var gs = Rules.groupSummary(g.items, S.px.symbols);
    var pct200 = gs.pctAbove200;
    var domKey = pct200 == null ? "unknown" : pct200 >= 60 ? "strong" : pct200 <= 40 ? "weak" : "caution";
    o += '<button class="tile" data-goto-group="' + g.id + '">' +
      '<span class="lbl">' + GROUP_ICON[g.id] + " " + esc(g.label) + "</span>" +
      '<span class="val ' + domKey + '">' + (pct200 == null ? "–" : Math.round(pct200) + "%") + "</span>" +
      '<span class="bar"><i style="width:' + (pct200 || 0) + '%;background:var(--' + domKey + ')"></i></span></button>';
  });
  o += "</div>";

  o += '<div class="sectionhd"><h2>สัดส่วนเหนือเส้น 200 วัน</h2><button class="help" id="critBtn" aria-label="ดูเกณฑ์การประเมิน">?</button></div>';
  S.wl.groups.forEach(function (g) {
    var gs = Rules.groupSummary(g.items, S.px.symbols);
    var p = gs.pctAbove200 == null ? 0 : gs.pctAbove200;
    var col = p >= 60 ? "strong" : p <= 40 ? "weak" : "caution";
    o += '<div class="gbar-row"><span class="nm">' + esc(g.label) + '</span><span class="track"><i style="width:' + p + '%;background:var(--' + col + ')"></i></span><span class="pctv num">' + Math.round(p) + '%</span></div>';
  });

  o += quoteLine(reg);
  o += '<p class="foot">ตัวเลขทั้งหมดคำนวณจากราคาและ ADX/RSI ในรอบอัปเดตล่าสุด ไม่ใช่สัญญาณซื้อขาย · แตะการ์ดกลุ่มเพื่อดูรายละเอียดในแท็บ "รายการ"</p>';
  return o;
}
function regimeCard(reg) {
  var r = reg.regime;
  var emoji = r.key === "risk-on" ? "😊" : r.key === "risk-off" ? "⚠️" : "😐";
  var desc = r.key === "risk-on" ? "สินทรัพย์เสี่ยงส่วนใหญ่อยู่เหนือเส้นแนวโน้มระยะยาว" :
    r.key === "risk-off" ? "สินทรัพย์เสี่ยงส่วนใหญ่หลุดเส้นแนวโน้มระยะยาว" : "สัญญาณผสม ยังไม่ชัดไปทางใดทางหนึ่ง";
  var benchTxt = reg.benchAbove == null ? "ไม่มีข้อมูล " + esc(reg.benchT) :
    (reg.benchAbove ? '<span class="ok">✓ ' + esc(reg.benchT) + " เหนือ 200D</span>" : '<span class="no">✕ ' + esc(reg.benchT) + " ใต้ 200D</span>");
  return '<div class="regime ' + r.key + '"><div class="hd"><span class="emoji">' + emoji + '</span><span class="ttl">' + esc(r.th) + '</span>' +
    '<span class="pct">อัตราส่วนสินทรัพย์เสี่ยง<b class="num">' + (reg.pct == null ? "–" : Math.round(reg.pct) + "%") + '</b></span></div>' +
    '<p class="desc">' + desc + '</p><div class="bench">' + benchTxt + '</div></div>';
}
function quoteLine(reg) {
  var weakCount = 0;
  S.wl.groups.forEach(function (g) {
    var gs = Rules.groupSummary(g.items, S.px.symbols);
    if (gs.pctAbove200 != null && gs.pctAbove200 < 50) weakCount++;
  });
  var txt = reg.regime.key === "risk-on"
    ? (weakCount > 0 ? "ภาพรวมเป็น Risk-On แต่มี " + weakCount + " กลุ่มที่ยังอ่อนกว่าครึ่งหนึ่ง ควรเลือกเป็นรายกลุ่ม" : "ภาพรวมเป็น Risk-On และสอดคล้องกันในทุกกลุ่มหลัก")
    : reg.regime.key === "risk-off" ? "ภาพรวมเป็น Risk-Off ควรเน้นเก็บสภาพคล่องและระมัดระวังสินทรัพย์เสี่ยง"
    : "ภาพรวมยังกลางๆ รอสัญญาณที่ชัดเจนขึ้นก่อนปรับพอร์ตใหญ่";
  return '<p class="quote">' + txt + "</p>";
}

/* ---------- weekly note (มุมมอง Claude) ---------- */
function weeklyNote() {
  var w = S.an && S.an.weekly;
  if (!w) return '<div class="wnote"><div class="meta">ยังไม่มีมุมมองรายสัปดาห์จาก Claude — สั่งวิเคราะห์จาก desktop แล้วอัปเดต data/analysis.json</div></div>';
  var STMAP = {"risk-on": ["เสี่ยงได้", "on"], neutral: ["กลางๆ", "mid"], "risk-off": ["ระวัง", "off"]};
  var st = STMAP[w.stance]; var age = S.an.asof ? daysAgo(S.an.asof) : null;
  var o = '<div class="wnote"><div class="hd">' + (st ? '<span class="stance ' + st[1] + '">' + st[0] + "</span>" : "") + "<h2>" + esc(w.headline) + "</h2></div>";
  if (w.points && w.points.length) o += "<ul>" + w.points.slice(0, 3).map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>";
  o += '<div class="meta' + (age > 10 ? " old" : "") + '">มุมมอง Claude · วิเคราะห์ ' + (S.an.asof ? fmtDate(S.an.asof) : "–") + (age > 10 ? " (เก่า " + age + " วัน)" : "") + "</div></div>";
  return o;
}

/* ================= LIST (weekly groups) ================= */
function listHTML() {
  var g = findGroup(S.group);
  var list = groupItems(g);
  var o = "";
  o += '<div class="seg" role="group" aria-label="กลุ่มสินทรัพย์">' + S.wl.groups.map(function (x) {
    return '<button data-group="' + x.id + '" aria-pressed="' + (x.id === g.id) + '">' + esc(x.label) + "</button>";
  }).join("") + "</div>";

  if (g.rrg) {
    o += '<div class="seg" role="group" aria-label="มุมมอง">' +
      '<button data-gview="rrg" aria-pressed="' + (S.groupView === "rrg") + '">RRG</button>' +
      '<button data-gview="list" aria-pressed="' + (S.groupView === "list") + '">รายการ</button></div>';
  }

  if (g.rrg && S.groupView === "rrg") {
    o += '<div class="chead"><h3>ทิศทางการหมุนเวียน<span class="sub">เทียบกับ ' + esc(g.benchmark) + '</span></h3><button class="help" id="help" aria-label="อ่านกราฟนี้อย่างไร">?</button></div>';
    o += rrgSVG(list, S.sel) + movers(list);
    o += '<div class="legend">' + Object.keys(Q).map(function (k) { return '<span><i style="background:' + Q[k].hex + '"></i>' + Q[k].th + "</span>"; }).join("") + "</div>";
    o += listTable(list, g, true);
  } else {
    o += '<div class="seg" role="group" aria-label="มุมมองตาราง">' +
      '<button data-tmode="structure" aria-pressed="' + (S.tableMode === "structure") + '">โครงสร้าง</button>' +
      '<button data-tmode="return" aria-pressed="' + (S.tableMode === "return") + '">ผลตอบแทน</button></div>';
    o += listTable(list, g, false);
  }
  o += '<p class="foot">แตะแถวเพื่อดูกราฟและรายละเอียด · สถานะคำนวณจากกฎตายตัว (ดูที่ปุ่ม "?" ในหน้าภาพรวม) ไม่ใช่สัญญาณซื้อขาย</p>';
  return o;
}
function listTable(list, g, compact) {
  if (S.tableMode === "return" && !compact) return returnTable(list);
  var sorted = list.slice().sort(function (a, b) { return (b.s.r1m == null ? -1e9 : b.s.r1m) - (a.s.r1m == null ? -1e9 : a.s.r1m); });
  var o = '<div class="thead"><span></span><span style="text-align:center">RSI</span><span style="text-align:center">ADX</span><span style="text-align:center">สถานะ</span></div>';
  sorted.forEach(function (i) {
    var v = i.view && VIEW[i.view.view || i.view];
    o += '<button class="row" data-open="' + esc(i.t) + '"><span class="nm"><span class="arrow">' + trendArrow(i.trend) + '</span>' +
      '<span class="tx"><b>' + esc(i.disp) + (v ? '<span class="v ' + v.cl + '">' + v.ic + v.th + "</span>" : "") + "</b><span>" + esc(i.th) + "</span></span></span>" +
      '<span class="cell num">' + (i.s.rsi == null ? "–" : i.s.rsi.toFixed(0)) + '</span>' +
      '<span class="cell num">' + (i.s.adx == null ? "–" : i.s.adx.toFixed(0)) + '</span>' +
      "<span>" + statusChip(i.status) + "</span></button>";
  });
  return o;
}
function returnTable(list) {
  var o = '<div class="chiprow" role="group" aria-label="เลือกช่วงเวลา">' + Object.keys(PERIOD_LABEL).map(function (k) {
    return '<button data-period="' + k + '" aria-pressed="' + (S.period === k) + '">' + PERIOD_LABEL[k] + "</button>";
  }).join("") + "</div>";
  var sorted = list.slice().sort(function (a, b) { var bv = b.s[S.period], av = a.s[S.period]; return (bv == null ? -1e9 : bv) - (av == null ? -1e9 : av); });
  o += '<div class="thead retcol"><span></span><span></span><span style="text-align:right">' + PERIOD_LABEL[S.period] + "</span></div>";
  sorted.forEach(function (i) {
    var val = i.s[S.period];
    o += '<button class="row retcol" data-open="' + esc(i.t) + '"><span class="nm"><span class="arrow">' + trendArrow(i.trend) + '</span>' +
      '<span class="tx"><b>' + esc(i.disp) + "</b><span>" + esc(i.th) + "</span></span></span><span></span>" +
      '<span class="cell num" style="text-align:right;background:' + heat(val, SCALE[S.period]) + ';border-radius:6px;padding:.25rem .4rem">' + pct(val) + "</span></button>";
  });
  return o;
}

/* ---------- RRG chart (คงสูตรจาก v1) ---------- */
function rrgSVG(list, selT) {
  var pts = list.filter(function (i) { return i.rrg; }); if (!pts.length) return "";
  var W = 360, H = 300, m = 8;
  var dev = 1.2; var sel = null;
  pts.forEach(function (i) { if (i.t === selT) sel = i; dev = Math.max(dev, Math.abs(i.rrg.x - 100), Math.abs(i.rrg.y - 100)); });
  if (sel) sel.rrg.tail.forEach(function (p) { dev = Math.max(dev, Math.abs(p[0] - 100), Math.abs(p[1] - 100)); });
  var h = dev * 1.2;
  function X(v) { return m + ((v - 100) / h + 1) / 2 * (W - 2 * m); }
  function Y(v) { return m + (1 - ((v - 100) / h + 1) / 2) * (H - 2 * m); }
  var cx = X(100), cy = Y(100);
  var o = '<svg class="rrg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="กราฟ Relative Rotation">';
  o += '<rect x="' + cx + '" y="' + m + '" width="' + (W - m - cx) + '" height="' + (cy - m) + '" fill="' + Q.leading.hex + '" opacity=".07"/>' +
    '<rect x="' + cx + '" y="' + cy + '" width="' + (W - m - cx) + '" height="' + (H - m - cy) + '" fill="' + Q.weakening.hex + '" opacity=".08"/>' +
    '<rect x="' + m + '" y="' + cy + '" width="' + (cx - m) + '" height="' + (H - m - cy) + '" fill="' + Q.lagging.hex + '" opacity=".07"/>' +
    '<rect x="' + m + '" y="' + m + '" width="' + (cx - m) + '" height="' + (cy - m) + '" fill="' + Q.improving.hex + '" opacity=".07"/>' +
    '<line x1="' + cx + '" y1="' + m + '" x2="' + cx + '" y2="' + (H - m) + '" stroke="currentColor" stroke-opacity=".22"/>' +
    '<line x1="' + m + '" y1="' + cy + '" x2="' + (W - m) + '" y2="' + cy + '" stroke="currentColor" stroke-opacity=".22"/>';
  o += '<text x="' + (W - m - 4) + '" y="' + (m + 14) + '" text-anchor="end" font-size="11" font-weight="700" fill="' + Q.leading.hex + '">นำตลาด</text>' +
    '<text x="' + (W - m - 4) + '" y="' + (H - m - 6) + '" text-anchor="end" font-size="11" font-weight="700" fill="' + Q.weakening.hex + '">เริ่มอ่อน</text>' +
    '<text x="' + (m + 4) + '" y="' + (H - m - 6) + '" font-size="11" font-weight="700" fill="' + Q.lagging.hex + '">ตามหลัง</text>' +
    '<text x="' + (m + 4) + '" y="' + (m + 14) + '" font-size="11" font-weight="700" fill="' + Q.improving.hex + '">กำลังฟื้น</text>';
  if (sel) {
    var t = sel.rrg.tail, col = Q[sel.rrg.quad].hex;
    o += '<polyline points="' + t.map(function (p) { return X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1); }).join(" ") + '" fill="none" stroke="' + col + '" stroke-width="1.8" stroke-linejoin="round" opacity=".85"/>';
    t.slice(0, -1).forEach(function (p) { o += '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.6" fill="' + col + '" opacity=".6"/>'; });
  }
  var placed = [];
  var order = pts.map(function (i) { return {i: i, x: X(i.rrg.x), y: Y(i.rrg.y)}; }).sort(function (a, b) { return a.y - b.y; });
  order.forEach(function (p) {
    var lab = p.i.sh || p.i.disp; var right = p.x < W - 62;
    var lx = right ? p.x + 8 : p.x - 8, ly = p.y + 3.5, tries = 0;
    while (tries++ < 6 && placed.some(function (q) { return Math.abs(q.y - ly) < 11.5 && Math.abs(q.x - lx) < 46; })) ly += 11.5;
    placed.push({x: lx, y: ly}); p.lx = lx; p.ly = ly; p.right = right; p.lab = lab;
  });
  order.forEach(function (p) {
    var i = p.i, isSel = i.t === selT, col = Q[i.rrg.quad].hex;
    o += '<g data-t="' + esc(i.t) + '" style="cursor:pointer">' +
      '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="16" fill="transparent"/>' +
      (isSel ? '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/>' : "") +
      '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="5.5" fill="' + col + '" stroke="var(--paper)" stroke-width="1.5"/>' +
      '<text x="' + p.lx.toFixed(1) + '" y="' + p.ly.toFixed(1) + '" text-anchor="' + (p.right ? "start" : "end") + '" font-size="10.5" font-weight="' + (isSel ? 700 : 500) + '" fill="currentColor">' + esc(p.lab) + "</text></g>";
  });
  return o + "</svg>";
}
function movers(list) {
  var mv = [];
  list.forEach(function (i) {
    var t = i.rrg && i.rrg.tail; if (!t || t.length < 2) return;
    var a = quadOf(t[t.length - 2][0], t[t.length - 2][1]), b = i.rrg.quad;
    if (a !== b) mv.push({i: i, a: a, b: b});
  });
  if (!mv.length) return "";
  return '<div class="moves"><b>ย้ายโซนล่าสุด</b><br>' + mv.map(function (m) {
    return '<span class="chip"><i style="background:' + Q[m.b].hex + '"></i>' + esc(m.i.sh || m.i.disp) + " " + Q[m.a].th + "→" + Q[m.b].th + "</span>";
  }).join("") + "</div>";
}
function quadOf(x, y) { return x >= 100 ? (y >= 100 ? "leading" : "weakening") : (y < 100 ? "lagging" : "improving"); }

/* ================= DAILY ================= */
function dailyHTML() {
  var cards = S.wl.daily.map(function (it, idx) {
    var s = S.px.symbols[it.t]; if (!s) return null;
    var d = S.an && S.an.daily ? S.an.daily[it.t] : null;
    var L = Rules.levels(d, s.last);
    return {it: it, s: s, d: d, L: L, idx: idx, status: Rules.statusOf(s)};
  }).filter(Boolean);
  var rank = function (c) { return c.L && c.L.st ? {bad: 0, good: 1, warn: 2, note: 3}[c.L.st.key] : 9; };
  cards.sort(function (a, b) { return rank(a) - rank(b) || a.idx - b.idx; });
  var alerts = cards.filter(function (c) { return c.L && c.L.st; }).length;
  var o = '<div class="chead"><h3>ตัวที่ติดตาม<span class="sub">' + cards.length + " ตัว" + (alerts ? " · เตือน " + alerts : "") + '</span></h3></div>';
  cards.forEach(function (c) {
    var it = c.it, s = c.s, d = c.d, L = c.L;
    var rsi = s.rsi, rtag = rsi == null ? "" : rsi >= 70 ? '<span class="tag hot">RSI ' + rsi.toFixed(0) + ' ร้อนแรง</span>' :
      rsi <= 30 ? '<span class="tag cold">RSI ' + rsi.toFixed(0) + ' อ่อนแรง</span>' : '<span class="tag">RSI ' + rsi.toFixed(0) + '</span>';
    var adxTag = s.adx == null ? "" : '<span class="tag">ADX ' + s.adx.toFixed(0) + (s.adx < 20 ? " ไซด์เวย์" : " มีเทรนด์") + "</span>";
    var t200 = s.vs200 == null ? "" : '<span class="tag ' + (s.vs200 >= 0 ? "ok" : "hot") + '">' + (s.vs200 >= 0 ? "เหนือ" : "ใต้") + " 200D " + pct(s.vs200) + "</span>";
    var age = d && d.asof ? daysAgo(d.asof) : null;
    o += '<article class="dcard ' + (L && L.st ? L.st.key : "") + '"><div class="dtop"><div class="id"><b>' + esc(it.s || it.t) + '</b><span>' + esc(it.th) + (d && d.bias ? " · " + (d.bias === "short" ? "Short" : "Long") : "") + '</span></div>' +
      '<div class="pr"><b class="num">' + price(s.last) + '</b><span class="num ' + (s.chg >= 0 ? "up" : "down") + '">' + pct(s.chg, 2) + "</span></div></div>";
    if (L && L.st) o += '<span class="alert ' + L.st.key + '">' + L.st.th + "</span>";
    o += spark(s.spark);
    if (L) {
      var tp2Stat = L.tp2 != null ? ' · ห่าง TP2 <b>' + L.dTP2.toFixed(1) + '%</b>' : "";
      var rr2Stat = L.rr2 != null ? " (1:" + L.rr2.toFixed(1) + " ที่ TP2)" : "";
      o += levelBar(d, L, s.last) + '<div class="dstats num">ห่าง SL <b>' + L.dSL.toFixed(1) + '%</b> · ห่าง TP1 <b>' + L.dTP.toFixed(1) + '%</b>' + tp2Stat + ' · R:R <b>' + (L.rr ? "1:" + L.rr.toFixed(1) : "–") + rr2Stat + "</b></div>";
    } else {
      o += '<p class="empty">ยังไม่มี SL/TP — สั่ง Claude วิเคราะห์จาก desktop</p>';
    }
    o += '<div class="tags">' + rtag + adxTag + t200 + "</div>";
    if (d && d.note) o += '<div class="dnote">' + esc(d.note) + "</div>";
    if (d && d.asof) o += '<div class="dmeta' + (age > 7 ? " old" : "") + '">ระดับวิเคราะห์ ' + fmtDate(d.asof) + (age > 7 ? " (เก่า " + age + " วัน)" : "") + "</div>";
    o += '<button class="row" style="border:0;padding:.4rem 0 0;color:var(--gold);font-weight:600;font-size:.82rem" data-open="' + esc(it.t) + '">ดูกราฟและรายละเอียด →</button></article>';
  });
  o += '<p class="foot">สถานะเตือนคำนวณจากราคา ณ รอบอัปเดตล่าสุด (ไม่ใช่เรียลไทม์) · ราคาเช้า/เย็นอัปเดตอัตโนมัติ ส่วน SL/TP มาจากการวิเคราะห์บน desktop</p>';
  return o;
}
/* ================= ACCUMULATE (สะสมระยะยาว: Trend Status + Accumulation Action) =================
 * Trend  (MA200=regime, MA50=เทรนด์ระยะกลาง)  ตอบ "ตลาดอยู่ในโครงสร้างแบบไหน?"
 * Action (โซน MA100 ถูกครอบด้วย Trend เสมอ)   ตอบ "ตอนนี้ควรทำอย่างไร?"
 * ตรรกะทั้งหมดอยู่ใน rules.js (SSOT) — ไฟล์นี้แสดงผลอย่างเดียว ห้ามคำนวณซ้ำ */
var ACCUM_SORT_RANK = {pause: 0, increase: 1, scaledIn: 2, wait: 3, normal: 4, unknown: 5};
function accumCardsOf() {
  var list = S.wl.accumulate || [];
  return list.map(function (it, idx) {
    var s = S.px.symbols[it.t]; if (!s) return null;
    var trend = Rules.getTrendStatus(s), zone = Rules.getAccumulationZone(s);
    return {it: it, s: s, idx: idx, trend: trend, zone: zone, action: Rules.getAccumulationAction(trend, zone), adxS: Rules.getADXStrength(s.adx)};
  }).filter(Boolean);
}
function accumActionClass(a) { return {wait: "note", normal: "good", increase: "gold", scaledIn: "warn", pause: "bad"}[a.key] || ""; }
function trendBadge(trend) { return '<span class="trendbadge ' + trend.key + '">' + (trend.arrow ? trend.arrow + " " : "") + esc(trend.th) + "</span>"; }
function accumHTML() {
  var list = S.wl.accumulate || [];
  var cards = accumCardsOf();
  cards.sort(function (a, b) { return ACCUM_SORT_RANK[a.action.key] - ACCUM_SORT_RANK[b.action.key] || a.idx - b.idx; });
  var alerts = cards.filter(function (c) { return c.action.key === "pause" || c.action.key === "increase" || c.action.key === "scaledIn"; }).length;
  var o = '<div class="chead"><h3>สะสมระยะยาว<span class="sub">' + cards.length + " ตัว" + (alerts ? " · น่าสนใจ " + alerts : "") + '</span></h3>' +
    '<button class="help" data-accum-glossary="1" aria-label="คำอธิบายตัวชี้วัด">?</button></div>';
  if (!list.length) {
    o += '<p class="empty">ยังไม่มีรายการ — เพิ่มตัวที่จะสะสมได้ที่ watchlist.json → "accumulate"</p>';
  }
  cards.forEach(function (c) {
    var it = c.it, s = c.s, trend = c.trend, zone = c.zone, action = c.action, adxS = c.adxS;
    var rows = [
      {lbl: "MA50", v: s.vs50},
      {lbl: "MA100", v: s.vs100, hit: zone.key === "C"},
      {lbl: "MA200", v: s.vs200},
    ];
    o += '<article class="dcard ' + (trend.key === "red" ? "bad" : trend.key === "yellow" ? "warn" : "") + '">' +
      '<div class="dtop"><div class="id"><b>' + esc(it.s || it.t) + '</b><span>' + esc(it.th) + '</span></div>' +
      '<div class="pr"><b class="num">' + price(s.last) + '</b><span class="num ' + (s.chg >= 0 ? "up" : "down") + '">' + pct(s.chg, 2) + "</span></div></div>";
    o += '<div class="trendrow">' + trendBadge(trend) + '<span class="alert ' + accumActionClass(action) + '">' + esc(action.th) + "</span></div>";
    o += spark(s.spark);
    o += '<div class="malines">' + rows.map(function (r) {
      return '<div class="maline' + (r.hit ? " hit" : "") + '"><span>' + r.lbl + "</span><b class=\"num\">" + (r.v == null ? "–" : pct(r.v)) + "</b></div>";
    }).join("") + "</div>";
    var adxTxt = s.adx == null ? "ADX –" : "ADX " + s.adx.toFixed(1) + " (" + adxS.th + ")";
    o += '<div class="accummeta">' + (s.vs100 == null ? "" : "ห่าง MA100 " + pct(s.vs100) + " · ") + adxTxt + "</div>";
    o += '<button class="row" style="border:0;padding:.4rem 0 0;color:var(--gold);font-weight:600;font-size:.82rem" data-open="' + esc(it.t) + '">ดูกราฟและรายละเอียด →</button></article>';
  });
  o += '<p class="foot">Trend (MA200/MA50) บอกโครงสร้างระยะยาว · Zone (MA100) บอกจังหวะเข้า · Action = Zone ที่ถูก Trend ครอบเพดานไว้เสมอ (หลุด MA200 = ชะลอทุกกรณี) — คำนวณจากราคาจริงอัตโนมัติ ไม่ใช่คำแนะนำการลงทุน</p>';
  return o;
}

/* ---- accumulate: คำอธิบาย "ทำไม" สำหรับหน้า Detail ---- */
function accumTrendReason(trend) {
  return {
    green: "ราคายังอยู่เหนือ MA50 และ MA200",
    yellow: "ราคายังอยู่เหนือ MA200 แต่ต่ำกว่า MA50 — โมเมนตัมระยะกลางเริ่มอ่อน",
    red: "ราคาหลุดต่ำกว่า MA200 — โครงสร้างระยะยาวเริ่มเสีย",
    unknown: "ข้อมูลไม่พอสำหรับประเมินเทรนด์",
  }[trend.key];
}
function accumZoneReason(zone) {
  return {
    A: "ราคาสูงกว่า MA100 (จุดอ้างอิงสะสม) มากแล้ว",
    B: "ห่างจาก MA100 อยู่ในระดับปกติ",
    C: "ราคาเข้าใกล้ MA100 แล้ว",
    D: "ราคาหลุดต่ำกว่า MA100 แล้ว",
    E: "ราคาต่ำกว่า MA100 ค่อนข้างมาก",
    unknown: "ข้อมูลไม่พอสำหรับประเมินโซนสะสม",
  }[zone.key];
}
function accumExplain(trend, zone, action) {
  if (trend.key === "unknown" || zone.key === "unknown") return "ข้อมูลไม่พอสำหรับสรุปคำแนะนำ";
  if (trend.key === "red") return "ราคาหลุดต่ำกว่า MA200 — โครงสร้างระยะยาวเริ่มเสีย ชะลอการเพิ่มน้ำหนัก รอ Trend กลับมาชัดเจนก่อน";
  var tail = action.key === "increase" ? " จึงพิจารณาเพิ่มน้ำหนักสะสมได้"
    : action.key === "wait" ? " จึงยังไม่เร่งเข้า รอราคาย่อลงมาใกล้ MA100 ก่อน" : "";
  return accumTrendReason(trend) + " " + accumZoneReason(zone) + tail;
}
function accumSummaryBullets(trend, zone, action) {
  if (trend.key === "red") return ["โครงสร้างระยะยาวเริ่มเสีย", "ชะลอการเพิ่มน้ำหนัก", "รอ Trend กลับมาชัดเจน"];
  var b = ["ตั้งใจลงทุนระยะยาว (RMF / Long-term Growth)", trend.key === "yellow" ? "แนวโน้มระยะกลางเริ่มอ่อนตัว ระยะยาวยังไม่เสีย" : "แนวโน้มหลักยังเป็นขาขึ้น", action.th];
  if (zone.key !== "C" && zone.key !== "D") b.push("พิจารณาเพิ่มน้ำหนักเมื่อราคาเข้าใกล้ MA100");
  return b;
}
function accumDecisionHTML(c) {
  var trend = c.trend, zone = c.zone, action = c.action;
  var o = '<div class="sectionhd"><h2>สรุปการตัดสินใจ</h2><button class="help" data-accum-glossary="1" aria-label="คำอธิบายตัวชี้วัด">?</button></div>';
  o += '<div class="accumdecision"><div class="trendrow">' + trendBadge(trend) + '<span class="alert ' + accumActionClass(action) + '">' + esc(action.th) + "</span></div>" +
    '<p class="accumexplain">' + esc(accumExplain(trend, zone, action)) + "</p></div>";
  return o;
}
function accumKpiHTML(c, ser) {
  var s = c.s;
  function maVal(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
  var m50 = ser ? maVal(ser.m50) : null, m100 = ser ? maVal(ser.m100) : null, m200 = ser ? maVal(ser.m200) : null;
  var rows = [
    {lbl: "MA50", v: m50, d: s.vs50, hit: false},
    {lbl: "MA100 ★", v: m100, d: s.vs100, hit: c.zone.key === "C"},
    {lbl: "MA200", v: m200, d: s.vs200, hit: false},
  ];
  var o = '<div class="malines compact">' + rows.map(function (r) {
    return '<div class="maline' + (r.hit ? " hit" : "") + '"><span>' + r.lbl + '</span><b class="num">' + (r.v == null ? "–" : price(r.v)) + '</b>' +
      '<span class="num ' + (r.d >= 0 ? "up" : "down") + '" style="display:block;font-size:.68rem">' + (r.d == null ? "" : pct(r.d)) + "</span></div>";
  }).join("") + "</div>";
  var macdOk = s.macd != null && s.macdSignal != null;
  o += '<div class="gauges compact' + (macdOk ? " g3" : "") + '">' +
    gauge("RSI", s.rsi, 0, 100, [[0, 30, "var(--weak)"], [30, 70, "var(--strong)"], [70, 100, "var(--weak)"]], "เสริม ไม่ใช่สัญญาณ") +
    gauge("ADX", s.adx, 0, 50, [[0, 20, "var(--sideways)"], [20, 50, "var(--strong)"]], c.adxS.th);
  if (macdOk) {
    o += '<div class="gauge"><small>MACD</small><b class="num ' + (s.macd >= s.macdSignal ? "up" : "down") + '">' + s.macd.toFixed(2) + '</b>' +
      '<div class="rng"><span>Signal ' + s.macdSignal.toFixed(2) + '</span></div></div>';
  }
  o += "</div>";
  return o;
}
function accumSummaryHTML(c) {
  var bullets = accumSummaryBullets(c.trend, c.zone, c.action);
  return '<div class="accumsummary"><h4>🎯 แนวทางการสะสม</h4><ul>' + bullets.map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ul></div>";
}
function accumGlossarySheet() {
  var TH = Rules.ACCUM_THRESHOLDS, AD = Rules.ADX_THRESHOLDS;
  var o = '<h3>คำอธิบาย — แท็บสะสมระยะยาว</h3><p class="sub">เตือนว่าตัวเลขมาจากอะไร และตีความอย่างไร ใช้สำหรับพอร์ตสะสม/RMF ไม่ใช่สัญญาณเทรด</p>';
  o += '<div class="rulebox"><h4><i style="background:var(--strong)"></i>↗ ขาขึ้น (Uptrend)</h4><ul>' +
    "<li>แนวโน้มหลักยังเป็นบวก ราคาและเส้นค่าเฉลี่ยสนับสนุนโครงสร้างขาขึ้น</li><li>แนวทางทั่วไป: สะสมตามแผน</li></ul></div>";
  o += '<div class="rulebox"><h4><i style="background:var(--caution)"></i>≈ อ่อนตัว (Weakening)</h4><ul>' +
    "<li>แนวโน้มระยะยาวอาจยังไม่เสีย แต่แนวโน้มระยะกลางกำลังอ่อนลง</li><li>แนวทางทั่วไป: รอจังหวะ / สะสมอย่างระมัดระวัง</li></ul></div>";
  o += '<div class="rulebox"><h4><i style="background:var(--weak)"></i>↘ ขาลง (Downtrend)</h4><ul>' +
    "<li>โครงสร้างระยะยาวอ่อนแอลงอย่างมีนัยสำคัญ โดยเฉพาะเมื่อราคาหลุด MA200</li><li>แนวทางทั่วไป: ยังไม่เร่งสะสม</li></ul></div>";
  o += '<div class="rulebox"><h4>เส้นค่าเฉลี่ย (Moving Averages)</h4><ul>' +
    '<li><b>MA50</b> = เทรนด์ระยะกลาง ใช้ดูทิศทางแนวโน้มระยะกลาง</li>' +
    '<li><b>MA100</b> = จุดอ้างอิงสะสม ใช้เป็นจุดอ้างอิงสำหรับ "สะสมตอนย่อ"</li>' +
    "<li><b>MA200</b> = โครงสร้างระยะยาว ใช้ดูว่าแนวโน้มระยะยาวยังเป็นขาขึ้นหรือเริ่มเปลี่ยน regime</li></ul></div>";
  o += '<div class="rulebox"><h4>% ระยะห่างจากเส้นค่าเฉลี่ย</h4>' +
    '<p class="sub">สูตร: (ราคาปัจจุบัน / เส้นค่าเฉลี่ย − 1) × 100 — เช่น "MA100 +3.1%" หมายถึงราคาอยู่ <b>เหนือ</b> MA100 อยู่ 3.1% ค่าเป็นบวก = ราคาอยู่เหนือเส้น ค่าเป็นลบ = ราคาอยู่ต่ำกว่าเส้น</p></div>';
  o += '<div class="rulebox"><h4>โซนสะสม (อิง MA100)</h4><table class="zonetable"><tbody>' +
    "<tr><td>&gt; +" + TH.extended + "%</td><td>สูงกว่าโซนสะสมมาก</td><td>รอจังหวะย่อ</td></tr>" +
    "<tr><td>+" + TH.normal + "% – +" + TH.extended + "%</td><td>Trend ปกติ</td><td>สะสมตามแผน</td></tr>" +
    "<tr><td>" + TH.nearMA + "% – +" + TH.normal + "%</td><td>เข้าใกล้ MA100</td><td>เพิ่มน้ำหนักสะสม</td></tr>" +
    "<tr><td>" + TH.deepPullback + "% – " + TH.nearMA + "%</td><td>หลุด MA100</td><td>สะสมแบบแบ่งไม้ / ตรวจ Trend</td></tr>" +
    "<tr><td>&lt; " + TH.deepPullback + "%</td><td>ระวังแนวโน้มเปลี่ยน</td><td>ชะลอ / รอความชัดเจน</td></tr></tbody></table>" +
    '<p class="sub">ระดับดังกล่าวเป็นเกณฑ์เริ่มต้นของระบบ และสามารถปรับจากผล Backtest ในอนาคต — หากเทรนด์ (MA200/MA50) ไม่ดี การกระทำจะถูกลดระดับหรือ "ชะลอ" เสมอ ไม่ว่าโซนจะดูน่าดึงดูดแค่ไหน</p></div>';
  o += '<div class="rulebox"><h4>ADX — ความแรงของเทรนด์</h4>' +
    '<p class="sub">ADX วัด<b>ความแรง</b>ของเทรนด์ ไม่บอกทิศทาง — ADX สูง ≠ ตลาดขาขึ้น (เกิดได้ทั้งขาขึ้นและขาลง)</p><ul>' +
    "<li>ADX &lt; " + AD.weak + " — แนวโน้มอ่อน / Sideway</li>" +
    "<li>ADX " + AD.weak + "–" + AD.emerging + " — เริ่มมีแนวโน้ม</li>" +
    "<li>ADX &gt; " + AD.emerging + " — แนวโน้มชัดเจน</li>" +
    "<li>ADX &gt; " + AD.strong + " — แนวโน้มแข็งแรง</li></ul></div>";
  o += '<div class="rulebox"><h4>RSI</h4><p class="sub">เป็นตัวชี้วัดโมเมนตัมเสริม ไม่ใช่สัญญาณซื้อ/ขายอัตโนมัติ (ไม่ใช่ว่า RSI&gt;70 ต้องขาย หรือ RSI&lt;30 ต้องซื้อ) — ใช้เป็นบริบทประกอบเท่านั้น</p></div>';
  o += '<div class="rulebox"><h4>MACD (12,26,9)</h4><p class="sub">ใช้ประเมินโมเมนตัมและการเปลี่ยนโมเมนตัม — MACD &gt; Signal สนับสนุนโมเมนตัมบวก, MACD &lt; Signal สนับสนุนโมเมนตัมอ่อนลง เป็นหลักฐานสนับสนุนเท่านั้น ไม่ override โครงสร้าง MA ระยะยาว</p></div>';
  o += '<div class="banner" style="margin-top:.6rem">เกณฑ์นี้เป็นแนวทางการวิเคราะห์ของเราเอง เพื่อช่วยการสะสมระยะยาว (RMF/Long-term Growth) ไม่ใช่สัญญาณซื้อขาย</div>';
  openSheet(o);
}
function spark(arr) {
  if (!arr || arr.length < 2) return "";
  var mn = Math.min.apply(null, arr), mx = Math.max.apply(null, arr), W = 300, H = 40, rng = mx - mn || 1;
  var p = arr.map(function (v, i) { return (i / (arr.length - 1) * W).toFixed(1) + "," + (H - 3 - (v - mn) / rng * (H - 6)).toFixed(1); }).join(" ");
  var up = arr[arr.length - 1] >= arr[0];
  return '<svg class="spark" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + p + '" fill="none" stroke="' + (up ? "var(--strong)" : "var(--weak)") + '" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>';
}
/** แผนเทรด SL/TP — แถบแนวตั้งกะทัดรัด: SL ล่าง, Entry, TP1/TP2 บน (short จะกลับด้าน)
 *  จุดเขียว = โซนกำไรของฝั่งที่เข้า, จุดแดง = โซนความเสี่ยง — ใช้สีล้วนๆ ไม่ใส่ label ซ้อน */
function levelBar(d, L, last) {
  var pts = [d.sl, L.tp1]; if (L.tp2 != null) pts.push(L.tp2);
  var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts), rng = hi - lo || 1;
  function pos(p) { return Math.max(0, Math.min(1, (p - lo) / rng)) * 100; }
  var eB = pos(L.entry);
  var bottomCls = L.long ? "seg-r" : "seg-g", topCls = L.long ? "seg-g" : "seg-r";
  function row(cls, txt, v, b) {
    return '<div class="lvrow ' + cls + '" style="bottom:' + b.toFixed(2) + '%"><i></i><b>' + txt + '</b><span class="num">' + price(v) + '</span></div>';
  }
  var rows = row("sl", "SL", d.sl, pos(d.sl)) + row("entry", "Entry", L.entry, eB) + row("tp tp1", "TP1", L.tp1, pos(L.tp1));
  if (L.tp2 != null) rows += row("tp tp2", "TP2", L.tp2, pos(L.tp2));
  return '<div class="lv"><div class="lvbox">' +
    '<div class="lvtrack"><span class="' + bottomCls + '" style="height:' + eB.toFixed(2) + '%"></span>' +
    '<span class="' + topCls + '" style="height:' + (100 - eB).toFixed(2) + '%;bottom:' + eB.toFixed(2) + '%"></span></div>' +
    '<span class="lvnow" style="bottom:' + pos(last).toFixed(2) + '%"></span>' + rows + "</div></div>";
}

/* ================= DETAIL (เต็มจอ) ================= */
var DET_PERIODS = {"1m": 21, "3m": 63, "6m": 126, "1y": 252, all: 300};
function findItemMeta(t) {
  var meta = null;
  S.wl.groups.forEach(function (g) { g.items.forEach(function (it) { if (it.t === t && !meta) meta = Object.assign({groupId: g.id, group: g}, it); }); });
  if (!meta) S.wl.daily.forEach(function (it) { if (it.t === t && !meta) meta = Object.assign({groupId: null, group: null}, it); });
  if (!meta) (S.wl.accumulate || []).forEach(function (it) { if (it.t === t && !meta) meta = Object.assign({groupId: null, group: null}, it); });
  return meta;
}
function detailHTML(t) {
  var s = S.px.symbols[t]; if (!s) return '<p class="empty">ไม่พบข้อมูล</p>';
  var meta = findItemMeta(t) || {t: t, th: t, en: t};
  var disp = meta.s || t;
  // "สรุปการตัดสินใจ" + KPI สะสม แสดงเฉพาะเมื่อเปิดจากแท็บ "สะสม" เท่านั้น (ไม่แตะหน้า Detail ของ "รายวัน")
  var isAccum = S.from === "accum";
  var ac = null;
  if (isAccum) {
    var trend = Rules.getTrendStatus(s), zone = Rules.getAccumulationZone(s);
    ac = {s: s, trend: trend, zone: zone, action: Rules.getAccumulationAction(trend, zone), adxS: Rules.getADXStrength(s.adx)};
  }
  var o = '<div class="dethead"><div class="nm">' + esc(disp) + '</div><div class="sub">' + esc(meta.th || "") + (meta.en ? " · " + esc(meta.en) : "") + "</div></div>";
  o += '<div class="detprice"><b class="num">' + price(s.last) + '</b><span class="num ' + (s.chg >= 0 ? "up" : "down") + '">' + pct(s.chg, 2) + '</span></div>';

  if (ac) o += accumDecisionHTML(ac);

  var ser = S.series && S.series.series ? S.series.series[t] : null;
  if (ser) {
    o += '<div class="periods">' + Object.keys(DET_PERIODS).map(function (k) {
      return '<button data-detp="' + k + '" aria-pressed="' + (S.detPeriod === k) + '">' + k.toUpperCase() + "</button>";
    }).join("") + "</div>";
    o += lineChart(ser, DET_PERIODS[S.detPeriod]);
    o += '<div class="chartlegend"><span><i style="background:currentColor"></i>ราคาปิด</span><span><i style="background:var(--ma50)"></i>MA50</span><span><i style="background:var(--ma100)"></i>MA100 (อ้างอิงสะสม)</span><span><i style="background:var(--ma200)"></i>MA200</span></div>';
  }

  if (ac) {
    o += accumKpiHTML(ac, ser);
  } else {
    o += '<div class="gauges">' + gauge("RSI (14)", s.rsi, 0, 100, [[0, 30, "var(--weak)"], [30, 70, "var(--strong)"], [70, 100, "var(--weak)"]], s.rsi == null ? "" : s.rsi >= 70 ? "โมเมนตัมร้อนแรง" : s.rsi <= 30 ? "โมเมนตัมอ่อนแรง" : "โมเมนตัมปกติ") +
      gauge("ADX (14)", s.adx, 0, 50, [[0, 20, "var(--sideways)"], [20, 50, "var(--strong)"]], s.adx == null ? "" : s.adx < 20 ? "ไม่มีเทรนด์ชัดเจน" : "มีเทรนด์ชัดเจน") + "</div>";
  }

  // RRG / Elliott Wave / มุมมองสัปดาห์ / แผนเทรด SL-TP เป็นข้อมูลฝั่งเทรดระยะสั้น
  // ไม่ใช่ตัวตัดสินใจหลักของการสะสมระยะยาว — เมื่อเปิดจากแท็บ "สะสม" จะพับไว้ใต้ "ดูข้อมูลเพิ่มเติม"
  // (ไม่ตัดทิ้ง แค่ไม่บังคับให้ทุกคนเลื่อนผ่าน — ใครอยากอ่านลึกกดดูได้เสมอ)
  var extraLabels = [], extraHtml = "";
  if (meta.group && meta.group.rrg && s.rrg_by && s.rrg_by[meta.group.benchmark]) {
    var r = s.rrg_by[meta.group.benchmark];
    extraLabels.push("RRG");
    extraHtml += '<div class="viewbox"><span class="lbl">ตำแหน่งใน RRG (เทียบ ' + esc(meta.group.benchmark) + ')</span><br>' +
      '<span class="chip"><i style="background:' + Q[r.quad].hex + '"></i>' + Q[r.quad].th + '</span> RS-Ratio ' + r.x.toFixed(2) + ' · RS-Momentum ' + r.y.toFixed(2) + '</div>';
  }

  var wv = S.an && S.an.waves ? S.an.waves[t] : null;
  if (wv) extraLabels.push("Elliott Wave");
  extraHtml += waveBox(wv);

  var view = S.an && S.an.weekly && S.an.weekly.views ? S.an.weekly.views[t] : null;
  if (view) {
    var v = VIEW[view.view || view];
    extraLabels.push("มุมมองสัปดาห์");
    extraHtml += '<div class="viewbox"><span class="lbl">มุมมองสัปดาห์ (Claude)</span><br><b class="' + (v ? v.cl : "") + '">' + (v ? v.ic + " " + v.th : "–") + '</b>' + (view.note ? " — " + esc(view.note) : "") + "</div>";
  }

  var d = S.an && S.an.daily ? S.an.daily[t] : null;
  var L = Rules.levels(d, s.last);
  if (L) {
    var age = d.asof ? daysAgo(d.asof) : null;
    extraLabels.push("SL/TP");
    extraHtml += '<div class="sectionhd"><h2>แผนเทรด (SL/TP)</h2></div><div class="plan">' + levelBar(d, L, s.last) +
      '<div class="dstats num">ห่าง SL <b>' + L.dSL.toFixed(1) + '%</b> · ห่าง TP <b>' + L.dTP.toFixed(1) + '%</b> · R:R <b>' + (L.rr ? "1:" + L.rr.toFixed(1) : "–") + '</b></div>' +
      (d.note ? '<div class="dnote">' + esc(d.note) + '</div>' : "") +
      '<div class="dmeta' + (age > 7 ? " old" : "") + '">ระดับวิเคราะห์ ' + fmtDate(d.asof) + (age > 7 ? " (เก่า " + age + " วัน)" : "") + '</div></div>';
  }

  if (ac) {
    // แท็บสะสม: สรุปสั้นด้านบนก่อน แล้วค่อยพับรายละเอียดเสริมไว้ให้กดเปิดเอง
    o += accumSummaryHTML(ac);
    if (extraHtml) {
      o += '<details class="moreinfo"><summary>ดูข้อมูลเพิ่มเติม · ' + esc(extraLabels.join(" · ")) + '</summary><div class="moreinfo-body">' + extraHtml + "</div></details>";
    }
  } else {
    o += extraHtml;
  }

  o += '<p class="foot">ข้อมูลราคาถึง ' + fmtDate(s.asof) + ' · ตัวชี้วัดทั้งหมดเป็นข้อมูลเชิงโครงสร้าง ไม่ใช่สัญญาณซื้อขาย</p>';
  return o;
}
function gauge(label, val, lo, hi, zones, sub) {
  var pos = val == null ? null : Math.max(0, Math.min(100, (val - lo) / (hi - lo) * 100));
  var zonesHtml = zones.map(function (z) { var w = (z[1] - z[0]) / (hi - lo) * 100; return '<span style="flex:0 0 ' + w + '%;background:' + z[2] + ';opacity:.35"></span>'; }).join("");
  return '<div class="gauge"><small>' + label + '</small><b class="num">' + (val == null ? "–" : val.toFixed(1)) + '</b>' +
    '<div class="track"><span class="zones">' + zonesHtml + '</span>' + (pos == null ? "" : '<i style="left:' + pos + '%"></i>') + '</div>' +
    '<div class="rng"><span>' + lo + '</span><span>' + hi + '</span></div>' + (sub ? '<div class="rng" style="margin-top:.3rem;color:var(--muted)">' + sub + '</div>' : "") + '</div>';
}
function waveBox(wv) {
  if (!wv) return "";
  var age = wv.asof ? daysAgo(wv.asof) : null;
  var chain = [1, 2, 3, 4, 5].map(function (n) {
    return '<span class="nd' + (n === wv.current ? " now" : "") + '">' + n + "</span>" + (n < 5 ? '<span class="ln"></span>' : "");
  }).join("");
  var o = '<div class="sectionhd"><h2>Elliott Wave (ความเห็น)</h2></div><div class="wavewrap">' +
    '<div class="wavemeta">คลื่นปัจจุบัน: <b>Wave ' + wv.current + '</b>' + (wv.alt ? " · ทางเลือก: Wave " + wv.alt + " (alt)" : "") + '</div>' +
    '<div class="wavechain">' + chain + "</div>";
  if (wv.keyLevel) o += '<div class="wavemeta">จุดเปลี่ยนสำคัญ: <b class="num">' + price(wv.keyLevel.price) + "</b>" + (wv.keyLevel.note ? " — " + esc(wv.keyLevel.note) : "") + "</div>";
  if (wv.note) o += '<div class="wavemeta">' + esc(wv.note) + "</div>";
  o += '<div class="wavemeta' + (age > 10 ? " old" : "") + '">ความเห็น ณ วันที่ ' + fmtDate(wv.asof) + (age > 10 ? " (เก่า " + age + " วัน)" : "") + '</div>' +
    '<div class="disclaim"><span class="ic">⚠️</span><span>นี่เป็นมุมมองเชิงวิจารณญาณ ไม่ใช่สัญญาณซื้อขาย โปรดใช้ดุลยพินิจและบริหารความเสี่ยงเสมอ</span></div></div>';
  return o;
}
function lineChart(ser, n) {
  var d = ser.d.slice(-n), c = ser.c.slice(-n), m50 = ser.m50.slice(-n), m200 = ser.m200.slice(-n);
  var m100 = (ser.m100 || []).slice(-n);
  var all = c.concat(m50.filter(function (v) { return v != null; })).concat(m200.filter(function (v) { return v != null; }));
  var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all), rng = mx - mn || 1;
  var W = 340, H = 170, pad = 4;
  function X(i) { return pad + (i / (c.length - 1)) * (W - 2 * pad); }
  function Y(v) { return pad + (1 - (v - mn) / rng) * (H - 2 * pad); }
  function line(arr, stroke, dash, width) {
    var pts = [];
    arr.forEach(function (v, i) { if (v != null) pts.push(X(i).toFixed(1) + "," + Y(v).toFixed(1)); });
    if (!pts.length) return "";
    var w = width != null ? width : (dash ? 1.3 : 1.8);
    return '<polyline points="' + pts.join(" ") + '" fill="none" stroke="' + stroke + '" stroke-width="' + w + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : "") + ' stroke-linecap="round" vector-effect="non-scaling-stroke"/>';
  }
  var o = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="กราฟราคาพร้อมเส้นค่าเฉลี่ย">';
  // MA200/MA50 หนาเท่ากันเพื่อเน้นโครงสร้างหลัก (ส้ม/เขียวเข้ม) · MA100 (เหลืองเข้ม) เป็นเส้นประจุดอ้างอิงสะสม · ราคาปิดวาดทับบนสุด
  o += line(m200, "var(--ma200)", null, 2.4) + line(m100, "var(--ma100)", "3,2") + line(m50, "var(--ma50)", null, 2.4) + line(c, "currentColor");
  o += '<text x="' + pad + '" y="' + (H - 4) + '" font-size="9" fill="currentColor" opacity=".55">' + fmtDate(d[0]) + '</text>';
  o += '<text x="' + (W - pad) + '" y="' + (H - 4) + '" font-size="9" text-anchor="end" fill="currentColor" opacity=".55">' + fmtDate(d[d.length - 1]) + '</text>';
  return o + "</svg>";
}

/* ---------- sheets: RRG help + เกณฑ์การประเมิน ---------- */
function openSheet(html) { $("#pane").innerHTML = html + '<button class="close" id="closeSheet">ปิด</button>'; $("#sheet").hidden = false; }
function closeSheet() { $("#sheet").hidden = true; }
function explainSheet() {
  openSheet('<h3>อ่านกราฟนี้อย่างไร</h3>' +
    '<p>แต่ละจุดคือสินทรัพย์เทียบกับตัวเปรียบเทียบ (US = SPY, ประเทศ = ACWI) · <b>แนวนอน</b> = แรงเทียบตลาด ขวาคือดีกว่าตลาด · <b>แนวตั้ง</b> = โมเมนตัม บนคือกำลังเร่งขึ้น</p>' +
    '<ul class="qlist">' +
    '<li><i style="background:' + Q.improving.hex + '"></i><span><b>กำลังฟื้น</b> ยังตามตลาด แต่โมเมนตัมเริ่มดีขึ้น</span></li>' +
    '<li><i style="background:' + Q.leading.hex + '"></i><span><b>นำตลาด</b> ทั้งแรงและโมเมนตัมดี</span></li>' +
    '<li><i style="background:' + Q.weakening.hex + '"></i><span><b>เริ่มอ่อน</b> ยังนำอยู่ แต่โมเมนตัมชะลอ</span></li>' +
    '<li><i style="background:' + Q.lagging.hex + '"></i><span><b>ตามหลัง</b> อ่อนกว่าตลาดและโมเมนตัมลบ</span></li></ul>' +
    '<p>ปกติหมุนตามเข็มนาฬิกา: กำลังฟื้น → นำตลาด → เริ่มอ่อน → ตามหลัง · หางคือตำแหน่ง 5 สัปดาห์ล่าสุด (แตะจุดเพื่อดู)</p>' +
    '<p class="sub">คำนวณรายสัปดาห์ด้วย z-score ให้ผลใกล้เคียงแนวคิด Relative Rotation แต่ไม่ใช่สูตรต้นฉบับ (JdK) ใช้ดูโมเมนตัมสัมพัทธ์ ไม่ใช่สัญญาณซื้อขาย</p>');
}
function criteriaSheet(tab) {
  tab = tab || "status";
  var onPct = (S.wl.regime && S.wl.regime.riskOnPct) || 60, offPct = (S.wl.regime && S.wl.regime.riskOffPct) || 40;
  var o = '<h3>เกณฑ์การประเมินสถานะ</h3><p class="sub">เกณฑ์เหล่านี้เป็นแนวทางการวิเคราะห์ของเราเอง ช่วยให้เห็นภาพรวมของตลาด ไม่ใช่สัญญาณซื้อขาย</p>';
  o += '<div class="tabbtn"><button data-crit="status" aria-pressed="' + (tab === "status") + '">กฎการให้จุดสถานะ</button><button data-crit="regime" aria-pressed="' + (tab === "regime") + '">กฎ Risk-On/Off</button></div>';
  if (tab === "status") {
    o += '<div class="rulebox"><h4><i style="background:var(--weak)"></i>อ่อนแอ</h4><ul><li>ราคาต่ำกว่า 200D และ RSI &lt; 45</li></ul></div>' +
      '<div class="rulebox"><h4><i style="background:var(--sideways)"></i>ไซด์เวย์</h4><ul><li>ADX &lt; 20 (ไม่มีเทรนด์ชัดเจน)</li></ul></div>' +
      '<div class="rulebox"><h4><i style="background:var(--strong)"></i>แข็งแรง</h4><ul><li>สูงกว่า 50D และ 200D</li><li>RSI 50–70</li><li>ADX ≥ 20</li></ul></div>' +
      '<div class="rulebox"><h4><i style="background:var(--caution)"></i>ระวัง</h4><ul><li>RSI &gt; 70 หรือสัญญาณผสม (กรณีไม่เข้าเกณฑ์ข้อ 1–3)</li></ul></div>' +
      '<p class="sub">ตรวจตามลำดับ: อ่อนแอ → ไซด์เวย์ → แข็งแรง → ระวัง</p>';
  } else {
    o += '<div class="rulebox"><h4><i style="background:var(--strong)"></i>Risk-On</h4><ul><li>สินทรัพย์เสี่ยง (หุ้น/สินค้าโภคภัณฑ์/คริปโต) เหนือ 200D ≥ ' + onPct + '%</li><li>และ ' + esc((S.wl.regime || {}).benchmarkForRegime || "SPY") + ' เหนือ 200D</li></ul></div>' +
      '<div class="rulebox"><h4><i style="background:var(--caution)"></i>Neutral</h4><ul><li>อยู่ระหว่าง ' + offPct + '% – ' + onPct + '%</li></ul></div>' +
      '<div class="rulebox"><h4><i style="background:var(--weak)"></i>Risk-Off</h4><ul><li>สินทรัพย์เสี่ยงเหนือ 200D ≤ ' + offPct + '%</li><li>หรือ ' + esc((S.wl.regime || {}).benchmarkForRegime || "SPY") + ' หลุด 200D</li></ul></div>' +
      '<p class="sub">ตราสารหนี้และดัชนีดอลลาร์ไม่ถูกนับในสัดส่วนนี้ เพราะมักสวนทางกับสินทรัพย์เสี่ยง</p>';
  }
  o += '<div class="banner" style="margin-top:.6rem">เกณฑ์นี้เป็นแนวทางการวิเคราะห์ของเราเอง เพื่อช่วยให้เห็นภาพรวมของตลาด ไม่ใช่สัญญาณซื้อขาย</div>';
  openSheet(o);
}

/* ================= router / render ================= */
function render() {
  document.querySelectorAll(".nav button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.tab === (S.screen === "detail" ? S.from : S.screen)); });
  var main = $("#main");
  if (!S.px) return;
  // banner นี้บอกเฉพาะสถานะ "ราคา" เท่านั้น — สถานะ "มุมมองวิเคราะห์" (analysis.json) มีป้ายของตัวเองใน weeklyNote()/waveBox()/SL-TP
  // เพราะราคาจะกลายเป็นของจริงก่อนเสมอ (อัตโนมัติ) ส่วนการวิเคราะห์รอ Claude แยกต่างหาก การรวมเงื่อนไขไว้ที่เดียวทำให้ banner นี้ค้างแสดงแม้ราคาจริงเข้ามาแล้ว
  var banner = (S.px.demo ? '<div class="banner">ราคายังเป็นข้อมูลตัวอย่าง — จะถูกแทนที่เมื่อรัน GitHub Actions ครั้งแรก</div>' : "") +
    (S.px.failed && S.px.failed.length ? '<div class="banner">ดึงราคาไม่ได้: ' + esc(S.px.failed.join(", ")) + '</div>' : "");

  if (S.screen === "overview") { setHeader("Market Structure", "ภาพรวมตลาด", false); main.innerHTML = banner + overviewHTML(); }
  else if (S.screen === "list") { setHeader("รายการที่สนใจ", null, false); main.innerHTML = banner + listHTML(); }
  else if (S.screen === "daily") { setHeader("รายวัน", "ตัวที่เล่น + SL/TP", false); main.innerHTML = banner + dailyHTML(); }
  else if (S.screen === "accum") { setHeader("สะสมระยะยาว", "Trend ระยะยาว + จังหวะสะสม", false); main.innerHTML = banner + accumHTML(); }
  else if (S.screen === "detail") {
    var meta = findItemMeta(S.sel);
    setHeader(meta ? (meta.s || meta.t) : S.sel, null, true);
    main.innerHTML = detailHTML(S.sel);
  }
}

document.addEventListener("click", function (e) {
  var t = e.target.closest("[data-tab],[data-group],[data-gview],[data-tmode],[data-period],[data-detp],[data-open],[data-t],[data-goto-group],[data-accum-glossary],#help,#critBtn,[data-crit],#closeSheet,#backBtn,#themeBtn,#fsBtn,#sheet");
  if (!t) return;
  if (t.id === "fsBtn") { S.fs = (S.fs % 3) + 1; applyFs(); store.set("mb.fs", S.fs); return; }
  if (t.id === "themeBtn") { toggleTheme(); return; }
  if (t.id === "backBtn") { S.screen = S.from; render(); scrollTo(0, 0); return; }
  if (t.id === "closeSheet" || t.id === "sheet") { if (t.id === "sheet" && e.target !== t) return; closeSheet(); return; }
  if (t.id === "help") { explainSheet(); return; }
  if (t.id === "critBtn") { criteriaSheet("status"); return; }
  if (t.dataset.crit) { criteriaSheet(t.dataset.crit); return; }
  if (t.dataset.accumGlossary) { accumGlossarySheet(); return; }
  if (t.dataset.tab) { S.screen = t.dataset.tab; store.set("mb.screen", S.screen); render(); scrollTo(0, 0); return; }
  if (t.dataset.gotoGroup) { S.group = t.dataset.gotoGroup; S.screen = "list"; store.set("mb.screen", "list"); render(); scrollTo(0, 0); return; }
  if (t.dataset.group) { S.group = t.dataset.group; S.groupView = "rrg"; S.sel = null; store.set("mb.group", S.group); render(); return; }
  if (t.dataset.gview) { S.groupView = t.dataset.gview; render(); return; }
  if (t.dataset.tmode) { S.tableMode = t.dataset.tmode; render(); return; }
  if (t.dataset.period) { S.period = t.dataset.period; render(); return; }
  if (t.dataset.detp) { S.detPeriod = t.dataset.detp; render(); return; }
  if (t.dataset.open) { S.from = S.screen; S.sel = t.dataset.open; S.detPeriod = "1y"; S.screen = "detail"; render(); scrollTo(0, 0); return; }
  if (t.dataset.t) { S.sel = t.dataset.t; render(); return; }
});
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });

/* ---------- theme + font size ---------- */
function applyTheme() {
  document.documentElement.setAttribute("data-theme", S.theme);
  $("#themeBtn").textContent = S.theme === "dark" ? "🌙" : "☀️";
  $("#themeBtn").setAttribute("aria-label", S.theme === "dark" ? "สลับเป็นธีมสว่าง" : "สลับเป็นธีมมืด");
  document.querySelector('meta[name="theme-color"]').setAttribute("content", S.theme === "dark" ? "#0E1420" : "#ffffff");
}
function toggleTheme() { S.theme = S.theme === "dark" ? "light" : "dark"; store.set("mb.theme", S.theme); applyTheme(); }
function applyFs() { document.documentElement.classList.remove("fs2", "fs3"); if (S.fs > 1) document.documentElement.classList.add("fs" + S.fs); }

/* ---------- init ---------- */
(function init() {
  S.theme = store.get("mb.theme") === "dark" ? "dark" : "light"; applyTheme();
  S.fs = +store.get("mb.fs") || 1; applyFs();
  S.screen = store.get("mb.screen") || "overview";
  S.group = store.get("mb.group") || "sector";
  load().then(function () { renderFresh(); render(); }).catch(function (err) {
    $("#main").innerHTML = '<div class="banner">โหลดข้อมูลไม่สำเร็จ (' + esc(err.message) + ') — เปิดครั้งแรกต้องมีอินเทอร์เน็ต หลังจากนั้นใช้ออฟไลน์ได้</div>';
    $("#fresh").textContent = "ออฟไลน์";
  });
  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) navigator.serviceWorker.register("sw.js").catch(function () {});
})();
