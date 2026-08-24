(function () {
"use strict";
const T = DATA.teams, C = DATA.const, WK = DATA.weeks, EV = DATA.evidence;
const CAL = DATA.calib, REGR = DATA.regr, FIT = DATA.fpiFit;
const NAMES = Object.keys(T).sort();
const $ = id => document.getElementById(id);
const fmt = function (x, d) {
  if (x == null || isNaN(x)) return "-";
  const n = d == null ? 1 : d;
  const r = +x.toFixed(n);
  const v = r === 0 ? 0 : r;
  return (v >= 0 ? "+" : "") + v.toFixed(n);
};
const abs1 = x => Math.abs(x).toFixed(1);
const pct = x => (100 * x).toFixed(0) + "%";
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DATEF = d => {
  const p = d.split("-").map(Number);
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][p[1]-1] + " " + p[2];
};

/* ---------- state ---------- */
const KEYL = "cfb2026-lines-v1", KEYP = "cfb2026-picks-v1", KEYS = "cfb2026-settings-v1";
const S = {
  away: "Ohio State", home: "Indiana",
  line: null, total: null, hfa: 2.2, neutral: false, reg: C.REG,
  week: Object.keys(WK)[0], slateSort: "date", blend: C.BLEND,
  conf: "", find: "", rankSort: "p26", rankDir: 1,
  picks: [], lines: {}
};
function loadLS() {
  try { S.picks = JSON.parse(localStorage.getItem(KEYP) || "[]"); } catch (e) { S.picks = []; }
  try { S.lines = JSON.parse(localStorage.getItem(KEYL) || "{}"); } catch (e) { S.lines = {}; }
  try {
    const st = JSON.parse(localStorage.getItem(KEYS) || "{}");
    if (typeof st.reg === "number") S.reg = st.reg;
    if (typeof st.hfa === "number") S.hfa = st.hfa;
    if (typeof st.blend === "number") S.blend = st.blend;
  } catch (e) { }
}
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
const saveSettings = () => save(KEYS, { reg: S.reg, hfa: S.hfa, blend: S.blend });

/* ---------- model ---------- */
const SD = 15.8;
function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}
const ncdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
const K = () => 1 - S.reg;
const epaPam = t => T[t].net * K() * C.PLAYS;   // EPA model, points vs average
const fpiPam = t => T[t].fpi26;                 // FPI preseason, points vs average
const pamOf  = t => S.blend * fpiPam(t) + (1 - S.blend) * epaPam(t);
const offOf = t => T[t].off * K();
const defOf = t => T[t].def * K();

function project(aName, hName, opt) {
  const hf = opt.neutral ? 0 : opt.hfa;
  const margin = pamOf(hName) - pamOf(aName) + hf;
  // score split: use the EPA offence/defence shape, rescaled so the margin matches
  const eA = C.LGPPG + (offOf(aName) + defOf(hName)) * C.PLAYS;
  const eH = C.LGPPG + (offOf(hName) + defOf(aName)) * C.PLAYS + hf;
  const tot = eA + eH;
  const ptsH = tot / 2 + margin / 2, ptsA = tot / 2 - margin / 2;
  return { ptsA: ptsA, ptsH: ptsH, margin: margin, total: tot, hf: hf, winH: ncdf(margin / SD),
           epaMargin: epaPam(hName) - epaPam(aName) + hf,
           fpiMargin: fpiPam(hName) - fpiPam(aName) + hf };
}
const gameKey = g => g.d + "|" + g.an + "|" + g.hn;

/* ---------- matchup categories ---------- */
const CATS = [
  { k: "Pass offense",   o: "offPass",     d: "defPass",     hint: "EPA per dropback against that pass defence" },
  { k: "Rush offense",   o: "offRush",     d: "defRush",     hint: "EPA per carry against that run defence" },
  { k: "Pass success",   o: "offSuccPass", d: "defSuccPass", hint: "staying on schedule throwing" },
  { k: "Rush success",   o: "offSuccRush", d: "defSuccRush", hint: "staying on schedule running" },
  { k: "Explosive pass", o: "offExpPass",  d: "defExpPass",  hint: "chunk plays through the air" },
  { k: "Explosive rush", o: "offExpRush",  d: "defExpRush",  hint: "chunk plays on the ground" },
  { k: "Short yardage",  o: "offPower",    d: "defPower",    hint: "power success on third and short" },
  { k: "Run blocking",   o: "offLY",       d: "defLY",       hint: "line yards against that front" },
  { k: "Pass rush",      o: "offHavF7",    d: "defHavF7",    hint: "front-seven havoc" },
  { k: "Secondary",      o: "offHavDB",    d: "defHavDB",    hint: "defensive back havoc" }
];
const gap = (att, def, ok, dk) => T[def].rk[dk] - T[att].rk[ok];
// teamrankings data is only present for seasons we have it for
const tr = (t, k) => (T[t].tr && T[t].tr[k] != null) ? T[t].tr[k] : null;

/* ---------- theme ---------- */
$("themeBtn").onclick = function () {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  document.documentElement.setAttribute("data-theme", dark ? "light" : "dark");
  $("themeBtn").textContent = dark ? "Dark" : "Light";
  drawBars();
};

/* ---------- tabs ---------- */
const TABS = ["matchup", "slate", "rank", "track", "calib", "about"];
function showTab(name) {
  const kids = $("tabs").children;
  for (let i = 0; i < kids.length; i++) kids[i].setAttribute("aria-selected", kids[i].dataset.tab === name);
  TABS.forEach(t => $("tab-" + t).classList.toggle("hidden", t !== name));
}
$("tabs").addEventListener("click", function (e) {
  const b = e.target.closest("button[data-tab]"); if (!b) return;
  showTab(b.dataset.tab);
  if (b.dataset.tab === "matchup") drawBars();
});

