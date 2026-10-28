/* 社内ツール共通の入口 — 共通パスワードを 1 回入れれば、社内ツール(工場マップ・顧客人事DB・共有動画・エンドエフェクタ事例DB)をまとめて開ける。
 * パスワードを入れる場所は members/index.html だけ。ここで入れたパスワードをこの端末に置き、各ツールはそれで自分のデータを復号する
 * (未入力・合わないときは toEntry() で入口へ送り、解除後に元のツールへ戻す)
 * (データごとに salt が違うので、鍵ではなくパスワードを共有する。データが更新されても入れ直し不要)。
 * 保存先: sessionStorage(このタブの間)、「この端末で記憶する」なら localStorage にも。ロックは全ツール共通。
 */
(function () {
  'use strict';
  var PW = 'lx_members_pw_v1';
  var TOOL_KEYS = ['lx_factory_key_v1', 'lx_people_key_v1', 'lx_videos_key_v1', 'lx_eoat_key_v1'];  // 各ツールが復号鍵をキャッシュする場所
  function password() { try { return sessionStorage.getItem(PW) || localStorage.getItem(PW); } catch (e) { return null; } }
  function remembered() { try { return !!localStorage.getItem(PW); } catch (e) { return false; } }
  function save(pw, persist) { try { sessionStorage.setItem(PW, pw); if (persist) localStorage.setItem(PW, pw); } catch (e) { /* 保存不可 */ } }
  function forget() {
    try { [PW].concat(TOOL_KEYS).forEach(function (k) { sessionStorage.removeItem(k); localStorage.removeItem(k); }); } catch (e) { /* noop */ }
  }
  // 入口へ移動(解除したらこのツールに戻れるよう ?next= にツールのフォルダと # を付ける)
  function toEntry() {
    var m = location.pathname.match(/\/([\w-]+)\/(index\.html)?$/);
    location.replace('../index.html' + (m ? '?next=' + encodeURIComponent(m[1] + '/index.html' + location.hash) : ''));
  }
  window.lxMembers = { password: password, remembered: remembered, save: save, forget: forget, toEntry: toEntry };
})();
