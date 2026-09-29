/* ui.js — 工程スケッチの画面(描画・操作・パネル・シミュレーション再生) */
"use strict";
(function () {
const { CAT, GROUPS, DEFAULTS, PROP_LABEL, isStation, isAgent, isMovable, isPoly, byId, rectOf, dist, outputName } = PS;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n, d) => (+n || 0).toLocaleString("ja-JP", { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 });
const track = (p, t) => { try { window.lxTrack && window.lxTrack("tool/sketch/" + p, t); } catch (e) { /* 計測は任意 */ } };
const AG_COLORS = ["#e07b1f", "#a8540a", "#f0a860", "#7a3f08", "#c96a14", "#f5c58f"]; // 人は橙系の濃淡で見分ける
const STORE = "ps.doc.v1";

// ===== 状態 =====
let doc = PS.newDoc();
let sel = null;              // {k:'obj'|'flow'|'dim', id}
let tool = "select";         // select | connect | dim | calib
let placeType = null;        // パレットで選んだ種類(クリックで置く)
let view = { s: 0.05, tx: 40, ty: 40 };
let undoS = [], redoS = [];
let sim = null, simRun = false, lastRes = null, prevRes = null;
let lastDay = null, docVer = 0;   // 1日分の計算結果 / 図の版(変更で増える → 結果が古いと分かる)
let drag = null;             // 進行中のドラッグ
let hover = null;            // マウス位置(ワールド)
let connectFrom = null, dimStart = null, calibPts = [];
let polyDraft = null;        // 多角形を描いている途中 {type, pts}
const PORT_COL = { in: "#2b3a48", out: "#2b3a48", op: PS.FN.person.c }; // 入/出は矢印の向きで区別、作業面は人の色
const GOODS = PS.FN.goods.c, GOODS_D = "#9a6a00";
const cv = $("#cv"), W = $("#world");

// ===== 保存・読込 =====
function save() { try { localStorage.setItem(STORE, JSON.stringify(doc)); } catch (e) { try { localStorage.setItem(STORE, JSON.stringify(Object.assign({}, doc, { bg: null }))); } catch (e2) { /* 保存不可の環境 */ } } }
// 共有URL・.json・検討シートから来たデータは信用しない: id と色は形を確かめ、寸法などは数値にする(画面の HTML にそのまま入るため)
const SAFE_ID = /^[\w-]{1,40}$/;
const okId = v => v == null || v === "" || SAFE_ID.test(String(v));
function cleanObj(o) {
  const x = Object.assign({}, o);
  for (const k of ["x", "y", "w", "h", "cap", "interval", "autoT", "manT", "swapT", "ngRate", "outQty", "speed", "dir"]) if (x[k] != null && x[k] !== "") x[k] = +x[k] || 0;
  if (x.portW != null && x.portW !== "") x.portW = +x.portW || "";
  if (x.color != null && !/^#[0-9a-f]{3,8}$/i.test(String(x.color))) delete x.color;
  if (Array.isArray(x.pts)) x.pts = x.pts.map(p => ({ x: +(p && p.x) || 0, y: +(p && p.y) || 0 })); else delete x.pts;
  if (!okId(x.op)) x.op = null;
  return x;
}
function normalize(d) {
  const n = Object.assign(PS.newDoc(), d);
  n.objs = (n.objs || []).filter(o => o && CAT[o.type] && SAFE_ID.test(String(o.id))).map(cleanObj).map(o => {
    const x = Object.assign({ edited: [] }, JSON.parse(JSON.stringify(DEFAULTS[o.type] || {})), o);
    if (isStation(x.type)) PS.ensurePorts(x);
    PS.migrateObj(x);
    if (isAgent(x.type) && x.dir == null) x.dir = -90;
    if (isPoly(x.type)) { x.pts = x.pts || []; if (x.pts.length) PS.polyBBox(x); }
    return x;
  }).filter(o => !isPoly(o.type) || o.pts.length >= 3);
  n.flows = (n.flows || []).filter(f => f && SAFE_ID.test(String(f.id)) && byId(n, f.from) && byId(n, f.to));
  for (const f of n.flows) { if (f.batch != null && f.batch !== "") f.batch = +f.batch || 1; if (!okId(f.agent)) f.agent = null; if (!okId(f.mover)) f.mover = null; if (Array.isArray(f.movers)) f.movers = f.movers.filter(v => SAFE_ID.test(String(v))); }
  n.dims = (Array.isArray(n.dims) ? n.dims : []).filter(m => m && SAFE_ID.test(String(m.id))).map(m => Object.assign({}, m, { x1: +m.x1 || 0, y1: +m.y1 || 0, x2: +m.x2 || 0, y2: +m.y2 || 0 }));
  const a0 = n.area || {}; n.area = { w: Math.max(1000, +a0.w || 20000), h: Math.max(1000, +a0.h || 12000) }; n.snap = +n.snap || 100;
  if (n.bg && !/^data:image\/[\w.+-]+;base64,[\w+/=]+$/.test(String(n.bg.src || ""))) n.bg = null;
  if (n.bg) for (const k of ["x", "y", "iw", "ih", "mmPerPx", "op"]) n.bg[k] = +n.bg[k] || 0;
  n.day = PS.dayOf(n.day);
  PS.autoOrient(n);
  return n;
}
function setDoc(d, keepUndo) {
  if (!keepUndo) { undoS = []; redoS = []; }
  doc = normalize(d); sel = null; lastRes = prevRes = lastDay = null; docVer++; $("#res").innerHTML = ""; switchTab("insp"); resetSim(); save(); syncHeader(); renderAll(); inspector();
}
function snapshot() { undoS.push(JSON.stringify(doc)); if (undoS.length > 80) undoS.shift(); redoS = []; }
function change(fn) { snapshot(); fn(); afterChange(); }
function afterChange() { docVer++; const st = $("#resStale"); if (st) st.hidden = false; doc.objs.forEach(PS.migrateObj); PS.autoOrient(doc); resetSim(); save(); renderAll(); inspector(); }
function undo() { if (!undoS.length) return; redoS.push(JSON.stringify(doc)); doc = normalize(JSON.parse(undoS.pop())); if (sel && !selObj() && !selFlow()) sel = null; afterChange(); }
function redo() { if (!redoS.length) return; undoS.push(JSON.stringify(doc)); doc = normalize(JSON.parse(redoS.pop())); afterChange(); }
function selObj() { return sel && sel.k === "obj" ? byId(doc, sel.id) : null; }
function selFlow() { return sel && sel.k === "flow" ? doc.flows.find(f => f.id === sel.id) : null; }

// ===== 座標 =====
function toWorld(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left - view.tx) / view.s, y: (e.clientY - r.top - view.ty) / view.s }; }
const snapV = (v, alt) => alt ? Math.round(v) : Math.round(v / doc.snap) * doc.snap;
function fit() {
  const r = cv.getBoundingClientRect(), m = 30;
  const s = Math.min((r.width - 2 * m) / doc.area.w, (r.height - 2 * m) / doc.area.h);
  view.s = Math.max(0.005, s);
  view.tx = (r.width - doc.area.w * view.s) / 2; view.ty = (r.height - doc.area.h * view.s) / 2;
  renderAll();
}

// ===== 描画ユーティリティ =====
function agentColor(d, id) {
  const o = byId(d, id); if (!o) return "#999";
  if (o.type === "robot") return PS.FN.move.c;
  const ws = d.objs.filter(x => x.type === "worker");
  return AG_COLORS[Math.max(0, ws.indexOf(o)) % AG_COLORS.length];
}
function clipToRect(o, t) {
  const dx = t.x - o.x, dy = t.y - o.y;
  if (!dx && !dy) return { x: o.x, y: o.y };
  const k = Math.min(dx ? (o.w / 2) / Math.abs(dx) : Infinity, dy ? (o.h / 2) / Math.abs(dy) : Infinity);
  return { x: o.x + dx * Math.min(1, k), y: o.y + dy * Math.min(1, k) };
}
function txt(x, y, s, size, opt) {
  opt = opt || {};
  return `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${opt.a || "middle"}" dominant-baseline="middle" fill="${opt.fill || "#1d2733"}" font-weight="${opt.b ? 700 : 400}"${opt.halo ? ` paint-order="stroke" stroke="#fff" stroke-width="${opt.halo}" stroke-linejoin="round"` : ""}>${esc(s)}</text>`;
}
function stationSub(d, o) {
  const ins = d.flows.filter(f => f.to === o.id).map(f => { const n = outputName(d, byId(d, f.from)); const q = o.type === "join" ? PS.inQty(o, f.id) : 1; return n + (q > 1 ? "×" + q : ""); });
  const uniq = [...new Set(ins)], out = outputName(d, o), oq = PS.isTimed(o.type) && o.type !== "inspect" ? PS.outQty(o) : 1;
  const q1 = o.type !== "join" && PS.isTimed(o.type) && PS.inQty(o) > 1 ? "×" + PS.inQty(o) : "";
  if (o.type === "process" || o.type === "bench") return `${uniq.join("/") || "A"}${q1} → ${out === "?" ? "B" : out}${oq > 1 ? "×" + oq : ""}`;
  if (o.type === "join") return `${ins.join(" + ") || "A + B"} → ${out === "?" ? "C" : out}${oq > 1 ? "×" + oq : ""}`;
  if (o.type === "inspect") return `${uniq.join("/") || "A"} = ${uniq.join("/") || "A"}${o.ngRate ? `  NG${o.ngRate}%` : ""}`;
  if (o.type === "buffer") return `最大 ${o.cap} 個`;
  return "";
}
function timeLabel(o) {
  if (!PS.isTimed(o.type)) return "";
  const a = +o.autoT || 0, m = +o.manT || 0, parts = [];
  if (a) parts.push(`自動 ${fmt(a)}秒`);
  if (m) parts.push(`人 ${fmt(m)}秒`);
  if (!parts.length) parts.push("0秒");
  const tmp = !(o.edited || []).some(k => k === "autoT" || k === "manT");
  if (o.parallel) { // 自動と人は同時に進むので、長い方だけを足す
    const sw = +o.swapT || 0;
    return `自動${fmt(a)}秒・人${fmt(m)}秒は同時 → ${fmt(Math.max(a, m))}秒` + (sw ? ` + 入替${fmt(sw)}秒 = ${fmt(Math.max(a, m) + sw)}秒` : "") + (tmp ? " (仮)" : "");
  }
  return parts.join(" + ") + (a && m ? ` = ${fmt(a + m)}秒` : "") + (tmp ? " (仮)" : "");
}

