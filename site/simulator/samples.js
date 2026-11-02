/* =====================================================================
 * LexxMoMa 動作シミュレーター — サンプルの読込
 *  - samples/index.json の一覧をカードで出し、選んだ JSON を本体の applyLoadedData() に渡す
 *  - URL に ?sample=<id> が付いていれば起動時にそのサンプルを開く（共有リンク用）
 *  - 本体（lexxmoma-2d.html）には window.__sim 経由でだけ触る。本体側の変更は最小にする
 * ===================================================================== */
(function () {
  "use strict";
  const SIM = () => window.__sim;
  const INDEX_URL = "samples/index.json";
  let samples = null; // index.json の中身（読み込み済みなら配列）

  /* ---------- UI（モーダル） ---------- */
  const style = document.createElement("style");
  style.textContent = `
    #smpBackdrop { position: fixed; inset: 0; z-index: 9990; background: rgba(15,30,45,.55); display: none; }
    #smpBox { position: fixed; z-index: 9991; left: 50%; top: 50%; transform: translate(-50%,-50%); width: min(960px, calc(100vw - 32px)); height: min(620px, calc(100vh - 48px));
              background: #fff; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.35); display: none; flex-direction: column; overflow: hidden; }
    #smpBox header { background: #16324a; color: #fff; padding: 10px 16px; display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
    #smpBox header h2 { margin: 0; font-size: 15px; font-weight: 600; flex: 1; }
    #smpBox header button { background: transparent; border: 1px solid rgba(255,255,255,.5); color: #fff; border-radius: 5px; padding: 2px 10px; cursor: pointer; }
    #smpMain { flex: 1; display: flex; min-height: 0; }
    /* 左: 名前の一覧 */
    #smpList { flex: 0 0 260px; border-right: 1px solid #d4dae0; overflow-y: auto; background: #f7f9fb; }
    #smpSearch { display: block; width: calc(100% - 16px); margin: 8px; padding: 4px 8px; border: 1px solid #d4dae0; border-radius: 5px; font-size: 12px; box-sizing: border-box; }
    .smp-item { padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #e6ebef; font-size: 13px; color: #223; }
    .smp-item:hover { background: #e8f2fa; }
    .smp-item.sel { background: #dcebf7; border-left: 3px solid #0a6ebd; padding-left: 9px; font-weight: 600; color: #16324a; }
    .smp-empty { padding: 12px; font-size: 12px; color: #567; }
    /* 右: 詳細 */
    #smpDetail { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    #smpDetail .pane { flex: 1; overflow-y: auto; padding: 14px 18px 8px; display: flex; flex-direction: column; gap: 8px; }
    #smpDetail canvas { width: 100%; max-height: 300px; aspect-ratio: 16 / 9; display: block; background: #fff; border: 1px solid #e2e6ea; border-radius: 8px; }
    #smpDetail .title { font-weight: 700; font-size: 16px; color: #16324a; }
    #smpDetail .desc { font-size: 13px; color: #345; line-height: 1.7; white-space: pre-line; }
    #smpDetail .meta { font-size: 12px; color: #667; display: flex; gap: 14px; flex-wrap: wrap; }
    #smpDetail .meta b { color: #16324a; font-size: 13px; }
    #smpFoot { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 18px; border-top: 1px solid #d4dae0; background: #fbfcfd; }
    #smpFoot .hint { flex: 1; font-size: 11px; color: #567; }
    #smpFoot button { padding: 5px 16px; font-size: 13px; }
    #smpFoot button.primary { background: #0a6ebd; color: #fff; border-color: #0a6ebd; }
    #smpFoot button:disabled { opacity: .5; cursor: default; }
    #smpStatus { font-size: 12px; color: #c0392b; }
  `;
  document.head.appendChild(style);

  const backdrop = document.createElement("div"); backdrop.id = "smpBackdrop";
  const box = document.createElement("div"); box.id = "smpBox";
  box.innerHTML = `
    <header><h2>📂 サンプルを開く</h2><button id="smpClose">✕ 閉じる</button></header>
    <div id="smpMain">
      <div id="smpList"><input id="smpSearch" type="search" placeholder="名前で絞り込み"><div id="smpItems"></div></div>
      <div id="smpDetail">
        <div class="pane" id="smpPane"><div class="smp-empty">左の一覧からサンプルを選んでください。</div></div>
        <div id="smpFoot">
          <span class="hint">開くと今の内容は置き換わります（Ctrl+Z で戻せます）。</span>
          <span id="smpStatus"></span>
          <button id="smpOpen" class="primary" disabled>開く</button>
        </div>
      </div>
    </div>`;
  document.body.append(backdrop, box);
  const itemsEl = box.querySelector("#smpItems");
  const paneEl = box.querySelector("#smpPane");
  const status = box.querySelector("#smpStatus");
  const searchEl = box.querySelector("#smpSearch");
  const btnOpen = box.querySelector("#smpOpen");
  let current = null; // 選択中のサンプル

  function open() {
    backdrop.style.display = "block"; box.style.display = "flex";
    status.textContent = "";
    loadIndex().then(list => { renderList(list); if (!current && list.length) select(list[0]); else if (current) select(current); })
      .catch(err => { status.textContent = "一覧を読めませんでした: " + err.message + "（ローカルでは scripts/serve.py 経由で開いてください）"; });
  }
  function close() { backdrop.style.display = "none"; box.style.display = "none"; }
  backdrop.addEventListener("click", close);
  box.querySelector("#smpClose").addEventListener("click", close);
  btnOpen.addEventListener("click", () => current && openSample(current, false));
  searchEl.addEventListener("input", () => renderList(samples || []));
  window.addEventListener("keydown", (e) => {
    if (box.style.display !== "flex") return;
    if (e.key === "Escape") { close(); return; }
    if (e.target === searchEl && e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
    const vis = visibleSamples();
    const i = vis.indexOf(current);
    if (e.key === "ArrowDown" && i < vis.length - 1) { e.preventDefault(); select(vis[i + 1]); }
    else if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); select(vis[i - 1]); }
    else if (e.key === "Enter" && current) { e.preventDefault(); openSample(current, false); }
  });
  document.getElementById("btnSamples").addEventListener("click", open);

  async function loadIndex() {
    if (samples) return samples;
    // samples/embedded.js（build.py が作る）があればそれを使う。HTML をダブルクリックで開いたときは fetch が使えないため
    if (window.LEXX_SAMPLES) { samples = (window.LEXX_SAMPLES.index.samples || []).map(s => Object.assign({}, s)); return samples; }
    const r = await fetch(INDEX_URL, { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const idx = await r.json();
    samples = idx.samples || [];
    return samples;
  }

  async function fetchSample(s) {
    if (s._data) return s._data;
    const emb = window.LEXX_SAMPLES && window.LEXX_SAMPLES.files[s.file];
    if (emb) { s._data = JSON.parse(JSON.stringify(emb)); return s._data; }
    const r = await fetch("samples/" + s.file, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${s.file}: HTTP ${r.status}`);
    s._data = await r.json();
    return s._data;
  }

  function visibleSamples() {
    const q = searchEl.value.trim().toLowerCase();
    return (samples || []).filter(s => !q || (s.title + " " + (s.description || "")).toLowerCase().includes(q));
  }

  /* 左の一覧（名前と、タグの 1 行） */
  function renderList(list) {
    itemsEl.innerHTML = "";
    const vis = visibleSamples();
    if (!list.length) { itemsEl.innerHTML = '<div class="smp-empty">サンプルがまだありません。</div>'; return; }
    if (!vis.length) { itemsEl.innerHTML = '<div class="smp-empty">該当するサンプルがありません。</div>'; return; }
    for (const s of vis) {
      const it = document.createElement("div");
      it.className = "smp-item" + (s === current ? " sel" : "");
      it.textContent = s.title;
      it.addEventListener("click", () => select(s));
      it.addEventListener("dblclick", () => openSample(s, false));
      itemsEl.appendChild(it);
    }
  }

  /* 右の詳細（プレビュー・見どころ・説明） */
  function select(s) {
    current = s;
    renderList(samples || []);
    btnOpen.disabled = !s;
    paneEl.innerHTML = "";
    if (!s) return;
    const cv = document.createElement("canvas"); cv.width = 960; cv.height = 540;
    const title = document.createElement("div"); title.className = "title"; title.textContent = s.title;
    const meta = document.createElement("div"); meta.className = "meta"; meta.textContent = "読み込み中…";
    const desc = document.createElement("div"); desc.className = "desc"; desc.textContent = s.description || "";
    paneEl.append(title, cv, meta, desc);
    fetchSample(s).then(data => {
      if (current !== s) return;
      drawPreview(cv, data);
      const total = cycleTime(data);
      meta.innerHTML = "";
      const add = (k, v) => { const sp = document.createElement("span"); sp.innerHTML = `${k} <b></b>`; sp.querySelector("b").textContent = v; meta.appendChild(sp); };
      if (total !== null) add("サイクルタイム", total.toFixed(1) + " s");
    }).catch(err => { meta.textContent = `読めません: ${err.message}`; });
  }

  /* 本体のコンパイルで所要時間を出す（状態は触らず、一時的に差し替えて戻す） */
  function cycleTime(data) {
    const S = SIM(); if (!S) return null;
    const st = S.state;
    const keep = { points: st.points, initial: st.initial, program: st.program, robot: st.robot };
    try {
      // 登録した位置・シーケンスは本体の変換を通す（旧形式の車体位置・アーム位置もポイントに直る）
      const mig = (a) => (S.migrateArm ? S.migrateArm(a) : a);
      const conv = S.pointsFromSave(data);
      st.points = conv.points;
      st.initial = conv.initial;
      st.program = conv.program;
      st.robot = data.robot ? { body: data.robot.body || st.robot.body, arm: mig(data.robot.arm || st.robot.arm) } : st.robot;
      return S.compileProgram().total;
    } catch (e) { return null; }
    finally { Object.assign(st, keep); }
  }

  /* カード用の簡易プレビュー: 背景の四角・直線・文字位置と、登録した車体位置、経路の順番を描く */
  function drawPreview(cv, data) {
    const g = cv.getContext("2d");
    // version 3（objects）と旧形式（bgRects / bgLines / bgTexts）の両方を、対角 2 点の四角・直線・文字に揃える
    const objs = data.objects || [];
    const rects = objs.filter(o => o.type === "box" && o.visible !== false)
      .map(o => ({ x1: o.x - o.w / 2, y1: o.y - o.d / 2, x2: o.x + o.w / 2, y2: o.y + o.d / 2, color: o.color, h: o.h }))
      .concat(data.bgRects || []);
    const lines = objs.filter(o => o.type === "line" && o.visible !== false).concat(data.bgLines || []);
    const texts = objs.filter(o => o.type === "text" && o.visible !== false).concat(data.bgTexts || []);
    // 車体の位置を持つポイント（旧形式は本体の変換でポイントに直す）
    const S = SIM();
    const conv = (S && S.pointsFromSave) ? S.pointsFromSave(data) : { points: [], program: [], initial: {} };
    const poses = conv.points.filter(p => p.body).map(p => ({ name: p.name, x: p.body.x, y: p.body.y, th: p.body.th }));
    const xs = [], ys = [];
    for (const R of rects) { xs.push(R.x1, R.x2); ys.push(R.y1, R.y2); }
    for (const L of lines) { xs.push(L.x1, L.x2); ys.push(L.y1, L.y2); }
    for (const p of poses) { xs.push(p.x); ys.push(p.y); }
    if (xs.length < 2) { g.fillStyle = "#789"; g.font = "14px sans-serif"; g.fillText("（プレビューなし）", 20, 40); return; }
    const pad = 600;
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    const sc = Math.min(cv.width / (x1 - x0), cv.height / (y1 - y0));
    const ox = (cv.width - (x1 - x0) * sc) / 2, oy = (cv.height - (y1 - y0) * sc) / 2;
    const W = (x, y) => [ox + (x - x0) * sc, oy + (y1 - y) * sc];
    g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
    // 1m グリッド
    g.strokeStyle = "#eef1f4"; g.lineWidth = 1; g.beginPath();
    for (let gx = Math.ceil(x0 / 1000) * 1000; gx <= x1; gx += 1000) { const [sx] = W(gx, 0); g.moveTo(sx, 0); g.lineTo(sx, cv.height); }
    for (let gy = Math.ceil(y0 / 1000) * 1000; gy <= y1; gy += 1000) { const [, sy] = W(0, gy); g.moveTo(0, sy); g.lineTo(cv.width, sy); }
    g.stroke();
    for (const R of rects) {
      const [ax, ay] = W(Math.min(R.x1, R.x2), Math.max(R.y1, R.y2)), [bx, by] = W(Math.max(R.x1, R.x2), Math.min(R.y1, R.y2));
      g.globalAlpha = 0.15; g.fillStyle = R.color; g.fillRect(ax, ay, bx - ax, by - ay); g.globalAlpha = 1;
      g.strokeStyle = R.color; g.lineWidth = R.h > 0 ? 3 : 1.5; g.strokeRect(ax, ay, bx - ax, by - ay);
    }
    for (const L of lines) { const [ax, ay] = W(L.x1, L.y1), [bx, by] = W(L.x2, L.y2); g.strokeStyle = L.color; g.lineWidth = 1.5; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); }
    g.font = "11px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    for (const T of texts) { const [sx, sy] = W(T.x, T.y); g.fillStyle = T.color || "#888"; g.fillText(T.text, sx, sy); }
    // 車体位置（箱＋前方向）と、シーケンスで通る順の線
    const byName = Object.fromEntries(poses.map(p => [p.name, p]));
    let prev = byName[conv.initial.body] || null;
    g.strokeStyle = "rgba(36,113,163,.6)"; g.setLineDash([4, 3]); g.lineWidth = 1.5; g.beginPath();
    for (const st of conv.program) for (const b of st.blocks) {
      if (b.type !== "point" || b.move === "arm") continue;
      const p = byName[b.point]; if (!p) continue;
      if (prev) { const [ax, ay] = W(prev.x, prev.y), [bx, by] = W(p.x, p.y); g.moveTo(ax, ay); g.lineTo(bx, by); }
      prev = p;
    }
    g.stroke(); g.setLineDash([]);
    for (const p of poses) {
      const [sx, sy] = W(p.x, p.y);
      g.save(); g.translate(sx, sy); g.rotate(-(p.th || 0));
      const L = 750 * sc, Wd = 600 * sc;
      g.fillStyle = "rgba(36,113,163,.15)"; g.strokeStyle = "rgba(36,113,163,.7)"; g.lineWidth = 1;
      g.fillRect(-L / 2, -Wd / 2, L, Wd); g.strokeRect(-L / 2, -Wd / 2, L, Wd);
      g.fillStyle = "rgba(36,113,163,.7)"; g.beginPath(); g.moveTo(L * 0.42, 0); g.lineTo(L * 0.1, -Wd * 0.28); g.lineTo(L * 0.1, Wd * 0.28); g.closePath(); g.fill();
      g.restore();
    }
  }

  async function openSample(s, play) {
    const S = SIM();
    if (!S) { alert("シミュレーターの準備ができていません。"); return; }
    try {
      const data = await fetchSample(s);
      const st = S.state;
      const hasWork = st.program.length || st.points.length || (st.objects || []).length;
      if (hasWork && !confirm(`「${s.title}」を開きます。今の内容は置き換わります（Ctrl+Z で戻せます）。よろしいですか？`)) return;
      if (S.playing) S.stopPlayback(false);
      S.applyLoadedData(JSON.parse(JSON.stringify(data)));
      S.fitViewToContent();
      close();
      if (play) document.getElementById("btnPlay").click();
      // URL にサンプル id を残す（共有しやすく、再読込でも同じものが開く）
      try { const u = new URL(location.href); u.searchParams.set("sample", s.id); history.replaceState(null, "", u); } catch (e) { /* file:// など */ }
    } catch (err) {
      alert("サンプルを開けませんでした: " + err.message);
    }
  }

  /* ?sample=<id>（&play=1 で再生まで）で起動したら、そのサンプルを開く */
  function openFromUrl() {
    let id = null, play = false;
    try { const u = new URL(location.href); id = u.searchParams.get("sample"); play = u.searchParams.get("play") === "1"; } catch (e) { return; }
    if (!id) return;
    loadIndex().then(list => {
      const s = list.find(x => x.id === id);
      if (!s) { console.warn("sample not found:", id); return; }
      return fetchSample(s).then(data => {
        const S = SIM();
        current = s;
        S.applyLoadedData(JSON.parse(JSON.stringify(data)));
        S.fitViewToContent();
        // 読込は履歴に積まない（開いた直後の Ctrl+Z で空に戻るのは不自然）
        S.undoStack.pop();
        if (play) document.getElementById("btnPlay").click();
      });
    }).catch(err => console.warn("sample:", err));
  }
  // 本体の起動（同期）が終わってから
  if (document.readyState === "complete") openFromUrl(); else window.addEventListener("load", openFromUrl);

  window.LexxSamples = { open, close, openSample, loadIndex };
})();
