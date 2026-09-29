/* 使い方ガイド: 画面の見かた(領域に番号) / 操作ツアー(スポットライト+吹き出し) / 「場所を見る」。
   図のデータは変えない(選択・タブ・表示範囲だけ動かす)。保存するのは「起動時に表示するか」だけ。 */
(function () {
  "use strict";
  const $ = s => document.querySelector(s), KEY = "ps.guide.startup.v1";
  const UI = () => window.PSUI || {};
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function store(value) { try { localStorage.setItem(KEY, value); } catch (_) {} }

  // ---- ツアーで使う設備(選択中の設備 > 加工・組立 > 時間のある設備)
  const objs = () => (UI().doc && UI().doc.objs) || [];
  const timed = o => !!o && window.PS && PS.isTimed(o.type);
  const selObj = () => objs().find(o => o.id === (UI().selectedId && UI().selectedId()));
  function machine() {
    const s = selObj(); if (timed(s)) return s;
    return objs().find(o => o.type === "process" || o.type === "join") || objs().find(timed);
  }
  const nodeOf = o => o && document.querySelector(`#Lst [data-id="${o.id}"]`);
  function ensureMachine() { const m = machine(); if (m && !timed(selObj())) UI().select(m.id); UI().switchTab("insp"); }
  function ensureNothing() { UI().select(null); UI().switchTab("insp"); } // 矢印・寸法線を選んでいても外す
  function ensureResult() { if ($("#res .concl")) UI().switchTab("res"); else $("#simCalc").click(); }
  const timeBox = () => { const i = $('#insp [data-k="autoT"]'); return i && i.closest(".grid2"); };

  // ---- 操作ツアー(each: target=光らせる所 / prep=表示の準備 / demo=代わりにやる / doneOn=できたと判定するイベント)
  const TOUR = [
    { title: "設備をクリックして選ぶ", place: "bottom",
      target: () => nodeOf(machine()),
      text: () => `光っている「${esc((machine() || {}).name || "設備")}」をクリックしてください。`,
      why: "図の四角が設備です。選ぶと、右側にその設備の設定が出ます。",
      demo: () => UI().select(machine().id), doneOn: "select" },
    { title: "右に「工程カード」が出ます", place: "left", prep: ensureMachine,
      target: () => $("#insp .pcard"),
      text: () => "選んだ設備の中身を、3つの欄で書きます。",
      list: ["<b>① 入れるもの</b> … 前の工程から、何が何個来るか", "<b>② 出すもの</b> … 何が何個できて、次はどこへ行くか", "<b>③ 時間</b> … 1回にかかる秒数"] },
    { title: "③に時間を入れる", place: "left", prep: ensureMachine,
      target: timeBox,
      text: () => "「自動運転」か「人の作業」の秒数を書き換えて、Enter を押してください。",
      why: "<b>自動運転</b> = 機械だけで進む時間(人は離れてよい)。<b>人の作業</b> = セット・取り出し・目視など、人が付いている時間。分からなければ仮の値のまま進めてかまいません。",
      doneOn: "time" },
    { title: "「1日分を計算」を押す", place: "top",
      target: () => $("#simCalc"),
      text: () => "画面下の緑のボタンを押してください。",
      why: "稼働時間・休憩を含めた1日で、何個できるか・人が何時間働くかを計算します。横の「▶ 動かす」は、人とモノの動きをアニメーションで見るボタンです。",
      demo: () => $("#simCalc").click(), doneOn: "calc" },
    { title: "結果の見かた", place: "left", prep: ensureResult,
      target: () => $("#res .concl") || $("#res"),
      text: () => "右の「結果」に、1日の数字がまとまります。",
      list: ["<b>1日にできる数</b> … 一番大きい数字。必要数を入れると、届くか・何個足りないかも出ます", "<b>人の作業時間</b> … 作業者が1日に働く合計", "少し下の <b>「LexxMoMa に任せる作業を選ぶ」</b> で、導入したときと比べられます"] },
    { title: "「検討シートを作る」で持ち帰る", place: "bottom",
      target: () => $("#btnReport"),
      text: () => "右上の青いボタンを押すと、図・条件・結果が1枚にまとまります。",
      why: "印刷画面から PDF でも保存できます。お客さまとの次の打ち合わせに持っていけます。",
      doneOn: "report" }
  ];

  // ---- 「やりたいことから探す」(1つだけ光らせる)
  const WHERE = [
    { t: "部品を置く", target: () => $("#palette"), place: "right", prep: ensureNothing,
      text: "置きたい部品をクリックしてから、図の上をクリックします(図へドラッグしても置けます)。" },
    { t: "モノの流れをつなぐ", target: () => $('#tools [data-tool="connect"]'), place: "bottom",
      text: "「流れをつなぐ」を押して、前の設備から次の設備へドラッグします。設備を選ぶと右端に出る青い ●→ をドラッグしてもつなげます。" },
    { t: "工程の中身・時間を入れる", target: () => $("#insp .pcard"), place: "left", prep: ensureMachine,
      text: "図の設備をクリックすると、右にこの「工程カード」が出ます。① 入れるもの ② 出すもの ③ 時間 を書きます。" },
    { t: "通路(歩く所)を描く", target: () => $('#palette .pi[data-type="walk"]'), place: "right", prep: ensureNothing,
      text: "これを選んで、図の上で角を順にクリックして囲みます。人・LexxMoMa は通路の中だけを歩きます。「立入禁止」も同じ描き方です。" },
    { t: "図面・写真を下に敷く", target: () => $("#left .setbox"), place: "right",
      text: "ここを開いて「画像を読み込む」→「縮尺を合わせる」(2点と実寸)。なぞると寸法の合った図になります。" },
    { t: "稼働時間・休憩・必要数を変える", target: () => { const i = $('#insp [data-day="hours"]'); return i && i.closest(".grid2"); }, place: "left", prep: ensureNothing,
      text: "図の何もない所をクリックすると、右に図全体の条件が出ます。計算後は「結果」の上の欄でも変えられます。" },
    { t: "人とモノの動きを見る", target: () => $("#simPlay"), place: "top",
      text: "「▶ 動かす」で、作業者が運ぶ・作業する様子を再生します。速さは横の「速さ」で変えられます。" },
    { t: "LexxMoMa に任せたときと比べる", target: () => $("#lxOpen") || $("#res"), place: "left", prep: ensureResult,
      text: "「1日分を計算」の後、結果のこのボタンで任せる作業を選ぶと、今の結果(現状)との差が出ます。" },
    { t: "保存する・共有する", target: () => $("#btnFile"), place: "bottom",
      text: "「ファイル」から、保存(.json)・共有URL・画像・表データを出せます。図はこのブラウザにも自動で残ります。" },
    { t: "間違えた操作を戻す", target: () => $("#btnUndo"), place: "bottom",
      text: "↶ で元に戻す(Ctrl+Z)、↷ でやり直す(Ctrl+Y)。" }
  ];

  // ---- 画面の見かた(領域と説明の置き場所)
  const MAP = [
    { el: "#left", n: 1, t: "部品", d: "設備・作業者・通路などを選んで図に置く", at: "in" },
    { el: "#tools", n: 2, t: "図の道具", d: "選ぶ・流れをつなぐ・寸法を測る・全体を表示", at: "below" },
    { el: "#cvWrap", n: 3, t: "工程の図", d: "四角=設備、矢印=モノの流れ、人の印=作業者、緑=通路", at: "in" },
    { el: "#right", n: 4, t: "設定と結果", d: "選んだ設備の設定(工程カード)と、計算の結果", at: "in" },
    { el: "#simbar", n: 5, t: "計算と再生", d: "1日分を計算する・人とモノの動きを見る", at: "above" },
    { el: ["#btnTpl", "#btnHelp"], n: 6, t: "ひな形・保存・持ち帰り", d: "ひな形を選ぶ・元に戻す・ファイル・検討シート・使い方", at: "below", right: true }
  ];

  // ---- 部品
  const spot = document.createElement("div"); spot.id = "gSpot"; spot.hidden = true;
  const pop = document.createElement("section"); pop.id = "gPop"; pop.hidden = true;
  pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "使い方ガイド");
  const map = document.createElement("div"); map.id = "gMap"; map.hidden = true;
  document.body.append(spot, pop, map);

  let steps = null, step = 0, done = false, raf = 0, origin = null, autoT = 0;

  function rectOf(t) {
    const els = (Array.isArray(t) ? t : [t]).map(s => typeof s === "string" ? $(s) : s).filter(Boolean);
    if (!els.length) return null;
    const rs = els.map(e => e.getBoundingClientRect()).filter(r => r.width || r.height);
    if (!rs.length) return null;
    const l = Math.min(...rs.map(r => r.left)), t2 = Math.min(...rs.map(r => r.top));
    return { left: l, top: t2, right: Math.max(...rs.map(r => r.right)), bottom: Math.max(...rs.map(r => r.bottom)) };
  }

  // 吹き出しを対象の横に置く(入らなければ反対側 → 画面内に収める)
  function place() {
    if (!steps) return;
    const s = steps[step], el = s && !done ? s.target() : null, r = el && rectOf(el);
    const W = innerWidth, H = innerHeight, pad = 6, gap = 14;
    if (r) {
      const x = Math.max(2, r.left - pad), y = Math.max(2, r.top - pad);
      Object.assign(spot.style, { left: x + "px", top: y + "px", width: Math.min(W - 4, r.right + pad) - x + "px", height: Math.min(H - 4, r.bottom + pad) - y + "px" });
      spot.hidden = false; spot.classList.remove("none");
    } else { spot.hidden = false; spot.classList.add("none"); Object.assign(spot.style, { left: W / 2 + "px", top: H / 2 + "px", width: "0px", height: "0px" }); }
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let side = r ? s.place : "center", px, py;
    const fits = { right: r && r.right + gap + pw < W, left: r && r.left - gap - pw > 0, bottom: r && r.bottom + gap + ph < H, top: r && r.top - gap - ph > 0 };
    const opp = { right: "left", left: "right", top: "bottom", bottom: "top" };
    if (r && !fits[side]) side = fits[opp[side]] ? opp[side] : ["bottom", "top", "left", "right"].find(k => fits[k]) || "inside";
    if (side === "right") { px = r.right + gap; py = (r.top + r.bottom) / 2 - ph / 2; }
    else if (side === "left") { px = r.left - gap - pw; py = (r.top + r.bottom) / 2 - ph / 2; }
    else if (side === "bottom") { px = (r.left + r.right) / 2 - pw / 2; py = r.bottom + gap; }
    else if (side === "top") { px = (r.left + r.right) / 2 - pw / 2; py = r.top - gap - ph; }
    else if (side === "inside") { px = r.right - pw - 12; py = r.bottom - ph - 12; }
    else { px = W / 2 - pw / 2; py = H / 2 - ph / 2; }
    px = Math.max(8, Math.min(W - pw - 8, px)); py = Math.max(8, Math.min(H - ph - 8, py));
    pop.style.left = px + "px"; pop.style.top = py + "px"; pop.dataset.side = side;
    // 矢印は対象の中心を向ける
    if (r) {
      if (side === "left" || side === "right") pop.style.setProperty("--ay", Math.max(16, Math.min(ph - 16, (r.top + r.bottom) / 2 - py)) + "px");
      else pop.style.setProperty("--ax", Math.max(16, Math.min(pw - 16, (r.left + r.right) / 2 - px)) + "px");
    }
  }
  function loop() { place(); raf = requestAnimationFrame(loop); }

  function paint() {
    const tour = steps === TOUR, n = steps.length, s = steps[step];
    if (done) {
      pop.innerHTML = `<div class="g-head"><b>操作ツアー 完了</b><button type="button" class="g-x" aria-label="ガイドを閉じる">×</button></div>
        <h3>基本の流れはここまでです</h3>
        <p>次は、自分の工程に合わせて設備の名前・時間を書き換えてみてください。わからない操作は「?」→「やりたいことから探す」で場所を確かめられます。</p>
        <p class="g-why">設備の時間が分からない項目は「仮の値」と表示されます。お客さまに確認してから結果を判断してください。</p>
        <div class="g-acts"><button type="button" class="btn" data-g="help">やりたいことから探す</button><button type="button" class="btn p" data-g="close">閉じる</button></div>`;
    } else {
      const el = s.target(), finished = s.doneOn && s.ok;
      pop.innerHTML = `<div class="g-head"><b>${tour ? `操作ツアー ${step + 1} / ${n}` : "ここで操作します"}</b><button type="button" class="g-x" aria-label="ガイドを閉じる">×</button></div>
        ${tour ? `<div class="g-dots">${steps.map((_, i) => `<i class="${i < step ? "d" : i === step ? "c" : ""}"></i>`).join("")}</div>` : ""}
        <h3>${esc(s.title || s.t)}</h3>
        <p class="g-do">${el ? (typeof s.text === "function" ? s.text() : s.text) : "この画面では見つかりませんでした。図に設備・作業者があるか確かめてください(「ひな形」から始めると確実です)。"}</p>
        ${s.list ? `<ul>${s.list.map(x => `<li>${x}</li>`).join("")}</ul>` : ""}
        ${s.why ? `<p class="g-why">${s.why}</p>` : ""}
        ${finished ? `<p class="g-ok">✓ できました</p>` : ""}
        <div class="g-acts">${tour ? `<button type="button" class="btn" data-g="back" ${step ? "" : "disabled"}>戻る</button>` : "<span></span>"}
          <span class="g-r">${tour && s.demo && !finished && el ? `<button type="button" class="btn ghost" data-g="demo">代わりにやる</button>` : ""}
          ${tour && !el && !machine() ? `<button type="button" class="btn" data-g="sample">ひな形「直線ライン」で試す</button>` : ""}
          <button type="button" class="btn p" data-g="${tour ? "next" : "close"}">${tour ? (step === n - 1 ? "完了" : finished || !s.doneOn ? "次へ" : "とばす") : "わかった"}</button></span></div>`;
    }
    place();
    // 描き直しでボタンが入れ替わるので、キーボードで続けられるよう主ボタンへ戻す
    if (pop.contains(document.activeElement) || document.activeElement === document.body) { const b = pop.querySelector(".g-acts .btn.p"); if (b) b.focus({ preventScroll: true }); }
  }

  function go(i) {
    clearTimeout(autoT);
    step = i; done = false;
    const s = steps[step]; s.ok = false;
    if (s.prep) s.prep();
    const el = s.target();
    if (el && el.scrollIntoView && !el.closest("#cv")) el.scrollIntoView({ block: "nearest", inline: "nearest" });
    paint();
  }
  function start(list, i) {
    origin = document.activeElement;
    $("#help").hidden = true; closeMap();
    steps = list; pop.hidden = false; document.body.classList.add("g-on");
    if (list === TOUR) { if (!i && UI().selectedId()) UI().select(null); UI().fit(); } // 最初から: 自分でクリックして選ぶところから
    go(i || 0);
    cancelAnimationFrame(raf); loop();
    const b = pop.querySelector('[data-g="next"],[data-g="close"]'); if (b) b.focus();
  }
  function close() {
    const was = !!steps;
    clearTimeout(autoT); cancelAnimationFrame(raf);
    steps = null; pop.hidden = true; spot.hidden = true; if (map.hidden) document.body.classList.remove("g-on");
    if (was && origin && origin.isConnected && !origin.closest("#help")) origin.focus({ preventScroll: true }); // 開いていた時だけ、元の場所へ
  }
  // 操作が済んだら「✓」を見せてから次へ進む
  function hit(kind) {
    if (!steps || done) return;
    const s = steps[step];
    if (s.doneOn !== kind || s.ok) return;
    s.ok = true; paint();
    autoT = setTimeout(() => { if (steps && steps[step] === s) { if (step < steps.length - 1) go(step + 1); else { done = true; paint(); } } }, 1100);
  }

  pop.addEventListener("click", e => {
    const b = e.target.closest("[data-g],.g-x"); if (!b) return;
    const k = b.classList.contains("g-x") ? "close" : b.dataset.g;
    if (k === "close") close();
    else if (k === "back") go(Math.max(0, step - 1));
    else if (k === "next") { if (step < steps.length - 1) go(step + 1); else { clearTimeout(autoT); done = true; paint(); } }
    else if (k === "demo") steps[step].demo();
    else if (k === "sample") { const t = document.querySelector('[data-htpl="line"]'); if (t) t.click(); UI().fit(); go(0); }
    else if (k === "help") { close(); $("#help").hidden = false; }
  });

  // ---- 画面の見かた
  function openMap() {
    close(); $("#help").hidden = true;
    const box = MAP.map(m => {
      const r = rectOf(m.el); if (!r) return "";
      const w = r.right - r.left, h = r.bottom - r.top;
      // 広い領域は中に、細い帯(道具・計算・右上のボタン)は上か下に説明を置く
      const lw = m.at === "in" ? Math.max(160, Math.min(280, w - 16)) : 280;
      let lx = m.at === "in" ? r.left + (w - lw) / 2 : r.left + 8, ly = m.at === "in" ? r.top + h * 0.3 : r.top;
      if (m.at === "below") ly = r.bottom + 8; else if (m.at === "above") ly = r.top - 8;
      if (m.right) lx = r.right - lw;
      const cls = m.at === "above" ? "g-lab up" : "g-lab";
      return `<div class="g-reg" style="left:${r.left}px;top:${r.top}px;width:${w}px;height:${h}px"><i class="g-n">${m.n}</i></div>
        <div class="${cls}" style="left:${Math.max(8, Math.min(innerWidth - lw - 8, lx))}px;top:${ly}px;width:${lw}px"><i class="g-n">${m.n}</i><div><b>${m.t}</b><span>${m.d}</span></div></div>`;
    }).join("");
    map.innerHTML = box + `<div class="g-mapbar"><b>画面の見かた</b><span>どこかをクリックすると閉じます</span><button type="button" class="btn p" data-g="tour">操作ツアーを始める</button><button type="button" class="btn" data-g="mapclose">閉じる</button></div>`;
    map.hidden = false; document.body.classList.add("g-on");
    const b = map.querySelector('[data-g="tour"]'); if (b) b.focus();
  }
  function closeMap() { if (!map.hidden) { map.hidden = true; if (!steps) document.body.classList.remove("g-on"); } }
  map.addEventListener("click", e => { const b = e.target.closest('[data-g="tour"]'); closeMap(); if (b) start(TOUR); });

  // ---- 入口(使い方の窓・右パネル)。右パネルは描き直されるので document で受ける
  $("#helpWhere").innerHTML = WHERE.map((w, i) => `<button type="button" class="btn" data-where="${i}"><span>${esc(w.t)}</span><small>場所を見る ›</small></button>`).join("");
  document.addEventListener("click", e => {
    const g = e.target.closest("[data-guide]");
    if (g) { if (g.dataset.guide === "map") openMap(); else start(TOUR); return; }
    const w = e.target.closest("[data-where]");
    if (w) start([WHERE[+w.dataset.where]]);
  });
  $("#guideOnStartup").onchange = e => store(e.target.checked ? "1" : "0");

  // ---- 操作の検知
  window.addEventListener("ps:selection", e => { if (e.detail.timed) hit("select"); });
  // 入力の確定で右パネルが描き直される前に見るため、捕捉フェーズで受ける
  document.addEventListener("change", e => { if (e.target.matches('#insp [data-k="autoT"], #insp [data-k="manT"]') && Number.isFinite(+e.target.value) && +e.target.value >= 0) hit("time"); }, true);
  window.addEventListener("ps:calculated", () => hit("calc"));
  window.addEventListener("ps:report", () => hit("report"));
  document.addEventListener("keydown", e => { if (e.key !== "Escape") return; if (!map.hidden) closeMap(); else if (steps) close(); });
  $("#btnHelp").addEventListener("click", () => { close(); closeMap(); });
  window.addEventListener("resize", () => { if (!map.hidden) openMap(); });

  window.PSGuide = {
    init() { let show = true; try { show = localStorage.getItem(KEY) !== "0"; } catch (_) {} $("#guideOnStartup").checked = show; $("#help").hidden = !show; },
    tour: i => start(TOUR, i), map: openMap, close
  };
})();
