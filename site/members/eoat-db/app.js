/* エンドエフェクタ事例データベース(社内・試験運用)
 * 入口: 社内ツール共通のパスワード(members-auth.js)。データ(data.enc.json)も画像(img/*.bin)も同じ鍵で復号する。
 * 画像の瞬時表示: 鍵は 1 回だけ導出 → 一覧用パックを Cache Storage に置き、必要な分から復号(Web Crypto, 1 枚数ミリ秒)→ Blob URL を LRU で保持。
 * 検索ロジックは search.js(DOM 非依存)。計測は member/eoat-db/...(入力内容は送らず件数だけ)。 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var b64 = function (s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  var ub64 = function (buf) { var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
  var S = window.EoatSearch;
  var KEY_STORE = 'lx_eoat_key_v1';
  var REVIEW_STORE = 'lx_eoat_reviews_v1';
  function track(p, t) { try { if (window.lxTrack) window.lxTrack('member/eoat-db/' + p, t || ''); } catch (e) { /* 計測不可 */ } }
  var T0 = performance.now();
  window.__eoat = { marks: {} };
  function mark(k) { window.__eoat.marks[k] = Math.round(performance.now() - T0); }

  // ---------------------------------------------------------------- 入口(顧客人事DBと同じ。入口が無い環境ではこの画面でパスワードを入れる)
  var ENC = null, KEY = null;
  function loadEnc() {
    if (ENC) return Promise.resolve(ENC);
    if (window.EOAT_ENC) { ENC = window.EOAT_ENC; return Promise.resolve(ENC); }
    return fetch('data.enc.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('data'); return r.json(); }).then(function (j) { ENC = j; return j; });
  }
  function deriveKey(pw, enc) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(enc.salt), iterations: enc.iter }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
    });
  }
  function decryptData(key, enc) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct)).then(function (buf) {
      if (enc.z !== 'deflate') return JSON.parse(new TextDecoder().decode(buf));
      if (typeof DecompressionStream === 'undefined') throw new Error('nozip');
      var ds = new DecompressionStream('deflate');
      var w = ds.writable.getWriter(); w.write(new Uint8Array(buf)); w.close();
      return new Response(ds.readable).text().then(function (txt) { return JSON.parse(txt); });
    });
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

  function openWith(pw, enc, persist) {
    return deriveKey(pw, enc).then(function (key) {
      return decryptData(key, enc).then(function (data) { KEY = key; return saveKey(key, enc.salt, persist).then(function () { start(data); }); });
    });
  }
  function viaShared(enc) {
    if (!window.lxMembers) {   // 入口が無い(プレビュー・単体で開いた): ここで入れる
      gateMsg('共通パスワードを入れてください。');
      var f = $('#gateForm'); f.hidden = false;
      f.onsubmit = function (e) {
        e.preventDefault(); $('#gateErr').textContent = ''; f.querySelector('button').disabled = true;
        openWith($('#gatePw').value, enc, false).catch(function () { $('#gateErr').textContent = 'パスワードが合いません。'; }).then(function () { f.querySelector('button').disabled = false; });
      };
      return;
    }
    var pw = window.lxMembers.password();
    if (!pw) { window.lxMembers.toEntry(); return; }
    return openWith(pw, enc, window.lxMembers.remembered());
  }
  if (!window.crypto || !crypto.subtle) {
    gateMsg('このブラウザでは開けません(https で開いてください)。');
  } else {
    loadEnc().then(function (enc) {
      return storedKey().then(function (s) {
        if (!s || s.salt !== enc.salt) { forgetKey(); return viaShared(enc); }
        return decryptData(s.key, enc).then(function (d) { KEY = s.key; start(d); }, function () { forgetKey(); return viaShared(enc); });
      });
    }).catch(function (err) {
      if (err && err.message === 'data') return gateMsg('データを読み込めませんでした。時間をおいて再度お試しください。');
      if (err && err.message === 'nozip') return gateMsg('このブラウザでは開けません(最新の Chrome / Safari / Edge で開いてください)。');
      if (err && err.name === 'OperationError') { if (window.lxMembers) { window.lxMembers.forget(); window.lxMembers.toEntry(); } else viaShared(ENC); return; }
      gateMsg('開けませんでした。ページを読み込み直してください。');
    });
  }

  // ---------------------------------------------------------------- 画像の保管庫
  var IMG = {
    packs: {},        // name → ArrayBuffer
    loading: {},      // name → Promise
    urls: {},         // 画像 id → Blob URL(一覧用)
    detail: {},       // 画像 id → Blob URL(詳細用)
    order: [],        // LRU
    MAX: 1500,
    packOf: function (im) { return im.thumb && im.thumb.pack; },
    cache: function () { return (window.caches && caches.open) ? caches.open('eoat-img-v1') : Promise.resolve(null); },
    fetchBin: function (path) {
      // プレビュー(preview.py で作った一式)ではバイナリを置けない場所向けに、パックを base64 のテキスト(.txt)で持つ
      if (D && D.preview) return fetch(path + '.txt').then(function (r) { if (!r.ok) throw new Error(path); return r.text(); }).then(function (t) { return b64(t.trim()).buffer; });
      // Cache Storage にあればネットワークを使わない(2 回目以降の訪問)。無ければ取得して保存
      return IMG.cache().then(function (c) {
        if (!c) return fetch(path).then(function (r) { if (!r.ok) throw new Error(path); return r.arrayBuffer(); });
        return c.match(path).then(function (hit) {
          if (hit) return hit.arrayBuffer();
          return fetch(path).then(function (r) { if (!r.ok) throw new Error(path); c.put(path, r.clone()).catch(function () { }); return r.arrayBuffer(); });
        });
      });
    },
    loadPack: function (name) {
      if (IMG.packs[name]) return Promise.resolve(IMG.packs[name]);
      if (!IMG.loading[name]) IMG.loading[name] = IMG.fetchBin('img/thumb/' + name).then(function (buf) { IMG.packs[name] = buf; delete IMG.loading[name]; return buf; });
      return IMG.loading[name];
    },
    decrypt: function (rec) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, KEY, rec.ct); },
    thumb: function (im) {
      if (IMG.urls[im.id]) return Promise.resolve(IMG.urls[im.id]);
      return IMG.loadPack(im.thumb.pack).then(function (buf) {
        return IMG.decrypt(S.sliceRecord(buf, im.thumb.off, im.thumb.len)).then(function (plain) {
          var u = URL.createObjectURL(new Blob([plain], { type: 'image/webp' }));
          IMG.urls[im.id] = u; IMG.order.push(im.id);
          if (IMG.order.length > IMG.MAX) { var old = IMG.order.shift(); URL.revokeObjectURL(IMG.urls[old]); delete IMG.urls[old]; }
          return u;
        });
      });
    },
    detailUrl: function (im) {
      if (IMG.detail[im.id]) return Promise.resolve(IMG.detail[im.id]);
      if (!im.detail || !im.detail.file) return IMG.thumb(im);
      return IMG.fetchBin('img/detail/' + im.detail.file).then(function (buf) {
        return IMG.decrypt(S.sliceRecord(buf, 0, buf.byteLength)).then(function (plain) {
          var u = URL.createObjectURL(new Blob([plain], { type: 'image/webp' }));
          IMG.detail[im.id] = u; return u;
        });
      });
    },
    prefetchDetail: function (c) { (c.images || []).slice(0, 3).forEach(function (im) { IMG.detailUrl(im).catch(function () { }); }); },
    // いまの検索結果のパックを先に、残りはアイドル時に(モバイル回線では表示分と次のページ分だけ)
    warm: function (list) {
      // 最初の画面(24 枚)のパックを出てくる順に取り、それが済んでから残り(次のページ分 → 全部)を背景で取る。遅い回線でも最初の画面を先に出す
      var first = [], later = [], seen = {};
      list.forEach(function (c, i) { var im = (c.images || [])[0]; if (!im || !im.thumb || !im.thumb.pack || seen[im.thumb.pack]) return; seen[im.thumb.pack] = 1; (i < PAGE ? first : later).push(im.thumb.pack); });
      var p = first.reduce(function (q, n) { return q.then(function () { return IMG.loadPack(n); }); }, Promise.resolve());
      var slow = navigator.connection && (navigator.connection.saveData || /2g|3g/.test(navigator.connection.effectiveType || ''));
      p.then(function () {
        var rest = later.concat((D.packs || []).filter(function (n) { return !seen[n]; }));
        if (slow) rest = later;
        var idle = window.requestIdleCallback || function (fn) { setTimeout(fn, 500); };
        idle(function () { rest.reduce(function (q, n) { return q.then(function () { return IMG.loadPack(n).catch(function () { }); }); }, Promise.resolve()); });
      }).catch(function () { });
      return p;
    }
  };

  // ---------------------------------------------------------------- 本体
  var D, TAX, ALL = [], BYID = {}, LIST = [], F, WORDS = [], SHOWN = 24, PAGE = 24, CUR = null, PR_COLOR = {}, PR_GROUP = {}, GROUP_LABEL = {}, PICT = {};
  var reviews = {};
  try { reviews = JSON.parse(localStorage.getItem(REVIEW_STORE) || '{}'); } catch (e) { reviews = {}; }

  // 掴み方のピクトグラム(画像が無いとき・傾向の行に使う)
  PICT.parallel = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 6h20v10H14z"/><path d="M18 16v16l-4 6M30 16v16l4 6"/><path d="M20 26h8"/></svg>';
  PICT.vacuum = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6h8v12h-8z"/><path d="M10 30c0-6 6-12 14-12s14 6 14 12z"/><path d="M8 38h32"/></svg>';
  PICT.magnet = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v16a12 12 0 0 0 24 0V8"/><path d="M12 8h8v12h-8zM28 8h8v12h-8z"/><path d="M8 42h32"/></svg>';
  PICT.soft = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 6h16v8H16z"/><path d="M18 14c-6 8-8 16-2 24M30 14c6 8 8 16 2 24M24 14v10"/></svg>';
  PICT.combo = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6h24v8H12z"/><path d="M16 14v14l-4 8M24 14v18"/><path d="M28 30c0-4 3-6 6-6s6 2 6 6"/></svg>';
  PICT.tool = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6h12v10H18z"/><path d="M24 16v14"/><path d="M14 30h20l-4 12h-12z"/></svg>';
  var GCOL = { mech: 'var(--g-mech)', vacuum: 'var(--g-vacuum)', magnet: 'var(--g-magnet)', soft: 'var(--g-soft)', combo: 'var(--g-combo)', process: 'var(--g-process)' };
  var CT = {};
  var RC_LABEL = { '協働': '協働', '産業用': '産業用' };

  function start(data) {
    mark('decrypted');
    D = data; TAX = data.taxonomy; CT = TAX.case_types || {};
    ALL = S.prepare(data.cases, TAX);
    ALL.forEach(function (c) { BYID[c.id] = c; });
    TAX.principles.forEach(function (g) { GROUP_LABEL[g.key] = g.label; g.items.forEach(function (it) { PR_GROUP[it.key] = g.key; PR_COLOR[it.key] = GCOL[g.key] || 'var(--brand)'; }); });
    F = S.decodeHash(location.hash);
    $('#q').value = F.q || '';
    $('#sort').value = F.sort || 'rel';
    $('#mob').checked = !!F.mob;
    $('#gate').hidden = true; $('#app').hidden = false;
    $('#hdrCount').textContent = ALL.length.toLocaleString('ja-JP') + ' 件 · ' + (D.built_at || '');
    bind();
    run(true);
    track('open', 'エンドエフェクタ事例DBを開いた');
    if (F.c && BYID[F.c]) openCase(F.c, true);
  }

  function labels(kind, keys) { return (keys || []).map(function (k) { return S.labelOf(TAX, kind, k); }); }

  // ---------------------------------------------------------------- 検索の実行
  function run(first) {
    var parsed = S.parseQuery(F.q, TAX);
    // 自由入力から得たチップは、外されたもの(F._off)を除いて絞り込みに足す
    var off = F._off || {};
    var eff = JSON.parse(JSON.stringify(F));
    parsed.chips.forEach(function (ch) {
      var id = ch.kind + ':' + ch.key;
      if (off[id]) return;
      var k = { category: 'cat', material: 'mat', principle: 'pr', task: 'task', payload: 'pl', property: 'prop' }[ch.kind];
      if (k) { if (eff[k].indexOf(ch.key) < 0) eff[k].push(ch.key); }
      else if (ch.kind === 'robot') { if (ch.key === 'mobile') eff.mob = true; else if (!eff.rc) eff.rc = ch.key; }
    });
    WORDS = parsed.words;
    var r = S.search(ALL, eff, WORDS);
    LIST = r.list; SHOWN = PAGE;
    renderParsed(parsed, off);
    renderTabs(eff);
    renderFacets(eff);
    renderTrend(eff);
    renderRes(r.relaxed, eff);
    renderGrid();
    IMG.warm(LIST.slice(0, 60)).then(function () { if (first) mark('firstPackReady'); }).catch(function () { });
    var h = S.encodeHash(F);
    if (h !== location.hash && !(h === '' && !location.hash)) history.replaceState(null, '', location.pathname + location.search + h);
    window.__eoat.eff = eff; window.__eoat.list = LIST;
  }

  function renderParsed(parsed, off) {
    var el = $('#parsed');
    if (!parsed.chips.length && !parsed.words.length) { el.innerHTML = ''; return; }
    var KIND = { category: 'ワーク', material: '材料', principle: '掴み方', task: '作業', payload: '重さ', property: '性質', robot: 'ロボット' };
    var h = '<span class="lbl">読み取り:</span>';
    parsed.chips.forEach(function (ch) {
      var id = ch.kind + ':' + ch.key; if (off[id]) return;
      h += '<span class="pchip"><span class="k">' + esc(KIND[ch.kind] || ch.kind) + '</span><b>' + esc(ch.label) + '</b><button type="button" data-off="' + esc(id) + '" aria-label="' + esc(ch.label) + ' を外す">×</button></span>';
    });
    parsed.words.forEach(function (w) { h += '<span class="pchip word"><span class="k">語</span><b>' + esc(w) + '</b></span>'; });
    el.innerHTML = h;
    $$('[data-off]', el).forEach(function (b) { b.onclick = function () { F._off = F._off || {}; F._off[b.dataset.off] = 1; run(); track('chip/off'); }; });
  }

  function renderTabs(eff) {
    var cnt = S.facetCounts(ALL, eff, 'rc', function (c) { return c.robot.class || '不明'; });
    $('#nAll').textContent = Object.keys(cnt).reduce(function (a, k) { return a + cnt[k]; }, 0);
    $('#nInd').textContent = cnt['産業用'] || 0; $('#nCob').textContent = cnt['協働'] || 0;
    $$('#rcTabs button').forEach(function (b) { b.classList.toggle('on', (F.rc || '') === b.dataset.rc); b.setAttribute('aria-selected', (F.rc || '') === b.dataset.rc); });
    var mc = S.facetCounts(ALL, eff, 'mob', function (c) { return c.robot.is_mobile_manipulator ? 1 : 0; });
    $('#nMob').textContent = '(' + (mc[1] || 0) + ')';
    var nf = ['cat', 'mat', 'pl', 'pr', 'task', 'ct', 'rg', 'ind', 'prop'].reduce(function (a, k) { return a + (F[k] || []).length; }, 0);
    $('#nFilters').textContent = nf ? nf : '';
  }

  // ---------------------------------------------------------------- 絞り込み
  var FACET_OPEN = {};
  function renderFacets(eff) {
    var html = '';
    function sect(key, title, hint, opts, cnt, cls) {
      var vis = opts.filter(function (o) { return (cnt[o.key] || 0) > 0 || (F[key] || []).indexOf(o.key) >= 0; });
      if (!vis.length) return;
      var limit = FACET_OPEN[key] ? 999 : 9;
      html += '<section class="facet" data-key="' + key + '"><h3>' + esc(title) + (hint ? ' <span class="hint">' + esc(hint) + '</span>' : '') + '</h3><div class="opts">';
      vis.slice(0, limit).forEach(function (o) {
        var on = (F[key] || []).indexOf(o.key) >= 0;
        html += '<button type="button" class="fo ' + (on ? 'on ' : '') + (o.cls || '') + (cls || '') + '" data-f="' + key + '" data-v="' + esc(o.key) + '">' + (o.color ? '<i class="sw" style="background:' + o.color + '"></i>' : '') + esc(o.label) + '<span class="n">' + (cnt[o.key] || 0) + '</span></button>';
      });
      html += '</div>';
      if (vis.length > limit) html += '<button type="button" class="moreopt" data-more="' + key + '">あと ' + (vis.length - limit) + ' 件を見る</button>';
      else if (FACET_OPEN[key] && vis.length > 9) html += '<button type="button" class="moreopt" data-more="' + key + '">たたむ</button>';
      html += '</section>';
    }
    // ワーク(大分類 → 小分類)
    var cc = S.facetCounts(ALL, eff, 'cat', function (c) { return c.workpiece.categories; });
    var catOpts = [];
    TAX.categories.forEach(function (g) {
      var items = g.items.filter(function (it) { return cc[it.key] || (F.cat.indexOf(it.key) >= 0); });
      if (!items.length) return;
      items.forEach(function (it) { catOpts.push({ key: it.key, label: it.label, cls: 'sub ' }); });
      catOpts[catOpts.length - items.length].label = g.label + ' › ' + items[0].label; catOpts[catOpts.length - items.length].cls = 'sub ';
    });
    sect('cat', 'ワーク', '', catOpts, cc);
    var pc = S.facetCounts(ALL, eff, 'pl', function (c) { return c.payload_class; });
    sect('pl', '可搬重量帯', 'LexxMoMa は 20 kg', TAX.payload_classes.map(function (p) { return { key: p, label: p, cls: (p === '≤5kg' || p === '5–20kg') ? 'hi ' : '' }; }), pc);
    var pr = S.facetCounts(ALL, eff, 'pr', function (c) { return c.end_effector.principles.concat(c._prGroups); });
    var prOpts = [];
    TAX.principles.forEach(function (g) {
      if (!pr[g.key] && F.pr.indexOf(g.key) < 0) return;
      prOpts.push({ key: g.key, label: g.label, cls: 'group ', color: GCOL[g.key] });
      g.items.forEach(function (it) { if (pr[it.key] || F.pr.indexOf(it.key) >= 0) prOpts.push({ key: it.key, label: it.label, cls: 'sub ' }); });
    });
    sect('pr', '掴み方', '', prOpts, pr);
    var tc = S.facetCounts(ALL, eff, 'task', function (c) { return c.tasks; });
    sect('task', '作業', '', TAX.tasks.map(function (t) { return { key: t.key, label: t.label }; }).sort(function (a, b) { return (tc[b.key] || 0) - (tc[a.key] || 0); }), tc);
    var mc = S.facetCounts(ALL, eff, 'mat', function (c) { return c.workpiece.materials; });
    sect('mat', '材料', '', TAX.materials.map(function (m) { return { key: m.key, label: m.label }; }).sort(function (a, b) { return (mc[b.key] || 0) - (mc[a.key] || 0); }), mc);
    var ctc = S.facetCounts(ALL, eff, 'ct', function (c) { return c.case_type; });
    sect('ct', '種別', '', Object.keys(CT).map(function (k) { return { key: k, label: CT[k] }; }), ctc);
    var rc = S.facetCounts(ALL, eff, 'rg', function (c) { return c.region || 'その他'; });
    sect('rg', '地域', '', TAX.regions.map(function (r) { return { key: r, label: r }; }), rc);
    var ic = S.facetCounts(ALL, eff, 'ind', function (c) { return c.industry || []; });
    sect('ind', '業種', '', Object.keys(ic).sort(function (a, b) { return ic[b] - ic[a]; }).map(function (k) { return { key: k, label: k }; }), ic);
    var ppc = S.facetCounts(ALL, eff, 'prop', function (c) { return c.workpiece.properties || []; });
    sect('prop', 'ワークの性質', '', Object.keys(ppc).map(function (k) { return { key: k, label: S.labelOf(TAX, 'property', k) }; }), ppc);
    $('#facetList').innerHTML = html;
    $$('#facetList .fo').forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.f, v = b.dataset.v, i = F[k].indexOf(v);
        if (i >= 0) F[k].splice(i, 1); else F[k].push(v);
        if (i < 0) track('facet/' + k, v);
        run();
      };
    });
    $$('#facetList [data-more]').forEach(function (b) { b.onclick = function () { FACET_OPEN[b.dataset.more] = !FACET_OPEN[b.dataset.more]; renderFacets(window.__eoat.eff); }; });
  }

  // ---------------------------------------------------------------- 掴み方の傾向
  function renderTrend(eff) {
    var base = S.applyWords(S.applyFilters(ALL, Object.assign({}, eff, { pr: [] })), WORDS);   // 掴み方の絞り込みは外して分布を見る
    var t = S.trend(base, TAX);
    var el = $('#trendBars');
    $('#trendNote').textContent = t.total ? t.total + ' 件の内訳。棒を押すとその掴み方だけに絞る' : '';
    if (!t.total) { el.innerHTML = '<div class="trend-empty">この条件の事例はまだありません。</div>'; return; }
    el.innerHTML = t.groups.map(function (g) {
      var on = eff.pr.indexOf(g.key) >= 0;
      var sub = g.sub.slice(0, 3).map(function (s) { return s.label + ' ' + s.n; }).join(' · ');
      var rep = g.rep && g.rep.images[0];
      return '<button type="button" class="tb' + (on ? ' on' : '') + '" data-g="' + g.key + '" style="--c:' + GCOL[g.key] + '">' +
        '<span class="tb-img">' + (rep ? '<img alt="" data-img="' + rep.id + '" data-pack="' + esc(rep.thumb.pack) + '">' : '<span class="pict">' + (PICT[g.pictogram] || '') + '</span>') + '</span>' +
        '<span class="tb-main"><span class="tb-line"><span class="tb-name">' + esc(g.label) + '</span><span class="tb-pct">' + g.pct + '%</span><span class="tb-n">' + g.n + ' 件</span><span class="tb-sub">' + esc(sub) + '</span></span>' +
        '<span class="tb-bar"><i style="width:' + Math.max(2, g.pct) + '%"></i></span></span></button>';
    }).join('');
    $$('.tb', el).forEach(function (b) {
      b.onclick = function () { var g = b.dataset.g, i = F.pr.indexOf(g); if (i >= 0) F.pr.splice(i, 1); else F.pr = [g]; track('trend/' + g, GROUP_LABEL[g]); run(); };
    });
    t.groups.forEach(function (g) { if (g.rep && g.rep.images[0]) showImg($('[data-img="' + g.rep.images[0].id + '"]', el), g.rep.images[0]); });
  }

  function renderRes(relaxed, eff) {
    var parts = [LIST.length.toLocaleString('ja-JP') + ' 件'];
    if (relaxed === 'words') parts.push('<span class="relaxed">語での一致が無いので、条件だけで表示しています</span>');
    if (relaxed === 'filters') parts.push('<span class="relaxed">条件に合う事例が無いので、近い順に全件を表示しています</span>');
    $('#res').innerHTML = parts.join(' ');
    if (F.q) track('search', String(LIST.length));
  }

  // ---------------------------------------------------------------- 一覧
  var IO = ('IntersectionObserver' in window) ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { var img = e.target, im = img.__im; IO.unobserve(img); if (im) showImg(img, im); } });
  }, { rootMargin: '600px 0px' }) : null;

  function showImg(img, im) {
    if (!img || !im) return;
    IMG.thumb(im).then(function (u) { img.onload = function () { img.classList.add('ok'); }; img.src = u; if (img.complete && img.naturalWidth) img.classList.add('ok'); }).catch(function () { img.classList.remove('ok'); });
  }

  function cardHtml(c) {
    var im = c.images[0];
    var g = c._prGroups[0];
    var pills = '<span class="pill g" style="--c:' + PR_COLOR[c.end_effector.principles[0]] + '">' + esc(S.labelOf(TAX, 'principle', c.end_effector.principles[0])) + '</span>';
    if (c.robot.class) pills += '<span class="pill rc-' + c.robot.class + '">' + esc(c.robot.class) + '</span>';
    if (c.robot.is_mobile_manipulator) pills += '<span class="pill mob">移動</span>';
    pills += '<span class="pill">' + esc(c.payload_class) + '</span>';
    var bbox = '';
    if (im && im.hand_bbox) { var b = im.hand_bbox; bbox = '<span class="bbox" style="left:' + b[0] * 100 + '%;top:' + b[1] * 100 + '%;width:' + b[2] * 100 + '%;height:' + b[3] * 100 + '%"></span>'; }
    return '<button type="button" class="card" data-id="' + esc(c.id) + '" aria-label="' + esc(c.title_ja) + '">' +
      '<span class="im">' + (im ? '<img alt="" data-img="' + im.id + '">' : '') + '<span class="pict">' + (PICT[(TAX.principles.filter(function (x) { return x.key === g; })[0] || {}).pictogram] || '') + '</span>' + bbox +
      (c.images.length > 1 ? '<span class="n-img">' + c.images.length + ' 枚</span>' : '') + '</span>' +
      '<span class="bd"><span class="t">' + esc(c.title_ja) + '</span><span class="pills">' + pills + '</span>' +
      '<span class="src">' + esc(CT[c.case_type] || c.case_type) + ' · ' + esc(c.region || '') + ' · ' + esc(c.sources[0].publisher || '') + '</span></span></button>';
  }

  function renderGrid() {
    var grid = $('#grid');
    var items = LIST.slice(0, SHOWN);
    grid.innerHTML = items.length ? items.map(cardHtml).join('') : '<div class="empty">条件に合う事例がありません。</div>';
    $('#more').hidden = LIST.length <= SHOWN;
    $$('.card', grid).forEach(function (b, i) {
      var c = items[i];
      b.onclick = function () { openCase(c.id); track('case/open', c.title_ja); };
      b.onmouseenter = function () { IMG.prefetchDetail(c); };
      b.onfocus = b.onmouseenter;
      var img = $('img', b);
      if (img && c.images[0]) {
        img.__im = c.images[0];
        if (i < PAGE) showImg(img, c.images[0]); else if (IO) IO.observe(img); else showImg(img, c.images[0]);
      }
    });
    if (!window.__eoat.marks.firstGrid) {
      var first = $$('.card img', grid).slice(0, 24);
      var left = first.length;
      if (!left) mark('firstGrid');
      first.forEach(function (img) {
        var done = function () { if (--left === 0) mark('firstGrid'); };
        if (img.classList.contains('ok')) done(); else img.addEventListener('load', done, { once: true });
      });
    }
  }

  // ---------------------------------------------------------------- 詳細
  function openCase(id, silent) {
    var c = BYID[id]; if (!c) return;
    CUR = id;
    F.c = id;
    history.replaceState(null, '', location.pathname + location.search + S.encodeHash(F));
    var body = $('#drawerBody');
    var fs = c.fieldSources || {};
    function ev(key) {
      var s = fs[key]; if (!s) return '';
      var src = c.sources[s.source || 0] || c.sources[0];
      var txt = (s.evidence || []).join(' / ');
      return '<span class="ev">' + (s.method === 'inferred' ? '推定: ' : '') + esc(txt) + (txt ? ' ' : '') + '<a href="' + esc(src.url) + '" target="_blank" rel="noopener">出典 ↗</a></span>';
    }
    var wp = c.workpiece, ee = c.end_effector, rb = c.robot;
    var mass = wp.mass_kg ? (wp.mass_kg.min === wp.mass_kg.max ? wp.mass_kg.max + ' kg' : wp.mass_kg.min + '〜' + wp.mass_kg.max + ' kg') : '';
    var robot = [rb.maker, rb.model].filter(Boolean).join(' ') + (rb.class ? '(' + rb.class + (rb.payload_kg ? '・可搬 ' + rb.payload_kg + ' kg' : '') + ')' : '') + (rb.is_mobile_manipulator ? ' 移動マニピュレータ' : '');
    var it = c.interpretation && c.interpretation.lexxmoma_fit;
    var gal = c.images.map(function (im, i) {
      return '<figure><img alt="' + esc(im.alt_ja || c.title_ja) + '" data-dimg="' + im.id + '">' + (im.hand_bbox ? '<span class="bbox" style="left:' + im.hand_bbox[0] * 100 + '%;top:' + im.hand_bbox[1] * 100 + '%;width:' + im.hand_bbox[2] * 100 + '%;height:' + im.hand_bbox[3] * 100 + '%"></span>' : '') + '</figure>';
    }).join('');
    var credits = c.images.map(function (im, i) {
      return '<span>' + (c.images.length > 1 ? (i + 1) + ': ' : '') + esc(im.credit) + ' <a href="' + esc(im.source_page_url) + '" target="_blank" rel="noopener" data-track="source/open">元のページ ↗</a> <a href="' + esc(im.source_image_url) + '" target="_blank" rel="noopener" data-track="source/image">元の画像 ↗</a></span>';
    }).join('');
    var sim = ALL.filter(function (o) { return o.id !== c.id && o.workpiece.categories[0] === wp.categories[0] && (o._prGroups[0] === c._prGroups[0] || (o.tasks[0] && o.tasks[0] === c.tasks[0])); }).slice(0, 10);
    var rv = reviews[c.id] || {};
    body.innerHTML =
      '<h2 id="dTitle">' + esc(c.title_ja) + '</h2><div class="orig">' + esc(c.title_orig || '') + (c.year ? ' · ' + c.year : '') + '</div>' +
      '<div class="gal">' + gal + '</div><div class="credit">' + credits + '</div>' +
      '<p class="summary">' + esc(c.summary_ja) + '</p>' +
      '<div class="btnrow"><a class="btn p" href="' + esc(c.sources[0].url) + '" target="_blank" rel="noopener" data-track="source/open">出典ページを開く ↗</a>' +
      (c.video_url ? '<a class="btn" href="' + esc(c.video_url) + '" target="_blank" rel="noopener" data-track="source/video">動画 ↗</a>' : '') +
      (c.integrator && c.integrator.sier_db_id ? '<a class="btn" href="../../robot-sier-map/index.html#id=' + esc(c.integrator.sier_db_id) + '" target="_blank" rel="noopener" data-track="sier/open">SIer DB で ' + esc(c.integrator.name) + ' を見る ↗</a>' : '') + '</div>' +
      '<dl class="facts">' +
      '<dt>ワーク</dt><dd>' + esc(labels('category', wp.categories).join('・')) + (mass ? '(' + mass + ')' : '') + ev('workpiece.categories') + '</dd>' +
      (wp.materials.length ? '<dt>材料</dt><dd>' + esc(labels('material', wp.materials).join('・')) + ev('workpiece.materials') + '</dd>' : '') +
      (wp.properties && wp.properties.length ? '<dt>性質</dt><dd>' + esc(labels('property', wp.properties).join('・')) + ev('workpiece.properties') + '</dd>' : '') +
      (wp.presentation ? '<dt>置かれ方</dt><dd>' + esc(wp.presentation) + ev('workpiece.presentation') + '</dd>' : '') +
      '<dt>掴み方</dt><dd>' + esc(labels('principle', ee.principles).join('・')) + (ee.drive ? '(' + esc(ee.drive) + ')' : '') + ev('end_effector.principles') + '</dd>' +
      ((ee.maker || ee.model) ? '<dt>ハンド</dt><dd>' + esc([ee.maker, ee.model].filter(Boolean).join(' ')) + (ee.is_custom ? '(カスタム)' : '') + ev('end_effector.model') + '</dd>' : (ee.is_custom ? '<dt>ハンド</dt><dd>カスタム品' + ev('end_effector.is_custom') + '</dd>' : '')) +
      (ee.sensors.length ? '<dt>センサ</dt><dd>' + esc(ee.sensors.join('・')) + ev('end_effector.sensors') + '</dd>' : '') +
      (c.tasks.length ? '<dt>作業</dt><dd>' + esc(labels('task', c.tasks).join('・')) + ev('tasks') + '</dd>' : '') +
      '<dt>ロボット</dt><dd>' + (robot ? esc(robot) : '記載なし') + ev(fs['robot.model'] ? 'robot.model' : (fs['robot.class'] ? 'robot.class' : 'robot.maker')) + '</dd>' +
      '<dt>可搬重量帯</dt><dd>' + esc(c.payload_class) + ev('payload_class') + '</dd>' +
      (c.industry && c.industry.length ? '<dt>業種</dt><dd>' + esc(c.industry.join('・')) + ev('industry') + '</dd>' : '') +
      '<dt>種別・地域</dt><dd>' + esc(CT[c.case_type] || c.case_type) + ' · ' + esc(c.region || '') + (c.country ? '(' + esc(c.country) + ')' : '') + '</dd>' +
      (c.integrator && c.integrator.name ? '<dt>SIer</dt><dd>' + esc(c.integrator.name) + '</dd>' : '') +
      '<dt>出典</dt><dd>' + c.sources.map(function (s) { return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.publisher || s.url) + '</a> <span class="ev">取得 ' + esc(s.retrieved_at || '') + '</span>'; }).join('<br>') + '</dd>' +
      '</dl>' +
      (it ? '<div class="interp"><h3>LexxMoMa での適用可能性 <span class="lv">' + esc(it.level) + '</span><span class="spec">※ 推測(可搬 20 kg・協働アーム・AMR という形態からの当てはめ)</span></h3><ul>' + it.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></div>' : '') +
      (it && it.verify ? '<div class="verify"><h3>面談・検討で確認すること</h3><ul>' + it.verify.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></div>' : '') +
      (sim.length ? '<div class="similar"><h3>似た事例</h3><div class="simgrid">' + sim.map(function (o) { return '<button type="button" class="sim" data-id="' + esc(o.id) + '"><span class="im"><img alt="" data-simg="' + (o.images[0] ? o.images[0].id : '') + '"></span><span class="t">' + esc(o.title_ja) + '</span></button>'; }).join('') + '</div></div>' : '') +
      '<div class="review">レビュー: <select id="rvSel"><option value="">未確認</option><option value="ok"' + (rv.status === 'ok' ? ' selected' : '') + '>内容は正しい</option><option value="ng"' + (rv.status === 'ng' ? ' selected' : '') + '>誤りがある</option><option value="img"' + (rv.status === 'img' ? ' selected' : '') + '>画像が合わない</option></select>' +
      '<span class="muted">このブラウザにだけ保存。「レビューを書き出す」で eoat/manual/reviews.json へ</span><button type="button" class="link" id="rvExport">レビューを書き出す</button></div>';
    c.images.forEach(function (im) { var img = $('[data-dimg="' + im.id + '"]', body); IMG.detailUrl(im).then(function (u) { img.src = u; }).catch(function () { IMG.thumb(im).then(function (u) { img.src = u; }); }); });
    sim.forEach(function (o) { var img = $('[data-simg="' + (o.images[0] ? o.images[0].id : '') + '"]', body); if (img && o.images[0]) showImg(img, o.images[0]); });
    $$('.sim', body).forEach(function (b) { b.onclick = function () { openCase(b.dataset.id); track('case/similar'); }; });
    $$('[data-track]', body).forEach(function (a) { a.addEventListener('click', function () { track(a.dataset.track, c.sources[0].publisher); }); });
    $('#rvSel').onchange = function () { reviews[c.id] = { status: $('#rvSel').value, date: new Date().toISOString().slice(0, 10) }; try { localStorage.setItem(REVIEW_STORE, JSON.stringify(reviews)); } catch (e) { } track('review', $('#rvSel').value); };
    $('#rvExport').onclick = exportReviews;
    $('#drawer').hidden = false; $('#drawerBg').hidden = false;
    $('#drawerBody').scrollTop = 0;
    if (!silent) $('#dClose').focus();
    // 前後の事例の詳細画像を先読み
    var i = LIST.indexOf(c);
    [LIST[i - 1], LIST[i + 1]].forEach(function (o) { if (o) IMG.prefetchDetail(o); });
  }
  function closeCase() { $('#drawer').hidden = true; $('#drawerBg').hidden = true; F.c = ''; CUR = null; history.replaceState(null, '', location.pathname + location.search + S.encodeHash(F)); }
  function step(d) { var i = LIST.indexOf(BYID[CUR]); var o = LIST[i + d]; if (o) openCase(o.id); }
  function exportReviews() {
    var blob = new Blob([JSON.stringify(reviews, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'reviews.json'; a.click();
    track('review/export');
  }

  // ---------------------------------------------------------------- 操作
  function toast(msg) { var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 1800); }
  function copyLink(hash) {
    var url = location.origin + location.pathname + location.search + hash;
    var done = function () { toast('リンクをコピーしました'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt('このリンクをコピー', url); });
    else window.prompt('このリンクをコピー', url);
  }
  function bind() {
    $('#askForm').onsubmit = function (e) { e.preventDefault(); F.q = $('#q').value.trim(); F._off = {}; run(); };
    var tm = null;
    $('#q').addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(function () { F.q = $('#q').value.trim(); F._off = {}; run(); }, 350); });
    $$('#rcTabs button').forEach(function (b) { b.onclick = function () { F.rc = b.dataset.rc; track('tab/' + (b.dataset.rc || 'all')); run(); }; });
    $('#mob').onchange = function () { F.mob = $('#mob').checked; track('tab/mobile', F.mob ? 'on' : 'off'); run(); };
    $('#sort').onchange = function () { F.sort = $('#sort').value; track('sort/' + F.sort); run(); };
    $('#clearAll').onclick = function () { var q = F.q; F = S.emptyFilter(); F.q = q; $('#mob').checked = false; run(); };
    $('#moreBtn').onclick = function () { SHOWN += PAGE; renderGrid(); IMG.warm(LIST.slice(SHOWN - PAGE, SHOWN + PAGE)); track('more'); };
    $('#filterBtn').onclick = function () { var f = $('#facets'); var open = !f.classList.contains('open'); f.classList.toggle('open', open); $('#filterBtn').setAttribute('aria-expanded', open); };
    $('#facetsClose').onclick = function () { $('#facets').classList.remove('open'); $('#filterBtn').setAttribute('aria-expanded', 'false'); };
    $('#shareBtn').onclick = function () { copyLink(S.encodeHash(Object.assign({}, F, { c: '' }))); track('share'); };
    $('#dShare').onclick = function () { copyLink(S.encodeHash(F)); track('share/case'); };
    $('#dClose').onclick = closeCase; $('#drawerBg').onclick = closeCase;
    $('#dPrev').onclick = function () { step(-1); }; $('#dNext').onclick = function () { step(1); };
    document.addEventListener('keydown', function (e) {
      if ($('#drawer').hidden) return;
      if (e.key === 'Escape') closeCase(); else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1);
    });
    window.addEventListener('hashchange', function () {
      var nf = S.decodeHash(location.hash);
      if (S.encodeHash(nf) === S.encodeHash(F)) return;
      nf._off = F._off; F = nf; $('#q').value = F.q || ''; $('#sort').value = F.sort || 'rel'; $('#mob').checked = !!F.mob; run();
      if (F.c && BYID[F.c]) openCase(F.c, true); else if (!F.c) closeCase();
    });
    $('#lock').addEventListener('click', function () { forgetKey(); if (window.lxMembers) { window.lxMembers.forget(); location.hash = ''; window.lxMembers.toEntry(); } else location.reload(); });
  }
})();
