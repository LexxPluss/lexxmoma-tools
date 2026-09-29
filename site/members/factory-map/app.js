/* 工場マップ(LexxPluss 社内) — 暗号化データを共通パスワードで復号し、地図と一覧で工場を見る。
 * データ: data.enc.json = PBKDF2-SHA256 → AES-256-GCM(internal/factory-db/build.py が作成)
 * 依存: Leaflet のみ
 */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var KEY_STORE = 'lx_factory_key_v1';
  var DOME = 46755; // 東京ドームの建築面積 m²

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function b64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function ub64(u) { var s = ''; u = new Uint8Array(u); for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  function fmt(n) { return n == null ? null : Number(n).toLocaleString('ja-JP'); }
  function track(p, t) { try { if (window.lxTrack) window.lxTrack(p, t); } catch (e) { /* 計測不可 */ } }

  // ---------------------------------------------------------------- 入口
  var ENC = null;
  function loadEnc() {
    if (ENC) return Promise.resolve(ENC);
    if (window.FACTORY_ENC) { ENC = window.FACTORY_ENC; return Promise.resolve(ENC); }  // data.enc.js(file:// でも読める)
    return fetch('data.enc.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('data'); return r.json(); })
      .then(function (j) { ENC = j; return j; });
  }
  function deriveKey(pw, enc) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(enc.salt), iterations: enc.iter },
        base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
    });
  }
  function decrypt(key, enc) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct)).then(function (buf) {
      return JSON.parse(new TextDecoder().decode(buf));
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

  if (!window.crypto || !crypto.subtle) {
    showGateError('このブラウザでは開けません(https で開いてください)。');
  }

  $('#gateForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = $('#pw').value;
    if (!pw) return;
    $('#gateBtn').disabled = true; $('#gateBtn').textContent = '確認中…'; $('#gateErr').textContent = '';
    loadEnc().then(function (enc) {
      return deriveKey(pw, enc).then(function (key) {
        return decrypt(key, enc).then(function (data) {
          $('#pw').value = '';
          return saveKey(key, enc.salt, $('#remember').checked).then(function () { start(data); });
        });
      });
    }).catch(function (err) {
      showGateError(err && err.message === 'data' ? 'データを読み込めませんでした。時間をおいて再度お試しください。' : 'パスワードが違います。');
    });
  });

  // 記憶済みの鍵があれば入口を飛ばす(データ更新で鍵が変わっていたら入口を出す)
  loadEnc().then(function (enc) {
    return storedKey().then(function (s) {
      if (!s || s.salt !== enc.salt) { forgetKey(); return; }
      return decrypt(s.key, enc).then(start).catch(forgetKey);
    });
  }).catch(function () { /* 入口のまま */ });

  // ---------------------------------------------------------------- 本体
  var D, COS = {}, FAS = [], GROUPS = {}, map, layer, markers = {};
  var COLORS = ['#0068B7', '#3EB370', '#E8A33D', '#D6496E', '#7B61C9', '#2BA6B8', '#8A6D3B', '#5C7A99', '#C45A2A', '#6FA83A', '#A3478F'];
  var REGIONS = [
    ['北海道・東北', ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県']],
    ['関東', ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県']],
    ['北陸・甲信越', ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県']],
    ['東海', ['岐阜県', '静岡県', '愛知県', '三重県']],
    ['近畿', ['滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県']],
    ['中国・四国', ['鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県']],
    ['九州・沖縄', ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']]
  ];
  var state = { q: '', inds: {}, grp: '', region: '', tab: 'co', sort: 'fac', focus: null, near: null, gmode: 'tree' };
  try { if (localStorage.getItem('lx_fm_gmode') === 'group') state.gmode = 'group'; } catch (e) { /* 既定のまま */ }
  var KIDS = {};  // 親会社id → 子会社id[]

  function indColor(ind) { var i = D.industries.indexOf(ind); return COLORS[i < 0 ? 0 : i % COLORS.length]; }
  function coOf(f) { return COS[f.oid || f.cid]; }
  function grpOf(c) { return c ? c.group : ''; }

  function start(data) {
    D = data;
    D.companies.forEach(function (c) { COS[c.id] = c; c.facs = []; });
    FAS = D.factories.filter(function (f) { return f.lat != null; });
    D.factories.forEach(function (f) {
      var c = coOf(f); if (c) c.facs.push(f);
      if (f.cid !== (f.oid || f.cid) && COS[f.cid] && COS[f.cid].facs.indexOf(f) < 0) COS[f.cid].facs.push(f);
    });
    D.companies.forEach(function (c) { (GROUPS[c.group] = GROUPS[c.group] || []).push(c); });
    buildTree();
    $('#gate').hidden = true; $('#app').hidden = false;
    initResize();
    buildControls(); buildMap(); render();
    track('member/factory-map/open', '工場マップを開いた');
  }

  // ---------------------------------------------------------------- 親子(傘下)関係
  // 親会社名で結ぶ(「〇〇ホールディングス」「〇〇グループ」は〇〇と同じとみなす)。
  // 親会社名が無くても、ある会社の記録に別会社が運営する工場が入っていれば、その会社を子会社とみなす
  function nk(n) {
    return String(n || '').normalize('NFKC').replace(/株式会社|\(株\)|ホールディングス|グループ|HD$/g, '').replace(/[\s・()（）]/g, '').toLowerCase();
  }
  function buildTree() {
    var byKey = {};
    D.companies.forEach(function (c) { byKey[nk(c.name)] = byKey[nk(c.name)] || c; });
    D.companies.forEach(function (c) {
      var p = c.parent && byKey[nk(c.parent)];
      if (p && p.id !== c.id) c.parentCo = p.id;
    });
    D.factories.forEach(function (f) {
      if (f.oid && f.oid !== f.cid) {
        var child = COS[f.oid], par = COS[f.cid];
        if (child && par && !child.parentCo && child.id !== par.id && par.parentCo !== child.id) child.parentCo = par.id;
      }
    });
    D.companies.forEach(function (c) { if (c.parentCo) (KIDS[c.parentCo] = KIDS[c.parentCo] || []).push(c.id); });
  }
  function treeIds(root) {  // 自社+子会社+孫会社…(循環は打ち切る)
    var out = [root.id], seen = {}; seen[root.id] = 1;
    for (var i = 0; i < out.length; i++) (KIDS[out[i]] || []).forEach(function (k) { if (!seen[k]) { seen[k] = 1; out.push(k); } });
    return out;
  }
  function depthIn(root, id) { var d = 0, c = COS[id]; while (c && c.id !== root.id && c.parentCo && d < 8) { c = COS[c.parentCo]; d++; } return d; }
  function owner(f) { return f.oid || f.cid; }
  function focusSet() {
    if (!state.focus) return null;
    var set = {}; treeIds(state.focus.company).forEach(function (id) { set[id] = 1; }); return set;
  }

  function buildControls() {
    var cnt = {};
    D.companies.forEach(function (c) { cnt[c.industry] = (cnt[c.industry] || 0) + 1; });
    $('#indChips').innerHTML = D.industries.filter(function (i) { return cnt[i]; }).map(function (i) {
      return '<button type="button" class="chip" data-ind="' + esc(i) + '"><i style="background:' + indColor(i) + '"></i>' + esc(i) + '<span>' + cnt[i] + '</span></button>';
    }).join('');
    $('#indChips').addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      var i = b.dataset.ind; state.inds[i] ? delete state.inds[i] : (state.inds[i] = 1);
      b.classList.toggle('on', !!state.inds[i]); state.focus = null; render();
      if (state.inds[i]) track('member/factory-map/industry', i);
    });
    var gs = Object.keys(GROUPS).filter(function (g) { return GROUPS[g].length > 1; })
      .sort(function (a, b) { return GROUPS[b].length - GROUPS[a].length; });
    $('#grp').insertAdjacentHTML('beforeend', gs.map(function (g) { return '<option value="' + esc(g) + '">' + esc(g) + ' グループ(' + GROUPS[g].length + '社)</option>'; }).join(''));
    $('#region').insertAdjacentHTML('beforeend', REGIONS.map(function (r) { return '<option value="' + esc(r[0]) + '">' + esc(r[0]) + '</option>'; }).join(''));
    ['#grp', '#region'].forEach(function (s) { $(s).addEventListener('change', function () { state[s === '#grp' ? 'grp' : 'region'] = this.value; state.focus = null; render(); }); });
    var qt; $('#q').addEventListener('input', function () { var v = this.value; clearTimeout(qt); qt = setTimeout(function () { state.q = v.trim(); state.focus = null; render(); }, 150); });
    document.querySelectorAll('.tabs [data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { state.tab = b.dataset.tab; document.querySelectorAll('.tabs [data-tab]').forEach(function (x) { x.classList.toggle('on', x === b); }); setSort(); renderList(); });
    });
    $('#sort').addEventListener('change', function () { state.sort = this.value; renderList(); });
    setSort();
    $('#back').addEventListener('click', function () { state.focus = null; closeDetail(); render(); });
    $('#lock').addEventListener('click', function () { forgetKey(); location.reload(); });
    $('#locate').addEventListener('click', locate);
    $('#legend').innerHTML = '<b>業種</b>' + D.industries.filter(function (i) { return cnt[i]; }).map(function (i) {
      return '<span><i style="background:' + indColor(i) + '"></i>' + esc(i) + '</span>'; }).join('') + '<small>円の大きさ = 従業員数</small>';
    $('#foot').innerHTML = '会社 ' + D.companies.length + '社・工場 ' + D.factories.length + '件(' + esc(D.builtAt) + ' 時点)。出所は各社の公式サイト・有価証券報告書。' +
      '数値は掲載時点の公表値で、最新ではない場合があります。';
  }
  function setSort() {
    var opt = state.tab === 'co'
      ? [['fac', '工場数が多い順'], ['rev', '売上高が大きい順'], ['name', '会社名順']]
      : [['emp', '従業員数が多い順'], ['area', '敷地が広い順'], ['name', '工場名順']];
    if (state.near) opt.unshift(['near', '現在地から近い順']);
    $('#sort').innerHTML = opt.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('');
    state.sort = opt[0][0];
  }

  function buildMap() {
    map = L.map('map', { zoomControl: false, minZoom: 4, maxZoom: 17, zoomSnap: 0.5, preferCanvas: true }).setView([36.2, 137.5], 5.5);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
      attribution: '地図: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>', maxZoom: 18 }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }

  // ---------------------------------------------------------------- 絞り込み
  function inRegion(f) {
    if (!state.region) return true;
    var r = REGIONS.filter(function (x) { return x[0] === state.region; })[0];
    return r && r[1].indexOf(f.pref) >= 0;
  }
  function matchText(c, f) {
    if (!state.q) return true;
    var hay = [c && c.name, c && c.legal, c && c.group, c && c.industry, f && f.name, f && f.op, f && f.addr, f && f.pref, f && f.city, f && f.prod, f && f.seg].join(' ').toLowerCase();
    return state.q.toLowerCase().split(/[\s　]+/).every(function (t) { return !t || hay.indexOf(t) >= 0; });
  }
  function coPass(c) {
    if (Object.keys(state.inds).length && !state.inds[c.industry]) return false;
    if (state.grp && c.group !== state.grp) return false;
    return true;
  }
  function visibleFactories() {
    if (state.focus) {
      if (state.gmode === 'group') {
        var g = state.focus.group;
        return D.factories.filter(function (f) { var c = coOf(f); return c && c.group === g; });
      }
      var set = focusSet();
      return D.factories.filter(function (f) { return set[owner(f)]; });
    }
    return D.factories.filter(function (f) { var c = coOf(f); return c && coPass(c) && inRegion(f) && matchText(c, f); });
  }

  // ---------------------------------------------------------------- 描画
  function render() { renderMap(); renderList(); }

  function radius(f) { return f.emp ? Math.max(4, Math.min(16, 2.2 * Math.sqrt(f.emp / 60))) : 4.5; }

  function renderMap() {
    layer.clearLayers(); markers = {};
    var fs = visibleFactories().filter(function (f) { return f.lat != null; });
    var set = focusSet(), rootId = state.focus && state.focus.company.id;
    fs.sort(function (a, b) { return (set && set[owner(a)] ? 1 : 0) - (set && set[owner(b)] ? 1 : 0); });  // 傘下を上に重ねる
    fs.forEach(function (f) {
      var c = coOf(f);
      var inTree = set && set[owner(f)], isRoot = rootId && owner(f) === rootId;
      var dim = set && !inTree;  // グループ全体表示での傘下外
      var m = L.circleMarker([f.lat, f.lng], {
        radius: radius(f) + (isRoot ? 2 : 0), weight: isRoot ? 3 : inTree ? 2 : 1, color: isRoot ? '#1f2933' : inTree ? '#44525f' : '#fff',
        fillColor: indColor(c.industry), fillOpacity: dim ? 0.28 : (f.prec === 'prefecture' ? 0.45 : 0.85), opacity: dim ? 0.5 : 1
      }).addTo(layer);
      m.bindTooltip('<b>' + esc(f.name) + '</b><br>' + esc(f.op) + (f.prod ? '<br><span style="color:#5b6b7b">' + esc(f.prod) + '</span>' : ''), { direction: 'top', offset: [0, -4] });
      m.on('click', function () { openFactory(f); });
      markers[f.id] = m;
    });
    if (state.focus && fs.length) {
      var b = L.latLngBounds(fs.map(function (f) { return [f.lat, f.lng]; }));
      map.fitBounds(b.pad(0.15), { maxZoom: 11 });
    }
  }

  function companyStats(list) {
    var n = 0, emp = 0, area = 0, pref = {};
    list.forEach(function (f) { n++; emp += f.emp || 0; area += f.area || 0; if (f.pref) pref[f.pref] = 1; });
    return { n: n, emp: emp, area: area, prefs: Object.keys(pref).length };
  }

  function renderList() {
    if (state.focus) return renderGroup();
    var fs = visibleFactories();
    var byCo = {};
    fs.forEach(function (f) { var c = coOf(f); (byCo[c.id] = byCo[c.id] || []).push(f); });
    // 工場の無い会社も、会社名検索・業種で見つかるように含める
    D.companies.forEach(function (c) { if (!byCo[c.id] && coPass(c) && !state.region && matchText(c, null)) byCo[c.id] = []; });
    var cos = Object.keys(byCo).map(function (id) { return COS[id]; });
    $('#res').textContent = state.tab === 'co' ? '該当 ' + cos.length + '社・工場 ' + fs.length + '件' : '該当 工場 ' + fs.length + '件';
    var html;
    if (state.tab === 'co') {
      cos.sort(function (a, b) {
        if (state.sort === 'rev') return (b.rev || 0) - (a.rev || 0);
        if (state.sort === 'name') return a.name.localeCompare(b.name, 'ja');
        if (state.sort === 'near') return dist(byCo[a.id]) - dist(byCo[b.id]);
        return byCo[b.id].length - byCo[a.id].length || (b.rev || 0) - (a.rev || 0);
      });
      html = cos.slice(0, 400).map(function (c) {
        var s = companyStats(byCo[c.id]);
        return '<button class="item co" data-co="' + c.id + '"><i class="dot" style="background:' + indColor(c.industry) + '"></i>' +
          '<span class="t">' + esc(c.name) + '</span><span class="m">' + esc(c.industry) + (c.group && c.group !== c.name ? '・' + esc(c.group) + 'グループ' : '') + '</span>' +
          '<span class="n">' + s.n + '<small>拠点</small></span></button>';
      }).join('');
    } else {
      var list = fs.slice();
      list.sort(function (a, b) {
        if (state.sort === 'area') return (b.area || 0) - (a.area || 0);
        if (state.sort === 'name') return (a.name || '').localeCompare(b.name || '', 'ja');
        if (state.sort === 'near') return distF(a) - distF(b);
        return (b.emp || 0) - (a.emp || 0);
      });
      html = list.slice(0, 400).map(function (f) {
        var c = coOf(f);
        return '<button class="item fa" data-fa="' + f.id + '"><i class="dot" style="background:' + indColor(c.industry) + '"></i>' +
          '<span class="t">' + esc(f.name) + '</span><span class="m">' + esc(f.op) + '・' + esc((f.pref || '') + (f.city || '')) +
          (state.near ? '・約' + fmt(Math.round(distF(f))) + 'km' : '') + '</span>' +
          '<span class="n">' + (f.emp ? fmt(f.emp) + '<small>人</small>' : '<small>—</small>') + '</span></button>';
      }).join('');
    }
    $('#list').innerHTML = html || '<p class="empty">条件に合う会社・工場がありません。</p>';
  }

  $('#list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-co],[data-fa],[data-gco]'); if (!b) return;
    if (b.dataset.co) focusCompany(COS[b.dataset.co]);
    else if (b.dataset.gco) focusCompany(COS[b.dataset.gco]);
    else openFactory(D.factories.filter(function (f) { return f.id === b.dataset.fa; })[0]);
  });

  function focusCompany(c) {
    state.focus = { company: c, group: c.group };
    closeDetail(); render();
    track('member/factory-map/company', c.name);
  }

  function renderGroup() {
    var c = state.focus.company, g = state.focus.group, mode = state.gmode;
    var groupSize = (GROUPS[g] || [c]).length;
    var ids = treeIds(c), set = {}; ids.forEach(function (id) { set[id] = 1; });
    var members;
    if (mode === 'group') {
      members = (GROUPS[g] || [c]).slice();
      members.sort(function (a, b) { return (a.id === c.id ? -1 : b.id === c.id ? 1 : 0) || (set[b.id] ? 1 : 0) - (set[a.id] ? 1 : 0) || b.facs.length - a.facs.length; });
    } else {
      members = ids.map(function (id) { return COS[id]; });
      members.sort(function (a, b) { return depthIn(c, a.id) - depthIn(c, b.id) || b.facs.length - a.facs.length; });
    }
    var all = visibleFactories();
    var st = companyStats(all);
    var par = c.parentCo && COS[c.parentCo];
    var kicker = mode === 'group' ? esc(g) + ' グループ全体' : esc(c.name) + (ids.length > 1 ? ' と傘下の会社' : '');
    var head = '<div class="g-head"><div class="g-row"><div class="g-kicker">' + kicker + '</div>' +
      '<div class="seg" role="group" aria-label="表示範囲">' +
      '<button type="button" data-gmode="tree" class="' + (mode === 'tree' ? 'on' : '') + '">傘下のみ</button>' +
      '<button type="button" data-gmode="group" class="' + (mode === 'group' ? 'on' : '') + '"' + (groupSize > 1 ? '' : ' disabled title="同じグループの会社はありません"') + '>グループ全体' + (groupSize > 1 ? '(' + groupSize + '社)' : '') + '</button></div></div>' +
      '<div class="g-stats"><b>' + members.length + '</b>社<b>' + st.n + '</b>拠点<b>' + st.prefs + '</b>都道府県' +
      (st.emp ? '<b>' + fmt(st.emp) + '</b>人' : '') + '</div>' +
      '<div class="g-nav">' + (par ? '<button class="link-btn" type="button" data-gco="' + par.id + '">▲ 親会社 ' + esc(par.name) + ' を表示</button>' : '') +
      '<button class="link-btn" id="gClear" type="button">× 表示を解除</button></div></div>';
    var body = members.map(function (m) {
      var fs = D.factories.filter(function (f) { return owner(f) === m.id; });
      var d = mode === 'tree' ? depthIn(c, m.id) : 0;
      var outside = mode === 'group' && !set[m.id];
      return '<section class="g-co' + (m.id === c.id ? ' me' : '') + (outside ? ' outside' : '') + '" style="margin-left:' + Math.min(d, 3) * 14 + 'px">' +
        '<button class="g-title" data-gco="' + m.id + '"><i class="dot" style="background:' + indColor(m.industry) + '"></i>' +
        '<span class="nm">' + (d ? '<span class="branch">└</span>' : '') + esc(m.name) + '</span>' +
        '<span class="m">' + esc(m.industry) + (m.rev ? '・売上 ' + fmt(m.rev) + '億円' : '') + ((KIDS[m.id] || []).length && m.id !== c.id ? '・子会社 ' + KIDS[m.id].length + '社' : '') + '</span></button>' +
        coInfo(m) +
        (fs.length ? '<div class="g-facs">' + fs.map(function (f) {
          return '<button class="item fa" data-fa="' + f.id + '"><span class="t">' + esc(f.name) + '</span><span class="m">' +
            (f.op && nk(f.op) !== nk(m.name) ? esc(f.op) + '・' : '') + esc((f.pref || '') + (f.city || '')) + (f.prod ? '・' + esc(f.prod) : '') + '</span>' +
            '<span class="n">' + (f.emp ? fmt(f.emp) + '<small>人</small>' : '') + '</span></button>';
        }).join('') + '</div>' : '<p class="empty small">工場の情報は未収集です</p>') + '</section>';
    }).join('');
    $('#res').textContent = '';
    $('#list').innerHTML = head + body;
    $('#gClear').onclick = function () { state.focus = null; render(); };
    $('#list').querySelectorAll('[data-gmode]').forEach(function (b) {
      b.onclick = function () {
        state.gmode = b.dataset.gmode;
        try { localStorage.setItem('lx_fm_gmode', state.gmode); } catch (e) { /* 保存不可 */ }
        render();
        track('member/factory-map/gmode', state.gmode);
      };
    });
  }

  function coInfo(m) {
    var bits = [];
    if (m.parentCo && COS[m.parentCo]) bits.push('親会社: <button class="link-btn inline" type="button" data-gco="' + m.parentCo + '">' + esc(COS[m.parentCo].name) + '</button>');
    else if (m.parent) bits.push('親会社: ' + esc(m.parent));
    if (m.listed) bits.push(esc(m.listed));
    if (m.emp) bits.push('連結従業員 ' + fmt(m.emp) + '人');
    var links = [];
    if (m.web) links.push('<a href="' + esc(m.web) + '" target="_blank" rel="noopener">公式サイト ↗</a>');
    links.push('<a href="' + newsUrl(m.name) + '" target="_blank" rel="noopener" data-news="' + esc(m.name) + '">最新ニュース ↗</a>');
    if (m.revUrl) links.push('<a href="' + esc(m.revUrl) + '" target="_blank" rel="noopener">売上高の出所 ↗</a>');
    return '<div class="g-info">' + (bits.length ? '<span>' + bits.join(' ・ ') + '</span>' : '') + '<span class="links">' + links.join('') + '</span></div>';
  }

  function newsUrl(q) { return 'https://www.google.com/search?tbm=nws&hl=ja&q=' + encodeURIComponent(q); }
  document.addEventListener('click', function (e) { var a = e.target.closest('[data-news]'); if (a) track('member/factory-map/news', a.dataset.news); });

  function openFactory(f) {
    if (!f) return;
    var c = coOf(f), owner = COS[f.cid];
    var vis = state.focus && visibleFactories().indexOf(f) >= 0;
    if (!vis) { state.focus = { company: c, group: c.group }; renderMap(); renderGroup(); }
    var rows = [];
    function row(k, v) { if (v != null && v !== '') rows.push('<dt>' + k + '</dt><dd>' + v + '</dd>'); }
    row('運営会社', esc(f.op) + (owner && owner.id !== c.id ? '(' + esc(owner.name) + ' グループ)' : ''));
    row('所在地', esc(f.addr || ((f.pref || '') + (f.city || ''))) + (f.prec === 'prefecture' ? ' <span class="muted">(地図上は県の中心に表示)</span>' : f.prec === 'city' || f.prec === 'town' ? ' <span class="muted">(番地が不明のため、地図上は市区町村の代表点)</span>' : ''));
    row('生産品目', esc(f.prod));
    row('セグメント', esc(f.seg));
    row('敷地面積', f.area ? fmt(f.area) + ' m²<span class="muted">(約 ' + (f.area / 10000).toFixed(1) + ' ha・東京ドーム約 ' + (f.area / DOME).toFixed(1) + ' 個分)</span>' : null);
    row('延床面積', f.floor ? fmt(f.floor) + ' m²' : null);
    row('従業員数', f.emp ? fmt(f.emp) + ' 人' + (f.empAsof ? '<span class="muted">(' + esc(f.empAsof) + ')</span>' : '') : null);
    row('操業開始', f.est ? esc(f.est) + ' 年' : null);
    var q = (f.op + ' ' + (f.name || '')).trim();
    var gmap = f.lat != null ? 'https://www.google.com/maps/search/?api=1&query=' + f.lat + ',' + f.lng : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(f.addr || q);
    $('#detailBody').innerHTML =
      '<div class="f-kicker" style="color:' + indColor(c.industry) + '">' + esc(c.industry) + '</div>' +
      '<h2>' + esc(f.name) + '</h2><div class="f-op">' + esc(f.op) + '</div>' +
      '<div class="f-actions">' +
      '<a class="btn primary" href="' + newsUrl(q) + '" target="_blank" rel="noopener" data-news="' + esc(q) + '">📰 最新ニュースを検索</a>' +
      '<a class="btn" href="' + gmap + '" target="_blank" rel="noopener">🗺 Googleマップ</a>' +
      '<button class="btn" type="button" id="fGroup">🏭 ' + esc(c.name) + 'の拠点一覧</button></div>' +
      '<dl class="kv">' + rows.join('') + '</dl>' +
      '<p class="src">出所: <a href="' + esc(f.src) + '" target="_blank" rel="noopener">' + esc(shortUrl(f.src)) + ' ↗</a>' +
      (f.src2 && f.src2 !== f.src ? '<br>敷地面積・従業員数: <a href="' + esc(f.src2) + '" target="_blank" rel="noopener">有価証券報告書 ↗</a>' : '') +
      (/\.pdf($|\?)/i.test(f.src) && !f.src2 ? '<span class="muted">(有価証券報告書「主要な設備の状況」)</span>' : '') +
      (f.srcType === 'public' ? '<br><span class="muted">※ 出所は公的機関・業界団体のページです(会社の公式情報ではありません)</span>' : '') +
      (f.fix || []).map(function (x) {
        return '<br>確認・修正(' + esc(FIX_LABEL[x.field] || x.field) + '): ' + esc(x.reason) +
          (x.url ? ' <a href="' + esc(x.url) + '" target="_blank" rel="noopener">根拠 ↗</a>' : '') + (x.at ? '<span class="muted">(' + esc(x.at) + ')</span>' : '');
      }).join('') + '</p>';
    $('#detail').hidden = false; $('#list').hidden = true; $('.p-filters').hidden = true;
    $('#fGroup').onclick = function () { closeDetail(); renderGroup(); };
    var m = markers[f.id]; if (m && f.lat != null) { map.setView([f.lat, f.lng], Math.max(map.getZoom(), 11)); m.openTooltip(); }
    track('member/factory-map/factory', f.op + ' ' + f.name);
  }
  var FIX_LABEL = { addr: '所在地', prod: '生産品目', area: '敷地面積', emp: '従業員数', name: '工場名', op: '運営会社', est: '操業開始' };
  function closeDetail() { $('#detail').hidden = true; $('#list').hidden = false; $('.p-filters').hidden = false; }
  function shortUrl(u) { try { var x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname.length > 1 ? x.pathname : ''); } catch (e) { return u; } }

  // ---------------------------------------------------------------- 右パネルの幅(ドラッグで変更・ダブルクリックで既定)
  function initResize() {
    var panel = $('#panel'), grip = $('#pResize'), KEY = 'lx_fm_panel_w', DEF = 420;
    if (!grip) return;
    function maxW() { return Math.max(360, Math.min(1100, window.innerWidth * 0.8)); }
    function apply(w) { if (window.innerWidth <= 760) { panel.style.width = ''; return; } panel.style.width = Math.max(320, Math.min(maxW(), w)) + 'px'; }
    try { var sv = +localStorage.getItem(KEY); if (sv) apply(sv); } catch (e) { /* 既定 */ }
    grip.addEventListener('pointerdown', function (e) {
      if (window.innerWidth <= 760) return;
      e.preventDefault(); grip.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
      function mv(ev) { apply(window.innerWidth - ev.clientX - 12); }
      function up() {
        grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); document.body.classList.remove('resizing');
        try { localStorage.setItem(KEY, parseInt(panel.style.width, 10) || DEF); } catch (e2) { /* 保存不可 */ }
        map.invalidateSize();
      }
      grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up);
    });
    grip.addEventListener('dblclick', function () { apply(DEF); try { localStorage.removeItem(KEY); } catch (e) { /* noop */ } });
    window.addEventListener('resize', function () { if (panel.style.width) apply(parseInt(panel.style.width, 10)); });
  }

  // ---------------------------------------------------------------- 現在地
  function km(a, b) {
    var R = 6371, t = Math.PI / 180, dLa = (b[0] - a[0]) * t, dLo = (b[1] - a[1]) * t;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function distF(f) { return state.near && f.lat != null ? km(state.near, [f.lat, f.lng]) : 1e9; }
  function dist(fs) { return fs && fs.length ? Math.min.apply(null, fs.map(distF)) : 1e9; }
  var meMarker;
  function locate() {
    if (!navigator.geolocation) { alert('この端末では現在地を取得できません'); return; }
    $('#locate').textContent = '◎ 取得中…';
    navigator.geolocation.getCurrentPosition(function (p) {
      state.near = [p.coords.latitude, p.coords.longitude];
      $('#locate').textContent = '◎ 現在地の近く';
      if (meMarker) meMarker.remove();
      meMarker = L.circleMarker(state.near, { radius: 7, color: '#fff', weight: 3, fillColor: '#e5484d', fillOpacity: 1 }).addTo(map).bindTooltip('現在地');
      map.setView(state.near, 10);
      state.focus = null; closeDetail();
      state.tab = 'fa'; document.querySelectorAll('.tabs [data-tab]').forEach(function (x) { x.classList.toggle('on', x.dataset.tab === 'fa'); });
      setSort(); render();
      track('member/factory-map/near', '現在地の近く');
    }, function () { $('#locate').textContent = '◎ 現在地の近く'; alert('現在地を取得できませんでした(位置情報の許可を確認してください)'); },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  // 検証用
  window.__fm = { state: state, get data() { return D; }, tree: function (name) { var c = D.companies.filter(function (x) { return x.name === name; })[0]; return c ? treeIds(c).map(function (id) { return COS[id].name; }) : null; }, focus: function (name) { var c = D.companies.filter(function (x) { return x.name === name; })[0]; if (c) focusCompany(c); return !!c; } };
})();
