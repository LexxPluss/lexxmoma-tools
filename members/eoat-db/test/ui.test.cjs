// エンドエフェクタ事例DB の検索ロジック(search.js)のテスト: node --test site/members/eoat-db/test/ui.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const S = require(path.join(__dirname, '..', 'search.js'));

const TAX = {
  categories: [
    { key: 'box', label: '箱・ケース', items: [{ key: 'carton', label: '段ボール' }, { key: 'tote', label: 'TPポリ箱・通い箱' }] },
    { key: 'metal', label: '金属部品', items: [{ key: 'round', label: '丸物・シャフト' }, { key: 'sheet', label: '板金・薄板' }] },
    { key: 'food', label: '食品', items: [{ key: 'egg', label: '卵' }] },
  ],
  principles: [
    { key: 'mech', label: '機械式(把持)', pictogram: 'parallel', items: [{ key: 'parallel2', label: '2指平行' }, { key: 'clamp_fork', label: 'クランプ・フォーク' }] },
    { key: 'vacuum', label: '真空吸着', pictogram: 'vacuum', items: [{ key: 'single_pad', label: '単パッド' }, { key: 'area', label: 'フォーム・エリア吸着' }] },
    { key: 'soft', label: 'ソフトハンド', pictogram: 'soft', items: [{ key: 'soft_finger', label: '空気圧ソフトフィンガ' }] },
  ],
  materials: [{ key: 'steel', label: '鉄・鋼' }, { key: 'paper', label: '紙・段ボール' }, { key: 'food', label: '食品' }],
  tasks: [{ key: 'machine_tending', label: 'マシンテンディング' }, { key: 'depalletizing', label: 'デパレタイズ' }, { key: 'transport', label: '工程間搬送' }],
  payload_classes: ['≤5kg', '5–20kg', '20–100kg', '>100kg', '不明'],
  regions: ['日本', '北米', '欧州', '中国', 'その他アジア', 'その他'],
  case_types: { maker_product: 'メーカー', sier_case: 'SIer', user_custom: 'カスタム', research: '研究' },
  synonyms: [
    { canonical: 'category:carton', terms: ['段ボール', 'ダンボール', 'carton', 'cardboard box'] },
    { canonical: 'category:tote', terms: ['通い箱', 'TPポリ箱', 'tote'] },
    { canonical: 'category:round', terms: ['丸棒', 'シャフト', 'shaft'] },
    { canonical: 'material:steel', terms: ['鉄', '鉄の', 'steel'] },
    { canonical: 'task:machine_tending', terms: ['旋盤', '旋盤に入れる', 'machine tending', 'lathe'] },
    { canonical: 'task:depalletizing', terms: ['デパレ', 'デパレタイズ', 'depalletizing'] },
    { canonical: 'task:transport', terms: ['棚から取る', '棚'] },
    { canonical: 'robot:協働', terms: ['協働', 'cobot'] },
    { canonical: 'robot:mobile', terms: ['移動マニピュレータ', 'AMR'] },
    { canonical: 'property:oily', terms: ['油の付いた', '油付き', 'oily'] },
  ],
};

