/* core.js — 工程シミュレーター(2D)のデータモデル・経路探索・導線シミュレーション(DOM非依存)
 * 座標: mm、原点=エリア左上、x右・y下。オブジェクトの x,y は中心。 */
"use strict";
(function (G) {

// ===== 色: 工程分析の基本機能で分ける(派手にしない) =====
// 加工=変える / 検査=確かめる / 停滞=置く・ためる / 運搬=運ぶ(台車・コンテナ・LexxMoMa) / 人 / モノ / 出入口(境界)
const FN = {
  make:   { t: "加工(変える)",       c: "#0068B7" },
  check:  { t: "検査(確かめる)",     c: "#5a6b7d" },
  stock:  { t: "停滞(置く・ためる)", c: "#8c9299" },
  move:   { t: "運搬(運ぶ)",         c: "#2f9e62" },
  person: { t: "人",                 c: "#e07b1f" },
  goods:  { t: "モノ(部品)",         c: "#e3a52c" },
  io:     { t: "出入口",             c: "#6e7c8a" },
};
// ===== 1日の条件 =====
// hours=1日の稼働時間 / breakMin=人の休憩(分/日。この間、人が付く作業は止まり、ロボット・自動設備は動く)
// demand=必要数(個/日, 0=未設定) / robotAvail=LexxMoMa の稼働率[%](充電などで止まる分を除く)
function dayOf(d) {
  const x = Object.assign({ hours: 8, breakMin: 60, demand: 0, robotAvail: 95 }, (d && d.day) || d || {});
  // 空欄・文字は既定値、数値は範囲に収める(0 を既定値に置き換えない)
  const num = (v, def) => (v === "" || v == null || !Number.isFinite(+v) ? def : +v);
  x.hours = Math.max(0.5, Math.min(24, num(x.hours, 8))); x.breakMin = Math.max(0, Math.min(x.hours * 60, num(x.breakMin, 0)));
  x.demand = Math.max(0, Math.round(num(x.demand, 0))); x.robotAvail = Math.max(10, Math.min(100, num(x.robotAvail, 100)));
  return x;
}
// ===== 部品カタログ =====
// g: パレットのグループ / obstacle: 人が通れない / sim: シミュレーション上の役割
const CAT = {
  in:       { g: "io",    label: "搬入口",       sub: "材料が入る",   w: 1200, h: 800,  color: FN.io.c, fn: "io", obstacle: true },
  out:      { g: "io",    label: "搬出口",       sub: "完成品が出る", w: 1200, h: 800,  color: FN.io.c, fn: "io", obstacle: true },
  process:  { g: "eq",    label: "加工",         sub: "A → B",        w: 1500, h: 1200, color: FN.make.c, fn: "make", obstacle: true },
  join:     { g: "eq",    label: "溶接・接着・組立", sub: "A + B → C",  w: 2000, h: 1500, color: FN.make.c, fn: "make", obstacle: true },
  inspect:  { g: "eq",    label: "検査",         sub: "A = A",        w: 1200, h: 1000, color: FN.check.c, fn: "check", obstacle: true },
  bench:    { g: "eq",    label: "手作業台",     sub: "人が作業",     w: 1500, h: 750,  color: FN.make.c, fn: "make", obstacle: true, hidden: true },
  buffer:   { g: "eq",    label: "仮置き・棚",   sub: "ためる",       w: 1200, h: 600,  color: FN.stock.c, fn: "stock", obstacle: true },
  part:     { g: "io",    label: "部品置き場",   sub: "部品の山",     w: 800,  h: 600,  color: FN.stock.c, fn: "stock", obstacle: true },
  container:{ g: "agent",  label: "TPポリ箱",     sub: "部品を入れて運ぶ",     w: 600,  h: 400,  color: FN.move.c, fn: "move", obstacle: false, movable: true },
  cart:     { g: "agent",  label: "台車",         sub: "押して運ぶ",   w: 900,  h: 600,  color: FN.move.c, fn: "move", obstacle: false, movable: true },
  worker:   { g: "agent", label: "作業者",       sub: "歩いて運ぶ",   w: 500,  h: 500,  color: FN.person.c, fn: "person", obstacle: false, agent: true },
  robot:    { g: "agent", label: "LexxMoMa",     sub: "自律搬送+アーム", w: 750, h: 600, color: FN.move.c, fn: "move", obstacle: false, agent: true },
  wall:     { g: "area",  label: "壁・柱・既存設備", sub: "通れない",  w: 3000, h: 200,  color: "#5b6470", obstacle: true },
  walk:     { g: "area",  label: "通路(歩く所)", sub: "多角形で囲む", w: 0, h: 0,     color: "#3EB370", obstacle: false, poly: true },
  nogo:     { g: "area",  label: "立入禁止",     sub: "多角形で囲む", w: 0, h: 0,     color: "#d9534f", obstacle: false, poly: true },
  zone:     { g: "area",  label: "色分けエリア", sub: "目印だけ",       w: 3000, h: 2000, color: "#9ec9e8", obstacle: false, hidden: true },
  note:     { g: "area",  label: "メモ",         sub: "文字",         w: 2400, h: 500,  color: "#444",    obstacle: false },
};
// パレットは4つだけ: モノの出入り / 工程 / 運ぶ / 場所(手作業台・色分けエリアは加工・メモで代わりになるので出さない)
const GROUPS = [
  { id: "io",    t: "モノの出入り" },
  { id: "eq",    t: "工程" },
  { id: "agent", t: "運ぶ(人・ロボット・入れ物)" },
  { id: "area",  t: "場所" },
];
// 種類ごとの初期プロパティ(ここが「仮値」の基準。ユーザーが触った項目は obj.edited に記録)
const DEFAULTS = {
  in:       { item: "A", interval: 0, pack: "resin", boxed: false }, // interval 0 = いつでも在庫あり / pack=部品の種類
  out:      {},
  process:  { autoT: 60, manT: 0, outName: "", outQty: 1 },
  join:     { autoT: 90, manT: 0, outName: "", outQty: 1 },
  inspect:  { autoT: 0, manT: 30, ngRate: 0 },
  bench:    { autoT: 0, manT: 60, outName: "", outQty: 1 },
  buffer:   { cap: 20 },
  part:     { item: "A", count: 0, pack: "resin", boxed: false }, // count 0 = 無制限 / boxed=TPポリ箱に入れて置いてある
  container:{ cap: 10 },
  cart:     { cap: 4 },
  worker:   { speed: 1.0, handle: 3 },
  robot:    { speed: 1.0, handle: 20 },
  wall:     {},
  walk:     {},
  nogo:     {},
  zone:     { text: "" },
  note:     { text: "メモ" },
};
const PROP_LABEL = {
  autoT: "自動運転の時間 [秒/回]", manT: "人の作業時間 [秒/回]", outQty: "1回で出来る数 [個]",
  ct: "サイクルタイム [秒]", outName: "出てくるモノの名前", needOp: "作業者が付いている間だけ動く",
  ngRate: "NG率 [%]", cap: "容量 [個]", item: "モノの名前", interval: "到着間隔 [秒] (0=常にある)",
  count: "個数 (0=無制限)", boxed: "TPポリ箱に入れて置いてある", speed: "歩行速度 [m/s]", handle: "積み降ろし時間 [秒/回]", text: "文字",
};
const STATION_TYPES = ["in", "out", "process", "join", "inspect", "bench", "buffer", "part"];
const isStation = t => STATION_TYPES.includes(t);
const isAgent = t => !!(CAT[t] && CAT[t].agent);
const isMovable = t => !!(CAT[t] && CAT[t].movable);
const isPoly = t => !!(CAT[t] && CAT[t].poly);
const TIMED = ["process", "join", "inspect", "bench"];
const isTimed = t => TIMED.includes(t);

// 旧形式(ct + needOp)を「自動運転 / 人の作業」に置き換え、needOp は人の作業時間から決める
function migrateObj(o) {
  if (isTimed(o.type) && o.autoT == null && o.manT == null) {
    const ct = o.ct != null ? +o.ct : (DEFAULTS[o.type].autoT + DEFAULTS[o.type].manT);
    if (o.needOp) { o.manT = ct; o.autoT = 0; } else { o.autoT = ct; o.manT = 0; }
    if ((o.edited || []).includes("ct")) o.edited.push("autoT", "manT");
    delete o.ct;
  }
  if (o.rotary != null) { o.parallel = !!o.rotary; delete o.rotary; }
  // 旧データ: 「TPポリ箱(部品入り)」の荷姿 → 部品は樹脂部品、置き方は「ポリ箱に入れて置く」
  if (o.pack === "tpbox") { o.pack = "resin"; if (o.type === "in" || o.type === "part") o.boxed = true; }
  if (o.outPack === "tpbox") o.outPack = "";
  if (o.indexT != null) { o.swapT = +o.indexT || 0; delete o.indexT; }
  if (isTimed(o.type)) {
    o.autoT = Math.max(0, +o.autoT || 0); o.manT = Math.max(0, +o.manT || 0);
    o.needOp = o.manT > 0;
    if (o.outQty != null) o.outQty = Math.max(1, Math.round(+o.outQty || 1));
    o.inQty = o.inQty || {};
  }
  // 負の値・文字は計算を止める(到着間隔が負だと無限ループ)ので、入力・読み込みのたびに下限をそろえる
  if (o.interval != null) o.interval = Math.max(0, +o.interval || 0);
  if (o.swapT != null) o.swapT = Math.max(0, +o.swapT || 0);
  if (o.ngRate != null) o.ngRate = Math.max(0, Math.min(100, +o.ngRate || 0));
  if (o.cap != null && !(+o.cap >= 1)) o.cap = (DEFAULTS[o.type] || {}).cap || 1; // 0・負・空欄 → 既定の容量
  return o;
}
// parallel=並行作業: 自動運転中に、人が次のワークのセット・取り出しを同時に進められる(ワークを置く場所が2つある設備)。
// 両方終わったら、仕上がったワークと次のワークを入れ替える(swapT秒)
// 荷姿: 樹脂部品 / 金属部品 / TP規格のポリ箱(部品入り)。出すモノの荷姿は工程で変えられ、指定が無ければ前工程から引き継ぐ
// 運ぶモノ(部品)の種類。TPポリ箱は部品ではなく「入れ物」(container: 部品を入れて運ぶ道具)として別に扱う
const PACKS = { resin: "樹脂部品", metal: "金属部品" };
function packOf(doc, o, depth) {
  depth = depth || 0;
  if (!o || depth > 30) return "resin";
  if (o.type === "in" || o.type === "part") return PACKS[o.pack] ? o.pack : "resin";
  if (["process", "join", "bench"].includes(o.type) && PACKS[o.outPack]) return o.outPack;
  const f = doc.flows.find(x => x.to === o.id);
  return f ? packOf(doc, byId(doc, f.from), depth + 1) : "resin";
}
// モノの名前 → 荷姿(描画用)
function packMap(doc) {
  const m = {};
  for (const o of doc.objs) if (isStation(o.type)) { const n = outputName(doc, o); if (n && n !== "?" && !m[n]) m[n] = packOf(doc, o); }
  for (const o of doc.objs) if (o.type === "in" || o.type === "part") m[o.item] = packOf(doc, o);
  return m;
}
function cycleTime(o) {
  if (!isTimed(o.type)) return 0;
  const a = +o.autoT || 0, m = +o.manT || 0;
  return o.parallel ? Math.max(a, m) + (+o.swapT || 0) : a + m;
}
// 前工程から入れる数(join は矢印ごと、それ以外は合計で1回に入れる数)
function inQty(o, flowId) { const q = o.inQty || {}; return Math.max(1, Math.round(+(o.type === "join" ? q[flowId] : q._) || 1)); }
function outQty(o) { return Math.max(1, Math.round(+o.outQty || 1)); }

// 「工程の時間」: 一番時間のかかる設備と、1個が通る設備の時間の合計(最長ルート)
function timeSummary(doc) {
  const timed = doc.objs.filter(o => isTimed(o.type));
  let slow = null;
  for (const o of timed) { const t = cycleTime(o) / (o.type === "inspect" ? inQty(o) : outQty(o)); if (!slow || t > slow.t) slow = { o, t, ct: cycleTime(o) }; }
  const memo = {}, onPath = new Set();
  const longest = (o, depth) => {
    if (memo[o.id]) return memo[o.id];
    if (depth > 40) return { t: 0, route: [o] };
    onPath.add(o.id);
    let best = { t: 0, route: [] };
    for (const f of doc.flows.filter(f2 => f2.to === o.id)) {
      const a = byId(doc, f.from); if (!a || onPath.has(a.id)) continue; // 往復・手戻りの矢印は1回だけ数える
      const r = longest(a, depth + 1); if (r.t > best.t || !best.route.length) best = r;
    }
    onPath.delete(o.id);
    return (memo[o.id] = { t: best.t + cycleTime(o), route: [...best.route, o] });
  };
  let path = null;
  for (const o of doc.objs.filter(x => x.type === "out")) { const r = longest(o, 0); if (!path || r.t > path.t) path = r; }
  if (!path) for (const o of timed) { const r = longest(o, 0); if (!path || r.t > path.t) path = r; }
  const manTotal = timed.reduce((a, o) => a + (+o.manT || 0), 0);
  return { slow, path, manTotal };
}

// ===== 出し入れ面(ポート) =====
// in=モノを入れる面 / out=モノを取り出す面 / op=作業者が立って作業する面。面は N(上) E(右) S(下) W(左)
const SIDES = ["N", "E", "S", "W"];
const SIDE_LABEL = { N: "上", E: "右", S: "下", W: "左" };
const ROLE_LABEL = { in: "入れる面", out: "取り出す面", op: "作業する面", io: "出し入れ口" };
// 入れる面と取り出す面が同じ面で、その面が短い(小さい設備)ときは、1つの「出し入れ口」で入れて取り出す
const SHARE_LEN = 1500;
// portShared: true=まとめる(ドラッグで重ねた) / false=分ける / 未指定=小さい面なら自動でまとめる
function sharedPort(o) {
  ensurePorts(o);
  const r = portRoles(o);
  if (!r.includes("in") || !r.includes("out") || o.ports.in !== o.ports.out) return false;
  if (o.portShared === true) return true;
  if (o.portShared === false) return false;
  return face(o, o.ports.in).len <= SHARE_LEN;
}
function portRoles(o) {
  if (o.type === "in" || o.type === "part") return ["out"];
  if (o.type === "out") return ["in"];
  if (["process", "join", "inspect", "bench"].includes(o.type)) return o.needOp ? ["in", "out", "op"] : ["in", "out"];
  if (o.type === "buffer") return ["in", "out"];
  return [];
}
function ensurePorts(o) {
  if (!isStation(o.type)) return;
  o.ports = Object.assign({ in: "W", out: "E", op: "S" }, o.ports || {});
  o.portAuto = Object.assign({ in: true, out: true, op: true }, o.portAuto || {});
}
function face(o, side) {
  const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, y0 = o.y - o.h / 2, y1 = o.y + o.h / 2;
  if (side === "N") return { x: o.x, y: y0, nx: 0, ny: -1, len: o.w };
  if (side === "S") return { x: o.x, y: y1, nx: 0, ny: 1, len: o.w };
  if (side === "E") return { x: x1, y: o.y, nx: 1, ny: 0, len: o.h };
  return { x: x0, y: o.y, nx: -1, ny: 0, len: o.h };
}
// 役割の面上の位置(入れる面と取り出す面が同じ面なら左右に振り分ける)
// 口の位置: 面の中心からの距離 portOff[役割](mm、面に沿って。N=右が+ / E=下が+ / S=左が+ / W=上が+)
function portPoint(o, role) {
  ensurePorts(o);
  const side = o.ports[role], f = face(o, side), po = o.portOff || {};
  const shared = role !== "op" && sharedPort(o);
  const same = !shared && role !== "op" && portRoles(o).filter(r => r !== "op" && o.ports[r] === side).length === 2;
  let off;
  if (shared) off = po.in != null ? po.in : po.out != null ? po.out : 0;
  else if (po[role] != null) off = po[role];
  else off = same ? (role === "in" ? -1 : 1) * f.len / 4 : 0;
  const lim = Math.max(0, f.len / 2 - 150);
  off = Math.max(-lim, Math.min(lim, off));
  return { x: f.x - f.ny * off, y: f.y + f.nx * off, nx: f.nx, ny: f.ny, side, off, len: same ? f.len / 2 : shared ? Math.min(f.len, SHARE_LEN) : (po[role] != null ? Math.min(f.len, SHARE_LEN) : f.len), faceLen: f.len, shared };
}
function sideToward(o, p) {
  const dx = (p.x - o.x) / (o.w / 2 || 1), dy = (p.y - o.y) / (o.h / 2 || 1);
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "E" : "W") : (dy >= 0 ? "S" : "N");
}
// 「自動」の面は、つながる相手・付く作業者の方向へ向ける
function autoOrient(doc) {
  const avg = l => l.length ? { x: l.reduce((s, p) => s + p.x, 0) / l.length, y: l.reduce((s, p) => s + p.y, 0) / l.length } : null;
  for (const o of doc.objs) {
    if (!isStation(o.type)) continue;
    ensurePorts(o);
    const outs = doc.flows.filter(f => f.from === o.id).map(f => byId(doc, f.to)).filter(Boolean);
    const ins = doc.flows.filter(f => f.to === o.id).map(f => byId(doc, f.from)).filter(Boolean);
    if (o.portAuto.out) { const p = avg(outs); if (p) o.ports.out = sideToward(o, p); }
    if (o.portAuto.in) { const p = avg(ins); if (p) o.ports.in = sideToward(o, p); }
    if (o.portAuto.op && o.op) { const a = byId(doc, o.op); if (a) o.ports.op = sideToward(o, a); }
  }
}
function rotatePorts(o) { const n = { N: "E", E: "S", S: "W", W: "N" }; ensurePorts(o); for (const k in o.ports) o.ports[k] = n[o.ports[k]]; }

// ===== 多角形(歩行エリア・立入禁止) =====
function inPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function polyBBox(o) {
  const xs = o.pts.map(p => p.x), ys = o.pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  o.x = (x0 + x1) / 2; o.y = (y0 + y1) / 2; o.w = x1 - x0; o.h = y1 - y0;
  return o;
}
function polyArea(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y); return Math.abs(a / 2); }

