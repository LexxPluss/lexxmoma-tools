/* LexxMoMa Tools 共通テーマ (light / dark)
 * 使い方: <head> 内、CSS より前に同期読込する(描画前に適用して色のちらつきを防ぐ)
 *   <script src="../assets/theme.js"></script>   (階層に応じて assets/ や ../../assets/)
 *   - 既定は light。OS の設定には追従しない
 *   - <html data-theme="light|dark"> を常に明示するので、ページ側の CSS は :root[data-theme="dark"] を書けばよい
 *     (既存の @media (prefers-color-scheme: dark){ :root:not([data-theme="light"]) … } は light 固定時に効かない)
 *   - 切替ボタン: data-lx-theme-toggle を付けた要素をクリックで切替。aria-pressed を自動で更新
 *     標準ボタン: <button type="button" class="lx-theme-btn" data-lx-theme-toggle aria-label="ライト / ダーク切替"></button>
 *     (中身が空なら ☀/☾ アイコンを入れる。色は親の color を継承、大きさは --lx-theme-btn で変更可)
 *   - 共通ロゴ: <a href="…/index.html" title="LexxMoMa Tools のトップへ"><img class="lx-logo" src="…/assets/lexxpluss-logo.png" alt="LexxPluss"></a>
 *     (全ページ同じ画像・高さ 28px・白い角丸の下地・トップへのリンク。濃い色のヘッダーや dark でも読めるよう下地は常に白)
 *   - 共通ヘッダー(ROI 計算ツールの見た目に統一): 白地 + 下端 3px のブランド色の線 + ロゴ・LexxMoMa・ツール名
 *     <header class="lx-hdr"><div class="lx-title"><a class="lx-brand" href="…/index.html" title="LexxMoMa Tools のトップへ">
 *       <img class="lx-logo" …><span class="lx-wordmark">LexxMoMa</span></a><h1 class="lx-tool">ツール名</h1></div> … </header>
 *     間隔: ロゴ〜LexxMoMa 18px、LexxMoMa〜ツール名 10px
 *     色はページの CSS で --lx-brand / --lx-hdr-bg / --lx-hdr-text を上書きできる
 *   - JS から: lxTheme.get() / lxTheme.set("dark") / lxTheme.toggle()
 *     変更は "lx-theme" イベント(document)で通知。canvas など CSS 以外で色を持つ描画はこれで再描画する
 *   - 選択は localStorage("lx_theme") に保存し、全ページ・他タブで共有
 */
(function () {
  var KEY = "lx_theme";
  var root = document.documentElement;

  function read() {
    try { return localStorage.getItem(KEY) === "dark" ? "dark" : "light"; } catch (e) { return "light"; }
  }
  var ICONS = '<svg class="lx-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' +
    '<svg class="lx-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>';
  // ヘッダーの文字(LexxMoMa・ツール名)はどのページでも同じ字形にするため、Web フォントを使わず OS の標準フォントに固定する
  var HDR_FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI","Yu Gothic",Meiryo,system-ui,sans-serif';
  var CSS = '.lx-theme-btn{display:inline-grid;place-items:center;width:var(--lx-theme-btn,32px);height:var(--lx-theme-btn,32px);padding:0;margin:0;border:1px solid rgba(128,128,128,.35);border-radius:8px;background:transparent;color:inherit;cursor:pointer;flex:none;vertical-align:middle}' +
    '.lx-theme-btn:hover{background:rgba(128,128,128,.14)}' +
    '.lx-theme-btn:focus-visible{outline:2px solid #0068B7;outline-offset:2px}' +
    '.lx-theme-btn svg{width:18px;height:18px}' +
    '.lx-theme-btn .lx-moon,[data-theme="dark"] .lx-theme-btn .lx-sun{display:none}' +
    '[data-theme="dark"] .lx-theme-btn .lx-moon{display:block}' +
    '.lx-hdr{display:flex;align-items:center;gap:20px;padding:12px 24px;background:var(--lx-hdr-bg,#fff);color:var(--lx-hdr-text,#1F2933);border-bottom:3px solid var(--lx-brand,#0068B7);font-family:' + HDR_FONT + '}' +
    '[data-theme="dark"] .lx-hdr{--lx-brand:#5aa8e6;--lx-hdr-bg:#171f26;--lx-hdr-text:#e7edf2}' +
    '.lx-title{display:flex;align-items:center;gap:10px;min-width:0}' +
    '.lx-brand{display:flex;align-items:center;gap:18px;min-width:0;color:inherit;text-decoration:none;white-space:nowrap}' +
    '.lx-wordmark{font-family:' + HDR_FONT + '!important;color:var(--lx-brand,#0068B7);font-weight:800!important;font-size:20px!important;letter-spacing:.02em!important;line-height:1.2!important}' +
    '.lx-tool{font-family:' + HDR_FONT + '!important;margin:0;font-size:16px!important;font-weight:600!important;line-height:1.3;white-space:nowrap;color:inherit}' +
    '.lx-hdr .lx-theme-btn{color:var(--lx-hdr-text,#1F2933)}' +
    '@media (max-width:600px){.lx-hdr{padding:10px 16px;gap:12px}.lx-wordmark{font-size:17px}.lx-tool{font-size:14px}}' +
    '.lx-logo{height:28px!important;width:auto!important;max-width:none!important;display:block;box-sizing:content-box!important;padding:3px 6px!important;border-radius:6px!important;background:#fff!important}';

  function sync() {
    var dark = root.getAttribute("data-theme") === "dark";
    var btns = document.querySelectorAll("[data-lx-theme-toggle]");
    for (var i = 0; i < btns.length; i++) {
      if (!btns[i].firstElementChild && btns[i].classList.contains("lx-theme-btn")) btns[i].innerHTML = ICONS;
      if (!btns[i].title) btns[i].title = "ライト / ダーク切替";
      btns[i].setAttribute("aria-pressed", dark ? "true" : "false");
    }
  }
  function apply(theme, save) {
    root.setAttribute("data-theme", theme);
    if (save) { try { localStorage.setItem(KEY, theme); } catch (e) { /* 保存不可の環境 */ } }
    sync();
    var ev;
    try { ev = new CustomEvent("lx-theme", { detail: { theme: theme } }); }
    catch (e) { ev = document.createEvent("CustomEvent"); ev.initCustomEvent("lx-theme", false, false, { theme: theme }); }
    document.dispatchEvent(ev);
  }

  window.lxTheme = {
    get: function () { return root.getAttribute("data-theme") === "dark" ? "dark" : "light"; },
    set: function (theme) { apply(theme === "dark" ? "dark" : "light", true); },
    toggle: function () { this.set(this.get() === "dark" ? "light" : "dark"); }
  };

  root.setAttribute("data-theme", read());
  var st = document.createElement("style");
  st.textContent = CSS;
  (document.head || root).appendChild(st);

  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest("[data-lx-theme-toggle]");
    if (t) { e.preventDefault(); window.lxTheme.toggle(); }
  });
  // 他のタブで切り替えたら追従
  window.addEventListener("storage", function (e) { if (e.key === KEY) apply(read(), false); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sync);
  else sync();
})();