function mk(id, o) {
  return Object.assign({
    id, title_ja: id, title_orig: id, summary_ja: '', case_type: 'sier_case', region: '日本', industry: [], year: 2024,
    workpiece: { categories: ['carton'], materials: ['paper'], properties: [] }, tasks: ['depalletizing'],
    end_effector: { principles: ['single_pad'], maker: null, model: null }, robot: { class: '協働', is_mobile_manipulator: false, maker: 'Universal Robots', model: 'UR10e' },
    payload_class: '5–20kg', images: [{ id: 'i' + id, thumb: { pack: 'p-0001.bin', off: 0, len: 10 } }], sources: [{ url: 'https://example.com/' + id, publisher: 'ex' }],
    quality: { confidence: { category: 0.9, principle: 0.9 } }, integrator: {},
  }, o);
}
const CASES = S.prepare([
  mk('c1'),
  mk('c2', { workpiece: { categories: ['tote'], materials: ['plastic'], properties: [] }, tasks: ['transport'], robot: { class: '協働', is_mobile_manipulator: true } }),
  mk('c3', { workpiece: { categories: ['round'], materials: ['steel'], properties: ['oily'] }, tasks: ['machine_tending'], end_effector: { principles: ['parallel2'] }, robot: { class: '産業用', is_mobile_manipulator: false }, payload_class: '≤5kg', region: '欧州' }),
  mk('c4', { workpiece: { categories: ['carton'], materials: ['paper'], properties: [] }, tasks: ['depalletizing'], end_effector: { principles: ['clamp_fork'] }, robot: { class: '産業用', is_mobile_manipulator: false }, payload_class: '20–100kg', region: '北米', year: 2020 }),
  mk('c5', { workpiece: { categories: ['egg'], materials: ['food'], properties: ['fragile'] }, tasks: [], end_effector: { principles: ['area'] }, robot: { class: null, is_mobile_manipulator: false }, payload_class: '不明' }),
], TAX);

test('自由入力の分解: 日本語の文を ワーク・材料・作業・性質 のチップにする', () => {
  const p = S.parseQuery('油の付いた鉄の丸棒を旋盤に入れたい', TAX);
  const ids = p.chips.map(c => c.kind + ':' + c.key);
  assert.ok(ids.includes('category:round'));
  assert.ok(ids.includes('material:steel'));
  assert.ok(ids.includes('task:machine_tending'));
  assert.ok(ids.includes('property:oily'));
});

test('自由入力の分解: 重さは可搬重量帯に、英語の語も拾う', () => {
  const p = S.parseQuery('10kg の段ボールをデパレ', TAX);
  const ids = p.chips.map(c => c.kind + ':' + c.key);
  assert.ok(ids.includes('payload:5–20kg'));
  assert.ok(ids.includes('category:carton'));
  assert.ok(ids.includes('task:depalletizing'));
  const e = S.parseQuery('depalletizing cardboard boxes with a cobot', TAX);
  const eids = e.chips.map(c => c.kind + ':' + c.key);
  assert.ok(eids.includes('category:carton'));
  assert.ok(eids.includes('robot:協働'));
  assert.equal(S.payloadClassOf(20), '5–20kg');
  assert.equal(S.payloadClassOf(20.5), '20–100kg');
});

test('自由入力の分解: 辞書に無い語は「語」として残る', () => {
  const p = S.parseQuery('TPポリ箱を棚から取る フジ', TAX);
  assert.ok(p.chips.some(c => c.key === 'tote'));
  assert.ok(p.chips.some(c => c.key === 'transport'));
  assert.deepEqual(p.words, ['フジ']);
});

test('絞り込み: 種類をまたいで AND、同じ種類は OR。掴み方は大分類でも絞れる', () => {
  const f = S.emptyFilter(); f.cat = ['carton'];
  assert.deepEqual(S.applyFilters(CASES, f).map(c => c.id), ['c1', 'c4']);
  f.rc = '産業用';
  assert.deepEqual(S.applyFilters(CASES, f).map(c => c.id), ['c4']);
  const g = S.emptyFilter(); g.pr = ['mech'];
  assert.deepEqual(S.applyFilters(CASES, g).map(c => c.id).sort(), ['c3', 'c4']);
  const m = S.emptyFilter(); m.mob = true;
  assert.deepEqual(S.applyFilters(CASES, m).map(c => c.id), ['c2']);
  const pl = S.emptyFilter(); pl.pl = ['≤5kg', '5–20kg'];
  assert.deepEqual(S.applyFilters(CASES, pl).map(c => c.id).sort(), ['c1', 'c2', 'c3']);
});

