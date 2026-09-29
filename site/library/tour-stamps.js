/* 見学ツアーのスタンプ記録(トップページと見学ツアーで共用)
 * 閲覧者のブラウザ内(localStorage)にだけ保存。使えない環境ではページ表示中のみ保持。
 * 前提: materials.js を先に読み込むこと。
 */
(function () {
  var KEY = "lx_tour_v1", mem = {};
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return mem; } }
  function save(o) { mem = o; try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
  // form(入力スポット)は中身のファイルが無くても開ける
  function ready(m) { return m.type === "form" ? true : !!(m.type === "youtube" ? m.youtube : m.src); }
  var items = function () { return (window.MATERIALS || []).filter(ready); };
  window.lxTour = {
    ready: ready,
    spots: items,
    stamps: load,
    has: function (id) { return !!load()[id]; },
    // 新しく押せたら true
    add: function (id) { var o = load(); if (o[id]) return false; o[id] = Date.now(); save(o); return true; },
    // 入力スポットは最後にだけ開く: ほかの見られるスポットをすべて見終えるまでロック
    locked: function (m) { if (m.type !== "form") return false; var o = load(); return items().some(function (x) { return x.type !== "form" && !o[x.id]; }); },
    progress: function () { var o = load(), all = items(); var got = all.filter(function (m) { return o[m.id]; }).length; return { got: got, total: all.length, done: all.length > 0 && got === all.length }; },
    reset: function () { save({}); },
  };
})();
