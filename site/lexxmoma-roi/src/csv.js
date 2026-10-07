/* LexxMoMa 費用対効果 簡易計算ツール — csv.js
 * CSV生成（UTF-8 BOM・CRLF・RFC4180）とダウンロード。生成部はDOM非依存。 */
(function (root, factory) {
  'use strict';
  const calc = (typeof module === 'object' && module.exports) ? require('./calc.js') : root.LXCALC;
  const api = factory(calc);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LXCSV = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';

  const BOM = '﻿';
  const CRLF = '\r\n';

  function esc(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function row(cells) { return cells.map(esc).join(','); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtDateTime(d) {
    return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function yyyymmdd(d) { return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`; }
  function int(x) { return C.roundInt(x); }
  function pb(y) { return y === null || y === undefined ? '' : C.fmtYears(y); }

  /** ファイル名：LexxMoMa_ROI_{シナリオ名 or 無題}_{YYYYMMDD}.csv */
  function fileName(scenarioName, date) {
    const raw = (scenarioName || '').trim() || '無題';
    const safe = raw.replace(/[\\/:*?"<>|\r\n\t]/g, '_');
    return `LexxMoMa_ROI_${safe}_${yyyymmdd(date || new Date())}.csv`;
  }

  /** 入力一覧（モードに応じて全入力）：[項目, 値, 単位] の配列 */
  function inputRows(state, p) {
    const b = state.base, d = state.detail;
    const rows = [];
    if (p.mode === 'light') {
      rows.push(['1人あたり年間人件費＋管理費', int(p.laborCostPerPerson), '万円/年']);
    } else {
      rows.push(['直接人件費（年）', int(d.wage.base), '万円']);
      rows.push(['法定福利・管理費率', C.fmtDec(C.num(d.wage.overheadRate), 2), '%']);
      rows.push(['年間残業時間/人', C.fmtDec(C.num(d.wage.overtimeHours), 2), 'h']);
      rows.push(['残業単価', int(d.wage.overtimeRate), '円/h']);
      rows.push(['採用・教育費（年・1人あたり）', int(d.wage.hiringTraining), '万円']);
      rows.push(['1人あたり年間人件費＋管理費（合計）', int(p.laborCostPerPerson), '万円/年']);
    }
    rows.push(['直数', p.shifts, '直']);
    rows.push(['1直あたり省人化（再配置）人数', C.fmtDec(p.personsPerShift, 2), '人']);
    if (p.mode === 'detail') {
      rows.push(['年間稼働日', int(d.ops.workingDays), '日']);
      rows.push(['1直あたり時間', C.fmtDec(C.num(d.ops.hoursPerShift), 2), 'h']);
      rows.push(['1台が担当するステーション数', C.fmtDec(C.num(d.ops.stationsPerRobot), 2), '箇所']);
      rows.push(['目標可動率', C.fmtDec(C.num(d.ops.availability), 2), '%']);
      rows.push(['実効 1直あたり省人化（再配置）人数', C.fmtDec(p.effectivePersonsPerShift, 3), '人']);
    }
    rows.push(['人件費上昇率', C.fmtDec(p.wageGrowth, 2), '%/年']);
    // 初期投資：単価 × 数量 = 金額
    const capexRow = (label, price, q, unit) => {
      rows.push([`初期投資 ${label}（単価）`, int(price), '万円']);
      rows.push([`初期投資 ${label}（数量）`, C.fmtDec(C.qty(q), 2), unit]);
      rows.push([`初期投資 ${label}（金額）`, int(C.amount(price, q)), '万円']);
    };
    capexRow('機体', b.capex.robot, b.capexQty.robot, '台');
    capexRow('カメラ・ビジョン', b.capex.camera, b.capexQty.camera, '台');
    capexRow('エンドエフェクタ', b.capex.endEffector, b.capexQty.endEffector, '個');
    if (p.mode === 'light') {
      capexRow('導入・周辺費用（SI・安全対策・レイアウト）', b.capex.integration, b.capexQty.integration, '式');
    } else {
      capexRow('SI・ティーチング', d.capex.si, d.capexQty.si, '式');
      capexRow('安全対策・柵', d.capex.safety, d.capexQty.safety, '式');
      capexRow('レイアウト変更', d.capex.layout, d.capexQty.layout, '式');
      capexRow('教育', d.capex.training, d.capexQty.training, '式');
      capexRow('予備品', d.capex.spares, d.capexQty.spares, '式');
      rows.push(['初期投資 導入・周辺費用（合計）', int(p.capex.integration), '万円']);
    }
    rows.push(['初期投資 合計', int(p.capexTotal), '万円']);
    if (p.mode === 'light') {
      rows.push(['年間ランニング費（保守・ソフトライセンス）', int(p.opexAnnual), '万円/年']);
    } else {
      rows.push(['ランニング 保守契約', int(d.opex.maintenance), '万円/年']);
      rows.push(['ランニング フリート管理・ソフトライセンス', int(d.opex.software), '万円/年']);
      rows.push(['ランニング 電力', int(d.opex.power), '万円/年']);
      rows.push(['ランニング 消耗品', int(d.opex.consumables), '万円/年']);
      rows.push(['年間ランニング費（合計）', int(p.opexAnnual), '万円/年']);
      rows.push(['不良低減による年間削減額', int(d.extra.qualitySaving), '万円/年']);
      rows.push(['ラインストップ低減による年間削減額', int(d.extra.downtimeSaving), '万円/年']);
    }
    rows.push(['評価期間', p.years, '年']);
    if (p.mode === 'detail') {
      rows.push(['NPVを表示', d.fin.enableNPV ? 'ON' : 'OFF', '']);
      if (d.fin.enableNPV) rows.push(['割引率', C.fmtDec(C.num(d.fin.discountRate), 2), '%']);
      rows.push(['減価償却年数（参考）', int(d.fin.depreciationYears), '年']);
    }
    return rows;
  }

  /** シナリオ比較の行（A/B両方保存時のみ使用） */
  function compareRows(A, B) {
    const v = (s, f) => (s ? f(s) : '');
    return [
      ['シナリオ名', v(A, s => s.name || '無題'), v(B, s => s.name || '無題')],
      ['モード', v(A, s => s.mode === 'detail' ? '精緻' : 'ライト'), v(B, s => s.mode === 'detail' ? '精緻' : 'ライト')],
      ['1人あたり年間人件費＋管理費', v(A, s => int(s.inputs.laborCostPerPerson)), v(B, s => int(s.inputs.laborCostPerPerson))],
      ['直数', v(A, s => s.inputs.shifts), v(B, s => s.inputs.shifts)],
      ['1直あたり省人化（再配置）人数', v(A, s => C.fmtDec(s.inputs.effectivePersonsPerShift, 3)), v(B, s => C.fmtDec(s.inputs.effectivePersonsPerShift, 3))],
      ['人件費上昇率', v(A, s => C.fmtDec(s.inputs.wageGrowth, 2)), v(B, s => C.fmtDec(s.inputs.wageGrowth, 2))],
      ['初期投資 合計', v(A, s => int(s.inputs.capexTotal)), v(B, s => int(s.inputs.capexTotal))],
      ['年間ランニング費', v(A, s => int(s.inputs.opexAnnual)), v(B, s => int(s.inputs.opexAnnual))],
      ['評価期間', v(A, s => s.inputs.years), v(B, s => s.inputs.years)],
      ['初年度 年間省人効果', v(A, s => int(s.result.annualSaving0)), v(B, s => int(s.result.annualSaving0))],
      ['投資回収年数', v(A, s => pb(s.result.paybackYears)), v(B, s => pb(s.result.paybackYears))],
      ['累積効果', v(A, s => int(s.result.cumFinal)), v(B, s => int(s.result.cumFinal))]
    ];
  }

  /**
   * CSV本文を生成（BOM付き・CRLF）
   * @param {object} o { state, params, result, now }
   */
  function buildCsv(o) {
    const { state, params: p, result: r } = o;
    const now = o.now || new Date();
    const L = [];
    // [サマリー]
    L.push('[サマリー]');
    L.push(row(['項目', '値', '単位']));
    L.push(row(['出力日時', fmtDateTime(now), '']));
    L.push(row(['モード', p.mode === 'detail' ? '精緻' : 'ライト', '']));
    L.push(row(['シナリオ名', state.scenarioName || '', '']));
    L.push(row(['投資回収年数', r.error ? '' : pb(r.paybackYears), '年']));
    L.push(row(['初年度 年間省人効果', int(r.annualSaving0), '万円']));
    L.push(row([`${r.years}年累積効果`, int(r.cumFinal), '万円']));
    L.push(row(['初期投資 合計', int(r.capexTotal), '万円']));
    L.push(row(['年間ランニング費', int(r.opexAnnual), '万円']));
    if (r.npv !== null && r.npv !== undefined) L.push(row(['NPV', int(r.npv), '万円']));
    L.push('');
    // [入力一覧]
    L.push('[入力一覧]');
    L.push(row(['項目', '値', '単位']));
    inputRows(state, p).forEach(x => L.push(row(x)));
    L.push('');
    // [年次表]
    L.push('[年次表]');
    L.push(row(['年', '年間省人効果', '年間ランニング費', '年間純効果', '累積キャッシュフロー']));
    r.series.forEach(s => L.push(row([s.year, int(s.saving), int(s.opex), int(s.net), int(s.cum)])));
    // [シナリオ比較]
    const A = state.scenarios && state.scenarios.A, B = state.scenarios && state.scenarios.B;
    if (A && B) {
      L.push('');
      L.push('[シナリオ比較]');
      L.push(row(['項目', 'シナリオA', 'シナリオB']));
      compareRows(A, B).forEach(x => L.push(row(x)));
    }
    // [読み込み用データ]（CSV読み込みで入力を復元するための全項目）
    L.push('');
    dataSection(state).forEach(x => L.push(x));
    return BOM + L.join(CRLF) + CRLF;
  }

  // ============ 読み込み用データ（CSV ⇄ 状態） ============
  const DATA_SECTION = '[読み込み用データ]';
  const DATA_HEAD = ['項目', '値', '単位', '対象', 'キー'];
  /** [キー, 項目, 単位, 対象, 型]。型：num（既定）/ text / mode / bool / override（空欄=自動合計）/ json */
  const CAPEX_LABELS = { robot: '機体', camera: 'カメラ・ビジョン', endEffector: 'エンドエフェクタ', integration: '導入・周辺費用（SI・安全対策・レイアウト）',
    si: 'SI・ティーチング', safety: '安全対策・柵', layout: 'レイアウト変更', training: '教育', spares: '予備品' };
  const CAPEX_UNITS = { robot: '台', camera: '台', endEffector: '個' };
  function capexFields(prefix, keys, scope) {
    const out = [];
    keys.forEach(k => {
      out.push([`${prefix}.capex.${k}`, `初期投資 ${CAPEX_LABELS[k]}（単価）`, '万円', scope]);
      out.push([`${prefix}.capexQty.${k}`, `初期投資 ${CAPEX_LABELS[k]}（数量）`, CAPEX_UNITS[k] || '式', scope]);
    });
    return out;
  }
  const FIELDS = [
    ['mode', 'モード（ライト／精緻）', '', '共通', 'mode'],
    ['scenarioName', 'シナリオ名', '', '共通', 'text'],
    ['base.laborCostPerPerson', '1人あたり年間人件費＋管理費', '万円/年', 'ライト'],
    ['detail.wage.base', '直接人件費（年）', '万円', '精緻'],
    ['detail.wage.overheadRate', '法定福利・管理費率', '%', '精緻'],
    ['detail.wage.overtimeHours', '年間残業時間/人', 'h', '精緻'],
    ['detail.wage.overtimeRate', '残業単価', '円/h', '精緻'],
    ['detail.wage.hiringTraining', '採用・教育費（年・1人あたり）', '万円', '精緻'],
    ['detail.override.labor', '1人あたり年間人件費＋管理費 合計（直接入力。空欄なら自動合計）', '万円/年', '精緻', 'override'],
    ['base.shifts', '直数', '直', '共通'],
    ['base.personsPerShift', '1直あたり省人化（再配置）人数', '人', '共通'],
    ['detail.ops.stationsPerRobot', '1台が担当するステーション数', '箇所', '精緻'],
    ['detail.ops.availability', '目標可動率', '%', '精緻'],
    ['detail.ops.workingDays', '年間稼働日', '日', '精緻'],
    ['detail.ops.hoursPerShift', '1直あたり時間', 'h', '精緻'],
    ['base.wageGrowth', '人件費上昇率', '%/年', '共通'],
    ...capexFields('base', ['robot', 'camera', 'endEffector'], '共通'),
    ...capexFields('base', ['integration'], 'ライト'),
    ...capexFields('detail', ['si', 'safety', 'layout', 'training', 'spares'], '精緻'),
    ['detail.override.integration', '導入・周辺費用 合計（直接入力。空欄なら自動合計）', '万円', '精緻', 'override'],
    ['base.opexAnnual', '年間ランニング費（保守・ソフトライセンス）', '万円/年', 'ライト'],
    ['detail.opex.maintenance', 'ランニング 保守契約', '万円/年', '精緻'],
    ['detail.opex.software', 'ランニング フリート管理・ソフトライセンス', '万円/年', '精緻'],
    ['detail.opex.power', 'ランニング 電力', '万円/年', '精緻'],
    ['detail.opex.consumables', 'ランニング 消耗品', '万円/年', '精緻'],
    ['detail.override.opex', '年間ランニング費 合計（直接入力。空欄なら自動合計）', '万円/年', '精緻', 'override'],
    ['base.years', '評価期間', '年', '共通'],
    ['detail.extra.qualitySaving', '不良低減による年間削減額', '万円/年', '精緻'],
    ['detail.extra.downtimeSaving', 'ラインストップ低減による年間削減額', '万円/年', '精緻'],
    ['detail.fin.enableNPV', 'NPVを表示（ON／OFF）', '', '精緻', 'bool'],
    ['detail.fin.discountRate', '割引率', '%', '精緻'],
    ['detail.fin.depreciationYears', '減価償却年数（参考）', '年', '精緻'],
    ['thresholds.green', '稟議基準 緑（この年数以下）', '年', '共通'],
    ['thresholds.yellow', '稟議基準 黄（この年数以下）', '年', '共通'],
    ['scenarios.A', 'シナリオA（保存データ・編集不可）', '', '共通', 'json'],
    ['scenarios.B', 'シナリオB（保存データ・編集不可）', '', '共通', 'json']
  ];

  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
  function setPath(obj, path, val) {
    const ks = path.split('.'); let o = obj;
    for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
    o[ks[ks.length - 1]] = val;
  }

  function formatValue(v, type) {
    if (type === 'mode') return v === 'detail' ? '精緻' : 'ライト';
    if (type === 'bool') return v ? 'ON' : 'OFF';
    if (type === 'json') return v ? JSON.stringify(v) : '';
    return v === null || v === undefined ? '' : String(v);
  }
  /** CSVセルの文字列 → 状態値。読めない値は undefined（その行は無視） */
  function parseValue(s, type) {
    const t = String(s === undefined ? '' : s).trim();
    if (type === 'text') return t;
    if (type === 'mode') return /^(精緻|detail)$/i.test(t) ? 'detail' : /^(ライト|light)$/i.test(t) ? 'light' : undefined;
    if (type === 'bool') return /^(on|true|1|はい|表示)$/i.test(t) ? true : /^(off|false|0|いいえ|非表示|)$/i.test(t) ? false : undefined;
    if (type === 'json') {
      if (!t) return undefined;
      try { const o = JSON.parse(t); return o && typeof o === 'object' && o.result && Array.isArray(o.series) ? o : undefined; } catch (e) { return undefined; }
    }
    if (t === '') return type === 'override' ? null : '';
    const n = Number(t.replace(/,/g, ''));
    return Number.isFinite(n) ? n : t;      // 不正値はそのまま保持し、入力欄の警告色で知らせる
  }

  /** [読み込み用データ] セクションの行（CSV文字列の配列）。シナリオA/Bは保存されているときだけ */
  function dataSection(state) {
    const L = [DATA_SECTION, row(DATA_HEAD)];
    FIELDS.forEach(([key, label, unit, scope, type]) => {
      if (type === 'json' && !getPath(state, key)) return;
      L.push(row([label, formatValue(getPath(state, key), type), unit, scope, key]));
    });
    return L;
  }

  /** RFC4180 のCSVを行×セルの配列に分解（BOM・CRLF/LF・クォート内の改行に対応） */
  function parseCsv(text) {
    const s = String(text || '').replace(/^﻿/, '');
    const rows = []; let cur = [], cell = '', q = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { cur.push(cell); cell = ''; }
      else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        cur.push(cell); rows.push(cur); cur = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || cur.length) { cur.push(cell); rows.push(cur); }
    return rows;
  }

  /** ファイルのバイト列 → 文字列。UTF-8（BOM有無とも）を優先し、読めなければ Shift_JIS（Excel の「CSV（コンマ区切り）」保存） */
  function decodeBytes(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, ''); }
    catch (e) { return new TextDecoder('shift_jis').decode(u8); }
  }

  /** セクション名 → そのセクションの行（見出し行を除く） */
  function sections(rows) {
    const out = {}; let name = null;
    rows.forEach(r => {
      const first = (r[0] || '').trim();
      if (/^\[.+\]$/.test(first) && r.slice(1).every(c => !String(c).trim())) { name = first; out[name] = []; return; }
      if (name && r.some(c => String(c).trim())) out[name].push(r);
    });
    return out;
  }

  // 旧形式（[読み込み用データ] が無いCSV）の [入力一覧] 項目名 → キー
  const LEGACY = (() => {
    const m = Object.create(null); m['NPVを表示'] = 'detail.fin.enableNPV';
    FIELDS.forEach(([key, label, , , type]) => { if (!type || type === 'bool') m[label] = key; });
    return m;
  })();
  // 旧形式の精緻モードの合計行（展開項目の合計と違えば「直接入力」とみなす）
  const LEGACY_TOTALS = {
    '1人あたり年間人件費＋管理費（合計）': 'labor', '初期投資 導入・周辺費用（合計）': 'integration', '年間ランニング費（合計）': 'opex'
  };
  const TYPE_OF = Object.create(null); FIELDS.forEach(f => { TYPE_OF[f[0]] = f[4]; });

  /**
   * CSV文字列（または行×セルの配列。Excel 入力シートの読み込みで使う） → 新しい状態
   * - [読み込み用データ] があればキー列で復元（無い行は初期値）
   * - 無ければ旧形式として [サマリー] / [入力一覧] の項目名から復元
   * - CSVにシナリオA/Bが無ければ current の A/B と画面レイアウトを引き継ぐ
   * @returns {{state, applied:number, skipped:number, format:'data'|'legacy'} | {error:string}}
   */
  function importState(input, current) {
    const secs = sections(Array.isArray(input) ? input : parseCsv(input));
    const s = C.defaultState();
    let applied = 0, skipped = 0, format;
    const put = (key, raw) => {
      const v = parseValue(raw, TYPE_OF[key]);
      if (v === undefined) { if (TYPE_OF[key] !== 'json') skipped++; return; }
      setPath(s, key, v); applied++;
    };
    if (secs[DATA_SECTION]) {
      format = 'data';
      const rows = secs[DATA_SECTION];
      const head = rows[0] && rows[0].map(c => String(c).trim());
      const iKey = head ? head.indexOf('キー') : -1, iVal = head ? head.indexOf('値') : -1;
      const byLabel = Object.create(null); FIELDS.forEach(f => { byLabel[f[1]] = f[0]; });
      rows.slice(iKey >= 0 || iVal >= 0 ? 1 : 0).forEach(r => {
        const k = iKey >= 0 ? String(r[iKey] || '').trim() : '';
        const val = String(r[iVal >= 0 ? iVal : 1] || '').trim();
        if (!k && !val) return;              // 見出し行（■ 人件費 など）
        const key = (k in TYPE_OF) ? k : byLabel[String(r[0] || '').trim()];   // キー列が無ければ項目名で照合
        if (!key) { skipped++; return; }
        put(key, r[iVal >= 0 ? iVal : 1]);
      });
    } else if (secs['[入力一覧]']) {
      format = 'legacy';
      (secs['[サマリー]'] || []).forEach(r => {
        const k = String(r[0] || '').trim();
        if (k === 'モード') put('mode', r[1]);
        if (k === 'シナリオ名') put('scenarioName', r[1]);
      });
      const totals = {};
      secs['[入力一覧]'].forEach(r => {
        const label = String(r[0] || '').trim();
        if (label === '項目') return;
        if (LEGACY[label]) put(LEGACY[label], r[1]);
        else if (LEGACY_TOTALS[label]) totals[LEGACY_TOTALS[label]] = C.num(String(r[1]).replace(/,/g, ''));
      });
      if (s.mode === 'detail') {
        const d = s.detail;
        const derived = { labor: C.laborCostFromWage(d.wage), integration: C.sumAmounts(d.capex, d.capexQty), opex: C.sumItems(d.opex) };
        // CSV の値は整数に丸められているため 0.5 未満の差は自動合計とみなす
        Object.keys(totals).forEach(k => { if (Math.abs(totals[k] - derived[k]) >= 0.5) d.override[k] = totals[k]; });
      }
    } else {
      return { error: 'このツールで出力したCSV、または入力テンプレートを選んでください' };
    }
    if (!applied) return { error: '読み込める項目がありませんでした' };
    if (current) {
      if (s.scenarios.A === null && s.scenarios.B === null && current.scenarios) s.scenarios = C.deepClone(current.scenarios);
      if (current.ui) s.ui = C.deepClone(current.ui);
    }
    return { state: s, applied, skipped, format };
  }

  /** ブラウザでのダウンロード（Blob + a[download]） */
  function download(data, filename, type) {
    const blob = new Blob([data], { type: type || 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { BOM, CRLF, esc, row, fileName, inputRows, compareRows, buildCsv, download, fmtDateTime, yyyymmdd,
    DATA_SECTION, FIELDS, dataSection, parseCsv, decodeBytes, importState };
});