// 1つのオブジェクトの SVG。S = px/mm(画面上で一定サイズにしたい線・文字に使う)
function objSVG(d, o, S, opt) {
  opt = opt || {};
  const c = CAT[o.type], r = rectOf(o), px = k => k / S;
  const nm = o.name || c.label;
  const fs = Math.max(px(9), Math.min(o.h * 0.2, o.w * 0.13, 420));
  const sw = px(1.4);
  const base = `data-id="${o.id}"`;
  let g = "";
  switch (o.type) {
    case "process": case "join": case "inspect": case "bench": case "buffer": {
      g += `<rect x="${r.x0}" y="${r.y0}" width="${o.w}" height="${o.h}" fill="${c.color}" fill-opacity=".08" stroke="${c.color}" stroke-width="${px(1.8)}"/>`;
      if (o.type === "buffer") for (let i = 1; i < 3; i++) g += `<line x1="${r.x0}" x2="${r.x1}" y1="${r.y0 + o.h * i / 3}" y2="${r.y0 + o.h * i / 3}" stroke="${c.color}" stroke-opacity=".5" stroke-width="${sw}"/>`;
      const tl = timeLabel(o), f2 = tl ? Math.max(px(9), Math.min(o.h * 0.16, o.w * 0.11, 380)) : fs;
      g += txt(o.x, o.y - f2 * (tl ? 1.15 : 0.62), nm, f2, { b: 1, halo: o.type === "buffer" ? px(3) : 0 });
      g += txt(o.x, o.y + (tl ? 0 : f2 * 0.62), stationSub(d, o), f2 * 0.72, { fill: c.color, b: 1, halo: o.type === "buffer" ? px(3) : 0 });
      if (tl) g += txt(o.x, o.y + f2 * 1.0, tl, f2 * 0.66, { fill: "#3b4652", b: 1 });
      if (o.needOp) { // 人が付く印
        const R = Math.min(fs * 0.5, o.h * 0.14), cx = r.x1 - R * 1.6, cy = r.y0 + R * 1.6, col = o.op ? agentColor(d, o.op) : "#d9534f";
        g += `<circle cx="${cx}" cy="${cy - R * 0.45}" r="${R * 0.42}" fill="${col}"/><path d="M${cx - R * 0.8} ${cy + R * 0.9} Q${cx} ${cy - R * 0.3} ${cx + R * 0.8} ${cy + R * 0.9}Z" fill="${col}"/>`;
      }
      break;
    }
    case "in": case "out": {
      g += `<rect x="${r.x0}" y="${r.y0}" width="${o.w}" height="${o.h}" fill="${c.color}" fill-opacity=".1" stroke="${c.color}" stroke-width="${px(1.8)}" stroke-dasharray="${px(6)} ${px(4)}"/>`;
      g += txt(o.x, o.y - fs * 0.5, (o.type === "in" ? "▶ " : "") + nm + (o.type === "out" ? " ▶" : ""), fs, { b: 1, fill: c.color });
      g += txt(o.x, o.y + fs * 0.65, o.type === "in" ? `${o.item || "?"}${o.interval ? ` 1個/${o.interval}秒` : " 常にある"}` : outputName(d, o) === "?" ? "完成品" : outputName(d, o), fs * 0.75, { fill: c.color });
      break;
    }
    case "part": {
      g += `<rect x="${r.x0}" y="${r.y0}" width="${o.w}" height="${o.h}" fill="${c.color}" fill-opacity=".08" stroke="${c.color}" stroke-width="${px(1.6)}"/>`;
      const b = Math.min(o.w, o.h) * 0.26;
      refreshPack(d);
      [[-1.1, 0.25], [0, 0.25], [1.1, 0.25], [-0.55, -0.8], [0.55, -0.8]].forEach(([i, j]) => { g += o.boxed ? tpBox(o.x + i * b, o.y + j * b + b * 0.25, b, S, PS.packOf(d, o)) : box(o.x + i * b, o.y + j * b + b * 0.25, b, S, o.item); });
      g += txt(o.x, r.y0 - fs * 0.6, `${nm}(${o.item}${o.count ? "×" + o.count : ""})`, fs * 0.8, { b: 1, halo: px(3) });
      break;
    }
    case "container": case "cart": {
      if (opt.hide) break;
      g += moverSVG(o, o.x, o.y, 0, "", S);
      g += txt(o.x, r.y1 + fs * 0.7, nm, fs * 0.75, { halo: px(3) });
      break;
    }
    case "worker": case "robot": {
      if (opt.hide) break;
      g += agentSVG(d, o, o.x, o.y, S, false);
      break;
    }
    case "wall":
      g += `<rect x="${r.x0}" y="${r.y0}" width="${o.w}" height="${o.h}" fill="#5b6470" fill-opacity=".82" stroke="#3b424b" stroke-width="${sw}"/>`;
      if (o.h > px(14) && o.w > px(40) && o.name) g += txt(o.x, o.y, nm, Math.min(fs, o.h * 0.5), { fill: "#fff", b: 1 });
      break;
    case "walk": case "nogo": {
      if (!o.pts || o.pts.length < 3) break;
      const pts = o.pts.map(q => `${q.x},${q.y}`).join(" "), col = c.color, ng = o.type === "nogo";
      g += `<polygon points="${pts}" fill="${ng ? "url(#psHatch)" : col}" fill-opacity="${ng ? 1 : 0.12}" stroke="${col}" stroke-width="${px(1.8)}" stroke-dasharray="${px(7)} ${px(4)}" style="pointer-events:none"/>`;
      g += `<polygon points="${pts}" fill="none" stroke="transparent" stroke-width="${px(12)}" style="pointer-events:stroke;cursor:move"/>`;
      const top = o.pts.reduce((m, q) => (q.y < m.y || (q.y === m.y && q.x < m.x)) ? q : m, o.pts[0]);
      g += txt(top.x + px(6), top.y + px(11), `${nm} ${fmt(PS.polyArea(o.pts) / 1e6, 1)}m²`, px(10.5), { a: "start", b: 1, fill: ng ? "#a33" : "#1f7a45", halo: px(3) });
      break;
    }
    case "zone":
      g += `<rect x="${r.x0}" y="${r.y0}" width="${o.w}" height="${o.h}" fill="${o.color || c.color}" fill-opacity=".22" stroke="${o.color || c.color}" stroke-width="${sw}" stroke-dasharray="${px(5)} ${px(3)}"/>`;
      g += txt(r.x0 + px(6), r.y0 + Math.max(px(10), fs * 0.6), o.text || nm, Math.max(px(10), Math.min(fs, 380)), { a: "start", b: 1, fill: "#3a5f7d" });
      break;
    case "note":
      g += `<rect x="${r.x0}" y="${r.y0}" width="${o.w}" height="${o.h}" fill="transparent"/>`;
      g += txt(o.x, o.y, o.text || "メモ", Math.max(px(9), o.h * 0.55), { b: 1, fill: "#333" });
      break;
  }
  if (isStation(o.type)) g += portsSVG(o, S);
  return `<g ${base} class="ob">${g}</g>`;
}
// 出し入れ面: 面の上の色帯+矢印(入=外から中へ / 出=中から外へ)、作業する面は足あと
function portsSVG(o, S) {
  const px = k => k / S;
  let g = "";
  const shared = PS.sharedPort(o);
  for (const role of PS.portRoles(o)) {
    if (shared && role === "out") continue; // 「入」の所で1つの口として描く
    const p = PS.portPoint(o, role), col = PORT_COL[role], tx = -p.ny, ty = p.nx;
    if (shared && role === "in") { g += sharedPortSVG(o, p, S); continue; }
    g += `<g data-port="${role}" data-pid="${o.id}" style="cursor:grab">`;
    if (role === "op") {
      const sx = p.x + p.nx * PS.STAND, sy = p.y + p.ny * PS.STAND, ang = Math.atan2(-p.ny, -p.nx) * 180 / Math.PI;
      g += `<g transform="translate(${sx} ${sy}) rotate(${ang})"><circle r="230" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="${px(1.2)}" stroke-dasharray="${px(3)} ${px(2)}"/>
        <ellipse cx="40" cy="-75" rx="95" ry="42" fill="${col}" fill-opacity=".75"/><ellipse cx="40" cy="75" rx="95" ry="42" fill="${col}" fill-opacity=".75"/></g></g>`;
      continue;
    }
    const half = o.portW ? Math.min(p.faceLen / 2, o.portW / 2) : Math.min(p.len * 0.4, 700), ins = px(2.5), ax = p.x - p.nx * ins, ay = p.y - p.ny * ins;
    g += `<line x1="${ax - tx * half}" y1="${ay - ty * half}" x2="${ax + tx * half}" y2="${ay + ty * half}" stroke="${col}" stroke-width="${px(4.5)}" stroke-linecap="round"/>`;
    const L = px(10), Wd = px(6.5), bx = p.x + p.nx * px(9), by = p.y + p.ny * px(9), dir = role === "in" ? -1 : 1;
    const tipx = bx + p.nx * dir * L / 2, tipy = by + p.ny * dir * L / 2, bsx = bx - p.nx * dir * L / 2, bsy = by - p.ny * dir * L / 2;
    g += `<path d="M${tipx} ${tipy}L${bsx + tx * Wd} ${bsy + ty * Wd}L${bsx - tx * Wd} ${bsy - ty * Wd}Z" fill="${col}"/>`;
    g += txt(bx + p.nx * px(13) + tx * px(13), by + p.ny * px(13) + ty * px(13), role === "in" ? "入" : "出", px(9.5), { b: 1, fill: col, halo: px(2.5) });
    g += `<line x1="${ax - tx * half}" y1="${ay - ty * half}" x2="${ax + tx * half}" y2="${ay + ty * half}" stroke="transparent" stroke-width="${px(16)}" style="pointer-events:stroke"/>`;
    g += `<circle cx="${bx}" cy="${by}" r="${px(10)}" fill="transparent" style="pointer-events:all"/></g>`;
  }
  return g;
}
// 出し入れ口(共有): 面の中央に口の枠、内向き・外向きの矢印を並べ、「入出」と表示
function sharedPortSVG(o, p, S) {
  const px = k => k / S, col = PORT_COL.in, tx = -p.ny, ty = p.nx;
  const half = o.portW ? Math.min(p.faceLen / 2, o.portW / 2) : Math.min(p.len * 0.3, 450), ins = px(2.5), ax = p.x - p.nx * ins, ay = p.y - p.ny * ins;
  let g = `<g data-port="io" data-pid="${o.id}" style="cursor:grab">`;
  // 口: 面に切り欠き(白抜き)+ 両端のつば
  g += `<line x1="${ax - tx * half}" y1="${ay - ty * half}" x2="${ax + tx * half}" y2="${ay + ty * half}" stroke="${col}" stroke-width="${px(6)}"/>`;
  g += `<line x1="${ax - tx * half * 0.8}" y1="${ay - ty * half * 0.8}" x2="${ax + tx * half * 0.8}" y2="${ay + ty * half * 0.8}" stroke="#fff" stroke-width="${px(2)}"/>`;
  for (const k of [-1, 1]) g += `<line x1="${p.x + tx * half * k}" y1="${p.y + ty * half * k}" x2="${p.x + tx * half * k + p.nx * px(9)}" y2="${p.y + ty * half * k + p.ny * px(9)}" stroke="${col}" stroke-width="${px(2)}"/>`;
  // 入れる(内向き)と取り出す(外向き)の矢印を左右に並べる
  const L = px(10), Wd = px(5.5), bx = p.x + p.nx * px(10), by = p.y + p.ny * px(10), sep = px(7.5);
  for (const [dir, k] of [[-1, -1], [1, 1]]) {
    const cx = bx + tx * sep * k, cy = by + ty * sep * k;
    const tipx = cx + p.nx * dir * L / 2, tipy = cy + p.ny * dir * L / 2, bsx = cx - p.nx * dir * L / 2, bsy = cy - p.ny * dir * L / 2;
    g += `<path d="M${tipx} ${tipy}L${bsx + tx * Wd} ${bsy + ty * Wd}L${bsx - tx * Wd} ${bsy - ty * Wd}Z" fill="${col}"/>`;
  }
  g += txt(p.x + tx * (half + px(16)) + p.nx * px(9), p.y + ty * (half + px(16)) + p.ny * px(9), "入出", px(10), { b: 1, fill: col, halo: px(2.5) }); // 作業者が口の前に立っても隠れないよう横に
  g += `<line x1="${ax - tx * half}" y1="${ay - ty * half}" x2="${ax + tx * half}" y2="${ay + ty * half}" stroke="transparent" stroke-width="${px(18)}" style="pointer-events:stroke"/>`;
  g += `<circle cx="${bx}" cy="${by}" r="${px(13)}" fill="transparent" style="pointer-events:all"/></g>`;
  return g;
}
function moverSVG(o, x, y, load, name, S, ang) {
  const px = k => k / S, w = o.w, h = o.h, x0 = -w / 2, y0 = -h / 2, c = CAT[o.type].color;
  let g = "";
  if (o.type === "cart") {
    const wr = Math.min(w, h) * 0.09;
    g += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#fff" fill-opacity=".9" stroke="${c}" stroke-width="${px(1.6)}"/>`;
    [[x0 + wr * 1.6, y0 + wr * 1.6], [x0 + w - wr * 1.6, y0 + wr * 1.6], [x0 + wr * 1.6, y0 + h - wr * 1.6], [x0 + w - wr * 1.6, y0 + h - wr * 1.6]].forEach(([a, b]) => { g += `<circle cx="${a}" cy="${b}" r="${wr}" fill="${c}"/>`; });
    g += `<line x1="${x0 - h * 0.12}" y1="${y0 + h * 0.15}" x2="${x0 - h * 0.12}" y2="${y0 + h * 0.85}" stroke="${c}" stroke-width="${px(2.5)}" stroke-linecap="round"/>`;
  } else {
    g += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#eef6f1" stroke="${c}" stroke-width="${px(1.6)}"/>`;
    g += `<rect x="${x0 + w * 0.07}" y="${y0 + h * 0.1}" width="${w * 0.86}" height="${h * 0.8}" fill="none" stroke="${c}" stroke-opacity=".6" stroke-width="${px(1)}"/>`;
    for (let i = 1; i < 4; i++) g += `<line x1="${x0 + w * i / 4}" y1="${y0 + h * 0.1}" x2="${x0 + w * i / 4}" y2="${y0 + h * 0.9}" stroke="${c}" stroke-opacity=".3" stroke-width="${px(0.8)}"/>`;
    g += `<rect x="${x0 + w * 0.015}" y="${y0 + h * 0.36}" width="${w * 0.035}" height="${h * 0.28}" fill="${c}"/><rect x="${x0 + w * 0.95}" y="${y0 + h * 0.36}" width="${w * 0.035}" height="${h * 0.28}" fill="${c}"/>`;
  }
  if (o.type === "container") { // 中身を箱の中に並べる(入る数 cap のうち load 個)
    const cap = Math.max(1, Math.round(+o.cap || 1)), cols = Math.max(1, Math.ceil(Math.sqrt(cap * w / h))), rows = Math.ceil(cap / cols);
    const cw = w * 0.84 / cols, ch = h * 0.76 / rows, b = Math.min(cw, ch) * 0.86;
    for (let i = 0; i < Math.min(load || 0, cap); i++) g += partShape(x0 + w * 0.08 + cw * (i % cols + 0.5), y0 + h * 0.12 + ch * (Math.floor(i / cols) + 0.5), b, S, PACK[name] || "resin");
  }
  let out = `<g transform="translate(${x} ${y}) rotate(${(ang || 0) * 180 / Math.PI})">${g}</g>`;
  if (o.type === "container") out += txt(x, y - h / 2 - px(8), load ? `${load}/${Math.round(+o.cap || 1)}` : "空", px(9.5), { b: 1, fill: load ? GOODS_D : "#8c9299", halo: px(2.5) });
  else if (load) out += tokens(x, y, load, name, Math.min(w, h) * 0.22, S, Math.min(w * 0.8, 6));
  return out;
}
// モノ1個の箱。十分大きいときは名前の頭文字を入れる
// モノ1個の絵(上から見た形)。荷姿: 樹脂部品=黒い成形品 / 金属部品=銀色のブラケット / TPポリ箱=通い箱
let PACK = {};
function refreshPack(d) { PACK = PS.packMap(d); }
function partShape(x, y, b, S, pack) {
  const px = k => k / S, h = b / 2;
  if (pack === "metal") { // 穴あきのL形ブラケット(プレス品)
    return `<path d="M${x - h} ${y - h}H${x + h * 0.15}V${y + h * 0.1}H${x + h}V${y + h}H${x - h}Z" fill="#c3cad2" stroke="#6b7580" stroke-width="${px(0.9)}"/>`
      + `<circle cx="${x - h * 0.45}" cy="${y - h * 0.45}" r="${h * 0.16}" fill="#6b7580"/><circle cx="${x + h * 0.55}" cy="${y + h * 0.55}" r="${h * 0.16}" fill="#6b7580"/><circle cx="${x - h * 0.45}" cy="${y + h * 0.5}" r="${h * 0.12}" fill="#6b7580"/>`;
  }
  // 樹脂の成形品(アーチ形のカバー類)
  return `<path d="M${x - h} ${y + h * 0.75}C${x - h} ${y - h * 0.9} ${x + h} ${y - h * 0.9} ${x + h} ${y + h * 0.75}L${x + h * 0.45} ${y + h * 0.75}C${x + h * 0.45} ${y - h * 0.2} ${x - h * 0.45} ${y - h * 0.2} ${x - h * 0.45} ${y + h * 0.75}Z" fill="#3f454c" stroke="#1d2126" stroke-width="${px(0.8)}"/>`
    + `<circle cx="${x - h * 0.72}" cy="${y + h * 0.35}" r="${h * 0.09}" fill="#8b939c"/><circle cx="${x + h * 0.72}" cy="${y + h * 0.35}" r="${h * 0.09}" fill="#8b939c"/>`;
}
function tpBox(x, y, b, S, full) {
  const px = k => k / S, w = b, hh = b * 0.72, x0 = x - w / 2, y0 = y - hh / 2, rim = b * 0.08;
  let g = `<rect x="${x0}" y="${y0}" width="${w}" height="${hh}" fill="${GOODS}" stroke="${GOODS_D}" stroke-width="${px(0.9)}"/>`;
  g += `<rect x="${x0 + rim}" y="${y0 + rim}" width="${w - rim * 2}" height="${hh - rim * 2}" fill="#f0c25e" stroke="${GOODS_D}" stroke-opacity=".6" stroke-width="${px(0.6)}"/>`;
  // 底のリブ
  if (b * S >= 9) for (let i = 1; i < 4; i++) g += `<line x1="${x0 + w * i / 4}" y1="${y0 + rim}" x2="${x0 + w * i / 4}" y2="${y0 + hh - rim}" stroke="${GOODS_D}" stroke-opacity=".35" stroke-width="${px(0.5)}"/>`;
  // 短辺の取っ手穴
  g += `<rect x="${x0 + rim * 0.2}" y="${y - hh * 0.14}" width="${rim * 0.6}" height="${hh * 0.28}" fill="${GOODS_D}"/><rect x="${x0 + w - rim * 0.8}" y="${y - hh * 0.14}" width="${rim * 0.6}" height="${hh * 0.28}" fill="${GOODS_D}"/>`;
  if (full) g += partShape(x, y + hh * 0.02, Math.min(w * 0.5, hh * 0.7), S, full === true ? "resin" : full);
  return g;
}
function box(x, y, b, S, name, done) {
  const px = k => k / S, pack = PACK[name] || "resin";
  let g = partShape(x, y, b * 0.95, S, pack);
  if (done) g += `<circle cx="${x + b * 0.36}" cy="${y - b * 0.3}" r="${b * 0.2}" fill="#fff" stroke="#2f9e62" stroke-width="${px(0.8)}"/><path d="M${x + b * 0.27} ${y - b * 0.3}L${x + b * 0.34} ${y - b * 0.22}L${x + b * 0.46} ${y - b * 0.39}" stroke="#2f9e62" stroke-width="${Math.max(px(1), b * 0.06)}" fill="none"/>`;
  return g;
}
// 設備の面の内側に、溜まっているモノを並べる(role: in=入れる前 / out=出来た)
function pileSVG(o, role, n, name, S, done, boxed) {
  if (!n) return "";
  const px = k => k / S, p0 = PS.portPoint(o, role), tx = -p0.ny, ty = p0.nx;
  const sh = p0.shared, shift = sh ? (role === "in" ? -1 : 1) * Math.min(p0.faceLen * 0.25, 600) : 0;
  const p = Object.assign({}, p0, { x: p0.x + tx * shift, y: p0.y + ty * shift });
  const b = Math.max(px(6), Math.min(220, Math.min(o.w, o.h) * 0.16)), gap = b * 1.18;
  const cols = Math.max(1, Math.min(6, Math.floor((sh ? Math.min(p0.faceLen * 0.45, 1100) : p.len * 0.8) / gap))), rows = Math.max(1, Math.min(3, Math.floor(Math.min(o.w, o.h) * 0.3 / gap)));
  const show = Math.min(n, cols * rows);
  let g = "";
  for (let i = 0; i < show; i++) {
    const cI = i % cols, rI = Math.floor(i / cols), off = (cI - (Math.min(show, cols) - 1) / 2) * gap, dep = b * 0.75 + rI * gap;
    g += boxed ? tpBox(p.x + tx * off - p.nx * dep, p.y + ty * off - p.ny * dep, b, S, PACK[name] || "resin") : box(p.x + tx * off - p.nx * dep, p.y + ty * off - p.ny * dep, b, S, name, done);
  }
  const lx = p.x - p.nx * (b * 0.75 + rows * gap + px(6)) , ly = p.y - p.ny * (b * 0.75 + rows * gap + px(6));
  if (n > show || n > 1) g += txt(lx, ly, (role === "in" ? "待 " : "済 ") + n, px(9.5), { b: 1, fill: GOODS_D, halo: px(2.5) });
  return g;
}
function tokens(x, y, n, name, b, S, maxCols) {
  const px = k => k / S, show = Math.min(n, 12), cols = Math.max(1, Math.min(maxCols || 4, show)), rows = Math.ceil(show / cols);
  let g = "";
  for (let i = 0; i < show; i++) {
    const cx = x + (i % cols - (cols - 1) / 2) * b * 1.15, cy = y + (Math.floor(i / cols) - (rows - 1) / 2) * b * 1.15;
    g += box(cx, cy, b, S, name);
  }
  if (n > 12 || name) g += txt(x, y - rows * b * 0.6 - px(8), `${name || ""}${n > 1 ? "×" + n : ""}`, px(10), { b: 1, halo: px(3), fill: "#7a5200" });
  return g;
}
// 人・ロボットを上から見た絵。体の向き(st.h[rad] / o.dir[度])に回転。
// st: {h, pose:"reach"=手を前に出す, walking, phase=歩いた距離(足の振り), holding=台車/コンテナを持っている, act=状態}
function agentSVG(d, o, x, y, S, simMode, carry, carryName, st) {
  st = st || {};
  const px = k => k / S, col = agentColor(d, o.id);
  const deg = st.h != null ? st.h * 180 / Math.PI : (o.dir == null ? -90 : +o.dir);
  let b = "";
  if (o.type === "worker") {
    const R = o.w / 2;
    const sw = st.walking ? Math.sin((st.phase || 0) / 300 * Math.PI) * R * 0.5 : 0;
    b += `<ellipse cx="${R * 0.12 + sw}" cy="${-R * 0.34}" rx="${R * 0.3}" ry="${R * 0.15}" fill="#3b3b3b"/><ellipse cx="${R * 0.12 - sw}" cy="${R * 0.34}" rx="${R * 0.3}" ry="${R * 0.15}" fill="#3b3b3b"/>`;
    const arm = (x1, y1, x2, y2) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${col}" stroke-width="${R * 0.26}" stroke-linecap="round"/>`;
    if (st.pose === "reach") { const L = PS.STAND - 30; b += arm(0, -R * 0.75, L, -R * 0.3) + arm(0, R * 0.75, L, R * 0.3); } // 面(500mm先)まで手を伸ばす
    else if (st.holding) b += arm(0, -R * 0.75, R * 1.05, -R * 0.62) + arm(0, R * 0.75, R * 1.05, R * 0.62);
    else if (carry) b += arm(0, -R * 0.75, R * 0.8, -R * 0.42) + arm(0, R * 0.75, R * 0.8, R * 0.42)
      + `<g transform="translate(${R * 0.95} 0) rotate(90)">${box(0, 0, R * 1.05, S, carryName)}</g>`;
    else b += arm(-R * 0.05, -R * 0.8, R * 0.22, -R * 0.86) + arm(-R * 0.05, R * 0.8, R * 0.22, R * 0.86);
    b += `<ellipse cx="0" cy="0" rx="${R * 0.42}" ry="${R * 0.9}" fill="${col}" stroke="#fff" stroke-width="${px(1)}"/>`;
    b += `<circle cx="${R * 0.05}" cy="0" r="${R * 0.4}" fill="#fff" stroke="#6b7682" stroke-width="${px(0.9)}"/>`;
    b += `<path d="M${R * 0.22} ${-R * 0.2}L${R * 0.58} 0L${R * 0.22} ${R * 0.2}Z" fill="${col}"/>`; // 顔の向き
  } else {
    const w = o.w, h = o.h;
    b += `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${h * 0.06}" fill="#eef2f5" stroke="${col}" stroke-width="${px(2)}"/>`;
    b += `<rect x="${w / 2 - w * 0.12}" y="${-h / 2 + h * 0.12}" width="${w * 0.06}" height="${h * 0.76}" fill="${col}"/>`;
    b += `<rect x="${-w * 0.28}" y="${-h * 0.3}" width="${w * 0.4}" height="${h * 0.6}" rx="${h * 0.05}" fill="#dfe6ec" stroke="#9aa7b3" stroke-width="${px(0.8)}"/>`;
    if (st.pose === "reach") b += `<path d="M${-w * 0.08} 0L${w * 0.5} ${-h * 0.1}L${w * 0.82} 0" stroke="#fff" stroke-width="${h * 0.14}" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M${-w * 0.08} 0L${w * 0.5} ${-h * 0.1}L${w * 0.82} 0" stroke="#9aa7b3" stroke-width="${px(1)}" fill="none"/><rect x="${w * 0.8}" y="${-h * 0.1}" width="${w * 0.08}" height="${h * 0.2}" fill="#333"/>`;
    b += `<circle cx="${-w * 0.08}" cy="0" r="${h * 0.17}" fill="#fff" stroke="#3EB370" stroke-width="${px(2)}"/>`;
  }
  let g = `<g transform="translate(${x} ${y}) rotate(${deg})">${b}</g>`;
  if (carry && o.type === "robot") g += tokens(x, y - Math.max(o.h * 0.6, px(10)), carry, carryName, Math.max(px(4), 130), S, 3);
  else if (carry > 1) g += txt(x + o.w * 0.7, y - o.h * 0.6, `${carryName}×${carry}`, px(9.5), { b: 1, fill: GOODS_D, halo: px(2.5) });
  g += txt(x, y + o.h / 2 + px(9), o.name || CAT[o.type].label, px(10.5), { b: 1, halo: px(3), fill: col });
  if (simMode && st.act) g += txt(x, y + o.h / 2 + px(20), st.act, px(9), { halo: px(3), fill: "#5d6b7a" });
  return g;
}

// モノの流れ(矢印)
function flowSVG(d, f, S, selected) {
  const a = byId(d, f.from), b = byId(d, f.to); if (!a || !b) return "";
  const px = k => k / S;
  const rev = d.flows.some(g => g.from === f.to && g.to === f.from);
  const pa = isStation(a.type) ? PS.portPoint(a, "out") : Object.assign(clipToRect(a, b), { nx: 0, ny: 0 });
  const pb = isStation(b.type) ? PS.portPoint(b, "in") : Object.assign(clipToRect(b, a), { nx: 0, ny: 0 });
  let p0 = { x: pa.x + pa.nx * px(16), y: pa.y + pa.ny * px(16) }, p1 = { x: pb.x + pb.nx * px(16), y: pb.y + pb.ny * px(16) };
  const dx = p1.x - p0.x, dy = p1.y - p0.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  if (rev) { const o = px(7); p0 = { x: p0.x - uy * o, y: p0.y + ux * o }; p1 = { x: p1.x - uy * o, y: p1.y + ux * o }; }
  const col = f.mode === "auto" ? "#8c9299" : f.agent ? agentColor(d, f.agent) : "#d9534f";
  const dash = f.mode === "auto" ? `stroke-dasharray="${px(8)} ${px(4)}"` : !f.agent ? `stroke-dasharray="${px(3)} ${px(3)}"` : "";
  const ah = px(11), aw = px(6);
  const e = { x: p1.x - ux * ah, y: p1.y - uy * ah };
  const mv = f.mover ? byId(d, f.mover) : null;
  const label = `${outputName(d, a)}${f.mode === "auto" ? " 自動" : mv ? ` ${mv.name}×${mv.cap}` : (f.batch > 1 ? ` ×${f.batch}` : "")}`;
  const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
  return `<g data-flow="${f.id}" class="fl">
    <line x1="${p0.x}" y1="${p0.y}" x2="${p1.x}" y2="${p1.y}" stroke="transparent" stroke-width="${px(14)}" style="pointer-events:stroke"/>
    ${selected ? `<line x1="${p0.x}" y1="${p0.y}" x2="${e.x}" y2="${e.y}" stroke="#0068B7" stroke-opacity=".25" stroke-width="${px(9)}"/>` : ""}
    <line x1="${p0.x}" y1="${p0.y}" x2="${e.x}" y2="${e.y}" stroke="${col}" stroke-width="${px(2.6)}" ${dash}/>
    <path d="M${p1.x} ${p1.y} L${e.x - uy * aw} ${e.y + ux * aw} L${e.x + uy * aw} ${e.y - ux * aw}Z" fill="${col}"/>
    ${txt(mx, my, label, px(10.5), { b: 1, halo: px(3.5), fill: col })}
  </g>`;
}

function dimSVG(x1, y1, x2, y2, S, opt) {
  opt = opt || {};
  const px = k => k / S, L = Math.hypot(x2 - x1, y2 - y1); if (L < 1) return "";
  const ux = (x2 - x1) / L, uy = (y2 - y1) / L, nx = -uy, ny = ux, t = px(5);
  const col = opt.col || "#0b5394";
  const lab = fmt(Math.round(L));
  const ang = Math.atan2(uy, ux) * 180 / Math.PI, a2 = ang > 90 || ang < -90 ? ang + 180 : ang;
  const mx = (x1 + x2) / 2 + nx * px(8), my = (y1 + y2) / 2 + ny * px(8);
  return `<g ${opt.id ? `data-dim="${opt.id}"` : ""}>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="transparent" stroke-width="${px(10)}" style="pointer-events:stroke"/>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${px(1.2)}"/>
    <line x1="${x1 - nx * t}" y1="${y1 - ny * t}" x2="${x1 + nx * t}" y2="${y1 + ny * t}" stroke="${col}" stroke-width="${px(1.2)}"/>
    <line x1="${x2 - nx * t}" y1="${y2 - ny * t}" x2="${x2 + nx * t}" y2="${y2 + ny * t}" stroke="${col}" stroke-width="${px(1.2)}"/>
    <g transform="rotate(${a2} ${mx} ${my})">${txt(mx, my, lab + (opt.suffix || ""), px(opt.fs || 10.5), { b: 1, halo: px(3), fill: col })}</g></g>`;
}

