/* 顧客人事データベース(LexxPluss 社内) — 暗号化データを共通パスワードで復号し、企業ごとの役員・在任・組織・営業シグナルを見る。
 * データ: data.enc.json = PBKDF2-SHA256 → AES-256-GCM(people/crawler/build.py が作成。工場マップと同じ方式)
 * 依存: なし(バニラ JS)。URL には会社 ID と画面名だけを載せ、氏名は載せない。
 */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var KEY_STORE = 'lx_people_key_v1';
  var REVIEW_STORE = 'lx_people_reviews_draft';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function b64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function ub64(u) { var s = ''; u = new Uint8Array(u); for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  function track(p, t) { try { if (window.lxTrack) window.lxTrack(p, t); } catch (e) { /* 計測不可 */ } }
  function dl(name, text) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---------------------------------------------------------------- 入口(工場マップと同じ)
  var ENC = null;
  function loadEnc() {
    if (ENC) return Promise.resolve(ENC);
    if (window.PEOPLE_ENC) { ENC = window.PEOPLE_ENC; return Promise.resolve(ENC); }
    return fetch('data.enc.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('data'); return r.json(); }).then(function (j) { ENC = j; return j; });
  }
  function deriveKey(pw, enc) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(enc.salt), iterations: enc.iter }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
    });
  }
  function decrypt(key, enc) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct)).then(function (buf) {
      if (enc.z !== 'deflate') return JSON.parse(new TextDecoder().decode(buf));
      // build.py が zlib(deflate) で縮めてから暗号化している → DecompressionStream で戻す
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
  function showGateError(msg) { $('#gateErr').textContent = msg; $('#gateBtn').disabled = false; $('#gateBtn').textContent = '開く'; }
  if (!window.crypto || !crypto.subtle) showGateError('このブラウザでは開けません(https で開いてください)。');

  $('#gateForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = $('#pw').value; if (!pw) return;
    $('#gateBtn').disabled = true; $('#gateBtn').textContent = '確認中…'; $('#gateErr').textContent = '';
    loadEnc().then(function (enc) {
      return deriveKey(pw, enc).then(function (key) {
        return decrypt(key, enc).then(function (data) { $('#pw').value = ''; return saveKey(key, enc.salt, $('#remember').checked).then(function () { start(data); }); });
      });
    }).catch(function (err) {
      var m = err && err.message;
      showGateError(m === 'data' ? 'データを読み込めませんでした。時間をおいて再度お試しください。' : m === 'nozip' ? 'このブラウザでは開けません(最新の Chrome / Safari / Edge で開いてください)。' : 'パスワードが違います。');
    });
  });
  loadEnc().then(function (enc) {
    return storedKey().then(function (s) {
      if (!s || s.salt !== enc.salt) { forgetKey(); return; }
      return decrypt(s.key, enc).then(start).catch(forgetKey);
    });
  }).catch(function () { /* 入口のまま */ });

  // ---------------------------------------------------------------- 本体
  var D, CO = {}, P = {}, U = {}, S = {}, T_BY_CO = {}, P_BY_CO = {}, E_BY_CO = {}, SG_BY_CO = {}, U_BY_CO = {};
  var state = { view: 'companies', co: null, sub: 'signals', q: '', sort: 'prio', onlyData: true, unitFilter: '', days: 30, inds: {} };
  var reviews = {};
  try { reviews = JSON.parse(localStorage.getItem(REVIEW_STORE) || '{}'); } catch (e) { reviews = {}; }
  var COLORS = ['#0068B7', '#3EB370', '#E8A33D', '#D6496E', '#7B61C9', '#2BA6B8', '#8A6D3B', '#5C7A99', '#C45A2A', '#6FA83A', '#A3478F', '#4C6EF5'];
  // 業種(工場マップと同じ並び・同じ色)
  var INDUSTRIES = ['自動車(完成車)', '自動車部品', '半導体・電子部品', '半導体製造装置', '工作機械', '産業機械・ロボット', '電機・精密', '化学・素材', '鉄鋼・非鉄', '食品・飲料', '医薬・医療'];
  function indColor(ind) { var i = INDUSTRIES.indexOf(ind); return COLORS[i < 0 ? 0 : i % COLORS.length]; }
  var EV_LABEL = { appointed: '新任', resigned: '退任', title_changed: '役職変更', unit_renamed: '組織改称', unit_merged: '組織統合', concurrent_released: '兼務解消', new_ceo: '代表交代' };
  var LISTING = { listed: '上場', listed_parent: '親会社上場', unlisted: '非上場' };

  function start(data) {
    D = data;
    D.companies.forEach(function (c) { CO[c.id] = c; });
    D.persons.forEach(function (p) { P[p.id] = p; (P_BY_CO[p.company_id] = P_BY_CO[p.company_id] || []).push(p); });
    D.tenures.forEach(function (t) { (T_BY_CO[t.company_id] = T_BY_CO[t.company_id] || []).push(t); });
    D.org_units.forEach(function (u) { U[u.id] = u; (U_BY_CO[u.company_id] = U_BY_CO[u.company_id] || []).push(u); });
    D.events.forEach(function (e) { (E_BY_CO[e.company_id] = E_BY_CO[e.company_id] || []).push(e); });
    D.signals.forEach(function (s) { (SG_BY_CO[s.company_id] = SG_BY_CO[s.company_id] || []).push(s); });
    D.sources.forEach(function (s) { S[s.id] = s; });
    D.signals.forEach(function (s) { if (s.review_status && !reviews[s.id]) reviews[s.id] = { status: s.review_status, reviewed_by: s.reviewed_by, comment: s.review_comment, at: null, committed: true }; });
    $('#gate').hidden = true; $('#app').hidden = false;
    bind(); readHash(); render();
    $('#foot').innerHTML = esc(D.builtAt) + ' ビルド。企業 ' + D.companies.length + ' 社(人事データあり ' + Object.keys(P_BY_CO).length + ' 社)・人物 ' + D.persons.length + ' 名・在任 ' + D.tenures.length + ' 件・シグナル ' + D.signals.length + ' 件。' +
      '出所は有価証券報告書(EDINET)・適時開示(TDnet)・各社サイト。値ごとに出典と取得日を表示しています。';
    track('member/people-db/open', '顧客人事DBを開いた');
  }

  function bind() {
    document.querySelectorAll('#mainTabs [data-view]').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.view, null); }); });
    document.querySelectorAll('#subTabs [data-sub]').forEach(function (b) { b.addEventListener('click', function () { state.sub = b.dataset.sub; writeHash(); renderCompany(); }); });
    var qt; $('#q').addEventListener('input', function () { var v = this.value; clearTimeout(qt); qt = setTimeout(function () { state.q = v.trim(); renderCompanies(); }, 150); });
    $('#sortCo').addEventListener('change', function () { state.sort = this.value; renderCompanies(); });
    $('#onlyData').addEventListener('change', function () { state.onlyData = this.checked; buildIndChips(); renderCompanies(); });
    $('#indChips').addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      var i = b.dataset.ind; if (state.inds[i]) delete state.inds[i]; else state.inds[i] = 1;
      b.classList.toggle('on', !!state.inds[i]); renderCompanies();
      if (state.inds[i]) track('member/people-db/industry', i);
    });
    $('#back').addEventListener('click', function () { go('companies', null); });
    $('#lock').addEventListener('click', function () { forgetKey(); location.hash = ''; location.reload(); });
    $('#daysFilter').addEventListener('change', function () { state.days = +this.value; renderNews(); });
    $('#copySlack').addEventListener('click', copySlack);
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#drawerBg').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
    window.addEventListener('hashchange', function () { readHash(); render(); });
    buildIndChips();
  }
  function buildIndChips() {
    var cnt = {};
    D.companies.forEach(function (c) { if (!state.onlyData || (P_BY_CO[c.id] || []).length) cnt[c.industry] = (cnt[c.industry] || 0) + 1; });
    var inds = INDUSTRIES.filter(function (i) { return cnt[i]; }).concat(Object.keys(cnt).filter(function (i) { return INDUSTRIES.indexOf(i) < 0 && i !== 'undefined'; }));
    $('#indChips').innerHTML = inds.map(function (i) {
      return '<button type="button" class="chip' + (state.inds[i] ? ' on' : '') + '" data-ind="' + esc(i) + '"><i style="background:' + indColor(i) + '"></i>' + esc(i) + '<span>' + cnt[i] + '</span></button>';
    }).join('');
  }
  function go(view, co) { state.view = view; state.co = co; writeHash(); render(); }
  function readHash() {
    var h = {}; location.hash.replace(/^#/, '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) h[p[0]] = decodeURIComponent(p[1] || ''); });
    if (h.fm) {
      var hit = D.companies.filter(function (c) { return (c.factory_map_ids || []).indexOf(h.fm) >= 0; })[0];
      if (hit) { h.c = hit.id; history.replaceState(null, '', '#c=' + encodeURIComponent(hit.id) + '&tab=signals'); }
    }
    if (h.c && CO[h.c]) { state.view = 'company'; state.co = h.c; state.sub = h.tab || 'signals'; }
    else if (h.v) { state.view = h.v; state.co = null; }
  }
  function writeHash() {
    var h = state.view === 'company' && state.co ? 'c=' + encodeURIComponent(state.co) + '&tab=' + state.sub : (state.view !== 'companies' ? 'v=' + state.view : '');
    if (('#' + h) !== location.hash && !(h === '' && location.hash === '')) history.replaceState(null, '', h ? '#' + h : location.pathname);
  }
  function render() {
    ['companies', 'company', 'news', 'quality'].forEach(function (v) { $('#view-' + v).hidden = state.view !== v; });
    document.querySelectorAll('#mainTabs [data-view]').forEach(function (b) { b.classList.toggle('on', b.dataset.view === state.view || (state.view === 'company' && b.dataset.view === 'companies')); });
    if (state.view === 'companies') renderCompanies();
    else if (state.view === 'company') renderCompany();
    else if (state.view === 'news') renderNews();
    else if (state.view === 'quality') renderQuality();
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- 企業一覧
  function coText(c) {
    var parts = [c.name, c.short_name, c.group || ''];
    (P_BY_CO[c.id] || []).forEach(function (p) { parts.push(p.name, p.name.replace(/\s/g, '')); parts = parts.concat(p.current_titles || []); });
    (U_BY_CO[c.id] || []).forEach(function (u) { parts.push(u.name); (u.former_names || []).forEach(function (f) { parts.push(f.name); }); });
    return parts.join(' ').toLowerCase();
  }
  function lastEventText(c) {
    var es = (E_BY_CO[c.id] || []).filter(function (e) { return e.date; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    if (!es.length) return c.last_event ? c.last_event : 'イベントなし';
    var d = es[0].date, cnt = {};
    es.filter(function (e) { return e.date === d; }).forEach(function (e) { cnt[e.type] = (cnt[e.type] || 0) + 1; });
    return d + ' ' + Object.keys(cnt).map(function (k) { return (EV_LABEL[k] || k) + cnt[k] + '件'; }).join('・');
  }
  function renderCompanies() {
    var q = state.q.toLowerCase(), terms = q ? q.split(/\s+/) : [];
    var list = D.companies.filter(function (c) {
      if (state.onlyData && !(P_BY_CO[c.id] || []).length) return false;
      if (Object.keys(state.inds).length && !state.inds[c.industry]) return false;
      if (!terms.length) return true;
      var t = coText(c); return terms.every(function (w) { return t.indexOf(w) >= 0; });
    });
    list.sort(function (a, b) {
      if (state.sort === 'name') return a.short_name.localeCompare(b.short_name, 'ja');
      if (state.sort === 'event') return (b.last_event || '') < (a.last_event || '') ? -1 : (b.last_event || '') > (a.last_event || '') ? 1 : 0;
      return (a.priority - b.priority) || ((b.last_event || '') < (a.last_event || '') ? -1 : (b.last_event || '') > (a.last_event || '') ? 1 : 0) || a.short_name.localeCompare(b.short_name, 'ja');
    });
    var indSel = Object.keys(state.inds);
    $('#coRes').textContent = list.length + ' 社' + (indSel.length ? '(業種: ' + indSel.join('・') + ')' : '') + (terms.length ? '(検索: ' + state.q + ')' : '');
    $('#coList').innerHTML = list.length ? list.map(function (c) {
      var sg = (SG_BY_CO[c.id] || []).filter(function (s) { return !(reviews[s.id] && reviews[s.id].status === 'hidden'); }).length;
      return '<button type="button" class="co" data-co="' + esc(c.id) + '">' +
        '<span class="t"><i class="dot" style="background:' + indColor(c.industry) + '"></i>' + esc(c.short_name) + ' <span class="badge ' + esc(c.listing_status) + '">' + esc(LISTING[c.listing_status] || c.listing_status) + (c.securities_code ? ' ' + esc(c.securities_code) : '') + '</span>' +
        '</span>' +
        '<span class="m">' + (c.group ? esc(c.group) + ' グループ · ' : '') + esc(c.industry || '') + ' · 直近: ' + esc(lastEventText(c)) + '</span>' +
        '<span class="n"><b>' + (c.officer_count || 0) + '</b>役員 · ' + ((P_BY_CO[c.id] || []).length) + '名 · シグナル ' + sg + '</span></button>';
    }).join('') : '<div class="empty">該当する会社がありません' + (state.onlyData ? '(「人事データのある会社だけ」を外すと全社が出ます)' : '') + '</div>';
    document.querySelectorAll('#coList .co').forEach(function (b) { b.addEventListener('click', function () { state.sub = 'signals'; go('company', b.dataset.co); track('member/people-db/company', CO[b.dataset.co].short_name); }); });
  }

  // ---------------------------------------------------------------- 企業詳細
  function srcLink(id) {
    var s = S[id]; if (!s) return '<span class="faint">出典 ' + esc(id) + '</span>';
    var label = { yuho: '有報', tdnet: '適時開示', website: '会社サイト', manual: '手動投入' }[s.kind] || s.kind;
    var inner = esc(label) + ': ' + esc(s.title || '') + ' <span class="faint">(取得 ' + esc(s.retrieved_at || '') + ')</span>';
    return s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + inner + '</a>' : '<span>' + inner + '</span>';
  }
  function statusBadge(st) { return st === 'planned' ? '<span class="badge planned">予定</span>' : st === 'inferred' ? '<span class="badge">推定</span>' : ''; }
  function renderCompany() {
    var c = CO[state.co]; if (!c) { go('companies', null); return; }
    document.querySelectorAll('#subTabs [data-sub]').forEach(function (b) { b.classList.toggle('on', b.dataset.sub === state.sub); });
    var fm = c.factory_map_ids && c.factory_map_ids[0];
    $('#coHead').innerHTML = '<h2>' + esc(c.name) + '</h2><div class="meta"><span class="badge ' + esc(c.listing_status) + '">' + esc(LISTING[c.listing_status] || '') + '</span>' +
      (c.securities_code ? '<span>証券コード ' + esc(c.securities_code) + '</span>' : '') + (c.edinet_code ? '<span>EDINET ' + esc(c.edinet_code) + '</span>' : '') +
      (c.group ? '<span>' + esc(c.group) + ' グループ</span>' : '') + (c.parent_name ? '<span>親会社: ' + esc(c.parent_name) + '</span>' : '') + '</div>' +
      '<div class="links">' + (fm ? '<a class="btn small" href="../factory-map/index.html#co=' + encodeURIComponent(fm) + '">🏭 工場マップでこの会社の拠点を見る</a>' : '') +
      (c.ir_urls && c.ir_urls.executives ? '<a href="' + esc(c.ir_urls.executives) + '" target="_blank" rel="noopener">役員一覧(会社サイト)</a>' : '') +
      (c.web ? '<a href="' + esc(c.web) + '" target="_blank" rel="noopener">会社サイト</a>' : '') + '</div>';
    var body = $('#subBody');
    if (!(P_BY_CO[c.id] || []).length) {
      body.innerHTML = '<div class="empty">この会社の人事データはまだありません(' + esc(LISTING[c.listing_status] || '') + '。' +
        (c.listing_status === 'listed' ? '有価証券報告書が未取得です。EDINET API キーの取得後に収集します' : '有価証券報告書が無いため、会社サイトの役員一覧から収集します') + ')。</div>';
      return;
    }
    if (state.sub === 'signals') body.innerHTML = renderSignals(c);
    else if (state.sub === 'lineage') body.innerHTML = renderLineage(c);
    else if (state.sub === 'units') body.innerHTML = renderUnits(c);
    else body.innerHTML = renderPeople(c);
    body.querySelectorAll('[data-person]').forEach(function (b) { b.addEventListener('click', function () { openDrawer(b.dataset.person); }); });
    body.querySelectorAll('[data-review]').forEach(function (b) { b.addEventListener('click', function () { setReview(b.dataset.sig, b.dataset.review); }); });
    body.querySelectorAll('[data-comment]').forEach(function (inp) { inp.addEventListener('change', function () { var r = reviews[inp.dataset.comment] || (reviews[inp.dataset.comment] = {}); r.comment = inp.value; r.at = D.builtAt; r.committed = false; saveReviews(); }); });
    var ex = body.querySelector('#exportReviews'); if (ex) ex.addEventListener('click', exportReviews);
    var uf = body.querySelector('#unitFilter'); if (uf) uf.addEventListener('change', function () { state.unitFilter = uf.value; renderCompany(); });
  }
  // 面談先候補: 現職の担当領域が LexxMoMa の検討に関わる人(事実だけ。解釈は付けない)
  var KEY_AREAS = [['生産・製造', /(生産|製造|ものづくり|モノづくり|工場|製作所|事業所長)/], ['生産技術・設備', /(生産技術|生技|工機|設備|エンジニアリング|製造技術)/],
    ['DX・デジタル', /(DX|デジタル|IT|情報システム|スマート)/], ['調達・購買', /(調達|購買|資材部|資材本部)/], ['品質', /(品質)/], ['物流', /(物流|ロジスティクス)/], ['経営企画・投資', /(経営企画|原価|投資)/]];
  function keyPeople(c) {
    var rows = [];
    (P_BY_CO[c.id] || []).forEach(function (p) {
      var t = (p.current_titles || []).join(' / ');
      if (!t || /予定/.test(t)) return;
      var hits = KEY_AREAS.filter(function (a) { return a[1].test(t); }).map(function (a) { return a[0]; });
      if (hits.length) rows.push({ p: p, t: t, hits: hits });
    });
    return rows.sort(function (a, b) { return rankOrder(a.p) - rankOrder(b.p); });
  }
  function renderKeyPeople(c) {
    var rows = keyPeople(c);
    if (!rows.length) return '';
    return '<section class="card" style="margin-bottom:12px"><h3>面談先候補(担当領域から抽出)</h3>' +
      '<p class="muted" style="margin:0 0 6px">現職の役職名に生産・生産技術・DX・調達などが含まれる役員です(事実のみ。役職名は出典の記載どおり)。</p>' +
      '<div class="people">' + rows.map(function (r) {
        return '<button type="button" class="person" data-person="' + esc(r.p.id) + '"><span class="t">' + esc(r.p.name) + '</span><span class="m">' + esc(r.t) + '</span>' +
          '<span class="m">' + r.hits.map(function (h) { return '<span class="badge">' + esc(h) + '</span>'; }).join(' ') + '</span></button>';
      }).join('') + '</div></section>';
  }
  function renderSignals(c) {
    var sgs = (SG_BY_CO[c.id] || []).slice().sort(function (a, b) { return (a.level === 'high' ? 0 : 1) - (b.level === 'high' ? 0 : 1); });
    var kp = renderKeyPeople(c);
    if (!sgs.length) return kp + '<div class="empty">規則で生成したシグナルはまだありません(異動の履歴が 2 時点以上そろうと出ます)。</div>';
    var pending = sgs.filter(function (s) { return !reviews[s.id] || !reviews[s.id].status; }).length;
    return kp + '<div class="toolbar"><span class="muted">規則で生成した解釈は <b>すべてレビュー待ち</b> です(未確認 ' + pending + ' 件)。「確認済」にしたものだけを営業トークに使ってください。</span><button class="btn small" id="exportReviews" type="button">レビューを書き出す(manual/reviews.json)</button></div>' +
      sgs.map(function (s) {
        var rv = reviews[s.id] || {}, p = P[s.person_id];
        return '<article class="sig ' + esc(s.level) + (rv.status === 'hidden' ? ' hidden-sig' : '') + '"><h3><span class="badge ' + esc(s.level) + '">' + (s.level === 'high' ? '重要' : '中') + '</span>' + esc(s.title) +
          (s.is_speculative ? '<span class="badge spec" title="推測を含む解釈">推測</span>' : '<span class="badge">事実ベース</span>') +
          (rv.status === 'confirmed' ? '<span class="badge listed">確認済' + (rv.reviewed_by ? ': ' + esc(rv.reviewed_by) : '') + '</span>' : rv.status === 'hidden' ? '<span class="badge">非表示</span>' : '<span class="badge planned">レビュー待ち</span>') + '</h3>' +
          '<dl><dt>事実</dt><dd>' + esc(s.fact) + (p ? ' <button type="button" class="link-btn inline" data-person="' + esc(p.id) + '">略歴</button>' : '') + '<div class="src">' + (s.source_ids || []).map(srcLink).join('') + '</div></dd>' +
          '<dt>解釈</dt><dd>' + esc(s.interpretation) + '</dd><dt>面談で確認</dt><dd>' + esc(s.verify_question) + '</dd>' +
          '<dt>規則</dt><dd><span class="faint">' + esc(s.rule_name || s.rule) + ' · 生成 ' + esc(s.created_at) + '</span></dd></dl>' +
          '<div class="review"><button type="button" class="btn small' + (rv.status === 'confirmed' ? ' on' : '') + '" data-sig="' + esc(s.id) + '" data-review="confirmed">確認済</button>' +
          '<button type="button" class="btn small' + (rv.status === 'hidden' ? ' on' : '') + '" data-sig="' + esc(s.id) + '" data-review="hidden">非表示</button>' +
          '<button type="button" class="btn small" data-sig="' + esc(s.id) + '" data-review="">取消</button>' +
          '<input type="text" placeholder="コメント(公開情報の範囲で)" value="' + esc(rv.comment || '') + '" data-comment="' + esc(s.id) + '"></div></article>';
      }).join('');
  }
  function setReview(id, status) {
    var r = reviews[id] || (reviews[id] = {});
    if (!status) { delete reviews[id]; } else {
      r.status = status; r.at = D.builtAt; r.committed = false;
      if (!r.reviewed_by) { var who = prompt('レビューした人の氏名'); if (!who) { delete r.status; return; } r.reviewed_by = who; }
    }
    saveReviews(); renderCompany();
  }
  function saveReviews() { try { localStorage.setItem(REVIEW_STORE, JSON.stringify(reviews)); } catch (e) { /* 保存不可 */ } }
  function exportReviews() {
    var out = {}; Object.keys(reviews).forEach(function (k) { if (reviews[k].status) out[k] = { status: reviews[k].status, reviewed_by: reviews[k].reviewed_by || null, comment: reviews[k].comment || '', at: reviews[k].at || D.builtAt }; });
    dl('reviews.json', JSON.stringify(out, null, 1));
    track('member/people-db/export-reviews', 'レビューを書き出した');
  }

  // 役職の系譜: 行=人物、列=年(直近 10 年)、セル色=本部
  function rankOrder(p) {
    var t = (p.current_titles || [])[0] || '';
    return /代表取締役/.test(t) ? 0 : /会長/.test(t) ? 1 : /専務/.test(t) ? 2 : /常務取締役/.test(t) ? 3 : /取締役/.test(t) ? 4 : /監査役/.test(t) ? 5 : /常務執行役員/.test(t) ? 6 : /執行役員/.test(t) ? 7 : t ? 8 : 9;
  }
  function abbr(rank) {
    if (!rank) return '';
    var m = [['代表取締役社長', '社長'], ['代表取締役会長', '会長'], ['代表取締役', '代表'], ['専務取締役', '専務'], ['常務取締役', '常務'], ['取締役', '取'], ['常勤監査役', '常勤監'], ['非常勤監査役', '監'], ['監査役', '監'],
      ['専務執行役員', '専務執'], ['常務執行役員', '常務執'], ['上席執行役員', '上席執'], ['執行役員', '執']];
    for (var i = 0; i < m.length; i++) if (rank.indexOf(m[i][0]) === 0) return m[i][1];
    return rank;
  }
  function mainUnit(t) {
    var d = t.units_detail || [], h = d.filter(function (u) { return u.is_head && u.kind === '本部'; })[0] || d.filter(function (u) { return u.is_head; })[0] || d[0];
    return h ? h.name : (t.rank || '');
  }
  function renderLineage(c) {
    var ps = (P_BY_CO[c.id] || []).slice().sort(function (a, b) { return rankOrder(a) - rankOrder(b) || a.name.localeCompare(b.name, 'ja'); });
    var year = +D.builtAt.slice(0, 4), years = []; for (var y = year - 9; y <= year; y++) years.push(y);
    var ts = (T_BY_CO[c.id] || []).filter(function (t) { return t.scope === 'own'; });
    var unitNames = {}; ts.forEach(function (t) { var u = mainUnit(t); if (u) unitNames[u] = (unitNames[u] || 0) + 1; });
    var units = Object.keys(unitNames).sort(function (a, b) { return unitNames[b] - unitNames[a]; });
    var color = {}; units.forEach(function (u, i) { color[u] = COLORS[i % COLORS.length]; });
    if (state.unitFilter) ps = ps.filter(function (p) { return ts.some(function (t) { return t.person_id === p.id && (t.unit_names || []).indexOf(state.unitFilter) >= 0; }); });
    var allUnits = (U_BY_CO[c.id] || []).filter(function (u) { return u.kind === '本部' || u.kind === '室' || u.kind === '統括' || u.kind === '工場'; });
    var html = '<div class="toolbar"><select id="unitFilter"><option value="">すべての本部・室</option>' + allUnits.map(function (u) { return '<option value="' + esc(u.name) + '"' + (state.unitFilter === u.name ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join('') + '</select>' +
      '<span class="muted">名前を押すと略歴。斜線=予定、薄い色=推定(直接は未確認)。横にスクロールできます。</span></div>' +
      '<div class="legend">' + units.slice(0, 12).map(function (u) { return '<span><i style="--c:' + color[u] + '"></i>' + esc(u) + '</span>'; }).join('') + '<span><i class="planned"></i>予定</span><span><i class="inferred"></i>推定</span></div>' +
      '<div class="lineage-wrap"><table class="lineage"><thead><tr><th>人物</th>' + years.map(function (y) { return '<th>' + y + '</th>'; }).join('') + '<th>現職</th></tr></thead><tbody>';
    ps.forEach(function (p) {
      var mine = ts.filter(function (t) { return t.person_id === p.id; });
      html += '<tr><td><button type="button" class="name-btn" data-person="' + esc(p.id) + '">' + esc(p.name) + '</button>' + (p.is_outside ? ' <span class="faint">社外</span>' : '') + '</td>';
      years.forEach(function (y) {
        var ys = y + '-01', ye = y + '-12';
        var inYear = mine.filter(function (t) { return t.from && t.from <= ye && (!t.to || t.to > ys); }).sort(function (a, b) { return a.from < b.from ? -1 : 1; });
        var t = inYear[inYear.length - 1];
        html += '<td class="cell">' + (t ? '<span class="seg ' + esc(t.status) + '" style="--c:' + color[mainUnit(t)] + '" title="' + esc(t.title_raw + ' ' + t.from + '〜' + (t.to || '')) + '">' + esc(abbr(t.rank)) + (mainUnit(t) !== t.rank ? ' ' + esc(mainUnit(t)) : '') + '</span>' : '') + '</td>';
      });
      html += '<td>' + esc((p.current_titles || []).join(' / ') || '—') + '</td></tr>';
    });
    return html + '</tbody></table></div>';
  }
  function renderUnits(c) {
    var us = (U_BY_CO[c.id] || []).filter(function (u) { return !u.renamed_to && (u.head_person_id || u.former_names.length || u.kind === '本部' || u.kind === '工場' || u.kind === '室' || u.kind === '統括'); })
      .sort(function (a, b) { var k = { 本部: 0, 統括: 1, 室: 2, 工場: 3, 部: 4 }; return (k[a.kind] == null ? 9 : k[a.kind]) - (k[b.kind] == null ? 9 : k[b.kind]) || a.name.localeCompare(b.name, 'ja'); });
    var q = D.quality && D.quality[c.id];
    var html = '<div class="cards">' + us.map(function (u) {
      var h = u.head_person_id && P[u.head_person_id];
      return '<div class="card"><h3>' + esc(u.name) + ' <span class="badge">' + esc(u.kind) + '</span></h3><dl class="kv">' +
        '<dt>責任者</dt><dd>' + (h ? '<button type="button" class="link-btn inline" data-person="' + esc(h.id) + '">' + esc(h.name) + '</button>' + (u.head_since ? ' <span class="faint">' + esc(u.head_since) + '〜</span>' : '') + (u.head_status === 'planned' ? ' <span class="badge planned">予定</span>' : '') : '<span class="faint">不明(役員の兼務としては出ていない)</span>') + '</dd>' +
        (u.former_names.length ? '<dt>改称履歴</dt><dd>' + u.former_names.map(function (f) { return esc(f.name) + ' <span class="faint">(〜' + esc(f.until) + ')</span> ' + (f.source_id ? srcLink(f.source_id) : ''); }).join('<br>') + '</dd>' : '') +
        (u.factory_map_id ? '<dt>工場</dt><dd><a href="../factory-map/index.html#co=' + encodeURIComponent((CO[u.company_id].factory_map_ids || [])[0] || '') + '">工場マップで見る</a></dd>' : '') + '</dl></div>';
    }).join('') + '</div>';
    if (q && q.org_chart_images && q.org_chart_images.length) {
      html += '<h3 style="margin:16px 0 4px">組織図(会社サイト)</h3><p class="muted">画像のみの組織図はユニットを自動更新しません(needs_manual)。取得 ' + esc(q.last_retrieved || '') + '</p>' +
        q.org_chart_images.map(function (src) { return '<img class="orgimg" src="' + esc(src) + '" alt="組織図" loading="lazy">'; }).join('');
    }
    return html || '<div class="empty">組織ユニットの情報がありません。</div>';
  }
  function renderPeople(c) {
    var ps = (P_BY_CO[c.id] || []).slice().sort(function (a, b) { return rankOrder(a) - rankOrder(b) || a.name.localeCompare(b.name, 'ja'); });
    return '<div class="people">' + ps.map(function (p) {
      return '<button type="button" class="person" data-person="' + esc(p.id) + '"><span class="t">' + esc(p.name) + (p.is_outside ? ' <span class="badge">社外</span>' : '') + '</span>' +
        '<span class="m">' + esc((p.current_titles || []).join(' / ') || '(現在の当社役職なし)') + '</span>' + (p.born ? '<span class="m faint">' + esc(p.born) + ' 生' + (p.joined ? ' · ' + esc(p.joined) + ' 入社' : '') + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }

  // ---------------------------------------------------------------- 人物ドロワー
  function openDrawer(pid) {
    var p = P[pid]; if (!p) return;
    var ts = (T_BY_CO[p.company_id] || []).filter(function (t) { return t.person_id === pid; }).sort(function (a, b) { return (a.from || '') < (b.from || '') ? -1 : 1; });
    var srcIds = {}; ts.forEach(function (t) { (t.source_ids || []).forEach(function (s) { srcIds[s] = 1; }); }); (p.source_ids || []).forEach(function (s) { srcIds[s] = 1; });
    var age = p.born ? Math.floor((new Date(D.builtAt) - new Date(p.born + '-01')) / (365.25 * 86400000)) : null;
    $('#drawerBody').innerHTML = '<div class="muted">' + esc(CO[p.company_id].short_name) + '</div><h2>' + esc(p.name) + (p.is_outside ? ' <span class="badge">社外</span>' : '') + '</h2>' +
      '<div>' + esc((p.current_titles || []).join(' / ') || '—') + '</div>' +
      '<dl class="kv"><dt>生年月</dt><dd>' + esc(p.born || '—') + (age != null ? ' <span class="faint">(満' + age + '歳)</span>' : '') + '</dd><dt>入社</dt><dd>' + esc(p.joined || '—') + '</dd>' +
      (p.term_years ? '<dt>任期</dt><dd>' + p.term_years + ' 年</dd>' : '') + (p.subsidiary_titles && p.subsidiary_titles.length ? '<dt>子会社</dt><dd>' + esc(p.subsidiary_titles.join(' / ')) + '</dd>' : '') + '</dl>' +
      '<h3 style="font-size:14px;margin:10px 0 2px">在任(当社)</h3><ul class="career">' + ts.filter(function (t) { return t.scope === 'own'; }).map(function (t) {
        return '<li class="' + esc(t.status) + '"><span class="d">' + esc((t.from_is_asof ? '〜' : '') + t.from) + '</span><span class="x">' + esc(t.title_raw) + (t.to ? ' <span class="faint">〜' + esc(t.to) + (t.inferred_end ? '(推定)' : '') + '</span>' : '') + ' ' + statusBadge(t.status) + '</span></li>';
      }).join('') + '</ul>' +
      (p.career && p.career.length ? '<h3 style="font-size:14px;margin:10px 0 2px">略歴(出典の記載)</h3><ul class="career">' + p.career.map(function (c) { return '<li class="' + (c.status || '') + (c.text.indexOf('当社') === 0 ? '' : ' sub') + '"><span class="d">' + esc(c.date || '') + '</span><span class="x">' + esc(c.text) + (c.current ? '(現任)' : '') + '</span></li>'; }).join('') + '</ul>' : '') +
      (p.sales_note ? '<h3 style="font-size:14px;margin:10px 0 2px">営業メモ</h3><div class="muted">' + esc(p.sales_note) + '</div>' : '') +
      '<h3 style="font-size:14px;margin:10px 0 2px">出典</h3><div class="src-list">' + Object.keys(srcIds).map(function (s) { return '<div>' + srcLink(s) + '</div>'; }).join('') + '</div>';
    $('#drawer').hidden = false; $('#drawerBg').hidden = false; $('#drawerClose').focus();
  }
  function closeDrawer() { $('#drawer').hidden = true; $('#drawerBg').hidden = true; }

  // ---------------------------------------------------------------- 新着
  function newsItems() {
    var since = new Date(D.builtAt); since.setDate(since.getDate() - state.days); var s = since.toISOString().slice(0, 10);
    var old = new Date(D.builtAt); old.setDate(old.getDate() - state.days - 180); var o = old.toISOString().slice(0, 7);
    var items = [];
    // 期間内に取得したイベントのうち、異動日が古すぎないもの(初回取得で過去 10 年分が全部「新着」にならないように)
    D.events.forEach(function (e) { var c = CO[e.company_id]; if (!c) return; if ((e.detected_at || '') >= s && (e.date || '') >= o) items.push({ kind: 'event', d: e.detected_at, e: e, c: c }); });
    D.signals.forEach(function (g) { var c = CO[g.company_id]; if (!c) return; if ((g.created_at || '') >= s && !(reviews[g.id] && reviews[g.id].status === 'hidden')) items.push({ kind: 'signal', d: g.created_at, g: g, c: c }); });
    items.sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : (a.kind === 'signal' ? -1 : 1); });
    return items;
  }
  function evText(e) {
    var p = P[e.person_id];
    return (p ? p.name + ' ' : '') + (EV_LABEL[e.type] || e.type) + ': ' + (e.before ? e.before + ' → ' : '') + (e.after || '') + (e.date ? ' (' + e.date + (e.date_is_asof ? 'までに' : '') + ')' : '') + (e.status === 'planned' ? ' [予定]' : '');
  }
  function renderNews() {
    var items = newsItems(), last = null, html = '';
    if (!items.length) { $('#newsBody').innerHTML = '<div class="empty">この期間の新着はありません。</div>'; return; }
    items.forEach(function (it) {
      if (it.d !== last) { html += '<div class="day">' + esc(it.d) + ' 取得</div>'; last = it.d; }
      if (it.kind === 'signal') html += '<div class="ev"><span class="k sig">シグナル</span><span><b>' + esc(it.c.short_name) + '</b> ' + esc(it.g.title) + ' <span class="badge ' + esc(it.g.level) + '">' + (it.g.level === 'high' ? '重要' : '中') + '</span>' + (it.g.is_speculative ? '<span class="badge spec">推測</span>' : '') + ' <button type="button" class="link-btn inline" data-co="' + esc(it.c.id) + '">開く</button></span></div>';
      else html += '<div class="ev"><span class="k">' + esc(EV_LABEL[it.e.type] || it.e.type) + '</span><span><b>' + esc(it.c.short_name) + '</b> ' + esc(evText(it.e)) + ' ' + srcLink(it.e.source_id) + '</span></div>';
    });
    $('#newsBody').innerHTML = html;
    document.querySelectorAll('#newsBody [data-co]').forEach(function (b) { b.addEventListener('click', function () { state.sub = 'signals'; go('company', b.dataset.co); }); });
  }
  function copySlack() {
    var items = newsItems(), lines = ['【顧客人事 新着】過去' + state.days + '日' + ' — ' + D.builtAt + ' 時点'];
    var byCo = {}; items.forEach(function (it) { (byCo[it.c.short_name] = byCo[it.c.short_name] || []).push(it); });
    Object.keys(byCo).forEach(function (n) {
      lines.push('■ ' + n);
      byCo[n].forEach(function (it) { lines.push(it.kind === 'signal' ? '  ・[シグナル' + (it.g.is_speculative ? '・推測' : '') + '] ' + it.g.title + ' → 面談で確認: ' + it.g.verify_question : '  ・' + evText(it.e)); });
    });
    lines.push('(出典は顧客人事DBの各項目から。社外秘)');
    var text = lines.join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { $('#copySlack').textContent = 'コピーしました'; setTimeout(function () { $('#copySlack').textContent = 'Slackに送る文面をコピー'; }, 1500); })
      .catch(function () { prompt('コピーしてください', text); });
  }

  // ---------------------------------------------------------------- データ品質
  function renderQuality() {
    var q = D.quality || {}, ids = Object.keys(q).sort(function (a, b) {
      var sa = (D.audit && D.audit.companies[a] || {}).score, sb = (D.audit && D.audit.companies[b] || {}).score;
      return (sa == null ? 999 : sa) - (sb == null ? 999 : sb) || ((CO[a] ? CO[a].priority : 9) - (CO[b] ? CO[b].priority : 9));
    });
    var rs = D.registry_summary || {};
    var au = D.audit || {}, as = au.summary || {}, ac = au.companies || {};
    function pct(x) { return x == null ? '—' : Math.round(x * 100) + '%'; }
    var hist = (au.history || []).map(function (h) { return h.score_mean; }).filter(function (x) { return x != null; });
    var html = '<h3 style="font-size:15px;margin:0 0 6px">品質監査(有価証券報告書の記載と突き合わせ)</h3>' +
      '<div class="q-wrap"><table class="q"><tbody>' +
      '<tr><th>役員の人数が有報の記載と一致</th><td>' + pct(as.officers_ok_rate) + '</td><th>執行役員の人数が記載と一致(±1)</th><td>' + pct(as.exec_ok_rate) + '</td></tr>' +
      '<tr><th>執行役員が 1 名以上いる会社</th><td>' + pct(as.exec_any) + '</td><th>会社サイトの役員一覧を取得</th><td>' + pct(as.site_rate) + '</td></tr>' +
      '<tr><th>役員の現職が出ている</th><td>' + pct(as.current_rate) + '</td><th>社内役員の略歴に当社の経歴がある</th><td>' + pct(as.own_career) + '</td></tr>' +
      '<tr><th>氏名として不自然なもの</th><td>' + (as.bad_names == null ? '—' : as.bad_names + (as.site_only_bad_names || 0)) + ' 件</td><th>平均スコア(推移)</th><td>' + (as.score_mean == null ? '—' : as.score_mean) + (hist.length > 1 ? ' <span class="muted">(' + hist.join(' → ') + ')</span>' : '') + '</td></tr>' +
      '</tbody></table></div>';
    html += '<h3 style="font-size:15px;margin:12px 0 6px">企業マスタ</h3><p class="muted">工場マップ ' + esc(rs.factory_builtAt || '') + ' 時点の企業 ' + (rs.listed || 0) + ' 社が上場。EDINET コード照合 ' + (rs.edinet_matched || 0) + ' / ' + (rs.listed || 0) + '(' + Math.round((rs.edinet_match_rate || 0) * 100) + '%)。' +
      '区分: ' + Object.keys(rs.counts || {}).map(function (k) { return (LISTING[k] || k) + ' ' + rs.counts[k]; }).join(' / ') + '</p>';
    html += '<h3 style="font-size:15px;margin:12px 0 6px">企業ごとの取得状況</h3><div class="q-wrap"><table class="q"><thead><tr><th>会社</th><th>スコア</th><th>役員(有報記載)</th><th>執行役員(記載)</th><th>最終取得</th><th>出典</th><th>人物 / 在任 / イベント / シグナル</th><th>手動確認</th><th>組織図</th><th>警告</th></tr></thead><tbody>' +
      ids.map(function (k) { var x = q[k], c = CO[k]; return '<tr><td>' + (c ? '<button type="button" class="link-btn inline" data-co="' + esc(k) + '">' + esc(c.short_name) + '</button>' : esc(k)) + '</td>' + (function () { var r = ac[k] || {};
        return '<td>' + (r.score == null ? '—' : r.score) + '</td><td>' + (r.officers_parsed == null ? '—' : r.officers_parsed + ' / ' + (r.officers_expected == null ? '?' : r.officers_expected)) + (r.officers_ok === false ? ' ⚠' : '') + '</td><td>' + (r.exec_parsed == null ? '—' : r.exec_parsed + ' / ' + (r.exec_expected == null ? '?' : r.exec_expected)) + '</td>'; })() + '<td>' + esc(x.last_retrieved || '—') + '</td><td>' + x.sources + '</td><td>' + x.persons + ' / ' + x.tenures + ' / ' + x.events + ' / ' + x.signals + '</td><td>' + (x.manual_queue || 0) + '</td><td>' + (x.org_chart_needs_manual ? '画像のみ(needs_manual)' : '—') + '</td><td>' + (x.warnings && x.warnings.length ? '<ul class="warnlist">' + x.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    var f = D.failures || [];
    html += '<h3 style="font-size:15px;margin:12px 0 6px">実行ログの失敗(直近 14 日)</h3>' + (f.length ? '<div class="q-wrap"><table class="q"><thead><tr><th>日付</th><th>ステップ</th><th>会社</th><th>内容</th></tr></thead><tbody>' + f.map(function (x) { return '<tr><td>' + esc(x.date) + '</td><td>' + esc(x.step) + '</td><td>' + esc(CO[x.company_id] ? CO[x.company_id].short_name : x.company_id) + '</td><td>' + esc(x.msg) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">失敗はありません。</p>');
    var todo = D.registry_todo || [];
    html += '<h3 style="font-size:15px;margin:12px 0 6px">EDINET コード未照合の上場企業(' + todo.length + ')</h3>' + (todo.length ? '<div class="q-wrap"><table class="q"><thead><tr><th>会社</th><th>正式名</th><th>上場</th><th>対応</th></tr></thead><tbody>' + todo.map(function (t) { return '<tr><td>' + esc(t.name) + '</td><td>' + esc(t.legal || '') + '</td><td>' + esc(t.listed || '') + '</td><td class="muted">' + esc(t.todo) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">すべて照合できています。</p>');
    $('#qualityBody').innerHTML = html;
    document.querySelectorAll('#qualityBody [data-co]').forEach(function (b) { b.addEventListener('click', function () { state.sub = 'signals'; go('company', b.dataset.co); }); });
  }
})();
