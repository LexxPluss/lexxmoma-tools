// test/calc.test.js — `node --test` で実行
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/calc.js');
const CSV = require('../src/csv.js');
const XLSX = require('../src/xlsx.js');

function lightState(over) {
  const s = C.defaultState();
  Object.assign(s.base, over || {});
  return s;
}
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps), `${a} ≠ ${b}`);

test('1. 基本回収：600・2直・1人・上昇率0・初期投資2400・ランニング0 → 2.0年 / 1200万円', () => {
  const r = C.compute({ laborCostPerPerson: 600, shifts: 2, personsPerShift: 1, wageGrowth: 0, capexTotal: 2400, opexAnnual: 0, years: 5 });
  assert.equal(r.error, null);
  assert.equal(r.annualSaving0, 1200);
  assert.equal(r.paybackYears, 2.0);
  assert.equal(C.fmtYears(r.paybackYears), '2.0');
});

test('2. 線形補間：初期投資2600・ランニング150・上昇率3% → 2.41年（手計算）', () => {
  // cum1 = -2600 + (1200-150) = -1550, cum2 = -1550 + (1236-150) = -464,
  // cum3 = -464 + (1273.08-150) = 659.08 → 2 + 464/1123.08 = 2.41315…
  const r = C.compute({ laborCostPerPerson: 600, shifts: 2, personsPerShift: 1, wageGrowth: 3, capexTotal: 2600, opexAnnual: 150, years: 5 });
  near(r.series[2].cum, -464, 1e-6);
  near(r.series[3].cum, 659.08, 1e-6);
  assert.equal(r.paybackYears.toFixed(2), '2.41');
  near(r.paybackYears, 2 + 464 / 1123.08, 1e-9);
});

test('3. 未回収：初期投資が累積効果を超える → null', () => {
  const r = C.compute({ laborCostPerPerson: 600, shifts: 1, personsPerShift: 1, wageGrowth: 0, capexTotal: 10000, opexAnnual: 100, years: 5 });
  assert.equal(r.paybackYears, null);
  assert.ok(r.cumFinal < 0);
  const p = { laborCostPerPerson: 600, shifts: 1, personsPerShift: 1, wageGrowth: 0, capexTotal: 10000, opexAnnual: 100, years: 5 };
  assert.match(C.summaryText(p, r), /評価期間5年以内では回収に至らない/);
});

test('4. 初期投資ゼロ：エラー状態を返し例外を投げない', () => {
  let r;
  assert.doesNotThrow(() => { r = C.compute({ laborCostPerPerson: 600, shifts: 2, personsPerShift: 1, wageGrowth: 3, capexTotal: 0, opexAnnual: 0, years: 5 }); });
  assert.equal(r.error, 'NO_CAPEX');
  assert.equal(r.paybackYears, null);
  assert.equal(r.annualSaving0, 1200);
  // 状態経由（空白の初期値）でも同様
  const s = lightState();
  const p = C.resolveInputs(s);
  assert.equal(p.capexTotal, 0);
  assert.equal(C.compute(p).error, 'NO_CAPEX');
});

test('5. 負値・NaN・空欄は0扱いで計算が完走する', () => {
  assert.equal(C.num(-100), 0);
  assert.equal(C.num(NaN), 0);
  assert.equal(C.num(''), 0);
  assert.equal(C.num('abc'), 0);
  assert.equal(C.num('1,200'), 1200);
  assert.equal(C.isInvalid(-1), true);
  assert.equal(C.isInvalid('x'), true);
  assert.equal(C.isInvalid(''), false);
  const s = lightState({ laborCostPerPerson: -100, opexAnnual: NaN });
  s.base.capex.robot = ''; s.base.capex.camera = 'NaN'; s.base.capex.endEffector = -5; s.base.capex.integration = 2400;
  const r = C.compute(C.resolveInputs(s));
  assert.equal(r.error, null);
  assert.equal(r.annualSaving0, 0);
  assert.equal(r.capexTotal, 2400);
  assert.equal(r.paybackYears, null);
  assert.ok(r.series.every(x => Number.isFinite(x.cum)));
});

