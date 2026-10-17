/* 共有動画(LexxPluss 社内) — 社内で見せたい YouTube 動画の一覧。暗号化した一覧を共通パスワードで復号して並べ、ページ内で再生する。
 * データ: data.enc.json = PBKDF2-SHA256 → AES-256-GCM(scripts/build_member_videos.py が作成。工場マップと同じ方式)
 *   中身: { updated: "YYYY-MM-DD", videos: [{ id: YouTube動画ID, title, desc?, cat?, date? }] }
 * 再生は youtube-nocookie.com の埋め込み。URL には動画 ID だけを載せる(#v=ID)。
 * 依存: なし(バニラ JS)。
 */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var KEY_STORE = 'lx_videos_key_v1';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function b64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function ub64(u) { var s = ''; u = new Uint8Array(u); for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  function track(p, t) { try { if (window.lxTrack) window.lxTrack(p, t); } catch (e) { /* 計測不可 */ } }

  // ---------------------------------------------------------------- 入口(工場マップ・顧客人事DBと同じ)
  function loadEnc() {
    if (window.VIDEOS_ENC) return Promise.resolve(window.VIDEOS_ENC);
    return fetch('data.enc.json', { cache: 'no-cache' }).then(function (r) {
      if (r.status === 404) return null;  // まだ一覧を作っていない → 空の一覧として開く
      if (!r.ok) throw new Error('data');
      return r.json();
    });
  }
  function deriveKey(pw, enc) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(enc.salt), iterations: enc.iter }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
    });
  }
  function decrypt(key, enc) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct)).then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); });
  }
  function storedKey() {
    var s = null;
    try { s = sessionStorage.getItem(KEY_STORE) || localStorage.getItem(KEY_STORE); } catch (e) { s = null; }
    if (!s) return Promise.resolve(null);
    var o; try { o = JSON.parse(s); } catch (e) { return Promise.resolve(null); }
    return crypto.subtle.importKey('raw', b64(o.k), { name: 'AES-GCM' }, true, ['decrypt']).then(function (k) { return { key: k, salt: o.salt }; });
  }
  function saveKey(key, salt, persist) {
    return crypto.subtle.exportKey('raw', key).then(function (raw) {
      var v = JSON.stringify({ k: ub64(raw), salt: salt });
      try { sessionStorage.setItem(KEY_STORE, v); if (persist) localStorage.setItem(KEY_STORE, v); } catch (e) { /* 保存不可 */ }
    });
  }
  function forgetKey() { try { sessionStorage.removeItem(KEY_STORE); localStorage.removeItem(KEY_STORE); } catch (e) { /* noop */ } }
  function gateMsg(msg) { $('#gateMsg').textContent = msg; }

  function viaShared(enc) {
    var pw = window.lxMembers.password();
    if (!pw) { window.lxMembers.toEntry(); return; }
    if (!enc) { start({ videos: [] }); return; }
    return deriveKey(pw, enc).then(function (key) {
      return decrypt(key, enc).then(function (data) { return saveKey(key, enc.salt, window.lxMembers.remembered()).then(function () { start(data); }); });
    });
  }

  if (!window.crypto || !crypto.subtle) {
    gateMsg('このブラウザでは開けません(https で開いてください)。');
  } else {
    loadEnc().then(function (enc) {
      if (!enc) return viaShared(null);
      return storedKey().then(function (s) {
        if (!s || s.salt !== enc.salt) { forgetKey(); return viaShared(enc); }
        return decrypt(s.key, enc).then(start, function () { forgetKey(); return viaShared(enc); });
      });
    }).catch(function (err) {
      if (err && err.message === 'data') return gateMsg('データを読み込めませんでした。時間をおいて再度お試しください。');
      if (err && err.name === 'OperationError') { window.lxMembers.forget(); window.lxMembers.toEntry(); return; }  // 共通パスワードが変わった → 入れ直してもらう
      gateMsg('開けませんでした。ページを読み込み直してください。');
    });
  }

  // ---------------------------------------------------------------- 一覧と再生
  var VIDEOS = [], cat = '', query = '';

  function thumb(id) { return 'https://i.ytimg.com/vi/' + encodeURIComponent(id) + '/hqdefault.jpg'; }
  function watchUrl(id) { return 'https://www.youtube.com/watch?v=' + encodeURIComponent(id); }
  function embedUrl(id) { return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?rel=0&autoplay=1'; }
  function byId(id) { for (var i = 0; i < VIDEOS.length; i++) if (VIDEOS[i].id === id) return VIDEOS[i]; return null; }

  function start(data) {
    VIDEOS = (data && data.videos || []).filter(function (v) { return v && /^[\w-]{6,20}$/.test(v.id); });
    $('#gate').hidden = true; $('#app').hidden = false;
    $('#foot').textContent = '動画 ' + VIDEOS.length + ' 本' + (data && data.updated ? ' · 一覧の更新 ' + data.updated : '');
    $('#lock').addEventListener('click', function () { forgetKey(); window.lxMembers.forget(); location.hash = ''; window.lxMembers.toEntry(); });
    $('#q').addEventListener('input', function () { query = this.value.trim().toLowerCase(); render(); });
    $('#copyLink').addEventListener('click', function () {
      var btn = this;
      navigator.clipboard.writeText(location.href).then(function () { btn.textContent = 'コピーしました'; setTimeout(function () { btn.textContent = 'この動画へのリンクをコピー'; }, 1500); });
    });
    window.addEventListener('hashchange', fromHash);
    track('member/videos/open', '共有動画を開いた');
    chips(); render(); fromHash();
  }

  function chips() {
    var cats = [];
    VIDEOS.forEach(function (v) { if (v.cat && cats.indexOf(v.cat) < 0) cats.push(v.cat); });
    var box = $('#catChips');
    if (cats.length < 2) { box.hidden = true; return; }
    box.innerHTML = ['<button type="button" class="chip on" data-cat="">すべて</button>'].concat(cats.map(function (c) {
      return '<button type="button" class="chip" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    })).join('');
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      cat = b.getAttribute('data-cat');
      [].forEach.call(box.querySelectorAll('.chip'), function (x) { x.classList.toggle('on', x === b); });
      render();
    });
  }

  function render() {
    var list = VIDEOS.filter(function (v) {
      if (cat && v.cat !== cat) return false;
      if (query && ((v.title || '') + ' ' + (v.desc || '')).toLowerCase().indexOf(query) < 0) return false;
      return true;
    });
    var none = !VIDEOS.length;
    $('#empty').hidden = !none;
    $('.toolbar').hidden = none;
    $('#res').textContent = none ? '' : (list.length === VIDEOS.length ? VIDEOS.length + ' 本' : list.length + ' / ' + VIDEOS.length + ' 本');
    $('#grid').innerHTML = list.map(function (v) {
      return '<a class="card" href="#v=' + esc(v.id) + '">' +
        '<span class="thumb"><img src="' + esc(thumb(v.id)) + '" alt="" loading="lazy"><i>▶</i></span>' +
        '<b>' + esc(v.title || '(無題)') + '</b>' +
        ((v.cat || v.date) ? '<span class="meta">' + esc([v.cat, v.date].filter(Boolean).join(' · ')) + '</span>' : '') +
        '</a>';
    }).join('');
  }

  function fromHash() {
    var m = location.hash.match(/^#v=([\w-]+)/), v = m && byId(m[1]);
    if (!v) { $('#stage').hidden = true; $('#player').src = 'about:blank'; $('#player').removeAttribute('data-id'); return; }
    $('#stage').hidden = false;
    if ($('#player').getAttribute('data-id') !== v.id) { $('#player').src = embedUrl(v.id); $('#player').setAttribute('data-id', v.id); }
    $('#nowTitle').textContent = v.title || '(無題)';
    $('#nowMeta').textContent = [v.cat, v.date].filter(Boolean).join(' · ');
    $('#nowDesc').textContent = v.desc || '';
    $('#nowYt').href = watchUrl(v.id);
    $('#stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
    track('member/videos/play', v.title || v.id);
  }
})();
