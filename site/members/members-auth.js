/* 社内ツール共通の入口 — 共通パスワードを 1 回入れれば、社内ツール(工場マップ・顧客人事DB)をまとめて開ける。
 * members/index.html か各ツールの入口で入れたパスワードをこの端末に置き、各ツールはそれで自分のデータを復号する
 * (データごとに salt が違うので、鍵ではなくパスワードを共有する。データが更新されても入れ直し不要)。
 * 保存先: sessionStorage(このタブの間)、「この端末で記憶する」なら localStorage にも。ロックは全ツール共通。
 */
(function () {
  'use strict';
  var PW = 'lx_members_pw_v1';
  var TOOL_KEYS = ['lx_factory_key_v1', 'lx_people_key_v1'];  // 各ツールが復号鍵をキャッシュする場所
  function password() { try { return sessionStorage.getItem(PW) || localStorage.getItem(PW); } catch (e) { return null; } }
  function remembered() { try { return !!localStorage.getItem(PW); } catch (e) { return false; } }
  function save(pw, persist) { try { sessionStorage.setItem(PW, pw); if (persist) localStorage.setItem(PW, pw); } catch (e) { /* 保存不可 */ } }
  function forget() {
    try { [PW].concat(TOOL_KEYS).forEach(function (k) { sessionStorage.removeItem(k); localStorage.removeItem(k); }); } catch (e) { /* noop */ }
  }
  window.lxMembers = { password: password, remembered: remembered, save: save, forget: forget };
})();