test('6. 精緻→ライト同期：wage.base=450, overheadRate=30 → 585', () => {
  assert.equal(C.laborCostFromWage({ base: 450, overheadRate: 30, overtimeHours: 0, overtimeRate: 0, hiringTraining: 0 }), 585);
  // 残業・採用教育の加算
  near(C.laborCostFromWage({ base: 450, overheadRate: 30, overtimeHours: 100, overtimeRate: 2500, hiringTraining: 20 }), 585 + 25 + 20);
  const s = C.defaultState(); s.mode = 'detail';
  const p = C.resolveInputs(s);
  assert.equal(p.laborCostPerPerson, 585);
  // 合計欄の直接入力（override）が優先される
  s.detail.override.labor = 600;
  assert.equal(C.resolveInputs(s).laborCostPerPerson, 600);
});

test('7. 可動率補正：1人 × 2ステーション × 95% → 1.9', () => {
  near(C.effectivePersonsPerShift(1, { stationsPerRobot: 2, availability: 95 }), 1.9);
  const s = C.defaultState(); s.mode = 'detail'; s.detail.ops.stationsPerRobot = 2;
  const p = C.resolveInputs(s);
  near(p.effectivePersonsPerShift, 1.9);
  near(C.compute(p).annualSaving0, 585 * 2 * 1.9);
});

test('8. 付加効果は saving に加算され、高騰率が掛からない', () => {
  const r = C.compute({ laborCostPerPerson: 600, shifts: 2, personsPerShift: 1, wageGrowth: 10, capexTotal: 1000, opexAnnual: 0, years: 3, extraAnnual: 100 });
  near(r.series[1].saving, 1200 + 100);
  near(r.series[2].saving, 1200 * 1.1 + 100);
  near(r.series[3].saving, 1200 * 1.21 + 100);
  assert.equal(r.annualSaving0, 1200);
  assert.equal(r.firstYearSaving, 1300);
});

test('9. NPV：割引率5% の値が手計算と一致（enableNPV=trueのみ）', () => {
  const base = { laborCostPerPerson: 600, shifts: 2, personsPerShift: 1, wageGrowth: 0, capexTotal: 2400, opexAnnual: 0, years: 3 };
  const off = C.compute(Object.assign({}, base, { discountRate: null }));
  assert.equal(off.npv, null);
  const on = C.compute(Object.assign({}, base, { discountRate: 5 }));
  const expected = 1200 / 1.05 + 1200 / 1.05 ** 2 + 1200 / 1.05 ** 3 - 2400;
  near(on.npv, expected, 1e-9);
  // 状態経由：fin.enableNPV が false なら null
  const s = C.defaultState(); s.mode = 'detail'; s.base.capex.robot = 2400;
  assert.equal(C.compute(C.resolveInputs(s)).npv, null);
  s.detail.fin.enableNPV = true;
  assert.equal(typeof C.compute(C.resolveInputs(s)).npv, 'number');
});

test('10. Excel：ファイル名・出力日時・A/B 保存時は「シナリオ比較」シート', async () => {
  assert.equal(CSV.fileName('2直/案:A', new Date(2026, 8, 24)), 'LexxMoMa_ROI_2直_案_A_20260924.xlsx');
  assert.equal(CSV.fileName('', new Date(2026, 8, 24)), 'LexxMoMa_ROI_無題_20260924.xlsx');
  const s = lightState({ opexAnnual: 150 });
  s.base.capex.robot = 2000; s.base.capex.camera = 200; s.base.capex.endEffector = 100; s.base.capex.integration = 300;
  const p = C.resolveInputs(s), r = C.compute(p);
  const dec = new TextDecoder();
  const sheetsOf = async st => {
    const z = await XLSX.unzip(XLSX.buildXlsx(st, { now: new Date(2026, 8, 24, 14, 30) }));
    return { wb: dec.decode(z['xl/workbook.xml']), s1: dec.decode(z['xl/worksheets/sheet1.xml']), s2: z['xl/worksheets/sheet2.xml'] && dec.decode(z['xl/worksheets/sheet2.xml']) };
  };
  let x = await sheetsOf(s);
  assert.ok(x.s1.includes('出力 2026/09/24 14:30'));
  assert.equal(x.s2, undefined, 'A/B 未保存なら1シート');
  s.scenarioName = '2直案'; s.scenarios.A = C.snapshot(s, p, r);
  x = await sheetsOf(s);
  assert.ok(x.wb.includes('name="入力・計算"') && x.wb.includes('name="シナリオ比較"'));
  assert.ok(x.s2.includes('シナリオ A/B 比較') && x.s2.includes('2直案') && x.s2.includes('未保存'));
  assert.ok(x.s2.includes(`<v>${r.paybackYears}</v>`), '投資回収年数（保存時点の値）');
  assert.ok(/<row r="\d+" hidden="1">/.test(x.s1), 'A/B の保存データは非表示行');
});

