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
    return BOM + L.join(CRLF) + CRLF;
  }

  /** ブラウザでのダウンロード（Blob + a[download]） */
  function download(text, filename) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { BOM, CRLF, esc, row, fileName, inputRows, compareRows, buildCsv, download, fmtDateTime, yyyymmdd };
});