let _seq = 1;
function uid(p) { return p + (_seq++).toString(36) + Math.random().toString(36).slice(2, 5); }

function newDoc() {
  return { v: 1, title: "", customer: "", author: "", area: { w: 20000, h: 12000 }, snap: 100, walkOnly: true, day: dayOf({}),
           bg: null, objs: [], flows: [], sim: { hours: 1 } };
}

function makeObj(type, x, y, extra) {
  const c = CAT[type];
  const o = Object.assign({ id: uid("o"), type, x, y, w: c.w, h: c.h, name: "", edited: [] },
                          JSON.parse(JSON.stringify(DEFAULTS[type] || {})), extra || {});
  if (isStation(type)) ensurePorts(o);
  migrateObj(o);
  if (c.agent && o.dir == null) o.dir = -90;        // 体の向き[度] 0=右 90=下 -90=上
  if (c.poly) { o.pts = (extra && extra.pts) || []; if (o.pts.length) polyBBox(o); }
  return o;
}

// 同じ種類の個数から「加工1」「作業者2」のような初期名
function autoName(doc, type) {
  const base = { robot: "LexxMoMa", walk: "通路", nogo: "立入禁止", zone: "エリア", container: "ポリ箱" }[type] || CAT[type].label.split("・")[0];
  const used = new Set(doc.objs.map(o => o.name));
  for (let i = 1; ; i++) { const n = base + i; if (!used.has(n)) return n; }
}
// 搬入口/部品置き場の次の品目名 A,B,C...
function nextItemName(doc) {
  const used = new Set(doc.objs.filter(o => o.type === "in" || o.type === "part").map(o => o.item));
  for (let i = 0; i < 26; i++) { const n = String.fromCharCode(65 + i); if (!used.has(n)) return n; }
  return "X";
}