test('数量：初期投資は 単価×数量。空欄数量は1、ライト/精緻とも合計に反映', () => {
  assert.equal(C.qty(''), 1);
  assert.equal(C.qty(2), 2);
  assert.equal(C.qty(-1), 0);
  assert.equal(C.amount(1000, 2), 2000);
  assert.equal(C.amount(1000, ''), 1000);
  const s = lightState();
  s.base.capex.robot = 1000; s.base.capexQty.robot = 2;
  s.base.capex.camera = 100; s.base.capexQty.camera = '';
  s.base.capex.integration = 300; s.base.capexQty.integration = 1;
  let p = C.resolveInputs(s);
  assert.equal(p.capex.robot, 2000);
  assert.equal(p.capex.camera, 100);
  assert.equal(p.capexTotal, 2400);
  assert.equal(p.robotUnits, 2);
  assert.match(C.summaryText(p, C.compute(p)), /^LexxMoMa 2台の導入/);
  // 精緻：導入・周辺費用の内訳も 単価×数量
  s.mode = 'detail'; s.detail.capex.si = 200; s.detail.capexQty.si = 3; s.detail.capex.safety = 50; s.detail.capexQty.safety = '';
  p = C.resolveInputs(s);
  assert.equal(p.capex.integration, 650);
  // 入力一覧（印刷サマリー）に単価・数量・金額の行が出る
  const rows = CSV.inputRows(s, p).map(r => r.join('|'));
  assert.ok(rows.includes('初期投資 機体（単価）|1000|万円'));
  assert.ok(rows.includes('初期投資 機体（数量）|2|台'));
  assert.ok(rows.includes('初期投資 機体（金額）|2000|万円'));
  assert.ok(rows.includes('初期投資 SI・ティーチング（金額）|600|万円'));
});

test('語彙ルール：UI・Excel・サマリーに禁止語が無い', () => {
  const fs = require('fs'), path = require('path');
  const banned = ['削減人数', '人員削減', '余剰人員', 'ペイバック', '機体価格'];
  for (const f of ['index.html', 'ui.js', 'csv.js', 'calc.js', 'xlsx.js']) {
    const txt = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    for (const w of banned) assert.equal(txt.includes(w), false, `${f} に「${w}」`);
  }
});

test('価格系の初期値が空白', () => {
  const s = C.defaultState();
  for (const k of Object.keys(s.base.capex)) assert.equal(s.base.capex[k], '');
  assert.equal(s.base.opexAnnual, '');
  for (const k of Object.keys(s.detail.capex)) assert.equal(s.detail.capex[k], '');
  for (const k of Object.keys(s.detail.opex)) assert.equal(s.detail.opex[k], '');
});

test('Excel：保存 → 読み込みで状態が完全に復元される（ライト・精緻・A/B・しきい値・不正値）', async () => {
  const s = lightState({ opexAnnual: 150 });
  s.base.capex.robot = 2000; s.base.capexQty.robot = 2; s.base.capex.integration = 300.5;
  s.scenarioName = '2直,"本命"案';
  s.thresholds.green = 1.5;
  s.detail.wage.base = 480; s.detail.capex.si = 120; s.detail.capexQty.si = '';
  s.detail.override.opex = 99; s.detail.fin.enableNPV = true;
  s.base.wageGrowth = 'abc';               // 不正値は不正値のまま戻る（警告表示用）
  const p = C.resolveInputs(s), r = C.compute(p);
  s.scenarios.A = C.snapshot(s, p, r);
  for (const mode of ['light', 'detail']) {
    s.mode = mode;
    const cur = C.defaultState(); cur.ui.inputWidth = 600; cur.scenarios.B = { name: 'old', result: {}, series: [] };
    const res = await XLSX.importXlsx(XLSX.buildXlsx(s, { now: new Date() }), cur);
    assert.equal(res.format, 'xlsx');
    assert.equal(res.skipped, 0);
    const want = C.deepClone(s); want.ui.inputWidth = 600;   // ファイルに A/B があれば A/B ごと置き換え
    assert.deepEqual(res.state, want, mode);
  }
});