// 静的レイヤー全体(書き出しでも使う)
function staticSVG(d, S, opt) {
  opt = opt || {};
  refreshPack(d);
  const px = k => k / S, A = d.area;
  let g = `<defs><pattern id="psHatch" patternUnits="userSpaceOnUse" width="400" height="400" patternTransform="rotate(45)"><rect width="400" height="400" fill="#d9534f" fill-opacity=".06"/><line x1="0" y1="0" x2="0" y2="400" stroke="#d9534f" stroke-opacity=".4" stroke-width="50"/></pattern></defs>`;
  // エリアとグリッド
  g += `<rect x="0" y="0" width="${A.w}" height="${A.h}" fill="#fff" fill-opacity="${d.bg && !opt.noBg ? 0.35 : 1}" stroke="#34495e" stroke-width="${px(2)}"/>`;
  const step = S * 1000 < 12 ? 5000 : 1000;
  let gl = "";
  for (let x = step; x < A.w; x += step) gl += `M${x} 0V${A.h}`;
  for (let y = step; y < A.h; y += step) gl += `M0 ${y}H${A.w}`;
  g += `<path d="${gl}" stroke="#b9c7d5" stroke-opacity=".55" stroke-width="${px(0.7)}" fill="none"/>`;
  if (S * 500 > 14) { let gm = ""; for (let x = 500; x < A.w; x += 1000) gm += `M${x} 0V${A.h}`; for (let y = 500; y < A.h; y += 1000) gm += `M0 ${y}H${A.w}`; g += `<path d="${gm}" stroke="#d8e1ea" stroke-opacity=".5" stroke-width="${px(0.5)}" fill="none"/>`; }
  // 外形寸法
  g += dimSVG(0, -px(18), A.w, -px(18), S, { col: "#34495e" }) + dimSVG(-px(18), A.h, -px(18), 0, S, { col: "#34495e" });
  const order = ["walk", "nogo", "zone", "wall", "in", "out", "part", "buffer", "process", "join", "inspect", "bench", "note"];
  for (const t of order) for (const o of d.objs) if (o.type === t) g += objSVG(d, o, S);
  for (const f of d.flows) g += flowSVG(d, f, S, !opt.clean && sel && sel.k === "flow" && sel.id === f.id);
  for (const dm of d.dims || []) g += dimSVG(dm.x1, dm.y1, dm.x2, dm.y2, S, { id: dm.id, col: !opt.clean && sel && sel.k === "dim" && sel.id === dm.id ? "#d9534f" : "#0b5394" });
  if (!opt.noMovers) {
    for (const o of d.objs) if (isMovable(o.type)) g += objSVG(d, o, S);
    for (const o of d.objs) if (isAgent(o.type)) g += objSVG(d, o, S);
  }
  return g;
}
function bgSVG(d) {
  if (!d.bg) return "";
  const b = d.bg;
  return `<image href="${b.src}" x="${b.x}" y="${b.y}" width="${b.iw * b.mmPerPx}" height="${b.ih * b.mmPerPx}" opacity="${b.op}" preserveAspectRatio="none"/>`;
}

// ===== 画面描画 =====
function timeCardHTML() {
  const ts = PS.timeSummary(doc);
  if (!ts.slow && !sim) return "";
  let h = `<div class="tc-h">工程の時間 <button class="tc-x" data-tcx title="たたむ">${tcOpen ? "−" : "+"}</button></div>`;
  if (!tcOpen) return h;
  if (ts.slow) h += `<div class="tc-r"><span>一番長い設備</span><b>${esc(ts.slow.o.name)} ${fmt(ts.slow.ct)}秒/回</b></div>`;
  if (ts.path && ts.path.route.length) h += `<div class="tc-r"><span>1個が通る設備の時間</span><b>${fmt(ts.path.t)}秒</b></div><div class="tc-route">${ts.path.route.map(o => esc(o.name)).join(" → ")}</div>`;
  if (ts.manTotal) h += `<div class="tc-r"><span>人の作業(合計)</span><b>${fmt(ts.manTotal)}秒</b></div>`;
  if (sim && sim.t > 60) {
    const done = Object.values(sim.st).filter(x => x.o.type === "out").reduce((n, x) => n + x.doneN, 0);
    if (done) {
      const lt = (sim.wipInt || 0) / sim.t / (done / sim.t);
      h += `<div class="tc-sim"><div class="tc-r"><span>動かした結果: 完成の間隔</span><b>${fmt(sim.t / done, 1)}秒/個</b></div><div class="tc-r"><span>リードタイム(概算)</span><b>${lt >= 120 ? fmt(lt / 60, 1) + "分" : fmt(lt) + "秒"}</b></div></div>`;
    } else h += `<div class="tc-sim muted">動かした結果: まだ完成品がありません</div>`;
  } else h += `<div class="tc-hint">▶ 動かすと、実際の「完成の間隔」と「リードタイム」が出ます</div>`;
  return h;
}
let tcOpen = true, tcLast = "";
function renderTimeCard() {
  const el = $("#timeCard"); if (el) { el.hidden = true; return; } // 図を広く使うため出さない(時間は「はじめ方」と結果に表示)
  const h = timeCardHTML();
  if (h === tcLast) return; tcLast = h;
  el.innerHTML = h; el.hidden = !h;
  const x = el.querySelector("[data-tcx]"); if (x) x.onclick = () => { tcOpen = !tcOpen; tcLast = ""; renderTimeCard(); };
}
function renderAll() {
  W.setAttribute("transform", `translate(${view.tx} ${view.ty}) scale(${view.s})`);
  $("#Lbg").innerHTML = bgSVG(doc);
  $("#Lst").innerHTML = staticSVG(doc, view.s, { noMovers: !!sim });
  renderDyn(); renderOverlay(); renderTimeCard();
}
function renderDyn() {
  const L = $("#Ldyn");
  if (!sim) { L.innerHTML = ""; return; }
  const S = view.s, px = k => k / S, d = sim.doc;
  refreshPack(d);
  let g = "";
  if ($("#optTrail").checked) for (const a of sim.ag) {
    if (a.trail.length < 1) continue;
    const pts = a.trail.map(p => `${p.x},${p.y}`).join(" ") + ` ${a.x},${a.y}`;
    g += `<polyline points="${pts}" fill="none" stroke="${agentColor(d, a.o.id)}" stroke-opacity=".38" stroke-width="${px(2.2)}" stroke-linejoin="round"/>`;
  }
  // 運んでいる最中の流れは、矢印の上を点線が流れる
  for (const a of sim.ag) {
    if (!a.flowNow || !(a.carry > 0 || (a.holding && a.holding.load > 0))) continue;
    const f = d.flows.find(x => x.id === a.flowNow); if (!f) continue;
    const A = byId(d, f.from), B = byId(d, f.to);
    const pa = PS.portPoint(A, "out"), pb = PS.portPoint(B, "in");
    const off = -((sim.t * 60) % 40);
    g += `<line x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}" stroke="${GOODS}" stroke-width="${px(3.5)}" stroke-dasharray="${px(6)} ${px(14)}" stroke-dashoffset="${px(off)}" stroke-linecap="round"/>`;
  }
  // 設備に溜まっているモノ: 入れる面の内側=待っている / 取り出す面の内側=出来た
  const nameOf = obj => { const k = Object.keys(obj).filter(q => obj[q] > 0); return k.length ? k[0] : ""; };
  for (const id in sim.st) {
    const s = sim.st[id], o = s.o, r = rectOf(o), inN = sim.inTotal(s);
    if (o.type === "out") {
      const n = s.doneN; if (!n) continue;
      const b = Math.max(px(6), Math.min(200, Math.min(o.w, o.h) * 0.16)), gap = b * 1.15, cols = Math.max(1, Math.floor(o.w * 0.85 / gap)), rows = Math.max(1, Math.floor(o.h * 0.6 / gap)), show = Math.min(n, cols * rows);
      for (let i = 0; i < show; i++) g += box(r.x0 + o.w * 0.075 + gap / 2 + (i % cols) * gap, r.y1 - o.h * 0.08 - gap / 2 - Math.floor(i / cols) * gap, b, S, "", true);
      g += badge(r.x1, r.y0, `完成 ${n}`, PS.FN.io.c, S);
      continue;
    }
    if (o.type === "in" || o.type === "part") {
      const n = o.type === "part" && s.left !== Infinity ? s.left + s.outN : s.outN;
      if (o.type === "in") g += pileSVG(o, "out", Math.min(n, 6), o.item, S, false, o.boxed);
      if (o.type === "part" && s.left !== Infinity) g += badge(r.x1, r.y0, `残 ${n}`, PS.FN.stock.c, S);
      continue;
    }
    if (o.type === "buffer") { g += pileSVG(o, "out", s.outN, nameOf(s.out), S); continue; }
    g += pileSVG(o, "in", inN, (s.inName || {})[Object.keys(s.inq).find(k => s.inq[k] > 0)] || "", S);
    g += pileSVG(o, "out", s.outN, nameOf(s.out), S, o.type === "inspect");
    if (s.busy) { // 加工中のモノ(中央) + 進み具合(人の作業=橙 / 自動運転=青)
      const T0 = Math.max(0.1, PS.cycleTime(o)), pr = Math.min(1, 1 - (s.manLeft + s.autoLeft) / T0), man = s.manLeft > 0;
      const b = Math.max(px(7), Math.min(260, Math.min(o.w, o.h) * 0.2)), bx = r.x1 - b * 1.1, by = r.y0 + b * 1.1;
      g += box(bx, by, b, S, s.cur);
      g += `<circle cx="${bx}" cy="${by}" r="${b * 0.95}" fill="none" stroke="#dfe5eb" stroke-width="${px(3)}"/>`;
      const R0 = b * 0.95, ang = pr * 2 * Math.PI, ex = bx + R0 * Math.sin(ang), ey = by - R0 * Math.cos(ang);
      g += `<path d="M${bx} ${by - R0}A${R0} ${R0} 0 ${pr > 0.5 ? 1 : 0} 1 ${ex} ${ey}" fill="none" stroke="${man ? PS.FN.person.c : PS.FN.make.c}" stroke-width="${px(3)}"/>`;
      g += `<rect x="${r.x0}" y="${r.y1 - px(5)}" width="${o.w * pr}" height="${px(5)}" fill="${man ? PS.FN.person.c : PS.FN.make.c}" fill-opacity=".85"/>`;
      g += badge(r.x0 + o.w / 2 + px(30), r.y1 + px(17), man ? `人 ${Math.ceil(s.manLeft)}秒` : `自動 ${Math.ceil(s.autoLeft)}秒`, man ? "#b45f10" : PS.FN.make.c, S, false);
      if (man && !sim.opPresent(o)) g += badge(r.x1, r.y1 + px(17), "人待ち", "#d9534f", S);
    } else if (sim.needsOpNow(s) && !sim.opPresent(o)) g += badge(r.x1, r.y1 + px(17), "人待ち", "#d9534f", S);
    if (s.ng) g += badge(r.x1, r.y1, `NG ${s.ng}`, "#d9534f", S);
  }
  // 自動搬送で流れているモノ
  for (const a of sim.auto) { const k = 1 - a.eta / a.T; g += box(a.x0 + (a.x1 - a.x0) * k, a.y0 + (a.y1 - a.y0) * k, 160, S, a.name); }
  for (const id in sim.mv) { const m = sim.mv[id]; g += moverSVG(m.o, m.x, m.y, m.load, m.loadName, S, m.h); if (!m.holder) g += txt(m.x, m.y + m.o.h / 2 + px(9), m.o.name, px(10), { halo: px(3) }); }
  for (const a of sim.ag) g += agentSVG(d, a.o, a.x, a.y, S, true, a.holding ? 0 : a.carry, a.carryName,
    { h: a.h, pose: a.pose, act: a.act, phase: a.distMm, walking: a.act === "移動" || a.act === "運搬", holding: !!a.holding });
  L.innerHTML = g;
  const t = Math.floor(sim.t), done = Object.values(sim.st).filter(s => s.o.type === "out").reduce((n, s) => n + s.doneN, 0), el = sim.t - (sim.t0 || 0);
  $("#simClock").textContent = `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  $("#simKpi").textContent = `完成 ${done} 個` + (el > 120 && done ? `(${fmt(el / done, 1)}秒に1個・${fmt(done / el * 3600, 1)} 個/時)` : "");
  if (Math.floor(sim.t) % 5 === 0) renderTimeCard();
}
function badge(x, y, s, col, S, left) {
  const px = k => k / S, w = px(8 + s.length * 7), h = px(15), x0 = left ? x : x - w;
  return `<g><rect x="${x0}" y="${y - h - px(2)}" width="${w}" height="${h}" rx="${px(4)}" fill="${col}"/>${txt(x0 + w / 2, y - h / 2 - px(2), s, px(10), { fill: "#fff", b: 1 })}</g>`;
}
function renderOverlay() {
  const S = view.s, px = k => k / S;
  let g = "";
  const o = selObj();
  if (o && !sim) {
    const r = rectOf(o);
    g += `<rect x="${r.x0 - px(3)}" y="${r.y0 - px(3)}" width="${o.w + px(6)}" height="${o.h + px(6)}" fill="none" stroke="#0068B7" stroke-width="${px(1.5)}" stroke-dasharray="${px(4)} ${px(3)}"/>`;
    if (isPoly(o.type)) g += polyEditSVG(o, S);
    if (!isAgent(o.type) && !isPoly(o.type)) {
      // 寸法(幅・奥行)
      g += dimSVG(r.x0, r.y1 + px(22), r.x1, r.y1 + px(22), S, { col: "#0068B7" }) + dimSVG(r.x1 + px(22), r.y1, r.x1 + px(22), r.y0, S, { col: "#0068B7" });
      for (const [hx, hy, h] of [[r.x0, r.y0, "nw"], [r.x1, r.y0, "ne"], [r.x0, r.y1, "sw"], [r.x1, r.y1, "se"]])
        g += `<rect data-h="${h}" x="${hx - px(5)}" y="${hy - px(5)}" width="${px(10)}" height="${px(10)}" fill="#fff" stroke="#0068B7" stroke-width="${px(1.5)}" style="cursor:${h === "nw" || h === "se" ? "nwse" : "nesw"}-resize"/>`;
    }
    if ($("#optClear").checked && !["zone", "note"].includes(o.type) && !isPoly(o.type)) g += clearanceSVG(o, S);
    if (isStation(o.type)) g += standSVG(o, S);
    if (isStation(o.type) && o.type !== "out") {
      const kx = r.x1 + px(16), ky = o.y;
      g += `<g data-knob="1" style="cursor:crosshair"><circle cx="${kx}" cy="${ky}" r="${px(9)}" fill="#0068B7"/><path d="M${kx - px(4)} ${ky}H${kx + px(4)}M${kx + px(1)} ${ky - px(3)}L${kx + px(4)} ${ky}L${kx + px(1)} ${ky + px(3)}" stroke="#fff" stroke-width="${px(1.6)}" fill="none"/></g>`;
    }
  }
  // つなぐ途中
  if (drag && drag.k === "knob" && hover) { const a = byId(doc, drag.id); g += `<line x1="${a.x}" y1="${a.y}" x2="${hover.x}" y2="${hover.y}" stroke="#0068B7" stroke-width="${px(2)}" stroke-dasharray="${px(5)} ${px(3)}"/>`; }
  if (tool === "connect" && connectFrom && hover) { const a = byId(doc, connectFrom); if (a) g += `<line x1="${a.x}" y1="${a.y}" x2="${hover.x}" y2="${hover.y}" stroke="#0068B7" stroke-width="${px(2)}" stroke-dasharray="${px(5)} ${px(3)}"/>`; }
  if (tool === "dim" && dimStart && hover) { const p = dimSnap(hover); g += dimSVG(dimStart.x, dimStart.y, p.x, p.y, S, { col: "#d9534f" }); }
  if (tool === "poly" && polyDraft) g += polyDraftSVG(S);
  if (drag && drag.k === "port" && drag.side) {
    const o2 = byId(doc, drag.id), f = PS.face(o2, drag.side), col = PORT_COL[drag.role === "io" ? "in" : drag.role], tx = -f.ny, ty = f.nx, half = f.len / 2;
    g += `<line x1="${f.x - tx * half}" y1="${f.y - ty * half}" x2="${f.x + tx * half}" y2="${f.y + ty * half}" stroke="${col}" stroke-opacity=".15" stroke-width="${px(12)}" stroke-linecap="round"/>`;
    const cx = f.x + tx * (drag.off || 0), cy = f.y + ty * (drag.off || 0), hw = Math.min(450, half);
    const mcol = drag.merge != null ? PS.FN.move.c : col;
    g += `<line x1="${cx - tx * hw}" y1="${cy - ty * hw}" x2="${cx + tx * hw}" y2="${cy + ty * hw}" stroke="${mcol}" stroke-opacity=".7" stroke-width="${px(drag.merge != null ? 14 : 10)}" stroke-linecap="round"/>`;
    g += txt(cx + f.nx * px(28), cy + f.ny * px(28), drag.merge != null ? "ここで離すと 1つの出し入れ口に" : `${PS.ROLE_LABEL[drag.role]}: ${PS.SIDE_LABEL[drag.side]}`, px(11), { b: 1, fill: mcol, halo: px(3) });
  }
  if (tool === "calib") for (const p of calibPts) g += `<circle cx="${p.x}" cy="${p.y}" r="${px(5)}" fill="#d9534f"/>`;
  if (tool === "calib" && calibPts.length === 1 && hover) g += `<line x1="${calibPts[0].x}" y1="${calibPts[0].y}" x2="${hover.x}" y2="${hover.y}" stroke="#d9534f" stroke-width="${px(2)}"/>`;
  // 置く前の影
  if (placeType && hover) {
    const c = CAT[placeType], tmp = Object.assign(PS.makeObj(placeType, 0, 0), { name: c.label });
    const x0 = snapV(hover.x - c.w / 2), y0 = snapV(hover.y - c.h / 2);
    tmp.x = x0 + c.w / 2; tmp.y = y0 + c.h / 2;
    g += `<g opacity=".55" style="pointer-events:none">${isAgent(placeType) ? agentSVG(doc, tmp, tmp.x, tmp.y, S) : isMovable(placeType) ? moverSVG(tmp, tmp.x, tmp.y, 0, "", S) : objSVG(doc, tmp, S)}</g>`;
  }
  $("#Lov").innerHTML = g;
}
// 選んだ設備の「作業者が立つ位置」: 取る/置く/作業。立てない場所なら赤
function standSVG(o, S) {
  const px = k => k / S, g0 = PS.buildGrid(doc);
  let g = "";
  const lab = { in: PS.sharedPort(o) ? "ここで出し入れ" : "ここで入れる", out: "ここで取る", op: "ここで作業" };
  for (const role of PS.portRoles(o)) {
    if (role === "out" && PS.sharedPort(o)) continue;
    const ap = PS.accessPoint(doc, g0, o, role), bad = ap.off > 600, col = bad ? "#d9534f" : PORT_COL[role];
    const p = PS.portPoint(o, role), sx = p.x + p.nx * PS.STAND, sy = p.y + p.ny * PS.STAND;
    g += `<circle cx="${sx}" cy="${sy}" r="250" fill="${col}" fill-opacity=".14" stroke="${col}" stroke-width="${px(1.5)}"/>`;
    g += txt(sx + p.nx * (250 + px(10)), sy + p.ny * (250 + px(10)), bad ? "立てない" : lab[role], px(9.5), { b: 1, fill: col, halo: px(3) });
  }
  return g;
}
// 選んだ多角形: 頂点(ドラッグで移動・ダブルクリックで削除)、辺の中点(ドラッグで頂点を追加)、辺の長さ
function polyEditSVG(o, S) {
  const px = k => k / S, P = o.pts;
  let g = "";
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; g += dimSVG(a.x, a.y, b.x, b.y, S, { col: CAT[o.type].color, fs: 9.5 }); }
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; g += `<circle data-vm="${i}" cx="${(a.x + b.x) / 2}" cy="${(a.y + b.y) / 2}" r="${px(4)}" fill="#fff" stroke="${CAT[o.type].color}" stroke-width="${px(1.2)}" style="cursor:copy"/>`; }
  P.forEach((q, i) => { g += `<circle data-v="${i}" cx="${q.x}" cy="${q.y}" r="${px(6)}" fill="#fff" stroke="#0068B7" stroke-width="${px(2)}" style="cursor:move"/>`; });
  return g;
}
function polyDraftSVG(S) {
  const px = k => k / S, P = polyDraft.pts, col = CAT[polyDraft.type].color;
  let g = "";
  const h = hover ? dimSnap(hover) : null;
  const all = h ? [...P, h] : P;
  if (all.length >= 2) g += `<polyline points="${all.map(q => `${q.x},${q.y}`).join(" ")}" fill="${col}" fill-opacity=".08" stroke="${col}" stroke-width="${px(2)}"/>`;
  for (let i = 1; i < all.length; i++) g += dimSVG(all[i - 1].x, all[i - 1].y, all[i].x, all[i].y, S, { col, fs: 10 });
  P.forEach((q, i) => { g += `<circle cx="${q.x}" cy="${q.y}" r="${px(i === 0 && P.length >= 3 ? 8 : 4.5)}" fill="${i === 0 ? col : "#fff"}" stroke="${col}" stroke-width="${px(1.5)}"/>`; });
  return g;
}
// 選んだモノから上下左右の障害物・壁までの距離(=通路幅)
function clearanceSVG(o, S) {
  const r = rectOf(o), px = k => k / S, A = doc.area;
  const obs = doc.objs.filter(x => x !== o && CAT[x.type].obstacle).map(rectOf);
  let g = "";
  const col = v => v < 800 ? "#d9534f" : v < 1200 ? "#e0a100" : "#2e9c5a";
  const dirs = [
    ["L", r.x0, obs.filter(q => q.x1 <= r.x0 + 1 && q.y1 > r.y0 && q.y0 < r.y1).reduce((m, q) => Math.max(m, q.x1), 0)],
    ["R", r.x1, obs.filter(q => q.x0 >= r.x1 - 1 && q.y1 > r.y0 && q.y0 < r.y1).reduce((m, q) => Math.min(m, q.x0), A.w)],
    ["U", r.y0, obs.filter(q => q.y1 <= r.y0 + 1 && q.x1 > r.x0 && q.x0 < r.x1).reduce((m, q) => Math.max(m, q.y1), 0)],
    ["D", r.y1, obs.filter(q => q.y0 >= r.y1 - 1 && q.x1 > r.x0 && q.x0 < r.x1).reduce((m, q) => Math.min(m, q.y0), A.h)],
  ];
  for (const [k, from, to] of dirs) {
    const gap = Math.abs(to - from);
    if (gap < 50 || gap > 8000) continue;
    const c = col(gap);
    if (k === "L" || k === "R") g += dimSVG(Math.min(from, to), o.y, Math.max(from, to), o.y, S, { col: c, fs: 11 });
    else g += dimSVG(o.x, Math.max(from, to), o.x, Math.min(from, to), S, { col: c, fs: 11 });
  }
  return g;
}
function dimSnap(p) {
  const tol = 10 / view.s;
  let x = snapV(p.x), y = snapV(p.y);
  let bx = tol, by = tol;
  for (const o of doc.objs) { const r = rectOf(o); for (const v of [r.x0, r.x1]) if (Math.abs(v - p.x) < bx) { bx = Math.abs(v - p.x); x = v; } for (const v of [r.y0, r.y1]) if (Math.abs(v - p.y) < by) { by = Math.abs(v - p.y); y = v; } }
  for (const v of [0, doc.area.w]) if (Math.abs(v - p.x) < bx) { bx = Math.abs(v - p.x); x = v; }
  for (const v of [0, doc.area.h]) if (Math.abs(v - p.y) < by) { by = Math.abs(v - p.y); y = v; }
  return { x, y };
}