/* ---------- global controls ---------- */
function syncGlobals() {
  $("regIn").value = Math.round(S.reg * 100);
  $("regLbl").textContent = Math.round(S.reg * 100) + "%";
  $("hfaIn").value = S.hfa;
  $("blendIn").value = Math.round(S.blend * 100);
  $("blendLbl").textContent = Math.round(S.blend * 100) + "% FPI";
}
$("blendIn").oninput = function (e) {
  S.blend = clamp(+e.target.value / 100, 0, 1);
  $("blendLbl").textContent = Math.round(S.blend * 100) + "% FPI";
  saveSettings(); renderAll();
};
$("regIn").oninput = function (e) {
  S.reg = clamp(+e.target.value / 100, 0, 1);
  $("regLbl").textContent = Math.round(S.reg * 100) + "%";
  saveSettings(); renderAll();
};
$("hfaIn").oninput = function (e) { S.hfa = +e.target.value || 0; saveSettings(); renderAll(); };
$("neutralIn").onchange = function (e) { S.neutral = e.target.checked; renderMatchup(); };

/* ---------- matchup ---------- */
function fillTeams(sel, val) {
  sel.innerHTML = NAMES.map(n => '<option value="' + esc(n) + '"' + (n === val ? " selected" : "") + ">" + esc(n) + "</option>").join("");
}
fillTeams($("awaySel"), S.away); fillTeams($("homeSel"), S.home);
$("awaySel").onchange = function (e) { S.away = e.target.value; renderMatchup(); };
$("homeSel").onchange = function (e) { S.home = e.target.value; renderMatchup(); };
$("swapBtn").onclick = function () {
  const a = S.away; S.away = S.home; S.home = a;
  $("awaySel").value = S.away; $("homeSel").value = S.home; renderMatchup();
};
$("lineIn").oninput = function (e) { S.line = e.target.value === "" ? null : +e.target.value; renderMatchup(); };
$("totalIn").oninput = function (e) { S.total = e.target.value === "" ? null : +e.target.value; renderMatchup(); };

function loadGame(g) {
  if (!g.a || !g.h) return;
  S.away = g.a; S.home = g.h; S.neutral = !!g.n;
  const saved = S.lines[gameKey(g)];
  S.line = (saved == null || saved === "") ? null : +saved;
  $("awaySel").value = S.away; $("homeSel").value = S.home;
  $("neutralIn").checked = S.neutral;
  $("lineIn").value = S.line == null ? "" : S.line;
  showTab("matchup");
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderMatchup();
}

function renderMatchup() {
  const p = project(S.away, S.home, S);
  const favHome = p.margin > 0;
  const favName = favHome ? S.home : S.away;

  const tiles = [
    { k: "Model line", v: favName + " " + (-Math.abs(p.margin)).toFixed(1),
      n: p.hf ? "includes " + p.hf.toFixed(1) + " pts home field" : "neutral site" },
    { k: "Projected score", v: Math.round(p.ptsA) + " - " + Math.round(p.ptsH), n: S.away + " at " + S.home },
    { k: "Win probability", v: pct(favHome ? p.winH : 1 - p.winH), n: favName + " straight up" },
    { k: "Projected total", v: p.total.toFixed(1), n: S.total != null
        ? (p.total > S.total ? "over by " + (p.total - S.total).toFixed(1) : "under by " + (S.total - p.total).toFixed(1))
        : "enter a market total to compare" }
  ];

  let noteHtml = "";
  if (S.line != null) {
    // S.line is the home team's spread (-7.5 = home laying 7.5), so the market's
    // implied home margin is the negative of it.
    const edge = p.margin - (-S.line);
    const side = edge > 0 ? S.home : S.away;
    const strength = Math.abs(edge) >= 6 ? "good" : Math.abs(edge) >= 3 ? "warn" : "flat";
    const word = Math.abs(edge) >= 6 ? "Strong lean" : Math.abs(edge) >= 3 ? "Lean" : "No edge";
    tiles.splice(1, 0, { k: "Edge vs market", v: fmt(edge, 1), n: word + ": " + side, pill: strength });
    noteHtml = '<div class="note ' + (Math.abs(edge) >= 3 ? "info" : "") + '"><b>' + word +
      (Math.abs(edge) >= 3 ? ": " + esc(side) + " " + (edge > 0 ? S.line.toFixed(1) : (-S.line).toFixed(1)) : "") +
      ".</b> Model says " + esc(favName) + " by " + abs1(p.margin) + "; the market has " +
      (S.line < 0 ? esc(S.home) + " " + S.line.toFixed(1) : esc(S.away) + " " + (-S.line).toFixed(1)) + ". " +
      abs1(edge) + " points of disagreement, at " + Math.round(S.reg * 100) +
      "% regression on 2025 form. Preseason ratings carry real error, so anything under about 4 points is inside the noise.</div>";
  }

  $("hero").innerHTML = tiles.map(t =>
    '<div class="tile"><div class="k">' + t.k + '</div><div class="v">' + esc(t.v) + '</div><div class="n">' +
    (t.pill ? '<span class="pill ' + t.pill + '">' + esc(t.n) + "</span>" : esc(t.n)) + "</div></div>").join("");

  // three independent numbers, home side
  const three = [
    ["Blended model", -p.margin, "what the slider is set to"],
    ["EPA model only", -p.epaMargin, "2025 play-by-play, opponent adjusted"],
    ["ESPN FPI only", -p.fpiMargin, "includes returning production and recruiting"]
  ];
  if (S.line != null) three.push(["Market", S.line, "the number you typed"]);
  $("three").innerHTML = three.map(function (x) {
    return '<div class="brow3"><div class="lab">' + x[0] + '</div>' +
      '<div class="num" style="text-align:right;font-weight:600">' + esc(S.home) + " " + fmt(x[1], 1) + "</div>" +
      '<div class="tiny">' + x[2] + "</div></div>";
  }).join("");
  $("edgeNote").innerHTML = noteHtml;
  $("legA").textContent = S.away; $("legH").textContent = S.home;

  let sched = "";
  const wkeys = Object.keys(WK);
  for (let i = 0; i < wkeys.length; i++) {
    const g = WK[wkeys[i]].filter(x => x.a === S.away && x.h === S.home)[0];
    if (g) {
      sched = '<span class="chip">Week ' + wkeys[i] + " &middot; " + DATEF(g.d) + (g.n ? " &middot; neutral site" : "") + "</span>";
      break;
    }
  }
  $("schedChip").innerHTML = sched || '<span class="chip dim">not a scheduled 2026 matchup</span>';

  drawBars(); drawCompare(); drawRawTable(); drawLegacy();
}

