/* report.js — 書き出し: PNG画像 / CSV / 検討シート(印刷用HTML) */
"use strict";
(function () {
const { CAT, isStation, isAgent, isMovable, byId, outputName } = PS;
const U = () => window.PSUI;
const esc = s => U().esc(s), fmt = (n, d) => U().fmt(n, d);
const ROLE = { process: "加工 A→B", join: "接合 A+B→C", inspect: "検査 A=A", bench: "手作業 A→B", buffer: "仮置き", in: "搬入口", out: "搬出口", part: "部品置き場", cart: "台車", container: "コンテナ", worker: "作業者", robot: "LexxMoMa", wall: "壁・既存設備", walk: "歩行エリア", nogo: "立入禁止", zone: "エリア", note: "メモ" };
const HOW = f => f.mode === "auto" ? "自動搬送" : f.mode === "mover" ? "台車/コンテナ" : "手運び";
function flowName(d, f) { const a = byId(d, f.from), b = byId(d, f.to); return `${a ? a.name : "?"} → ${b ? b.name : "?"}`; }
function today() { const d = new Date(); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; }

// 導線(軌跡)の SVG
function trailsSVG(sim, S) {
  if (!sim) return "";
  return sim.ag.map(a => `<polyline points="${a.trail.map(p => `${p.x},${p.y}`).join(" ")} ${a.x},${a.y}" fill="none" stroke="${U().agentColor(sim.doc, a.o.id)}" stroke-opacity=".4" stroke-width="${2.2 / S}" stroke-linejoin="round"/>`).join("");
}
// 単体SVG(書き出し用)。S=px/mm、m=余白px
function layoutSVG(d, S, sim, opt) {
  opt = opt || {};
  const m = 46, W = d.area.w * S + m * 2, H = d.area.h * S + m * 2 + (opt.band || 0);
  const inner = U().bgSVG(d) + U().staticSVG(d, S, { clean: true }) + trailsSVG(sim, S);
  let band = "";
  if (opt.band) {
    const y = d.area.h * S + m * 2 + 10;
    const bar = 5000 * S; // 5m
    band = `<g font-family="sans-serif"><text x="${m}" y="${y + 18}" font-size="16" font-weight="700" fill="#1d2733">${esc(d.title || "工程スケッチ")}${d.customer ? `  /  ${esc(d.customer)}` : ""}</text>
      <text x="${m}" y="${y + 40}" font-size="12" fill="#5d6b7a">エリア ${fmt(d.area.w)} × ${fmt(d.area.h)} mm ・ 縮尺 ${fmt(S * 1000)} px/m ・ ${today()} ・ LexxPluss 工程スケッチ</text>
      <rect x="${W - m - bar}" y="${y + 10}" width="${bar}" height="6" fill="#1d2733"/><rect x="${W - m - bar / 2}" y="${y + 10}" width="${bar / 2}" height="6" fill="#fff" stroke="#1d2733"/>
      <text x="${W - m - bar}" y="${y + 32}" font-size="11" fill="#1d2733">0</text><text x="${W - m}" y="${y + 32}" font-size="11" text-anchor="end" fill="#1d2733">5 m</text></g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Noto Sans JP, Hiragino Sans, Yu Gothic UI, Meiryo, sans-serif">
    <rect width="100%" height="100%" fill="#fff"/><g transform="translate(${m} ${m}) scale(${S})">${inner}</g>${band}</svg>`;
}

async function png(d, sim) {
  let S = 0.1; // 100 px/m(2Dシミュレーターの背景縮尺と合わせる)
  const big = Math.max(d.area.w, d.area.h) * S;
  if (big > 8000) S = 8000 / Math.max(d.area.w, d.area.h);
  const svg = layoutSVG(d, S, sim, { band: 56 });
  const img = new Image();
  await new Promise((ok, ng) => { img.onload = ok; img.onerror = ng; img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  c.getContext("2d").drawImage(img, 0, 0);
  return await new Promise(r => c.toBlob(r, "image/png"));
}

// ===== 表データ =====
function tables(d, res) {
  const eq = d.objs.filter(o => o.type !== "note").map((o, i) => ({
    no: i + 1, name: o.name || CAT[o.type].label, role: ROLE[o.type], w: Math.round(o.w), h: Math.round(o.h),
    x: Math.round(o.x - o.w / 2), y: Math.round(o.y - o.h / 2),
    ct: PS.isTimed(o.type) ? PS.cycleTime(o) : "", parallel: !!o.parallel, autoT: PS.isTimed(o.type) ? (+o.autoT || 0) : "", manT: PS.isTimed(o.type) ? (+o.manT || 0) : "",
    ctTmp: PS.isTimed(o.type) && !(o.edited || []).some(k => k === "autoT" || k === "manT"),
    io: PS.isTimed(o.type) ? d.flows.filter(f => f.to === o.id).map(f => outputName(d, byId(d, f.from)) + (o.type === "join" && PS.inQty(o, f.id) > 1 ? "×" + PS.inQty(o, f.id) : "")).join(" + ") + " → " + outputName(d, o) + (o.type !== "inspect" && PS.outQty(o) > 1 ? "×" + PS.outQty(o) : "") : "",
    item: isStation(o.type) ? outputName(d, o) + (outputName(d, o) !== "?" ? `(${PS.PACKS[PS.packOf(d, o)]}${o.boxed ? "・TPポリ箱入り" : ""})` : "") : "",
    ports: !isStation(o.type) ? "" : PS.sharedPort(o)
      ? ["入出(同じ口):" + PS.SIDE_LABEL[o.ports.in], ...(PS.portRoles(o).includes("op") ? ["作業:" + PS.SIDE_LABEL[o.ports.op]] : [])].join(" ")
      : PS.portRoles(o).map(r => ({ in: "入", out: "出", op: "作業" }[r] + ":" + PS.SIDE_LABEL[o.ports[r]])).join(" "),
    op: o.needOp ? ((byId(d, o.op) || {}).name || "未定") : "",
    extra: o.type === "inspect" ? `NG率 ${o.ngRate}%` : o.type === "buffer" || isMovable(o.type) ? `${o.type === "container" ? "TPポリ箱・" : ""}容量 ${o.cap}個` : o.type === "in" ? (o.interval ? `1個/${o.interval}秒` : "常に在庫あり") : o.type === "part" ? (o.count ? `${o.count}個` : "無制限") : o.parallel ? `並行作業(人と自動を同時・入替${+o.swapT || 0}秒)・1回${PS.cycleTime(o)}秒` + (o.portW ? `・開口${o.portW}mm` : "") : o.portW ? `開口${o.portW}mm` : isAgent(o.type) ? `${o.speed}m/s・積降${o.handle}秒` : PS.isPoly(o.type) ? `面積 ${fmt(PS.polyArea(o.pts) / 1e6, 1)} m²・頂点${o.pts.length}` : "",
  }));
  const rf = res ? Object.fromEntries(res.flows.map(f => [f.id, f])) : {};
  const fl = d.flows.map((f, i) => {
    const r = rf[f.id] || {};
    return { no: i + 1, from: (byId(d, f.from) || {}).name, to: (byId(d, f.to) || {}).name, item: outputName(d, byId(d, f.from)),
             agent: f.mode === "auto" ? "自動" : (byId(d, f.agent) || {}).name || "未定", how: HOW(f) + (f.mover ? `(${(byId(d, f.mover) || {}).name})` : ""),
             lot: f.mode === "mover" ? ((byId(d, f.mover) || {}).cap || "") : f.mode === "auto" ? 1 : (f.batch || 1),
             oneWay: r.oneWayM, tph: r.tripsPerH, dph: r.distPerHM };
  });
  return { eq, fl };
}
function csv(d, res) {
  const t = tables(d, res), rows = [];
  const q = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  rows.push(["工程スケッチ", d.title || "", d.customer || "", today()]);
  rows.push(["エリア幅mm", d.area.w, "エリア奥行mm", d.area.h]);
  rows.push([]);
  rows.push(["[設備・配置]"]);
  rows.push(["No", "名前", "種類", "幅mm", "奥行mm", "左端Xmm", "上端Ymm", "入れる→出す", "自動運転秒", "人の作業秒", "1回の秒", "時間は仮値", "出てくるモノ", "出し入れ面", "付く作業者", "備考"]);
  for (const e of t.eq) rows.push([e.no, e.name, e.role, e.w, e.h, e.x, e.y, e.io, e.autoT, e.manT, e.ct, e.ctTmp ? "仮" : "", e.item, e.ports, e.op, e.extra]);
  const polys = d.objs.filter(o => PS.isPoly(o.type));
  if (polys.length) {
    rows.push([]); rows.push(["[歩行エリア・立入禁止の頂点]"]); rows.push(["名前", "種類", "頂点 x,y (mm) ..."]);
    for (const o of polys) rows.push([o.name, ROLE[o.type], ...o.pts.map(q => `${Math.round(q.x)} ${Math.round(q.y)}`)]);
  }
  rows.push([]);
  rows.push(["[モノの流れ]"]);
  rows.push(["No", "元", "先", "モノ", "運び手", "運び方", "1回の個数", "片道m", "回/時", "歩行m/時"]);
  for (const f of t.fl) rows.push([f.no, f.from, f.to, f.item, f.agent, f.how, f.lot, f.oneWay != null ? f.oneWay.toFixed(1) : "", f.tph != null ? f.tph.toFixed(1) : "", f.dph != null ? Math.round(f.dph) : ""]);
  if (res) {
    rows.push([]);
    rows.push(["[導線シミュレーション結果]", `${Math.round(res.simSec / 60)}分`, "完成個/時", res.perHour.toFixed(1)]);
    rows.push(["名前", "種類", "歩行m/時", "作業%", "運搬歩行%", "手ぶら歩行%", "積み降ろし%", "待ち%"]);
    for (const a of res.agents) rows.push([a.name, a.type === "robot" ? "LexxMoMa" : "作業者", Math.round(a.perHourM), ...["work", "carry", "walk", "handle", "idle"].map(k => Math.round(a.ratio[k] * 100))]);
    rows.push(["設備", "稼働%", "待ち%", "詰まり%", "サイクル数", "NG"]);
    for (const s of res.stations) rows.push([s.name, Math.round(s.util * 100), Math.round(s.starve * 100), Math.round(s.block * 100), s.cycles, s.ng]);
  }
  return new Blob(["﻿" + rows.map(r => r.map(q).join(",")).join("\r\n")], { type: "text/csv" });
}

// ===== 検討シート =====
function report(d, res, warns, sim, day) {
  const t = tables(d, res);
  const S = Math.min(1000 / d.area.w, 640 / d.area.h);
  const svg = layoutSVG(d, S, sim, {});
  const cands = res ? res.flows.filter(f => f.mode !== "auto" && f.distPerHM > 0).sort((a, b) => b.distPerHM - a.distPerHM).slice(0, 3) : [];
  const walkers = res ? res.agents.filter(a => a.type === "worker") : [];
  const totalWalk = walkers.reduce((s, a) => s + a.perHourM, 0);
  const segs = [["work", "作業", "#e07b1f"], ["carry", "運搬歩行", "#2f9e62"], ["walk", "手ぶら歩行", "#9fd3b4"], ["handle", "積み降ろし", "#f3b77a"], ["charge", "充電", "#b9c3cc"], ["idle", "待ち", "#dde2e7"]];
  const q = [...warns];
  if (!res) q.push("導線シミュレーション未実施(「1日分を計算」を押すと歩行距離・稼働率が入ります)");
  q.push("各設備の自動運転の時間・人の作業時間・段取り替えの有無", "ワークの寸法・重さ・荷姿(何個を何に入れて運ぶか)", "通路の床(段差・スロープ・扉)と人・フォークリフトの往来", "生産数の目標(個/日・シフト)");
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(d.title || "工程スケッチ")} 検討シート</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: "Noto Sans JP","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif; color:#1d2733; margin:0; background:#f3f6f9; font-size:12px; }
  .page { background:#fff; max-width:1100px; margin:16px auto; padding:22px 28px; box-shadow:0 2px 10px rgba(0,0,0,.08); }
  h1 { font-size:20px; margin:0; color:#0068B7; } h2 { font-size:14px; margin:18px 0 6px; border-left:4px solid #0068B7; padding-left:8px; }
  .meta { color:#5d6b7a; margin:4px 0 12px; } .fig { text-align:center; border:1px solid #d9e1ea; border-radius:6px; padding:6px; } .fig svg { max-width:100%; height:auto; }
  table { width:100%; border-collapse:collapse; font-size:11.5px; } th,td { border:1px solid #d9e1ea; padding:4px 6px; text-align:left; } th { background:#eef4fa; font-weight:600; }
  td.n { text-align:right; font-variant-numeric:tabular-nums; } .tmp { background:#fff3c4; color:#8a6d00; border-radius:3px; padding:0 4px; font-size:10px; }
  .kpis { display:flex; gap:10px; } .kpis div { flex:1; background:#eef4fa; border-radius:8px; padding:8px 12px; } .kpis b { font-size:20px; color:#0068B7; display:block; }
  .bar { display:flex; height:12px; width:220px; border-radius:3px; overflow:hidden; background:#eee; } .bar i { height:100%; display:block; }
  .legend span { margin-right:10px; font-size:10.5px; } .legend i { display:inline-block; width:9px; height:9px; margin-right:3px; border-radius:2px; }
  .cand { border:1px solid #cfe0f0; background:#f5f9fd; border-radius:6px; padding:6px 10px; margin:4px 0; }
  ul { margin:4px 0; padding-left:18px; line-height:1.7; } .memo { border:1px dashed #b9c7d5; min-height:70px; border-radius:6px; padding:6px; color:#99a; }
  .tool { position:sticky; top:0; background:#1d2733; color:#fff; padding:8px 16px; display:flex; gap:10px; align-items:center; }
  .tool button { background:#0068B7; color:#fff; border:0; border-radius:5px; padding:6px 12px; cursor:pointer; font:inherit; }
  .brk { page-break-before: always; }
  @media print { body { background:#fff; } .page { box-shadow:none; margin:0; max-width:none; padding:0; } .tool { display:none; } }
</style></head><body>
<div class="tool"><b>検討シート</b><span style="opacity:.8">印刷またはPDF保存して、次回の打合せ・見積り検討にお使いください</span><span style="flex:1"></span><button onclick="print()">印刷 / PDF保存</button></div>
<div class="page">
  <h1>${esc(d.title || "工程スケッチ")} — 工程レイアウト検討シート</h1>
  <div class="meta">${d.customer ? `お客さま: <b>${esc(d.customer)}</b> ・ ` : ""}作成日 ${today()}${d.author ? ` ・ 作成 ${esc(d.author)}` : ""} ・ エリア ${fmt(d.area.w / 1000, 1)} × ${fmt(d.area.h / 1000, 1)} m</div>
  <div class="fig">${svg}</div>
  <div class="legend" style="margin-top:6px">色は機能で分けています: ${["make", "check", "stock", "move", "person", "goods"].map(k => `<span><i style="background:${PS.FN[k].c}"></i>${PS.FN[k].t}</span>`).join("")}<br>矢印=モノの流れ(橙=人が運ぶ、緑=LexxMoMa、灰破線=自動搬送、赤点線=運び手未定)・設備の縁の「入」=入れる面/「出」=取り出す面/「入出」=同じ口で出し入れ/足あと=作業する面・緑の破線=通路/赤斜線=立入禁止${sim ? "・細線=人の導線(スパゲッティ図)" : ""}・寸法は mm</div>
  ${day ? (() => {
    const m = PS.dayMetrics(day), bl = d.baseline, dd = day.day, v = (x, g) => x == null ? "-" : fmt(x, g);
    let h = `<p>始業から終業まで連続計算。人の休憩は勤務時間の中央にまとめて配置し、在庫・途中作業を保持します。</p><h2>1日の結果(稼働 ${fmt(dd.hours, 1)}時間・人の休憩 ${fmt(dd.breakMin)}分・LexxMoMa 稼働率 ${fmt(dd.robotAvail)}%)</h2><div class="kpis">
      <div>1日にできる数<b>${fmt(day.perDay)} 個</b><small style="color:#5d6b7a">${dd.demand ? (day.met ? `必要数 ${fmt(dd.demand)}個に届く` : `必要数 ${fmt(dd.demand)}個に ${fmt(Math.ceil(day.short))}個 不足`) : "必要数は未設定"}</small></div>
      <div>完成の間隔<b>${v(day.main.pitch, 1)} 秒/個</b><small style="color:#5d6b7a">${day.takt ? `タクト ${fmt(day.takt, 1)}秒` : ""}</small></div>
      <div>人の作業時間<b>${fmt(day.peopleH, 1)} 時間/日</b><small style="color:#5d6b7a">作業者 ${day.nWorkers}人・歩行 ${fmt(day.walkKm, 1)}km/日</small></div>
      <div>LexxMoMa の稼働<b>${day.nRobots ? fmt(day.robotH, 1) + " 時間/日" : "未導入"}</b></div></div>`;
    if (bl) {
      const row = (t, k, g, u) => `<tr><td>${t}</td><td class="n">${v(bl.m[k], g)}${u}</td><td class="n"><b>${v(m[k], g)}${u}</b></td><td class="n">${m[k] != null && bl.m[k] != null ? ((m[k] - bl.m[k] > 0 ? "+" : "") + fmt(m[k] - bl.m[k], g) + u) : "-"}</td></tr>`;
      h += `<h2>「${esc(bl.name)}」と改善案の比較</h2><table><tr><th></th><th>${esc(bl.name)}</th><th>改善案(このシートの図)</th><th>差</th></tr>
        ${row("1日にできる数", "perDay", 0, "個")}${row("人の作業時間", "peopleH", 1, "時間/日")}${row("人の歩く距離", "walkKm", 1, "km/日")}${row("作業者", "nWorkers", 0, "人")}${row("LexxMoMa", "nRobots", 0, "台")}${row("完成の間隔", "pitch", 1, "秒")}</table>`;
    }
    return h;
  })() : ""}
  ${(() => { const ts = PS.timeSummary(d); return `<h2>工程の時間</h2><div class="kpis">
    <div>一番長い設備<b style="font-size:15px">${ts.slow ? `${esc(ts.slow.o.name)} ${fmt(ts.slow.ct)}秒/回` : "-"}</b></div>
    <div>1個が通る設備の時間<b>${ts.path ? fmt(ts.path.t) + " 秒" : "-"}</b><small style="color:#5d6b7a">${ts.path ? ts.path.route.map(o => esc(o.name)).join(" → ") : ""}</small></div>
    ${res ? `<div>完成の間隔(実際)<b>${res.pitch ? fmt(res.pitch, 1) + " 秒/個" : "-"}</b></div><div>リードタイム(概算)<b>${res.leadTime ? (res.leadTime >= 120 ? fmt(res.leadTime / 60, 1) + " 分" : fmt(res.leadTime) + " 秒") : "-"}</b></div>` : ""}</div>`; })()}
  ${res ? `<h2>1. 導線シミュレーションの結果(${fmt(res.simSec / 60)}分)</h2>
  <div class="kpis"><div>完成<b>${fmt(res.perHour, 1)} 個/時</b></div><div>作業者の歩行合計<b>${fmt(totalWalk)} m/時</b></div><div>一番忙しい<b style="font-size:15px">${res.bottleneck ? `${esc(res.bottleneck.name)}(${fmt(res.bottleneck.util * 100)}%)` : "-"}</b></div></div>
  <table style="margin-top:8px"><tr><th>人・ロボット</th><th>歩行 m/時</th><th>向き替え 分/時</th><th>時間の使い方</th>${segs.map(s => `<th>${s[1]}</th>`).join("")}</tr>
  ${res.agents.map(a => `<tr><td>${esc(a.name)}</td><td class="n">${fmt(a.perHourM)}</td><td class="n">${fmt(a.turnPerH / 60, 1)}</td><td><div class="bar">${segs.map(([k, , c]) => `<i style="width:${(a.ratio[k] || 0) * 100}%;background:${c}"></i>`).join("")}</div></td>${segs.map(([k]) => `<td class="n">${fmt((a.ratio[k] || 0) * 100)}%</td>`).join("")}</tr>`).join("")}</table>
  ${res.stations.length ? `<table style="margin-top:6px"><tr><th>設備</th><th>1回 秒</th><th>自動</th><th>人</th><th>人待ち</th><th>待ち(材料が来ない)</th><th>詰まり(運ばれない)</th><th>NG</th></tr>${res.stations.map(s => `<tr><td>${esc(s.name)}</td><td class="n">${fmt(s.ct)}</td><td class="n">${fmt(s.autoUtil * 100)}%</td><td class="n">${fmt(s.manUtil * 100)}%</td><td class="n">${fmt(s.waitOp * 100)}%</td><td class="n">${fmt(s.starve * 100)}%</td><td class="n">${fmt(s.block * 100)}%</td><td class="n">${s.ng}</td></tr>`).join("")}</table>` : ""}
  <h2>2. 自動化(LexxMoMa)の検討候補</h2>
  ${cands.length ? cands.map((c, i) => `<div class="cand"><b>候補${i + 1}: ${esc(c.from)} → ${esc(c.to)}</b>(${esc(c.item)}) ・ 片道 ${fmt(c.oneWayM, 1)} m ・ ${fmt(c.tripsPerH, 1)} 回/時 ・ 歩行 ${fmt(c.distPerHM)} m/時 ・ いまの担当 ${esc(c.agent)}</div>`).join("") + `<p style="color:#5d6b7a">歩行距離が長く回数の多い運搬ほど、人が付加価値作業に戻れる効果が大きくなります。ピック・プレースを伴う場合はワーク形状とハンドの確認が必要です。</p>` : "<p>対象となる人の運搬がありません。</p>"}` : ""}
  <h2 class="brk">${res ? 3 : 1}. 設備・配置</h2>
  <table><tr><th>No</th><th>名前</th><th>種類</th><th>幅×奥行 mm</th><th>位置(左上) mm</th><th>入れる → 出す</th><th>自動 秒</th><th>人 秒</th><th>出し入れ面</th><th>付く人</th><th>備考</th></tr>
  ${t.eq.map(e => `<tr><td class="n">${e.no}</td><td>${esc(e.name)}</td><td>${esc(e.role)}</td><td class="n">${fmt(e.w)} × ${fmt(e.h)}</td><td class="n">${fmt(e.x)}, ${fmt(e.y)}</td><td>${esc(e.io)}</td><td class="n">${e.autoT}${e.ctTmp ? ' <span class="tmp">仮</span>' : ""}</td><td class="n">${e.manT}</td><td>${esc(e.ports)}</td><td>${esc(e.op)}</td><td>${esc(e.extra)}</td></tr>`).join("")}</table>
  <h2>${res ? 4 : 2}. モノの流れ(人の運搬)</h2>
  <table><tr><th>No</th><th>元 → 先</th><th>モノ</th><th>運び手</th><th>運び方</th><th>1回の個数</th><th>片道 m</th><th>回/時</th><th>歩行 m/時</th></tr>
  ${t.fl.map(f => `<tr><td class="n">${f.no}</td><td>${esc(f.from)} → ${esc(f.to)}</td><td>${esc(f.item)}</td><td>${esc(f.agent)}</td><td>${esc(f.how)}</td><td class="n">${f.lot}</td><td class="n">${f.oneWay != null ? fmt(f.oneWay, 1) : "-"}</td><td class="n">${f.tph != null ? fmt(f.tph, 1) : "-"}</td><td class="n">${f.dph != null ? fmt(f.dph) : "-"}</td></tr>`).join("")}</table>
  <h2>${res ? 5 : 3}. 次回までの確認事項</h2>
  <ul>${q.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
  <h2>メモ</h2><div class="memo" contenteditable="true">(打合せでの気づきをここに書けます)</div>
  <p style="color:#8a96a3;font-size:10.5px;margin-top:14px">本シートは簡易モデル(満杯分たまったら運ぶ・設備は1個ずつ処理・段取り替え/故障は含まない。休憩は1日の計算に含む)による概算です。図面データ(.json)は工程スケッチで開くと再編集できます。LexxPluss 工程スケッチで作成。</p>
</div>
<script type="application/json" id="ps-data">${JSON.stringify(Object.assign({ app: "lexxmoma-process-sketch" }, d)).replace(/</g, "\\u003c")}</script>
</body></html>`;
  const w = window.open(URL.createObjectURL(new Blob([html], { type: "text/html" })), "_blank");
  if (!w) { // ポップアップが止められた場合はファイルとして保存
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([html], { type: "text/html" })); a.download = "検討シート.html"; a.click();
  }
  return html;
}

window.PSX = { png, csv, report, tables, layoutSVG };
})();