// ===== パレット =====
function paletteIcon(t) {
  const c = CAT[t], col = c.color;
  const m = {
    in: `<rect x="3" y="5" width="32" height="16" fill="${col}" fill-opacity=".12" stroke="${col}" stroke-dasharray="3 2"/><path d="M12 13h12m-4-4 4 4-4 4" stroke="${col}" stroke-width="2" fill="none"/>`,
    out: `<rect x="3" y="5" width="32" height="16" fill="${col}" fill-opacity=".12" stroke="${col}" stroke-dasharray="3 2"/><path d="M12 13h12m-4-4 4 4-4 4" stroke="${col}" stroke-width="2" fill="none"/>`,
    part: `<rect x="5" y="3" width="28" height="20" fill="${col}" fill-opacity=".1" stroke="${col}"/><rect x="8" y="7" width="10" height="7" fill="${GOODS}" stroke="${GOODS_D}" stroke-width=".6"/><rect x="20" y="7" width="10" height="7" fill="${GOODS}" stroke="${GOODS_D}" stroke-width=".6"/><path d="M9 21c0-6 8-6 8 0h-2.5c0-3-3-3-3 0z" fill="#3f454c"/><path d="M21 16h4v3h4v3h-8z" fill="#c3cad2" stroke="#6b7580" stroke-width=".5"/>`,
    container: `<rect x="7" y="6" width="24" height="15" fill="#eef6f1" stroke="${col}" stroke-width="1.5"/><path d="M13 8v11M19 8v11M25 8v11" stroke="${col}" stroke-opacity=".4"/><rect x="7.5" y="11" width="1.5" height="5" fill="${col}"/><rect x="29" y="11" width="1.5" height="5" fill="${col}"/>`,
    cart: `<rect x="9" y="6" width="22" height="14" fill="#fff" stroke="${col}" stroke-width="1.5"/><circle cx="12" cy="9" r="2" fill="${col}"/><circle cx="28" cy="9" r="2" fill="${col}"/><circle cx="12" cy="17" r="2" fill="${col}"/><circle cx="28" cy="17" r="2" fill="${col}"/><line x1="6" y1="7" x2="6" y2="19" stroke="${col}" stroke-width="2"/>`,
    worker: `<ellipse cx="19" cy="13" rx="9" ry="6" fill="${col}"/><circle cx="19" cy="13" r="4" fill="#3a2a22"/>`,
    robot: `<rect x="7" y="5" width="24" height="16" rx="1" fill="#eef2f5" stroke="${col}" stroke-width="1.5"/><rect x="27" y="7" width="2" height="12" fill="${col}"/><circle cx="17" cy="13" r="4" fill="#fff" stroke="${col}" stroke-width="1.5"/>`,
    wall: `<rect x="3" y="10" width="32" height="6" fill="${col}"/>`,
    zone: `<rect x="4" y="4" width="30" height="18" fill="${col}" fill-opacity=".3" stroke="${col}" stroke-dasharray="3 2"/>`,
    walk: `<path d="M5 20 L8 5 L22 8 L33 4 L31 21 Z" fill="${col}" fill-opacity=".2" stroke="${col}" stroke-dasharray="3 2"/><ellipse cx="16" cy="15" rx="2.2" ry="1.2" fill="${col}"/><ellipse cx="21" cy="12" rx="2.2" ry="1.2" fill="${col}"/>`,
    nogo: `<path d="M5 20 L8 5 L22 8 L33 4 L31 21 Z" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-dasharray="3 2"/><path d="M13 9l12 9M25 9 13 18" stroke="${col}" stroke-width="2"/>`,
    note: `<text x="19" y="17" font-size="12" text-anchor="middle" font-weight="700" fill="#333">Aa</text>`,
  }[t];
  return `<svg viewBox="0 0 38 26">${m || `<rect x="4" y="3" width="30" height="20" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="1.6"/><text x="19" y="16.5" font-size="8" text-anchor="middle" font-weight="700" fill="${col}">${esc(c.sub)}</text>`}</svg>`;
}
function legendHTML() {
  const F = PS.FN;
  return ["make", "check", "stock", "move", "person", "goods"].map(k => `<span><i style="background:${F[k].c}"></i>${F[k].t}</span>`).join("");
}
function renderPalette() {
  $("#palette").innerHTML = GROUPS.map(gp => `<div class="pg"><h3>${gp.t}</h3><div class="items">${["in", "out", "part", "process", "join", "inspect", "buffer", "worker", "robot", "cart", "container", "walk", "nogo", "wall", "note"].filter(t => CAT[t].g === gp.id && !CAT[t].hidden).map(t => `<div class="pi" data-type="${t}" title="${esc(CAT[t].label)}(${esc(CAT[t].sub)})">${paletteIcon(t)}<span class="l">${esc(CAT[t].label)}</span><span class="s">${esc(CAT[t].sub)}</span></div>`).join("")}</div></div>`).join("");
  document.querySelectorAll(".pi").forEach(el => {
    el.addEventListener("pointerdown", e => {
      e.preventDefault();
      drag = { k: "palette", type: el.dataset.type, sx: e.clientX, sy: e.clientY, moved: false };
    });
  });
}
function setPlace(t) {
  placeType = t;
  document.querySelectorAll(".pi").forEach(el => el.classList.toggle("on", el.dataset.type === t));
  if (t) setTool("select", true);
  cv.classList.toggle("place", !!t);
  hint(t ? `図の上をクリックして「${CAT[t].label}」を置く(Esc でやめる / Shift+クリックで続けて置く)` : "");
}
function hint(s) { $("#modeHint").textContent = s || ""; }

// ===== 追加・自動割り当て =====
function nearestAgent(p, prefer) {
  const ags = doc.objs.filter(o => isAgent(o.type) && (!prefer || o.type === prefer));
  let best = null, bd = Infinity; for (const a of ags) { const dd = dist(a, p); if (dd < bd) { bd = dd; best = a; } }
  return best || (prefer ? nearestAgent(p) : null);
}
function addObj(type, x, y) {
  const c = CAT[type];
  const o = PS.makeObj(type, snapV(x - c.w / 2) + c.w / 2, snapV(y - c.h / 2) + c.h / 2);
  o.name = PS.autoName(doc, type);
  if (type === "in" || type === "part") o.item = PS.nextItemName(doc);
  if (type === "note") o.text = "メモ";
  change(() => {
    doc.objs.push(o);
    if (o.needOp) { const a = nearestAgent(o, "worker"); if (a) o.op = a.id; }
    if (isAgent(type)) { // まだ運び手のいない流れ・作業者のいない設備を引き受ける
      for (const f of doc.flows) if (!f.agent && f.mode !== "auto") f.agent = o.id;
      if (type === "worker") for (const s of doc.objs) if (s.needOp && !s.op) s.op = o.id;
    }
  });
  sel = { k: "obj", id: o.id }; inspector(); renderOverlay();
  track("add/" + type, c.label);
  return o;
}
function addFlow(fromId, toId, keepSel) {
  if (fromId === toId) return;
  const a = byId(doc, fromId), b = byId(doc, toId);
  if (!a || !b || !isStation(a.type) || !isStation(b.type)) { toast("流れは 搬入口・設備・置き場・搬出口 どうしをつなぎます"); return; }
  if (a.type === "out") { toast("搬出口からは流れを出せません"); return; }
  if (b.type === "in" || b.type === "part") { toast("搬入口・部品置き場へは流れを入れられません"); return; }
  if (doc.flows.some(f => f.from === fromId && f.to === toId)) { toast("すでにつながっています"); return; }
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const ag = nearestAgent(mid, "worker");
  const f = { id: PS.uid("f"), from: fromId, to: toId, agent: ag ? ag.id : null, mode: "hand", mover: null, batch: 1 };
  change(() => doc.flows.push(f));
  if (!keepSel) sel = { k: "flow", id: f.id };
  inspector(); renderAll();
  if (!ag) toast("運び手がいません。「作業者」を置くと自動で担当になります");
  track("flow", "つなぐ");
}
function delSel() {
  if (!sel) return;
  change(() => {
    if (sel.k === "obj") {
      const id = sel.id;
      doc.objs = doc.objs.filter(o => o.id !== id);
      doc.flows = doc.flows.filter(f => f.from !== id && f.to !== id);
      for (const f of doc.flows) {
        if (f.agent === id) f.agent = null;
        f.movers = (f.movers || []).filter(x => x !== id);
        if (f.mover === id) { f.mover = f.movers.shift() || null; if (!f.mover) f.mode = "hand"; }
      }
      for (const o of doc.objs) if (o.op === id) o.op = null;
    } else if (sel.k === "flow") doc.flows = doc.flows.filter(f => f.id !== sel.id);
    else if (sel.k === "dim") doc.dims = doc.dims.filter(d => d.id !== sel.id);
    sel = null;
  });
}
function dupSel() {
  const o = selObj(); if (!o) return;
  const n = JSON.parse(JSON.stringify(o)); n.id = PS.uid("o"); n.x += 500; n.y += 500; n.name = PS.autoName(doc, o.type);
  if (n.pts) n.pts = n.pts.map(q => ({ x: q.x + 500, y: q.y + 500 }));
  change(() => doc.objs.push(n)); sel = { k: "obj", id: n.id }; inspector(); renderOverlay();
}
function rotSel() {
  const o = selObj(); if (!o) return;
  change(() => {
    if (isAgent(o.type)) { o.dir = (((o.dir == null ? -90 : o.dir) + 90 + 180) % 360) - 180; return; }
    if (isPoly(o.type)) { const cx = snapV(o.x), cy = snapV(o.y); o.pts = o.pts.map(q => ({ x: cx - (q.y - cy), y: cy + (q.x - cx) })); PS.polyBBox(o); return; }
    const w = o.w; o.w = o.h; o.h = w;
    if (isStation(o.type)) PS.rotatePorts(o);
  });
}

// ===== ポインタ操作 =====
cv.addEventListener("contextmenu", e => e.preventDefault());
cv.addEventListener("pointerdown", e => {
  const w = toWorld(e);
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 合成イベント等 */ }
  if (e.button === 1 || e.button === 2) { drag = { k: "pan", sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty }; cv.classList.add("pan"); return; }
  const tgt = e.target.closest("[data-h],[data-knob],[data-v],[data-vm],[data-port],[data-id],[data-flow],[data-dim]");
  if (placeType) {
    addObj(placeType, w.x, w.y);
    if (!e.shiftKey) setPlace(null);
    return;
  }
  if (tool === "calib") {
    calibPts.push(w);
    if (calibPts.length === 2) { $("#calibBox").hidden = false; $("#calibLen").focus(); }
    renderOverlay(); return;
  }
  if (tool === "poly" && polyDraft) {
    const p = e.altKey ? w : dimSnap(w), P = polyDraft.pts;
    if (P.length >= 3 && dist(p, P[0]) < 12 / view.s) { closePoly(); return; }
    if (!P.length || dist(p, P[P.length - 1]) > 1) P.push(p);
    hint(`頂点 ${P.length} 個 — クリックで追加 / 最初の点・ダブルクリック・Enter で閉じる / Backspace で1つ戻す / Esc でやめる`);
    renderOverlay(); return;
  }
  if (tool === "dim") {
    const p = dimSnap(w);
    if (!dimStart) dimStart = p;
    else { const d0 = dimStart; dimStart = null; if (dist(d0, p) > 10) change(() => doc.dims.push({ id: PS.uid("d"), x1: d0.x, y1: d0.y, x2: p.x, y2: p.y })); }
    renderOverlay(); return;
  }
  if (tool === "connect") {
    const id = tgt && tgt.dataset.id;
    if (!id) { connectFrom = null; renderOverlay(); return; }
    if (!connectFrom) { connectFrom = id; hint("つなぎ先の設備・搬出口をクリック"); }
    else { addFlow(connectFrom, id); connectFrom = null; hint("流れの元をクリック → 先をクリック(Esc で終わる)"); }
    renderOverlay(); return;
  }
  if ($("#bgMove").checked && doc.bg && !(tgt && (tgt.dataset.h || tgt.dataset.knob))) {
    snapshot(); drag = { k: "bg", sx: w.x, sy: w.y, x: doc.bg.x, y: doc.bg.y }; return;
  }
  if (sim) {
    // 再生中・停止後でも、モノをクリックしたらシミュレーションを終えて選べるようにする(結果パネルはそのまま)
    if (tgt && (tgt.dataset.id || tgt.dataset.port || tgt.dataset.flow || tgt.dataset.dim)) { resetSim(); renderAll(); }
    else { drag = { k: "pan", sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty }; cv.classList.add("pan"); return; }
  }
  if (tgt && tgt.dataset.h) { const o = selObj(); drag = { k: "resize", h: tgt.dataset.h, id: o.id, r: rectOf(o), snap: JSON.stringify(doc), moved: false }; return; }
  if (tgt && tgt.dataset.knob) { drag = { k: "knob", id: sel.id }; return; }
  if (tgt && tgt.dataset.port) { // 入/出/作業の印をつかんで別の面へ
    const o = byId(doc, tgt.dataset.pid);
    sel = { k: "obj", id: o.id }; inspector();
    const role = tgt.dataset.port === "io" && e.shiftKey ? "out" : tgt.dataset.port;
    drag = { k: "port", id: o.id, role, side: o.ports[role === "io" ? "in" : role], off: PS.portPoint(o, role === "io" ? "in" : role).off, split: tgt.dataset.port === "io" && role === "out", snap: JSON.stringify(doc) };
    hint(`${PS.ROLE_LABEL[drag.role]}をドラッグ中 — 付けたい面の近くで離す`); renderOverlay(); return;
  }
  if (tgt && (tgt.dataset.v || tgt.dataset.vm)) {
    const o = selObj(), snap = JSON.stringify(doc);
    let i = +(tgt.dataset.v || tgt.dataset.vm);
    if (tgt.dataset.vm) { const a = o.pts[i], b = o.pts[(i + 1) % o.pts.length]; o.pts.splice(i + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); i++; }
    drag = { k: "vtx", id: o.id, i, snap, moved: !!tgt.dataset.vm }; return;
  }
  if (tgt && tgt.dataset.id) {
    const o = byId(doc, tgt.dataset.id);
    sel = { k: "obj", id: o.id }; inspector(); renderAll();
    drag = { k: "move", id: o.id, sx: w.x, sy: w.y, ox: o.x, oy: o.y, pts0: o.pts ? o.pts.map(q => ({ ...q })) : null, snap: JSON.stringify(doc), moved: false };
    return;
  }
  if (tgt && tgt.dataset.flow) { sel = { k: "flow", id: tgt.dataset.flow }; inspector(); renderAll(); return; }
  if (tgt && tgt.dataset.dim) { sel = { k: "dim", id: tgt.dataset.dim }; inspector(); renderAll(); return; }
  if (sel) { sel = null; inspector(); renderAll(); }
  drag = { k: "pan", sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty }; cv.classList.add("pan");
});
window.addEventListener("pointermove", e => {
  const onCv = e.target instanceof Node && (e.target === cv || cv.contains(e.target));
  if (drag && drag.k === "palette") {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) drag.moved = true;
    if (drag.moved && !isPoly(drag.type)) { placeType = drag.type; hover = onCv ? toWorld(e) : null; renderOverlay(); }
    return;
  }
  hover = onCv || drag ? toWorld(e) : null;
  if (!drag) { if (placeType || tool !== "select" || connectFrom) renderOverlay(); return; }
  const w = toWorld(e);
  if (drag.k === "pan") { view.tx = drag.tx + e.clientX - drag.sx; view.ty = drag.ty + e.clientY - drag.sy; W.setAttribute("transform", `translate(${view.tx} ${view.ty}) scale(${view.s})`); return; }
  if (drag.k === "bg") { doc.bg.x = drag.x + w.x - drag.sx; doc.bg.y = drag.y + w.y - drag.sy; $("#Lbg").innerHTML = bgSVG(doc); return; }
  if (drag.k === "port") {
    const o = byId(doc, drag.id);
    let best = null, bd = Infinity;
    let bt = 0;
    for (const sd of PS.SIDES) { const f = PS.face(o, sd), tx = -f.ny, ty = f.nx; const t = Math.max(-f.len / 2, Math.min(f.len / 2, (w.x - f.x) * tx + (w.y - f.y) * ty)); const dd = Math.hypot(w.x - (f.x + tx * t), w.y - (f.y + ty * t)); if (dd < bd) { bd = dd; best = sd; bt = t; } }
    drag.side = best; drag.off = e.altKey ? bt : Math.round(bt / 50) * 50;
    // 「入」を「出」の上に(または逆に)重ねたら、1つの出し入れ口にまとめる
    drag.merge = null;
    if (drag.role === "in" || drag.role === "out") {
      const other = drag.role === "in" ? "out" : "in";
      if (PS.portRoles(o).includes(other) && o.ports[other] === best) {
        const q = PS.portPoint(o, other), tol = Math.max(350, 22 / view.s);
        if (Math.abs(q.off - drag.off) <= tol) { drag.merge = q.off; drag.off = q.off; }
      }
    }
    renderOverlay(); return;
  }
  if (drag.k === "vtx") {
    const o = byId(doc, drag.id), q = e.altKey ? w : dimSnap(w);
    o.pts[drag.i] = { x: q.x, y: q.y }; PS.polyBBox(o); drag.moved = true;
    $("#Lst").innerHTML = staticSVG(doc, view.s); renderOverlay(); return;
  }
  if (drag.k === "move" && drag.pts0) { // 多角形は頂点ごと平行移動
    const o = byId(doc, drag.id), dx = snapV(w.x - drag.sx, e.altKey), dy = snapV(w.y - drag.sy, e.altKey);
    o.pts = drag.pts0.map(q => ({ x: q.x + dx, y: q.y + dy })); PS.polyBBox(o); if (dx || dy) drag.moved = true;
    $("#Lst").innerHTML = staticSVG(doc, view.s); renderOverlay(); return;
  }
  if (drag.k === "move") {
    const o = byId(doc, drag.id);
    const nx0 = snapV(drag.ox + w.x - drag.sx - o.w / 2, e.altKey), ny0 = snapV(drag.oy + w.y - drag.sy - o.h / 2, e.altKey);
    const nx = nx0 + o.w / 2, ny = ny0 + o.h / 2;
    if (nx !== o.x || ny !== o.y) { o.x = nx; o.y = ny; drag.moved = true; $("#Lst").innerHTML = staticSVG(doc, view.s); renderOverlay(); }
    return;
  }
  if (drag.k === "resize") {
    const o = byId(doc, drag.id), r = drag.r;
    let { x0, y0, x1, y1 } = r;
    const sx = snapV(w.x, e.altKey), sy = snapV(w.y, e.altKey);
    if (drag.h.includes("w")) x0 = Math.min(sx, x1 - 100); else x1 = Math.max(sx, x0 + 100);
    if (drag.h.includes("n")) y0 = Math.min(sy, y1 - 100); else y1 = Math.max(sy, y0 + 100);
    o.w = x1 - x0; o.h = y1 - y0; o.x = (x0 + x1) / 2; o.y = (y0 + y1) / 2; drag.moved = true;
    $("#Lst").innerHTML = staticSVG(doc, view.s); renderOverlay(); return;
  }
  if (drag.k === "knob") renderOverlay();
});
window.addEventListener("pointerup", e => {
  if (!drag) return;
  const d = drag; drag = null; cv.classList.remove("pan");
  if (d.k === "palette") {
    if (isPoly(d.type)) { startPoly(d.type); return; }
    const r = cv.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (d.moved) { placeType = null; if (inside) addObj(d.type, toWorld(e).x, toWorld(e).y); setPlace(null); renderOverlay(); }
    else setPlace(placeType === d.type ? null : d.type);
    return;
  }
  if (d.k === "move" || d.k === "resize" || d.k === "vtx") {
    if (d.moved) { undoS.push(d.snap); redoS = []; afterChange(); } else renderOverlay();
    return;
  }
  if (d.k === "bg") { save(); return; }
  if (d.k === "port") {
    hint("");
    const o = byId(doc, d.id);
    const roles = d.role === "io" ? ["in", "out"] : [d.role];
    const po = o.portOff || {};
    if (d.side == null || (roles.every(r => o.ports[r] === d.side && !o.portAuto[r] && po[r] === d.off) && d.merge == null && !(d.split))) { renderOverlay(); return; }
    undoS.push(d.snap); redoS = [];
    o.portOff = Object.assign({}, po);
    for (const r of roles) { o.ports[r] = d.side; o.portAuto[r] = false; o.portOff[r] = d.off; }
    let msg = `${o.name}: ${PS.ROLE_LABEL[d.role]}を「${PS.SIDE_LABEL[d.side]}」へ`;
    if (d.merge != null) { const other = d.role === "in" ? "out" : "in"; o.portShared = true; o.portOff.in = o.portOff.out = d.merge; o.portAuto[other] = false; msg = `${o.name}: 入れる口と取り出す口を1つの出し入れ口にまとめました(Shift+ドラッグで分けられます)`; }
    else if (d.role !== "io" && o.portShared) { o.portShared = false; msg += "(出し入れ口を分けました)"; }
    afterChange(); toast(msg);
    return;
  }
  if (d.k === "knob") {
    const t = document.elementsFromPoint(e.clientX, e.clientY).map(el => el.closest && el.closest("#Lst [data-id]")).find(Boolean);
    if (t && t.dataset.id !== d.id) addFlow(d.id, t.dataset.id);
    renderOverlay(); return;
  }
  if (d.k === "pan") renderAll();
});
cv.addEventListener("dblclick", e => {
  if (tool === "poly" && polyDraft) { closePoly(); return; }
  const v = e.target.closest("[data-v]"), o0 = selObj();
  if (v && o0 && isPoly(o0.type)) { if (o0.pts.length > 3) change(() => { o0.pts.splice(+v.dataset.v, 1); PS.polyBBox(o0); }); else toast("頂点は3つ以上必要です"); return; }
  const t = e.target.closest("[data-id]");
  if (t) { const n = $("#insp [data-k=name]") || $("#insp [data-k=text]"); if (n) { n.focus(); n.select(); } }
});
cv.addEventListener("wheel", e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const k = Math.exp(-e.deltaY * 0.0015), ns = Math.min(2, Math.max(0.004, view.s * k));
  view.tx = mx - (mx - view.tx) * ns / view.s; view.ty = my - (my - view.ty) * ns / view.s; view.s = ns;
  renderAll();
}, { passive: false });