function drawBars() {
  const rows = CATS.map(function (c) {
    return { k: c.k, hint: c.hint, net: gap(S.home, S.away, c.o, c.d) - gap(S.away, S.home, c.o, c.d) };
  });
  let max = 60;
  rows.forEach(r => { if (Math.abs(r.net) > max) max = Math.abs(r.net); });
  $("bars").innerHTML = rows.map(function (r) {
    const w = clamp(Math.abs(r.net) / max, 0, 1) * 50;
    const style = r.net > 0 ? "left:50%;width:" + w + "%;background:var(--home)"
                            : "right:50%;width:" + w + "%;background:var(--away)";
    return '<div class="brow" title="' + esc(r.hint) + '"><div class="lab">' + r.k +
      '</div><div class="btrack"><div class="zero"></div><div class="bfill" style="' + style +
      '"></div></div><div class="val">' + (r.net > 0 ? "+" : "") + Math.round(r.net) + "</div></div>";
  }).join("");
}

const CMP = [
  ["2026 rating", t => fmt(pamOf(t), 1) + " pts", t => T[t].rNet],
  ["2025 rating", t => fmt(T[t].pam, 1) + " pts", t => T[t].rNet],
  ["Offense", t => fmt(offOf(t) * C.PLAYS, 1) + " pts", t => T[t].rOff],
  ["Defense", t => fmt(-defOf(t) * C.PLAYS, 1) + " pts", t => T[t].rDef],
  ["EPA per play, off", t => T[t].raw.offPpa.toFixed(3), t => T[t].rk.offPpa],
  ["EPA per play, def", t => T[t].raw.defPpa.toFixed(3), t => T[t].rk.defPpa],
  ["Pass EPA", t => T[t].raw.offPass.toFixed(3), t => T[t].rk.offPass],
  ["Rush EPA", t => T[t].raw.offRush.toFixed(3), t => T[t].rk.offRush],
  ["Pass D EPA", t => T[t].raw.defPass.toFixed(3), t => T[t].rk.defPass],
  ["Rush D EPA", t => T[t].raw.defRush.toFixed(3), t => T[t].rk.defRush],
  ["Success rate", t => pct(T[t].raw.offSucc), t => T[t].rk.offSucc],
  ["Success allowed", t => pct(T[t].raw.defSucc), t => T[t].rk.defSucc],
  ["Yards per rush", t => tr(t,"rushV") != null ? tr(t,"rushV").toFixed(1) : "-", t => tr(t,"rush")],
  ["Yards per pass", t => tr(t,"passV") != null ? tr(t,"passV").toFixed(1) : "-", t => tr(t,"pass")],
  ["Opp yds per rush", t => tr(t,"defrushV") != null ? tr(t,"defrushV").toFixed(1) : "-", t => tr(t,"defrush")],
  ["Opp yds per pass", t => tr(t,"defpassV") != null ? tr(t,"defpassV").toFixed(1) : "-", t => tr(t,"defpass")],
  ["Schedule rank", t => T[t].sos == null ? "-" : "#" + T[t].sos, t => T[t].sos],
  [(DATA.rec_year || DATA.prev) + " record", t => (T[t].w == null ? "-" : T[t].w + "-" + T[t].l), () => null],
  ["Plays per game", t => T[t].raw.plays.toFixed(1), () => null]
];
function drawCompare() {
  $("cmp").innerHTML = CMP.map(function (row) {
    const lab = row[0], val = row[1], rank = row[2];
    const ra = rank(S.away), rh = rank(S.home);
    const aWin = ra != null && rh != null && ra < rh, hWin = ra != null && rh != null && rh < ra;
    return '<div class="a ' + (aWin ? "win" : "") + '">' + val(S.away) + (ra != null ? ' <span class="rk">#' + ra + "</span>" : "") + "</div>" +
           '<div class="mid">' + lab + "</div>" +
           '<div class="h ' + (hWin ? "win" : "") + '">' + (rh != null ? '<span class="rk">#' + rh + "</span> " : "") + val(S.home) + "</div>";
  }).join("");
}


const RAWCATS = [
  ["Off PPA", "offPpa", 3], ["Def PPA", "defPpa", 3],
  ["Off success rate", "offSucc", 1], ["Def success rate", "defSucc", 1],
  ["Off explosiveness", "offExp", 3], ["Def explosiveness", "defExp", 3],
  ["Off pts per opportunity", "offPPO", 2], ["Def pts per opportunity", "defPPO", 2],
  ["Off power success", "offPower", 1], ["Def power success", "defPower", 1],
  ["Off stuff rate", "offStuff", 1], ["Def stuff rate", "defStuff", 1],
  ["Off havoc allowed", "offHav", 1], ["Def havoc forced", "defHav", 1]
];
function drawRawTable() {
  const isPct = k => ["offSucc","defSucc","offPower","defPower","offStuff","defStuff","offHav","defHav"].indexOf(k) >= 0;
  const cell = (t, k, d) => isPct(k) ? (100 * T[t].raw[k]).toFixed(1) + "%" : T[t].raw[k].toFixed(d);
  $("rawTbl").innerHTML = '<thead><tr><th class="nosort">Category</th>' +
    '<th class="nosort">' + esc(S.away) + '</th><th class="nosort">Rk</th>' +
    '<th class="nosort">' + esc(S.home) + '</th><th class="nosort">Rk</th>' +
    '<th class="nosort">Edge</th></tr></thead><tbody>' +
    RAWCATS.map(function (c) {
      const lab = c[0], k = c[1], d = c[2];
      const ra = T[S.away].rk[k], rh = T[S.home].rk[k];
      const gapv = ra - rh;   // positive = home ranks better
      const who = gapv === 0 ? "" : (gapv > 0 ? S.home : S.away);
      return "<tr><td>" + lab + '</td>' +
        '<td class="num' + (ra < rh ? '" style="font-weight:700' : "") + '">' + cell(S.away, k, d) + "</td>" +
        '<td class="num dim">' + ra + "</td>" +
        '<td class="num' + (rh < ra ? '" style="font-weight:700' : "") + '">' + cell(S.home, k, d) + "</td>" +
        '<td class="num dim">' + rh + "</td>" +
        '<td class="num ' + (gapv > 0 ? "edge-neg" : gapv < 0 ? "edge-pos" : "dim") + '">' +
        (who ? esc(who) + " by " + Math.abs(gapv) : "-") + "</td></tr>";
    }).join("") +
    '<tr><td>Strength of schedule</td><td class="num dim">-</td><td class="num dim">' + (T[S.away].sos == null ? "-" : T[S.away].sos) +
    '</td><td class="num dim">-</td><td class="num dim">' + (T[S.home].sos == null ? "-" : T[S.home].sos) + '</td>' +
    '<td class="num dim">2025 schedule rank</td></tr>' +
    "</tbody>";
}