test('CSV読み込み：CSVにA/Bが無ければ現在のA/Bを残す。未知の行・読めない値は数えて無視', () => {
  const cur = C.defaultState(); cur.scenarios.A = { name: 'x', result: {}, series: [] };
  const csv = '[読み込み用データ]\r\n項目,値,単位,対象,キー\r\n直数,3,直,共通,base.shifts\r\nモード,どれか,,共通,mode\r\n謎,1,,,foo.bar\r\n';
  const res = CSV.importState(csv, cur);
  assert.equal(res.state.base.shifts, 3);
  assert.equal(res.state.mode, 'light');
  assert.equal(res.applied, 1);
  assert.equal(res.skipped, 2);
  assert.equal(res.state.scenarios.A.name, 'x');
  assert.ok(CSV.importState('a,b\r\n1,2', cur).error);
  assert.ok(CSV.importState('', cur).error);
});

test('CSV読み込み：キー列を消しても項目名で読める・3桁区切り・見出し行は無視', () => {
  const edited = '[読み込み用データ]\r\n項目,値,単位\r\n■ 初期投資,,\r\n"初期投資 機体（単価）","1,200",万円\r\nモード（ライト／精緻）,精緻,\r\nNPVを表示（ON／OFF）,ON,\r\n';
  const r2 = CSV.importState(edited, null);
  assert.equal(r2.skipped, 0);
  assert.equal(r2.state.base.capex.robot, 1200);
  assert.equal(r2.state.mode, 'detail');
  assert.equal(r2.state.detail.fin.enableNPV, true);
});

test('CSV読み込み：文字コード（UTF-8 BOM / BOMなし / Shift_JIS）を判別', () => {
  const text = '[読み込み用データ]\r\n項目,値,単位,対象,キー\r\nシナリオ名,２直案,,共通,scenarioName\r\n';
  const utf8 = new TextEncoder().encode('\uFEFF' + text);
  assert.equal(CSV.decodeBytes(utf8), text);
  assert.equal(CSV.decodeBytes(new TextEncoder().encode(text)), text);
  // 「シナリオ名」「２直案」を Shift_JIS で
  const sjis = Uint8Array.from([0x83, 0x56, 0x83, 0x69, 0x83, 0x8A, 0x83, 0x49, 0x96, 0xBC, 0x2C, 0x82, 0x51, 0x92, 0xBC, 0x88, 0xC4]);
  assert.equal(CSV.decodeBytes(sjis), 'シナリオ名,２直案');
});

/** 以前のツールが出力していた CSV（読み込みに使う [サマリー] と [入力一覧] の部分） */
function legacyCsv(s) {
  const p = C.resolveInputs(s);
  const q = v => (/[",\r\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  const L = ['[サマリー]', '項目,値,単位', '出力日時,2026/09/24 14:30,', `モード,${p.mode === 'detail' ? '精緻' : 'ライト'},`, `シナリオ名,${q(s.scenarioName)},`, '',
    '[入力一覧]', '項目,値,単位', ...CSV.inputRows(s, p).map(r => r.map(q).join(',')), '', '[年次表]', '年,年間省人効果,年間ランニング費,年間純効果,累積キャッシュフロー', '0,0,0,0,-1'];
  return '\uFEFF' + L.join('\r\n') + '\r\n';
}

test('CSV読み込み：以前のツールが出力した CSV は [入力一覧] の項目名から復元', () => {
  const s = lightState({ opexAnnual: 150 });
  s.base.capex.robot = 2000; s.base.capexQty.robot = 2; s.base.capex.integration = 300;
  s.scenarioName = '旧CSV';
  let r = C.compute(C.resolveInputs(s));
  let res = CSV.importState(legacyCsv(s), null);
  assert.equal(res.format, 'legacy');
  assert.equal(res.state.scenarioName, '旧CSV');
  assert.equal(res.state.base.capex.robot, 2000);
  assert.equal(res.state.base.capexQty.robot, 2);
  assert.equal(res.state.base.opexAnnual, 150);
  assert.equal(C.compute(C.resolveInputs(res.state)).paybackYears, r.paybackYears);
  // 精緻：合計を直接入力していたら override に戻る。自動合計なら null のまま
  s.mode = 'detail'; s.detail.capex.si = 200; s.detail.override.opex = 80;
  r = C.compute(C.resolveInputs(s));
  res = CSV.importState(legacyCsv(s), null);
  assert.equal(res.state.mode, 'detail');
  assert.equal(res.state.detail.capex.si, 200);
  assert.equal(res.state.detail.override.opex, 80);
  assert.equal(res.state.detail.override.labor, null);
  assert.equal(res.state.detail.override.integration, null);
  assert.equal(C.compute(C.resolveInputs(res.state)).paybackYears, r.paybackYears);
});

test('Excel：初期値の .xlsx を読み戻すと初期値。全入力項目がシートにある', async () => {
  const keys = XLSX.GROUPS.flatMap(g => g[1]);
  const fieldKeys = CSV.FIELDS.filter(f => f[4] !== 'json').map(f => f[0]);
  assert.deepEqual(keys.slice().sort(), fieldKeys.slice().sort());
  const bytes = XLSX.buildXlsx(C.defaultState());
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4B);           // PK
  const res = await XLSX.importXlsx(bytes, null);
  assert.equal(res.format, 'xlsx');
  assert.equal(res.skipped, 0);
  assert.deepEqual(res.state, C.defaultState());
});

