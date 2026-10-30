/* エンドエフェクタ事例データベース — 検索ロジック(DOM 非依存)
 * ブラウザでは window.EoatSearch、node では module.exports として同じ関数を使う(test/ui.test.cjs)。
 *  parseQuery(q, taxonomy)      自由入力 → チップ [{kind, key, label}] と残りの語 words
 *  applyFilters(cases, f)       絞り込み(チップは種類ごとに OR、種類をまたいで AND)
 *  rank(cases, f, words)        関連度順(可搬 20 kg 近辺を少し優先)
 *  trend(cases, taxonomy)       掴み方の傾向(大分類ごとの割合と代表事例)
 *  facetCounts(cases, f, key)   ある軸の件数(その軸以外の条件を掛けた上で)
 *  encodeHash(f) / decodeHash(s) 条件 ↔ URL の #
 *  sliceRecord(buf, off, len)   画像パックから [iv][ct] を切り出す
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EoatSearch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function nfkc(s) { try { return String(s == null ? '' : s).normalize('NFKC'); } catch (e) { return String(s || ''); } }
  function norm(s) { return nfkc(s).toLowerCase().replace(/\s+/g, ' ').trim(); }
  function isAscii(t) { return /^[\x00-\x7f]*$/.test(t); }
  function esc(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function termRe(t) {
    var e = esc(norm(t));
    // 英語は単語境界つき。複数形(box → boxes, part → parts)も同じ語として拾う
    return isAscii(t) ? new RegExp('(?<![a-z0-9])' + e + '(?:e?s)?(?![a-z0-9])', 'g') : new RegExp(e, 'g');
  }

  // 同義語辞書を [{kind, key, re, len, term}] に展開(長い語を先に試す)
  var _synCache = null;
  function synonyms(tax) {
    if (_synCache && _synCache.src === tax) return _synCache.list;
    var list = [];
    (tax.synonyms || []).forEach(function (s) {
      var p = s.canonical.split(':'); var kind = p[0], key = p[1];
      (s.terms || []).forEach(function (t) { list.push({ kind: kind, key: key, term: t, re: termRe(t), len: norm(t).length }); });
    });
    // 分類のラベル自体も語として使う
    function add(kind, items) { items.forEach(function (it) { list.push({ kind: kind, key: it.key, term: it.label, re: termRe(it.label), len: it.label.length }); }); }
    (tax.categories || []).forEach(function (g) { add('category', g.items); });
    (tax.principles || []).forEach(function (g) { add('principle', g.items); });
    add('material', tax.materials || []); add('task', tax.tasks || []);
    list.sort(function (a, b) { return b.len - a.len; });
    _synCache = { src: tax, list: list };
    return list;
  }

  // 重量: 「10kg」「20 キロ」「5-20kg」→ 可搬重量帯
  function payloadClassOf(kg) { return kg <= 5 ? '≤5kg' : kg <= 20 ? '5–20kg' : kg <= 100 ? '20–100kg' : '>100kg'; }
  var W_RE = /(\d{1,4}(?:[.,]\d{1,2})?)\s*(kg|キロ|kgs|lb|lbs|g|グラム)(?![a-z])/gi;

  function labelOf(tax, kind, key) {
    var i, j;
    if (kind === 'category') { for (i = 0; i < tax.categories.length; i++) for (j = 0; j < tax.categories[i].items.length; j++) if (tax.categories[i].items[j].key === key) return tax.categories[i].items[j].label; }
    if (kind === 'principle') { for (i = 0; i < tax.principles.length; i++) for (j = 0; j < tax.principles[i].items.length; j++) if (tax.principles[i].items[j].key === key) return tax.principles[i].items[j].label; }
    if (kind === 'material') { for (i = 0; i < tax.materials.length; i++) if (tax.materials[i].key === key) return tax.materials[i].label; }
    if (kind === 'task') { for (i = 0; i < tax.tasks.length; i++) if (tax.tasks[i].key === key) return tax.tasks[i].label; }
    if (kind === 'robot') return key === 'mobile' ? '移動マニピュレータ' : key;
    if (kind === 'payload') return key;
    if (kind === 'property') return ({ oily: '油付き', wet: '濡れ', fragile: '壊れやすい', soft: '柔らかい', transparent: '透明', hot: '高温', variety: '多品種', porous: '通気性', heavy: '重い', thin: '薄い', frozen: '冷凍' })[key] || key;
    return key;
  }

  /** 自由入力を分解する。戻り値 { chips: [{kind,key,label,term}], words: [残りの語] } */
  function parseQuery(q, tax) {
    var text = norm(q || '');
    var chips = [], seen = {};
    if (!text) return { chips: chips, words: [] };
    // 重量
    var m, rest = text;
    while ((m = W_RE.exec(text))) {
      var v = parseFloat(m[1].replace(',', '.')); var u = m[2].toLowerCase();
      var kg = /lb/.test(u) ? v * 0.4536 : (u === 'g' || u === 'グラム') ? v / 1000 : v;
      var pc = payloadClassOf(kg);
      if (!seen['payload:' + pc]) { seen['payload:' + pc] = 1; chips.push({ kind: 'payload', key: pc, label: pc, term: m[0] }); }
      rest = rest.replace(m[0], ' ');
    }
    W_RE.lastIndex = 0;
    synonyms(tax).forEach(function (s) {
      s.re.lastIndex = 0;
      if (!s.re.test(rest)) return;
      var id = s.kind + ':' + s.key;
      if (!seen[id]) { seen[id] = 1; chips.push({ kind: s.kind, key: s.key, label: labelOf(tax, s.kind, s.key), term: s.term }); }
      rest = rest.replace(s.re, ' ');
    });
    var words = rest.split(/[\s、,，。・/]+/).filter(function (w) { return w.length >= 2; });
    return { chips: chips, words: words };
  }

  // ---------------------------------------------------------------- 絞り込み
  var EMPTY = { q: '', rc: '', mob: false, sort: 'rel', cat: [], mat: [], pl: [], pr: [], task: [], ct: [], rg: [], ind: [], prop: [], c: '' };
  function emptyFilter() { return JSON.parse(JSON.stringify(EMPTY)); }

  function has(list, v) { return list.indexOf(v) >= 0; }
  function anyIn(list, vals) { for (var i = 0; i < vals.length; i++) if (has(list, vals[i])) return true; return false; }

  function matchCase(c, f, skip) {
    if (f.rc && skip !== 'rc' && (c.robot.class || '') !== f.rc) return false;
    if (f.mob && skip !== 'mob' && !c.robot.is_mobile_manipulator) return false;
    if (f.cat.length && skip !== 'cat' && !anyIn(f.cat, c.workpiece.categories)) return false;
    if (f.mat.length && skip !== 'mat' && !anyIn(f.mat, c.workpiece.materials)) return false;
    if (f.pl.length && skip !== 'pl' && !has(f.pl, c.payload_class)) return false;
    if (f.pr.length && skip !== 'pr' && !anyIn(f.pr, c.end_effector.principles) && !anyIn(f.pr, c._prGroups)) return false;
    if (f.task.length && skip !== 'task' && !anyIn(f.task, c.tasks)) return false;
    if (f.ct.length && skip !== 'ct' && !has(f.ct, c.case_type)) return false;
    if (f.rg.length && skip !== 'rg' && !has(f.rg, c.region || 'その他')) return false;
    if (f.ind.length && skip !== 'ind' && !anyIn(f.ind, c.industry || [])) return false;
    if (f.prop.length && skip !== 'prop' && !anyIn(f.prop, c.workpiece.properties || [])) return false;
    return true;
  }

  /** 事例に検索用の下ごしらえを付ける(掴み方の大分類・検索文字列) */
  function prepare(cases, tax) {
    var prGroup = {};
    (tax.principles || []).forEach(function (g) { g.items.forEach(function (it) { prGroup[it.key] = g.key; }); });
    cases.forEach(function (c) {
      c._prGroups = (c.end_effector.principles || []).map(function (k) { return prGroup[k]; });
      c._text = norm([c.title_ja, c.title_orig, c.summary_ja, c.end_effector.maker, c.end_effector.model, c.robot.maker, c.robot.model,
        (c.industry || []).join(' '), c.integrator && c.integrator.name, c.end_user, c.country].filter(Boolean).join(' '));
    });
    return cases;
  }

  function applyFilters(cases, f) { return cases.filter(function (c) { return matchCase(c, f); }); }

  /** 関連度: チップ・語の一致の強さ + LexxMoMa に近い事例(20 kg 以下・協働・移動)を少し優先 */
  function score(c, f, words) {
    var s = 0;
    if (f.cat.length) { if (has(f.cat, c.workpiece.categories[0])) s += 14; else if (anyIn(f.cat, c.workpiece.categories)) s += 8; }
    if (f.pr.length) { if (has(f.pr, c.end_effector.principles[0]) || has(f.pr, c._prGroups[0])) s += 10; else s += 5; }
    if (f.task.length) { if (has(f.task, c.tasks[0])) s += 8; else if (anyIn(f.task, c.tasks)) s += 4; }
    if (f.mat.length) s += 4;
    if (f.pl.length) s += 3;
    if (f.prop.length) s += 3;
    (words || []).forEach(function (w) { if (c._text.indexOf(w) >= 0) s += 3; });
    if (c.payload_class === '5–20kg') s += 2; else if (c.payload_class === '≤5kg') s += 1.5; else if (c.payload_class === '20–100kg') s += 0.5;
    if (c.robot.class === '協働') s += 1;
    if (c.robot.is_mobile_manipulator) s += 1.5;
    s += Math.min(c.images.length, 3) * 0.3;
    s += (c.quality && c.quality.confidence ? (c.quality.confidence.category + c.quality.confidence.principle) : 0);
    return s;
  }

  function rank(cases, f, words) {
    var sort = f.sort || 'rel';
    var list = cases.map(function (c) { return { c: c, s: score(c, f, words) }; });
    if (sort === 'near20') {
      var mid = { '≤5kg': 2, '5–20kg': 0, '20–100kg': 1, '>100kg': 3, '不明': 4 };
      list.sort(function (a, b) { return (mid[a.c.payload_class] - mid[b.c.payload_class]) || (b.s - a.s); });
    } else if (sort === 'new') {
      list.sort(function (a, b) { return ((b.c.year || 0) - (a.c.year || 0)) || (b.s - a.s); });
    } else {
      list.sort(function (a, b) { return (b.s - a.s) || (a.c.id < b.c.id ? -1 : 1); });
    }
    return list.map(function (x) { return x.c; });
  }

  /** 語での絞り込み(チップ以外の語は検索文字列に含むものだけ)。語が無ければそのまま */
  function applyWords(cases, words) {
    if (!words || !words.length) return cases;
    return cases.filter(function (c) { return words.every(function (w) { return c._text.indexOf(w) >= 0; }); });
  }

  /** 一回の検索: 絞り込み → 語 → 0 件なら語を外し、さらに 0 件ならチップを「点数」扱いにして全件を並べる */
  function search(all, f, words) {
    var relaxed = null;
    var list = applyWords(applyFilters(all, f), words);
    if (!list.length && words && words.length) { list = applyFilters(all, f); relaxed = 'words'; }
    if (!list.length) { list = all.slice(); relaxed = 'filters'; }
    return { list: rank(list, f, words), relaxed: relaxed };
  }

  /** 掴み方の傾向: 大分類ごとの件数・割合・代表事例(上位 1 件)と小分類の内訳 */
  function trend(list, tax) {
    var groups = {}, total = list.length;
    (tax.principles || []).forEach(function (g) { groups[g.key] = { key: g.key, label: g.label, pictogram: g.pictogram, n: 0, photo: 0, est: 0, rep: null, items: {} }; });
    list.forEach(function (c) {
      var k = c.end_effector.principles[0], g = c._prGroups[0];
      if (!groups[g]) return;
      groups[g].n++;
      if (c.end_effector.by_photo) groups[g].photo++;   // 本文に記載が無く、写真のハンドの形から判定した事例
      if (c.end_effector.estimated) groups[g].est++;     // 本文にも写真にも手がかりが無く、用途・ワークなどから推定した事例
      if (!groups[g].rep) groups[g].rep = c;
      groups[g].items[k] = (groups[g].items[k] || 0) + 1;
    });
    var out = Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (g) { return g.n > 0; });
    // 作業ツール(把持以外)は「掴み方」ではないので、件数に関わらず最後に置く
    var last = function (g) { return g.key === 'process' ? 2 : g.key === 'unknown' ? 1 : 0; };
    out.sort(function (a, b) { return (last(a) - last(b)) || (b.n - a.n); });
    out.forEach(function (g) { g.pct = total ? Math.round(g.n / total * 100) : 0; g.sub = Object.keys(g.items).map(function (k) { return { key: k, label: labelOf(tax, 'principle', k), n: g.items[k] }; }).sort(function (a, b) { return b.n - a.n; }); });
    return { total: total, groups: out };
  }

  function facetCounts(all, f, axis, valueOf) {
    var cnt = {};
    all.forEach(function (c) {
      if (!matchCase(c, f, axis)) return;
      var vs = valueOf(c); if (!Array.isArray(vs)) vs = [vs];
      vs.forEach(function (v) { if (v != null) cnt[v] = (cnt[v] || 0) + 1; });
    });
    return cnt;
  }

  // ---------------------------------------------------------------- URL の #
  var LIST_KEYS = ['cat', 'mat', 'pl', 'pr', 'task', 'ct', 'rg', 'ind', 'prop'];
  function encodeHash(f) {
    var p = [];
    if (f.q) p.push('q=' + encodeURIComponent(f.q));
    if (f.rc) p.push('rc=' + encodeURIComponent(f.rc));
    if (f.mob) p.push('mob=1');
    if (f.sort && f.sort !== 'rel') p.push('sort=' + f.sort);
    LIST_KEYS.forEach(function (k) { if (f[k] && f[k].length) p.push(k + '=' + f[k].map(encodeURIComponent).join(',')); });
    if (f.c) p.push('c=' + encodeURIComponent(f.c));
    return p.length ? '#' + p.join('&') : '';
  }
  function decodeHash(s) {
    var f = emptyFilter();
    (s || '').replace(/^#/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('='); var k = i < 0 ? kv : kv.slice(0, i); var v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1));
      if (k === 'q' || k === 'rc' || k === 'sort' || k === 'c') f[k] = v;
      else if (k === 'mob') f.mob = v === '1';
      else if (LIST_KEYS.indexOf(k) >= 0) f[k] = v.split(',').filter(Boolean);
    });
    return f;
  }

  /** パックから 1 枚分 [iv 12B][ct] を切り出す */
  function sliceRecord(buf, off, len) {
    var u8 = new Uint8Array(buf, off, len);
    return { iv: u8.slice(0, 12), ct: u8.slice(12) };
  }

  return { parseQuery: parseQuery, prepare: prepare, applyFilters: applyFilters, applyWords: applyWords, search: search, rank: rank, trend: trend,
    facetCounts: facetCounts, encodeHash: encodeHash, decodeHash: decodeHash, emptyFilter: emptyFilter, sliceRecord: sliceRecord, labelOf: labelOf, norm: norm, payloadClassOf: payloadClassOf };
});