function drawLegacy() {
  const a = T[S.away], h = T[S.home];
  const parts = ["rush", "pass", "defrush", "defpass"];
  const diffs = parts.map(k => (tr(S.away, k) != null && tr(S.home, k) != null) ? tr(S.away, k) - tr(S.home, k) : null);
  const ok = diffs.every(d => d != null);
  const ypp = ok ? diffs.reduce((s, d) => s + d, 0) / 4 : null;
  const epa = [a.rk.offPass - h.rk.defPass, a.rk.offRush - h.rk.defRush,
               h.rk.offPass - a.rk.defPass, h.rk.offRush - a.rk.defRush].reduce((s, d) => s + d, 0) / 4;
  $("legacy").innerHTML =
    '<div class="hero" style="margin:0"><div class="tile"><div class="k">YPP</div><div class="v">' +
    (ypp == null ? "-" : fmt(ypp, 2)) + '</div><div class="n">' +
    (ypp == null ? "missing stat" : esc(ypp > 0 ? S.home : S.away) + " better by " + Math.abs(ypp).toFixed(1) + " rank spots") +
    '</div></div><div class="tile"><div class="k">EPA</div><div class="v">' + fmt(epa, 2) + '</div><div class="n">' +
    esc(epa > 0 ? S.home : S.away) + " better by " + Math.abs(epa).toFixed(1) + " rank spots</div></div></div>" +
    '<p class="tiny" style="margin-top:12px">The two numbers the spreadsheet produced, recomputed on 2025 data with the ' +
    "lookup bugs fixed. Both are averages of national rank gaps, so they carry no unit and cannot be compared to a point " +
    "spread. They are here so the sheet's output stays recognisable.</p>";
}

/* ---------- slate ---------- */
function weekLabel(w) {
  const ds = WK[w].map(g => g.d).sort();
  const a = DATEF(ds[0]), b = DATEF(ds[ds.length - 1]);
  const nl = WK[w].filter(g => g.m != null && g.a && g.h).length;
  return "Week " + w + " · " + a + (b === a ? "" : " to " + b) + " · " + WK[w].length + " games" + (nl ? " · " + nl + " lines" : "");
}
$("weekSel").innerHTML = Object.keys(WK).map(w => '<option value="' + w + '">' + esc(weekLabel(w)) + "</option>").join("");
$("weekSel").value = S.week;
$("weekSel").onchange = function (e) { S.week = e.target.value; drawSlate(); };
$("sortSel").onchange = function (e) { S.slateSort = e.target.value; drawSlate(); };