// ===== キーボード =====
window.addEventListener("keydown", e => {
  const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (e.key === "Escape") { setPlace(null); connectFrom = null; dimStart = null; calibPts = []; $("#calibBox").hidden = true; $("#help").hidden = true; closeMenus(); if (tool !== "select") setTool("select"); renderOverlay(); return; }
  if (inField) return;
  // 使い方の窓・ガイドを見ている間は、元に戻す/やり直す以外の図のショートカットを使わない(Delete で設備が消える・Space でボタンが押せない等を防ぐ)
  const undoKey = (e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key);
  if (!undoKey && (!$("#help").hidden || document.activeElement.closest("#gPop,#gMap"))) return;
  if (tool === "poly" && polyDraft) {
    if (e.key === "Enter") { e.preventDefault(); closePoly(); return; }
    if (e.key === "Backspace") { e.preventDefault(); polyDraft.pts.pop(); renderOverlay(); return; }
  }
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (ctrl && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
  if (ctrl && e.key.toLowerCase() === "d") { e.preventDefault(); dupSel(); return; }
  if (ctrl) return;
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); delSel(); return; }
  if (e.key === "r" || e.key === "R") { rotSel(); return; }
  if (e.key === "v" || e.key === "V") setTool("select");
  if (e.key === "c" || e.key === "C") setTool("connect");
  if (e.key === "m" || e.key === "M") setTool("dim");
  if (e.key === "f" || e.key === "F") fit();
  if (e.key === " ") { e.preventDefault(); togglePlay(); }
  const o = selObj();
  if (o && e.key.startsWith("Arrow")) {
    e.preventDefault(); const st = e.shiftKey ? 10 : 100;
    change(() => { if (e.key === "ArrowLeft") o.x -= st; if (e.key === "ArrowRight") o.x += st; if (e.key === "ArrowUp") o.y -= st; if (e.key === "ArrowDown") o.y += st; });
  }
});
function setTool(t, keepPlace) {
  tool = t; connectFrom = null; dimStart = null; if (t !== "calib") calibPts = [];
  if (t !== "poly") polyDraft = null;
  if (!keepPlace && placeType) setPlace(null);
  document.querySelectorAll(".tool[data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
  cv.classList.toggle("connect", t === "connect"); cv.classList.toggle("dim", t === "dim"); cv.classList.toggle("calib", t === "calib" || t === "poly");
  document.querySelectorAll(".pi").forEach(el => el.classList.toggle("on", t === "poly" && polyDraft && el.dataset.type === polyDraft.type));
  hint({ connect: "流れの元をクリック → 先をクリック(Esc で終わる)", dim: "2点をクリックして寸法を入れる(設備の角・辺に吸着)", calib: "下絵の上で長さの分かる2点をクリック",
         poly: "角をクリックしていく(設備の角・辺・100mm に吸着、Alt で吸着なし)。最初の点・ダブルクリック・Enter で閉じる" }[t] || "");
  renderOverlay();
}
function startPoly(type) {
  if (placeType) setPlace(null);
  polyDraft = { type, pts: [] };
  setTool("poly");
  track("poly/" + type, CAT[type].label);
}
function closePoly() {
  const d0 = polyDraft; if (!d0) return;
  const P = d0.pts.filter((q, i) => i === 0 || dist(q, d0.pts[i - 1]) > 1);
  if (P.length < 3) { toast("3点以上クリックしてください"); return; }
  const o = PS.makeObj(d0.type, 0, 0, { pts: P });
  o.name = PS.autoName(doc, d0.type);
  change(() => doc.objs.push(o));
  setTool("select"); sel = { k: "obj", id: o.id }; inspector(); renderAll();
  if (d0.type === "walk") toast("通路を作りました。作業者・LexxMoMa はこの中だけを歩きます(複数描くと合わせた範囲)");
}
document.querySelectorAll(".tool[data-tool]").forEach(b => b.onclick = () => setTool(b.dataset.tool));
$("#btnFit").onclick = fit;

// ===== インスペクタ =====
function field(label, html, tmp) { return `<label class="f"><span>${label}${tmp ? '<i class="tag">仮の値</i>' : ""}</span>${html}</label>`; }
function inp(k, v, type, extra) { return `<input type="${type || "text"}" data-k="${k}" value="${esc(v)}" ${extra || ""}>`; }
function inspector() {
  const P = $("#insp");
  const o = selObj(), f = selFlow();
  window.dispatchEvent(new CustomEvent("ps:selection", { detail: { timed: !!o && PS.isTimed(o.type) } }));
  if (sel && !$("#insp").hidden === false) switchTab("insp"); // 結果を見ている時に設備をクリックしても設定が出るように
  if (o) P.innerHTML = objPanel(o);
  else if (f) P.innerHTML = flowPanel(f);
  else if (sel && sel.k === "dim") P.innerHTML = `<h2>寸法線</h2><p class="muted">${fmt(Math.round((() => { const d = doc.dims.find(x => x.id === sel.id); return d ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) : 0; })()))} mm</p><div class="acts"><button class="btn" data-act="del">削除</button></div>`;
  else P.innerHTML = docPanel();
  bindPanel(P);
}
function docPanel() {
  const n = t => doc.objs.filter(o => o.type === t).length;
  const eq = doc.objs.filter(o => ["process", "join", "inspect", "bench"].includes(o.type)).length;
  const warns = checks();
  const ts = PS.timeSummary(doc);
  return `<div class="gstart"><b>初めての方へ</b>
      <p>図の設備をクリックすると、ここにその設備の設定が出ます。何も選んでいない時は、図全体の条件が出ます。</p>
      <div class="acts"><button class="btn p" data-guide="tour">操作ツアー(2分)</button><button class="btn" data-guide="map">画面の見かた</button></div></div>
    <h2>図全体の条件</h2>
    ${ts.slow ? `<h4>工程の時間(計算前の目安)</h4><table class="t"><tr><th>一番長い設備</th><td>${esc(ts.slow.o.name)} ${fmt(ts.slow.ct)}秒/回</td></tr>${ts.path ? `<tr><th>1個が通る設備の時間</th><td>${fmt(ts.path.t)}秒</td></tr>` : ""}</table>` : ""}
    <h4>1日の条件</h4>
    <div class="grid2">
      ${field("稼働時間 [時間/日]", `<input type="number" data-day="hours" value="${doc.day.hours}" step="0.5" min="0.5" max="24">`)}
      ${field("人の休憩 [分/日]", `<input type="number" data-day="breakMin" value="${doc.day.breakMin}" step="5" min="0">`)}
      ${field("必要数 [個/日]", `<input type="number" data-day="demand" value="${doc.day.demand || ""}" step="1" min="0" placeholder="未設定">`)}
      ${field("LexxMoMa の稼働率 [%]", `<input type="number" data-day="robotAvail" value="${doc.day.robotAvail}" step="1" min="10" max="100">`)}
    </div>
    <p class="hint" style="margin-top:0">休憩中は人が付く作業が止まり、LexxMoMa と自動の設備は動き続けます。LexxMoMa の稼働率は充電などで止まる分を除いた割合です。</p>
    <h4>いまの図</h4>
    <table class="t"><tr><th>エリア</th><td>${fmt(doc.area.w / 1000, 1)} × ${fmt(doc.area.h / 1000, 1)} m</td></tr>
    <tr><th>設備</th><td>${eq} 台</td></tr><tr><th>モノの流れ</th><td>${doc.flows.length} 本</td></tr>
    <tr><th>作業者 / LexxMoMa</th><td>${n("worker")} 人 / ${n("robot")} 台</td></tr>
    <tr><th>台車・コンテナ</th><td>${n("cart") + n("container")} 個</td></tr></table>
    <h4>確認事項</h4>
    ${warns.length ? `<div class="warn">${warns.map(w => `<div>・${esc(w)}</div>`).join("")}</div>` : `<div class="ok">いまのところ問題は見つかっていません</div>`}
    <label class="f"><span>作成者</span>${inp("author", doc.author, "text", 'data-doc="1"')}</label>`;
}
function objPanel(o) {
  const c = CAT[o.type], ed = new Set(o.edited || []);
  const isTmp = k => ["ngRate", "interval", "speed", "handle", "cap"].includes(k) && !ed.has(k);
  let h = `<h2><span class="sw" style="background:${c.color}"></span>${esc(c.label)}<small class="muted">${esc(c.sub)}</small></h2>`;
  if (o.type !== "note") h += field("名前", inp("name", o.name));
  if (isPoly(o.type)) h += `<p>面積 <b>${fmt(PS.polyArea(o.pts) / 1e6, 1)} m²</b>・頂点 ${o.pts.length} 個</p><p class="hint">頂点をドラッグで移動、ダブルクリックで削除。辺の中の小さな点をドラッグすると頂点が増えます。${o.type === "walk" ? "作業者・LexxMoMa は通路の中だけを歩きます(左の「人は通路の中だけ歩く」)。設備の面の前(立ち位置)が通路に入るように囲んでください。" : "作業者・LexxMoMa はこの中を通りません。"}</p>`;
  let adv = ""; // 詳しい設定(たたんでおく)
  if (!isAgent(o.type) && !isPoly(o.type)) {
    adv += `<div class="grid2">${field("幅 W [mm]", inp("w", Math.round(o.w), "number", 'step="100" min="100"'))}${field("奥行 D [mm]", inp("h", Math.round(o.h), "number", 'step="100" min="100"'))}
      ${field("左端 X [mm]", inp("x0", Math.round(o.x - o.w / 2), "number", 'step="100"'))}${field("上端 Y [mm]", inp("y0", Math.round(o.y - o.h / 2), "number", 'step="100"'))}</div>`;
  }
  if (PS.isTimed(o.type)) h += processCard(o);
  for (const k of Object.keys(DEFAULTS[o.type] || {})) {
    const v = o[k];
    if (PS.isTimed(o.type) && ["autoT", "manT", "outName", "outQty", "ngRate", "parallel", "swapT"].includes(k)) continue; // 工程カードで入力
    if (k === "needOp") {
      h += `<label class="chk"><input type="checkbox" data-k="needOp" ${v ? "checked" : ""}> ${PROP_LABEL[k]}</label>`;
      if (v) h += field("付く作業者", `<select data-k="op"><option value="">(未定)</option>${doc.objs.filter(a => isAgent(a.type)).map(a => `<option value="${a.id}" ${o.op === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>`);
      continue;
    }
    if (k === "outName") { h += field(PROP_LABEL[k], inp(k, v, "text", `placeholder="空欄なら ${esc(outputName(doc, Object.assign({}, o, { outName: "" })))}"`)); continue; }
    if (k === "boxed") { h += `<label class="chk"><input type="checkbox" data-k="boxed" ${v ? "checked" : ""}> TPポリ箱に入れて置いてある(置き場の見た目)</label><p class="hint" style="margin-top:2px">箱ごと運ぶときは、左の「TPポリ箱」を置いて、流れの「運び方」でそのポリ箱を選びます(人が箱を取りに行き、部品を入れて運び、箱は運んだ先に置いてきます)。</p>`; continue; }
    if (k === "pack") { h += field("部品の種類", `<select data-k="pack">${Object.entries(PS.PACKS).map(([v, t]) => `<option value="${v}" ${o.pack === v ? "selected" : ""}>${t}</option>`).join("")}</select>`); continue; }
    if (k === "text" && o.type === "zone") { h += field("表示する文字(例: 通路・立入禁止)", inp(k, v)); continue; }
    const num = typeof DEFAULTS[o.type][k] === "number";
    const fh = field(PROP_LABEL[k] || k, inp(k, v, num ? "number" : "text", (num ? 'step="any" min="0"' : "") + (isTmp(k) ? ' class="tmp"' : "")), isTmp(k));
    if (isAgent(o.type) && (k === "speed" || k === "handle")) adv += fh; else h += fh;
  }
  if (isStation(o.type)) adv += portsPanel(o);
  if (isAgent(o.type)) {
    const dv = o.dir == null ? -90 : +o.dir;
    adv += field("体の向き(置いたときの向き)", `<select data-k="dir">${[[-90, "↑ 上向き"], [0, "→ 右向き"], [90, "↓ 下向き"], [180, "← 左向き"]].map(([v, t]) => `<option value="${v}" ${Math.round(dv) === v || (v === 180 && Math.round(dv) === -180) ? "selected" : ""}>${t}</option>`).join("")}</select>`);
    const fl = doc.flows.filter(f => f.mode !== "auto");
    h += `<h4>運ぶ担当の流れ</h4>` + (fl.length ? `<div class="list">${fl.map(f => `<label><input type="checkbox" data-assign="${f.id}" ${f.agent === o.id ? "checked" : ""}> ${esc(flowName(f))}${f.agent && f.agent !== o.id ? ` <span class="muted">(${esc((byId(doc, f.agent) || {}).name)})</span>` : ""}</label>`).join("")}</div>` : `<p class="muted">まだ流れがありません</p>`);
    const ops = doc.objs.filter(s => s.needOp);
    if (ops.length) h += `<h4>付いて作業する設備</h4><div class="list">${ops.map(s => `<label><input type="checkbox" data-op="${s.id}" ${s.op === o.id ? "checked" : ""}> ${esc(s.name)}</label>`).join("")}</div>`;
    if (o.type === "robot") h += `<p class="hint">LexxMoMa の初期値: 車体 750×600mm、走行 1.0 m/s(最大1.5)、積み降ろし 20 秒/回(アームでのピック想定)。実際の値は案件ごとに確認してください。</p>`;
  }
  if (isMovable(o.type)) {
    const used = doc.flows.filter(f => f.mover === o.id);
    h += `<p class="hint">${used.length ? "使っている流れ: " + used.map(f => esc(flowName(f))).join("、") : "流れの「運び方」でこの" + c.label + "を選ぶと、作業者が取りに行って運びます。"}</p>`;
  }
  if (o.type === "zone") h += field("色", `<select data-k="color">${[["#9ec9e8", "水色(通路)"], ["#f6b3b3", "赤(立入禁止)"], ["#b8e0c2", "緑(作業エリア)"], ["#ffe08a", "黄(注意)"], ["#d0d0d0", "灰"]].map(([v, t]) => `<option value="${v}" ${(o.color || "#9ec9e8") === v ? "selected" : ""}>${t}</option>`).join("")}</select>`);
  if (adv) h += `<details class="adv"><summary>${isAgent(o.type) ? "詳しい設定(歩く速さ・積み降ろし・向き)" : isStation(o.type) ? "詳しい設定(寸法・位置・出し入れ面)" : "詳しい設定(寸法・位置)"}</summary>${adv}</details>`;
  h += `<div class="acts">${isAgent(o.type) ? "" : '<button class="btn" data-act="rot">90°回転</button>'}<button class="btn" data-act="dup">複製</button><button class="btn" data-act="del">削除</button></div>`;
  if (isStation(o.type) && o.type !== "out") h += `<p class="hint">右端の <span class="knob">●→</span> を次の設備へドラッグすると流れがつながります。</p>`;
  return h;
}
function portsPanel(o) {
  const roles = PS.portRoles(o); if (!roles.length) return "";
  const pw = field("開口の幅 [mm](空欄=自動)", `<input type="number" data-k="portW" value="${o.portW || ""}" step="100" min="0" placeholder="例 2800">`);
  return `<h4>モノの出し入れ面</h4><p class="hint" style="margin-top:0">図の設備の縁にある <b style="color:${PORT_COL.in}">入</b>・<b style="color:${PORT_COL.out}">出</b>・足あと(作業)を<b>ドラッグして、付けたい面で離す</b>と変わります。作業者は面の正面 ${PS.STAND}mm に立ち、設備の方を向いて作業します。</p>`
    + `<div class="prow">${PS.sharedPort(o)
        ? `<span class="ptag" style="--c:${PORT_COL.in}">出し入れ口: ${PS.SIDE_LABEL[o.ports.in]}(入れる・取り出すを同じ口で)</span>` + (roles.includes("op") ? `<span class="ptag" style="--c:${PORT_COL.op}">作業: ${PS.SIDE_LABEL[o.ports.op]}</span>` : "")
        : roles.map(r => `<span class="ptag" style="--c:${PORT_COL[r]}">${PS.ROLE_LABEL[r].replace("面", "")}: ${PS.SIDE_LABEL[o.ports[r]]}${o.portAuto[r] ? "(自動)" : ""}</span>`).join("")}</div>`
    + (PS.sharedPort(o) ? `<p class="hint">1つの口で出し入れします(作業者も同じ位置に立つ)。口をドラッグすると入・出が一緒に動きます。<b>Shift を押しながら</b>ドラッグすると「出」だけを取り出して分けられます。</p>`
      : PS.portRoles(o).includes("in") && PS.portRoles(o).includes("out") ? `<p class="hint">「出」の印を「入」の印の上へドラッグして重ねると、1つの出し入れ口にまとまります(設備が大きくても可)。印は面の上の好きな位置へ動かせます。</p>` : "")
    + (PS.portRoles(o).includes("in") && PS.portRoles(o).includes("out") ? `<button class="btn" data-portmerge="1" style="font-size:11.5px;padding:3px 8px;margin:0 4px 4px 0">${PS.sharedPort(o) ? "入れる口と取り出す口を分ける" : "入れる口と取り出す口を1つにまとめる"}</button>` : "")
    + pw + (roles.some(r => !o.portAuto[r]) ? `<button class="btn" data-portreset="1" style="font-size:11.5px;padding:3px 8px">面をつながる相手の向きに自動で合わせる</button>` : "");
}
// 工程カード: 前工程から何を入れて、何を作って、次工程へ何を出すか + 自動/人の時間
function processCard(o) {
  const ins = doc.flows.filter(f => f.to === o.id), outs = doc.flows.filter(f => f.from === o.id);
  const others = doc.objs.filter(x => isStation(x.type) && x.id !== o.id);
  const opts = (list, selId) => list.map(x => `<option value="${x.id}" ${x.id === selId ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  const srcs = others.filter(x => x.type !== "out"), dsts = others.filter(x => x.type !== "in" && x.type !== "part");
  const ed = new Set(o.edited || []), tmpT = !ed.has("autoT") && !ed.has("manT");
  let h = `<div class="pcard"><div class="pc-h"><b>①</b> 入れるもの <span class="muted">前工程 → モノの名前${o.type === "join" ? " × 1回に使う数" : ""}</span></div>`;
  if (!ins.length) h += `<p class="muted">まだありません。下で前工程を選ぶか、図で前の設備の ●→ をここへドラッグ</p>`;
  for (const f of ins) {
    const a = byId(doc, f.from), nm = outputName(doc, a), editable = ["in", "part", "process", "join", "bench"].includes(a.type);
    h += `<div class="io-row"><select data-inflow="${f.id}" title="前工程">${opts(srcs, a.id)}</select>
      <input data-inname="${f.id}" value="${esc(nm === "?" ? "" : nm)}" placeholder="モノの名前" ${editable ? "" : 'disabled title="検査・仮置きはモノをそのまま通すので、さらに前の工程で名前を変えてください"'}>
      ${o.type === "join" ? `<span class="x2">×</span><input class="q" type="number" min="1" step="1" data-inqty="${f.id}" value="${PS.inQty(o, f.id)}">` : ""}
      <button class="del" data-delflow="${f.id}" title="この流れを消す">×</button></div>`;
  }
  h += `<select class="add" data-addin="1"><option value="">＋ 前工程を追加…</option>${opts(srcs)}</select>`;
  if (o.type !== "join" && ins.length) h += `<div class="io-row"><span class="lab">1回に入れる数</span><input class="q" type="number" min="1" step="1" data-inqty="_" value="${PS.inQty(o)}"><span class="muted">個</span></div>`;
  h += `<div class="pc-h"><b>②</b> 出すもの <span class="muted">モノの名前 × 1回で出来る数 → 次工程</span></div>`;
  if (o.type === "inspect") h += `<p style="margin:4px 0">${esc(outputName(doc, o))} <span class="muted">(検査はモノを変えずに通す)</span></p>${field(PROP_LABEL.ngRate, inp("ngRate", o.ngRate, "number", 'step="any" min="0" max="100"'))}`;
  else h += `<div class="io-row"><span class="lab">部品の種類</span><select data-k="outPack"><option value="">前工程と同じ(${esc(PS.PACKS[PS.packOf(doc, Object.assign({}, o, { outPack: "" }))])})</option>${Object.entries(PS.PACKS).map(([v, t]) => `<option value="${v}" ${o.outPack === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>`
    + `<div class="io-row"><input data-k="outName" value="${esc(o.outName)}" placeholder="空欄なら ${esc(outputName(doc, Object.assign({}, o, { outName: "" })))}"><span class="x2">×</span><input class="q" type="number" min="1" step="1" data-k="outQty" value="${PS.outQty(o)}"></div>`;
  for (const f of outs) { const b = byId(doc, f.to); h += `<div class="io-row"><span class="to">→ ${esc(b.name)}</span><button class="del" data-delflow="${f.id}" title="この流れを消す">×</button></div>`; }
  h += `<select class="add" data-addout="1"><option value="">＋ 次工程を追加…</option>${opts(dsts)}</select>`;
  const a = +o.autoT || 0, m = +o.manT || 0, oq = o.type === "inspect" ? PS.inQty(o) : PS.outQty(o);
  h += `<div class="pc-h"><b>③</b> 時間(1回あたり)${tmpT ? '<i class="tag">仮の値</i>' : ""}</div>
    <div class="grid2">${field("自動運転 [秒]", inp("autoT", a, "number", `step="any" min="0"${tmpT ? ' class="tmp"' : ""}`))}${field("人の作業 [秒]", inp("manT", m, "number", `step="any" min="0"${tmpT ? ' class="tmp"' : ""}`))}</div>
    ${o.type !== "inspect" ? `<label class="chk"><input type="checkbox" data-k="parallel" ${o.parallel ? "checked" : ""}> 自動運転中に、人が次のセット・取り出しを同時に進められる(並行作業)</label>${o.parallel ? field("ワークの入れ替え時間 [秒](仕上がったワークと次のワークを入れ替える時間)", inp("swapT", +o.swapT || 0, "number", 'step="any" min="0"')) : ""}` : ""}
    <div class="tsum">${o.parallel
      ? `自動 ${fmt(a)}秒 と 人 ${fmt(m)}秒 は同時に進む → 長い方 ${fmt(Math.max(a, m))}秒${+o.swapT ? ` + 入れ替え ${fmt(+o.swapT)}秒` : ""} = 1回 <b>${fmt(PS.cycleTime(o))}秒</b>`
      : `自動 ${fmt(a)}秒 + 人 ${fmt(m)}秒 = 1回 <b>${fmt(PS.cycleTime(o))}秒</b>`}${oq > 1 ? ` ・1個あたり <b>${fmt(PS.cycleTime(o) / oq, 1)}秒</b>` : ""}${m ? ` ・人が付くのは ${fmt(m)}秒` : " ・人は付かない"}</div>
    <p class="hint">自動運転 = 機械だけで動く時間(人は離れて他の仕事ができる)。人の作業 = セット・取り外し・目視など、作業者が「作業する面」の前にいないと進まない時間。</p>`;
  if (m > 0) h += field("付く作業者", `<select data-k="op"><option value="">(未定)</option>${doc.objs.filter(x => isAgent(x.type)).map(x => `<option value="${x.id}" ${o.op === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`);
  return h + `</div>`;
}
function flowName(f) { const a = byId(doc, f.from), b = byId(doc, f.to); return `${a ? a.name : "?"} → ${b ? b.name : "?"}`; }
function flowPanel(f) {
  const a = byId(doc, f.from), b = byId(doc, f.to);
  const ags = doc.objs.filter(o => isAgent(o.type)), mvs = doc.objs.filter(o => isMovable(o.type));
  const how = f.mode === "auto" ? "auto" : f.mover ? "mv:" + f.mover : "hand";
  let h = `<h2>モノの流れ</h2><p><b>${esc(a.name)}</b> → <b>${esc(b.name)}</b><br><span class="muted">運ぶモノ: ${esc(outputName(doc, a))}</span></p>`;
  h += field("運び方", `<select data-fk="how"><option value="hand" ${how === "hand" ? "selected" : ""}>手で持って運ぶ</option>${mvs.map(m => `<option value="mv:${m.id}" ${how === "mv:" + m.id ? "selected" : ""}>${esc(m.name)}(${esc(CAT[m.type].label)}・${m.cap}個)で運ぶ</option>`).join("")}<option value="auto" ${how === "auto" ? "selected" : ""}>自動(コンベア・シュート等)</option></select>`);
  if (how !== "auto") h += field("運ぶ人・ロボット", `<select data-fk="agent"><option value="">(未定)</option>${ags.map(o => `<option value="${o.id}" ${f.agent === o.id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select>`);
  if (how === "hand") h += field("1回に運ぶ数 [個]", `<input type="number" data-fk="batch" value="${f.batch || 1}" min="1" step="1">`);
  const mvObj = f.mover ? byId(doc, f.mover) : null;
  if (mvObj && mvObj.type === "container") {
    const boxes = doc.objs.filter(o => o.type === "container");
    h += `<h4>使うポリ箱(通い箱)</h4><div class="list">${boxes.map(b => `<label><input type="checkbox" data-fbox="${b.id}" ${(f.mover === b.id || (f.movers || []).includes(b.id)) ? "checked" : ""}> ${esc(b.name)}(${b.cap}個入り)</label>`).join("")}</div>
      <p class="hint">取り出す側に置いた空き箱に部品が溜まり、満杯になったら箱ごと運びます。入れる側では箱から1個ずつ使い、空になった箱を取り出す側へ戻します。箱を2つ以上にすると、使っている間に次の箱を満たしておけます。</p>`;
  }
  if (!mvs.length && how !== "auto") h += `<p class="hint">左の「台車」「TPポリ箱」を置くと、まとめて運ぶ運び方を選べます。</p>`;
  h += `<div class="acts"><button class="btn" data-act="rev">向きを反対に</button><button class="btn" data-act="del">削除</button></div>`;
  return h;
}
function bindPanel(P) {
  P.querySelectorAll("[data-day]").forEach(el => el.addEventListener("change", () => {
    doc.day[el.dataset.day] = el.value; doc.day = PS.dayOf(doc.day); save(); docVer++;
    el.value = el.dataset.day === "demand" && !doc.day.demand ? "" : doc.day[el.dataset.day]; // 範囲外は直した値を見せる
    const st = $("#resStale"); if (st) st.hidden = false;
  }));
  P.querySelectorAll("[data-k]").forEach(el => el.addEventListener("change", () => {
    if (el.dataset.doc) { doc[el.dataset.k] = el.value; save(); return; }
    const o = selObj(); if (!o) return;
    const k = el.dataset.k;
    change(() => {
      let v = el.type === "checkbox" ? el.checked : el.type === "number" ? (+el.value || 0) : el.value;
      if (k === "w" || k === "h") { v = Math.max(100, v); const x0 = o.x - o.w / 2, y0 = o.y - o.h / 2; o[k] = v; o.x = x0 + o.w / 2; o.y = y0 + o.h / 2; }
      else if (k === "x0") o.x = v + o.w / 2;
      else if (k === "y0") o.y = v + o.h / 2;
      else if (k === "op") o.op = v || null;
      else if (k === "dir") o.dir = +v;
      else { o[k] = v; if (!o.edited.includes(k)) o.edited.push(k); }
      if (k === "needOp" && v && !o.op) { const a = nearestAgent(o, "worker"); if (a) o.op = a.id; }
    });
  }));
  P.querySelectorAll("[data-fk]").forEach(el => el.addEventListener("change", () => {
    const f = selFlow(); if (!f) return;
    change(() => {
      const k = el.dataset.fk;
      if (k === "how") {
        const v = el.value;
        f.mode = v === "auto" ? "auto" : v.startsWith("mv:") ? "mover" : "hand";
        f.mover = v.startsWith("mv:") ? v.slice(3) : null; f.movers = [];
        if (f.mode !== "auto" && !f.agent) { const a = nearestAgent(byId(doc, f.from), "worker"); if (a) f.agent = a.id; }
      } else if (k === "agent") f.agent = el.value || null;
      else if (k === "batch") f.batch = Math.max(1, Math.round(+el.value || 1));
    });
  }));
  P.querySelectorAll("[data-portreset]").forEach(el => el.onclick = () => {
    const o = selObj(); change(() => { for (const r in o.portAuto) o.portAuto[r] = true; delete o.portOff; delete o.portShared; });
  });
  P.querySelectorAll("[data-portmerge]").forEach(el => el.onclick = () => {
    const o = selObj();
    change(() => {
      o.portOff = Object.assign({}, o.portOff || {});
      if (PS.sharedPort(o)) { o.portShared = false; delete o.portOff.in; delete o.portOff.out; }
      else { const p = PS.portPoint(o, "in"); o.ports.out = o.ports.in; o.portOff.in = o.portOff.out = p.off; o.portAuto.in = o.portAuto.out = false; o.portShared = true; }
    });
  });
  P.querySelectorAll("[data-inflow]").forEach(el => el.onchange = () => {
    const f = doc.flows.find(x => x.id === el.dataset.inflow);
    if (doc.flows.some(x => x !== f && x.from === el.value && x.to === f.to)) { toast("その前工程はすでにつながっています"); inspector(); return; }
    change(() => { f.from = el.value; });
  });
  P.querySelectorAll("[data-inname]").forEach(el => el.onchange = () => {
    const f = doc.flows.find(x => x.id === el.dataset.inname), a = byId(doc, f.from), v = el.value.trim();
    change(() => { if (a.type === "in" || a.type === "part") a.item = v || a.item; else a.outName = v; });
  });
  P.querySelectorAll("[data-inqty]").forEach(el => el.onchange = () => {
    const o = selObj(); change(() => { o.inQty = o.inQty || {}; o.inQty[el.dataset.inqty] = Math.max(1, Math.round(+el.value || 1)); });
  });
  P.querySelectorAll("[data-delflow]").forEach(el => el.onclick = () => { change(() => { doc.flows = doc.flows.filter(x => x.id !== el.dataset.delflow); }); });
  P.querySelectorAll("[data-addin]").forEach(el => el.onchange = () => { if (el.value) addFlow(el.value, selObj().id, true); });
  P.querySelectorAll("[data-addout]").forEach(el => el.onchange = () => { if (el.value) addFlow(selObj().id, el.value, true); });
  P.querySelectorAll("[data-fbox]").forEach(el => el.onchange = () => {
    const f = selFlow(); if (!f) return;
    change(() => {
      const set = new Set([f.mover, ...(f.movers || [])].filter(Boolean));
      if (el.checked) set.add(el.dataset.fbox); else set.delete(el.dataset.fbox);
      const list = [...set]; if (!list.length) { toast("ポリ箱は1つ以上選んでください"); return; }
      f.mover = list[0]; f.movers = list.slice(1);
    });
  });
  P.querySelectorAll("[data-assign]").forEach(el => el.addEventListener("change", () => {
    const o = selObj(), f = doc.flows.find(x => x.id === el.dataset.assign);
    change(() => { f.agent = el.checked ? o.id : (f.agent === o.id ? null : f.agent); });
  }));
  P.querySelectorAll("[data-op]").forEach(el => el.addEventListener("change", () => {
    const o = selObj(), s = byId(doc, el.dataset.op);
    change(() => { s.op = el.checked ? o.id : (s.op === o.id ? null : s.op); });
  }));
  P.querySelectorAll("[data-act]").forEach(el => el.onclick = () => {
    const a = el.dataset.act;
    if (a === "del") delSel();
    if (a === "dup") dupSel();
    if (a === "rot") rotSel();
    if (a === "rev") { const f = selFlow(); change(() => { const t = f.from; f.from = f.to; f.to = t; }); }
  });
}

// ===== 事前チェック(確認事項) =====
function checks() {
  const w = [];
  const eq = doc.objs.filter(o => ["process", "join", "inspect", "bench"].includes(o.type));
  if (!doc.objs.some(o => o.type === "in" || o.type === "part")) w.push("搬入口(または部品置き場)がありません");
  if (!doc.objs.some(o => o.type === "out")) w.push("搬出口がありません");
  for (const o of doc.objs) if (isStation(o.type) && o.type !== "in" && o.type !== "part" && !doc.flows.some(f => f.to === o.id)) w.push(`「${o.name}」に入ってくる流れがありません`);
  for (const o of doc.objs) if (isStation(o.type) && o.type !== "out" && !doc.flows.some(f => f.from === o.id)) w.push(`「${o.name}」から出ていく流れがありません`);
  for (const o of doc.objs) if (o.type === "join" && doc.flows.filter(f => f.to === o.id).length < 2) w.push(`「${o.name}」(A+B→C)に入る流れが1本以下です`);
  for (const f of doc.flows) if (f.mode !== "auto" && !f.agent) w.push(`「${flowName(f)}」の運び手が未定です`);
  for (const o of doc.objs) if (o.needOp && !o.op) w.push(`「${o.name}」に付く作業者が未定です`);
  const g0 = PS.buildGrid(doc);
  for (const f of doc.flows) {
    if (f.mode === "auto") continue;
    const a = byId(doc, f.from), b = byId(doc, f.to);
    if (PS.accessPoint(doc, g0, a, "out").off > 600) w.push(`「${a.name}」の取り出す面の前に立てません(面の向き・通路を確認)`);
    if (PS.accessPoint(doc, g0, b, "in").off > 600) w.push(`「${b.name}」の入れる面の前に立てません(面の向き・通路を確認)`);
  }
  for (const o of doc.objs) if (o.needOp && PS.accessPoint(doc, g0, o, "op").off > 600) w.push(`「${o.name}」の作業する面の前に立てません`);
  if (doc.walkOnly !== false && !doc.objs.some(o => o.type === "walk") && doc.objs.some(o => isAgent(o.type))) w.push("通路(歩く所)が描かれていません。左の「通路(歩く所)」で囲むと、人はその中だけを歩きます");
  const zero = eq.filter(o => PS.isTimed(o.type) && !(PS.cycleTime(o) > 0));
  if (zero.length) w.push(`1回の時間が0秒の設備があります(入力漏れの可能性。1日の数が多く出ます): ${zero.map(o => o.name).join("、")}`);
  const tmp = eq.filter(o => !(o.edited || []).some(k => k === "autoT" || k === "manT"));
  if (tmp.length) w.push(`時間(自動運転/人の作業)が仮の値: ${tmp.map(o => o.name).join("、")}`);
  if (doc.bg && !doc.bg.calibrated) w.push("下絵の縮尺がまだ合わせられていません");
  return [...new Set(w)];
}

// ===== シミュレーション =====
function resetSim() { simRun = false; sim = null; $("#simPlay").textContent = "▶ 動かす"; $("#simClock").textContent = "0:00:00"; $("#simKpi").textContent = "完成 0 個"; }
function newSim() { return new PS.Sim(JSON.parse(JSON.stringify(doc))); }
function togglePlay() {
  if (!doc.objs.some(o => isAgent(o.type)) && !doc.flows.some(f => f.mode === "auto")) { toast("作業者か LexxMoMa を置くと動かせます"); return; }
  if (!sim) { sim = newSim(); if (sim.warn.length) toast(sim.warn[0] + (sim.warn.length > 1 ? ` ほか${sim.warn.length - 1}件` : "")); renderAll(); track("sim/play", "動かす"); }
  simRun = !simRun;
  $("#simPlay").textContent = simRun ? "⏸ 止める" : "▶ 続ける";
  if (simRun) { last = performance.now(); schedule(); }
}
let last = 0;
function loop(ts) {
  if (!simRun || !sim) return;
  const real = Math.min(0.1, (ts - last) / 1000); last = ts;
  let t = real * (+$("#simSpeed").value);
  while (t > 1e-6) { const dt = Math.min(0.1, t); sim.step(dt); t -= dt; }
  renderDyn();
  schedule();
}
// 非表示タブでは rAF が止まるので setTimeout で進める
function schedule() { if (document.hidden) setTimeout(() => loop(performance.now()), 50); else requestAnimationFrame(loop); }
$("#simPlay").onclick = togglePlay;
$("#simReset").onclick = () => { resetSim(); renderAll(); };
$("#optTrail").onchange = renderDyn;
$("#simCalc").onclick = () => {
  if (!doc.objs.some(o => isAgent(o.type)) && !doc.flows.some(f => f.mode === "auto")) { toast("作業者か LexxMoMa を置くと計算できます"); return; }
  simRun = false; $("#simPlay").textContent = "▶ 続ける";
  calcDay();
  track("sim/calc", "1日分を計算");
};
function calcDay() {
  simRun = false; $("#simPlay").textContent = "▶ 動かす";
  const r = PS.simulateDay(doc); r.ver = docVer;
  lastDay = r; lastRes = r.main; sim = r.sim;
  renderAll(); showDay();
  window.dispatchEvent(new Event("ps:calculated"));
  return r;
}
function showDay() {
  $("#res").innerHTML = dayHTML(lastDay);
  bindDay(); switchTab("res");
}
function showResults(res, isCalc) {
  if (isCalc) { prevRes = lastRes; lastRes = res; }
  $("#res").innerHTML = resultsHTML(res, isCalc ? prevRes : null);
  bindResults();
  switchTab("res");
}
function delta(cur, prev, unit, better) {
  if (prev == null) return "";
  const d = cur - prev; if (Math.abs(d) < 0.05) return `<span class="d muted">前回と同じ</span>`;
  const good = better === "up" ? d > 0 : d < 0;
  return `<span class="d ${good ? "up" : "down"}">前回比 ${d > 0 ? "+" : ""}${fmt(d, 1)}${unit}</span>`;
}
function resultsHTML(res, prev) {
  const H = res.simSec / 3600;
  const walkH = res.agents.filter(a => a.type === "worker").reduce((s, a) => s + a.perHourM, 0);
  const pWalk = prev ? prev.agents.filter(a => a.type === "worker").reduce((s, a) => s + a.perHourM, 0) : null;
  let h = `<h2>結果 <small class="muted">(${fmt(H * 60)}分ぶん)</small></h2>`;
  if (res.warn.length) h += `<div class="warn">${res.warn.map(w => `<div>・${esc(w)}</div>`).join("")}</div>`;
  h += `<div class="stat"><div><small>完成</small><b>${fmt(res.perHour, 1)}</b><small>個/時</small> ${delta(res.perHour, prev && prev.perHour, "個", "up")}</div>
        <div><small>作業者の歩行</small><b>${fmt(walkH)}</b><small>m/時(合計)</small> ${delta(walkH, pWalk, "m", "down")}</div></div>`;
  const ts = res.time;
  h += `<h4>工程の時間</h4><table class="t">
    <tr><th>完成の間隔(実際)</th><td class="n"><b>${res.pitch ? fmt(res.pitch, 1) + " 秒/個" : "-"}</b></td></tr>
    <tr><th>リードタイム(搬入→搬出・概算)</th><td class="n">${res.leadTime ? (res.leadTime >= 120 ? fmt(res.leadTime / 60, 1) + " 分" : fmt(res.leadTime) + " 秒") : "-"}</td></tr>
    <tr><th>1個が通る設備の時間(最長ルート)</th><td class="n">${ts.path ? fmt(ts.path.t) + " 秒" : "-"}</td></tr>
    <tr><th>一番長い設備</th><td class="n">${ts.slow ? esc(ts.slow.o.name) + " " + fmt(ts.slow.ct) + " 秒/回" : "-"}</td></tr></table>
    <p class="hint">完成の間隔が設備の時間より長いときは、運搬や人待ちで止まっています(下の「人待ち」「待ち」を確認)。</p>`;
  if (res.bottleneck) h += `<p>一番忙しいのは <b>${esc(res.bottleneck.name)}</b>(${res.bottleneck.kind}・稼働 ${fmt(res.bottleneck.util * 100)}%)。ここが全体の速さを決めています。</p>`;
  const segs = [["work", "作業", "#e07b1f"], ["carry", "運んで歩く", "#2f9e62"], ["walk", "手ぶらで歩く", "#9fd3b4"], ["handle", "積み降ろし", "#f3b77a"], ["idle", "待ち", "#dde2e7"]];
  h += `<h4>人・ロボットの時間の使い方</h4>`;
  for (const a of res.agents) h += `<div class="agrow"><div class="n"><b style="color:${agentColor(doc, a.id)}">${esc(a.name)}</b><span>歩行 ${fmt(a.perHourM)} m/時・向き替え ${fmt(a.turnPerH / 60, 1)} 分/時</span></div><div class="bar">${segs.map(([k, , c]) => `<i style="width:${a.ratio[k] * 100}%;background:${c}" title="${fmt(a.ratio[k] * 100)}%"></i>`).join("")}</div></div>`;
  h += `<div class="legend">${segs.map(([, t, c]) => `<span><i style="background:${c}"></i>${t}</span>`).join("")}</div>`;
  if (res.stations.length) h += `<h4>設備の稼働率</h4><table class="t"><tr><th>設備</th><th>1回</th><th>自動</th><th>人</th><th>人待ち</th><th>材料待ち</th><th>詰まり</th></tr>${res.stations.map(s => `<tr><td>${esc(s.name)}</td><td class="n">${fmt(s.ct)}秒</td><td class="n">${fmt(s.autoUtil * 100)}%</td><td class="n">${fmt(s.manUtil * 100)}%</td><td class="n">${fmt(s.waitOp * 100)}%</td><td class="n">${fmt(s.starve * 100)}%</td><td class="n">${fmt(s.block * 100)}%</td></tr>`).join("")}</table><p class="hint">自動/人=動いていた割合。人待ち=材料はあるのに作業者が来ない / 材料待ち=モノが来ない / 詰まり=出来たモノが運ばれない</p>`;
  const cands = autoCandidates(res);
  if (cands.length) {
    h += `<h4>LexxMoMa に任せる候補(歩行が多い運搬)</h4>`;
    h += cands.slice(0, 3).map(c => `<div class="cand"><b>${esc(c.from)} → ${esc(c.to)}</b>(${esc(c.item)})<br>片道 ${fmt(c.oneWayM, 1)} m・${fmt(c.tripsPerH, 1)} 回/時・歩行 ${fmt(c.distPerHM)} m/時<br>${c.agent === "LexxMoMa" || /LexxMoMa/.test(c.agent) ? '<span class="muted">すでに LexxMoMa が担当</span>' : `<button class="btn" data-lx="${c.id}">この運搬を LexxMoMa に任せてみる</button>`}</div>`).join("");
  }
  h += `<h4>流れごとの運搬</h4><table class="t"><tr><th>流れ</th><th>担当</th><th>片道</th><th>回/時</th></tr>${res.flows.map(f => `<tr><td>${esc(f.from)}→${esc(f.to)}</td><td>${esc(f.agent)}</td><td class="n">${fmt(f.oneWayM, 1)}m</td><td class="n">${fmt(f.tripsPerH, 1)}</td></tr>`).join("")}</table>`;
  h += `<div class="acts"><button class="btn p" id="resReport">この結果で検討シートを作る</button></div>`;
  h += `<p class="hint">簡易モデルです: 人は「満杯分たまったら運ぶ」、設備は「材料があれば1個ずつ加工」。段取り替え・休憩・故障は含みません。</p>`;
  return h;
}
const SEGS = [["work", "作業", "#e07b1f"], ["carry", "運んで歩く", "#2f9e62"], ["walk", "手ぶらで歩く", "#9fd3b4"], ["handle", "積み降ろし", "#f3b77a"], ["charge", "充電", "#b9c3cc"], ["idle", "待ち", "#dde2e7"]];
function num(v, d) { return v == null ? "-" : fmt(v, d); }
function dayHTML(r) {
  const d = r.day, bl = doc.baseline, m = PS.dayMetrics(r);
  let h = `<div id="resStale" class="warn" ${r.ver === docVer ? "hidden" : ""}>図や条件を変えました。もう一度「1日分を計算」を押すと結果が新しくなります。</div>`;
  h += `<h2>1日の結果</h2>
    <div class="daybar">
      <label>稼働<input type="number" data-day="hours" value="${d.hours}" step="0.5" min="0.5" max="24">時間</label>
      <label>休憩<input type="number" data-day="breakMin" value="${d.breakMin}" step="5" min="0">分</label>
      <label>必要数<input type="number" data-day="demand" value="${d.demand || ""}" step="1" min="0" placeholder="未設定">個</label>
      <label>LexxMoMa稼働率<input type="number" data-day="robotAvail" value="${d.robotAvail}" step="1" min="10" max="100">%</label>
      <button class="btn" id="dayRecalc">この条件で計算</button></div>`;
  if (r.main.warn.length) h += `<div class="warn">${r.main.warn.map(w => `<div>・${esc(w)}</div>`).join("")}</div>`;
  const verdict = d.demand ? (r.met ? `<span class="okb">必要数 ${fmt(d.demand)}個に届く</span>` : `<span class="ngb">必要数 ${fmt(d.demand)}個に ${fmt(Math.ceil(r.short))}個 足りない</span>`) : `<span class="muted">必要数を入れると届くか判定します</span>`;
  h += `<div class="concl">
    <div class="big"><small>1日にできる数</small><b>${fmt(r.perDay)}</b> <small>個/日</small><div>${verdict}</div></div>
    <div><small>完成の間隔</small><b>${num(r.main.pitch, 1)}</b><small>秒/個${r.takt ? `(タクト ${fmt(r.takt, 1)}秒)` : ""}</small></div>
    <div><small>人の作業時間</small><b>${fmt(r.peopleH, 1)}</b><small>時間/日(${r.nWorkers}人)</small></div>
    <div><small>人の歩く距離</small><b>${fmt(r.walkKm, 1)}</b><small>km/日</small></div>
    <div><small>LexxMoMa の稼働</small><b>${r.nRobots ? fmt(r.robotH, 1) : "-"}</b><small>${r.nRobots ? `時間/日(${r.nRobots}台)` : "未導入"}</small></div>
  </div>`;
  const bn = r.main.bottleneck;
  if (bn) h += `<p style="margin:6px 0">全体の速さを決めているのは <b>${esc(bn.name)}</b>(${bn.supply ? "材料が入ってくる速さ。ここより後ろを速くしても1日の数は増えません" : `${bn.kind}・稼働 ${fmt(bn.util * 100)}%`})。</p>`;
  if (bl) {
    const b = bl.m, row = (t, k, dgt, unit, better) => {
      const x = b[k], y = m[k], dv = (y || 0) - (x || 0), good = better === "up" ? dv > 0 : dv < 0;
      return `<tr><th>${t}</th><td class="n">${num(x, dgt)}</td><td class="n"><b>${num(y, dgt)}</b></td><td class="n ${Math.abs(dv) < 0.05 || !better ? "" : good ? "up" : "down"}">${Math.abs(dv) < 0.05 ? "±0" : (dv > 0 ? "+" : "") + fmt(dv, dgt)}${unit}</td></tr>`;
    };
    h += `<h4>「${esc(bl.name)}」との比較</h4><table class="t cmp"><tr><th></th><th class="n">${esc(bl.name)}</th><th class="n">いま</th><th class="n">差</th></tr>
      ${row("1日にできる数", "perDay", 0, "個", "up")}${row("人の作業時間", "peopleH", 1, "時間", "down")}${row("人の歩く距離", "walkKm", 1, "km", "down")}
      ${row("作業者", "nWorkers", 0, "人", "down")}${row("LexxMoMa", "nRobots", 0, "台", "")}${row("完成の間隔", "pitch", 1, "秒", "down")}</table>`;
  }
  const robots = doc.objs.filter(o => o.type === "robot");
  if (robots.length) h += `<div class="lxdone">${robots.map(rb => {
      const jobs = [...doc.flows.filter(f => f.agent === rb.id).map(f => "運ぶ: " + flowName(f)), ...doc.objs.filter(o => o.op === rb.id).map(o => "設備の作業: " + o.name)];
      return `<div><b>${esc(rb.name)}</b> に任せている作業: ${jobs.length ? jobs.map(esc).join("、") : "なし"}</div>`;
    }).join("")}</div>`;
  h += `<div class="acts">
    <button class="btn g" id="lxOpen">LexxMoMa に任せる作業を選ぶ</button>
    ${bl ? `<button class="btn" id="blRestore" title="現状の図に戻す">「${esc(bl.name)}」の図に戻す</button><button class="btn ghost" id="blClear">比較をやめる</button>`
         : `<button class="btn" id="blSave" title="この結果を基準にして、あとで比べる">この結果を「現状」として残す</button>`}
    <button class="btn p" id="resReport">検討シートを作る</button></div>`;
  h += `<div id="lxBox" hidden>${lxChooserHTML(r)}</div>`;
  // 詳しく
  const res = r.main;
  h += `<details class="more"><summary>詳しく見る(1時間あたり・人と設備ごと)</summary>`;
  h += `<table class="t"><tr><th>完成(1日の平均)</th><td class="n">${fmt(res.perHour, 1)} 個/時</td></tr>
    ${r.brk ? `<tr><th>完成(人の休憩中)</th><td class="n">${fmt(r.brk.perHour, 1)} 個/時</td></tr>` : ""}
    <tr><th>リードタイム(搬入→搬出・概算)</th><td class="n">${res.leadTime ? (res.leadTime >= 120 ? fmt(res.leadTime / 60, 1) + " 分" : fmt(res.leadTime) + " 秒") : "-"}</td></tr>
    <tr><th>1個が通る設備の時間(最長ルート)</th><td class="n">${res.time.path ? fmt(res.time.path.t) + " 秒" : "-"}</td></tr></table>`;
  h += `<h4>人・ロボットの時間の使い方</h4>`;
  for (const a of res.agents) h += `<div class="agrow"><div class="n"><b style="color:${agentColor(doc, a.id)}">${esc(a.name)}</b><span>歩行 ${fmt(a.perHourM)} m/時</span></div><div class="bar">${SEGS.map(([k, , c]) => `<i style="width:${(a.ratio[k] || 0) * 100}%;background:${c}" title="${fmt((a.ratio[k] || 0) * 100)}%"></i>`).join("")}</div></div>`;
  h += `<div class="legend">${SEGS.map(([, t, c]) => `<span><i style="background:${c}"></i>${t}</span>`).join("")}</div>`;
  if (res.stations.length) h += `<h4>設備の稼働率</h4><table class="t"><tr><th>設備</th><th>1回</th><th>自動</th><th>人</th><th>人待ち</th><th>材料待ち</th><th>詰まり</th></tr>${res.stations.map(x => `<tr><td>${esc(x.name)}</td><td class="n">${fmt(x.ct)}秒</td><td class="n">${fmt(x.autoUtil * 100)}%</td><td class="n">${fmt(x.manUtil * 100)}%</td><td class="n">${fmt(x.waitOp * 100)}%</td><td class="n">${fmt(x.starve * 100)}%</td><td class="n">${fmt(x.block * 100)}%</td></tr>`).join("")}</table>`;
  h += `<h4>流れごとの運搬</h4><table class="t"><tr><th>流れ</th><th>担当</th><th>片道</th><th>回/時</th></tr>${res.flows.map(f => `<tr><td>${esc(f.from)}→${esc(f.to)}</td><td>${esc(f.agent)}</td><td class="n">${fmt(f.oneWayM, 1)}m</td><td class="n">${fmt(f.tripsPerH, 1)}</td></tr>`).join("")}</table>`;
  h += `</details><p class="hint">計算の前提: 始業から終業まで連続して計算。休憩は勤務時間の中央にまとめて配置し、人の途中作業・在庫・箱の中身は保持します。自動設備とロボットは休憩中も動作します。時間は平均値で、ばらつき・段取り替え・故障は含みません。</p>`;
  return h;
}
// LexxMoMa に任せられそうな作業(人の時間が長い順): 運搬と設備に付く作業
function lxTasks(r) {
  const res = r.main, t = [];
  for (const f of res.flows) {
    const fl = doc.flows.find(x => x.id === f.id), ag = fl && byId(doc, fl.agent);
    if (!fl || fl.mode === "auto" || !ag || ag.type !== "worker") continue;
    const v = Math.max(0.3, +ag.speed || 1), min = f.tripsPerH * (2 * f.oneWayM / v + 2 * (+ag.handle || 3)) / 60;
    t.push({ kind: "flow", id: f.id, label: `運ぶ: ${f.from} → ${f.to}`, sub: `${fmt(f.tripsPerH, 1)}回/時・片道 ${fmt(f.oneWayM, 1)}m`, min });
  }
  for (const o of doc.objs) {
    if (!PS.isTimed(o.type) || !(+o.manT > 0)) continue;
    const ag = byId(doc, o.op); if (ag && ag.type !== "worker") continue;
    const st = res.stations.find(x => x.id === o.id);
    t.push({ kind: "op", id: o.id, label: `設備の作業: ${o.name}`, sub: `人の作業 ${fmt(+o.manT)}秒/回`, min: st ? st.manUtil * 60 : 0 });
  }
  return t.sort((a, b) => b.min - a.min);
}
function lxChooserHTML(r) {
  const t = lxTasks(r);
  if (!t.length) return `<p class="muted">人が担当している作業がありません。</p>`;
  return `<div class="lxbox"><div class="pc-h">LexxMoMa に任せる作業を選んでください <span class="muted">(人の時間が長い順)</span></div>
    ${t.map((x, i) => `<label class="lxrow"><input type="checkbox" data-lxt="${x.kind}:${x.id}" ${i < 2 ? "checked" : ""}><span><b>${esc(x.label)}</b><br><small class="muted">${esc(x.sub)}・人の時間 約${fmt(x.min)}分/時</small></span></label>`).join("")}
    <div class="acts"><button class="btn g" id="lxApply">選んだ作業を LexxMoMa に任せて比べる</button></div>
    <p class="hint">LexxMoMa がいなければ1台置きます。前提: 走行 ${fmt((byId(doc, (doc.objs.find(o => o.type === "robot") || {}).id) || { speed: 1 }).speed, 1)} m/s、積み降ろし ${fmt((doc.objs.find(o => o.type === "robot") || { handle: 20 }).handle)} 秒/回(アームでのピック想定。LexxMoMa を選んで「詳しい設定」で変えられます)。作業が多すぎると LexxMoMa が詰まるので、その時は2台目を置いて担当を分けてください。</p></div>`;
}
// 図を変えた後の古い結果を「現状」にしない(変えていたら計算し直してから残す)
function freshDay() { return lastDay && lastDay.ver === docVer ? lastDay : calcDay(); }
function saveBaseline(r, name) {
  const snap = JSON.parse(JSON.stringify(Object.assign({}, doc, { bg: null, baseline: null })));
  doc.baseline = { name: name || "現状", at: Date.now(), m: PS.dayMetrics(r), doc: snap };
  save();
}
function bindDay() {
  const q = id => document.getElementById(id);
  document.querySelectorAll("#res [data-day]").forEach(el => el.addEventListener("change", () => {
    doc.day[el.dataset.day] = el.value; doc.day = PS.dayOf(doc.day); save(); docVer++;
    el.value = el.dataset.day === "demand" && !doc.day.demand ? "" : doc.day[el.dataset.day];
    const stl = q("resStale"); if (stl) stl.hidden = false;
  }));
  if (q("dayRecalc")) q("dayRecalc").onclick = () => calcDay();
  if (q("lxOpen")) q("lxOpen").onclick = () => { const b = q("lxBox"); b.hidden = !b.hidden; if (!b.hidden) b.scrollIntoView({ block: "nearest" }); };
  if (q("blSave")) q("blSave").onclick = () => { saveBaseline(freshDay()); showDay(); toast("この結果を「現状」として残しました。図や担当を変えて「1日分を計算」を押すと比べられます"); };
  if (q("blClear")) q("blClear").onclick = () => { doc.baseline = null; save(); showDay(); };
  if (q("blRestore")) q("blRestore").onclick = () => {
    const bl = doc.baseline; snapshot(); const u = undoS.slice();
    setDoc(Object.assign({}, bl.doc, { baseline: bl, bg: doc.bg })); undoS = u; fit(); // 下絵は現状の図に保存していないので今のものを使う
    toast(`「${bl.name}」の図に戻しました`);
  };
  if (q("resReport")) q("resReport").onclick = () => $("#btnReport").click();
  if (q("lxApply")) q("lxApply").onclick = () => {
    const picks = [...document.querySelectorAll("[data-lxt]:checked")].map(el => el.dataset.lxt.split(":"));
    if (!picks.length) { toast("任せる作業を1つ以上選んでください"); return; }
    if (!doc.baseline) saveBaseline(freshDay());
    let r = doc.objs.find(o => o.type === "robot");
    change(() => {
      if (!r) {
        const [kind, id] = picks[0], f = kind === "flow" ? doc.flows.find(x => x.id === id) : null;
        const st = f ? byId(doc, f.from) : byId(doc, id), g = PS.buildGrid(doc), p = PS.accessPoint(doc, g, st, f ? "out" : "op");
        r = PS.makeObj("robot", p.x, p.y); r.name = "LexxMoMa1"; doc.objs.push(r);
      }
      for (const [kind, id] of picks) {
        if (kind === "flow") { const f = doc.flows.find(x => x.id === id); if (f) f.agent = r.id; }
        else { const o = byId(doc, id); if (o) o.op = r.id; }
      }
    });
    track("sim/lexxmoma", "LexxMoMaに任せる");
    calcDay();
    toast(`${picks.length}つの作業を ${r.name} に任せて計算しました。「現状」と比べられます`);
  };
}
function autoCandidates(res) {
  return res.flows.filter(f => f.mode !== "auto" && f.distPerHM > 0).sort((a, b) => b.distPerHM - a.distPerHM);
}
function bindResults() {
  document.querySelectorAll("[data-lx]").forEach(b => b.onclick = () => {
    const f = doc.flows.find(x => x.id === b.dataset.lx); if (!f) return;
    let r = doc.objs.find(o => o.type === "robot");
    change(() => {
      if (!r) {
        const a = byId(doc, f.from), b2 = byId(doc, f.to);
        const g = PS.buildGrid(doc), p = PS.accessPoint(doc, g, a, b2);
        r = PS.makeObj("robot", p.x, p.y); r.name = "LexxMoMa1"; doc.objs.push(r);
      }
      f.agent = r.id;
    });
    toast(`「${flowName(f)}」を ${r.name} の担当にしました。もう一度「1日分を計算」で比べられます`);
    track("sim/lexxmoma", "LexxMoMaに任せる");
    $("#simCalc").click();
  });
  const rb = $("#resReport"); if (rb) rb.onclick = () => $("#btnReport").click();
}
function switchTab(t) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
  $("#insp").hidden = t !== "insp"; $("#res").hidden = t !== "res";
  if (t === "res" && !$("#res").innerHTML) $("#res").innerHTML = `<p class="muted">下の「1日分を計算」を押すと、1日にできる数・人の作業時間・LexxMoMa に任せたときの比較が出ます。</p>`;
}
document.querySelectorAll(".tab").forEach(b => b.onclick = () => switchTab(b.dataset.tab));

// ===== ひな形 =====
const TEMPLATES = [
  { id: "blank", t: "白紙", d: "20×12m の空のエリア", build: () => PS.newDoc() },
  { id: "line", t: "直線ライン", d: "搬入 → 加工 → 検査 → 搬出・作業者1人", build: () => tpl(16000, 8000, [
      ["walk", 0, 0, { name: "通路1", pts: [{ x: 300, y: 2800 }, { x: 15700, y: 2800 }, { x: 15700, y: 6600 }, { x: 300, y: 6600 }] }],
      ["in", 1000, 4000, { item: "A" }], ["process", 5000, 4000], ["inspect", 9000, 4000], ["out", 14500, 4000], ["worker", 9000, 5800, { dir: -90 }]],
      [[1, 2], [2, 3], [3, 4]]) },
  { id: "join", t: "合流セル(溶接・組立)", d: "A と B を合わせて C に・台車で出荷", build: () => tpl(18000, 10000, [
      ["walk", 0, 0, { name: "通路1", pts: [{ x: 1900, y: 1900 }, { x: 4200, y: 1900 }, { x: 4200, y: 3900 }, { x: 17000, y: 3900 }, { x: 17000, y: 7600 }, { x: 4200, y: 7600 }, { x: 4200, y: 8100 }, { x: 1900, y: 8100 }] }],
      ["in", 1200, 2500, { item: "A" }], ["part", 1200, 7500, { item: "B" }], ["join", 6500, 5000, { name: "溶接1", autoT: 60, manT: 20, outName: "C" }], ["inspect", 11000, 5000],
      ["out", 16500, 5000], ["cart", 13500, 7000], ["worker", 4000, 5000], ["worker", 11000, 6600]],
      [[1, 3], [2, 3], [3, 4], [4, 5, { mover: 6 }]]) },
  { id: "weldcell", t: "成形 → 溶着セル(2台・並行作業)", d: "大型成形機の取出し → 落下台 → 人が溶着機へセット → 検査 → 台車で出荷", build: () => {
    // 工程: ①成形機から落下台へ自動払い出し ②遮音材を溶着機にセット ③落下台の成形品を溶着機にセット
    //       (溶着機は並行作業: 自動溶着の間に人が次のセット・取り出し) ④取り出して検査 ⑤台車に載せて出荷
    // 寸法: 溶着機 W4.5m×D3.5m ×2、機械間のセル 5m×4.2m、右の通路 3m、溶着機の開口 2.8m。時間はすべて仮の値
    const weld = (y, face, n) => ["join", 9700, y, { w: 4500, h: 3500, name: "超音波溶着機" + n, outName: "溶着品", autoT: 70, manT: 25, parallel: true, swapT: 5, portW: 2800,
      ports: { in: face, out: face, op: face }, portAuto: { in: false, out: false, op: false }, portShared: true, portOff: { in: 0, out: 0 } }];
    const d = tpl(15600, 15000, [
      ["walk", 0, 0, { name: "通路・作業エリア", pts: [{ x: 7200, y: 4500 }, { x: 12200, y: 4500 }, { x: 12200, y: 300 }, { x: 15300, y: 300 }, { x: 15300, y: 14800 }, { x: 6800, y: 14800 }, { x: 6800, y: 12500 }, { x: 12200, y: 12500 }, { x: 12200, y: 8700 }, { x: 7200, y: 8700 }] }],
      ["wall", 3400, 7300, { w: 6800, h: 13000, name: "大型成形機(既存)" }],
      ["in", 7100, 6600, { w: 600, h: 900, name: "成形取出機", item: "成形品", interval: 60, ports: { out: "E" }, portAuto: { out: false } }],
      ["buffer", 7800, 6600, { w: 800, h: 1000, name: "落下台", cap: 4, ports: { in: "W", out: "E" }, portAuto: { in: false, out: false } }],
      ["part", 7800, 5100, { w: 800, h: 900, name: "遮音材置場(上)", item: "遮音材", boxed: true, ports: { out: "E" }, portAuto: { out: false } }],
      ["part", 7800, 8100, { w: 800, h: 900, name: "遮音材置場(下)", item: "遮音材", boxed: true, ports: { out: "E" }, portAuto: { out: false } }],
      weld(2750, "S", 1), weld(10450, "N", 2),
      ["inspect", 9400, 5900, { w: 1000, h: 700, name: "検査治具1", manT: 20 }],
      ["inspect", 9400, 7300, { w: 1000, h: 700, name: "検査治具2", manT: 20 }],
      ["buffer", 11200, 6600, { w: 1000, h: 1800, name: "仮置台", cap: 20 }],
      ["cart", 13300, 5200, { name: "台車1", cap: 10 }], ["cart", 13300, 8000, { name: "台車2(入れ替え用)", cap: 10 }],
      ["out", 14600, 11500, { w: 1200, h: 1500, name: "出荷(通路へ)" }],
      ["worker", 9000, 5100, { dir: -90, name: "作業者(上)" }], ["worker", 9000, 8100, { dir: 90, name: "作業者(下)" }],
      ["note", 7700, 7380, { w: 1300, h: 240, text: "① 自動払い出し" }],
      ["note", 11500, 5050, { w: 1300, h: 240, text: "②③ セット ④ 取り出し" }],
      ["note", 11500, 8150, { w: 1300, h: 240, text: "②③ セット ④ 取り出し" }],
      ["note", 13700, 9500, { w: 1300, h: 260, text: "⑤ 台車で出荷" }]],
      [[2, 3, { auto: 1 }], [3, 6], [4, 6], [3, 7], [5, 7], [6, 8], [7, 9], [8, 10], [9, 10], [10, 13, { mover: 11 }]]);
    // 時間・容量は資料に記載が無いため仮の値(「(仮)」表示・確認事項に出す)
    for (const o of d.objs) o.edited = (o.edited || []).filter(k => k !== "autoT" && k !== "manT");
    return d;
  } },
];
function tpl(w, h, objs, flows) {
  const d = PS.newDoc(); d.area = { w, h };
  const saved = doc; doc = d; // autoName が doc を見るため一時的に差し替え
  const made = objs.map(([t, x, y, ex]) => {
    const o = PS.makeObj(t, x, y, ex || {}); if (!o.name) o.name = PS.autoName(d, t);
    if (ex && (ex.autoT != null || ex.manT != null)) o.edited.push("autoT", "manT"); // ひな形の時間は例として入力済み扱い
    if (ex && ex.w) o.w = ex.w; if (ex && ex.h) o.h = ex.h;
    d.objs.push(o); return o;
  });
  doc = saved;
  const ws = made.filter(o => o.type === "worker");
  for (const [i, j, ex] of flows) {
    const a = made[i], b = made[j], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let ag = null, bd = Infinity; for (const x of ws) { const dd = dist(x, mid); if (dd < bd) { bd = dd; ag = x; } }
    const f = { id: PS.uid("f"), from: a.id, to: b.id, agent: ag ? ag.id : null, mode: "hand", mover: null, batch: 1 };
    if (ex && ex.mover != null) { f.mode = "mover"; f.mover = made[ex.mover].id; }
    if (ex && ex.auto) { f.mode = "auto"; f.agent = null; }
    d.flows.push(f);
  }
  for (const o of made) if (o.needOp) { let bd = Infinity; for (const x of ws) { const dd = dist(x, o); if (dd < bd) { bd = dd; o.op = x.id; } } }
  return d;
}
$("#helpTpl").innerHTML = TEMPLATES.map(t => `<button class="btn" data-htpl="${t.id}"><b>${esc(t.t)}</b><small>${esc(t.d)}</small></button>`).join("");
$("#helpTpl").querySelectorAll("[data-htpl]").forEach(b => b.onclick = () => {
  const t = TEMPLATES.find(x => x.id === b.dataset.htpl);
  if (doc.objs.length) snapshot();
  const keep = { title: doc.title, customer: doc.customer, author: doc.author }, u = undoS.slice();
  setDoc(Object.assign(t.build(), keep)); undoS = u; fit(); $("#help").hidden = true; track("tpl/" + t.id, t.t);
});
$("#tplMenu").innerHTML = TEMPLATES.map(t => `<button data-tpl="${t.id}">${esc(t.t)}<small>${esc(t.d)}</small></button>`).join("");
$("#tplMenu").querySelectorAll("[data-tpl]").forEach(b => b.onclick = () => {
  closeMenus();
  const t = TEMPLATES.find(x => x.id === b.dataset.tpl);
  if (doc.objs.length) snapshot();
  const keep = { title: doc.title, customer: doc.customer, author: doc.author };
  const u = undoS.slice(); setDoc(Object.assign(t.build(), keep)); undoS = u;
  fit(); track("tpl/" + t.id, t.t);
});

// ===== メニュー・ファイル =====
function closeMenus() { document.querySelectorAll(".drop").forEach(d => d.classList.remove("open")); }
$("#btnTpl").onclick = e => { e.stopPropagation(); const o = $("#tplMenu").classList.contains("open"); closeMenus(); if (!o) $("#tplMenu").classList.add("open"); };
$("#btnFile").onclick = e => { e.stopPropagation(); const o = $("#fileMenu").classList.contains("open"); closeMenus(); if (!o) $("#fileMenu").classList.add("open"); };
document.addEventListener("click", e => { if (!e.target.closest(".menu")) closeMenus(); });
$("#fileMenu").querySelectorAll("[data-act]").forEach(b => b.onclick = () => { closeMenus(); fileAct(b.dataset.act); });
function fname(ext) { const base = [doc.customer, doc.title || "工程スケッチ"].filter(Boolean).join("_").replace(/[\\/:*?"<>|\s]+/g, "_"); const d = new Date(); return `${base}_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.${ext}`; }
function download(name, blob) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
async function fileAct(a) {
  if (a === "open") $("#fileOpen").click();
  if (a === "save") { download(fname("json"), new Blob([JSON.stringify(Object.assign({ app: "lexxmoma-process-sketch" }, doc), null, 1)], { type: "application/json" })); track("save", "保存"); }
  if (a === "new") { if (doc.objs.length) snapshot(); const u = undoS.slice(); setDoc(PS.newDoc()); undoS = u; fit(); }
  if (a === "png") { const b = await PSX.png(doc, lastRes && sim ? sim : null); download(fname("png"), b); toast("画像を保存しました(縮尺 100 px/m。2D動作シミュレーターの背景にそのまま使えます)"); track("png", "画像"); }
  if (a === "csv") { const r = calcDay(); download(fname("csv"), PSX.csv(doc, r.main)); track("csv", "CSV"); }
  if (a === "share") {
    try {
      const s = await packDoc(Object.assign({}, doc, { bg: null }));
      const url = location.href.split("#")[0] + "#d=" + s;
      await navigator.clipboard.writeText(url);
      toast(doc.bg ? "共有URLをコピーしました(下絵の画像は含まれません)" : "共有URLをコピーしました。メールやチャットに貼ると同じ図が開きます");
    } catch (e) { toast("この環境ではURLを作れませんでした。ファイル保存(.json)をお使いください"); }
    track("share", "共有URL");
  }
}
async function packDoc(d) {
  const bytes = new TextEncoder().encode(JSON.stringify(d));
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer();
  let bin = ""; new Uint8Array(buf).forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function unpackDoc(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const u = Uint8Array.from(bin, c => c.charCodeAt(0));
  const txt2 = await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
  return JSON.parse(txt2);
}
$("#fileOpen").onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { try {
    // 検討シート(.html)にも図面データが埋め込まれているので、そのまま開ける
    const m2 = /<script type="application\/json" id="ps-data">([\s\S]*?)<\/script>/.exec(r.result);
    const d = JSON.parse(m2 ? m2[1] : r.result); if (doc.objs.length) snapshot(); const u = undoS.slice(); setDoc(d); undoS = u; fit(); toast("読み込みました"); } catch (err) { toast("読み込めないファイルです"); } };
  r.readAsText(f); e.target.value = "";
};
$("#btnUndo").onclick = undo; $("#btnRedo").onclick = redo;
$("#btnHelp").onclick = () => { $("#help").hidden = false; track("help", "使い方"); };
$("#helpX").onclick = () => $("#help").hidden = true;
$("#help").onclick = e => { if (e.target.id === "help") $("#help").hidden = true; };
$("#btnReport").onclick = () => { const snapshot = JSON.parse(JSON.stringify(doc)); const r = calcDay(); PSX.report(snapshot, r.main, [...new Set([...checks(), ...r.main.warn])], r.sim, r); window.dispatchEvent(new Event("ps:report")); track("report", "検討シート"); };

function syncHeader() {
  $("#docTitle").value = doc.title || ""; $("#docCustomer").value = doc.customer || "";
  $("#areaW").value = doc.area.w / 1000; $("#areaH").value = doc.area.h / 1000;
  $("#optWalkOnly").checked = doc.walkOnly !== false;
  $("#bgCtl").hidden = !doc.bg; if (doc.bg) $("#bgOp").value = doc.bg.op;
  document.title = (doc.title ? doc.title + " — " : "") + "工程スケッチ";
}
$("#docTitle").onchange = e => { doc.title = e.target.value; save(); syncHeader(); };
$("#docCustomer").onchange = e => { doc.customer = e.target.value; save(); };
$("#areaW").onchange = e => change(() => { doc.area.w = Math.max(2000, Math.round(+e.target.value * 1000) || doc.area.w); });
$("#areaH").onchange = e => change(() => { doc.area.h = Math.max(2000, Math.round(+e.target.value * 1000) || doc.area.h); });
$("#optClear").onchange = renderOverlay;
$("#optWalkOnly").onchange = e => change(() => { doc.walkOnly = e.target.checked; });

// ===== 下絵 =====
$("#btnBg").onclick = () => $("#fileBg").click();
$("#fileBg").onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    const img = new Image();
    img.onload = () => {
      // 大きすぎる画像は縮小して保存容量を抑える
      const maxPx = 2400, k = Math.min(1, maxPx / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const src = c.toDataURL("image/jpeg", 0.85);
      change(() => { doc.bg = { src, iw: c.width, ih: c.height, x: 0, y: 0, mmPerPx: doc.area.w / c.width, op: 0.5, calibrated: false }; });
      syncHeader();
      toast("下絵を読み込みました。「縮尺を合わせる」で長さの分かる2点を指定すると寸法が合います");
      setTool("calib"); track("bg", "下絵");
    };
    img.src = r.result;
  };
  r.readAsDataURL(f); e.target.value = "";
};
$("#btnCalib").onclick = () => { calibPts = []; setTool("calib"); };
$("#bgOp").oninput = e => { if (doc.bg) { doc.bg.op = +e.target.value; $("#Lbg").innerHTML = bgSVG(doc); } };
$("#bgOp").onchange = save;
$("#btnBgDel").onclick = () => { change(() => { doc.bg = null; }); syncHeader(); };
$("#calibOk").onclick = () => {
  const L = +$("#calibLen").value;
  if (!(L > 0) || calibPts.length < 2) { toast("実際の長さ(mm)を入れてください"); return; }
  const m = dist(calibPts[0], calibPts[1]); const k = L / m, b = doc.bg, p0 = calibPts[0];
  change(() => {
    // 1点目を固定して拡大縮小
    b.x = p0.x - (p0.x - b.x) * k; b.y = p0.y - (p0.y - b.y) * k; b.mmPerPx *= k; b.calibrated = true;
    // 下絵がエリアからはみ出すならエリアを広げる
    doc.area.w = Math.max(doc.area.w, Math.ceil((b.x + b.iw * b.mmPerPx) / 500) * 500);
    doc.area.h = Math.max(doc.area.h, Math.ceil((b.y + b.ih * b.mmPerPx) / 500) * 500);
  });
  $("#calibBox").hidden = true; $("#calibLen").value = ""; calibPts = []; setTool("select"); syncHeader(); fit();
  toast("縮尺を合わせました。下絵の上に設備を置いてなぞってください");
};
$("#calibNo").onclick = () => { $("#calibBox").hidden = true; calibPts = []; setTool("select"); };
$("#calibLen").onkeydown = e => { if (e.key === "Enter") $("#calibOk").click(); };

let toastT = 0;
function toast(s) { const t = $("#toast"); t.textContent = s; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 4200); }

// ===== 左右パネルの幅(境目をドラッグ、ダブルクリックで元に戻す) =====
function initSplit() {
  const M = $("#main"), get = k => { try { return +localStorage.getItem(k) || 0; } catch (e) { return 0; } };
  let lw = get("ps.lw") || 210, rw = get("ps.rw") || 300;
  const apply = () => { M.style.setProperty("--lw", lw + "px"); M.style.setProperty("--rw", rw + "px"); };
  const keep = () => { try { localStorage.setItem("ps.lw", lw); localStorage.setItem("ps.rw", rw); } catch (e) { /* noop */ } };
  apply();
  for (const [id, side] of [["#splitL", "l"], ["#splitR", "r"]]) {
    const el = $(id);
    el.addEventListener("pointerdown", e => {
      e.preventDefault(); el.classList.add("on");
      const sx = e.clientX, l0 = lw, r0 = rw;
      const mv = ev => { if (side === "l") lw = Math.min(480, Math.max(140, l0 + ev.clientX - sx)); else rw = Math.min(560, Math.max(220, r0 - (ev.clientX - sx))); apply(); renderAll(); };
      const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); el.classList.remove("on"); keep(); };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    });
    el.addEventListener("dblclick", () => { if (side === "l") lw = 210; else rw = 300; apply(); keep(); renderAll(); });
  }
}

// ===== 起動 =====
window.addEventListener("resize", () => renderAll());
async function boot() {
  renderPalette(); initSplit();
  $("#legend").innerHTML = legendHTML();
  let d = null, local = null, shared = false;
  const m = location.hash.match(/#d=([\w-]+)/);
  if (m) { try { d = await unpackDoc(m[1]); shared = true; history.replaceState(null, "", location.pathname + location.search); } catch (e) { d = null; toast("共有URLを読み込めませんでした(URLが途中で切れていないか確認してください)"); } }
  try { local = JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { local = null; }
  if (!d) d = local;
  if (!d) d = TEMPLATES.find(t => t.id === "line").build();
  setDoc(d); fit();
  // 共有URLで開くと自動保存が上書きされるので、このブラウザで描いていた図を「元に戻す」で戻せるようにする
  if (shared && local && local.objs && local.objs.length && JSON.stringify(normalize(local).objs) !== JSON.stringify(doc.objs)) {
    undoS = [JSON.stringify(normalize(local))];
    toast("共有URLの図を開きました。このブラウザで前に描いていた図は「元に戻す」で戻せます");
  }
  window.PSGuide.init();
}
// レポート・書き出し(report.js)から使う描画関数
window.PSUI = { staticSVG, bgSVG, agentSVG, agentColor, moverSVG, fmt, esc, flowName: f => flowName(f),
  // 使い方ガイド(onboarding.js)から使う: 図のデータは変えずに、選択・タブ・表示範囲だけを動かす
  get doc() { return doc; }, selectedId: () => (sel && sel.k === "obj" ? sel.id : null),
  select(id) { sel = id ? { k: "obj", id } : null; inspector(); renderAll(); }, switchTab, fit };
// テスト用フック
window.__ps = { get doc() { return doc; }, get day() { return lastDay; }, setDoc, addObj, addFlow, get sim() { return sim; }, results: () => lastRes, checks, TEMPLATES, fit,
  // 指定ワールド座標(mm)を中心に倍率 s(px/mm)で表示 / シミュレーションを sec 秒進めて描画
  look(x, y, s) { const r = cv.getBoundingClientRect(); view.s = s; view.tx = r.width / 2 - x * s; view.ty = r.height / 2 - y * s; renderAll(); },
  advance(sec) { if (!sim) sim = newSim(); for (let t = 0; t < sec; t += 0.1) sim.step(0.1); renderAll(); return sim.t; } };
window.addEventListener("load", boot);
window.addEventListener("hashchange", async () => {
  const m = location.hash.match(/#d=([\w-]+)/); if (!m) return;
  let d = null; try { d = await unpackDoc(m[1]); } catch (e) { d = null; }
  history.replaceState(null, "", location.pathname + location.search);
  if (!d) { toast("共有URLを読み込めませんでした(URLが途中で切れていないか確認してください)"); return; }
  if (doc.objs.length) snapshot(); const u = undoS.slice(); setDoc(d); undoS = u; fit();
  toast("共有URLの図を開きました(元に戻す で前の図に戻せます)");
});
})();
