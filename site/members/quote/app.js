/* 3D 見積(LexxPluss 社内) — LexxMoMa にオプションを付けていき、3D の機体を完成させながら見積を作る。
 * データ: data.enc.json = PBKDF2-SHA256 → AES-256-GCM(scripts/build_member_quote.py が作成。工場マップと同じ方式)
 *   中身: 価格マスタ { dayRate, dayCost, marginTarget, categories: [{ id, name, icon, desc, items: [...] }], presets }
 *   カテゴリ(標準商品・準標準商品・非標準商品・適合業務…)はエクセル「LexxMoMa-見積 社内検討」の区分のまま。
 *   ローカル(localhost)で data.enc.json がまだ無いときだけ、平文 ../../internal/quote/price-master.json を読む(internal/ は公開されない)。
 * 3D: scene.js(three.js)が window.lxQuoteScene を用意する。読めなくても見積は一覧だけで作れる。
 * 下書き(選んだ構成・案件名)はこの端末の localStorage に置く。
 * 依存: なし(バニラ JS)。
 */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var KEY_STORE = 'lx_quote_key_v1';
  var DRAFT = 'lx_quote_draft_v1';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function b64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function ub64(u) { var s = ''; u = new Uint8Array(u); for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  function track(p, t) { try { if (window.lxTrack) window.lxTrack(p, t); } catch (e) { /* 計測不可 */ } }
  function yen(n) { return '¥' + Math.round(n).toLocaleString('ja-JP'); }
  function pct(n) { return (n * 100).toFixed(1) + '%'; }

  // ---------------------------------------------------------------- 入口(工場マップ・顧客人事DB・共有動画と同じ)
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  function loadEnc() {
    if (window.QUOTE_ENC) return Promise.resolve(window.QUOTE_ENC);
    return fetch('data.enc.json', { cache: 'no-cache' }).then(function (r) {
      if (r.status === 404) return null;
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
    return deriveKey(pw, enc).then(function (key) {
      return decrypt(key, enc).then(function (data) { return saveKey(key, enc.salt, window.lxMembers.remembered()).then(function () { start(data); }); });
    });
  }
  // 復号できなかったとき: 共通パスワードで工場マップが開けるなら、価格マスタのほうが別のパスワードで作られている
  function checkShared() {
    var pw = window.lxMembers.password();
    return fetch('../factory-map/data.enc.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (fm) {
      return deriveKey(pw, fm).then(function (k) { return decrypt(k, fm); });
    }).then(function () {
      gateMsg('価格マスタが共通パスワードと違うパスワードで作られているため開けません。管理者に作り直しを依頼してください。');
    }, function () { window.lxMembers.forget(); window.lxMembers.toEntry(); });
  }
  function localPlain() {
    return fetch('../../internal/quote/price-master.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('data'); return r.json(); });
  }

  if (!window.crypto || !crypto.subtle) {
    gateMsg('このブラウザでは開けません(https で開いてください)。');
  } else {
    loadEnc().then(function (enc) {
      if (!enc) {
        if (LOCAL) return localPlain().then(start);
        return gateMsg('価格マスタがまだ用意されていません(scripts/build_member_quote.py で作成)。');
      }
      return storedKey().then(function (s) {
        if (!s || s.salt !== enc.salt) { forgetKey(); return viaShared(enc); }
        return decrypt(s.key, enc).then(start, function () { forgetKey(); return viaShared(enc); });
      });
    }).catch(function (err) {
      if (err && err.message === 'data') return gateMsg('データを読み込めませんでした。時間をおいて再度お試しください。');
      if (err && err.name === 'OperationError') return checkShared();
      gateMsg('開けませんでした。ページを読み込み直してください。');
    });
  }

  // ---------------------------------------------------------------- 見積の計算
  var M = null;            // 価格マスタ
  var DEFS = {};           // id → 商品定義(category 付き)
  var S = { items: {}, cat: 0, caseName: '', discount: 0, showCost: false };

  function variantOf(def, st) {
    if (!def.variants) return null;
    for (var i = 0; i < def.variants.length; i++) if (def.variants[i].id === (st && st.variant)) return def.variants[i];
    return def.variants[0];
  }
  function on(id) { var st = S.items[id]; return !!(st && st.qty > 0); }
  function unitPrice(def, st) {
    if (def.manday) return M.dayRate;
    var v = variantOf(def, st);
    if (v) return v.editable ? (+(st && st.price) || 0) : v.price;
    return def.price || 0;
  }
  function unitCost(def, st) {
    if (def.manday) return M.dayCost || 0;
    var v = variantOf(def, st);
    if (v) return v.cost || 0;
    return def.cost || 0;
  }
  function line(def) {
    var st = S.items[def.id] || { qty: 0 };
    var q = st.qty || 0;
    return { def: def, st: st, qty: q, unit: unitPrice(def, st), amount: unitPrice(def, st) * q, cost: unitCost(def, st) * q };
  }
  function totals() {
    var t = { amount: 0, cost: 0, mandays: 0, parts: 0, partsAll: 0, byCat: {} };
    M.categories.forEach(function (c) {
      var ct = { amount: 0, cost: 0, n: 0 };
      c.items.forEach(function (def) {
        var l = line(def);
        t.partsAll++;
        if (l.qty > 0) { t.parts++; ct.n++; }
        ct.amount += l.amount; ct.cost += l.cost;
        if (def.manday) t.mandays += l.qty;
      });
      t.byCat[c.id] = ct; t.amount += ct.amount; t.cost += ct.cost;
    });
    t.sub = t.amount;
    t.amount -= S.discount || 0;
    t.margin = t.amount > 0 ? (t.amount - t.cost) / t.amount : 0;
    return t;
  }

  // ---------------------------------------------------------------- 状態の変更
  function save() {
    try { localStorage.setItem(DRAFT, JSON.stringify({ items: S.items, caseName: S.caseName, discount: S.discount })); } catch (e) { /* 保存不可 */ }
  }
  function load() {
    try { var d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if (d && d.items) { S.items = d.items; S.caseName = d.caseName || ''; S.discount = +d.discount || 0; return true; } } catch (e) { /* 壊れた下書きは捨てる */ }
    return false;
  }
  function applyPreset(p) {
    S.items = {};
    Object.keys(p.items).forEach(function (id) { S.items[id] = Object.assign({}, p.items[id]); });
    S.discount = 0;
  }
  function names(ids) { return ids.map(function (id) { return DEFS[id].name; }).join('・'); }

  // 商品をつける/外す/数を変える。with(セットで必要になる作業)は 0 のものだけ既定数で足す
  function setQty(id, q, quiet) {
    var def = DEFS[id];
    q = Math.max(def.required ? 1 : (def.min || 0), Math.min(def.max || 99, q));
    var st = S.items[id] || (S.items[id] = {});
    var was = st.qty || 0;
    st.qty = q;
    if (!was && q && !quiet) {
      var w = (def.with || []).concat((variantOf(def, st) || {}).with || []);
      addWith(w);
      var l = line(def);
      floatText(l.amount ? '+' + yen(l.amount) : def.name, def);
      fx(def, 'add');
    } else if (was && !q && !quiet) {
      floatText('− ' + def.name, def, true);
      fx(def, 'remove');
    } else if (q !== was && !quiet) {
      fx(def, 'bump');
    }
    commit();
  }
  function addWith(ids) {
    var added = ids.filter(function (id) { return !on(id); });
    added.forEach(function (id) {
      var d = DEFS[id];
      S.items[id] = Object.assign(S.items[id] || {}, { qty: d.qty || 1 });
    });
    if (added.length) toast('セットで必要な作業も追加: ' + names(added));
  }
  function setVariant(id, vid) {
    var def = DEFS[id], st = S.items[id] || (S.items[id] = { qty: 0 });
    var before = variantOf(def, st);
    st.variant = vid;
    var after = variantOf(def, st);
    if (st.qty > 0) {
      // 前の選択でだけ必要だった作業は外し、新しい選択で必要な作業を足す
      var drop = (before.with || []).filter(function (x) { return (after.with || []).indexOf(x) < 0 && on(x); });
      drop.forEach(function (x) { S.items[x].qty = 0; });
      if (drop.length) toast('不要になった作業を外しました: ' + names(drop));
      addWith(after.with || []);
      fx(def, 'bump');
    }
    commit();
  }
  function setStyle(id, sid) { (S.items[id] || (S.items[id] = { qty: 0 })).style = sid; fx(DEFS[id], 'bump'); commit(); }
  function setPrice(id, v) { (S.items[id] || (S.items[id] = { qty: 0 })).price = Math.max(0, +v || 0); commit(true); }

  function commit(soft) {
    save();
    sendScene();
    renderHud();
    renderSteps();
    if (!soft) renderCat(); else renderCatAmounts();
  }

  // ---------------------------------------------------------------- 3D へ
  function sceneState() {
    var st = function (id) { return S.items[id] || {}; };
    var crew = {};
    M.categories.forEach(function (c) { c.items.forEach(function (d) { if (d.crew && on(d.id)) crew[d.crew] = (crew[d.crew] || 0) + 1; }); });
    return {
      momaQty: st('moma').qty || 1,
      crx: (variantOf(DEFS.moma, st('moma')) || {}).id !== 'nocrx',
      charger: st('charger').qty || 0,
      tablet: on('tablet'),
      ee: on('ee') ? (st('ee').style || 'gripper') : null,
      eeSupplied: on('ee') && (variantOf(DEFS.ee, st('ee')) || {}).id === 'sier',
      camera: on('camera'),
      panel: st('panel').qty || 0,
      estop: on('estop'),
      docs: (on('doc-drawing') ? 1 : 0) + (on('doc-manual') ? 1 : 0),
      crew: crew,
      dark: document.documentElement.getAttribute('data-theme') === 'dark'
    };
  }
  function sendScene() { if (window.lxQuoteScene) window.lxQuoteScene.set(sceneState()); }
  function fx(def, kind) {
    var part = def.part || (def.crew ? 'crew-' + def.crew : null);
    if (window.lxQuoteScene && part) window.lxQuoteScene.fx(part, kind);
  }
  document.addEventListener('lx-quote-scene-ready', function () { if (M) sendScene(); });
  document.addEventListener('lx-quote-scene-failed', function () { $('#sceneFallback').hidden = false; });
  document.addEventListener('lx-theme', function () { if (M) sendScene(); });

  // ---------------------------------------------------------------- 画面
  function start(data) {
    M = data;
    M.categories.forEach(function (c) { c.items.forEach(function (d) { d.cat = c; DEFS[d.id] = d; }); });
    if (!load()) applyPreset(M.presets[0]);
    if (!S.items.moma || !S.items.moma.qty) S.items.moma = { qty: 1, variant: 'crx' };
    $('#gate').hidden = true; $('#app').hidden = false;

    $('#lock').addEventListener('click', function () { forgetKey(); window.lxMembers.forget(); window.lxMembers.toEntry(); });
    $('#caseName').value = S.caseName;
    $('#caseName').addEventListener('input', function () { S.caseName = this.value; save(); });
    $('#showCost').addEventListener('change', function () { S.showCost = this.checked; document.body.classList.toggle('cost-on', S.showCost); renderHud(); renderCat(); });
    $('#prevCat').addEventListener('click', function () { goCat(S.cat - 1); });
    $('#nextCat').addEventListener('click', function () { if (S.cat >= M.categories.length - 1) openSheet(); else goCat(S.cat + 1); });
    $('#openQuote').addEventListener('click', openSheet);
    $('#reset').addEventListener('click', function () { applyPreset(M.presets[0]); goCat(0); commit(); toast('本体だけに戻しました'); });
    $('#closeSheet').addEventListener('click', function () { $('#sheet').close(); });
    $('#print').addEventListener('click', function () { track('member/quote/print', '見積書を印刷'); window.print(); });
    $('#copyTsv').addEventListener('click', copyTsv);
    $('#spin').addEventListener('click', function () {
      var p = this.getAttribute('aria-pressed') !== 'true';
      this.setAttribute('aria-pressed', p ? 'true' : 'false');
      if (window.lxQuoteScene) window.lxQuoteScene.spin(p);
    });

    var pre = $('#presets');
    M.presets.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.textContent = p.label;
      b.addEventListener('click', function () { applyPreset(p); commit(); toast('「' + p.label + '」を読み込みました'); if (window.lxQuoteScene) window.lxQuoteScene.fx('all', 'add'); });
      pre.appendChild(b);
    });

    $('#steps').addEventListener('click', function (e) { var b = e.target.closest('[data-cat]'); if (b) goCat(+b.dataset.cat); });
    $('#cat').addEventListener('click', onCatClick);
    $('#cat').addEventListener('input', function (e) {
      var t = e.target;
      if (t.dataset.price != null) setPrice(t.dataset.price, t.value);
      if (t.id === 'discount') { S.discount = Math.max(0, +t.value || 0); save(); renderHud(); }
    });
    track('member/quote/open', '3D 見積を開いた');
    setTimeout(function () { if (!window.lxQuoteScene) $('#sceneFallback').hidden = false; }, 10000);
    commit();
  }

  function goCat(i) {
    S.cat = Math.max(0, Math.min(M.categories.length - 1, i));
    renderSteps(); renderCat();
    var c = M.categories[S.cat];
    var focus = null;
    c.items.some(function (d) { if (d.part && on(d.id)) { focus = d.part; return true; } return false; });
    if (window.lxQuoteScene) window.lxQuoteScene.focus(focus || (c.items[0].crew ? 'crew' : null));
  }

  function renderSteps() {
    var t = totals();
    $('#steps').innerHTML = M.categories.map(function (c, i) {
      var ct = t.byCat[c.id];
      return '<button type="button" class="step' + (i === S.cat ? ' on' : '') + (ct.n ? ' has' : '') + '" data-cat="' + i + '"' + (i === S.cat ? ' aria-current="step"' : '') + '>' +
        '<span class="step-ic">' + esc(c.icon || '•') + '</span><span class="step-name">' + esc(c.name) + '</span>' +
        '<span class="step-n">' + (ct.n ? ct.n : '') + '</span></button>';
    }).join('');
    $('#prevCat').disabled = S.cat === 0;
    $('#nextCat').textContent = S.cat >= M.categories.length - 1 ? '見積書へ 🏁' : '次へ →';
  }

  function itemHtml(def) {
    var l = line(def), st = l.st, active = l.qty > 0, v = variantOf(def, st);
    var h = '<article class="item' + (active ? ' on' : '') + '" data-id="' + esc(def.id) + '">';
    h += '<div class="item-hd"><div><b>' + esc(def.name) + '</b>' + (def.sub ? ' <span class="sub">' + esc(def.sub) + '</span>' : '') + '</div>';
    if (def.text) h += '<span class="price">文言記載</span>';
    else h += '<span class="price" data-amount="' + esc(def.id) + '">' + (active ? yen(l.amount) : '<span class="faint">' + yen(l.unit) + ' / ' + esc(def.unit) + '</span>') + '</span>';
    h += '</div>';
    if (def.desc) h += '<p class="desc">' + esc(def.desc) + '</p>';
    if (def.variants) {
      h += '<div class="seg" role="group" aria-label="' + esc(def.name) + 'の手配">' + def.variants.map(function (x) {
        return '<button type="button" data-variant="' + esc(x.id) + '" aria-pressed="' + (x === v) + '">' + esc(x.label) + '</button>';
      }).join('') + '</div>';
      if (v && v.desc) h += '<p class="desc faint">' + esc(v.desc) + '</p>';
      if (v && v.editable) h += '<label class="price-in">金額 <input type="number" min="0" step="10000" inputmode="numeric" data-price="' + esc(def.id) + '" value="' + (st.price || '') + '" placeholder="0"> 円 / ' + esc(def.unit) + '</label>';
    }
    if (def.styles && active) {
      h += '<div class="seg small" role="group" aria-label="形式">' + def.styles.map(function (x) {
        return '<button type="button" data-style="' + esc(x.id) + '" aria-pressed="' + ((st.style || def.styles[0].id) === x.id) + '">' + esc(x.label) + '</button>';
      }).join('') + '</div>';
    }
    h += '<div class="item-ft">';
    if ((def.max || 1) > 1 || def.manday) {
      h += '<span class="stepper"><button type="button" data-step="-1" aria-label="減らす"' + (l.qty <= (def.required ? 1 : 0) ? ' disabled' : '') + '>−</button>' +
        '<output>' + l.qty + '</output><span class="unit">' + esc(def.unit) + '</span>' +
        '<button type="button" data-step="1" aria-label="増やす"' + (l.qty >= (def.max || 99) ? ' disabled' : '') + '>＋</button></span>';
      if (def.manday && active) h += '<span class="faint calc">' + yen(M.dayRate) + ' × ' + l.qty + ' 人日</span>';
    }
    if (!def.required) h += '<button type="button" class="toggle" data-toggle>' + (active ? '外す' : (def.text ? '記載する' : '付ける ＋')) + '</button>';
    else h += '<span class="req">必須</span>';
    h += '</div>';
    if (def.hint && active && l.qty < 5) h += '<p class="hint">⚠ ' + esc(def.hint) + '</p>';
    if (active && !def.text) h += '<p class="cost" data-cost="' + esc(def.id) + '">' + costText(l) + '</p>';
    return h + '</article>';
  }
  function costText(l) {
    return '原価 ' + yen(l.cost) + (l.amount > 0 ? ' · 粗利 ' + yen(l.amount - l.cost) + '(' + pct((l.amount - l.cost) / l.amount) + ')' : '');
  }

  function renderCat() {
    var c = M.categories[S.cat];
    var ct = totals().byCat[c.id];
    var h = '<div class="cat-hd"><span class="cat-ic">' + esc(c.icon || '') + '</span><div><h2>' + esc(c.name) + '</h2><p class="muted">' + esc(c.desc || '') + '</p></div>' +
      '<span class="cat-sum" id="catSum">' + (c.id === 'terms' ? '' : '小計 ' + yen(ct.amount)) + '</span></div>';
    h += '<div class="items">' + c.items.map(itemHtml).join('') + '</div>';
    if (S.cat === M.categories.length - 1) {
      h += '<label class="discount">出精値引き <input type="number" id="discount" min="0" step="10000" inputmode="numeric" value="' + (S.discount || '') + '" placeholder="0"> 円</label>';
    }
    $('#cat').innerHTML = h;
  }
  // 金額入力中は作り直さず、数字だけ差し替える(入力欄のフォーカスを保つ)
  function renderCatAmounts() {
    var c = M.categories[S.cat];
    c.items.forEach(function (def) {
      var l = line(def);
      var a = document.querySelector('[data-amount="' + def.id + '"]');
      if (a && l.qty > 0) a.textContent = yen(l.amount);
      var k = document.querySelector('[data-cost="' + def.id + '"]');
      if (k) k.textContent = costText(l);
    });
    var s = $('#catSum'); if (s && c.id !== 'terms') s.textContent = '小計 ' + yen(totals().byCat[c.id].amount);
  }

  function onCatClick(e) {
    var art = e.target.closest('.item'); if (!art) return;
    var id = art.dataset.id, def = DEFS[id], st = S.items[id] || {};
    var b;
    if ((b = e.target.closest('[data-toggle]'))) setQty(id, on(id) ? 0 : (def.qty || 1));
    else if ((b = e.target.closest('[data-step]'))) {
      var q = (st.qty || 0) + (+b.dataset.step);
      setQty(id, q);
    }
    else if ((b = e.target.closest('[data-variant]'))) {
      if (!on(id)) { (S.items[id] = S.items[id] || {}).variant = b.dataset.variant; setQty(id, def.qty || 1); }
      else setVariant(id, b.dataset.variant);
    }
    else if ((b = e.target.closest('[data-style]'))) setStyle(id, b.dataset.style);
  }

  var shown = null;
  function renderHud() {
    var t = totals();
    countTo($('#hudTotal'), t.amount);
    $('#barTotal').textContent = yen(t.amount);
    $('#barCost').innerHTML = S.showCost ? '原価 ' + yen(t.cost) + ' · 粗利率 <b class="' + (t.margin < M.marginTarget ? 'low' : 'ok') + '">' + pct(t.margin) + '</b>' : '';
    var bars = [
      ['パーツ', t.parts + ' / ' + t.partsAll, t.parts / t.partsAll],
      ['エンジニア工数', t.mandays + ' 人日', Math.min(1, t.mandays / 60)]
    ];
    if (S.showCost) bars.push(['粗利率', pct(t.margin) + '(目標 ' + pct(M.marginTarget) + ')', Math.max(0, Math.min(1, t.margin / 0.7)), t.margin < M.marginTarget ? 'low' : 'ok', M.marginTarget / 0.7]);
    $('#hudStats').innerHTML = bars.map(function (b) {
      return '<div class="stat"><span>' + esc(b[0]) + '</span><i class="' + (b[3] || '') + '"><em style="width:' + (b[2] * 100).toFixed(1) + '%"></em>' +
        (b[4] ? '<u style="left:' + (b[4] * 100).toFixed(1) + '%"></u>' : '') + '</i><b>' + esc(b[1]) + '</b></div>';
    }).join('');
  }
  // 合計はメーターのように数字を回す
  var raf = 0;
  function countTo(el, to) {
    var from = shown == null ? to : shown, t0 = performance.now();
    cancelAnimationFrame(raf);
    if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { shown = to; el.textContent = yen(to); return; }
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    (function step(now) {
      var k = Math.min(1, (now - t0) / 600), e = 1 - Math.pow(1 - k, 3);
      shown = from + (to - from) * e;
      el.textContent = yen(shown);
      if (k < 1) raf = requestAnimationFrame(step); else shown = to;
    })(t0);
  }

  var toastT = 0;
  function toast(msg) {
    var el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }
  function floatText(text, def, minus) {
    var el = document.createElement('span');
    el.className = 'float' + (minus ? ' minus' : '');
    el.textContent = text;
    var p = window.lxQuoteScene && def.part ? window.lxQuoteScene.screenPos(def.part) : null;
    el.style.left = (p ? p.x : 50) + '%'; el.style.top = (p ? p.y : 45) + '%';
    $('#floats').appendChild(el);
    setTimeout(function () { el.remove(); }, 1400);
  }

  // ---------------------------------------------------------------- 見積書
  function rows() {
    var out = [], n = 0;
    M.categories.forEach(function (c) {
      if (c.id === 'terms') return;
      var ls = c.items.map(line).filter(function (l) { return l.qty > 0; });
      if (!ls.length) return;
      ls.forEach(function (l, i) {
        var v = variantOf(l.def, l.st);
        var note = [];
        if (v) note.push(v.label);
        if (l.def.styles) l.def.styles.forEach(function (s) { if (s.id === (l.st.style || l.def.styles[0].id)) note.push(s.label); });
        if (l.def.sub) note.push(l.def.sub);
        out.push({ no: ++n, cat: i === 0 ? c.name : '', name: l.def.name, qty: l.qty, unit: l.def.unit, price: l.unit, amount: l.amount, cost: l.cost, note: note.join(' / ') });
      });
    });
    return out;
  }
  function terms() {
    return DEFS ? M.categories.filter(function (c) { return c.id === 'terms'; }).reduce(function (a, c) { return a.concat(c.items.filter(function (d) { return on(d.id); })); }, []) : [];
  }
  function openSheet() {
    var t = totals(), rs = rows(), cost = S.showCost;
    var today = new Date(), d = today.getFullYear() + '年' + (today.getMonth() + 1) + '月' + today.getDate() + '日';
    var h = '<div class="doc-top"><div><h2>御見積書</h2><p class="doc-case">' + esc(S.caseName || '(案件名未入力)') + '</p></div>' +
      '<div class="doc-meta">' + d + '<br>LexxPluss 株式会社<br><span class="faint">下書き — 正式な見積書ではありません</span></div></div>';
    h += '<div class="doc-total"><span>御見積金額(税抜)</span><b>' + yen(t.amount) + '</b><span class="faint">消費税(10%)' + yen(t.amount * 0.1) + ' · 税込 ' + yen(t.amount * 1.1) + '</span></div>';
    h += '<table class="doc-tbl"><thead><tr><th>No</th><th>大項目</th><th>品名</th><th class="r">数量</th><th>単位</th><th class="r">単価</th><th class="r">金額</th>' +
      (cost ? '<th class="r cost-col">原価</th>' : '') + '<th>備考</th></tr></thead><tbody>';
    h += rs.map(function (r) {
      return '<tr' + (r.cat ? ' class="first"' : '') + '><td>' + r.no + '</td><td>' + esc(r.cat) + '</td><td>' + esc(r.name) + '</td><td class="r">' + r.qty + '</td><td>' + esc(r.unit) + '</td>' +
        '<td class="r">' + yen(r.price) + '</td><td class="r">' + yen(r.amount) + '</td>' + (cost ? '<td class="r cost-col">' + yen(r.cost) + '</td>' : '') + '<td class="note">' + esc(r.note) + '</td></tr>';
    }).join('');
    if (S.discount) h += '<tr><td></td><td></td><td>出精値引き</td><td></td><td></td><td></td><td class="r">−' + yen(S.discount) + '</td>' + (cost ? '<td></td>' : '') + '<td></td></tr>';
    h += '</tbody><tfoot><tr><td colspan="6" class="r">合計(税抜)</td><td class="r">' + yen(t.amount) + '</td>' + (cost ? '<td class="r cost-col">' + yen(t.cost) + '</td>' : '') + '<td>' +
      (cost ? '粗利 ' + yen(t.amount - t.cost) + '(' + pct(t.margin) + ')' : '') + '</td></tr></tfoot></table>';
    var tm = terms();
    if (tm.length) h += '<div class="doc-terms"><b>記載事項</b><ul>' + tm.map(function (d) { return '<li><b>' + esc(d.name) + '</b>: ' + esc(d.desc) + '</li>'; }).join('') + '</ul></div>';
    h += '<p class="faint doc-foot">金額はすべて税抜。エンジニア工数は 1 人日 ' + yen(M.dayRate) + '。' + (M.updated ? '価格マスタ ' + esc(M.updated) + ' 版。' : '') + '</p>';
    $('#doc').innerHTML = h;
    $('#sheet').showModal();
    if (window.lxQuoteScene) window.lxQuoteScene.fx('all', 'finish');
    track('member/quote/sheet', '見積書を開いた');
  }
  function copyTsv() {
    var cost = S.showCost, t = totals();
    var head = ['No', '大項目', '品名', '数量', '単位', '単価', '金額'].concat(cost ? ['原価'] : []).concat(['備考']);
    var lines = [head.join('\t')].concat(rows().map(function (r) {
      return [r.no, r.cat, r.name, r.qty, r.unit, r.price, r.amount].concat(cost ? [r.cost] : []).concat([r.note]).join('\t');
    }));
    if (S.discount) lines.push(['', '', '出精値引き', '', '', '', -S.discount].join('\t'));
    lines.push(['', '', '合計(税抜)', '', '', '', t.amount].concat(cost ? [t.cost] : []).join('\t'));
    var btn = $('#copyTsv');
    navigator.clipboard.writeText(lines.join('\n')).then(function () { btn.textContent = 'コピーしました'; setTimeout(function () { btn.textContent = '表をコピー'; }, 1500); });
  }
})();