test('検索: 0 件のときは条件を緩めて近い順に出す(zero_result_rate = 0)', () => {
  const f = S.emptyFilter(); f.cat = ['tote']; f.rc = '産業用';
  const r = S.search(CASES, f, []);
  assert.equal(r.relaxed, 'filters');
  assert.equal(r.list.length, CASES.length);
  assert.equal(r.list[0].id, 'c2');   // tote の一致が最も高い
  const w = S.emptyFilter(); w.cat = ['carton'];
  const r2 = S.search(CASES, w, ['存在しない語']);
  assert.equal(r2.relaxed, 'words');
  assert.deepEqual(r2.list.map(c => c.id).sort(), ['c1', 'c4']);
});

test('並び替え: 関連度では一致の強い順、可搬 20 kg に近い順、新しい順', () => {
  const f = S.emptyFilter(); f.cat = ['carton'];
  const rel = S.rank(S.applyFilters(CASES, f), f, []);
  assert.equal(rel[0].id, 'c1');   // 5–20kg・協働 が優先
  f.sort = 'near20';
  const near = S.rank(CASES.slice(), f, []);
  assert.equal(near[0].payload_class, '5–20kg');
  assert.equal(near[near.length - 1].payload_class, '不明');
  f.sort = 'new';
  const nw = S.rank(S.applyFilters(CASES, f), f, []);
  assert.equal(nw[nw.length - 1].id, 'c4');
});

test('掴み方の傾向: 大分類ごとの割合と代表事例', () => {
  const t = S.trend(CASES, TAX);
  assert.equal(t.total, 5);
  assert.equal(t.groups[0].key, 'vacuum');
  assert.equal(t.groups[0].n, 3);
  assert.equal(t.groups[0].pct, 60);
  assert.equal(t.groups[0].rep.id, 'c1');
  const mech = t.groups.find(g => g.key === 'mech');
  assert.deepEqual(mech.sub.map(s => s.key).sort(), ['clamp_fork', 'parallel2']);
});

test('絞り込みの件数: その軸以外の条件を掛けた上で数える', () => {
  const f = S.emptyFilter(); f.rc = '産業用'; f.cat = ['round'];
  const cnt = S.facetCounts(CASES, f, 'cat', c => c.workpiece.categories);
  assert.deepEqual(cnt, { round: 1, carton: 1 });   // cat は外し、産業用だけ掛ける
});

test('URL の #: 条件を往復できる', () => {
  const f = S.emptyFilter();
  f.q = '段ボール 10kg'; f.rc = '協働'; f.mob = true; f.sort = 'near20'; f.cat = ['carton', 'tote']; f.pl = ['5–20kg']; f.c = 'c1';
  const h = S.encodeHash(f);
  assert.ok(h.startsWith('#'));
  const g = S.decodeHash(h);
  assert.equal(g.q, f.q); assert.equal(g.rc, '協働'); assert.equal(g.mob, true); assert.equal(g.sort, 'near20');
  assert.deepEqual(g.cat, ['carton', 'tote']); assert.deepEqual(g.pl, ['5–20kg']); assert.equal(g.c, 'c1');
  assert.equal(S.encodeHash(S.emptyFilter()), '');
});

test('画像パック: [iv 12B][ct] を位置と長さで切り出せる', () => {
  const buf = new Uint8Array(64); for (let i = 0; i < 64; i++) buf[i] = i;
  const r = S.sliceRecord(buf.buffer, 20, 30);
  assert.equal(r.iv.length, 12); assert.equal(r.iv[0], 20); assert.equal(r.iv[11], 31);
  assert.equal(r.ct.length, 18); assert.equal(r.ct[0], 32); assert.equal(r.ct[17], 49);
});

test('暗号化 → 復号の往復(build.py と同じ AES-GCM。node の WebCrypto で確かめる)', async () => {
  const { webcrypto } = require('node:crypto');
  const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode('RIFF....WEBP');
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const rec = new Uint8Array(12 + ct.length); rec.set(iv, 0); rec.set(ct, 12);
  const pack = new Uint8Array(7 + rec.length); pack.set(rec, 7);   // 位置 7 から
  const s = S.sliceRecord(pack.buffer, 7, rec.length);
  const back = new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: s.iv }, key, s.ct));
  assert.equal(new TextDecoder().decode(back), 'RIFF....WEBP');
});