test('Excel：A/B を含まないファイルなら現在の A/B を残す', async () => {
  const s = C.defaultState();
  s.mode = 'detail'; s.scenarioName = 'A&B <案>';
  s.base.capex.robot = 1800.5; s.base.capexQty.robot = 2; s.detail.capex.si = 250; s.detail.capexQty.si = '';
  s.detail.override.opex = 77; s.detail.fin.enableNPV = true; s.thresholds.yellow = 3.5;
  const cur = C.defaultState(); cur.scenarios.B = { name: 'keep', result: {}, series: [] };
  const res = await XLSX.importXlsx(XLSX.buildXlsx(s), cur);
  const want = C.deepClone(s); want.scenarios = cur.scenarios;
  assert.deepEqual(res.state, want);
});

test('Excel読み込み：deflate 圧縮・共有文字列（ふりがな付き）のシートを読める', async () => {
  // Excel が保存し直したファイルを模擬：sharedStrings + deflate
  const sheet = '<worksheet><sheetData>'
    + '<row r="3"><c r="A3" t="s"><v>0</v></c><c r="B3" t="s"><v>1</v></c><c r="E3" t="s"><v>2</v></c></row>'
    + '<row r="4"><c r="A4" t="s"><v>3</v></c><c r="B4" t="s"><v>4</v></c><c r="E4" t="s"><v>5</v></c></row>'
    + '<row r="5"><c r="B5"><v>3</v></c><c r="E5" t="inlineStr"><is><t>base.shifts</t></is></c><c r="H5"><f>1+1</f><v>2</v></c></row>'
    + '</sheetData></worksheet>';
  const sst = '<sst>' + ['項目', '値', 'キー', 'シナリオ名'].map(t => `<si><t>${t}</t></si>`).join('')
    + '<si><r><t>本命</t></r><r><t>&amp;案</t></r><rPh sb="0" eb="2"><t>ホンメイ</t></rPh></si><si><t>scenarioName</t></si></sst>';
  const files = {
    'xl/workbook.xml': '<workbook><sheets><sheet name="入力・計算" sheetId="1" r:id="rId9"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId9" Type="x" Target="worksheets/sheetX.xml"/></Relationships>',
    'xl/sharedStrings.xml': sst, 'xl/worksheets/sheetX.xml': sheet
  };
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const comp = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const nm = enc.encode(name);
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, 8, true);
    lh.setUint32(18, comp.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(lh.buffer), nm, comp);
    const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, 8, true);
    ch.setUint32(20, comp.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + comp.length;
  }
  const cd = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(10, 4, true); end.setUint32(12, cd, true); end.setUint32(16, off, true);
  const zip = new Uint8Array(await new Blob(parts.concat(central, [new Uint8Array(end.buffer)])).arrayBuffer());
  const res = await XLSX.importXlsx(zip, null);
  assert.equal(res.error, undefined);
  assert.equal(res.state.scenarioName, '本命&案');
  assert.equal(res.state.base.shifts, 3);
  assert.equal(res.applied, 2);
});
