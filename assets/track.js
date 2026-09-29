/* LexxMoMa Tools 共通計測 (GoatCounter)
 * 使い方: <script src="assets/track.js" data-tool="<ツールID>"></script> (階層に応じて ../assets/track.js)
 *   - ページ表示は自動で "tool/<ツールID>" (ハブは "hub") として記録
 *   - 操作の記録は  lxTrack("tool/eoat/design_done", "説明")  を呼ぶ
 *   - URL に ?c=<顧客コード> が付いていれば localStorage に保持し "cust/<コード>/<ツールID>" も記録
 * GC_SITE が空のときは送信せず console に出すだけ (ローカル確認用)
 */
(function(){
  var GC_SITE = "";            // ← GoatCounter のサイトコード (例: "lexxmoma" → https://lexxmoma.goatcounter.com)
  var me = document.currentScript;
  var tool = (me && me.getAttribute("data-tool")) || "unknown";
  var pagePath = tool === "hub" ? "hub" : "tool/" + tool;

  // 顧客コード (?c=) の取得と保持
  var cust = "";
  try {
    var m = /[?&]c=([^&#]+)/.exec(location.search);
    if (m) { cust = decodeURIComponent(m[1]).slice(0, 32); localStorage.setItem("lx_cust", cust); }
    else cust = localStorage.getItem("lx_cust") || "";
  } catch (e) {}
  window.lxCustomer = cust;

  var queue = [];
  function send(ev){
    if (!GC_SITE) { console.debug("[track dry-run]", ev); return; }
    if (window.goatcounter && window.goatcounter.count) window.goatcounter.count(ev);
    else queue.push(ev);
  }
  window.lxTrack = function(path, title){ send({path: path, title: title || "", event: true}); };

  if (!GC_SITE) {
    console.debug("[track dry-run] pageview", pagePath, cust ? "cust=" + cust : "");
    if (cust) console.debug("[track dry-run]", {path: "cust/" + cust + "/" + tool, event: true});
    return;
  }

  // GoatCounter 設定 → count.js 読込
  window.goatcounter = {
    path: function(){ return pagePath; },
    title: function(){ return document.title; }
  };
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.setAttribute("data-goatcounter", "https://" + GC_SITE + ".goatcounter.com/count");
  s.onload = function(){
    if (cust) send({path: "cust/" + cust + "/" + tool, title: document.title, event: true});
    while (queue.length) window.goatcounter.count(queue.shift());
  };
  document.head.appendChild(s);
})();