function drawSlate() {
  const list = WK[S.week] || [];
  const gs = list.map(function (g, i) {
    const rated = !!(g.a && g.h);
    const p = rated ? project(g.a, g.h, { neutral: !!g.n, hfa: S.hfa }) : null;
    const key = gameKey(g);
    const raw = S.lines[key];
    // mkt is always the market's implied HOME MARGIN.
    // g.m is already stored that way; a user-typed value is a home SPREAD, so negate it.
    const mkt = (raw === "" || raw == null) ? (g.m != null ? g.m : null) : -(+raw);
    return { i: i, g: g, key: key, rated: rated, p: p, mkt: mkt,
             edge: (p && mkt != null) ? p.margin - mkt : null };
  });
  if (S.slateSort === "edge") gs.sort((x, y) => Math.abs(y.edge == null ? -1 : y.edge) - Math.abs(x.edge == null ? -1 : x.edge));
  if (S.slateSort === "line") gs.sort((x, y) => Math.abs(y.p ? y.p.margin : -1) - Math.abs(x.p ? x.p.margin : -1));
  if (S.slateSort === "date") gs.sort((x, y) => x.i - y.i);

  const withLine = gs.filter(r => r.edge != null).length;
  $("slateNote").innerHTML = '<span class="tiny">' + gs.length + " games &middot; " +
    gs.filter(r => r.rated).length + " FBS vs FBS &middot; " + withLine +
    " with a market line. Lines ESPN had posted are pre-filled; type over any box to use your own number " +
    "(negative when the home team is favoured). All spread columns are from the home team's side.</span>";

  $("slateTbl").innerHTML = '<thead><tr><th class="nosort">Date</th><th class="nosort">Game</th>' +
    '<th class="nosort" title="blended model, home side">Model</th>' +
    '<th class="nosort" title="EPA model only">EPA</th>' +
    '<th class="nosort" title="ESPN FPI only">FPI</th>' +
    '<th class="nosort" title="the home team\'s spread at the book">Market</th><th class="nosort">Edge</th>' +
    '<th class="nosort">Lean</th><th class="nosort">Total</th><th class="nosort"></th></tr></thead><tbody>' +
    gs.map(function (r) {
      const g = r.g;
      if (!r.rated) {
        return '<tr><td class="dim">' + DATEF(g.d) + "</td><td>" + esc(g.an) + " " + (g.n ? "vs" : "@") + " " +
          esc(g.hn) + ' <span class="chip">FCS</span></td>' +
          '<td colspan="8" class="dim" style="text-align:left">FCS opponent, not rated</td></tr>';
      }
      const lean = r.edge == null ? '<span class="dim">-</span>'
        : (Math.abs(r.edge) < 3 ? '<span class="dim">pass</span>'
          : '<span class="' + (r.edge > 0 ? "edge-pos" : "edge-neg") + '">' + esc(r.edge > 0 ? g.h : g.a) + "</span>");
      return '<tr><td class="dim">' + DATEF(g.d) + '</td><td><a href="#" class="glink" data-i="' + r.i + '">' +
        esc(g.an) + " " + (g.n ? "vs" : "@") + " " + esc(g.hn) + "</a></td>" +
        '<td class="num">' + esc(g.hn) + " " + fmt(-r.p.margin, 1) + "</td>" +
        '<td class="num dim">' + fmt(-r.p.epaMargin, 1) + "</td>" +
        '<td class="num dim">' + fmt(-r.p.fpiMargin, 1) + "</td>" +
        '<td><input class="mline num" data-key="' + esc(r.key) + '" type="number" step="0.5" value="' +
        (r.mkt == null ? "" : (-r.mkt)) + '" placeholder="line"' + (S.lines[r.key] == null && r.mkt != null ? ' title="line ESPN had posted"' : "") + '></td>' +
        '<td class="num">' + (r.edge == null ? "-" : fmt(r.edge, 1)) + "</td><td>" + lean + "</td>" +
        '<td class="num dim">' + r.p.total.toFixed(1) + "</td>" +
        '<td><button class="btn addpick" data-i="' + r.i + '" style="padding:2px 8px"' +
        (r.edge == null ? " disabled" : "") + ">log</button></td></tr>";
    }).join("") + "</tbody>";

  const tbl = $("slateTbl");
  tbl.querySelectorAll("input.mline").forEach(function (inp) {
    inp.onchange = function (e) {
      const v = e.target.value;
      if (v === "") delete S.lines[e.target.dataset.key]; else S.lines[e.target.dataset.key] = +v;
      save(KEYL, S.lines); drawSlate();
    };
  });
  tbl.querySelectorAll("a.glink").forEach(function (a) {
    a.onclick = function (e) { e.preventDefault(); loadGame(list[+a.dataset.i]); };
  });
  tbl.querySelectorAll("button.addpick").forEach(function (b) {
    b.onclick = function () {
      const g = list[+b.dataset.i];
      const p = project(g.a, g.h, { neutral: !!g.n, hfa: S.hfa });
      const rawL = S.lines[gameKey(g)];
      const mkt = (rawL === "" || rawL == null) ? g.m : -(+rawL);   // home margin
      const edge = p.margin - mkt;
      const homeSpread = -mkt;                                      // what the book shows on the home side
      S.picks.push({ g: g.an + " " + (g.n ? "vs" : "@") + " " + g.hn, s: edge > 0 ? g.h : g.a,
                     line: edge > 0 ? homeSpread : -homeSpread, u: 1, price: -110, r: "" });
      save(KEYP, S.picks); drawTracker();
      b.textContent = "logged"; b.disabled = true;
    };
  });
}

/* ---------- rankings ---------- */
const CONFS = Object.keys(NAMES.reduce((o, n) => { o[T[n].conf] = 1; return o; }, {})).sort();
$("confSel").innerHTML = '<option value="">All conferences</option>' + CONFS.map(c => "<option>" + esc(c) + "</option>").join("");
$("confSel").onchange = function (e) { S.conf = e.target.value; drawRank(); };
$("findIn").oninput = function (e) { S.find = e.target.value.toLowerCase(); drawRank(); };
const RCOLS = [["Team", "n"], ["Conf", "conf"], [(DATA.rec_year || DATA.prev) + " W-L", "w"], ["Blended", "p26"],
               ["EPA", "pepa"], ["FPI 26", "fpi26"], ["FPI 25", "fpi25"],
               ["Off", "rOff"], ["Def", "rDef"], ["SOS", "sos"]];
function drawRank() {
  const rows = NAMES.filter(n => (!S.conf || T[n].conf === S.conf) &&
    (!S.find || n.toLowerCase().indexOf(S.find) >= 0 || T[n].s.toLowerCase().indexOf(S.find) >= 0));
  const k = S.rankSort;
  const get = (t, key) => key === "p26" ? pamOf(t) : key === "pepa" ? epaPam(t) : (key === "n" ? t : T[t][key]);
  rows.sort(function (x, y) {
    const a = get(x, k), b = get(y, k);
    if (typeof a === "string") return S.rankDir * a.localeCompare(b);
    if (k === "pam" || k === "p26" || k === "pepa" || k === "w" || k === "fpi26" || k === "fpi25") return S.rankDir * (b - a);
    return S.rankDir * (a - b);
  });
  $("rankTbl").innerHTML = "<thead><tr>" +
    RCOLS.map(c => '<th data-k="' + c[1] + '">' + c[0] + (S.rankSort === c[1] ? (S.rankDir > 0 ? " ↓" : " ↑") : "") + "</th>").join("") +
    "</tr></thead><tbody>" + rows.map(function (n) {
      const t = T[n];
      return '<tr><td><a href="#" class="tlink" data-t="' + esc(n) + '">' + esc(n) + "</a></td>" +
        '<td class="dim">' + esc(t.conf) + '</td><td class="num">' + t.w + "-" + t.l + "</td>" +
        '<td class="num" style="font-weight:600">' + fmt(pamOf(n), 1) + "</td>" +
        '<td class="num dim">' + fmt(epaPam(n), 1) + "</td>" +
        '<td class="num">' + fmt(t.fpi26, 1) + '</td><td class="num dim">' + fmt(t.fpi25, 1) + "</td>" +
        '<td class="num">' + t.rOff + '</td><td class="num">' + t.rDef + "</td>" +
        '<td class="num dim">' + (t.sos == null ? "-" : t.sos) + "</td></tr>";
    }).join("") + "</tbody>";
  $("rankTbl").querySelectorAll("th[data-k]").forEach(function (th) {
    th.onclick = function () {
      if (S.rankSort === th.dataset.k) S.rankDir *= -1; else { S.rankSort = th.dataset.k; S.rankDir = 1; }
      drawRank();
    };
  });
  $("rankTbl").querySelectorAll("a.tlink").forEach(function (a) {
    a.onclick = function (e) {
      e.preventDefault(); S.home = a.dataset.t; $("homeSel").value = S.home;
      showTab("matchup"); window.scrollTo({ top: 0, behavior: "smooth" }); renderMatchup();
    };
  });
}

