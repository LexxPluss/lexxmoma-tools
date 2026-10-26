// 検索の評価(7-2): node eoat/tests/eval_queries.cjs <queries.json> <cases.json>  → precision@12 / zero_result_rate / trend_accuracy
// queries.yaml は eval_queries.py が JSON に変換して渡す。UI と同じ search.js を使う。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const S = require(path.join(__dirname, '..', '..', 'site', 'members', 'eoat-db', 'search.js'));
const Q = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const D = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const TAX = D.taxonomy;
const ALL = S.prepare(D.cases, TAX);
const PRG = {}; TAX.principles.forEach(g => g.items.forEach(it => { PRG[it.key] = g.key; }));

function matches(c, ex) {
  const any = (a, b) => (b || []).some(v => (a || []).includes(v));
  if (ex.category && !any(c.workpiece.categories, ex.category)) return false;
  if (ex.principle && !any(c.end_effector.principles, ex.principle)) return false;
  if (ex.principle_group && !any(c._prGroups, ex.principle_group)) return false;
  if (ex.task && !any(c.tasks, ex.task)) return false;
  if (ex.material && !any(c.workpiece.materials, ex.material)) return false;
  if (ex.robot && !ex.robot.includes(c.robot.class)) return false;
  if (ex.mobile && !c.robot.is_mobile_manipulator) return false;
  return true;
}
const rows = [];
let pSum = 0, zero = 0, tOk = 0, tN = 0;
Q.queries.forEach(q => {
  const parsed = S.parseQuery(q.q, TAX);
  const f = S.emptyFilter();
  parsed.chips.forEach(ch => {
    const k = { category: 'cat', material: 'mat', principle: 'pr', task: 'task', payload: 'pl', property: 'prop' }[ch.kind];
    if (k) f[k].push(ch.key); else if (ch.kind === 'robot') { if (ch.key === 'mobile') f.mob = true; else f.rc = ch.key; }
  });
  const r = S.search(ALL, f, parsed.words);
  const strict = S.applyWords(S.applyFilters(ALL, f), parsed.words);
  const top = r.list.slice(0, 12);
  const hit = top.filter(c => matches(c, q.expect)).length;
  const p = top.length ? hit / top.length : 0;
  pSum += p;
  if (!strict.length) zero++;
  let trendTop = null;
  if (q.trend) {
    tN++;
    const base = S.applyWords(S.applyFilters(ALL, Object.assign({}, f, { pr: [] })), parsed.words);
    const t = S.trend(base.length ? base : r.list, TAX);
    trendTop = t.groups[0] ? t.groups[0].key : null;
    if (trendTop === q.trend) tOk++;
  }
  rows.push({ q: q.q, chips: parsed.chips.map(c => c.kind + ':' + c.key), words: parsed.words, strict: strict.length, shown: top.length, hit, p: +p.toFixed(2), relaxed: r.relaxed, trend: q.trend || null, trendTop });
});
const out = { n: Q.queries.length, precision_at_12: +(pSum / Q.queries.length).toFixed(3), zero_result_rate: +(zero / Q.queries.length).toFixed(3), zero_strict: zero, trend_accuracy: tN ? +(tOk / tN).toFixed(3) : null, trend_n: tN, rows };
console.log(JSON.stringify(out, null, 1));
