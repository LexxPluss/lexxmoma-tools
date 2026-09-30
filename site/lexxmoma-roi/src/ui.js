/* LexxMoMa 費用対効果 簡易計算ツール — ui.js
 * DOM・イベント・描画。計算式はここに書かない（calc.js を呼ぶ）。 */
(function () {
  'use strict';
  const C = window.LXCALC, CSV = window.LXCSV;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const COLORS = { primary: '#0068B7', accent: '#3EB370', yellow: '#F2B705', grey: '#9AA0A6', text: '#1F2933', muted: '#5F6B7A', border: '#D9DEE3', warn: '#D93025', track: '#EEF1F4', bg: '#fff' };
  // テーマ(light/dark): グラフの色は styles.css の CSS 変数から読む(assets/theme.js が無い単体配布時は既定の light 色のまま)
  const CSS_VARS = { primary: '--primary', accent: '--accent', yellow: '--yellow', grey: '--grey', text: '--text', muted: '--muted', border: '--border', warn: '--warn', track: '--chart-track', bg: '--bg' };
  const LIGHT_COLORS = Object.assign({}, COLORS);
  function readThemeColors() {
    const cs = getComputedStyle(document.documentElement);
    Object.keys(CSS_VARS).forEach(k => { COLORS[k] = cs.getPropertyValue(CSS_VARS[k]).trim() || LIGHT_COLORS[k]; });
  }
  readThemeColors();

  let state = C.defaultState();

  // ============ URLハッシュ ============
  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    let b = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const bin = atob(b);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function encodeState(s) { return 'v1=' + b64urlEncode(JSON.stringify(s)); }
  function decodeHash(hash) {
    try {
      const m = /(?:^|[#&])v1=([A-Za-z0-9_-]+)/.exec(hash || '');
      if (!m) return null;
      return JSON.parse(b64urlDecode(m[1]));
    } catch (e) { return null; }
  }
  function loadFromHash() {
    const patch = decodeHash(location.hash);
    state = C.defaultState();
    if (patch) C.mergeState(state, patch);
  }
  function writeHash() {
    const h = '#' + encodeState(state);
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  // ============ 状態パス操作 ============
  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
  function setPath(obj, path, val) {
    const ks = path.split('.'); let o = obj;
    for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
    o[ks[ks.length - 1]] = val;
  }
  /** 入力欄の生値 → 状態格納値（空欄は ''、正しい数値は number、不正はそのまま保持して警告表示に使う） */
  function storeValue(raw) {
    if (raw === '' || raw === null || raw === undefined) return '';
    const n = Number(String(raw).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : raw;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function attrVal(v) { return v === null || v === undefined ? '' : esc(v); }

  // ============ 入力パネル ============
  function fSlider(o) {
    const v = getPath(state, o.path);
    return `<div class="field">
      <label>${o.label}</label>
      <div class="ctl">
        <input type="range" data-path="${o.path}" min="${o.min}" max="${o.max}" step="${o.step}" value="${C.num(v)}" aria-label="${o.label}（スライダー）">
        <input type="number" data-path="${o.path}" min="0" step="${o.nstep || o.step}" value="${attrVal(v)}" class="${C.isInvalid(v) ? 'warn' : ''}" aria-label="${o.label}">
        <span class="unit">${o.unit}</span>
      </div>${o.hint ? `<div class="hint">${o.hint}</div>` : ''}
    </div>`;
  }
  function fButtons(o) {
    const v = C.num(getPath(state, o.path));
    return `<div class="field">
      <label>${o.label}</label>
      <div class="ctl"><div class="btn-group" data-path="${o.path}">
        ${o.options.map(x => `<button type="button" data-value="${x}" class="${x === v ? 'on' : ''}">${x}</button>`).join('')}
      </div><span class="unit">${o.unit}</span></div>
    </div>`;
  }
  function fRow(o) {
    const v = getPath(state, o.path);
    return `<div class="row">
      <label for="in_${o.path.replace(/\./g, '_')}">${o.label}</label>
      <input id="in_${o.path.replace(/\./g, '_')}" type="number" data-path="${o.path}" ${o.group ? `data-group="${o.group}"` : ''} min="0" step="${o.step || 1}"
        value="${attrVal(v)}" placeholder="${o.placeholder || ''}" class="${C.isInvalid(v) ? 'warn' : ''}">
      <span class="unit">${o.unit}</span>
    </div>`;
  }
  /** 初期投資の行：単価 × 数量 = 金額 */
  function fCapexRow(o) {
    const price = getPath(state, o.path), q = getPath(state, o.qtyPath);
    const id = o.path.replace(/\./g, '_');
    return `<div class="row capex">
      <label for="in_${id}">${o.label}</label>
      <input id="in_${id}" type="number" data-path="${o.path}" ${o.group ? `data-group="${o.group}"` : ''} min="0" step="${o.step || 10}"
        value="${attrVal(price)}" placeholder="${o.placeholder || ''}" class="${C.isInvalid(price) ? 'warn' : ''}" aria-label="${o.label} 単価">
      <span class="x">×</span>
      <input type="number" class="qty ${C.isInvalid(q) ? 'warn' : ''}" data-path="${o.qtyPath}" ${o.group ? `data-group="${o.group}"` : ''} min="0" step="1" value="${attrVal(q)}" placeholder="1" aria-label="${o.label} 数量">
      <span class="unit">${o.unit}</span>
      <span class="amt" data-amount="${o.path}">${C.fmtMan(C.amount(price, q))}<small> 万円</small></span>
    </div>`;
  }
  function capexHead() { return `<div class="capex-head"><span></span><span>単価（万円）</span><span></span><span>数量</span><span></span><span>金額</span></div>`; }
  function fTotal(o) {
    // 表示のみ（自動合計）
    return `<div class="total"><span>${o.label}</span><span class="val" data-derived="${o.key}">—</span><span class="unit">${o.unit}</span></div>`;
  }
  function fTotalEditable(o) {
    // 合計欄：直接入力可。override が null のときは展開項目の合計を表示
    const ov = getPath(state, 'detail.override.' + o.key);
    const derived = o.derived;
    const manual = !C.isBlank(ov);
    return `<div class="total">
      <span>${o.label}</span>
      <input type="number" data-path="detail.override.${o.key}" data-total="${o.key}" min="0" step="1"
        value="${manual ? attrVal(ov) : C.fmtDec(derived, 2)}" class="${manual ? 'manual' : 'derived'} ${C.isInvalid(ov) ? 'warn' : ''}" aria-label="${o.label}">
      <span class="unit">${o.unit}</span>
      <span class="note" data-note="${o.key}">${manual ? '合計を直接入力中（項目を編集すると自動合計に戻ります）' : '展開項目の合計（直接入力で上書き可）'}</span>
    </div>`;
  }

  const CAPEX_PH = 'お見積りの金額を入力';

  function renderInputs() {
    const light = state.mode !== 'detail';
    const d = state.detail;
    let h = '';
    // 1. 人件費
    if (light) {
      h += fSlider({ path: 'base.laborCostPerPerson', label: '1人あたり年間人件費＋管理費', unit: '万円/年', min: 300, max: 1500, step: 10 });
    } else {
      h += `<fieldset class="group"><legend>1人あたり年間人件費＋管理費</legend>
        ${fRow({ path: 'detail.wage.base', label: '直接人件費（年）', unit: '万円', group: 'labor', step: 10 })}
        ${fRow({ path: 'detail.wage.overheadRate', label: '法定福利・管理費率', unit: '%', group: 'labor', step: 1 })}
        ${fRow({ path: 'detail.wage.overtimeHours', label: '年間残業時間/人', unit: 'h', group: 'labor', step: 10 })}
        ${fRow({ path: 'detail.wage.overtimeRate', label: '残業単価', unit: '円/h', group: 'labor', step: 100 })}
        ${fRow({ path: 'detail.wage.hiringTraining', label: '採用・教育費（年・1人あたり）', unit: '万円', group: 'labor', step: 10 })}
        ${fTotalEditable({ key: 'labor', label: '合計', unit: '万円/年', derived: C.laborCostFromWage(d.wage) })}
        <div class="ref" data-derived="hourly"></div>
      </fieldset>`;
    }
    // 2. 直数
    h += fButtons({ path: 'base.shifts', label: '直数', unit: '直', options: [1, 2, 3] });
    // 3. 省人化人数
    h += fSlider({ path: 'base.personsPerShift', label: '1直あたり省人化（再配置）人数', unit: '人', min: 0.5, max: 3, step: 0.5 });
    if (!light) {
      h += `<fieldset class="group"><legend>稼働（実効人数の補正）</legend>
        ${fRow({ path: 'detail.ops.stationsPerRobot', label: '1台が担当するステーション数', unit: '箇所', step: 1 })}
        ${fRow({ path: 'detail.ops.availability', label: '目標可動率', unit: '%', step: 1 })}
        ${fRow({ path: 'detail.ops.workingDays', label: '年間稼働日（参考）', unit: '日', step: 1 })}
        ${fRow({ path: 'detail.ops.hoursPerShift', label: '1直あたり時間（参考）', unit: 'h', step: 0.5 })}
        ${fTotal({ key: 'effPersons', label: '実効 省人化（再配置）人数 /直', unit: '人' })}
        <div class="ref">実効人数 = 人数 × ステーション数 × 可動率。稼働日・時間は時間単価の参考表示にのみ使用します。</div>
      </fieldset>`;
    }
    // 4. 上昇率
    h += fSlider({ path: 'base.wageGrowth', label: '人件費上昇率', unit: '%/年', min: 0, max: 10, step: 0.5, nstep: 0.1 });
    // 5. 初期投資
    h += `<fieldset class="group"><legend>初期投資</legend>
      ${capexHead()}
      ${fCapexRow({ path: 'base.capex.robot', qtyPath: 'base.capexQty.robot', label: '機体', unit: '台', placeholder: '単価' })}
      ${fCapexRow({ path: 'base.capex.camera', qtyPath: 'base.capexQty.camera', label: 'カメラ・ビジョン', unit: '台', placeholder: '単価' })}
      ${fCapexRow({ path: 'base.capex.endEffector', qtyPath: 'base.capexQty.endEffector', label: 'エンドエフェクタ', unit: '個', placeholder: '単価' })}`;
    if (light) {
      h += fCapexRow({ path: 'base.capex.integration', qtyPath: 'base.capexQty.integration', label: '導入・周辺費用（SI・安全対策・レイアウト）', unit: '式', placeholder: '金額' });
    } else {
      h += `${fCapexRow({ path: 'detail.capex.si', qtyPath: 'detail.capexQty.si', label: 'SI・ティーチング', unit: '式', placeholder: '金額', group: 'integration' })}
        ${fCapexRow({ path: 'detail.capex.safety', qtyPath: 'detail.capexQty.safety', label: '安全対策・柵', unit: '式', placeholder: '金額', group: 'integration' })}
        ${fCapexRow({ path: 'detail.capex.layout', qtyPath: 'detail.capexQty.layout', label: 'レイアウト変更', unit: '式', placeholder: '金額', group: 'integration' })}
        ${fCapexRow({ path: 'detail.capex.training', qtyPath: 'detail.capexQty.training', label: '教育', unit: '式', placeholder: '金額', group: 'integration' })}
        ${fCapexRow({ path: 'detail.capex.spares', qtyPath: 'detail.capexQty.spares', label: '予備品', unit: '式', placeholder: '金額', group: 'integration' })}
        ${fTotalEditable({ key: 'integration', label: '導入・周辺費用 合計', unit: '万円', derived: C.sumAmounts(d.capex, d.capexQty) })}`;
    }
    h += `${fTotal({ key: 'capexTotal', label: '初期投資 合計', unit: '万円' })}
      <div class="ref">お見積書の金額をそのまま転記してください。</div>
    </fieldset>`;
    // 6. ランニング
    if (light) {
      h += `<div class="field"><label>年間ランニング費（保守・ソフトライセンス）</label>
        <div class="ctl"><input type="number" data-path="base.opexAnnual" min="0" step="10" value="${attrVal(state.base.opexAnnual)}"
          placeholder="お見積りの金額を入力" class="${C.isInvalid(state.base.opexAnnual) ? 'warn' : ''}" aria-label="年間ランニング費"><span class="unit">万円/年</span></div></div>`;
    } else {
      h += `<fieldset class="group"><legend>年間ランニング費</legend>
        ${fRow({ path: 'detail.opex.maintenance', label: '保守契約', unit: '万円/年', placeholder: CAPEX_PH, group: 'opex', step: 10 })}
        ${fRow({ path: 'detail.opex.software', label: 'フリート管理・ソフトライセンス', unit: '万円/年', placeholder: CAPEX_PH, group: 'opex', step: 10 })}
        ${fRow({ path: 'detail.opex.power', label: '電力', unit: '万円/年', placeholder: '', group: 'opex', step: 1 })}
        ${fRow({ path: 'detail.opex.consumables', label: '消耗品', unit: '万円/年', placeholder: '', group: 'opex', step: 1 })}
        ${fTotalEditable({ key: 'opex', label: '合計', unit: '万円/年', derived: C.sumItems(d.opex) })}
      </fieldset>`;
    }
    // 7. 評価期間
    h += fButtons({ path: 'base.years', label: '評価期間', unit: '年', options: [3, 5, 7] });
    // 精緻のみ：付加効果・財務
    if (!light) {
      h += `<fieldset class="group"><legend>付加効果（任意）</legend>
        ${fRow({ path: 'detail.extra.qualitySaving', label: '不良低減による年間削減額', unit: '万円/年', step: 10 })}
        ${fRow({ path: 'detail.extra.downtimeSaving', label: 'ラインストップ低減による年間削減額', unit: '万円/年', step: 10 })}
        <div class="ref">年間省人効果に加算します（人件費上昇率は適用しません）。</div>
      </fieldset>
      <fieldset class="group"><legend>財務（任意）</legend>
        <label class="check"><input type="checkbox" data-path="detail.fin.enableNPV" ${d.fin.enableNPV ? 'checked' : ''}> NPV（正味現在価値）を表示</label>
        ${fRow({ path: 'detail.fin.discountRate', label: '割引率', unit: '%', step: 0.5 })}
        ${fRow({ path: 'detail.fin.depreciationYears', label: '減価償却年数（参考表示のみ）', unit: '年', step: 1 })}
      </fieldset>`;
    }
    $('#inputs').innerHTML = h;
  }

  // ============ 派生表示の更新 ============
  function updateDerived(p, r) {
    const set = (key, txt) => $$(`[data-derived="${key}"]`).forEach(el => { el.textContent = txt; });
    set('capexTotal', C.fmtMan(p.capexTotal));
    $$('[data-amount]').forEach(el => {
      const path = el.dataset.amount;
      const q = getPath(state, path.replace('.capex.', '.capexQty.'));
      el.innerHTML = `${C.fmtMan(C.amount(getPath(state, path), q))}<small> 万円</small>`;
    });
    set('effPersons', C.fmtDec(p.effectivePersonsPerShift, 3));
    if (p.hourlyRate !== null) set('hourly', `参考：時間あたり人件費 ≈ ${Math.round(p.hourlyRate).toLocaleString('ja-JP')} 円/h（${C.fmtMan(p.laborCostPerPerson)}万円 ÷ 稼働日 × 1直時間）。減価償却年数 ${C.num(state.detail.fin.depreciationYears)} 年（参考）。`);
    // 合計欄（自動算出中のもののみ表示更新）
    $$('[data-total]').forEach(inp => {
      const key = inp.dataset.total;
      const ov = state.detail.override[key];
      const manual = !C.isBlank(ov);
      inp.classList.toggle('manual', manual);
      inp.classList.toggle('derived', !manual);
      if (!manual && document.activeElement !== inp) inp.value = C.fmtDec(p.derived[key], 2);
      const note = $(`[data-note="${key}"]`);
      if (note) note.textContent = manual ? '合計を直接入力中（項目を編集すると自動合計に戻ります）' : '展開項目の合計（直接入力で上書き可）';
    });
  }

  // ============ 結果：メーター ============
  function polar(cx, cy, r, deg) { const a = deg * Math.PI / 180; return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) }; }
  function arcPath(cx, cy, r, fromV, toV, max) {
    const a1 = 180 - 180 * Math.max(0, Math.min(max, fromV)) / max;
    const a2 = 180 - 180 * Math.max(0, Math.min(max, toV)) / max;
    if (Math.abs(a1 - a2) < 0.01) return '';
    const p1 = polar(cx, cy, r, a1), p2 = polar(cx, cy, r, a2);
    return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 0 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  function renderGauge(p, r) {
    const el = $('#gauge');
    if (r.error === 'NO_CAPEX') {
      el.innerHTML = `<div class="placeholder"><b>初期投資を入力してください</b><div class="tip">お見積書の金額を4欄に転記してください。<br>入力と同時に投資回収年数が表示されます。</div></div>`;
      return;
    }
    const max = r.years, t = state.thresholds;
    const g = Math.min(C.num(t.green), max), y = Math.min(Math.max(C.num(t.yellow), g), max);
    const cx = 150, cy = 150, R = 118, W = 22;
    const pb = r.paybackYears;
    const color = C.paybackColor(pb, t);
    const colHex = { green: COLORS.accent, yellow: COLORS.yellow, grey: COLORS.grey }[color];
    const needleV = pb === null ? max : Math.min(pb, max);
    const na = 180 - 180 * needleV / max;
    const tip = polar(cx, cy, R - W / 2 - 6, na), base1 = polar(cx, cy, 14, na + 90), base2 = polar(cx, cy, 14, na - 90);
    const ticks = [];
    for (let i = 0; i <= max; i++) {
      const a = 180 - 180 * i / max; const o = polar(cx, cy, R + 16, a);
      ticks.push(`<text x="${o.x.toFixed(1)}" y="${(o.y + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="${COLORS.muted}">${i}</text>`);
    }
    const status = pb === null
      ? `評価期間 ${max} 年以内に回収しません`
      : (color === 'green' ? `稟議基準（緑 ≤ ${C.fmtDec(t.green, 1)} 年）を満たします`
        : color === 'yellow' ? `黄（≤ ${C.fmtDec(t.yellow, 1)} 年）の範囲です`
          : `回収まで ${C.fmtDec(t.yellow, 1)} 年超`);
    el.innerHTML = `<div class="gauge">
      <svg viewBox="0 0 300 175" role="img" aria-label="投資回収年数メーター">
        <path d="${arcPath(cx, cy, R, 0, max, max)}" fill="none" stroke="${COLORS.track}" stroke-width="${W}" />
        <path d="${arcPath(cx, cy, R, 0, g, max)}" fill="none" stroke="${COLORS.accent}" stroke-width="${W}" />
        <path d="${arcPath(cx, cy, R, g, y, max)}" fill="none" stroke="${COLORS.yellow}" stroke-width="${W}" />
        <path d="${arcPath(cx, cy, R, y, max, max)}" fill="none" stroke="${COLORS.grey}" stroke-width="${W}" />
        ${ticks.join('')}
        <polygon points="${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${base1.x.toFixed(1)},${base1.y.toFixed(1)} ${base2.x.toFixed(1)},${base2.y.toFixed(1)}" fill="${COLORS.text}" />
        <circle cx="${cx}" cy="${cy}" r="9" fill="${COLORS.bg}" stroke="${COLORS.text}" stroke-width="3" />
        <text x="${cx}" y="${cy + 22}" text-anchor="middle" font-size="11" fill="${COLORS.muted}">投資回収年数（年）</text>
      </svg>
      <div class="big" style="color:${pb === null ? COLORS.grey : colHex}">${pb === null ? '—' : C.fmtYears(pb)}<small>年</small></div>
      <div class="status">${status}</div>
      <div class="legend"><span><i style="background:${COLORS.accent}"></i>≤${C.fmtDec(t.green, 1)}年</span><span><i style="background:${COLORS.yellow}"></i>≤${C.fmtDec(t.yellow, 1)}年</span><span><i style="background:${COLORS.grey}"></i>それ以上</span></div>
    </div>`;
  }

  // ============ 結果：KPI ============
  function renderKpis(p, r) {
    const el = $('#kpis');
    const disabled = r.error === 'NO_CAPEX';
    const kp = (k, v, unit, cls, sub) => `<div class="kpi ${cls || ''}"><div class="k">${k}</div><div class="v">${v}<small>${unit}</small></div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
    let h = '';
    h += kp('初年度 年間省人効果', C.fmtMan(r.annualSaving0), '万円/年', 'accent',
      `${C.fmtMan(p.laborCostPerPerson)}万円 × ${p.shifts}直 × ${C.fmtDec(p.effectivePersonsPerShift, 3)}人` + (r.extraAnnual > 0 ? `　＋付加効果 ${C.fmtMan(r.extraAnnual)}万円/年` : ''));
    h += kp(`${r.years}年累積効果`, disabled ? '—' : C.fmtMan(r.cumFinal), '万円', disabled ? 'muted' : (r.cumFinal < 0 ? 'neg' : ''), disabled ? '初期投資の入力後に表示' : `初期投資・ランニング費を差し引いた累積キャッシュフロー`);
    h += kp('初期投資 合計', C.fmtMan(p.capexTotal), '万円', 'muted', `機体 ${C.fmtMan(p.capex.robot)} / カメラ ${C.fmtMan(p.capex.camera)} / EE ${C.fmtMan(p.capex.endEffector)} / 導入・周辺 ${C.fmtMan(p.capex.integration)}`);
    h += kp('年間ランニング費', C.fmtMan(p.opexAnnual), '万円/年', 'muted', `人件費上昇率 ${C.fmtDec(p.wageGrowth, 1)}%/年・評価期間 ${r.years}年`);
    if (r.npv !== null && r.npv !== undefined) {
      h += kp(`NPV（割引率 ${C.fmtDec(p.discountRate, 1)}%）`, C.fmtMan(r.npv), '万円', r.npv < 0 ? 'neg' : 'accent', `${r.years}年間の純効果を現在価値に換算し初期投資を差し引いた額`);
    }
    el.innerHTML = h;
  }

  // ============ 結果：累積CF棒グラフ ============
  function renderChart(p, r) {
    const el = $('#chart');
    const A = state.scenarios.A, B = state.scenarios.B;
    const both = !!(A && B && !A.result.error && !B.result.error);
    let series;
    if (both) {
      series = [{ name: `A：${A.name || '無題'}`, color: COLORS.primary, cum: A.series.map(s => s.cum), pb: A.result.paybackYears },
      { name: `B：${B.name || '無題'}`, color: COLORS.accent, cum: B.series.map(s => s.cum), pb: B.result.paybackYears }];
    } else {
      if (r.error === 'NO_CAPEX') { el.innerHTML = ''; return; }
      series = [{ name: '現在の入力', color: COLORS.primary, cum: r.series.map(s => s.cum), pb: r.paybackYears }];
    }
    const N = Math.max(...series.map(s => s.cum.length - 1));
    const W = 640, H = 260, mL = 70, mR = 16, mT = 18, mB = 34;
    const iw = W - mL - mR, ih = H - mT - mB;
    let vmin = 0, vmax = 0;
    series.forEach(s => s.cum.forEach(v => { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }));
    if (vmax === vmin) vmax = vmin + 1;
    const pad = (vmax - vmin) * 0.12; vmax += pad; vmin -= pad;
    const yOf = v => mT + (vmax - v) / (vmax - vmin) * ih;
    const groupW = iw / (N + 1);
    const barW = Math.min(46, groupW * (both ? 0.36 : 0.6));
    const xOf = (i, k) => mL + groupW * i + groupW / 2 + (both ? (k === 0 ? -barW / 2 - 2 : barW / 2 + 2) : 0);
    // y 目盛
    const step = niceStep((vmax - vmin) / 5);
    let g = '';
    for (let v = Math.ceil(vmin / step) * step; v <= vmax; v += step) {
      const y = yOf(v);
      g += `<line x1="${mL}" x2="${W - mR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${v === 0 ? COLORS.text : COLORS.track}" stroke-width="${v === 0 ? 1.2 : 1}" />
            <text x="${mL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${COLORS.muted}">${C.fmtMan(v)}</text>`;
    }
    let bars = '';
    series.forEach((s, k) => {
      s.cum.forEach((v, i) => {
        const x = xOf(i, k) - barW / 2, y0 = yOf(0), y1 = yOf(v);
        const top = Math.min(y0, y1), hgt = Math.max(1, Math.abs(y1 - y0));
        bars += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${hgt.toFixed(1)}" rx="3" fill="${s.color}" fill-opacity="${v < 0 ? 0.45 : 1}" />`;
        if (!both) {
          const ly = v >= 0 ? top - 5 : top + hgt + 12;
          bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="10.5" fill="${v < 0 ? COLORS.muted : COLORS.text}">${C.fmtMan(v)}</text>`;
        }
      });
      if (s.pb !== null && s.pb !== undefined) {
        const px = mL + groupW * s.pb + groupW / 2;
        bars += `<line x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${mT}" y2="${mT + ih}" stroke="${s.color}" stroke-width="1.5" stroke-dasharray="4 3" />
                 <text x="${(px + 4).toFixed(1)}" y="${mT + 10}" font-size="10.5" fill="${s.color}">回収 ${C.fmtYears(s.pb)} 年</text>`;
      }
    });
    let xl = '';
    for (let i = 0; i <= N; i++) xl += `<text x="${(mL + groupW * i + groupW / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="${COLORS.muted}">${i === 0 ? '導入時' : i + '年目'}</text>`;
    el.innerHTML = `<div class="chart-title"><span>累積キャッシュフロー（万円）</span>
        <span class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="累積キャッシュフロー棒グラフ">${g}${bars}${xl}</svg>`;
  }
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }

  // ============ 結果：シナリオ比較 ============
  function renderCompare() {
    const el = $('#compare');
    const A = state.scenarios.A, B = state.scenarios.B;
    const cell = (s, f, cls) => s ? `<td class="${cls || ''}">${f(s)}</td>` : '<td class="empty">未保存</td>';
    const pbTxt = s => s.result.error ? '—' : (s.result.paybackYears === null ? '未回収' : `${C.fmtYears(s.result.paybackYears)} 年`);
    const rows = [
      ['1人あたり年間人件費＋管理費', s => `${C.fmtMan(s.inputs.laborCostPerPerson)} 万円/年`],
      ['直数', s => `${s.inputs.shifts} 直`],
      ['1直あたり省人化（再配置）人数', s => `${C.fmtDec(s.inputs.effectivePersonsPerShift, 3)} 人`],
      ['初期投資 合計', s => `${C.fmtMan(s.inputs.capexTotal)} 万円`],
      ['投資回収年数', pbTxt, true],
      ['累積効果', s => `${C.fmtMan(s.result.cumFinal)} 万円（${s.inputs.years}年）`, true]
    ];
    el.innerHTML = `<div class="compare-head">
        <h3>シナリオ A/B 比較</h3>
        <button type="button" class="btn sm" id="saveA">現在の入力をシナリオAに保存</button>
        <button type="button" class="btn accent sm" id="saveB">Bに保存</button>
        <button type="button" class="btn ghost sm" id="clearAB" ${A || B ? '' : 'disabled'}>クリア</button>
      </div>
      <table class="compare">
        <thead><tr><th>項目</th><th class="a">シナリオA${A ? `：${esc(A.name || '無題')}` : ''}</th><th class="b">シナリオB${B ? `：${esc(B.name || '無題')}` : ''}</th></tr></thead>
        <tbody>${rows.map(r => `<tr class="${r[2] ? 'hl' : ''}"><td>${r[0]}</td>${cell(A, r[1])}${cell(B, r[1])}</tr>`).join('')}</tbody>
      </table>`;
    $('#saveA').onclick = () => saveScenario('A');
    $('#saveB').onclick = () => saveScenario('B');
    $('#clearAB').onclick = () => { state.scenarios = { A: null, B: null }; schedule(); toast('シナリオA/Bをクリアしました'); };
  }
  // 利用計測(../../assets/track.js)。単体配布で track.js が無ければ何もしない
  function track(ev, title) { try { if (window.lxTrack) window.lxTrack('tool/roi/' + ev, title); } catch (e) { /* 計測は任意 */ } }

  function saveScenario(key) {
    const p = C.resolveInputs(state), r = C.compute(p);
    if (r.error) { toast('初期投資を入力してから保存してください'); return; }
    state.scenarios[key] = C.snapshot(state, p, r);
    schedule();
    toast(`シナリオ${key}に保存しました`);
    track('scenario_save', 'シナリオ保存');
  }

  // ============ 印刷用入力サマリー ============
  function renderPrintSummary(p) {
    const rows = CSV.inputRows(state, p);
    const cols = rows.length > 20 ? 3 : 2;
    const per = Math.ceil(rows.length / cols);
    const tbl = rs => `<table>${rs.map(r => `<tr><td>${esc(r[0])}</td><td class="v">${esc(r[1])} ${esc(r[2])}</td></tr>`).join('')}</table>`;
    const parts = []; for (let i = 0; i < cols; i++) parts.push(tbl(rows.slice(i * per, (i + 1) * per)));
    $('#printSummary').innerHTML = `<h2>入力サマリー（${p.mode === 'detail' ? '精緻' : 'ライト'}モード${state.scenarioName ? '・' + esc(state.scenarioName) : ''}）</h2>
      <div class="cols ${cols === 3 ? 'three' : ''}">${parts.join('')}</div>`;
    $('#scnLabel').dataset.print = state.scenarioName ? `：${state.scenarioName}` : '：（無題）';
  }

  // ============ 再計算・再描画（rAFでスロットル） ============
  let raf = 0;
  function schedule() {
    if (raf) return;
    const tick = () => { raf = 0; render(); };
    // 非表示タブでは rAF が止まるため setTimeout に切り替える
    raf = document.hidden ? setTimeout(tick, 16) : requestAnimationFrame(tick);
  }
  function render() {
    const p = C.resolveInputs(state), r = C.compute(p);
    updateDerived(p, r);
    renderGauge(p, r);
    renderKpis(p, r);
    renderChart(p, r);
    renderCompare();
    renderPrintSummary(p);
    renderScene(p, r);
    writeHash();
  }

  // ============ 工場タイクーン 3D（結果パネル最上段） ============
  let scene = null;
  function renderScene(p, r) {
    if (!window.LXSCENE) return;
    if (!scene) {
      scene = LXSCENE.create($('#sceneCanvas'), {
        onView: v => {
          $$('#viewToggle button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
          $('#sceneCaption').textContent = v === 'before' ? 'Before：現状（手作業）' : 'After：LexxMoMa 導入後';
        },
        onEvent: (ev, count) => {
          $$('.ev-btn').forEach(b => { b.disabled = !!ev; b.classList.toggle('active', !!ev && ev.type === b.dataset.ev); });
          $('#evCount').textContent = ev && ev.type === 'medic' ? '救急搬送中…' : `イベント ${Math.min(count, 3)}/3`;
        }
      });
      $('#evCount').textContent = 'イベント 0/3';
    }
    const m = scene.update(p, r, state);
    $('#viewToggle button[data-view="after"]').disabled = !m.robot;
    $('#viewToggle button[data-view="after"]').title = m.robot ? '' : '「機体」に金額を入れると After が見られます';
  }
  function bindScene() {
    $$('#viewToggle button').forEach(b => b.addEventListener('click', () => { if (scene && !b.disabled) scene.setView(b.dataset.view); }));
    $('#scenePlay').addEventListener('click', () => {
      if (!scene) return;
      const running = scene.toggle();
      $('#scenePlay').textContent = running ? '⏸ 一時停止' : '▶ 再生';
      $('#scenePlay').setAttribute('aria-pressed', String(running));
    });
    $('#sceneReset').addEventListener('click', () => { if (scene) scene.resetCamera(); });
    $$('.ev-btn').forEach(b => b.addEventListener('click', () => {
      if (!scene) return;
      if (!scene.running) { scene.toggle(); $('#scenePlay').textContent = '⏸ 一時停止'; $('#scenePlay').setAttribute('aria-pressed', 'true'); }
      scene.trigger(b.dataset.ev);
    }));
  }
  function applyLayout() {
    const w = Math.max(360, Math.min(900, C.num(state.ui.inputWidth) || 470));
    document.documentElement.style.setProperty('--inputs-w', w + 'px');
  }
  function bindLayout() {
    const sp = $('#splitter');
    sp.addEventListener('pointerdown', e => {
      e.preventDefault();
      sp.classList.add('drag'); sp.setPointerCapture(e.pointerId);
      const startX = e.clientX, startW = C.num(state.ui.inputWidth) || 470;
      const move = ev => { state.ui.inputWidth = Math.round(startW + (ev.clientX - startX)); applyLayout(); };
      const up = ev => { sp.classList.remove('drag'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); writeHash(); };
      sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up);
    });
    sp.addEventListener('dblclick', () => { state.ui.inputWidth = 470; applyLayout(); writeHash(); });
  }

  // ============ モード切替（値は失わない） ============
  function switchMode(mode) {
    if (mode === state.mode) return;
    track('mode/' + mode, mode === 'detail' ? '精緻モードに切替' : 'ライトモードに切替');
    const p = C.resolveInputs(state);
    const d = state.detail, b = state.base;
    if (mode === 'detail') {
      // ライト → 精緻：ライト値を合計欄に直接持つ（展開項目は按分しない）。展開項目の合計と一致すれば自動算出に戻す
      const setOv = (key, raw) => {
        if (C.isBlank(raw)) { d.override[key] = null; return; }
        d.override[key] = Math.abs(C.num(raw) - p.derived[key]) < 1e-9 ? null : raw;
      };
      setOv('labor', b.laborCostPerPerson);
      setOv('integration', b.capex.integration);
      setOv('opex', b.opexAnnual);
    } else {
      // 精緻 → ライト：合計値を書き戻す
      b.laborCostPerPerson = round2(p.laborCostPerPerson);
      b.capex.integration = (p.capex.integration === 0 && C.allBlank(d.capex) && C.isBlank(d.override.integration)) ? '' : round2(p.capex.integration);
      b.opexAnnual = (p.opexAnnual === 0 && C.allBlank(d.opex) && C.isBlank(d.override.opex)) ? '' : round2(p.opexAnnual);
    }
    state.mode = mode;
    $$('.mode-toggle button').forEach(x => x.classList.toggle('on', x.dataset.mode === mode));
    renderInputs();
    render();
  }
  function round2(x) { return Math.round(x * 100) / 100; }

  // ============ イベント ============
  function bindEvents() {
    const inputs = $('#inputs');
    inputs.addEventListener('input', e => {
      const el = e.target; const path = el.dataset.path; if (!path) return;
      if (el.type === 'checkbox') { setPath(state, path, el.checked); renderInputs(); schedule(); return; }
      const raw = el.value;
      setPath(state, path, storeValue(raw));
      el.classList.toggle('warn', C.isInvalid(raw));
      // スライダー⇄数値の同期
      $$(`[data-path="${path}"]`, inputs).forEach(o => {
        if (o === el) return;
        if (o.type === 'range') o.value = C.num(raw); else o.value = raw;
        o.classList.toggle('warn', C.isInvalid(raw));
      });
      if (el.dataset.group) state.detail.override[el.dataset.group] = null;   // 展開項目を触ったら自動合計に戻す
      if (el.dataset.total && raw === '') state.detail.override[el.dataset.total] = null;
      schedule();
    });
    inputs.addEventListener('click', e => {
      const btn = e.target.closest('.btn-group button'); if (!btn) return;
      const grp = btn.parentElement; const path = grp.dataset.path;
      setPath(state, path, Number(btn.dataset.value));
      $$('button', grp).forEach(x => x.classList.toggle('on', x === btn));
      schedule();
    });
    $$('.mode-toggle button').forEach(b => b.addEventListener('click', () => switchMode(b.dataset.mode)));
    $('#scenarioName').addEventListener('input', e => { state.scenarioName = e.target.value; schedule(); });

    // アクション
    $('#btnCsv').addEventListener('click', () => {
      const p = C.resolveInputs(state), r = C.compute(p); const now = new Date();
      CSV.download(CSV.buildCsv({ state, params: p, result: r, now }), CSV.fileName(state.scenarioName, now));
      toast('CSVをダウンロードしました');
      track('csv', 'CSVダウンロード');
    });
    $('#btnSummary').addEventListener('click', async () => {
      const p = C.resolveInputs(state), r = C.compute(p);
      if (r.error) { toast('初期投資を入力してください'); return; }
      const ok = await copyText(C.summaryText(p, r));
      toast(ok ? 'サマリー文をコピーしました' : 'コピーできませんでした');
      track('summary', 'サマリー文コピー');
    });
    $('#btnPrint').addEventListener('click', () => { track('print', '印刷'); render(); window.print(); });
    $('#btnUrl').addEventListener('click', async () => {
      writeHash();
      const ok = await copyText(location.href);
      toast(ok ? 'URLをコピーしました（入力・シナリオA/B・しきい値を含みます）' : 'コピーできませんでした');
      track('share_url', 'URLコピー');
    });
    $('#btnReset').addEventListener('click', () => {
      if (!confirm('入力を初期値に戻します。シナリオA/Bも消えます。よろしいですか？')) return;
      state = C.defaultState();
      $('#scenarioName').value = '';
      $$('.mode-toggle button').forEach(x => x.classList.toggle('on', x.dataset.mode === 'light'));
      renderInputs(); applyLayout(); render();
    });

    // しきい値ダイアログ
    const dlg = $('#dlgThreshold');
    $('#btnGear').addEventListener('click', () => {
      $('#thGreen').value = state.thresholds.green; $('#thYellow').value = state.thresholds.yellow;
      dlg.showModal();
    });
    const onTh = () => {
      state.thresholds.green = storeValue($('#thGreen').value);
      state.thresholds.yellow = storeValue($('#thYellow').value);
      schedule();
    };
    $('#thGreen').addEventListener('input', onTh);
    $('#thYellow').addEventListener('input', onTh);
    $('#thDefault').addEventListener('click', () => { state.thresholds = C.deepClone(C.DEFAULT_STATE.thresholds); $('#thGreen').value = 2; $('#thYellow').value = 3; schedule(); });
    $('#thClose').addEventListener('click', () => dlg.close());

    window.addEventListener('hashchange', () => {
      const cur = '#' + encodeState(state);
      if (location.hash === cur) return;
      loadFromHash(); syncHeader(); renderInputs(); applyLayout(); render();
    });
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext !== false) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
  }
  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function syncHeader() {
    $('#scenarioName').value = state.scenarioName || '';
    $$('.mode-toggle button').forEach(x => x.classList.toggle('on', x.dataset.mode === state.mode));
  }

  // ============ 起動 ============
  loadFromHash();
  syncHeader();
  renderInputs();
  bindEvents();
  bindLayout();
  bindScene();
  applyLayout();
  render();

  // テーマ切替: 色を読み直して再描画。印刷(A4)は常に light で出す
  document.addEventListener('lx-theme', () => { readThemeColors(); render(); });
  let printTheme = null;
  window.addEventListener('beforeprint', () => {
    printTheme = document.documentElement.getAttribute('data-theme');
    if (printTheme === 'dark') { document.documentElement.setAttribute('data-theme', 'light'); readThemeColors(); render(); }
  });
  window.addEventListener('afterprint', () => {
    if (printTheme === 'dark') { document.documentElement.setAttribute('data-theme', 'dark'); readThemeColors(); render(); }
    printTheme = null;
  });

  // デバッグ・テスト用（計算はすべて LXCALC 側）
  window.LXROI = { getState: () => state, setState: s => { state = C.mergeState(C.defaultState(), s); syncHeader(); renderInputs(); applyLayout(); render(); }, render, scene: () => scene };
})();
