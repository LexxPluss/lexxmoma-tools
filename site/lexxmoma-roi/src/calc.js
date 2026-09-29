/* LexxMoMa 費用対効果 簡易計算ツール — calc.js
 * 計算ロジック（純関数のみ・DOM非依存）。ブラウザでは globalThis.LXCALC、Node では module.exports。
 * 通貨単位はすべて万円。 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LXCALC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------- 入力の正規化 ----------
  function isBlank(v) { return v === null || v === undefined || v === ''; }
  function toNumber(v) {
    if (typeof v === 'number') return v;
    if (isBlank(v)) return NaN;
    return Number(String(v).replace(/,/g, '').trim());
  }
  /** 負値・NaN・空欄は 0 扱い */
  function num(v) {
    const n = toNumber(v);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
  }
  /** 警告表示用：空欄以外で数値として不正（NaN・負値）なら true */
  function isInvalid(v) {
    if (isBlank(v)) return false;
    const n = toNumber(v);
    return !Number.isFinite(n) || n < 0;
  }
  function normalizeShifts(s) { const n = Math.round(num(s)); return Math.min(3, Math.max(1, n || 1)); }
  function normalizeYears(y) { const n = Math.round(num(y)); return n >= 1 ? n : 5; }

  // ---------- 状態の既定値 ----------
  const DEFAULT_STATE = {
    v: 1,
    mode: 'light',                 // 'light' | 'detail'
    scenarioName: '',
    base: {                        // 両モード共通の入力（ライトモードの7項目）
      laborCostPerPerson: 600,
      shifts: 2,
      personsPerShift: 1,
      wageGrowth: 3,
      capex: { robot: '', camera: '', endEffector: '', integration: '' },          // 単価（万円）
      capexQty: { robot: 1, camera: 1, endEffector: 1, integration: 1 },          // 数量（台・個・式）
      opexAnnual: '',
      years: 5
    },
    detail: {                      // 精緻モードの展開項目
      wage: { base: 450, overheadRate: 30, overtimeHours: 0, overtimeRate: 0, hiringTraining: 0 },
      ops: { workingDays: 240, hoursPerShift: 8, stationsPerRobot: 1, availability: 95 },
      capex: { si: '', safety: '', layout: '', training: '', spares: '' },        // 単価（万円）
      capexQty: { si: 1, safety: 1, layout: 1, training: 1, spares: 1 },         // 数量（式）
      opex: { maintenance: '', software: '', power: '', consumables: '' },
      extra: { qualitySaving: 0, downtimeSaving: 0 },
      fin: { enableNPV: false, discountRate: 5, depreciationYears: 7 },
      // 合計欄の直接入力値（null なら展開項目から自動算出）
      override: { labor: null, integration: null, opex: null }
    },
    thresholds: { green: 2.0, yellow: 3.0 },
    scenarios: { A: null, B: null },
    ui: { inputWidth: 470 }                    // 画面レイアウト（入力パネル幅）
  };
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
  function defaultState() { return deepClone(DEFAULT_STATE); }
  /** base の構造を保ちつつ patch の値を取り込む（未知キーは無視） */
  function mergeState(base, patch) {
    if (!patch || typeof patch !== 'object') return base;
    for (const k of Object.keys(base)) {
      if (!(k in patch)) continue;
      const bv = base[k], pv = patch[k];
      if (k === 'scenarios' || k === 'override') { base[k] = Object.assign({}, bv, pv || {}); continue; }
      if (bv && typeof bv === 'object' && !Array.isArray(bv)) {
        if (pv && typeof pv === 'object') mergeState(bv, pv);
      } else {
        base[k] = pv;
      }
    }
    return base;
  }

  // ---------- 精緻モードの部分計算 ----------
  function laborCostFromWage(w) {
    return num(w.base) * (1 + num(w.overheadRate) / 100)
      + num(w.overtimeHours) * num(w.overtimeRate) / 10000
      + num(w.hiringTraining);
  }
  function effectivePersonsPerShift(personsPerShift, ops) {
    return num(personsPerShift) * num(ops.stationsPerRobot) * num(ops.availability) / 100;
  }
  function sumItems(obj) { return Object.keys(obj).reduce((a, k) => a + num(obj[k]), 0); }
  /** 数量：空欄は 1 扱い（負値・NaN は 0） */
  function qty(v) { return isBlank(v) ? 1 : num(v); }
  /** 金額 = 単価 × 数量 */
  function amount(price, q) { return num(price) * qty(q); }
  /** 単価×数量の合計（qtyObj が無ければ数量1） */
  function sumAmounts(prices, qtys) { return Object.keys(prices).reduce((a, k) => a + amount(prices[k], qtys ? qtys[k] : 1), 0); }
  function allBlank(obj) { return Object.keys(obj).every(k => isBlank(obj[k])); }
  /** 参考表示：時間あたり人件費（円/h） */
  function hourlyRate(laborCostPerPerson, ops) {
    const h = num(ops.workingDays) * num(ops.hoursPerShift);
    return h > 0 ? num(laborCostPerPerson) * 10000 / h : 0;
  }

  /** 状態 → 実効パラメータ（モードに応じて合計値を解決） */
  function resolveInputs(state) {
    const b = state.base, d = state.detail;
    const light = state.mode !== 'detail';
    const derived = {
      labor: laborCostFromWage(d.wage),
      integration: sumAmounts(d.capex, d.capexQty),
      opex: sumItems(d.opex)
    };
    let labor, integration, opex, effPersons, extra = 0, discountRate = null;
    if (light) {
      labor = num(b.laborCostPerPerson);
      integration = amount(b.capex.integration, b.capexQty.integration);
      opex = num(b.opexAnnual);
      effPersons = num(b.personsPerShift);
    } else {
      labor = !isBlank(d.override.labor) ? num(d.override.labor) : derived.labor;
      integration = !isBlank(d.override.integration) ? num(d.override.integration) : derived.integration;
      opex = !isBlank(d.override.opex) ? num(d.override.opex) : derived.opex;
      effPersons = effectivePersonsPerShift(b.personsPerShift, d.ops);
      extra = num(d.extra.qualitySaving) + num(d.extra.downtimeSaving);
      if (d.fin.enableNPV) discountRate = num(d.fin.discountRate);
    }
    const capex = {
      robot: amount(b.capex.robot, b.capexQty.robot), camera: amount(b.capex.camera, b.capexQty.camera),
      endEffector: amount(b.capex.endEffector, b.capexQty.endEffector), integration
    };
    const capexQty = {
      robot: qty(b.capexQty.robot), camera: qty(b.capexQty.camera),
      endEffector: qty(b.capexQty.endEffector), integration: qty(b.capexQty.integration)
    };
    return {
      mode: light ? 'light' : 'detail',
      capexQty,
      robotUnits: Math.max(1, Math.round(capexQty.robot) || 1),
      laborCostPerPerson: labor,
      shifts: normalizeShifts(b.shifts),
      personsPerShift: num(b.personsPerShift),
      effectivePersonsPerShift: effPersons,
      wageGrowth: num(b.wageGrowth),
      capex,
      capexTotal: capex.robot + capex.camera + capex.endEffector + capex.integration,
      opexAnnual: opex,
      years: normalizeYears(b.years),
      extraAnnual: extra,
      discountRate,
      derived,
      hourlyRate: light ? null : hourlyRate(labor, d.ops)
    };
  }

  // ---------- 本体計算 ----------
  /**
   * @param p { laborCostPerPerson, shifts, personsPerShift | effectivePersonsPerShift,
   *            wageGrowth(%), capex{...} | capexTotal, opexAnnual, years, extraAnnual?, discountRate?(%)|null }
   */
  function compute(p) {
    const shifts = normalizeShifts(p.shifts);
    const years = normalizeYears(p.years);
    const labor = num(p.laborCostPerPerson);
    const persons = !isBlank(p.effectivePersonsPerShift) ? num(p.effectivePersonsPerShift) : num(p.personsPerShift);
    const g = num(p.wageGrowth) / 100;
    const opex = num(p.opexAnnual);
    const extra = num(p.extraAnnual);
    const capexTotal = !isBlank(p.capexTotal) ? num(p.capexTotal) : sumItems(p.capex || {});

    const annualSaving0 = labor * shifts * persons;
    const series = [{ year: 0, saving: 0, opex: 0, net: 0, cum: -capexTotal }];
    let cum = -capexTotal;
    for (let n = 1; n <= years; n++) {
      const saving = annualSaving0 * Math.pow(1 + g, n - 1) + extra;   // 付加効果は高騰率を掛けない
      const net = saving - opex;
      cum += net;
      series.push({ year: n, saving, opex, net, cum });
    }
    const out = {
      error: null, annualSaving0, extraAnnual: extra, firstYearSaving: annualSaving0 + extra,
      capexTotal, opexAnnual: opex, years, series, cumFinal: cum, paybackYears: null, npv: null
    };
    if (capexTotal <= 0) { out.error = 'NO_CAPEX'; return out; }
    out.paybackYears = paybackYears(series);
    if (!isBlank(p.discountRate)) out.npv = npv(series, num(p.discountRate));
    return out;
  }

  /** cumCF(k-1) < 0 ≤ cumCF(k) となる最小 k を線形補間。回収しなければ null */
  function paybackYears(series) {
    for (let k = 1; k < series.length; k++) {
      const a = series[k - 1].cum, b = series[k].cum;
      if (a < 0 && b >= 0) return (k - 1) + (-a) / (b - a);
    }
    if (series.length && series[0].cum >= 0) return 0;
    return null;
  }
  function npv(series, ratePct) {
    const d = num(ratePct) / 100;
    let v = series[0].cum;
    for (let k = 1; k < series.length; k++) v += series[k].net / Math.pow(1 + d, k);
    return v;
  }

  // ---------- 表示用 ----------
  function roundInt(x) { const n = Number(x); return Number.isFinite(n) ? Math.round(n) : 0; }
  function fmtMan(x) { return roundInt(x).toLocaleString('ja-JP'); }
  function fmtYears(y) { return isBlank(y) ? null : (Math.round(y * 10) / 10).toFixed(1); }
  function fmtDec(x, maxDigits) {
    const n = Number(x); if (!Number.isFinite(n)) return '0';
    return String(Number(n.toFixed(maxDigits === undefined ? 2 : maxDigits)));
  }

  /** 3行固定のサマリー文 */
  function summaryText(p, r) {
    const persons = fmtDec(!isBlank(p.effectivePersonsPerShift) ? p.effectivePersonsPerShift : p.personsPerShift, 2);
    const l1 = `LexxMoMa ${p.robotUnits || 1}台の導入により、${normalizeShifts(p.shifts)}直体制で1直あたり${persons}人の省人化（再配置）を想定し、年間${fmtMan(r.annualSaving0)}万円の効果を見込む。`;
    const head = `初期投資${fmtMan(r.capexTotal)}万円・年間ランニング${fmtMan(r.opexAnnual)}万円に対し、`;
    const tail = `（人件費上昇率${fmtDec(p.wageGrowth, 1)}%/年で試算）。`;
    const l2 = r.paybackYears === null
      ? `${head}評価期間${r.years}年以内では回収に至らない${tail}`
      : `${head}投資回収年数は${fmtYears(r.paybackYears)}年${tail}`;
    const l3 = `${r.years}年間の累積効果は${fmtMan(r.cumFinal)}万円。`;
    return [l1, l2, l3].join('\n');
  }

  /** シナリオA/B 保存用スナップショット */
  function snapshot(state, p, r) {
    return {
      name: state.scenarioName || '',
      mode: p.mode,
      inputs: {
        laborCostPerPerson: p.laborCostPerPerson,
        shifts: p.shifts,
        personsPerShift: p.personsPerShift,
        effectivePersonsPerShift: p.effectivePersonsPerShift,
        wageGrowth: p.wageGrowth,
        capexTotal: p.capexTotal,
        opexAnnual: p.opexAnnual,
        years: p.years,
        extraAnnual: p.extraAnnual
      },
      result: {
        error: r.error, paybackYears: r.paybackYears, cumFinal: r.cumFinal,
        annualSaving0: r.annualSaving0, npv: r.npv
      },
      series: r.series.map(s => ({ year: s.year, cum: s.cum }))
    };
  }

  /** メーター色判定 */
  function paybackColor(years, thresholds) {
    const t = thresholds || DEFAULT_STATE.thresholds;
    if (isBlank(years)) return 'grey';
    if (years <= num(t.green)) return 'green';
    if (years <= num(t.yellow)) return 'yellow';
    return 'grey';
  }

  return {
    DEFAULT_STATE, defaultState, mergeState, deepClone,
    num, isBlank, isInvalid, normalizeShifts, normalizeYears,
    laborCostFromWage, effectivePersonsPerShift, sumItems, qty, amount, sumAmounts, allBlank, hourlyRate,
    resolveInputs, compute, paybackYears, npv,
    roundInt, fmtMan, fmtYears, fmtDec, summaryText, snapshot, paybackColor
  };
});
