/* ロボットSIerデータベース
   左: 地図（Leaflet + 国土地理院 淡色地図）/ 右: 検索・絞り込み・一覧・詳細
   データは data/siers.js（scripts/collect/merge.py が公開リストから自動収集・名寄せ）。依存は Leaflet と Leaflet.markercluster のみ。 */
(function () {
  'use strict';

  var T = window.SIER_TAXONOMY;
  var DATA = window.SIER_DATA;
  if (!T || !DATA) {
    document.body.innerHTML = '<p style="padding:2em">データ（data/siers.js, data/taxonomy.js）が読み込めませんでした。scripts/collect/merge.py を実行してください。</p>';
    return;
  }

  // ---------------------------------------------------------------- 小道具
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var fmtEmp = function (n) { return n == null ? '従業員数 不明' : n.toLocaleString('ja-JP') + '人'; };
  var fmtDate = function (s) { return s ? s.replace(/-/g, '/') : '—'; };
  var fmtKm = function (km) { return km < 10 ? '約' + km.toFixed(1) + ' km' : '約' + Math.round(km) + ' km'; };
  var isMobile = function () { return window.matchMedia('(max-width: 767px)').matches; };
  var hasPos = function (c) { return c.hq && c.hq.lat != null && c.hq.lng != null; };
  var UNCLASSIFIED = '未分類';

  // ---------------------------------------------------------------- 分類軸
  var PREF_REGION = {};
  var ALL_PREFS = [];
  T.regions.forEach(function (r) { r.prefectures.forEach(function (p) { PREF_REGION[p] = r.name; ALL_PREFS.push(p); }); });

  // 業種の色: パレットのスロット順に固定。その他=slot7、未分類（情報なし）=灰。上場区分はスロット1・2、不明=灰。
  var INDUSTRY_COLOR = {};
  T.industries.forEach(function (n, i) { INDUSTRY_COLOR[n] = n === 'その他' ? 'var(--s7)' : 'var(--s' + (i + 1) + ')'; });
  INDUSTRY_COLOR[UNCLASSIFIED] = 'var(--s-other)';
  var INDUSTRY_OPTIONS = T.industries.concat([UNCLASSIFIED]);
  var LISTING_COLOR = { '上場': 'var(--s1)', '非上場': 'var(--s2)', '不明': 'var(--s-other)' };
  var industriesOf = function (c) { return c.industries && c.industries.length ? c.industries : [UNCLASSIFIED]; };

  // 従業員数の階級 → 点の直径(px)
  var SIZE_D = { s0: 9, s1: 9, s2: 12, s3: 15, s4: 19, s5: 24, s6: 30 };
  function sizeClassOf(emp) {
    if (emp == null) return T.sizeClasses[0];
    for (var i = 0; i < T.sizeClasses.length; i++) {
      var s = T.sizeClasses[i];
      if (s.min != null && emp >= s.min && (s.max == null || emp <= s.max)) return s;
    }
    return T.sizeClasses[0];
  }
  var regionOf = function (c) { return c.hq && c.hq.prefecture ? PREF_REGION[c.hq.prefecture] : null; };
  var aiLabels = function (c) {
    return T.aiFlags.filter(function (f) { return c.aiSupport && c.aiSupport[f.key]; }).map(function (f) { return f.label; });
  };
  var SOURCE_LABEL = {};
  (T.sources || []).forEach(function (s) { SOURCE_LABEL[s.key] = s.label; });
  var sourceKeys = function (c) {
    var ks = {};
    ((c.meta && c.meta.sources) || []).forEach(function (s) { ks[s.source] = true; });
    return Object.keys(ks);
  };
  // 眠るSI: 協会名簿・メーカーのSIerリスト・国の事例集のどれにも載っておらず、ウェブ発掘で見つかった会社（はせ川工業・ROBOSHIN など）
  var LISTED_SOURCES = { robonavi: 1, farobotsier: 1, fanuc: 1, kawasaki: 1, mitsubishi: 1, yaskawa: 1, irex: 1, csc: 1, handbook: 1 };
  var GEM_LABEL = '眠るSI（名簿未掲載）', LISTED_LABEL = '名簿・メーカーリスト掲載';
  var isGem = function (c) {
    var ks = sourceKeys(c);
    return ks.indexOf('discovery') >= 0 && !ks.some(function (k) { return LISTED_SOURCES[k]; });
  };
  var GEM_TITLE = '協会名簿・メーカーのSIerリストに載っていない、ウェブで発掘した地元の会社';

  // 絞り込みグループ（グループ内はOR、グループ間はAND）。選択肢が無いグループは表示しない
  var GROUPS = [
    { key: 'region', label: '地域', options: T.regions.map(function (r) { return r.name; }), get: function (c) { return [regionOf(c)]; }, open: true },
    { key: 'prefecture', label: '都道府県', options: ALL_PREFS, get: function (c) { return [c.hq && c.hq.prefecture]; }, select: true, open: true },
    { key: 'industry', label: '業種', options: INDUSTRY_OPTIONS, get: industriesOf, open: true, color: function (n) { return INDUSTRY_COLOR[n]; } },
    { key: 'process', label: '得意な工程', options: T.processes, get: function (c) { return c.processes || []; }, open: true },
    { key: 'robotType', label: 'ロボット種別', options: T.robotTypes, get: function (c) { return c.robotTypes || []; } },
    { key: 'maker', label: '対応ロボットメーカー', options: T.makers, get: function (c) { return c.makers || []; }, open: true },
    { key: 'ai', label: 'AI・自律系の対応', options: T.aiFlags.map(function (f) { return f.label; }), get: aiLabels },
    { key: 'size', label: '規模（従業員数）', options: T.sizeClasses.map(function (s) { return s.label; }), get: function (c) { return [sizeClassOf(c.employees).label]; } },
    { key: 'listing', label: '上場区分', options: T.listing, get: function (c) { return [c.listing && c.listing.status || '不明']; } },
    { key: 'gem', label: '掲載の種類', options: [GEM_LABEL, LISTED_LABEL], get: function (c) { return [isGem(c) ? GEM_LABEL : LISTED_LABEL]; } },
    { key: 'source', label: '情報源', options: (T.sources || []).map(function (s) { return s.key; }), display: function (k) { return SOURCE_LABEL[k] || k; }, get: sourceKeys },
    { key: 'product', label: '取扱製品', options: T.products || [], get: function (c) { return c.products || []; } },
    { key: 'maintenance', label: '保守体制', options: T.maintenanceSystems || [], get: function (c) { return c.maintenance && c.maintenance.system ? [c.maintenance.system] : []; } }
  ].filter(function (g) { return g.options && g.options.length; });

  var byId = {};
  DATA.forEach(function (c) { byId[c.id] = c; });

  // ---------------------------------------------------------------- 状態
  var state = {
    q: '',
    f: {},               // グループごとの選択値 Set
    colorAxis: 'industry',
    sort: 'employees',
    selectedId: null,
    highlight: {},       // 凡例で強調中のカテゴリ {name: true}
    filtersOpen: false
  };
  GROUPS.forEach(function (g) { state.f[g.key] = new Set(); });
  var parsed = { derived: {}, free: [], notes: [] };
  var current = DATA.slice();

  var hlCount = function () { return Object.keys(state.highlight).length; };
  var categoryOf = function (c) { return state.colorAxis === 'industry' ? industriesOf(c)[0] : (c.listing && c.listing.status) || '不明'; };
  var colorForCat = function (k) { return state.colorAxis === 'industry' ? (INDUSTRY_COLOR[k] || 'var(--s-other)') : (LISTING_COLOR[k] || 'var(--s-other)'); };
  var colorOf = function (c) { return colorForCat(categoryOf(c)); };
  var isDim = function (c) { return hlCount() > 0 && !state.highlight[categoryOf(c)]; };

  // ---------------------------------------------------------------- 自由文 → 条件（本番はLLMで変換。ここでは辞書で代替）
  var MAKER_ALIASES = {
    'fanuc': 'FANUC', 'ファナック': 'FANUC', '安川': '安川電機', 'yaskawa': '安川電機', '川崎': '川崎重工', '川重': '川崎重工',
    'kawasaki': '川崎重工', 'デンソー': 'デンソーウェーブ', 'denso': 'デンソーウェーブ', 'ur': 'Universal Robots',
    'ユニバーサルロボット': 'Universal Robots', 'universal': 'Universal Robots', '三菱': '三菱電機', 'ナチ': '不二越', 'nachi': '不二越',
    'abb': 'ABB', 'kuka': 'KUKA', 'クーカ': 'KUKA', 'epson': 'エプソン', 'ヤマハ': 'ヤマハ発動機', 'daihen': 'ダイヘン'
  };
  var TYPE_ALIASES = {
    '協働': '協働ロボット', 'コボット': '協働ロボット', 'amr': 'AMR', 'agv': 'AMR', '自律移動': 'AMR', '双腕': '双腕ロボット',
    'モバイルマニピュレータ': '自律移動マニピュレータ', 'moma': '自律移動マニピュレータ', 'アーム': '産業用アーム', '産業用ロボット': '産業用アーム'
  };
  var AI_ALIASES = { 'ai': ['AI制御', '画像認識'], '画像': ['画像認識'], 'ビジョン': ['画像認識'], 'amr連携': ['AMR連携'] };
  var REGION_ALIASES = { '関西': '近畿', '中部': '東海', '北陸': '北陸・甲信越', '甲信越': '北陸・甲信越', '九州': '九州・沖縄', '東北': '北海道・東北', '中国': '中国・四国', '四国': '中国・四国' };
  var INDUSTRY_ALIASES = { '製薬': '医薬系', '医療': '医薬系', '車': '自動車系', 'ev': '自動車系', '倉庫': '物流系', '電子': '電機系', '飲料': '食品系' };
  var PROCESS_ALIASES = { 'ハンドリング': '搬送・ハンドリング', '搬送': '搬送・ハンドリング', '検査': '検査・測定', '梱包': '包装・梱包', '包装': '包装・梱包',
    'バリ取り': 'バリ取り・研磨', '研磨': 'バリ取り・研磨', 'ローディング': '加工機への供給', '加工機': '加工機への供給', 'レーザ': '加工（レーザ・切削）',
    'レーザー': '加工（レーザ・切削）', '切削': '加工（レーザ・切削）', 'シーリング': 'シーリング・塗布', '塗布': 'シーリング・塗布', 'パレタイジング': 'パレタイズ' };

  function parseQuery(q) {
    var derived = {};
    GROUPS.forEach(function (g) { derived[g.key] = new Set(); });
    var free = [], notes = [];
    var tokens = q.trim().split(/[\s　、,，]+/).filter(Boolean);

    tokens.forEach(function (raw) {
      var t = raw.toLowerCase();
      var hit;

      hit = ALL_PREFS.filter(function (p) { return p === raw || p.replace(/[県府]$/, '') === raw || (p === '東京都' && raw === '東京'); })[0];
      if (hit) { derived.prefecture.add(hit); notes.push([raw, '都道府県']); return; }

      hit = T.regions.filter(function (r) { return r.name === raw; })[0];
      if (!hit && REGION_ALIASES[raw]) hit = { name: REGION_ALIASES[raw] };
      if (hit) { derived.region.add(hit.name); notes.push([raw, '地域']); return; }

      hit = INDUSTRY_OPTIONS.filter(function (x) { return x === raw || x.replace(/系$/, '') === raw; })[0] || INDUSTRY_ALIASES[t];
      if (hit) { derived.industry.add(hit); notes.push([raw, '業種']); return; }

      if (T.listing.indexOf(raw) >= 0 && derived.listing) { derived.listing.add(raw); notes.push([raw, '上場区分']); return; }

      if (AI_ALIASES[t]) { AI_ALIASES[t].forEach(function (x) { derived.ai.add(x); }); notes.push([raw, 'AI・自律系']); return; }
      hit = T.aiFlags.filter(function (f) { return f.label === raw; })[0];
      if (hit) { derived.ai.add(hit.label); notes.push([raw, 'AI・自律系']); return; }

      hit = T.robotTypes.filter(function (x) { return x === raw || x.toLowerCase() === t; })[0] || TYPE_ALIASES[t];
      if (hit) { derived.robotType.add(hit); notes.push([raw, 'ロボット種別']); return; }

      hit = T.makers.filter(function (x) { return x.toLowerCase() === t; })[0] || MAKER_ALIASES[t];
      if (hit) { derived.maker.add(hit); notes.push([raw, '対応メーカー']); return; }

      hit = T.processes.filter(function (x) { return x === raw || (raw.length >= 2 && x.indexOf(raw) >= 0); })[0] || PROCESS_ALIASES[raw];
      if (hit) { derived.process.add(hit); notes.push([raw, '工程']); return; }

      free.push(raw);
    });
    return { derived: derived, free: free, notes: notes };
  }

  // ---------------------------------------------------------------- 絞り込みの計算
  function effectiveFilters(exceptKey) {
    var eff = {};
    GROUPS.forEach(function (g) {
      var s = new Set();
      if (g.key !== exceptKey) {
        state.f[g.key].forEach(function (v) { s.add(v); });
        if (parsed.derived[g.key]) parsed.derived[g.key].forEach(function (v) { s.add(v); });
      }
      eff[g.key] = s;
    });
    return eff;
  }
  var hayCache = {};
  function haystack(c) {
    if (hayCache[c.id]) return hayCache[c.id];
    var parts = [c.name, c.shortName, c.hq && c.hq.prefecture, c.hq && c.hq.city, c.hq && c.hq.address, c.description, c.website]
      .concat((c.clients || []).map(function (x) { return x.name; }))
      .concat((c.cases || []).map(function (x) { return x.title; }))
      .concat(c.products || [], c.certifications || [], c.makers || [], c.processes || [], c.robotTypes || [], c.industries || [],
        c.services || [], c.rawApplications || [], (c.maintenance && c.maintenance.areas) || [])
      .concat((c.branches || []).map(function (b) { return (b.prefecture || '') + (b.city || '') + (b.name || ''); }))
      .concat(((c.meta && c.meta.sources) || []).map(function (s) { return s.label; }));
    hayCache[c.id] = parts.filter(Boolean).join(' ').toLowerCase();
    return hayCache[c.id];
  }
  function matches(c, eff, free) {
    for (var i = 0; i < GROUPS.length; i++) {
      var g = GROUPS[i], sel = eff[g.key];
      if (!sel.size) continue;
      var vals = g.get(c), ok = false;
      for (var j = 0; j < vals.length; j++) { if (sel.has(vals[j])) { ok = true; break; } }
      if (!ok) return false;
    }
    if (free.length) {
      var h = haystack(c);
      for (var k = 0; k < free.length; k++) { if (h.indexOf(free[k].toLowerCase()) < 0) return false; }
    }
    return true;
  }
  function compute() {
    var eff = effectiveFilters(null);
    current = DATA.filter(function (c) { return matches(c, eff, parsed.free); });
  }
  function facetCounts(g) {
    var eff = effectiveFilters(g.key), counts = {};
    g.options.forEach(function (o) { counts[o] = 0; });
    DATA.forEach(function (c) {
      if (!matches(c, eff, parsed.free)) return;
      g.get(c).forEach(function (v) { if (v in counts) counts[v]++; });
    });
    return counts;
  }

  // ---------------------------------------------------------------- 地図
  var map = L.map('map', { zoomControl: false, attributionControl: false, minZoom: 4, maxZoom: 17, zoomSnap: 0.5 })
    .setView([36.5, 137.0], 5); // 日本全体。起動後に fitAll() で全社が収まる範囲へ
  L.control.zoom({ position: 'topleft' }).addTo(map);
  L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);
  // 背景地図: 見慣れた OpenStreetMap を既定にし、国土地理院の標準／淡色に切り替えられる（いずれも無償・出典表示のみ。Google Maps は
  // APIキーと課金が前提のため採用しない）
  // OpenStreetMap の公開タイルは利用方針により 403 で拒否されるため使わない。
  var DEFAULT_BASE = '国土地理院 淡色地図';
  var BASEMAPS = {
    '国土地理院 淡色地図': L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
      attribution: '地図: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>', minZoom: 2, maxZoom: 18 }),
    '国土地理院 標準地図': L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
      attribution: '地図: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>', minZoom: 2, maxZoom: 18 }),
    'CARTO Voyager（OSMデータ）': L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '地図: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
      subdomains: 'abcd', maxZoom: 19 })
  };
  var baseName = DEFAULT_BASE;
  try { baseName = localStorage.getItem('sier-map-basemap') || baseName; } catch (e) { /* 無視 */ }
  if (!BASEMAPS[baseName]) baseName = DEFAULT_BASE;
  BASEMAPS[baseName].addTo(map);
  var layersCtl = L.control.layers(BASEMAPS, null, { position: 'topright', collapsed: true }).addTo(map);
  map.on('baselayerchange', function (e) { baseName = e.name; try { localStorage.setItem('sier-map-basemap', e.name); } catch (err) { /* 無視 */ } });
  // タイルが続けて取れない背景地図は、自動で標準地図に戻す（サーバー側の拒否・障害に備える）
  Object.keys(BASEMAPS).forEach(function (name) {
    if (name === DEFAULT_BASE) return;
    var errs = 0;
    BASEMAPS[name].on('tileerror', function () {
      errs += 1;
      if (errs >= 4 && map.hasLayer(BASEMAPS[name])) {
        map.removeLayer(BASEMAPS[name]);
        BASEMAPS[DEFAULT_BASE].addTo(map);
        try { localStorage.setItem('sier-map-basemap', DEFAULT_BASE); } catch (err) { /* 無視 */ }
        errs = 0;
      }
    });
    BASEMAPS[name].on('load', function () { errs = 0; });
  });

  var cluster = L.markerClusterGroup({
    maxClusterRadius: 34,
    disableClusteringAtZoom: 11,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    iconCreateFunction: function (cl) {
      var n = cl.getChildCount();
      var d = n < 10 ? 30 : n < 30 ? 36 : n < 100 ? 44 : 52;
      return L.divIcon({ className: 'cl-wrap', html: '<div class="cl" style="--d:' + d + 'px" aria-label="' + n + '社">' + n + '</div>', iconSize: [d, d], iconAnchor: [d / 2, d / 2] });
    }
  });
  map.addLayer(cluster);

  function iconFor(c) {
    var sc = sizeClassOf(c.employees), d = SIZE_D[sc.key];
    var cls = ['mk', c.listing && c.listing.status === '上場' ? 'square' : 'circle'];
    if (c.employees == null) cls.push('unknown');
    if (isDim(c)) cls.push('dim');
    if (c.id === state.selectedId) cls.push('selected');
    var box = Math.max(d + 8, 26); // 当たり判定は点より大きく
    return L.divIcon({
      className: 'mk-wrap',
      html: '<span class="' + cls.join(' ') + '" style="--d:' + d + 'px;--c:' + colorOf(c) + '"></span>',
      iconSize: [box, box], iconAnchor: [box / 2, box / 2], tooltipAnchor: [0, -(d / 2) - 6]
    });
  }
  function tooltipHtml(c) {
    var loc = c.hq ? [c.hq.prefecture, c.hq.city].filter(Boolean).join(' ') : '';
    var prec = c.hq && c.hq.precision === 'prefecture' ? '（位置は県庁所在地で代替）' : '';
    return '<strong>' + esc(c.name) + '</strong>' +
      '<span class="muted">' + esc(loc) + esc(prec) + '</span><br>' +
      esc(industriesOf(c)[0]) + ' ・ ' + esc(fmtEmp(c.employees)) + (c.makers && c.makers.length ? ' ・ ' + esc(c.makers.slice(0, 3).join('／')) : '');
  }
  var markers = {};
  DATA.forEach(function (c) {
    if (!hasPos(c)) return;
    var m = L.marker([c.hq.lat, c.hq.lng], { icon: iconFor(c), title: c.name, keyboard: true, riseOnHover: true });
    m.bindTooltip(function () { return tooltipHtml(c); }, { direction: 'top', opacity: 1, className: 'tip' });
    m.on('click', function () { select(c.id, false); });
    markers[c.id] = m;
  });
  function refreshMap() {
    cluster.clearLayers();
    cluster.addLayers(current.filter(hasPos).map(function (c) { return markers[c.id]; }));
  }
  function refreshIcons() {
    DATA.forEach(function (c) { if (markers[c.id]) markers[c.id].setIcon(iconFor(c)); });
  }
  function distKm(a, c) {
    if (!hasPos(c)) return Infinity;
    var R = 6371, toR = Math.PI / 180;
    var dLat = (c.hq.lat - a.lat) * toR, dLng = (c.hq.lng - a.lng) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * toR) * Math.cos(c.hq.lat * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fitAll() {
    var pts = DATA.filter(hasPos).map(function (c) { return [c.hq.lat, c.hq.lng]; });
    if (!pts.length) return;
    var b = L.latLngBounds(pts);
    // 右パネルは地図の上に浮いているので、その幅ぶんを避けて収める
    var opts = { paddingTopLeft: [24, 24], paddingBottomRight: [Math.round(panel.getBoundingClientRect().width) + 36, 24] };
    if (isMobile()) opts = { paddingTopLeft: [16, 60], paddingBottomRight: [16, Math.round(window.innerHeight * 0.5) + 16] };
    map.fitBounds(b, opts);
  }

  // ---------------------------------------------------------------- 凡例
  function buildSizeScale() {
    var wrap = $('#sizeScale');
    wrap.innerHTML = T.sizeClasses.slice(1).map(function (s) {
      return '<span class="size-item"><i class="mk circle" style="--d:' + SIZE_D[s.key] + 'px;--c:var(--text-3)"></i><small>' + esc(s.label.replace('人', '')) + '</small></span>';
    }).join('');
  }
  function renderLegend() {
    var cats = state.colorAxis === 'industry' ? INDUSTRY_OPTIONS : T.listing;
    var counts = {};
    cats.forEach(function (k) { counts[k] = 0; });
    current.forEach(function (c) { var k = categoryOf(c); counts[k] = (counts[k] || 0) + 1; });
    var ul = $('#legendColors');
    ul.innerHTML = '';
    cats.forEach(function (k) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'legend-item' + (hlCount() && !state.highlight[k] ? ' is-off' : '') + (state.highlight[k] ? ' is-hl' : '');
      b.setAttribute('aria-pressed', String(!!state.highlight[k]));
      b.title = k + 'を強調表示';
      b.innerHTML = '<i class="dot" style="--c:' + colorForCat(k) + '"></i><span>' + esc(k) + '</span><span class="n">' + counts[k] + '</span>';
      b.addEventListener('click', function () {
        if (state.highlight[k]) delete state.highlight[k]; else state.highlight[k] = true;
        renderLegend(); refreshIcons(); renderList();
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
    $$('.seg-btn').forEach(function (b) {
      var on = b.dataset.axis === state.colorAxis;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
  }
  $$('.seg-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      if (state.colorAxis === b.dataset.axis) return;
      state.colorAxis = b.dataset.axis;
      state.highlight = {};
      renderLegend(); refreshIcons(); renderList();
    });
  });
  $('#legendToggle').addEventListener('click', function () {
    var lg = $('#legend'), collapsed = lg.classList.toggle('is-collapsed');
    this.setAttribute('aria-expanded', String(!collapsed));
    this.textContent = collapsed ? '+' : '−';
    this.title = collapsed ? '凡例を開く' : '凡例を折りたたむ';
  });

  // ---------------------------------------------------------------- 絞り込みUI
  var filterGroupsEl = $('#filterGroups');
  var disp = function (g, v) { return g.display ? g.display(v) : v; };
  function buildFilters() {
    filterGroupsEl.innerHTML = '';
    GROUPS.forEach(function (g) {
      var det = document.createElement('details');
      det.className = 'fg';
      det.dataset.key = g.key;
      if (g.open) det.open = true;
      var sum = document.createElement('summary');
      sum.innerHTML = '<span>' + esc(g.label) + '</span><span class="fg-n" data-n></span>';
      det.appendChild(sum);
      var body = document.createElement('div');
      body.className = 'fg-body';
      if (g.select) {
        var sel = document.createElement('select');
        sel.className = 'pref-select';
        sel.setAttribute('aria-label', '都道府県を選んで追加');
        sel.innerHTML = '<option value="">都道府県を選んで追加…</option>' + T.regions.map(function (r) {
          return '<optgroup label="' + esc(r.name) + '">' + r.prefectures.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join('') + '</optgroup>';
        }).join('');
        sel.addEventListener('change', function () {
          if (sel.value) { state.f.prefecture.add(sel.value); sel.value = ''; update(); }
        });
        body.appendChild(sel);
        var chipsSel = document.createElement('div');
        chipsSel.className = 'chips chips-selected';
        body.appendChild(chipsSel);
      } else {
        var chips = document.createElement('div');
        chips.className = 'chips';
        g.options.forEach(function (o) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'chip';
          b.dataset.v = o;
          b.setAttribute('aria-pressed', 'false');
          b.innerHTML = (g.color ? '<i class="dot" style="--c:' + g.color(o) + '"></i>' : '') + '<span>' + esc(disp(g, o)) + '</span><span class="n"></span>';
          b.addEventListener('click', function () { toggleFilter(g.key, o); });
          chips.appendChild(b);
        });
        body.appendChild(chips);
      }
      det.appendChild(body);
      filterGroupsEl.appendChild(det);
    });
  }
  function toggleFilter(key, v) {
    var s = state.f[key];
    if (s.has(v)) s.delete(v); else s.add(v);
    update();
  }
  function removableChip(g, v) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip is-on';
    b.title = '解除';
    b.innerHTML = (g.color ? '<i class="dot" style="--c:' + g.color(v) + '"></i>' : '') + '<span>' + esc(disp(g, v)) + '</span><span class="x" aria-hidden="true">×</span>';
    b.addEventListener('click', function () { state.f[g.key].delete(v); update(); });
    return b;
  }
  function updateFilterUI() {
    var active = 0;
    GROUPS.forEach(function (g) {
      var det = filterGroupsEl.querySelector('.fg[data-key="' + g.key + '"]');
      var counts = facetCounts(g);
      var nSel = state.f[g.key].size;
      active += nSel;
      det.querySelector('[data-n]').textContent = nSel ? nSel + '件選択' : '';
      if (g.select) {
        var wrap = det.querySelector('.chips-selected');
        wrap.innerHTML = '';
        state.f.prefecture.forEach(function (p) { wrap.appendChild(removableChip(g, p)); });
        if (parsed.derived.prefecture) parsed.derived.prefecture.forEach(function (p) {
          if (state.f.prefecture.has(p)) return;
          var b = document.createElement('span');
          b.className = 'chip is-on is-derived';
          b.title = '検索語から解釈';
          b.innerHTML = '<span>' + esc(p) + '</span>';
          wrap.appendChild(b);
        });
      } else {
        $$('.chip', det).forEach(function (b) {
          var v = b.dataset.v;
          var on = state.f[g.key].has(v);
          var derived = !on && parsed.derived[g.key] && parsed.derived[g.key].has(v);
          b.classList.toggle('is-on', on || derived);
          b.classList.toggle('is-derived', !!derived);
          b.setAttribute('aria-pressed', String(on || derived));
          b.querySelector('.n').textContent = counts[v];
          b.disabled = !on && !derived && counts[v] === 0;
        });
      }
    });
    var cnt = $('#activeCount');
    cnt.hidden = !active;
    cnt.textContent = active;
    $('#resetBtn').hidden = !active && !state.q && !hlCount();

    // 絞り込みを閉じているときは、選択中の条件をチップで要約
    var ac = $('#activeChips');
    ac.innerHTML = '';
    if (!state.filtersOpen) {
      GROUPS.forEach(function (g) { state.f[g.key].forEach(function (v) { ac.appendChild(removableChip(g, v)); }); });
    }
  }
  $('#filtersToggle').addEventListener('click', function () {
    state.filtersOpen = !state.filtersOpen;
    this.setAttribute('aria-expanded', String(state.filtersOpen));
    filterGroupsEl.hidden = !state.filtersOpen;
    updateFilterUI();
  });
  $('#resetBtn').addEventListener('click', function () {
    GROUPS.forEach(function (g) { state.f[g.key].clear(); });
    state.q = '';
    $('#q').value = '';
    state.highlight = {};
    update();
    refreshIcons();
  });

  // ---------------------------------------------------------------- 検索
  function renderInterp() {
    var el = $('#interp');
    $('#qClear').hidden = !state.q;
    if (!state.q.trim()) { el.innerHTML = ''; return; }
    var parts = parsed.notes.map(function (n) { return '<span class="interp-chip">「' + esc(n[0]) + '」<b>' + esc(n[1]) + '</b></span>'; });
    if (parsed.free.length) parts.push('<span class="interp-chip">「' + esc(parsed.free.join(' ')) + '」<b>会社名・紹介文・対応業務を全文検索</b></span>');
    el.innerHTML = '<span class="interp-lead">解釈:</span>' + parts.join('') + '<span class="interp-note">（本番は自由文をLLMで条件に変換）</span>';
  }
  var qTimer = null;
  $('#q').addEventListener('input', function () {
    var v = this.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { state.q = v; update(); }, 160);
  });
  $('#q').addEventListener('keydown', function (e) { if (e.key === 'Escape') { this.value = ''; state.q = ''; update(); } });
  $('#qClear').addEventListener('click', function () { $('#q').value = ''; state.q = ''; update(); $('#q').focus(); });

  // ---------------------------------------------------------------- 一覧
  function sortList(list) {
    var s = state.sort, center = map.getCenter();
    return list.slice().sort(function (a, b) {
      if (s === 'employees') {
        var d = (b.employees == null ? -1 : b.employees) - (a.employees == null ? -1 : a.employees);
        return d !== 0 ? d : (b.meta.sources.length - a.meta.sources.length) || a.shortName.localeCompare(b.shortName, 'ja');
      }
      if (s === 'sources') return (b.meta.sources.length - a.meta.sources.length) || a.shortName.localeCompare(b.shortName, 'ja');
      if (s === 'updated') return (b.meta.updatedAt || '').localeCompare(a.meta.updatedAt || '');
      if (s === 'distance') return distKm(center, a) - distKm(center, b);
      return a.shortName.localeCompare(b.shortName, 'ja');
    });
  }
  function renderList() {
    var listEl = $('#list');
    var sorted = sortList(current);
    var center = map.getCenter();
    var located = current.filter(hasPos).length;
    $('#count').textContent = '該当 ' + current.length + '社 / 全' + DATA.length + '社' + (located < current.length ? '（地図に表示 ' + located + '社）' : '');
    $('#empty').hidden = current.length > 0;
    listEl.innerHTML = sorted.map(function (c) {
      var sc = sizeClassOf(c.employees), d = Math.min(SIZE_D[sc.key], 18);
      var shape = c.listing && c.listing.status === '上場' ? 'square' : 'circle';
      var cls = 'item' + (c.id === state.selectedId ? ' is-selected' : '') + (isDim(c) ? ' is-dim' : '');
      var loc = c.hq && c.hq.prefecture ? esc(c.hq.prefecture) + (c.hq.city ? ' ' + esc(c.hq.city) : '') : '<span class="muted">所在地 未取得</span>';
      var what = (c.processes && c.processes.length) ? esc(c.processes.slice(0, 3).join('／')) : (c.makers && c.makers.length ? esc(c.makers.slice(0, 3).join('／')) + ' 対応' : '');
      var sub = loc + (what ? ' ・ ' + what : '');
      var tags = industriesOf(c).map(function (i) { return '<span class="tag"><i class="dot" style="--c:' + INDUSTRY_COLOR[i] + '"></i>' + esc(i) + '</span>'; }).join('');
      if (isGem(c)) tags += '<span class="badge gem" title="' + GEM_TITLE + '">💎 眠るSI</span>';
      if (c.listing && c.listing.status === '上場') tags += '<span class="badge">上場</span>';
      var ns = c.meta && c.meta.sources ? c.meta.sources.length : 0;
      if (ns >= 2) tags += '<span class="badge" title="複数の公開リストに掲載">' + ns + '情報源</span>';
      if (!hasPos(c)) tags += '<span class="badge">地図外</span>';
      var side = state.sort === 'distance'
        ? '<span class="num">' + (hasPos(c) ? esc(fmtKm(distKm(center, c))) : '—') + '</span><span class="num muted">' + esc(fmtEmp(c.employees)) + '</span>'
        : '<span class="num">' + esc(fmtEmp(c.employees)) + '</span>';
      return '<li><button type="button" class="' + cls + '" data-id="' + c.id + '">' +
        '<span class="item-mark"><i class="mk ' + shape + (c.employees == null ? ' unknown' : '') + '" style="--d:' + d + 'px;--c:' + colorOf(c) + '"></i></span>' +
        '<span class="item-main"><span class="item-name">' + esc(c.name) + (dug[c.id] ? '<span class="dug" title="発掘済み">⛏</span>' : '') + '</span><span class="item-sub">' + sub + '</span><span class="item-tags">' + tags + '</span></span>' +
        '<span class="item-side">' + side + '</span></button></li>';
    }).join('');
  }
  $('#list').addEventListener('click', function (e) {
    var b = e.target.closest('.item');
    if (b) select(b.dataset.id, true);
  });
  $('#list').addEventListener('mouseover', function (e) {
    var b = e.target.closest('.item');
    if (!b) return;
    var m = markers[b.dataset.id];
    if (m && cluster.hasLayer(m) && cluster.getVisibleParent(m) === m) m.openTooltip();
  });
  $('#list').addEventListener('mouseout', function (e) {
    var b = e.target.closest('.item');
    if (b && markers[b.dataset.id]) markers[b.dataset.id].closeTooltip();
  });
  $('#sort').addEventListener('change', function () { state.sort = this.value; renderList(); });
  map.on('moveend', function () { if (state.sort === 'distance') renderList(); });

  // ---------------------------------------------------------------- 詳細
  var panel = $('#panel');
  function pills(arr, cls) {
    if (!arr || !arr.length) return '<span class="muted">—</span>';
    return '<span class="pills">' + arr.map(function (x) { return '<span class="pill ' + (cls || '') + '">' + esc(x) + '</span>'; }).join('') + '</span>';
  }
  function shortUrl(u) { return String(u || '').replace(/^https?:\/\//, '').replace(/\/$/, ''); }
  // 項目ごとの出所（meta.fieldSources）。「この値はどこから来た？」に答える小さなリンク
  function prov(c, field) {
    var fs = (c.meta && c.meta.fieldSources) || {};
    var p = fs[field];
    if (!p) return '';
    var kind = p.source === 'manual' ? '手動確認' : p.source === 'website' ? '公式サイト' : p.source === 'site-text' ? 'サイト本文から推定' : (SOURCE_LABEL[p.source] || p.label || p.source);
    var inner = esc(kind) + (p.retrievedAt ? ' ' + esc(fmtDate(p.retrievedAt)) : '');
    return '<span class="prov" title="' + esc(p.label || '') + (p.url ? '\n' + esc(p.url) : '') + '">出所: ' +
      (p.url ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + inner + ' ↗</a>' : inner) + '</span>';
  }
  function renderDetail(c) {
    var sc = sizeClassOf(c.employees), d = Math.min(SIZE_D[sc.key], 18);
    var shape = c.listing && c.listing.status === '上場' ? 'square' : 'circle';
    var ai = T.aiFlags.map(function (f) {
      var on = c.aiSupport && c.aiSupport[f.key];
      return '<span class="pill ' + (on ? 'on' : 'off') + '">' + (on ? '✓ ' : '') + esc(f.label) + '</span>';
    }).join('');
    var branches = (c.branches || []).map(function (b) { return [b.prefecture, b.city, b.name ? '（' + b.name + '）' : ''].filter(Boolean).join(''); });
    var hq = c.hq || {};
    var html = '';
    html += '<div class="d-top"><i class="mk ' + shape + (c.employees == null ? ' unknown' : '') + '" style="--d:' + d + 'px;--c:' + colorOf(c) + '"></i>' +
      industriesOf(c).map(function (i) { return '<span class="tag"><i class="dot" style="--c:' + INDUSTRY_COLOR[i] + '"></i>' + esc(i) + '</span>'; }).join('') +
      (isGem(c) ? '<span class="badge gem" title="' + GEM_TITLE + '">💎 眠るSI</span>' : '') +
      (c.listing && c.listing.status !== '不明' ? '<span class="badge">' + esc(c.listing.status) + (c.listing.market ? '・' + esc(c.listing.market) : '') + '</span>' : '') +
      (c.certifications || []).map(function (x) { return '<span class="badge">' + esc(x) + '</span>'; }).join('') + '</div>';
    html += '<h2 class="d-name">' + esc(c.name) + '</h2>';
    html += '<p class="d-addr">' + (hq.address ? esc(hq.address) : (hq.prefecture ? esc(hq.prefecture) + (hq.city ? ' ' + esc(hq.city) : '') + '<span class="muted">（番地未取得）</span>' : '<span class="muted">所在地 未取得</span>')) +
      (hq.precision && hq.precision !== 'address' ? '<br><span class="muted">地図上の位置は' + (hq.precision === 'prefecture' ? '県庁所在地' : hq.precision === 'city' ? '市区町村' : '町名') + 'で代替</span>' : '') + '</p>';
    if (c.description) html += '<p class="d-desc">' + esc(c.description) + '</p>';
    html += '<div class="d-links">' +
      (c.website ? '<a class="primary" href="' + esc(c.website) + '" target="_blank" rel="noopener">公式サイト ↗</a>' : '<span class="muted">公式サイト 未取得</span>') +
      (c.casesUrl ? '<a href="' + esc(c.casesUrl) + '" target="_blank" rel="noopener">導入事例 ↗</a>' : '') +
      (c.contactUrl ? '<a href="' + esc(c.contactUrl) + '" target="_blank" rel="noopener">問い合わせ ↗</a>' : '') +
      '</div>';

    html += '<section class="d-sec"><h3>概要・規模</h3><dl class="kv">' +
      '<dt>法人格</dt><dd>' + (c.legalForm ? esc(c.legalForm) : '<span class="muted">—</span>') + '</dd>' +
      '<dt>本社</dt><dd>' + (hq.prefecture ? esc(hq.prefecture) + ' ' + esc(hq.city || '') : '<span class="muted">未取得</span>') + prov(c, 'hq') + '</dd>' +
      '<dt>支店・拠点</dt><dd>' + (branches.length ? esc(branches.join('、')) : '<span class="muted">情報なし</span>') + '</dd>' +
      '<dt>設立</dt><dd>' + (c.founded ? c.founded + '年' : '<span class="muted">—</span>') + prov(c, 'founded') + '</dd>' +
      '<dt>従業員数</dt><dd>' + (c.employees != null ? esc(fmtEmp(c.employees)) : '<span class="muted">不明</span>') + prov(c, 'employees') + '</dd>' +
      '<dt>資本金</dt><dd>' + (c.capital ? esc(c.capital) : '<span class="muted">—</span>') + prov(c, 'capital') + '</dd>' +
      '<dt>公式サイト</dt><dd>' + (c.website ? '<a href="' + esc(c.website) + '" target="_blank" rel="noopener">' + esc(shortUrl(c.website)) + '</a>' : '<span class="muted">未取得</span>') + prov(c, 'website') + '</dd>' +
      '</dl></section>';

    html += '<section class="d-sec"><h3>得意領域</h3><dl class="kv">' +
      '<dt>対応メーカー</dt><dd>' + pills(c.makers) + '</dd>' +
      '<dt>得意な工程</dt><dd>' + pills(c.processes) + prov(c, 'processes') + '</dd>' +
      '<dt>ロボット種別</dt><dd>' + pills(c.robotTypes) + '</dd>' +
      '<dt>業種</dt><dd>' + pills(c.industries) + prov(c, 'industries') + '</dd>' +
      '<dt>AI・自律系</dt><dd><span class="pills">' + ai + '</span>' + (c.aiSupport && c.aiSupport.notes ? '<div class="muted" style="font-size:12px;margin-top:4px">' + esc(c.aiSupport.notes) + '</div>' : '') + '</dd>' +
      (c.rawApplications && c.rawApplications.length ? '<dt>掲載元の表記</dt><dd><span class="muted">' + esc(c.rawApplications.join('、')) + '</span></dd>' : '') +
      '</dl></section>';

    if ((c.services && c.services.length) || (c.maintenance && c.maintenance.areas && c.maintenance.areas.length)) {
      html += '<section class="d-sec"><h3>対応できる業務・地域</h3><dl class="kv">' +
        (c.services && c.services.length ? '<dt>対応可能業務</dt><dd>' + pills(c.services) + '</dd>' : '') +
        (c.maintenance && c.maintenance.areas && c.maintenance.areas.length ? '<dt>対応地域</dt><dd>' + pills(c.maintenance.areas) + '</dd>' : '') +
        (c.maintenance && c.maintenance.system ? '<dt>保守体制</dt><dd>' + esc(c.maintenance.system) + '</dd>' : '') +
        '</dl></section>';
    }

    if ((c.clients && c.clients.length) || (c.cases && c.cases.length) || (c.products && c.products.length)) {
      html += '<section class="d-sec"><h3>実績</h3><dl class="kv">';
      if (c.clients && c.clients.length) html += '<dt>取引先</dt><dd><ul class="plain">' + c.clients.map(function (x) {
        return '<li>' + esc(x.name) + (x.sourceUrl ? '<span class="src-line">出所: <a href="' + esc(x.sourceUrl) + '" target="_blank" rel="noopener">' + esc(shortUrl(x.sourceUrl)) + '</a> ・ 取得 ' + esc(fmtDate(x.retrievedAt)) + '</span>' : '') + '</li>';
      }).join('') + '</ul></dd>';
      if (c.cases && c.cases.length) html += '<dt>導入事例</dt><dd><ul class="plain">' + c.cases.map(function (x) { return '<li><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.title) + '</a></li>'; }).join('') + '</ul></dd>';
      if (c.products && c.products.length) html += '<dt>取扱製品</dt><dd>' + pills(c.products) + '</dd>';
      html += '</dl></section>';
    }

    var srcs = (c.meta && c.meta.sources) || [];
    var seenSrc = {};
    srcs = srcs.filter(function (s) { var k = s.url + '|' + s.label; if (seenSrc[k]) return false; seenSrc[k] = true; return true; });
    // 掲載元の記録が無い会社(公式サイトURLだけが分かっている)は、公式サイトを掲載元として示す
    if (!srcs.length && c.website) srcs = [{ label: '各社公式サイト', url: c.website, retrievedAt: c.meta && c.meta.retrievedAt }];
    var fs = (c.meta && c.meta.fieldSources) || {};
    var FIELD_LABEL = { hq: '本社所在地', website: '公式サイト', employees: '従業員数', founded: '設立', capital: '資本金', industries: '業種', processes: '得意な工程', phone: '電話' };
    var fsRows = Object.keys(FIELD_LABEL).filter(function (k) { return fs[k]; }).map(function (k) {
      var p = fs[k];
      var kind = p.source === 'manual' ? '手動確認' : p.source === 'website' ? '公式サイト（会社概要）' : p.source === 'site-text' ? 'サイト本文の語彙から推定' : (SOURCE_LABEL[p.source] || p.label || p.source);
      return '<tr><th>' + esc(FIELD_LABEL[k]) + (p.items ? '<span class="muted">（' + esc(p.items.join('・')) + '）</span>' : '') + '</th><td>' + esc(kind) +
        (p.url ? ' <a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(shortUrl(p.url)).slice(0, 48) + ' ↗</a>' : '') +
        (p.retrievedAt ? '<span class="muted"> ' + esc(fmtDate(p.retrievedAt)) + '</span>' : '') +
        (p.evidence ? '<div class="evidence">根拠: 「' + esc(p.evidence) + '」</div>' : '') +
        (p.pages && p.pages.length ? '<div class="evidence">読んだページ: ' + p.pages.map(function (u) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(shortUrl(u)).slice(0, 40) + '</a>'; }).join('、') + '</div>' : '') +
        '</td></tr>';
    }).join('');
    html += '<section class="d-sec"><h3>情報の出所と更新</h3><div class="src">' +
      (fsRows ? '<p class="src-lead">この会社の値がどこから来たか（項目別）。名簿の住所がSI拠点だった場合は公式サイトの本社を採用し、名簿側は「支店・拠点」に移しています。</p><table class="fs">' + fsRows + '</table>' : '') +
      '<p class="src-lead">掲載元（会社の存在・分類の根拠）</p><ul class="plain">' + (srcs.length ? srcs.map(function (s) {
        return '<li>' + esc(s.label) + '<span class="src-line"><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(shortUrl(s.url)) + '</a> ・ 取得 ' + esc(fmtDate(s.retrievedAt)) + '</span></li>';
      }).join('') : '<li class="muted">掲載元の情報を確認中です</li>') + '</ul>' +
      (c.relevance && c.relevance.value ? '<p class="src-lead">ウェブ検索による該当性の確認: ' + esc({ sier: 'ロボットSI・自動化装置の事業を確認', maker: 'ロボット・機器メーカー', user: 'ロボットのユーザー企業', unknown: '判定できず' }[c.relevance.value] || c.relevance.value) + (c.relevance.reason ? '（' + esc(c.relevance.reason) + '）' : '') + '</p>' : '') +
      '<dl class="kv" style="margin-top:6px"><dt>統合日</dt><dd>' + esc(fmtDate(c.meta && c.meta.updatedAt)) + '</dd></dl>' +
      '<p>工程・業種・ロボット種別は各掲載元の分類をこのツールの分類へ機械的に写像したもので、掲載元にない項目は空欄です。' +
      '掲載内容の誤りや更新のご連絡は、LexxPluss の担当営業までお知らせください。' +
      '引用時は「ロボットSIerデータベース（' + esc(fmtDate(c.meta && c.meta.updatedAt)) + '取得）」と上記の出所URLを併記してください。</p></div></section>';

    $('#detailBody').innerHTML = html;
    $('#detailBody').scrollTop = 0;
    $('#detail').hidden = false;
    panel.classList.add('has-detail');
  }
  function select(id, fly) {
    var prev = state.selectedId;
    state.selectedId = id;
    [prev, id].forEach(function (x) { if (x && byId[x] && markers[x]) markers[x].setIcon(iconFor(byId[x])); });
    var c = byId[id];
    if (!c) return;
    if (state.filtersOpen) {
      state.filtersOpen = false;
      $('#filtersToggle').setAttribute('aria-expanded', 'false');
      filterGroupsEl.hidden = true;
      updateFilterUI();
    }
    renderDetail(c);
    dig(c);
    $$('#list .item').forEach(function (b) { b.classList.toggle('is-selected', b.dataset.id === id); });
    var it = $('#list .item[data-id="' + id + '"]');
    if (it && !isMobile()) it.scrollIntoView({ block: 'nearest' });
    if (fly) locate(id);
    if (isMobile()) setSheet('half');
  }
  function locate(id) {
    var m = markers[id];
    if (!m) return;
    if (cluster.hasLayer(m)) cluster.zoomToShowLayer(m, function () { m.openTooltip(); });
    else map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 9));
  }
  function closeDetail() {
    var prev = state.selectedId;
    state.selectedId = null;
    if (prev && byId[prev] && markers[prev]) markers[prev].setIcon(iconFor(byId[prev]));
    $('#detail').hidden = true;
    panel.classList.remove('has-detail');
    $$('#list .item.is-selected').forEach(function (b) { b.classList.remove('is-selected'); });
  }
  $('#detailClose').addEventListener('click', closeDetail);
  $('#detailBack').addEventListener('click', closeDetail);
  $('#detailLocate').addEventListener('click', function () { if (state.selectedId) locate(state.selectedId); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('#detail').hidden && document.activeElement !== $('#q')) closeDetail(); });

  // ---------------------------------------------------------------- テーマ（ライト / ダーク）
  // 切替・保存は LexxMoMa Tools 共通の ../assets/theme.js（lxTheme）に任せ、ここはボタン表示だけ合わせる
  var THEME_ICON = { light: '☀', dark: '☾' };
  var THEME_LABEL = { light: 'ライト', dark: 'ダーク' };
  function applyTheme() {
    var theme = window.lxTheme ? window.lxTheme.get() : 'light';
    var b = $('#themeBtn');
    b.textContent = THEME_ICON[theme];
    b.title = '表示テーマ: ' + THEME_LABEL[theme];
  }
  document.addEventListener('lx-theme', applyTheme);
  if (!window.lxTheme) $('#themeBtn').hidden = true;  // theme.js が無い環境（単体で開いた等）は切替を出さない

  // ---------------------------------------------------------------- パネル幅（ドラッグ／ボタン／ダブルクリックで既定）
  var app = $('#app');
  var PANEL_DEFAULT = 430, PANEL_WIDE = 720;
  function setPanelWidth(px, save) {
    var max = Math.max(360, Math.round(window.innerWidth * 0.75));
    px = Math.max(320, Math.min(max, Math.round(px)));
    app.style.setProperty('--panel-w', px + 'px');
    if (save !== false) { try { localStorage.setItem('sier-map-panel-w', String(px)); } catch (e) { /* 無視 */ } }
    setTimeout(function () { map.invalidateSize(); }, 50);
    return px;
  }
  function currentPanelWidth() { return panel.getBoundingClientRect().width || PANEL_DEFAULT; }
  try { var savedW = parseInt(localStorage.getItem('sier-map-panel-w'), 10); if (savedW) setPanelWidth(savedW, false); } catch (e) { /* 無視 */ }
  var resizer = $('#panelResizer');
  var rdrag = null;
  resizer.addEventListener('pointerdown', function (e) {
    rdrag = { x: e.clientX, w: currentPanelWidth() };
    resizer.setPointerCapture(e.pointerId);
    resizer.classList.add('is-active'); app.classList.add('is-resizing');
  });
  resizer.addEventListener('pointermove', function (e) {
    if (!rdrag) return;
    setPanelWidth(rdrag.w + (rdrag.x - e.clientX), false);
  });
  function endResize() {
    if (!rdrag) return;
    rdrag = null;
    resizer.classList.remove('is-active'); app.classList.remove('is-resizing');
    setPanelWidth(currentPanelWidth());
  }
  resizer.addEventListener('pointerup', endResize);
  resizer.addEventListener('pointercancel', endResize);
  resizer.addEventListener('dblclick', function () { setPanelWidth(PANEL_DEFAULT); });
  resizer.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') setPanelWidth(currentPanelWidth() + 40);
    if (e.key === 'ArrowRight') setPanelWidth(currentPanelWidth() - 40);
  });
  $('#widthBtn').addEventListener('click', function () {
    setPanelWidth(currentPanelWidth() < (PANEL_DEFAULT + PANEL_WIDE) / 2 ? PANEL_WIDE : PANEL_DEFAULT);
  });

  // ---------------------------------------------------------------- 携帯: 下から引き上げるシート
  var SHEET_PX = {
    peek: function () { return 150; },
    half: function () { return Math.round(window.innerHeight * 0.5); },
    full: function () { return Math.round(window.innerHeight * 0.92); }
  };
  var sheet = 'half';
  function setSheet(name) {
    sheet = name;
    app.style.setProperty('--sheet-h', SHEET_PX[name]() + 'px');
    panel.dataset.sheet = name;
    setTimeout(function () { map.invalidateSize(); }, 230);
  }
  var handle = $('#sheetHandle');
  var drag = null;
  handle.addEventListener('click', function () {
    if (drag && drag.moved) return;
    setSheet(sheet === 'peek' ? 'half' : sheet === 'half' ? 'full' : 'peek');
  });
  handle.addEventListener('pointerdown', function (e) {
    drag = { y: e.clientY, h: panel.getBoundingClientRect().height, moved: false };
    handle.setPointerCapture(e.pointerId);
    panel.classList.add('is-dragging');
  });
  handle.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var h = Math.max(100, Math.min(window.innerHeight * 0.95, drag.h + (drag.y - e.clientY)));
    if (Math.abs(drag.y - e.clientY) > 4) drag.moved = true;
    app.style.setProperty('--sheet-h', h + 'px');
  });
  function endDrag(e) {
    if (!drag) return;
    panel.classList.remove('is-dragging');
    var h = drag.h + (drag.y - e.clientY);
    var best = 'half', bestD = Infinity;
    Object.keys(SHEET_PX).forEach(function (k) { var d = Math.abs(SHEET_PX[k]() - h); if (d < bestD) { bestD = d; best = k; } });
    var moved = drag.moved;
    drag = null;
    if (moved) setSheet(best);
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  var wasMobile = isMobile();
  function applyLayoutMode() {
    var lg = $('#legend');
    if (isMobile()) {
      setSheet(sheet);
      if (!lg.classList.contains('is-collapsed')) $('#legendToggle').click();
    } else {
      app.style.removeProperty('--sheet-h');
      if (lg.classList.contains('is-collapsed')) $('#legendToggle').click();
    }
  }
  window.addEventListener('resize', function () {
    var m = isMobile();
    if (m !== wasMobile) { wasMobile = m; applyLayoutMode(); }
    else if (m) app.style.setProperty('--sheet-h', SHEET_PX[sheet]() + 'px');
    map.invalidateSize();
  });

  // ---------------------------------------------------------------- 発掘手帳（遊び要素）
  // 会社の詳細を開くと「発掘」。都道府県タイル地図が発掘率で色づき、件数で称号が上がる。腕前を競うゲームではなく、
  // 探すこと自体が絵を育てる仕掛け。記録はこのブラウザの localStorage だけ（保存できない環境では記録なしで動く）
  var DIG_KEY = 'sier-db-dig';
  var dug = {};
  try { (JSON.parse(localStorage.getItem(DIG_KEY) || '[]') || []).forEach(function (id) { if (byId[id]) dug[id] = 1; }); } catch (e) { dug = {}; }
  function saveDug() { try { localStorage.setItem(DIG_KEY, JSON.stringify(Object.keys(dug))); } catch (e) { /* 保存不可 */ } }
  var TITLES = [
    [0, 'これから掘る人'], [1, '見習い発掘者'], [5, '町工場さんぽ'], [15, 'ご当地SI通'], [40, 'SIerハンター'],
    [100, '発掘の名人'], [300, '眠れるSIの守り人'], [DATA.length, 'ニッポンのSIを全部見た人']
  ];
  function titleIdx(n) { var i = 0; TITLES.forEach(function (t, k) { if (n >= t[0]) i = k; }); return i; }
  // 都道府県タイル地図（列, 行）。形はおおよそ。沖縄は左下
  var TILE = {
    '北海道': [12, 0], '青森県': [12, 1], '秋田県': [11, 2], '岩手県': [12, 2], '新潟県': [10, 3], '山形県': [11, 3], '宮城県': [12, 3],
    '石川県': [7, 4], '富山県': [8, 4], '長野県': [9, 4], '群馬県': [10, 4], '栃木県': [11, 4], '福島県': [12, 4],
    '島根県': [3, 5], '鳥取県': [4, 5], '福井県': [7, 5], '岐阜県': [8, 5], '山梨県': [9, 5], '埼玉県': [10, 5], '茨城県': [11, 5],
    '山口県': [2, 6], '広島県': [3, 6], '岡山県': [4, 6], '兵庫県': [5, 6], '京都府': [6, 6], '滋賀県': [7, 6], '愛知県': [8, 6], '静岡県': [9, 6], '東京都': [10, 6], '千葉県': [11, 6],
    '佐賀県': [0, 7], '福岡県': [1, 7], '大阪府': [6, 7], '奈良県': [7, 7], '三重県': [8, 7], '神奈川県': [10, 7],
    '長崎県': [0, 8], '熊本県': [1, 8], '大分県': [2, 8], '愛媛県': [3, 8], '香川県': [4, 8], '和歌山県': [6, 8],
    '鹿児島県': [1, 9], '宮崎県': [2, 9], '高知県': [3, 9], '徳島県': [4, 9], '沖縄県': [0, 10]
  };
  var prefTotal = {};
  DATA.forEach(function (c) { var p = c.hq && c.hq.prefecture; if (p) prefTotal[p] = (prefTotal[p] || 0) + 1; });
  var gemTotal = DATA.filter(isGem).length;
  function digStats() {
    var n = 0, gems = 0, byPref = {};
    Object.keys(dug).forEach(function (id) {
      var c = byId[id]; if (!c) return;
      n++; if (isGem(c)) gems++;
      var p = c.hq && c.hq.prefecture; if (p) byPref[p] = (byPref[p] || 0) + 1;
    });
    return { n: n, gems: gems, byPref: byPref, prefs: Object.keys(byPref).length };
  }
  var digBtn = $('#digBtn'), digBook = $('#digBook');
  var newPref = null;  // 直近で初発掘になった県（手帳を開いたときに一度だけ光らせる）
  function renderDigBtn() { $('#digNum').textContent = digStats().n.toLocaleString('ja-JP'); }
  function renderDigBook() {
    var s = digStats(), i = titleIdx(s.n), next = TITLES[i + 1];
    $('#digTitle').textContent = TITLES[i][1];
    $('#digNext').textContent = next ? 'あと' + (next[0] - s.n) + '社で「' + next[1] + '」' : '全社発掘、おつかれさまでした';
    $('#digBar').style.width = (next ? Math.round(100 * (s.n - TITLES[i][0]) / Math.max(1, next[0] - TITLES[i][0])) : 100) + '%';
    $('#digStatAll').textContent = s.n.toLocaleString('ja-JP') + ' / ' + DATA.length.toLocaleString('ja-JP') + '社';
    $('#digStatPref').textContent = s.prefs + ' / 47';
    $('#digStatGem').textContent = s.gems + ' / ' + gemTotal + '社';
    $('#digMap').innerHTML = Object.keys(TILE).map(function (p) {
      var tot = prefTotal[p] || 0, got = s.byPref[p] || 0, r = tot ? got / tot : 0;
      var lvl = got === 0 ? 0 : r >= 1 ? 4 : r >= 0.5 ? 3 : r >= 0.15 ? 2 : 1;
      var short = p === '北海道' ? '北海' : p.replace(/[都府県]$/, '').slice(0, 2);
      return '<button type="button" class="tile lv' + lvl + (p === newPref ? ' new' : '') + '" style="grid-column:' + (TILE[p][0] + 1) + ';grid-row:' + (TILE[p][1] + 1) + '" data-pref="' + p + '"' +
        ' title="' + p + ' ' + got + '/' + tot + '社 発掘（押すとこの県で絞り込み）"' + (tot ? '' : ' disabled') + '>' + short + '</button>';
    }).join('');
    newPref = null;
    var gemOn = state.f.gem && state.f.gem.has(GEM_LABEL);
    $('#digGem').setAttribute('aria-pressed', gemOn ? 'true' : 'false');
    $('#digGem').textContent = gemOn ? '💎 眠るSIだけ表示中（解除）' : '💎 眠るSIだけ表示';
  }
  function openDigBook(open) {
    digBook.hidden = !open;
    digBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) renderDigBook();
  }
  digBtn.addEventListener('click', function () { openDigBook(digBook.hidden); });
  $('#digClose').addEventListener('click', function () { openDigBook(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !digBook.hidden) { openDigBook(false); digBtn.focus(); } });
  $('#digMap').addEventListener('click', function (e) {
    var t = e.target.closest('.tile'); if (!t || t.disabled) return;
    state.f.prefecture.clear(); state.f.prefecture.add(t.dataset.pref);
    update(); fitAll(); openDigBook(false);
  });
  $('#digGem').addEventListener('click', function () {
    if (!state.f.gem) return;
    if (state.f.gem.has(GEM_LABEL)) state.f.gem.delete(GEM_LABEL); else { state.f.gem.clear(); state.f.gem.add(GEM_LABEL); }
    update(); renderDigBook();
  });
  $('#digRandom').addEventListener('click', function () {
    var pool = current.filter(function (c) { return !dug[c.id] && hasPos(c); });
    if (!pool.length) { toast(['この条件の会社はすべて発掘済みです。条件を変えて別の土地へどうぞ']); return; }
    var gems = pool.filter(isGem);
    var pickFrom = gems.length && Math.random() < 0.6 ? gems : pool;  // 眠るSIが出やすい
    openDigBook(false);
    select(pickFrom[Math.floor(Math.random() * pickFrom.length)].id, true);
  });
  $('#digReset').addEventListener('click', function () {
    if (!window.confirm('このブラウザの発掘記録を消しますか？')) return;
    dug = {}; saveDug(); renderDigBtn(); renderDigBook(); renderList();
  });
  var toastTimer = null;
  function toast(lines) {
    var el = $('#toast');
    el.innerHTML = lines.map(function (l, i) { return '<div' + (i ? ' class="sub"' : '') + '>' + esc(l) + '</div>'; }).join('');
    el.hidden = false;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); setTimeout(function () { el.hidden = true; }, 250); }, lines.length > 1 ? 4200 : 2600);
  }
  function dig(c) {
    if (!c || dug[c.id]) return;
    var before = digStats(), p = c.hq && c.hq.prefecture;
    dug[c.id] = 1; saveDug();
    var after = digStats(), lines = [];
    lines.push(isGem(c) ? '💎 眠るSIを発掘！ ' + c.shortName + '（' + after.n + '社目）' : '⛏ 発掘！ ' + c.shortName + '（' + after.n + '社目）');
    if (isGem(c)) lines.push('協会名簿やメーカーのリストに載っていない、地元の会社です');
    if (p && !before.byPref[p]) newPref = p;
    if (p && !before.byPref[p]) lines.push('🗾 ' + p + ' 初発掘（' + after.prefs + ' / 47 県）');
    var ti = titleIdx(after.n);
    if (ti > titleIdx(before.n)) lines.push('🏅 称号アップ「' + TITLES[ti][1] + '」');
    toast(lines);
    renderDigBtn();
    digBtn.classList.remove('bump'); void digBtn.offsetWidth; digBtn.classList.add('bump');
    var it = $('#list .item[data-id="' + c.id + '"] .item-name');
    if (it && !it.querySelector('.dug')) it.insertAdjacentHTML('beforeend', '<span class="dug" title="発掘済み">⛏</span>');
    if (!digBook.hidden) renderDigBook();
  }
  renderDigBtn();

  // ---------------------------------------------------------------- 更新の入口
  function update() {
    parsed = parseQuery(state.q);
    compute();
    updateFilterUI();
    renderInterp();
    renderList();
    refreshMap();
    renderLegend();
  }

  // ---------------------------------------------------------------- 起動
  buildFilters();
  buildSizeScale();
  applyTheme();
  update();
  applyLayoutMode();
  fitAll();
})();
