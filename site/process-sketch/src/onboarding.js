/* Non-destructive, optional first-use guide. Stores preferences, never layout data. */
(function () {
  "use strict";
  const $ = s => document.querySelector(s), KEY = "ps.guide.startup.v1";
  const steps = [
    { title: "設備を選びましょう", text: "図の「加工」や「検査」をクリックしてください。右側に、その設備の設定が表示されます。", target: "#Lst", tip: "白紙から始める場合：左の部品を選び、図の置きたい場所をクリック。ひな形は「使い方」から選べます。" },
    { title: "工程にかかる時間を入れましょう", text: "右の工程カードで「自動運転」または「人の作業」の秒数を変更し、入力欄の外をクリックしてください。", target: "#insp", tip: "自動運転＝人が離れても進む時間。人の作業＝人が付き添う時間。まだ不明なら仮の値で試せます。変更は「元に戻す」で戻せます。" },
    { title: "1日にできる数を確かめましょう", text: "画面下の「1日分を計算」を押してください。結果では稼働時間・休憩・必要数を変更して再計算できます。", target: "#simCalc", tip: "「動かす」は人とモノの動きを見るボタンです。通路がない、設備に近づけないなどの警告が出たら、先に図を修正してください。" },
    { title: "結果を共有しましょう", text: "「検討シートを作る」を押すと、図・条件・結果をまとめて確認できます。印刷画面からPDFにも保存できます。", target: "#btnReport", tip: "LexxMoMa導入を比べたいときは、結果の「任せる作業を選ぶ」へ。最初の結果が現状として残り、改善案との差を確認できます。" }
  ];
  let step = 0, active = false, marked = null, origin = null;
  function store(value) { try { localStorage.setItem(KEY, value); } catch (_) {} }
  const panel = document.createElement("section");
  panel.id = "operationGuide"; panel.hidden = true; panel.setAttribute("aria-label", "使い方ガイド");
  panel.innerHTML = `<div class="guide-head"><b id="guideCount"></b><button type="button" id="guideClose" aria-label="ガイドを閉じる">×</button></div><div aria-live="polite" aria-atomic="true"><h3 id="guideTitle"></h3><p id="guideText"></p><p class="hint" id="guideTip"></p></div><div class="guide-actions"><button class="btn" id="guideBack">戻る</button><button class="btn p" id="guideNext">次へ</button></div>`;
  document.body.appendChild(panel);
  function clear() { if (marked) marked.classList.remove("guide-highlight"); marked = null; }
  function paint() {
    clear(); panel.hidden = !active; if (!active) return;
    const done = step === steps.length, current = steps[step];
    $("#guideCount").textContent = done ? "案内はここまでです" : `使い方 ${step + 1} / ${steps.length}`;
    $("#guideTitle").textContent = done ? "基本の流れを確認できました" : current.title;
    $("#guideText").textContent = done ? "次は自分の工程に合わせて、設備・部品名・時間を変えてみてください。ガイドは「使い方」からいつでも再開できます。" : current.text;
    $("#guideTip").textContent = done ? "実際の設備時間が不明な項目は、顧客と確認してから結果を判断してください。" : current.tip;
    $("#guideBack").disabled = step === 0;
    $("#guideNext").textContent = done ? "ガイドを閉じる" : "次へ";
    if (!done) { marked = $(current.target); if (marked) marked.classList.add("guide-highlight"); }
  }
  function close() { active = false; paint(); if (origin && origin.isConnected) origin.focus(); }
  function advance(index) { if (active && step === index) { step++; paint(); } }
  $("#guideClose").onclick = close;
  $("#guideBack").onclick = () => { step = Math.max(0, step - 1); paint(); };
  $("#guideNext").onclick = () => { if (step === steps.length) close(); else { step++; paint(); } };
  $("#startGuide").onclick = () => { origin = $("#btnHelp"); $("#help").hidden = true; active = true; step = 0; paint(); $("#guideNext").focus(); };
  $("#guideOnStartup").onchange = e => store(e.target.checked ? "1" : "0");
  window.addEventListener("ps:selection", e => { if (e.detail.timed) advance(0); });
  document.addEventListener("change", e => { if (e.target.matches('#insp [data-k="autoT"], #insp [data-k="manT"]') && Number.isFinite(+e.target.value) && +e.target.value >= 0) advance(1); });
  window.addEventListener("ps:calculated", () => advance(2));
  window.addEventListener("ps:report", () => advance(3));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && active) close(); });
  $("#btnHelp").addEventListener("click", close);
  window.PSGuide = { init() { let show = true; try { show = localStorage.getItem(KEY) !== "0"; } catch (_) {} $("#guideOnStartup").checked = show; $("#help").hidden = !show; } };
})();