/* ---------- tracker ---------- */
$("tAdd").onclick = function () {
  const g = $("tGame").value.trim(), s = $("tSide").value.trim();
  if (!g || !s) return;
  S.picks.push({ g: g, s: s, line: +$("tLine").value || 0, u: +$("tUnits").value || 1,
                 price: +$("tPrice").value || -110, r: "" });
  ["tGame", "tSide", "tLine"].forEach(i => { $(i).value = ""; });
  save(KEYP, S.picks); drawTracker();
};
function payout(p) {
  if (p.r === "W") return p.price > 0 ? p.u * p.price / 100 : p.u * 100 / Math.abs(p.price);
  if (p.r === "L") return -p.u;
  return 0;
}
function drawTracker() {
  const done = S.picks.filter(p => p.r);
  const w = done.filter(p => p.r === "W").length, l = done.filter(p => p.r === "L").length,
        pu = done.filter(p => p.r === "P").length;
  const units = done.reduce((s, p) => s + payout(p), 0);
  const risked = done.filter(p => p.r !== "P").reduce((s, p) => s + p.u, 0);
  const hit = (w + l) ? w / (w + l) : null;
  $("tStats").innerHTML = [
    { k: "Record", v: w + "-" + l + (pu ? "-" + pu : ""), n: S.picks.length + " picks logged" },
    { k: "Hit rate", v: hit == null ? "-" : pct(hit), n: "52.4% breaks even at -110" },
    { k: "Units", v: (units >= 0 ? "+" : "") + units.toFixed(2), n: risked.toFixed(1) + " risked" },
    { k: "ROI", v: risked ? (units / risked * 100).toFixed(1) + "%" : "-", n: "on amount risked" }
  ].map(t => '<div class="tile"><div class="k">' + t.k + '</div><div class="v">' + t.v + '</div><div class="n">' + t.n + "</div></div>").join("");

  $("tTbl").innerHTML = '<thead><tr><th class="nosort">Game</th><th class="nosort">Side</th><th class="nosort">Line</th>' +
    '<th class="nosort">Units</th><th class="nosort">Price</th><th class="nosort">Result</th><th class="nosort">P/L</th>' +
    '<th class="nosort"></th></tr></thead><tbody>' +
    (S.picks.length ? S.picks.map(function (p, i) {
      const pl = payout(p);
      return "<tr><td>" + esc(p.g) + "</td><td>" + esc(p.s) + '</td><td class="num">' + p.line.toFixed(1) + "</td>" +
        '<td class="num">' + p.u + '</td><td class="num">' + p.price + "</td>" +
        '<td><select data-i="' + i + '" class="res" style="width:88px;padding:3px 6px">' +
        '<option value=""' + (p.r === "" ? " selected" : "") + ">open</option>" +
        '<option value="W"' + (p.r === "W" ? " selected" : "") + ">win</option>" +
        '<option value="L"' + (p.r === "L" ? " selected" : "") + ">loss</option>" +
        '<option value="P"' + (p.r === "P" ? " selected" : "") + ">push</option></select></td>" +
        '<td class="num ' + (pl > 0 ? "edge-pos" : pl < 0 ? "edge-neg" : "dim") + '">' +
        (p.r ? (pl >= 0 ? "+" : "") + pl.toFixed(2) : "-") + "</td>" +
        '<td><button class="btn del" data-i="' + i + '" style="padding:2px 8px">&times;</button></td></tr>';
    }).join("") : '<tr><td colspan="8" class="dim" style="padding:18px">No picks yet. Enter a line on the Slate tab and hit log.</td></tr>') +
    "</tbody>";

  $("tTbl").querySelectorAll("select.res").forEach(function (s) {
    s.onchange = function (e) { S.picks[+e.target.dataset.i].r = e.target.value; save(KEYP, S.picks); drawTracker(); };
  });
  $("tTbl").querySelectorAll("button.del").forEach(function (b) {
    b.onclick = function (e) { S.picks.splice(+e.currentTarget.dataset.i, 1); save(KEYP, S.picks); drawTracker(); };
  });
}
$("tExport").onclick = function () {
  const b = new Blob([JSON.stringify({ picks: S.picks, lines: S.lines }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b); a.download = "cfb-2026-picks.json"; a.click();
};
$("tImport").onclick = function () { $("tFile").click(); };
$("tFile").onchange = function (e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = function () {
    try {
      const j = JSON.parse(r.result);
      S.picks = j.picks || (Array.isArray(j) ? j : []); S.lines = j.lines || S.lines;
      save(KEYP, S.picks); save(KEYL, S.lines); drawTracker(); drawSlate();
    } catch (x) { }
  };
  r.readAsText(f);
};
$("tClear").onclick = function () {
  if (confirm("Delete every logged pick?")) { S.picks = []; save(KEYP, S.picks); drawTracker(); }
};


/* ---------- calibration tab ---------- */
function drawCalib() {
  const B = [["All games with a line","all"],["Pick-ems, under 7","pk"],["Mid, 7 to 14","mid"],
             ["Big, 14 to 21","big"],["Blowouts, 21+","blow"]];
  $("calTbl").innerHTML = '<thead><tr><th class="nosort">Market spread</th><th class="nosort">Games</th>' +
    '<th class="nosort">EPA MAE</th><th class="nosort">EPA r</th>' +
    '<th class="nosort">FPI MAE</th><th class="nosort">FPI r</th><th class="nosort">Verdict</th></tr></thead><tbody>' +
    B.map(function (b) {
      const c = CAL[b[1]]; if (!c) return "";
      const good = c.fpi.r >= 0.9, epaBad = c.epa.r < 0.5;
      return "<tr><td>" + b[0] + '</td><td class="num">' + c.n + "</td>" +
        '<td class="num ' + (c.epa.mae > 5 ? "edge-neg" : "") + '">' + c.epa.mae.toFixed(2) + "</td>" +
        '<td class="num ' + (epaBad ? "edge-neg" : "") + '">' + c.epa.r.toFixed(3) + "</td>" +
        '<td class="num">' + c.fpi.mae.toFixed(2) + "</td>" +
        '<td class="num ' + (good ? "edge-pos" : "") + '">' + c.fpi.r.toFixed(3) + "</td>" +
        "<td>" + (epaBad ? '<span class="pill bad">EPA is noise here</span>'
                         : '<span class="pill flat">FPI closer</span>') + "</td></tr>";
    }).join("") + "</tbody>";

  const mx = Math.max.apply(null, REGR.map(r => Math.abs(r[1])));
  $("regrBars").innerHTML = REGR.map(function (r) {
    const w = Math.abs(r[1]) / mx * 100;
    return '<div class="brow"><div class="lab">' + r[0] + '</div>' +
      '<div class="btrack"><div class="bfill" style="left:0;width:' + w + '%;background:' +
      (r[1] > 0 ? "var(--away)" : "var(--home)") + '"></div></div>' +
      '<div class="val">' + fmt(r[1], 3) + "</div></div>";
  }).join("");

  $("calBody").innerHTML =
  '<h4>The question that got asked</h4>' +
  '<p>"Work out which of the EPA-tab stats correlate with a higher FPI, then run those stats against FPI each ' +
  'week to find spots where FPI is not valuing a team highly enough."</p>' +

  '<h4>The regression runs, and it works</h4>' +
  '<p>All 15 categories, ridge regression on the 2025 season, 10-fold cross-validated. It predicts FPI with ' +
  '<b>R&sup2; = ' + FIT.cvR2 + '</b>. Opponent strength does most of the work by a distance; every efficiency ' +
  'stat after it is a rounding error by comparison. Bars below are standardised coefficients.</p>' +

  '<h4>And that is exactly why it cannot find an edge</h4>' +
  '<p>If your stats explain 96% of FPI, the leftover 4% is not insight, it is the error term. There is nothing ' +
  'in the residual that says which side is right, because the thing being predicted <i>is</i> FPI. You cannot ' +
  'beat a number by building a model whose only goal is to reproduce that number.</p>' +
  '<p>It gets more direct than that. The opponent-adjusted EPA rating already in this app correlates ' +
  '<b>r = ' + FIT.r_fpi25 + '</b> with final 2025 FPI, with a residual of only ' + FIT.residSd + ' FPI points. ' +
  'The rating and FPI are already close to the same number. Regressing one onto the other has nothing left to find.</p>' +

  '<h4>What the numbers actually say</h4>' +
  '<p>Tested against the ' + CAL.all.n + ' real 2026 lines currently posted, on the games that matter most, ' +
  'the pick-ems under a touchdown, the EPA model correlates <b>' + CAL.pk.epa.r.toFixed(3) + '</b> with the market ' +
  'and misses by ' + CAL.pk.epa.mae.toFixed(1) + ' points on average. On a spread that is under 7 to begin with. ' +
  'That is not an edge, it is a coin flip with extra steps.</p>' +
  '<p>FPI over the same games: r = <b>' + CAL.pk.fpi.r.toFixed(3) + '</b>, off by ' + CAL.pk.fpi.mae.toFixed(1) + ' points. ' +
  'Across all ' + CAL.all.n + ' games FPI sits within ' + CAL.all.fpi.mae.toFixed(2) + ' points of the market at r = ' +
  CAL.all.fpi.r.toFixed(3) + '. FPI is not an independent opinion you can bet against the market. It is close to ' +
  'being the market.</p>' +

  '<h4>The trap in "find where FPI is wrong"</h4>' +
  '<p>FPI and the market disagree by 3 or more on 35 of the ' + CAL.all.n + ' games. In <b>30 of those 35</b>, 86%, ' +
  'FPI is the lower number, and the gap widens as the spread grows: FPI sits ' + Math.abs(CAL.blow.fpi.bias).toFixed(1) +
  ' points under the market on blowouts versus ' + Math.abs(CAL.pk.fpi.bias).toFixed(1) + ' on pick-ems. That is a ' +
  'known property of a regressed preseason rating, not a mispricing. Betting every FPI-versus-market gap means ' +
  'systematically taking big underdogs because your rating is shrunk. That is a losing strategy with a story ' +
  'attached to it.</p>' +

  '<h4>Why the EPA model falls apart in August specifically</h4>' +
  '<p>It is looking at 2025 play-by-play. It has no idea who left, who transferred in, or who changed coaches. ' +
  'FPI does. Compare North Carolina: they finished 2025 at ' + fmt(T["North Carolina"].fpi25, 1) + ' FPI and open 2026 at ' +
  fmt(T["North Carolina"].fpi26, 1) + '. Oklahoma State moved ' +
  fmt(T["Oklahoma State"].fpi26 - T["Oklahoma State"].fpi25, 1) + '. The EPA model cannot see any of that, so in ' +
  'week 1 it is confidently describing last year\'s teams.</p>' +
  '<p>This also answers the returning production and transfer portal question. Those inputs are subjective and ' +
  'hard to source. They are already inside preseason FPI. The gap between a team\'s final 2025 FPI and its ' +
  'opening 2026 FPI <i>is</i> the roster adjustment, computed by someone else, for free.</p>' +

  '<h4>So what is worth doing</h4>' +
  '<ul>' +
  '<li><b>Preseason, lean on FPI.</b> The slider up top defaults to 80% FPI. At 0% you are betting a 2025 rear-view ' +
  'mirror. Drop it toward the EPA model as 2026 games accumulate.</li>' +
  '<li><b>Stop regressing against FPI. Regress against closing lines and actual margins.</b> The market is what ' +
  'you get paid or not paid by. FPI is not.</li>' +
  '<li><b>The EPA model earns its keep in-season, not now.</b> Run on same-season 2025 data it hit r = ' + EV.corr +
  ' against that year\'s lines. The machinery is fine. The 2025 inputs are the problem.</li>' +
  '<li><b>Track every pick before risking a dollar.</b> Both of these numbers are unproven against a closing line. ' +
  'A season of logged paper picks costs nothing and settles the argument.</li>' +
  '</ul>' +

  '<h4>The uncomfortable part</h4>' +
  '<p>Beating college football spreads needs about 52.4% at -110. The market\'s number already contains FPI, ' +
  'every public efficiency model, injury news, and the money of people doing this full time. Nothing measured here ' +
  'shows an edge over that number yet. The tool is worth running because it makes the disagreements visible and ' +
  'keeps an honest record. It is not yet evidence that there is money in this.</p>';
}

/* ---------- about ---------- */
const TOTG = Object.keys(WK).reduce((s, k) => s + WK[k].length, 0);
$("aboutBody").innerHTML =
'<h4>What you are looking at</h4>' +
'<p>The 2026 college football schedule run through a rebuilt version of the model in the CFB 2025 spreadsheet. ' +
TOTG + ' games from week 1 through the bowls. Type in a line and it tells you which side it likes and by how much.</p>' +

'<div class="note">The 2026 season has not started, so no 2026 team data exists. Every rating here comes from 2025 ' +
'performance, shrunk ' + Math.round(C.REG * 100) + '% toward the national average because last year only carries so far. ' +
'That is the standard preseason approach and it is still a prior, not a forecast. Roster turnover, the transfer portal, ' +
'and coaching changes are not in it. Treat week 1 numbers with real suspicion.</div>' +

'<h4>What the spreadsheet was doing</h4>' +
'<p>Each week tab held one block per game. For both teams it pulled four national ranks from teamrankings (yards per ' +
'rush, yards per pass, opponent yards per rush, opponent yards per pass) and six EPA ranks from collegefootballdata. ' +
'It produced two numbers: <b>YPP</b>, the average of the four rank gaps, and <b>EPA</b>, the average of four matchup ' +
'rank gaps. Both still appear on the Matchup tab.</p>' +

'<h4>Why those two numbers could not be bet</h4>' +
'<p>They are averages of rank positions. A YPP of 11.75 means one side ranks about 12 spots better on average. That is ' +
'not 11.75 points, and the distance from #1 to #13 is a completely different amount of football than #101 to #113. ' +
'There was no way to compare either number to a spread, which is the one thing a handicapping sheet has to do.</p>' +

'<h4>What this model does instead</h4><ul>' +
'<li>Starts from EPA per play, which is already measured in points.</li>' +
'<li>Adjusts every offense and defense for the quality of opponents actually faced, solved iteratively across all 831 ' +
'games in the workbook. Raw 2025 numbers had Toledo 5th and Old Dominion 10th nationally. After adjustment they sit ' +
'42nd and 36th, and the top of the list matches the real 2025 playoff picture.</li>' +
'<li>Converts to a spread: <code>(home rating - away rating) &times; 61 plays + home field</code>.</li>' +
'<li>Regresses ' + Math.round(C.REG * 100) + '% toward average for 2026. The slider at the top changes it.</li></ul>' +

'<h4>How closely the 2025 version tracked the market</h4>' +
'<p>Against the ' + EV.n + ' lines recorded in the workbook it correlated ' + EV.corr + ' and landed a mean of ' + EV.mae +
' points away. The spread of its numbers matched the market almost exactly (sd ' + EV.sdModel + ' vs ' + EV.sdMarket +
'). That is a scale check, not a backtest: these ratings use full-season data applied backwards to lines set mid-season, ' +
'so the model knew things the market did not. It says the numbers are in the right units. It does not say the model beats anyone.</p>' +

'<h4>Bugs found in the original workbook</h4><ul>' +
'<li>SOS lookups stopped at row 135 while the SOS table ran to 137. Every Akron and UMass game returned an error on ' +
'strength of schedule, all season.</li>' +
'<li>A text formula left a trailing space on "Miami " in the SOS table, so every Miami game failed the same way.</li>' +
'<li>"MIssouri St" was typed with a capital I, and Missouri State is FCS, so that game had no data at all.</li>' +
'<li>The EPA defense rank used total PPA while the offense rank used PPA per play. Teams that faced more defensive ' +
'snaps were punished for it.</li>' +
'<li>"Success Pas" ranked passing-downs success rate instead of passing-plays success rate.</li>' +
'<li>The top half of the EPA/SOS Ranks tab was a dead copy with ranges cut off at row 132 and column indices shifted ' +
'by one, producing 427 errors and 44 broken references.</li>' +
'<li>82 of the 898 games in the workbook, about 9%, had at least one broken lookup.</li>' +
'<li>The Legend tab is a broken copy of a week tab with 195 broken references, not a legend.</li>' +
'<li>Column headers say 2021 and 2020 on every stat tab. The data is 2025 and 2024.</li></ul>' +

'<h4>The thing that mattered most</h4>' +
'<p>The workbook had columns built to track against-the-spread results. Not one score was ever entered, in any week, ' +
'all season. There is no record of whether the model won or lost. That is what the Tracker tab is for. Enter lines on ' +
'the Slate tab, hit log on the games you take, mark them win or loss, and by November you will know something you do ' +
'not know today.</p>' +

'<h4>What this still cannot do</h4><ul>' +
'<li>No 2026 data. Everything is a 2025 prior until games are played, and nothing updates automatically.</li>' +
'<li>No returning production, transfer portal, recruiting, or coaching changes.</li>' +
'<li>No injuries, weather, travel, or rest.</li>' +
'<li>No live odds. Type the lines in yourself.</li>' +
'<li>No proof it beats a closing line. Nobody has that until the picks are tracked.</li></ul>' +

'<h4>Sources</h4>' +
'<p>Team stats: collegefootballdata.com advanced season stats, 2025. Yards per attempt and schedule strength: ' +
'teamrankings.com. 2026 schedule: ESPN.</p>';

/* ---------- boot ---------- */
function renderAll() { renderMatchup(); drawSlate(); drawRank(); drawCalib(); }
$("seasonLbl").textContent = DATA.season + " season · ratings from " + DATA.prev;
loadLS();
syncGlobals();
renderAll();
drawTracker();
})();
