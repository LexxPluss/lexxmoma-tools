/* LexxMoMa 3D 見積依頼 — 3D の LexxMoMa にオプションを付けながら、3 ステップ(本体 → オプション → 依頼を送る)で
 * LexxPluss に見積を依頼する。正式な見積を作るツールではなく、依頼をすばやく送るための入口。
 * はじめに「価格の考え方」(本体標準価格は一本・本体と別途費用を分ける・どの経路でも同じ価格)を確認してもらう。
 * カタログ: catalog.js(QUOTE_CONFIG / QUOTE_BODY / QUOTE_OPTIONS / QUOTE_HEARING / QUOTE_CHANNELS)
 * 3D: scene.js(three.js)が window.lxQuoteScene を用意する。読めなくてもステップだけで依頼できる。
 * 送信: QUOTE_CONFIG.endpoint(Google Apps Script。apps-script.gs / SETUP.md)。空ならテストモード。
 * この端末に置くもの: 選んだ構成(下書き)と、価格の考え方を確認した版。連絡先は置かない。
 * 依存: なし(バニラ JS)。
 */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var CFG = window.QUOTE_CONFIG || {};
  var BODY = window.QUOTE_BODY || {};
  var OPTS = window.QUOTE_OPTIONS || [];
  var DRAFT = 'lx_quote_draft_v3';
  var AGREED = 'lx_quote_policy';
  var STEPS = 3;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function track(p, t) { try { if (window.lxTrack) window.lxTrack(p, t); } catch (e) { /* 計測不可 */ } }
  function yen(n) { return '¥' + Math.round(n).toLocaleString('ja-JP'); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  // ---------------------------------------------------------------- 構成
  var S = { qty: 1, opts: {}, step: 0 };
  var BY = {};
  OPTS.forEach(function (o) { BY[o.id] = o; });

  function defaults() {
    S.qty = 1; S.opts = {};
    OPTS.forEach(function (o) { S.opts[o.id] = { on: o.id === 'charger' || o.id === 'tablet', qty: o.qty || 1, who: 'sier' }; });
  }
  function load() {
    defaults();
    try {
      var d = JSON.parse(store(DRAFT) || 'null');
      if (!d) return;
      S.qty = Math.max(1, Math.min(BODY.max || 10, +d.qty || 1));
      Object.keys(d.opts || {}).forEach(function (id) { if (BY[id]) S.opts[id] = Object.assign(S.opts[id], d.opts[id]); });
    } catch (e) { /* 壊れた下書きは捨てる */ }
  }
  function save() { store(DRAFT, JSON.stringify({ qty: S.qty, opts: S.opts })); }

  // 1 行の扱い: 金額 / ヒアリング後にご提示 / SIer・パートナーが用意(この見積に含めない)
  function lineOf(o) {
    var st = S.opts[o.id];
    if (!st || !st.on) return null;
    var q = (o.max || 1) > 1 ? st.qty : 1;
    if (o.who && st.who === 'sier') return { o: o, qty: q, kind: 'outside', amount: 0 };
    if (o.later) return { o: o, qty: q, kind: 'later', amount: 0 };
    return { o: o, qty: q, kind: 'price', amount: o.price * q };
  }
  function totals() {
    var t = { body: CFG.bodyPrice * S.qty, extra: 0, lines: [], later: [], outside: [] };
    OPTS.forEach(function (o) {
      var l = lineOf(o); if (!l) return;
      if (l.kind === 'price') { t.extra += l.amount; t.lines.push(l); }
      else if (l.kind === 'later') t.later.push(l);
      else t.outside.push(l);
    });
    t.total = t.body + t.extra;
    return t;
  }

  // ---------------------------------------------------------------- 3D へ
  function sceneState() {
    var on = function (id) { return !!(S.opts[id] && S.opts[id].on); };
    return {
      momaQty: S.qty, crx: true,
      charger: on('charger') ? S.opts.charger.qty : 0,
      tablet: on('tablet'),
      ee: on('ee') ? 'gripper' : null,
      eeSupplied: on('ee') && S.opts.ee.who === 'sier',
      camera: on('camera'),
      panel: on('panel') ? 1 : 0,
      estop: on('estop'),
      docs: 0, crew: {},
      dark: document.documentElement.getAttribute('data-theme') === 'dark'
    };
  }
  function sendScene() { if (window.lxQuoteScene) window.lxQuoteScene.set(sceneState()); }
  function fx(part, kind) { if (window.lxQuoteScene && part) window.lxQuoteScene.fx(part, kind); }
  document.addEventListener('lx-quote-scene-ready', sendScene);
  document.addEventListener('lx-quote-scene-failed', function () { $('#sceneFallback').hidden = false; });
  document.addEventListener('lx-theme', sendScene);

  // ---------------------------------------------------------------- 描画
  function qtyCtl(val, min, max, unit, attr) {
    return '<span class="qty"><button type="button" ' + attr + ' data-d="-1" aria-label="減らす"' + (val <= min ? ' disabled' : '') + '>−</button>' +
      '<output>' + val + '</output><span class="unit">' + esc(unit) + '</span>' +
      '<button type="button" ' + attr + ' data-d="1" aria-label="増やす"' + (val >= max ? ' disabled' : '') + '>+</button></span>';
  }
  function renderBody() {
    $('#bodyPrice').textContent = yen(CFG.bodyPrice);
    $('#bodyIncl').innerHTML = (BODY.includes || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
    $('#bodyQty').innerHTML = qtyCtl(S.qty, 1, BODY.max || 10, BODY.unit || '台', 'data-body');
  }
  function priceText(o, st) {
    if (o.who && st.who === 'sier') return '<span class="muted">この見積に含めない</span>';
    if (o.later) return '<span class="muted">ヒアリング後にご提示</span>';
    var q = (o.max || 1) > 1 ? st.qty : 1;
    return yen(o.price * q) + (q > 1 ? '<small>' + yen(o.price) + ' × ' + q + '</small>' : '');
  }
  function renderOpts() {
    $('#opts').innerHTML = OPTS.map(function (o) {
      var st = S.opts[o.id], on = st.on;
      var h = '<div class="opt' + (on ? ' on' : '') + '" data-id="' + esc(o.id) + '">';
      h += '<button type="button" class="opt-toggle" role="checkbox" aria-checked="' + on + '" data-toggle>' +
        '<span class="box" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>' +
        '<span class="opt-main"><span class="opt-name">' + esc(o.name) + '</span><span class="opt-desc">' + esc(o.desc || '') + '</span></span>' +
        '<span class="opt-side"><span class="tag">' + esc(o.cat) + '</span><span class="opt-price">' + (on ? priceText(o, st) : (o.later ? '<span class="muted">ヒアリング後にご提示</span>' : yen(o.price) + '<small>/ ' + esc(o.unit) + '</small>')) + '</span></span>' +
        '</button>';
      if (on && ((o.max || 1) > 1 || o.who)) {
        h += '<div class="opt-more">';
        if ((o.max || 1) > 1) h += '<span class="row-label">数量</span>' + qtyCtl(st.qty, 1, o.max, o.unit, 'data-q');
        if (o.who) h += '<span class="row-label">用意するのは</span><span class="seg" role="radiogroup">' +
          [['sier', 'SIer・パートナー'], ['lp', 'LexxPluss に相談']].map(function (w) {
            return '<button type="button" role="radio" data-who="' + w[0] + '" aria-checked="' + (st.who === w[0]) + '">' + w[1] + '</button>';
          }).join('') + '</span>';
        h += '</div>';
      }
      return h + '</div>';
    }).join('');
    $('#hearing').innerHTML = (window.QUOTE_HEARING || []).map(function (x) { return '<li><span class="tag soft">' + esc(x.cat) + '</span>' + esc(x.name) + '</li>'; }).join('');
  }
  function renderSummary() {
    var t = totals();
    var h = '<h2>お見積り内容</h2><table class="sum"><tbody>';
    h += '<tr class="grp"><th colspan="2">本体標準価格</th></tr>';
    h += '<tr><td>LexxMoMa 本体 × ' + S.qty + ' 台</td><td class="r">' + yen(t.body) + '</td></tr>';
    h += '<tr class="grp"><th colspan="2">別途費用</th></tr>';
    h += t.lines.length ? t.lines.map(function (l) { return '<tr><td>' + esc(l.o.name) + (l.qty > 1 ? ' × ' + l.qty + ' ' + esc(l.o.unit) : '') + '</td><td class="r">' + yen(l.amount) + '</td></tr>'; }).join('')
      : '<tr><td class="muted" colspan="2">金額の決まっているオプションは選ばれていません</td></tr>';
    var later = t.later.map(function (l) { return l.o.name; }).concat((window.QUOTE_HEARING || []).map(function (x) { return x.name; }));
    h += '<tr><td colspan="2" class="later"><span>ヒアリング後にご提示</span>' + esc(later.join('、')) + '</td></tr>';
    if (t.outside.length) h += '<tr><td colspan="2" class="later"><span>SIer・パートナーが用意(この見積に含めない)</span>' + esc(t.outside.map(function (l) { return l.o.name; }).join('、')) + '</td></tr>';
    h += '</tbody><tfoot><tr><th>表示中の合計(税別)</th><td class="r"><b id="sumTotal">' + yen(t.total) + '</b></td></tr></tfoot></table>';
    h += '<p class="sum-note">本体 ' + yen(t.body) + ' + 別途費用 ' + yen(t.extra) + '。ヒアリング後にご提示する項目は含みません。</p>';
    $('#summary').innerHTML = h;
  }
  function renderStep() {
    for (var i = 0; i < STEPS; i++) $('#step' + i).hidden = i !== S.step;
    $('#done').hidden = S.step !== STEPS;
    $('#flowNav').hidden = S.step === STEPS;
    document.querySelectorAll('#stepper li').forEach(function (li) {
      var n = +li.dataset.step;
      li.className = n === S.step ? 'on' : n < S.step ? 'past' : '';
      li.querySelector('button').setAttribute('aria-current', n === S.step ? 'step' : 'false');
      li.querySelector('button').disabled = S.step === STEPS;
    });
    $('#back').disabled = S.step === 0;
    $('#next').textContent = S.step === 0 ? 'オプションを選ぶ' : S.step === 1 ? '依頼内容の入力へ' : 'この内容で見積を依頼する';
  }
  function render() { renderBody(); renderOpts(); renderSummary(); renderStep(); }

  function commit() { save(); sendScene(); renderBody(); renderOpts(); renderSummary(); }

  function go(n) {
    S.step = Math.max(0, Math.min(STEPS - 1, n));
    renderStep();
    if (window.lxQuoteScene) window.lxQuoteScene.focus(null);
    var p = document.querySelector('.flow'); if (p && p.getBoundingClientRect().top < 0) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
    track('quote/step' + (S.step + 1), '見積依頼のステップ ' + (S.step + 1));
  }

  // ---------------------------------------------------------------- 操作
  function onBodyClick(e) {
    var b = e.target.closest('[data-body]'); if (!b) return;
    var q = Math.max(1, Math.min(BODY.max || 10, S.qty + (+b.dataset.d)));
    if (q === S.qty) return;
    S.qty = q; fx('moma', 'bump'); commit();
  }
  function onOptClick(e) {
    var row = e.target.closest('.opt'); if (!row) return;
    var o = BY[row.dataset.id], st = S.opts[o.id], b;
    if ((b = e.target.closest('[data-toggle]'))) {
      st.on = !st.on;
      if (st.on) {
        var l = lineOf(o);
        floatText(l.kind === 'price' ? '+' + yen(l.amount) : o.name, o.part);
        fx(o.part, 'add');
        if (window.lxQuoteScene) window.lxQuoteScene.focus(o.part);
        track('quote/add/' + o.id, '見積にオプションを追加');
      } else { floatText('− ' + o.name, o.part, true); fx(o.part, 'remove'); }
    } else if ((b = e.target.closest('[data-q]'))) {
      st.qty = Math.max(1, Math.min(o.max, st.qty + (+b.dataset.d))); fx(o.part, 'bump');
    } else if ((b = e.target.closest('[data-who]'))) {
      st.who = b.dataset.who; fx(o.part, 'bump');
    } else return;
    commit();
  }

  var toastT = 0;
  function toast(msg) {
    var el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }
  function floatText(text, part, minus) {
    var el = document.createElement('span');
    el.className = 'float' + (minus ? ' minus' : '');
    el.textContent = text;
    var p = window.lxQuoteScene && part ? window.lxQuoteScene.screenPos(part) : null;
    el.style.left = (p ? p.x : 50) + '%'; el.style.top = (p ? p.y : 45) + '%';
    $('#floats').appendChild(el);
    setTimeout(function () { el.remove(); }, 1400);
  }

  // ---------------------------------------------------------------- 価格の考え方(はじめに確認)
  function setupPolicy() {
    var dlg = $('#policy');
    $('#policyPrice').textContent = yen(CFG.bodyPrice);
    dlg.addEventListener('cancel', function (e) { if (store(AGREED) !== String(CFG.policyVersion)) e.preventDefault(); });   // 確認するまで閉じない
    $('#agree').addEventListener('click', function () { store(AGREED, String(CFG.policyVersion)); dlg.close(); track('quote/policy', '価格の考え方を確認した'); });
    $('#openPolicy').addEventListener('click', function () { dlg.showModal(); });
    if (store(AGREED) !== String(CFG.policyVersion)) dlg.showModal();
  }

  // ---------------------------------------------------------------- 送信
  function setupForm() {
    var P = window.QUOTE_PARTNERS || {};
    ['sier', 'trader'].forEach(function (k) {
      $('#' + k + 'List').innerHTML = (P[k] || []).map(function (x) { return '<option value="' + esc(x) + '"></option>'; }).join('');
    });
    $('#testNote').hidden = !!CFG.endpoint;
    $('#channels').innerHTML = (window.QUOTE_CHANNELS || []).map(function (x) {
      return '<label class="chip"><input type="radio" name="channel" value="' + esc(x.id) + '"><span>' + esc(x.label) + '</span></label>';
    }).join('');
    if (CFG.privacyUrl) $('#privacy').innerHTML = '送信した内容は、お見積りとご連絡のためにのみ使います(<a href="' + esc(CFG.privacyUrl) + '" target="_blank" rel="noopener">プライバシーポリシー</a>)。';
    $('#step2').addEventListener('submit', function (e) { e.preventDefault(); send(); });
  }
  function send() {
    var f = $('#step2'), err = $('#err');
    var val = function (n) { var el = f.elements[n]; return el ? String(el.value || '').trim() : ''; };
    var channel = (f.querySelector('input[name=channel]:checked') || {}).value || '';
    if (!val('company') || !val('name') || !val('email')) { err.textContent = '会社名・お名前・メールアドレスを入れてください。'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val('email'))) { err.textContent = 'メールアドレスの形式を確かめてください(例: name@example.co.jp)。'; return; }
    if (!channel) { err.textContent = '進めたい経路を 1 つ選んでください。'; return; }
    err.textContent = '';
    var t = totals();
    var body = {
      v: 3, website: val('website'),
      company: val('company'), name: val('name'), email: val('email'),
      channel: channel, sier: val('sier'), trader: val('trader'), message: val('message'),
      qty: S.qty, body: t.body, extra: t.extra, total: t.total, catalog: CFG.updated || '',
      items: t.lines.map(function (l) { return { id: l.o.id, qty: l.qty }; }),
      later: t.later.map(function (l) { return l.o.id; }),
      outside: t.outside.map(function (l) { return l.o.id; })
    };
    var btn = $('#next');
    btn.disabled = true; btn.textContent = '送っています…';
    var done = function (id) {
      btn.disabled = false;
      S.step = STEPS; $('#doneId').textContent = id; renderStep();
      fx('all', 'finish');
      track('quote/request', '見積を依頼した');
    };
    if (!CFG.endpoint) { setTimeout(function () { done('TEST-' + Date.now().toString(36).toUpperCase()); }, 400); return; }
    // text/plain で送ると CORS のプリフライトが起きない(Apps Script は OPTIONS を受けられないため)
    fetch(CFG.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (res) { if (!res || !res.ok) throw new Error(res && res.error || 'send'); done(res.id); })
      .catch(function (ex) {
        btn.disabled = false; renderStep();
        err.textContent = (ex && ex.message && ex.message !== 'send' && ex.message.indexOf('fetch') < 0 ? ex.message + ' ' : '送れませんでした。') +
          '時間をおいてもう一度お試しいただくか、' + (CFG.contactWeb ? 'LexxPluss のお問い合わせ窓口(' + CFG.contactWeb + ')' : 'LexxPluss') + 'へご連絡ください。';
      });
  }

  // ---------------------------------------------------------------- 開始
  load();
  render();
  setupForm();
  setupPolicy();
  $('#bodyQty').addEventListener('click', onBodyClick);
  $('#opts').addEventListener('click', onOptClick);
  $('#stepper').addEventListener('click', function (e) { var li = e.target.closest('li'); if (li && S.step < STEPS) go(+li.dataset.step); });
  $('#back').addEventListener('click', function () { go(S.step - 1); });
  $('#next').addEventListener('click', function () { if (S.step === STEPS - 1) send(); else go(S.step + 1); });
  $('#again').addEventListener('click', function () { $('#step2').reset(); go(0); });
  $('#spin').addEventListener('click', function () {
    var p = this.getAttribute('aria-pressed') !== 'true';
    this.setAttribute('aria-pressed', p ? 'true' : 'false');
    this.textContent = p ? '回転を止める' : '回転させる';
    if (window.lxQuoteScene) window.lxQuoteScene.spin(p);
  });
  setTimeout(function () { if (!window.lxQuoteScene) $('#sceneFallback').hidden = false; }, 10000);
  track('quote/open', '3D 見積依頼を開いた');
})();