function byId(doc, id) { return doc.objs.find(o => o.id === id); }
function rectOf(o) { return { x0: o.x - o.w / 2, y0: o.y - o.h / 2, x1: o.x + o.w / 2, y1: o.y + o.h / 2 }; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// ===== モノの名前の伝搬(フロー表示・レポート用) =====
function outputName(doc, o, depth) {
  depth = depth || 0;
  if (!o || depth > 30) return "?";
  if (o.type === "in" || o.type === "part") return o.item || "?";
  const ins = doc.flows.filter(f => f.to === o.id).map(f => outputName(doc, byId(doc, f.from), depth + 1));
  const uniq = [...new Set(ins)];
  if (o.type === "process" || o.type === "bench") return o.outName || (uniq.length ? uniq.join("/") + "'" : "?");
  if (o.type === "join") return o.outName || (uniq.length ? uniq.join("+") : "?");
  // 検査・仮置き・搬出口はそのまま通す(容器も)
  return uniq.length ? uniq.join("/") : "?";
}

// ===== 経路探索(グリッドA* + 見通しによる平滑化) =====
const CELL = 250;       // 探索グリッド [mm]
const CLEAR = 200;      // 障害物からの余裕(人の半身) [mm]
function buildGrid(doc) {
  const nx = Math.max(1, Math.ceil(doc.area.w / CELL)), ny = Math.max(1, Math.ceil(doc.area.h / CELL));
  const blocked = new Uint8Array(nx * ny);
  for (const o of doc.objs) {
    if (!CAT[o.type].obstacle) continue;
    const r = rectOf(o);
    const i0 = Math.max(0, Math.floor((r.x0 - CLEAR) / CELL)), i1 = Math.min(nx - 1, Math.floor((r.x1 + CLEAR) / CELL));
    const j0 = Math.max(0, Math.floor((r.y0 - CLEAR) / CELL)), j1 = Math.min(ny - 1, Math.floor((r.y1 + CLEAR) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = (i + .5) * CELL, cy = (j + .5) * CELL;
      if (cx > r.x0 - CLEAR && cx < r.x1 + CLEAR && cy > r.y0 - CLEAR && cy < r.y1 + CLEAR) blocked[j * nx + i] = 1;
    }
  }
  // 通路(歩行エリア)の中だけ歩ける(doc.walkOnly)。通路が1つも無いときはどこでも歩ける扱い。立入禁止の中は歩けない
  const walks = doc.walkOnly === false ? [] : doc.objs.filter(o => o.type === "walk" && o.pts && o.pts.length >= 3);
  const nogos = doc.objs.filter(o => o.type === "nogo" && o.pts && o.pts.length >= 3);
  if (walks.length || nogos.length) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = { x: (i + .5) * CELL, y: (j + .5) * CELL };
    if (walks.length && !walks.some(w => inPoly(c, w.pts))) blocked[j * nx + i] = 1;
    if (nogos.some(w => inPoly(c, w.pts))) blocked[j * nx + i] = 1;
  }
  if (doc.walkOnly !== false && !walks.length) blocked.fill(1);
  return { nx, ny, blocked, cache: new Map(), walkLimited: doc.walkOnly !== false };
}
function cellOf(g, p) {
  return [Math.min(g.nx - 1, Math.max(0, Math.floor(p.x / CELL))), Math.min(g.ny - 1, Math.max(0, Math.floor(p.y / CELL)))];
}
function cellCenter(i, j) { return { x: (i + .5) * CELL, y: (j + .5) * CELL }; }
function freeCell(g, i, j) { return i >= 0 && j >= 0 && i < g.nx && j < g.ny && !g.blocked[j * g.nx + i]; }
// p に最も近い通れるマス
function nearestFree(g, p) {
  const [ci, cj] = cellOf(g, p);
  if (freeCell(g, ci, cj)) return [ci, cj];
  let best = null, bd = Infinity;
  for (let r = 1; r < Math.max(g.nx, g.ny); r++) {
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (Math.abs(i - ci) !== r && Math.abs(j - cj) !== r) continue;
      if (!freeCell(g, i, j)) continue;
      const d = dist(cellCenter(i, j), p);
      if (d < bd) { bd = d; best = [i, j]; }
    }
    if (best) return best;
  }
  return [ci, cj];
}
// 作業者が立つ位置: 設備は「役割の面(入れる/取り出す/作業する)の正面 500mm」、置き物・入れ物は中心付近
const STAND = 500;
function accessPoint(doc, g, o, role) {
  if (!isStation(o.type) || !CAT[o.type].obstacle) return { x: o.x, y: o.y, face: null, off: 0 };
  const p = portPoint(o, role || "out");
  const want = { x: p.x + p.nx * STAND, y: p.y + p.ny * STAND };
  const [i, j] = cellOf(g, want);
  const ok = want.x >= 0 && want.y >= 0 && want.x < g.nx * CELL && want.y < g.ny * CELL && freeCell(g, i, j);
  return { ...want, face: Math.atan2(-p.ny, -p.nx), off: ok ? 0 : Infinity, side: p.side, ok };
}
function lineFree(g, a, b) {
  const L = dist(a, b), n = Math.ceil(L / (CELL / 3));
  for (let k = 0; k <= n; k++) {
    const t = n ? k / n : 0, [i, j] = cellOf(g, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (!freeCell(g, i, j)) return false;
  }
  return true;
}
function findPath(g, a, b) {
  const [si, sj] = cellOf(g, a), [gi, gj] = cellOf(g, b);
  const inside = p => p.x >= 0 && p.y >= 0 && p.x < g.nx * CELL && p.y < g.ny * CELL;
  if (!inside(a) || !inside(b) || a.ok === false || b.ok === false || !freeCell(g, si, sj) || !freeCell(g, gi, gj)) return { pts: [], len: 0, ok: false };
  const key = a.x + "," + a.y + ">" + b.x + "," + b.y;
  if (g.cache.has(key)) return g.cache.get(key);
  const N = g.nx * g.ny, s = sj * g.nx + si, goal = gj * g.nx + gi;
  const gs = new Float64Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = []; // [f, idx]
  const push = (f, v) => { heap.push([f, v]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  const h = v => { const i = v % g.nx, j = (v / g.nx) | 0; const dx = Math.abs(i - gi), dy = Math.abs(j - gj); return (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)); };
  gs[s] = 0; push(h(s), s);
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  let found = s === goal;
  while (heap.length && !found) {
    const [, v] = pop();
    if (closed[v]) continue; closed[v] = 1;
    if (v === goal) { found = true; break; }
    const i = v % g.nx, j = (v / g.nx) | 0;
    for (const [di, dj, c] of D) {
      const ni = i + di, nj = j + dj;
      if (!freeCell(g, ni, nj)) continue;
      if (di && dj && (!freeCell(g, i + di, j) || !freeCell(g, i, j + dj))) continue; // 角のすり抜け禁止
      const nv = nj * g.nx + ni, ng = gs[v] + c;
      if (ng < gs[nv]) { gs[nv] = ng; came[nv] = v; push(ng + h(nv), nv); }
    }
  }
  let pts;
  if (!found) pts = []; // 到達不能: 直線(警告はUI側)
  else {
    const cells = []; for (let v = goal; v !== -1; v = came[v]) { cells.push(cellCenter(v % g.nx, (v / g.nx) | 0)); if (v === s) break; }
    cells.reverse();
    const raw = [a, ...cells, b];
    // 見通しで間引き(紐を引っ張る)
    pts = [raw[0]];
    let k = 0;
    while (k < raw.length - 1) {
      let m = raw.length - 1;
      while (m > k + 1 && !lineFree(g, raw[k], raw[m])) m--;
      pts.push(raw[m]); k = m;
    }
  }
  const res = { pts, len: pts.reduce((s2, p, i) => i ? s2 + dist(pts[i - 1], p) : 0, 0), ok: found };
  g.cache.set(key, res);
  return res;
}

// ===== 導線シミュレーション =====
// 簡易離散イベント(固定刻み dt)。人/ロボット=エージェントが担当フローを「満杯になったら運ぶ」、
// 担当設備(needOp)は人が居る間だけサイクルを回す。
function Sim(doc, opt) {
  opt = opt || {};
  this.doc = doc; this.t = 0; this.t0 = 0; this.noPeople = !!opt.noPeople; this.day = dayOf(doc.day);
  this.g = buildGrid(doc);
  this.st = {}; // station state
  this.warn = [];
  let seed = 12345; this.rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; // 再現性のため固定乱数
  const self = this;
  for (const o of doc.objs) if (isStation(o.type)) {
    self.st[o.id] = { o, inq: {}, out: {}, outN: 0, busy: false, manLeft: 0, autoLeft: 0, cur: null, frontState: null, frontCur: null, backCur: null, backLeft: 0, indexLeft: 0, busyT: 0, manBusyT: 0, autoBusyT: 0, waitOpT: 0, starveT: 0, blockT: 0,
                      done: {}, doneN: 0, ng: 0, genT: 0, left: o.type === "part" ? (o.count > 0 ? o.count : Infinity) : Infinity, cycles: 0 };
  }
  // 入力キュー: join はフロー別スロット、それ以外は合算
  this.inCap = o => o.type === "buffer" ? (o.cap || 20) : o.type === "out" ? Infinity : 8;
  this.outCap = o => o.type === "buffer" ? (o.cap || 20) : (o.type === "in" || o.type === "part") ? 20 : 8;
  // 入れ物(台車・コンテナ)
  this.mv = {};
  // 入れ物。ポリ箱(container)は at/role で「どこに置かれているか」を持つ: src=取り出す側で部品が溜まっていく / dst=入れる側で部品が使われていく
  for (const o of doc.objs) if (isMovable(o.type)) this.mv[o.id] = { o, x: o.x, y: o.y, h: 0, load: 0, loadName: "", holder: null, at: null, role: null, flow: null };
  // エージェント
  this.ag = [];
  for (const o of doc.objs) if (isAgent(o.type)) {
    if (this.noPeople && o.type === "worker") continue; // 休憩中: 人はいない
    const flows = doc.flows.filter(f => f.agent === o.id);
    const ops = doc.objs.filter(s => isStation(s.type) && s.needOp && s.op === o.id);
    this.ag.push({ o, x: o.x, y: o.y, h: (o.dir == null ? -90 : +o.dir) * Math.PI / 180, act: "", pose: "", home: { x: o.x, y: o.y }, flows, ops, plan: [], cur: null,
                   carry: 0, carryName: "", holding: null, trail: [{ x: o.x, y: o.y }], distMm: 0,
                   tm: { walk: 0, carry: 0, work: 0, handle: 0, idle: 0, charge: 0 }, rr: 0, atStation: null });
  }
  this.fs = {};
  for (const f of doc.flows) this.fs[f.id] = { trips: 0, items: 0, distMm: 0 };
  // 自動搬送(コンベア/シュート)のフロー: 距離/0.2m/s で届く
  this.auto = []; // {flow, name, n, eta}
  // 事前チェック
  for (const f of doc.flows) {
    const a = byId(doc, f.from), b = byId(doc, f.to);
    if (!a || !b) continue;
    if (f.mode !== "auto" && !f.agent) this.warn.push(`「${a.name}→${b.name}」の運び手が決まっていません`);
    if (f.agent) {
      const pa = accessPoint(doc, this.g, a, "out"), pb = accessPoint(doc, this.g, b, "in");
      const p = findPath(this.g, pa, pb); if (!p.ok) this.warn.push(`「${a.name}→${b.name}」は通路がふさがっていて通れません`);
      if (pa.off > 600) this.warn.push(`「${a.name}」の取り出す面の前に立てません(通路の外か、設備が近すぎます)`);
      if (pb.off > 600) this.warn.push(`「${b.name}」の入れる面の前に立てません(通路の外か、設備が近すぎます)`);
    }
  }
  if (doc.walkOnly !== false && !doc.objs.some(o => o.type === "walk")) this.warn.push("通路が描かれていないため、人・ロボットの移動は停止します");
  this.warn = [...new Set(this.warn)];
  for (const o of doc.objs) if (isStation(o.type) && o.needOp && !o.op) this.warn.push(`「${o.name}」に付く作業者が決まっていません`);
}
Sim.prototype.stock = function (id) { const s = this.st[id]; return s ? s.outN : 0; };
Sim.prototype.takeOut = function (s, n) {
  // 出口在庫から n 個取り出し、名前を返す(一番多い品目から)
  let name = "", got = 0;
  const keys = Object.keys(s.out).sort((a, b) => s.out[b] - s.out[a]);
  for (const k of keys) { const m = Math.min(n - got, s.out[k]); if (m > 0) { s.out[k] -= m; got += m; name = name || k; } if (got >= n) break; }
  s.outN -= got;
  return { n: got, name };
};
Sim.prototype.inTotal = function (s) { let n = 0; for (const k in s.inq) n += s.inq[k]; return n; };
Sim.prototype.deliver = function (toId, flowId, name, n) {
  const s = this.st[toId]; if (!s) return;
  const o = s.o;
  if (o.type === "out") { s.done[name] = (s.done[name] || 0) + n; s.doneN += n; return; }
  if (o.type === "buffer") { s.out[name] = (s.out[name] || 0) + n; s.outN += n; return; }
  const key = o.type === "join" ? flowId : "_";
  s.inq[key] = (s.inq[key] || 0) + n;
  s.inName = s.inName || {}; s.inName[key] = name;
};
Sim.prototype.canAccept = function (toId, n, flowId) {
  const s = this.st[toId]; if (!s) return false;
  const o = s.o;
  if (o.type === "out") return true;
  if (o.type === "buffer") return s.outN + n <= this.inCap(o);
  if (o.type === "join") return (s.inq[flowId] || 0) + n <= Math.max(4, n * 2, inQty(o, flowId) * 2); // 入力ごとに枠を分けて片側だけ溜まる詰まりを防ぐ
  return this.inTotal(s) + n <= Math.max(this.inCap(o), n * 2, inQty(o) * 2);
};
// 設備が1サイクル始められるか
// ポリ箱(通い箱)の扱い
const isBox = m => m && m.o.type === "container";
Sim.prototype.boxCap = m => Math.max(1, Math.round(+m.o.cap || 1));
Sim.prototype.moversOf = function (f) {
  return [...new Set([f.mover, ...(f.movers || [])])].filter(Boolean).map(id => this.mv[id]).filter(Boolean);
};
Sim.prototype.boxesAt = function (stId, role, flowId) {
  const r = [];
  for (const id in this.mv) { const m = this.mv[id]; if (isBox(m) && !m.holder && m.at === stId && m.role === role && (!flowId || m.flow === flowId)) r.push(m); }
  return r;
};
// 入れる側で使える数 = 設備の前に溜まった数 + 設備の前に置かれたポリ箱の中身(join は矢印ごと)
Sim.prototype.inAvail = function (s, flowId) {
  let n = flowId ? (s.inq[flowId] || 0) : this.inTotal(s);
  for (const m of this.boxesAt(s.o.id, "dst")) if (!flowId || m.flow === flowId) n += m.load;
  return n;
};
// q 個を取り出す(先に設備の前の分、足りなければ置かれたポリ箱から)。取り出したモノの名前を返す
Sim.prototype.take = function (s, flowId, q) {
  let name = null;
  const keys = flowId ? [flowId] : Object.keys(s.inq);
  for (const k of keys) { const m = Math.min(q, s.inq[k] || 0); if (m > 0) { s.inq[k] -= m; q -= m; name = name || (s.inName || {})[k]; } if (!q) return name; }
  for (const b of this.boxesAt(s.o.id, "dst")) {
    if (flowId && b.flow !== flowId) continue;
    const m = Math.min(q, b.load); if (m > 0) { b.load -= m; q -= m; name = name || b.loadName; }
    if (!q) break;
  }
  return name;
};
Sim.prototype.ready = function (s) {
  const o = s.o;
  if (s.outN + (isTimed(o.type) ? outQty(o) : 1) > Math.max(this.outCap(o), outQty(o))) return false;
  if (o.type === "join") {
    const ins = this.doc.flows.filter(f => f.to === o.id);
    return ins.length > 0 && ins.every(f => this.inAvail(s, f.id) >= inQty(o, f.id));
  }
  return this.inAvail(s) >= inQty(o);
};
// 投入: 前工程から決まった数ずつ取り、出来るモノの名前を返す
Sim.prototype.consume = function (s) {
  const o = s.o; let inName;
  if (o.type === "join") { for (const f of this.doc.flows.filter(f2 => f2.to === o.id)) this.take(s, f.id, inQty(o, f.id)); }
  else inName = this.take(s, null, inQty(o));
  let nm = o.type === "inspect" ? inName : outputName(this.doc, o);
  if (o.type === "process" || o.type === "bench") nm = o.outName || (inName ? inName + "'" : nm);
  return nm;
};
// 並行作業: 人の場所=次のワークのセット(取り出しを含む) / 機械の場所=自動運転。両方終わったら入れ替え、仕上がったワークが払い出される
Sim.prototype.stepParallel = function (s, dt) {
  const o = s.o, man = +o.manT || 0, auto = +o.autoT || 0, idx = +o.swapT || 0;
  let active = false;
  if (s.backLeft > 0) { const u = Math.min(dt, s.backLeft); s.backLeft -= u; s.autoBusyT += u; active = true; }
  if (s.frontState === "set") {
    if (man <= 0 || this.opPresent(o)) { const u = Math.min(dt, s.manLeft); s.manLeft -= u; s.manBusyT += u; active = true; }
    else s.waitOpT += dt;
    if (s.manLeft <= 1e-9) { s.manLeft = 0; s.frontState = "ready"; }
  } else if (!s.frontState && !(s.indexLeft > 0)) {
    if (this.ready(s) && (man <= 0 || this.opPresent(o))) { s.frontCur = this.consume(s); s.frontState = "set"; s.manLeft = man; if (man <= 0) s.frontState = "ready"; }
    else if (!this.ready(s)) { if (!(s.backLeft > 0)) { if (s.outN >= this.outCap(o)) s.blockT += dt; else s.starveT += dt; } }
    else s.waitOpT += dt;
  }
  if (s.frontState === "ready" && s.backLeft <= 1e-9 && !(s.indexLeft > 0)) s.indexLeft = Math.max(0.05, idx);
  if (s.indexLeft > 0) {
    s.indexLeft -= dt; active = true;
    if (s.indexLeft <= 1e-9) {
      s.indexLeft = 0;
      if (s.backCur) { const n = outQty(o); for (let k = 0; k < n; k++) { s.out[s.backCur] = (s.out[s.backCur] || 0) + 1; s.outN++; } s.cycles++; }
      s.backCur = s.frontCur; s.backLeft = auto; s.frontCur = null; s.frontState = null;
    }
  }
  // 奥で自動運転が終わったモノは、次のセットが無くても人が手前へ回して取り出す扱い(最後の1個が残らないように)
  if (s.backCur && s.backLeft <= 1e-9 && !s.frontState && !(s.indexLeft > 0) && !this.ready(s)) {
    const n = outQty(o); for (let k = 0; k < n; k++) { s.out[s.backCur] = (s.out[s.backCur] || 0) + 1; s.outN++; } s.cycles++; s.backCur = null;
  }
  if (active) s.busyT += dt;
  s.busy = s.backLeft > 0 || s.frontState === "set" || s.indexLeft > 0;
  s.autoLeft = s.backLeft; s.cur = s.backCur || s.frontCur;
};
Sim.prototype.needsOpNow = function (s) {
  if (s.o.parallel) return s.frontState === "set" ? s.manLeft > 0 : (!s.frontState && !(s.indexLeft > 0) && this.ready(s) && (+s.o.manT || 0) > 0);
  return s.busy ? s.manLeft > 0 : this.ready(s) && (+s.o.manT || 0) > 0;
};
Sim.prototype.opPresent = function (o) {
  const a = this.ag.find(a2 => a2.o.id === o.op);
  return !!(a && !this.workerPaused(a) && a.atStation === o.id);
};
Sim.prototype.fillBoxes = function () {
  for (const id in this.mv) {
    const m = this.mv[id];
    if (!isBox(m) || m.holder || m.role !== "src") continue;
    const s = this.st[m.at]; if (!s) continue;
    const room = this.boxCap(m) - m.load; if (room <= 0 || s.outN <= 0) continue;
    const got = this.takeOut(s, Math.min(room, s.outN));
    if (got.n) { m.load += got.n; m.loadName = m.loadName || got.name; }
  }
};
Sim.prototype.stepStations = function (dt) {
  this.fillBoxes();
  for (const id in this.st) {
    const s = this.st[id], o = s.o;
    if (o.type === "in") {
      if (!(o.interval > 0)) { const need = this.outCap(o) - s.outN; if (need > 0) { s.out[o.item] = (s.out[o.item] || 0) + need; s.outN += need; } }
      else { s.genT += dt; while (s.genT >= o.interval) { s.genT -= o.interval; if (s.outN < this.outCap(o)) { s.out[o.item] = (s.out[o.item] || 0) + 1; s.outN++; } } }
      continue;
    }
    if (o.type === "part") {
      const need = Math.min(this.outCap(o) - s.outN, s.left);
      if (need > 0) { s.out[o.item] = (s.out[o.item] || 0) + need; s.outN += need; s.left -= need; }
      continue;
    }
    if (o.type === "out" || o.type === "buffer") continue;
    if (o.parallel) { this.stepParallel(s, dt); continue; }
    // 1サイクル = 人の作業(manT, 作業者が面の前にいる間だけ進む) → 自動運転(autoT, 人は離れてよい)
    if (s.busy) {
      if (s.manLeft > 0) {
        if (this.opPresent(o)) { const u = Math.min(dt, s.manLeft); s.manLeft -= u; s.busyT += u; s.manBusyT += u; }
        else s.waitOpT += dt;
      } else { const u = Math.min(dt, s.autoLeft); s.autoLeft -= u; s.busyT += u; s.autoBusyT += u; }
      if (s.manLeft <= 1e-9 && s.autoLeft <= 1e-9) {
        s.busy = false; s.cycles++;
        const nm = s.cur, n = o.type === "inspect" ? inQty(o) : outQty(o); // 検査はモノを変えずに、入れた数だけ通す
        for (let k = 0; k < n; k++) {
          if (o.type === "inspect" && o.ngRate > 0 && this.rnd() * 100 < o.ngRate) s.ng++;
          else { s.out[nm] = (s.out[nm] || 0) + 1; s.outN++; }
        }
        s.cur = null;
      }
      continue;
    }
    const man = +o.manT || 0, auto = +o.autoT || 0;
    if (this.ready(s) && (man <= 0 || this.opPresent(o))) {
      // 投入(前工程から決まった数ずつ。設備の前のポリ箱からも取る)
      s.cur = this.consume(s);
      s.busy = true; s.manLeft = man; s.autoLeft = auto; if (man + auto <= 0) s.autoLeft = 0.1;
    } else if (!this.ready(s)) {
      if (s.outN >= this.outCap(o)) s.blockT += dt; else s.starveT += dt;
    } else s.waitOpT += dt; // 始められるのに作業者がいない
  }
  // 自動搬送
  for (let i = this.auto.length - 1; i >= 0; i--) {
    const a = this.auto[i]; a.eta -= dt;
    if (a.eta <= 0) { this.deliver(a.flow.to, a.flow.id, a.name, a.n); this.auto.splice(i, 1); }
  }
  for (const f of this.doc.flows) if (f.mode === "auto") {
    const s = this.st[f.from]; if (!s || s.outN < 1 || !this.canAccept(f.to, 1, f.id)) continue;
    if (this.auto.filter(a => a.flow === f).length >= 4) continue;
    const got = this.takeOut(s, 1);
    const a = byId(this.doc, f.from), b = byId(this.doc, f.to);
    this.auto.push({ flow: f, name: got.name, n: got.n, eta: dist(a, b) / 200, x0: a.x, y0: a.y, x1: b.x, y1: b.y, T: dist(a, b) / 200 });
    this.fs[f.id].trips++; this.fs[f.id].items += got.n; this.fs[f.id].distMm += dist(a, b);
  }
};
// エージェントの次の仕事を決める
const CHARGE_CYCLE = 1800;
Sim.prototype.plan = function (a) {
  const doc = this.doc, g = this.g;
  a.atStation = null;
  if (a.o.type === "robot" && this.day.robotAvail < 100) {
    const pause = (1 - this.day.robotAvail / 100) * CHARGE_CYCLE, ph = this.t % CHARGE_CYCLE;
    if (ph < pause) { a.plan = [{ k: "go", to: a.home }, { k: "charge", t: pause - ph }]; return; }
  }
  // 1) 担当設備の作業(始められる/作業中)
  for (const o of a.ops) {
    const s = this.st[o.id];
    if (s && this.needsOpNow(s)) {
      const p = accessPoint(doc, g, o, "op");
      a.plan = [{ k: "go", to: p }, { k: "face", ang: p.face }, { k: "man", st: o.id }];
      return;
    }
  }
  // 2) 担当フローの運搬(元に満杯分あり、先に空きあり)
  const cands = [];
  for (const f of a.flows) {
    if (f.mode === "auto") continue;
    const src = this.st[f.from]; if (!src) continue;
    const boxes = this.moversOf(f).filter(isBox);
    if (boxes.length) { this.boxTasks(a, f, boxes, cands); continue; }
    const mv = f.mover ? this.mv[f.mover] : null;
    if (mv && mv.holder && mv.holder !== a) continue;
    const cap = mv ? (+mv.o.cap || 1) : Math.max(1, +f.batch || 1);
    const need = (src.o.type === "in" || src.o.type === "part" || src.o.type === "buffer") ? cap : Math.min(cap, this.outCap(src.o), isTimed(src.o.type) ? Math.max(cap, 1) : cap);
    if (src.outN < need && !(src.o.type === "part" && src.left === 0 && src.outN > 0)) continue;
    if (!this.canAccept(f.to, cap, f.id)) continue;
    // 優先度: 詰まっている設備の払い出し > 材料切れの設備への供給 > たまり具合。無限の搬入口は低め(後工程優先=引き取り)
    const dst = this.st[f.to];
    const srcFull = !["in", "part", "buffer"].includes(src.o.type) && src.outN >= this.outCap(src.o);
    const dstEmpty = dst && !["out", "buffer"].includes(dst.o.type) &&
      (dst.o.type === "join" ? !(this.inAvail(dst, f.id) >= inQty(dst.o, f.id)) : this.inAvail(dst) < inQty(dst.o) && !dst.busy);
    const score = (srcFull ? 5 : 0) + (dstEmpty ? 3 : 0) + Math.min(1, src.outN / cap) - ((src.o.type === "in" || src.o.type === "part") ? 1 : 0);
    cands.push({ f, cap, score });
  }
  if (cands.length) {
    cands.sort((x, y) => y.score - x.score);
    // 同点なら順番に回す
    const top = cands.filter(c => c.score === cands[0].score);
    const c = top[a.rr++ % top.length];
    const from = byId(doc, c.f.from), to = byId(doc, c.f.to);
    const plan = [];
    a.flowNow = c.f.id; // 空荷の往路も含めてこのフローの歩行距離として数える
    if (c.box) { // ポリ箱: 箱を取りに行く → 運ぶ → 置く
      const m = c.box; m.holder = a;
      const p = c.kind === "deliver" ? accessPoint(doc, g, to, "in") : accessPoint(doc, g, from, "out");
      a.plan = [{ k: "go", to: { x: m.x, y: m.y } }, { k: "grab", mv: m }, { k: "go", to: p, loaded: true }, { k: "face", ang: p.face },
                { k: "place", f: c.f, at: c.kind === "deliver" ? c.f.to : c.f.from, role: c.kind === "deliver" ? "dst" : "src" }, { k: "release" }];
      return;
    }
    if (c.f.mover) {
      const mv = this.mv[c.f.mover];
      mv.holder = a;
      plan.push({ k: "go", to: { x: mv.x, y: mv.y } }, { k: "grab", mv: mv });
    }
    const pa = accessPoint(doc, g, from, "out"), pb = accessPoint(doc, g, to, "in");
    plan.push({ k: "go", to: pa }, { k: "face", ang: pa.face }, { k: "load", f: c.f, n: c.cap },
              { k: "go", to: pb, loaded: true }, { k: "face", ang: pb.face }, { k: "unload", f: c.f });
    if (c.f.mover) plan.push({ k: "release" });
    a.plan = plan;
    return;
  }
  // 3) 何もなければ持ち場へ戻って待つ
  if (dist(a, a.home) > CELL) a.plan = [{ k: "go", to: a.home }, { k: "idle", t: 2 }];
  else a.plan = [{ k: "idle", t: 1 }];
};
// ポリ箱の流れの仕事の候補
Sim.prototype.boxTasks = function (a, f, boxes, cands) {
  const src = this.st[f.from], dst = this.st[f.to]; if (!src || !dst) return;
  const free = boxes.filter(m => !m.holder || m.holder === a);
  const srcDone = src.o.type === "part" && src.left === 0 && src.outN === 0; // 部品置き場が空になった
  // (1) 取り出す側で満杯になった箱を、入れる側へ届ける(入れる側の箱が1箱以下のとき)
  const full = free.find(m => m.at === f.from && m.role === "src" && (m.load >= this.boxCap(m) || (srcDone && m.load > 0)));
  const atDst = boxes.filter(m => m.at === f.to && m.role === "dst" && m.load > 0).length;
  if (full && atDst < 2 && !(dst.o.type === "buffer" && dst.outN + full.load > this.inCap(dst.o))) {
    const need = dst.o.type === "join" ? inQty(dst.o, f.id) : inQty(dst.o);
    const starving = !["out", "buffer"].includes(dst.o.type) && this.inAvail(dst, dst.o.type === "join" ? f.id : null) < need;
    cands.push({ f, box: full, kind: "deliver", score: (starving ? 6 : 3) + (src.outN >= this.outCap(src.o) ? 2 : 0) });
  }
  // (2) 空になった箱(または最初に置いた箱)を、取り出す側へ戻す(取り出す側に箱が無いとき)
  const srcHas = boxes.some(m => (m.at === f.from && m.role === "src") || (m.holder && m.holder !== a));
  const empty = free.find(m => m.load === 0 && !(m.at === f.from && m.role === "src"));
  if (empty && !srcHas) cands.push({ f, box: empty, kind: "return", score: 2.5 });
};
// 体の向き: 目標方向との差が大きいときはその場で向きを変えてから歩く(人 240°/s、台車を押すと 90°/s、LexxMoMa 180°/s)
const TURN_BIG = 0.6; // [rad] ≒35° これ以上ずれていたら立ち止まって向きを変える
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
Sim.prototype.turnRate = function (a) {
  if (a.o.type === "robot") return Math.PI;
  return a.holding && a.holding.o.type === "cart" ? Math.PI / 2 : Math.PI * 4 / 3;
};
// 向きを want へ最大 t 秒ぶん回す。使った時間を返す
Sim.prototype.turn = function (a, want, t) {
  const err = angDiff(want, a.h), tr = this.turnRate(a), need = Math.abs(err) / tr;
  if (need <= t) { a.h = want; return need; }
  a.h += Math.sign(err) * tr * t; return t;
};
// 持っている台車/コンテナの位置: 歩行中は体の前(台車は押す・コンテナは抱える)、設備の前では台車を横に置く
Sim.prototype.placeHeld = function (a, parked) {
  const m = a.holding; if (!m) return;
  const R = a.o.w / 2, cs = Math.cos(a.h), sn = Math.sin(a.h);
  if (m.o.type === "container") { const k = R + m.o.h / 2 - 60; m.x = a.x + cs * k; m.y = a.y + sn * k; m.h = a.h + Math.PI / 2; return; }
  if (parked) { const k = R + m.o.h / 2 + 80; m.x = a.x - sn * k; m.y = a.y + cs * k; m.h = a.h; return; }
  const k = R + m.o.w / 2 + 40; m.x = a.x + cs * k; m.y = a.y + sn * k; m.h = a.h;
};
Sim.prototype.workerPaused = function (a) {
  return a.o.type === "worker" && !!this.breakWindow && this.t >= this.breakWindow.start && this.t < this.breakWindow.end;
};
Sim.prototype.stepAgents = function (dt) {
  for (const a of this.ag) {
    if (this.workerPaused(a)) { a.tm.idle += dt; a.act = "休憩"; continue; }
    let budget = dt;
    let guard = 0;
    while (budget > 1e-9 && guard++ < 30) {
      if (!a.cur) { if (!a.plan.length) this.plan(a); a.cur = a.plan.shift(); if (!a.cur) break; a.cur.t0 = null; }
      const c = a.cur, speed = Math.max(0.1, +a.o.speed || 1) * 1000 * (a.holding && a.holding.o.type === "cart" ? 0.85 : 1);
      const kind = (a.carry > 0 || a.holding) ? "carry" : "walk";
      a.pose = "";
      if (c.k === "go") {
        a.act = kind === "carry" ? "運搬" : "移動";
        if (!c.path) {
          const route = findPath(this.g, { x: a.x, y: a.y }, c.to);
          if (!route.ok) {
            a.act = "通行不可"; a.tm.idle += budget; budget = 0;
            const warning = `${a.o.name}: 通れる経路がないため作業を停止しています。通路と立ち位置を確認してください`;
            if (!this.warn.includes(warning)) this.warn.push(warning);
            break;
          }
          c.path = route.pts.slice(1);
        }
        while (budget > 1e-9 && c.path.length) {
          const p = c.path[0], d = dist(a, p);
          if (d < 1) { c.path.shift(); continue; }
          const want = Math.atan2(p.y - a.y, p.x - a.x);
          if (Math.abs(angDiff(want, a.h)) > TURN_BIG) { // 立ち止まって向きを変える
            const u = this.turn(a, want, budget); budget -= u; a.tm[kind] += u; a.act = "向きを変える"; a.turnT = (a.turnT || 0) + u; this.placeHeld(a); continue;
          }
          const mv = Math.min(d, speed * budget), u = mv / speed;
          this.turn(a, want, u); // 歩きながら少しずつ向きを合わせる
          a.x += (p.x - a.x) / d * mv; a.y += (p.y - a.y) / d * mv;
          a.distMm += mv; a.tm[kind] += u; budget -= u; if (a.flowNow) this.fs[a.flowNow].distMm += mv;
          if (mv >= d - 1e-6) { a.x = p.x; a.y = p.y; c.path.shift(); a.trail.push({ x: a.x, y: a.y, c: kind }); }
          this.placeHeld(a);
        }
        if (!c.path.length) a.cur = null;
      } else if (c.k === "face") { // 設備の面に正対する
        a.act = "向きを変える";
        if (c.ang == null) { a.cur = null; continue; }
        const u = this.turn(a, c.ang, budget); budget -= u; a.tm[kind] += u; a.turnT = (a.turnT || 0) + u;
        this.placeHeld(a, true);
        if (Math.abs(angDiff(c.ang, a.h)) < 1e-3) a.cur = null;
      } else if (c.k === "man") {
        const s = this.st[c.st];
        a.atStation = c.st; a.act = "作業"; a.pose = "reach";
        if (this.needsOpNow(s)) { a.tm.work += budget; budget = 0; }
        else { a.atStation = null; a.cur = null; } // 人の作業が終われば(自動運転中は)離れて次の仕事へ
      } else if (c.k === "grab") {
        a.holding = c.mv; c.mv.at = null; c.mv.role = null; this.placeHeld(a); a.cur = null;
      } else if (c.k === "place") { // ポリ箱を置く(積み降ろし時間)。入れる側では設備が箱から部品を使う
        a.act = c.role === "dst" ? "箱を置く" : "空き箱を置く"; a.pose = "reach";
        if (c.t0 === null) c.t0 = Math.max(0, +a.o.handle || 0);
        const use = Math.min(budget, c.t0); c.t0 -= use; budget -= use; a.tm.handle += use;
        if (c.t0 <= 1e-9) {
          const m = a.holding;
          if (m) {
            m.at = c.at; m.role = c.role; m.flow = c.f.id;
            if (c.role === "dst") {
              this.fs[c.f.id].trips++; this.fs[c.f.id].items += m.load;
              const s = this.st[c.at]; // 搬出口・仮置きは箱の中身をそのまま受け取る
              if (s && (s.o.type === "out" || s.o.type === "buffer") && m.load) { this.deliver(c.at, c.f.id, m.loadName, m.load); m.load = 0; }
              if (!m.load) m.loadName = "";
            } else { m.loadName = ""; }
          }
          a.flowNow = null; a.cur = null;
        }
      } else if (c.k === "release") {
        if (a.holding) { this.placeHeld(a, true); a.holding.holder = null; a.holding = null; } a.cur = null;
      } else if (c.k === "charge") { // 充電(待機)
        a.act = "充電";
        if (c.t0 === null) c.t0 = c.t;
        const use = Math.min(budget, c.t0); c.t0 -= use; budget -= use; a.tm.charge += use;
        if (c.t0 <= 1e-9) a.cur = null;
      } else if (c.k === "load" || c.k === "unload" || c.k === "idle") {
        a.act = { load: "取り出し", unload: "投入", idle: "待ち" }[c.k]; if (c.k !== "idle") a.pose = "reach";
        if (c.t0 === null) c.t0 = c.k === "idle" ? c.t : Math.max(0, +a.o.handle || 0);
        const use = Math.min(budget, c.t0); c.t0 -= use; budget -= use;
        a.tm[c.k === "idle" ? "idle" : "handle"] += use;
        if (c.t0 <= 1e-9) {
          if (c.k === "load") {
            const got = this.takeOut(this.st[c.f.from], c.n);
            a.carry = got.n; a.carryName = got.name;
            if (a.holding) { a.holding.load = got.n; a.holding.loadName = got.name; }
            if (!got.n) { a.plan = a.plan.filter(x => x.k === "release"); a.flowNow = null; }
          } else if (c.k === "unload") {
            if (a.carry) { this.deliver(c.f.to, c.f.id, a.carryName, a.carry); this.fs[c.f.id].trips++; this.fs[c.f.id].items += a.carry; }
            a.carry = 0; a.carryName = ""; a.flowNow = null;
            if (a.holding) { a.holding.load = 0; a.holding.loadName = ""; }
          }
          a.cur = null;
        }
      } else a.cur = null;
    }
    if (a.trail.length > 4000) a.trail.splice(0, a.trail.length - 4000);
  }
};
Sim.prototype.wip = function () {
  let n = 0;
  for (const id in this.st) { const s = this.st[id]; if (["in", "part", "out"].includes(s.o.type)) continue; n += this.inTotal(s) + s.outN + (s.o.parallel ? (s.frontCur ? 1 : 0) + (s.backCur ? 1 : 0) : (s.busy ? 1 : 0)); }
  for (const a of this.ag) n += a.carry;
  for (const id in this.mv) if (isBox(this.mv[id])) n += this.mv[id].load;
  for (const a of this.auto) n += a.n;
  return n;
};
Sim.prototype.step = function (dt) { this.stepStations(dt); this.stepAgents(dt); this.wipInt = (this.wipInt || 0) + this.wip() * dt; this.t += dt; };
// 立ち上がり(空の状態から流れ始めるまで)を統計から外す
Sim.prototype.resetStats = function () {
  for (const id in this.st) {
    const s = this.st[id];
    s.busyT = s.manBusyT = s.autoBusyT = s.waitOpT = s.starveT = s.blockT = 0; s.cycles = 0; s.ng = 0;
    if (s.o.type === "out") { s.done = {}; s.doneN = 0; }
  }
  for (const a of this.ag) { for (const k in a.tm) a.tm[k] = 0; a.distMm = 0; a.turnT = 0; a.trail = [{ x: a.x, y: a.y }]; }
  for (const id in this.fs) this.fs[id] = { trips: 0, items: 0, distMm: 0 };
  this.wipInt = 0; this.t0 = this.t;
};
Sim.prototype.run = function (sec, dt, warm) {
  dt = dt || 0.2;
  if (warm) { const w = Math.ceil(warm / dt); for (let i = 0; i < w; i++) this.step(dt); this.resetStats(); }
  const n = Math.ceil(sec / dt); for (let i = 0; i < n; i++) this.step(dt); return this.results();
};

Sim.prototype.results = function () {
  const T = Math.max(1e-9, this.t - (this.t0 || 0)), doc = this.doc;
  const outs = Object.values(this.st).filter(s => s.o.type === "out");
  const doneN = outs.reduce((n, s) => n + s.doneN, 0);
  const agents = this.ag.map(a => {
    const tot = Object.values(a.tm).reduce((x, y) => x + y, 0) || 1;
    return { id: a.o.id, name: a.o.name, type: a.o.type, distM: a.distMm / 1000, perHourM: a.distMm / 1000 / T * 3600, turnPerH: (a.turnT || 0) / T * 3600,
             ratio: { walk: a.tm.walk / tot, carry: a.tm.carry / tot, work: a.tm.work / tot, handle: a.tm.handle / tot, idle: a.tm.idle / tot, charge: (a.tm.charge || 0) / tot } };
  });
  const stations = Object.values(this.st).filter(s => !["in", "out", "part", "buffer"].includes(s.o.type)).map(s => ({
    id: s.o.id, name: s.o.name, type: s.o.type, util: s.busyT / T, manUtil: s.manBusyT / T, autoUtil: s.autoBusyT / T, waitOp: s.waitOpT / T,
    starve: s.starveT / T, block: s.blockT / T, cycles: s.cycles, ng: s.ng, wip: this.inTotal(s) + s.outN, ct: cycleTime(s.o), outQty: isTimed(s.o.type) ? outQty(s.o) : 1 }));
  const flows = doc.flows.map(f => {
    const a = byId(doc, f.from), b = byId(doc, f.to), fs = this.fs[f.id] || { trips: 0, items: 0, distMm: 0 };
    const g = this.g, pth = (a && b) ? findPath(g, accessPoint(doc, g, a, "out"), accessPoint(doc, g, b, "in")) : { len: 0 };
    return { id: f.id, from: a ? a.name : "?", to: b ? b.name : "?", item: a ? outputName(doc, a) : "?",
             agent: f.mode === "auto" ? "自動搬送" : (byId(doc, f.agent) || {}).name || "未定", mode: f.mode,
             mover: f.mover ? (byId(doc, f.mover) || {}).name : "", oneWayM: pth.len / 1000,
             trips: fs.trips, items: fs.items, tripsPerH: fs.trips / T * 3600, distPerHM: fs.distMm / 1000 / T * 3600 };
  });
  let bottleneck = null;
  for (const s of stations) if (!bottleneck || s.util > bottleneck.util) bottleneck = { name: s.name, util: s.util, kind: "設備" };
  for (const a of agents) { const busy = 1 - a.ratio.idle - a.ratio.charge; if (!bottleneck || busy > bottleneck.util) bottleneck = { name: a.name, util: busy, kind: a.type === "robot" ? "ロボット" : "作業者" }; }
  // 材料の入ってくる速さで頭打ちなら、それが全体の速さを決めている(汎用ツールの「Source が律速」)
  const srcs = doc.objs.filter(o => o.type === "in"), finite = srcs.filter(o => +o.interval > 0);
  if (finite.length && finite.length === srcs.length) { // 数の限りない部品置き場(補充される部材)は律速にしない
    const supply = finite.reduce((t, o) => t + 3600 / +o.interval, 0), perH = doneN / T * 3600;
    if (perH >= supply * 0.95) bottleneck = { name: finite.map(o => o.name).join("・"), util: 1, kind: "材料が入ってくる速さ", supply: true };
  }
  const avgWip = (this.wipInt || 0) / T;
  return { simSec: T, done: doneN, perHour: doneN / T * 3600, pitch: doneN ? T / doneN : null, leadTime: doneN ? avgWip / (doneN / T) : null, avgWip,
           agents, stations, flows, bottleneck, warn: this.warn.slice(), time: timeSummary(doc) };
};

// ===== 1日分の計算 =====
// 人がいる時間(稼働時間-休憩)と、人の休憩中(ロボット・自動設備だけが動く)をそれぞれ1時間ずつ測り、1日に換算する
function simulateDay(doc) {
  const day = dayOf(doc.day);
  const sim = new Sim(JSON.parse(JSON.stringify({ ...doc, bg: null, baseline: null })));
  const hasPeople = doc.objs.some(o => o.type === "worker");
  const dayS = day.hours * 3600, breakS = hasPeople ? day.breakMin * 60 : 0, workS = dayS - breakS;
  const start = workS / 2, end = start + breakS;
  sim.breakWindow = { start, end };
  // One continuous run; split steps exactly at break boundaries and shift end.
  while (sim.t < dayS - 1e-8) {
    let dt = Math.min(0.2, dayS - sim.t);
    for (const boundary of [start, end]) if (boundary > sim.t + 1e-8) dt = Math.min(dt, boundary - sim.t);
    sim.step(dt);
  }
  const main = sim.results(), workers = main.agents.filter(a => a.type === "worker"), robots = main.agents.filter(a => a.type === "robot");
  const peopleH = workers.reduce((n, a) => n + (a.ratio.work + a.ratio.walk + a.ratio.carry + a.ratio.handle) * day.hours, 0);
  const walkKm = workers.reduce((n, a) => n + a.distM / 1000, 0);
  const robotH = robots.reduce((n, a) => n + (a.ratio.work + a.ratio.walk + a.ratio.carry + a.ratio.handle) * day.hours, 0);
  const perDay = main.done, takt = day.demand ? workS / day.demand : null; // タクト = 休憩を除いた稼働時間 ÷ 必要数
  return { sim, main, brk: null, day, perDay, workS, breakS, dayS, takt, peopleH, walkKm, robotH,
    breakStart: start, breakEnd: end, nWorkers: workers.length, nRobots: robots.length,
    met: day.demand ? perDay >= day.demand : null, short: day.demand ? Math.max(0, day.demand - perDay) : 0 };
}
// 比較用の要約(現状として残す値)
function dayMetrics(r) {
  return { perDay: r.perDay, pitch: r.main.pitch, peopleH: r.peopleH, walkKm: r.walkKm, robotH: r.robotH, nWorkers: r.nWorkers, nRobots: r.nRobots,
           leadTime: r.main.leadTime, demand: r.day.demand, bottleneck: r.main.bottleneck ? r.main.bottleneck.name : "" };
}

G.PS = { FN, CAT, dayOf, simulateDay, dayMetrics, GROUPS, DEFAULTS, PROP_LABEL, isStation, isAgent, isMovable, newDoc, makeObj, autoName, nextItemName,
         byId, rectOf, dist, outputName, buildGrid, findPath, accessPoint, Sim, uid, CELL,
         isPoly, SIDES, SIDE_LABEL, ROLE_LABEL, portRoles, sharedPort, SHARE_LEN, ensurePorts, portPoint, face, sideToward, autoOrient, rotatePorts,
         inPoly, polyBBox, polyArea, STAND, angDiff, PACKS, packOf, packMap, isTimed, migrateObj, cycleTime, inQty, outQty, timeSummary };
if (typeof module !== "undefined") module.exports = G.PS;
})(typeof window !== "undefined" ? window : globalThis);
