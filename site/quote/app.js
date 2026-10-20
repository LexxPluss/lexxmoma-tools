/* LexxMoMa 3D 見積 — お客様が LexxMoMa にオプションを付けていき、3D の機体を完成させながら費用を確認し、そのまま見積を依頼する。
 * 価格の出し方は catalog.js 冒頭の方針どおり: 本体標準価格(一本の数字)と別途費用を分けて見せ、幅のある表現は使わない。
 * カタログ: catalog.js(QUOTE_CONFIG / QUOTE_CATALOG / QUOTE_PRESETS / QUOTE_CHANNELS / QUOTE_TIMINGS)
 *   カテゴリ(標準商品・準標準商品・非標準商品・適合業務…)は社内の見積エクセルの区分のまま。
 * 3D: scene.js(three.js)が window.lxQuoteScene を用意する。読めなくても構成は一覧だけで選べる。
 * 見積依頼: QUOTE_CONFIG.endpoint(Google Apps Script)へ構成・商流・連絡先を送る(apps-script.gs / SETUP.md)。空ならテストモード。
 * 下書き(選んだ構成)はこの端末の localStorage に置く。連絡先は保存しない。
 * 依存: なし(バニラ JS)。
 */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var CFG = window.QUOTE_CONFIG || {};
  var CATS = window.QUOTE_CATALOG || [];
  var PRESETS = window.QUOTE_PRESETS || [];
  var DRAFT = 'lx_quote_draft_v2';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function track(p, t) { try { if (window.lxTrack) window.lxTrack(p, t); } catch (e) { /* 計測不可 */ } }
  function yen(n) { return '¥' + Math.round(n).toLocaleString('ja-JP'); }

  // ---------------------------------------------------------------- 見積の計算
  var DEFS = {};
  CATS.forEach(function (c) { c.items.forEach(function (d) { d.cat = c; DEFS[d.id] = d; }); });
  var S = { items: {}, cat: 0 };

  function variantOf(def, st) {
    if (!def.variants) return null;
    for (var i = 0; i < def.variants.length; i++) if (def.variants[i].id === (st && st.variant)) return def.variants[i];
    return def.variants[0];
  }
  function on(id) { var st = S.items[id]; return !!(st && st.qty > 0); }
  function unitPrice(def, st) {
    if (def.manday) return CFG.dayRate;
    var v = variantOf(def, st);
    return v ? v.price : (def.price || 0);
  }
  function line(def) {
    var st = S.items[def.id] || { qty: 0 }, v = variantOf(def, st);
    var q = st.qty || 0;
    return { def: def, st: st, qty: q, unit: unitPrice(def, st), amount: unitPrice(def, st) * q,
      later: !!(v && v.later),       // 金額はヒアリング後にご提示
      outside: !!(v && v.outside) };  // SIer・パートナーの範囲(この見積に含めない)
  }
  function totals() {
    var t = { amount: 0, body: 0, extra: 0, mandays: 0, parts: 0, partsAll: 0, later: 0, byCat: {} };
    CATS.forEach(function (c) {
      var ct = { amount: 0, n: 0 };
      c.items.forEach(function (def) {
        var l = line(def);
        t.partsAll++;
        if (l.qty > 0) { t.parts++; ct.n++; if (l.later) t.later++; }
        ct.amount += l.amount;
        if (def.manday) t.mandays += l.qty;
      });
      t.byCat[c.id] = ct; t.amount += ct.amount;
      if (c.group === 'body') t.body += ct.amount; else t.extra += ct.amount;
    });
    return t;
  }

  // ---------------------------------------------------------------- 状態の変更
  function save() { try { localStorage.setItem(DRAFT, JSON.stringify({ items: S.items })); } catch (e) { /* 保存不可 */ } }
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT) || 'null');
      if (d && d.items) { Object.keys(d.items).forEach(function (id) { if (DEFS[id]) S.items[id] = d.items[id]; }); return true; }
    } catch (e) { /* 壊れた下書きは捨てる */ }
    return false;
  }
  function applyPreset(p) {
    S.items = {};
    Object.keys(p.items).forEach(function (id) { if (DEFS[id]) S.items[id] = Object.assign({}, p.items[id]); });
  }
  function names(ids) { return ids.map(function (id) { return DEFS[id].name; }).join('・'); }

  // 商品をつける/外す/数を変える。with(セットで必要になる作業)は 0 のものだけ既定数で足す
  function setQty(id, q) {
    var def = DEFS[id];
    q = Math.max(def.required ? 1 : (def.min || 0), Math.min(def.max || 99, q));
    var st = S.items[id] || (S.items[id] = {});
    var was = st.qty || 0;
    st.qty = q;
    if (!was && q) {
      addWith((def.with || []).concat((variantOf(def, st) || {}).with || []));
      var l = line(def);
      floatText(l.amount ? '+' + yen(l.amount) : def.name, def);
      fx(def, 'add');
      track('quote/add/' + id, '見積にパーツを追加');
    } else if (was && !q) {
      floatText('− ' + def.name, def, true);
      fx(def, 'remove');
    } else if (q !== was) {
      fx(def, 'bump');
    }
    commit();
  }
  function addWith(ids) {
    var added = ids.filter(function (id) { return !on(id); });
    added.forEach(function (id) { S.items[id] = Object.assign(S.items[id] || {}, { qty: DEFS[id].qty || 1 }); });
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

  function commit() { save(); sendScene(); renderHud(); renderSteps(); renderCat(); }

  // ---------------------------------------------------------------- 3D へ
  function sceneState() {
    var st = function (id) { return S.items[id] || {}; };
    var crew = {};
    CATS.forEach(function (c) { c.items.forEach(function (d) { if (d.crew && on(d.id)) crew[d.crew] = (crew[d.crew] || 0) + 1; }); });
    return {
      momaQty: st('moma').qty || 1,
      crx: true,
      charger: st('charger').qty || 0,
      tablet: on('tablet'),
      ee: on('ee') ? (st('ee').style || 'gripper') : null,
      eeSupplied: on('ee') && !!(variantOf(DEFS.ee, st('ee')) || {}).outside,
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
  document.addEventListener('lx-quote-scene-ready', sendScene);
  document.addEventListener('lx-quote-scene-failed', function () { $('#sceneFallback').hidden = false; });
  document.addEventListener('lx-theme', sendScene);

  // ---------------------------------------------------------------- 画面
  function start() {
    if (!load()) applyPreset(PRESETS[0]);
    if (!S.items.moma || !S.items.moma.qty) S.items.moma = { qty: 1 };

    $('#prevCat').addEventListener('click', function () { goCat(S.cat - 1); });
    $('#nextCat').addEventListener('click', function () { if (S.cat >= CATS.length - 1) openSheet(); else goCat(S.cat + 1); });
    $('#openQuote').addEventListener('click', openSheet);
    $('#reset').addEventListener('click', function () { applyPreset(PRESETS[0]); goCat(0); commit(); toast('本体だけに戻しました'); });
    $('#closeSheet').addEventListener('click', function () { $('#sheet').close(); });
    $('#doneClose').addEventListener('click', function () { $('#sheet').close(); });
    $('#print').addEventListener('click', function () { track('quote/print', 'お見積り内容を印刷'); window.print(); });
    $('#spin').addEventListener('click', function () {
      var p = this.getAttribute('aria-pressed') !== 'true';
      this.setAttribute('aria-pressed', p ? 'true' : 'false');
      if (window.lxQuoteScene) window.lxQuoteScene.spin(p);
    });
    var pre = $('#presets');
    PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.textContent = p.label;
      b.addEventListener('click', function () { applyPreset(p); commit(); toast('「' + p.label + '」を読み込みました'); if (window.lxQuoteScene) window.lxQuoteScene.fx('all', 'add'); });
      pre.appendChild(b);
    });
    $('#steps').addEventListener('click', function (e) { var b = e.target.closest('[data-cat]'); if (b) goCat(+b.dataset.cat); });
    $('#cat').addEventListener('click', onCatClick);
    setupForm();
    setTimeout(function () { if (!window.lxQuoteScene) $('#sceneFallback').hidden = false; }, 10000);
    track('quote/open', '3D 見積を開いた');
    commit();
  }

  function goCat(i) {
    S.cat = Math.max(0, Math.min(CATS.length - 1, i));
    renderSteps(); renderCat();
    var c = CATS[S.cat], focus = null;
    c.items.some(function (d) { if (d.part && on(d.id)) { focus = d.part; return true; } return false; });
    if (window.lxQuoteScene) window.lxQuoteScene.focus(focus || (c.items[0].crew ? 'crew' : null));
  }

  function renderSteps() {
    var t = totals();
    $('#steps').innerHTML = CATS.map(function (c, i) {
      var ct = t.byCat[c.id];
      var head = !i || c.group !== CATS[i - 1].group ? '<span class="step-group">' + (c.group === 'body' ? '本体' : '別途費用') + '</span>' : '';
      return head + '<button type="button" class="step' + (i === S.cat ? ' on' : '') + '" data-cat="' + i + '"' + (i === S.cat ? ' aria-current="step"' : '') + '>' +
        '<span class="step-ic">' + esc(c.icon || '•') + '</span><span class="step-name">' + esc(c.name) + '</span>' +
        '<span class="step-n">' + (ct.n ? ct.n : '') + '</span></button>';
    }).join('');
    $('#prevCat').disabled = S.cat === 0;
    $('#nextCat').textContent = S.cat >= CATS.length - 1 ? '見積を依頼する 🏁' : '次へ →';
    var cur = $('#steps .on'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function amountText(l) {
    if (l.def.text) return '条件として記載';
    if (l.qty > 0 && l.later) return '<span class="later">ヒアリング後にご提示</span>';
    if (l.qty > 0 && l.outside) return '<span class="faint">この見積に含めない</span>';
    if (l.qty > 0) return yen(l.amount);
    return '<span class="faint">' + (l.unit ? yen(l.unit) + ' / ' + esc(l.def.unit) : '') + '</span>';
  }
  function itemHtml(def) {
    var l = line(def), st = l.st, active = l.qty > 0, v = variantOf(def, st);
    var h = '<article class="item' + (active ? ' on' : '') + '" data-id="' + esc(def.id) + '">';
    h += '<div class="item-hd"><div><b>' + esc(def.name) + '</b>' + (def.sub ? ' <span class="sub">' + esc(def.sub) + '</span>' : '') + '</div>';
    h += '<span class="price">' + amountText(l) + '</span></div>';
    if (def.desc) h += '<p class="desc">' + esc(def.desc) + '</p>';
    if (def.variants) {
      h += '<div class="seg" role="group" aria-label="' + esc(def.name) + 'の手配">' + def.variants.map(function (x) {
        return '<button type="button" data-variant="' + esc(x.id) + '" aria-pressed="' + (x === v) + '">' + esc(x.label) + '</button>';
      }).join('') + '</div>';
      if (v && v.desc) h += '<p class="desc faint">' + esc(v.desc) + '</p>';
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
      if (def.manday && active) h += '<span class="faint calc">' + yen(CFG.dayRate) + ' × ' + l.qty + ' 人日</span>';
    }
    if (!def.required) h += '<button type="button" class="toggle" data-toggle>' + (active ? '外す' : (def.text ? '記載する' : '付ける ＋')) + '</button>';
    else h += '<span class="req-tag">必須</span>';
    h += '</div>';
    if (def.hint && active && l.qty < 5) h += '<p class="hint">💡 ' + esc(def.hint) + '</p>';
    return h + '</article>';
  }

  function renderCat() {
    var c = CATS[S.cat], ct = totals().byCat[c.id];
    $('#cat').innerHTML = '<div class="cat-hd"><span class="cat-ic">' + esc(c.icon || '') + '</span><div><span class="grp ' + esc(c.group) + '">' + (c.group === 'body' ? '本体標準価格' : '別途費用') + '</span><h2>' + esc(c.name) + '</h2><p class="muted">' + esc(c.desc || '') + '</p></div>' +
      '<span class="cat-sum">' + (c.id === 'terms' ? '' : '小計 ' + yen(ct.amount)) + '</span></div>' +
      '<div class="items">' + c.items.map(itemHtml).join('') + '</div>';
  }

  function onCatClick(e) {
    var art = e.target.closest('.item'); if (!art) return;
    var id = art.dataset.id, def = DEFS[id], st = S.items[id] || {}, b;
    if ((b = e.target.closest('[data-toggle]'))) setQty(id, on(id) ? 0 : (def.qty || 1));
    else if ((b = e.target.closest('[data-step]'))) setQty(id, (st.qty || 0) + (+b.dataset.step));
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
    $('#hudBody').textContent = yen(t.body);
    $('#hudExtra').textContent = yen(t.extra) + (t.later ? ' + ヒアリング後にご提示 ' + t.later + ' 件' : '');
    $('#barTotal').textContent = yen(t.amount);
    $('#barSplit').textContent = '本体 ' + yen(t.body) + ' + 別途費用 ' + yen(t.extra);
    var bars = [
      ['パーツ', t.parts + ' / ' + t.partsAll, t.parts / t.partsAll],
      ['エンジニア工数', t.mandays + ' 人日', Math.min(1, t.mandays / 60)]
    ];
    $('#hudStats').innerHTML = bars.map(function (b) {
      return '<div class="stat"><span>' + esc(b[0]) + '</span><i><em style="width:' + (b[2] * 100).toFixed(1) + '%"></em></i><b>' + esc(b[1]) + '</b></div>';
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

  // ---------------------------------------------------------------- お見積り内容
  function rows() {
    var out = [], n = 0;
    CATS.forEach(function (c) {
      if (c.id === 'terms') return;
      c.items.map(line).filter(function (l) { return l.qty > 0; }).forEach(function (l, i) {
        var v = variantOf(l.def, l.st), note = [];
        if (v) note.push(v.label);
        if (l.def.styles) l.def.styles.forEach(function (s) { if (s.id === (l.st.style || l.def.styles[0].id)) note.push(s.label); });
        if (l.def.sub) note.push(l.def.sub);
        out.push({ no: ++n, group: c.group, cat: c.name, first: i === 0, id: l.def.id, name: l.def.name, qty: l.qty, unit: l.def.unit, price: l.unit, amount: l.amount, later: l.later, outside: l.outside, note: note.join(' / ') });
      });
    });
    return out;
  }
  function terms() {
    return CATS.filter(function (c) { return c.id === 'terms'; }).reduce(function (a, c) { return a.concat(c.items.filter(function (d) { return on(d.id); })); }, []);
  }
  function openSheet() {
    var t = totals(), rs = rows();
    var today = new Date(), d = today.getFullYear() + '年' + (today.getMonth() + 1) + '月' + today.getDate() + '日';
    var tax = CFG.taxRate || 0.1;
    var h = '<div class="doc-top"><div><h2>お見積り内容</h2><p class="doc-case">ご検討中の構成</p></div>' +
      '<div class="doc-meta">' + d + '<br>LexxPluss 株式会社<br><span class="faint">構成の確認用です。正式な見積書は担当窓口から発行します。</span></div></div>';
    h += '<div class="doc-total"><div class="doc-split"><span>LexxMoMa 本体標準価格</span><b>' + yen(t.body) + '</b></div><i>+</i>' +
      '<div class="doc-split"><span>別途費用</span><b>' + yen(t.extra) + '</b></div><i>=</i>' +
      '<div class="doc-split sum"><span>合計(税別)</span><b>' + yen(t.amount) + '</b></div>' +
      '<p class="faint">消費税(' + Math.round(tax * 100) + '%)' + yen(t.amount * tax) + ' · 税込 ' + yen(t.amount * (1 + tax)) +
      (t.later ? ' · ほかに、ワークと工程を伺ったうえで金額をご提示する項目が ' + t.later + ' 件あります' : '') + '</p></div>';
    var cell = function (r, v) { return r.later ? 'ヒアリング後にご提示' : r.outside ? '含めない' : yen(v); };
    var section = function (title, list, sub) {
      if (!list.length) return '';
      return '<tr class="sec"><th colspan="8">' + esc(title) + '</th></tr>' + list.map(function (r) {
        return '<tr' + (r.first ? ' class="first"' : '') + '><td>' + r.no + '</td><td>' + (r.first ? esc(r.cat) : '') + '</td><td>' + esc(r.name) + '</td><td class="r">' + r.qty + '</td><td>' + esc(r.unit) + '</td>' +
          '<td class="r">' + cell(r, r.price) + '</td><td class="r">' + cell(r, r.amount) + '</td><td class="note">' + esc(r.note) + '</td></tr>';
      }).join('') + '<tr class="subtotal"><td colspan="6" class="r">' + esc(title) + ' 計</td><td class="r">' + yen(sub) + '</td><td></td></tr>';
    };
    h += '<table class="doc-tbl"><thead><tr><th>No</th><th>区分</th><th>品名</th><th class="r">数量</th><th>単位</th><th class="r">単価</th><th class="r">金額</th><th>備考</th></tr></thead><tbody>';
    h += section('本体標準価格', rs.filter(function (r) { return r.group === 'body'; }), t.body);
    h += section('別途費用', rs.filter(function (r) { return r.group !== 'body'; }), t.extra);
    h += '</tbody><tfoot><tr><td colspan="6" class="r">合計(税別)</td><td class="r">' + yen(t.amount) + '</td><td></td></tr></tfoot></table>';
    var tm = terms();
    if (tm.length) h += '<div class="doc-terms"><b>条件</b><ul>' + tm.map(function (d) { return '<li><b>' + esc(d.name) + '</b>: ' + esc(d.desc) + '</li>'; }).join('') + '</ul></div>';
    h += '<p class="faint doc-foot">金額はすべて税別です。本体標準価格は、どの販売経路でご検討いただいても同じです。設置・導入支援などは本体標準価格に含まず、別途費用として記載しています。エンジニア工数は 1 人日 ' + yen(CFG.dayRate) + '。' + esc(CFG.updated || '') + ' 版。</p>';
    $('#doc').innerHTML = h;
    $('#req').hidden = false; $('#done').hidden = true; $('#reqErr').textContent = '';
    $('#sheet').showModal();
    $('#sheet').scrollTop = 0;
    if (window.lxQuoteScene) window.lxQuoteScene.fx('all', 'finish');
    track('quote/sheet', 'お見積り内容を開いた');
  }

  // ---------------------------------------------------------------- 見積依頼
  var PARTNER_LABEL = { sier: 'SIer の会社名', dealer: '商社・販売店の会社名' };
  function setupForm() {
    $('#testNote').hidden = !!CFG.endpoint;
    $('#bannerPrice').textContent = yen(CFG.bodyPrice);
    $('#timing').innerHTML = (window.QUOTE_TIMINGS || []).map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.label) + '</option>'; }).join('');
    $('#channels').innerHTML = (window.QUOTE_CHANNELS || []).map(function (x) {
      return '<label class="radio"><input type="radio" name="channel" value="' + esc(x.id) + '" required> ' + esc(x.label) + '</label>';
    }).join('');
    if (CFG.privacyUrl) $('#agreeText').innerHTML = '<a href="' + esc(CFG.privacyUrl) + '" target="_blank" rel="noopener">プライバシーポリシー</a>に同意のうえ送信します。ご入力の情報は、お見積りとご連絡のためにのみ使用します。';
    $('#req').addEventListener('change', function (e) {
      if (e.target.name !== 'channel') return;
      var lb = PARTNER_LABEL[e.target.value];
      $('#partnerBox').hidden = !lb;
      if (lb) $('#partnerLabel').textContent = lb;
    });
    $('#req').addEventListener('submit', submit);
  }
  function submit(e) {
    e.preventDefault();
    var f = e.target, err = $('#reqErr');
    var val = function (n) { var el = f.elements[n]; return el ? String(el.value || '').trim() : ''; };
    var channel = (f.querySelector('input[name=channel]:checked') || {}).value || '';
    if (!val('company') || !val('name') || !val('email')) { err.textContent = '会社名・お名前・メールアドレスを入力してください。'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val('email'))) { err.textContent = 'メールアドレスの形式を確認してください。'; return; }
    if (!channel) { err.textContent = 'ご希望の販売経路を選んでください。'; return; }
    if (!f.elements.agree.checked) { err.textContent = '情報の取り扱いへの同意にチェックしてください。'; return; }
    err.textContent = '';
    var t = totals();
    var body = {
      v: 1, website: val('website'),
      company: val('company'), dept: val('dept'), name: val('name'), email: val('email'), tel: val('tel'), timing: val('timing'),
      channel: channel, partner: PARTNER_LABEL[channel] ? val('partner') : '', partnerContact: PARTNER_LABEL[channel] ? val('partnerContact') : '',
      sierRelations: val('sierRelations'), message: val('message'),
      total: t.amount, body: t.body, extra: t.extra, laterItems: t.later, catalog: CFG.updated || '',
      items: rows().map(function (r) { return { id: r.id, qty: r.qty, note: r.note }; }),
      terms: terms().map(function (d) { return d.id; })
    };
    var btn = $('#send');
    btn.disabled = true; btn.textContent = '送信しています…';
    var done = function (id) {
      btn.disabled = false; btn.textContent = 'この構成で見積を依頼する';
      $('#req').hidden = true; $('#done').hidden = false; $('#doneId').textContent = id;
      if (window.lxQuoteScene) window.lxQuoteScene.fx('all', 'finish');
      track('quote/request', '見積を依頼した');
    };
    if (!CFG.endpoint) { done('TEST-' + Date.now().toString(36).toUpperCase()); return; }
    // text/plain で送ると CORS のプリフライトが起きない(Apps Script は OPTIONS を受けられないため)
    fetch(CFG.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) throw new Error(res && res.error || 'send');
        done(res.id);
      })
      .catch(function (ex) {
        btn.disabled = false; btn.textContent = 'この構成で見積を依頼する';
        err.textContent = (ex && ex.message && ex.message !== 'send' && ex.message.indexOf('fetch') < 0 ? ex.message : '送信できませんでした。') +
          ' 時間をおいて再度お試しいただくか、' + (CFG.contactWeb ? 'LexxPluss のお問い合わせ窓口(' + CFG.contactWeb + ')' : 'LexxPluss') + 'へご連絡ください。';
      });
  }

  start();
})();
