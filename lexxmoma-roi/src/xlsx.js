/* LexxMoMa 費用対効果 簡易計算ツール — xlsx.js
 * Excel 入力シート（.xlsx）の生成と読み込み。外部ライブラリなし・DOM非依存。
 * - 生成：入力欄（黄色）＋ Excel の数式で計算結果・年次表を出す1シート。ZIP は無圧縮（STORE）で自作
 * - 読込：Excel で保存し直したファイル（deflate 圧縮）は DecompressionStream('deflate-raw') で展開し、
 *         キー列（E列・非表示）で LXCSV.importState に渡す */
(function (root, factory) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./calc.js') : root.LXCALC, isNode ? require('./csv.js') : root.LXCSV);
  if (isNode) module.exports = api;
  root.LXXLSX = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C, CSV) {
  'use strict';

  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const SHEET_NAME = '入力・計算';
  const SHEET2_NAME = 'シナリオ比較';

  // ============ ZIP（書き込み：STORE / 読み込み：STORE・DEFLATE） ============
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  function zipStore(files) {          // files: [{ name, data(string) }]
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
    files.forEach(f => {
      const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, DOS_TIME, true); lh.setUint16(12, DOS_DATE, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, DOS_TIME, true); ch.setUint16(14, DOS_DATE, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0; all.forEach(b => { out.set(b, p); p += b.length; });
    return out;
  }

  async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('このブラウザは Excel ファイルの読み込みに対応していません（Edge / Chrome の最新版をお使いください）');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  /** ZIP → { 'パス': Uint8Array } */
  async function unzip(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Excel ファイル（.xlsx）として読めませんでした');
    const count = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const dec = new TextDecoder();
    const out = {};
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const raw = u8.subarray(start, start + csize);
      if (method === 0) out[name] = raw;
      else if (method === 8) out[name] = await inflateRaw(raw);
      p += 46 + nlen + xlen + clen;
    }
    return out;
  }

  // ============ シート組み立て ============
  function xmlEsc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function colLetter(i) { return String.fromCharCode(65 + i); }   // 0→A（A〜M しか使わない）

  // スタイル番号（styles.xml の cellXfs の並びと一致させる）
  const S = { title: 1, note: 2, head: 3, group: 4, label: 5, inNum: 6, inText: 7, unit: 8, resTitle: 9, big: 10, man: 11, thead: 12, tman: 13, tyear: 14, dec: 15, msg: 16, labelSub: 17, pct: 18, footer: 19, resLabel: 20, int: 21, stamp: 22 };
  const PRIMARY = 'FF0068B7';
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0;[Red]-#,##0"/><numFmt numFmtId="165" formatCode="0.0"/><numFmt numFmtId="166" formatCode="0.0##"/><numFmt numFmtId="167" formatCode="0.0#"/></numFmts>
<fonts count="7">
<font><sz val="10"/><name val="Meiryo UI"/><family val="3"/><charset val="128"/></font>
<font><b/><sz val="15"/><color rgb="${PRIMARY}"/><name val="Meiryo UI"/><family val="3"/><charset val="128"/></font>
<font><sz val="9"/><color rgb="FF5F6B7A"/><name val="Meiryo UI"/><family val="3"/><charset val="128"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Meiryo UI"/><family val="3"/><charset val="128"/></font>
<font><b/><sz val="10"/><color rgb="${PRIMARY}"/><name val="Meiryo UI"/><family val="3"/><charset val="128"/></font>
<font><b/><sz val="18"/><name val="Meiryo UI"/><family val="3"/><charset val="128"/></font>
<font><b/><sz val="10"/><name val="Meiryo UI"/><family val="3"/><charset val="128"/></font>
</fonts>
<fills count="6">
<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="${PRIMARY}"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE6F0F8"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF4CC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF4F6F8"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD9DEE3"/></left><right style="thin"><color rgb="FFD9DEE3"/></right><top style="thin"><color rgb="FFD9DEE3"/></top><bottom style="thin"><color rgb="FFD9DEE3"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="23">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="6" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyProtection="1"><alignment vertical="center"/><protection locked="0"/></xf>
<xf numFmtId="49" fontId="6" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyProtection="1"><alignment horizontal="left" vertical="center"/><protection locked="0"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="165" fontId="5" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="164" fontId="6" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="6" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="166" fontId="6" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="167" fontId="6" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="1" fontId="6" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="標準" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="2">
<dxf><font><color rgb="FF1E7B45"/></font><fill><patternFill patternType="solid"><bgColor rgb="FFDDF2E5"/></patternFill></fill></dxf>
<dxf><font><color rgb="FF8A6500"/></font><fill><patternFill patternType="solid"><bgColor rgb="FFFFF1C2"/></patternFill></fill></dxf>
</dxfs>
</styleSheet>`;

  // 入力欄のグループ（シート上の並び）。キーのメタ情報は LXCSV.FIELDS を正とする
  const GROUPS = [
    ['基本', ['mode', 'scenarioName']],
    ['人件費', ['base.laborCostPerPerson', 'detail.wage.base', 'detail.wage.overheadRate', 'detail.wage.overtimeHours', 'detail.wage.overtimeRate',
      'detail.wage.hiringTraining', 'detail.override.labor', 'base.wageGrowth']],
    ['体制・稼働', ['base.shifts', 'base.personsPerShift', 'detail.ops.stationsPerRobot', 'detail.ops.availability', 'detail.ops.workingDays', 'detail.ops.hoursPerShift']],
    ['初期投資（単価 × 数量）', ['base.capex.robot', 'base.capexQty.robot', 'base.capex.camera', 'base.capexQty.camera', 'base.capex.endEffector', 'base.capexQty.endEffector',
      'base.capex.integration', 'base.capexQty.integration',
      'detail.capex.si', 'detail.capexQty.si', 'detail.capex.safety', 'detail.capexQty.safety', 'detail.capex.layout', 'detail.capexQty.layout',
      'detail.capex.training', 'detail.capexQty.training', 'detail.capex.spares', 'detail.capexQty.spares', 'detail.override.integration']],
    ['年間ランニング費', ['base.opexAnnual', 'detail.opex.maintenance', 'detail.opex.software', 'detail.opex.power', 'detail.opex.consumables', 'detail.override.opex']],
    ['評価期間・付加効果', ['base.years', 'detail.extra.qualitySaving', 'detail.extra.downtimeSaving']],
    ['財務（精緻モードのみ・任意）', ['detail.fin.enableNPV', 'detail.fin.discountRate', 'detail.fin.depreciationYears']],
    ['稟議基準（投資回収年数の色分け）', ['thresholds.green', 'thresholds.yellow']]
  ];
  const LISTS = { mode: 'ライト,精緻', 'base.shifts': '1,2,3', 'base.years': '3,5,7', 'detail.fin.enableNPV': 'ON,OFF' };
  const YEARS_MAX = 10;   // 年次表の行数（評価期間は 3/5/7 年から選ぶ）

  function formatInput(v, type) {
    if (type === 'mode') return v === 'detail' ? '精緻' : 'ライト';
    if (type === 'bool') return v ? 'ON' : 'OFF';
    if (v === null || v === undefined) return '';
    return v;
  }

  /** 1シート分のセルを溜める入れ物 */
  function newSheet() {
    const rows = {}, heights = {}, hidden = {}, merges = [];   // rows: 行番号 → { 列番号: xml }
    const put = (r, c, xml) => { (rows[r] = rows[r] || {})[c] = xml; };
    const ref = (c, r) => colLetter(c) + r;
    return {
      heights, hidden, merges,
      str: (c, r, s, st) => put(r, c, `<c r="${ref(c, r)}" s="${st || 0}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(s)}</t></is></c>`),
      numc: (c, r, n, st) => put(r, c, `<c r="${ref(c, r)}" s="${st || 0}"><v>${n}</v></c>`),
      blank: (c, r, st) => put(r, c, `<c r="${ref(c, r)}" s="${st || 0}"/>`),
      fml: (c, r, f, st, isStr) => put(r, c, `<c r="${ref(c, r)}" s="${st || 0}"${isStr ? ' t="str"' : ''}><f>${xmlEsc(f)}</f></c>`),
      xml(o) {                                // o: { cols:[[列番号, 幅, 非表示?]], view, extra, landscape }
        const last = Math.max(0, ...Object.keys(rows).map(Number), ...Object.keys(heights).map(Number));
        let data = '';
        for (let r = 1; r <= last; r++) {
          const cells = rows[r]; if (!cells && !heights[r]) continue;
          const ht = heights[r] ? ` ht="${heights[r]}" customHeight="1"` : '';
          data += `<row r="${r}"${ht}${hidden[r] ? ' hidden="1"' : ''}>` + Object.keys(cells || {}).map(Number).sort((a, b) => a - b).map(c => cells[c]).join('') + '</row>';
        }
        const cols = o.cols.map(([i, w, hid]) => `<col min="${i}" max="${i}" width="${w}" customWidth="1"${hid ? ' hidden="1"' : ''}/>`).join('');
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><tabColor rgb="${PRIMARY}"/></sheetPr>
<sheetViews>${o.view}</sheetViews>
<sheetFormatPr defaultRowHeight="16"/>
<cols>${cols}</cols>
<sheetData>${data}</sheetData>
${merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}
${o.extra || ''}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="${o.landscape ? 'landscape' : 'portrait'}" fitToHeight="0"/>
</worksheet>`;
      }
    };
  }

  /**
   * 状態 → .xlsx（Uint8Array）
   * - シート1「入力・計算」：入力欄＋ Excel の数式による計算結果。シナリオA/Bは非表示行に保存データ（読み込み用）
   * - シート2「シナリオ比較」：A/B が保存されているときだけ（保存時点の値）
   * @param {object} o { now: Date }（出力日時。省略時は表示しない）
   */
  function buildXlsx(state, o) {
    const now = o && o.now;
    const meta = {}; CSV.FIELDS.forEach(f => { meta[f[0]] = { label: f[1], unit: f[2], scope: f[3], type: f[4] }; });
    const sh = newSheet();
    const { str, numc, blank, fml, heights, merges } = sh;
    const validations = [], numericRefs = [];

    // ---- 左：入力（A 項目 / B 値 / C 単位 / D 使うモード / E キー（非表示）） ----
    str(0, 1, 'LexxMoMa 費用対効果（ROI）計算シート', S.title);
    heights[1] = 26;
    if (now) { str(2, 1, '出力 ' + CSV.fmtDateTime(now), S.stamp); merges.push('C1:D1'); }
    str(0, 2, '黄色のセルに入力してください（金額の単位は万円）。「使うモード」がライト／精緻の行は、B4 のモードで計算するときだけ使われます。'
      + 'このファイルは ROI 計算ツールの「Excel読み込み」でそのまま読み込めます（E列のキーは変更しないでください）。', S.note);
    merges.push('A2:D2'); heights[2] = 54;
    const HEAD = 3;
    ['項目', '値', '単位', '使うモード', 'キー'].forEach((h, i) => str(i, HEAD, h, S.head));
    heights[HEAD] = 20;
    const at = {};                           // キー → B列セル（絶対参照）
    let r = HEAD + 1;
    GROUPS.forEach(([title, keys]) => {
      str(0, r, '■ ' + title, S.group); [1, 2, 3].forEach(c => blank(c, r, S.group)); merges.push(`A${r}:D${r}`); r++;
      keys.forEach(key => {
        const m = meta[key]; if (!m) throw new Error('FIELDS に無いキー: ' + key);
        const v = formatInput(key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), state), m.type);
        str(0, r, m.label, m.scope === '精緻' ? S.labelSub : S.label);
        if (m.type === 'mode' || m.type === 'bool' || m.type === 'text') str(1, r, v, S.inText);
        else if (typeof v === 'number') numc(1, r, v, S.inNum);
        else if (v === '') blank(1, r, S.inNum);
        else str(1, r, v, S.inNum);
        str(2, r, m.unit, S.unit); str(3, r, m.scope, S.unit); str(4, r, key, 0);
        at[key] = '$B$' + r;
        if (LISTS[key]) validations.push(`<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="選択してください" error="一覧から選んでください" sqref="B${r}"><formula1>"${LISTS[key]}"</formula1></dataValidation>`);
        else if (!m.type || m.type === 'override') numericRefs.push('B' + r);
        r++;
      });
    });
    // シナリオA/Bの保存データ（非表示行。読み込みで A/B を復元する）
    ['scenarios.A', 'scenarios.B'].forEach(key => {
      const v = key.split('.').reduce((x, k) => (x == null ? undefined : x[k]), state);
      if (!v) return;
      str(0, r, meta[key].label, S.labelSub); str(1, r, JSON.stringify(v), 0); str(4, r, key, 0);
      sh.hidden[r] = true; r++;
    });
    if (numericRefs.length) validations.push(`<dataValidation type="decimal" operator="greaterThanOrEqual" allowBlank="1" showErrorMessage="1" errorStyle="warning" errorTitle="数値を確認してください" error="0以上の数値を入力してください" sqref="${numericRefs.join(' ')}"><formula1>0</formula1></dataValidation>`);

    // ---- 右：計算結果（G 項目 / H 値 / I 単位）と年次表（G〜K、L・M は非表示の補助列） ----
    const n = k => `MAX(0,N(${at[k]}))`;
    const L = `${at.mode}<>"精緻"`;
    const qty = k => `IF(${at[k]}="",1,${n(k)})`;
    const amt = (pre, k) => `${n(`${pre}.capex.${k}`)}*${qty(`${pre}.capexQty.${k}`)}`;
    const ov = (k, auto) => `IF(${at['detail.override.' + k]}="",${auto},${n('detail.override.' + k)})`;
    const G = 6, H = 7, I = 8;
    str(G, 1, '計算結果（Excel で自動計算）', S.title);
    // 計算に使う値（ROI ツールの resolveInputs と同じ規則）
    const V = {};                            // 名前 → H列セル
    let vr = 12;
    str(G, vr - 1, '計算に使う値', S.resTitle);
    const vrow = (name, label, f, unit, st) => { str(G, vr, label, S.resLabel); fml(H, vr, f, st || S.man); str(I, vr, unit, S.unit); V[name] = '$H$' + vr; vr++; };
    vrow('labor', '1人あたり年間人件費＋管理費', `IF(${L},${n('base.laborCostPerPerson')},${ov('labor', `${n('detail.wage.base')}*(1+${n('detail.wage.overheadRate')}/100)+${n('detail.wage.overtimeHours')}*${n('detail.wage.overtimeRate')}/10000+${n('detail.wage.hiringTraining')}`)})`, '万円/年');
    vrow('shifts', '直数', `MIN(3,MAX(1,ROUND(${n('base.shifts')},0)))`, '直', S.int);
    vrow('persons', '1直あたり省人化（再配置）人数（実効）', `IF(${L},${n('base.personsPerShift')},${n('base.personsPerShift')}*${n('detail.ops.stationsPerRobot')}*${n('detail.ops.availability')}/100)`, '人', S.dec);
    vrow('growth', '人件費上昇率', n('base.wageGrowth'), '%/年', S.pct);
    vrow('extra', '付加効果（不良・ラインストップ低減）', `IF(${L},0,${n('detail.extra.qualitySaving')}+${n('detail.extra.downtimeSaving')})`, '万円/年');
    vrow('years', '評価期間', `IF(ROUND(${n('base.years')},0)>=1,ROUND(${n('base.years')},0),5)`, '年', S.int);
    vrow('integration', '初期投資 導入・周辺費用', `IF(${L},${amt('base', 'integration')},${ov('integration', ['si', 'safety', 'layout', 'training', 'spares'].map(k => amt('detail', k)).join('+'))})`, '万円');
    vrow('capex', '初期投資 合計', `${amt('base', 'robot')}+${amt('base', 'camera')}+${amt('base', 'endEffector')}+${V.integration}`, '万円');
    vrow('opex', '年間ランニング費', `IF(${L},${n('base.opexAnnual')},${ov('opex', ['maintenance', 'software', 'power', 'consumables'].map(k => n('detail.opex.' + k)).join('+'))})`, '万円/年');
    vrow('rate', 'NPV の割引率（精緻・NPV=ON のとき）', `IF(AND(NOT(${L}),${at['detail.fin.enableNPV']}="ON"),${n('detail.fin.discountRate')},"")`, '%', S.pct);

    V.annual = '$H$5';                       // 初年度 年間省人効果（上段の主要結果）
    // 年次表
    const T0 = vr + 2;                       // 見出し行
    str(G, T0 - 1, '年次表（万円）', S.resTitle);
    ['年', '年間省人効果', '年間ランニング費', '年間純効果', '累積キャッシュフロー', '回収点', '現在価値'].forEach((h, i) => str(G + i, T0, h, S.thead));
    for (let y = 0; y <= YEARS_MAX; y++) {
      const rr = T0 + 1 + y, prev = rr - 1;
      const beyond = `${y}>${V.years}`;
      if (y === 0) numc(G, rr, 0, S.tyear); else fml(G, rr, `IF(${beyond},"",${y})`, S.tyear);
      if (y === 0) {
        numc(H, rr, 0, S.tman); numc(I, rr, 0, S.tman); numc(9, rr, 0, S.tman);
        fml(10, rr, `-${V.capex}`, S.tman);
        blank(11, rr); blank(12, rr);
      } else {
        fml(H, rr, `IF(${beyond},"",${V.annual}*(1+${V.growth}/100)^${y - 1}+${V.extra})`, S.tman);
        fml(I, rr, `IF(${beyond},"",${V.opex})`, S.tman);
        fml(9, rr, `IF(${beyond},"",H${rr}-I${rr})`, S.tman);
        fml(10, rr, `IF(${beyond},"",K${prev}+J${rr})`, S.tman);
        fml(11, rr, `IF(${beyond},"",IF(AND(K${prev}<0,K${rr}>=0),${y - 1}+(-K${prev})/(K${rr}-K${prev}),""))`, S.tman);
        fml(12, rr, `IF(OR(${beyond},${V.rate}=""),"",J${rr}/(1+${V.rate}/100)^${y})`, S.tman);
      }
    }
    const T1 = T0 + 1, TN = T0 + 1 + YEARS_MAX;

    // 主要結果（上段）
    const thG = `N(${at['thresholds.green']})`, thY = `N(${at['thresholds.yellow']})`;
    str(G, 3, '投資回収年数', S.resLabel); heights[3] = 30;
    fml(H, 3, `IF(${V.capex}<=0,"—",IF(K${T1}>=0,0,IF(COUNT(L${T1 + 1}:L${TN})=0,"未回収",MIN(L${T1 + 1}:L${TN}))))`, S.big);
    str(I, 3, '年', S.unit);
    fml(G, 4, `IF(${V.capex}<=0,"初期投資を入力してください（お見積書の金額を転記）",IF(ISNUMBER(H3),IF(H3<=${thG},"稟議基準（緑 ≤ "&TEXT(${thG},"0.0")&" 年）を満たします",IF(H3<=${thY},"黄（≤ "&TEXT(${thY},"0.0")&" 年）の範囲です","回収まで "&TEXT(${thY},"0.0")&" 年超")),"評価期間 "&${V.years}&" 年以内に回収しません"))`, S.msg, true);
    merges.push('G4:I4');
    str(G, 5, '初年度 年間省人効果', S.resLabel); fml(H, 5, `${V.labor}*${V.shifts}*${V.persons}`, S.man); str(I, 5, '万円/年', S.unit);
    fml(G, 6, `${V.years}&"年累積効果"`, S.resLabel, true); fml(H, 6, `IF(${V.capex}<=0,"—",IFERROR(INDEX(K${T1}:K${TN},${V.years}+1),"—"))`, S.man); str(I, 6, '万円', S.unit);
    str(G, 7, '初期投資 合計', S.resLabel); fml(H, 7, V.capex, S.man); str(I, 7, '万円', S.unit);
    str(G, 8, '年間ランニング費', S.resLabel); fml(H, 8, V.opex, S.man); str(I, 8, '万円/年', S.unit);
    str(G, 9, 'NPV（正味現在価値）', S.resLabel); fml(H, 9, `IF(OR(${V.rate}="",${V.capex}<=0),"—",-${V.capex}+SUM(M${T1 + 1}:M${TN}))`, S.man); str(I, 9, '万円', S.unit);

    const foot = TN + 2;
    str(G, foot, '本シートの計算結果は概算であり、正式な見積・提案とは異なります。計算式は ROI 計算ツールと同じです。', S.footer);
    merges.push(`G${foot}:K${foot}`);

    // 投資回収年数の色分け（稟議基準）
    const cf = `<conditionalFormatting sqref="H3">`
      + `<cfRule type="expression" dxfId="0" priority="1" stopIfTrue="1"><formula>${xmlEsc(`AND(ISNUMBER(H3),H3<=${thG})`)}</formula></cfRule>`
      + `<cfRule type="expression" dxfId="1" priority="2" stopIfTrue="1"><formula>${xmlEsc(`AND(ISNUMBER(H3),H3<=${thY})`)}</formula></cfRule>`
      + `</conditionalFormatting>`;

    const sheet1 = sh.xml({
      cols: [[1, 54], [2, 14], [3, 9], [4, 10], [5, 30, true], [6, 3], [7, 38], [8, 16], [9, 16], [10, 14], [11, 18], [12, 10, true], [13, 10, true]],
      view: `<sheetView workbookViewId="0" showGridLines="0" zoomScale="100"><pane ySplit="${HEAD}" topLeftCell="A${HEAD + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="B${HEAD + 2}" sqref="B${HEAD + 2}"/></sheetView>`,
      extra: cf + `<dataValidations count="${validations.length}">${validations.join('')}</dataValidations>`,
      landscape: true
    });
    const sheets = [{ name: SHEET_NAME, xml: sheet1 }];
    const A = state.scenarios && state.scenarios.A, B = state.scenarios && state.scenarios.B;
    if (A || B) sheets.push({ name: SHEET2_NAME, xml: compareSheet(A, B) });

    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((x, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((x, i) => `<sheet name="${x.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((x, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: STYLES },
      ...sheets.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x.xml }))
    ];
    return zipStore(files);
  }

  /** シート2：シナリオ A/B 比較（保存時点の値。Excel 上では再計算しない） */
  function compareSheet(A, B) {
    const sh = newSheet();
    const { str, numc } = sh;
    str(0, 1, 'シナリオ A/B 比較', S.title); sh.heights[1] = 26;
    str(0, 2, 'ROI 計算ツールで「シナリオA／Bに保存」した時点の値です（このシートは再計算しません。入力を変えて試すときは「入力・計算」シートで）。', S.footer);
    let r = 4;
    ['項目', 'シナリオA', 'シナリオB', '単位'].forEach((h, i) => str(i, r, h, S.head)); r++;
    const pb = x => x.result.error ? '—' : (x.result.paybackYears === null ? '未回収' : x.result.paybackYears);
    const ROWS = [
      ['シナリオ名', x => x.name || '無題', '', 'text'],
      ['モード', x => (x.mode === 'detail' ? '精緻' : 'ライト'), '', 'text'],
      ['1人あたり年間人件費＋管理費', x => x.inputs.laborCostPerPerson, '万円/年', S.man],
      ['直数', x => x.inputs.shifts, '直', S.int],
      ['1直あたり省人化（再配置）人数（実効）', x => x.inputs.effectivePersonsPerShift, '人', S.dec],
      ['人件費上昇率', x => x.inputs.wageGrowth, '%/年', S.pct],
      ['初期投資 合計', x => x.inputs.capexTotal, '万円', S.man],
      ['年間ランニング費', x => x.inputs.opexAnnual, '万円/年', S.man],
      ['評価期間', x => x.inputs.years, '年', S.int],
      ['初年度 年間省人効果', x => x.result.annualSaving0, '万円/年', S.man],
      ['投資回収年数', pb, '年', S.pct],
      ['累積効果（評価期間末）', x => x.result.cumFinal, '万円', S.man],
      ['NPV（精緻・NPV=ON のとき）', x => (x.result.npv === null || x.result.npv === undefined ? '—' : x.result.npv), '万円', S.man]
    ];
    const cell = (c, x, f, st) => {
      if (!x) { str(c, r, '未保存', S.unit); return; }
      const v = f(x);
      if (st === 'text' || typeof v !== 'number') str(c, r, String(v), st === 'text' ? S.resLabel : S.unit);
      else numc(c, r, v, st);
    };
    ROWS.forEach(([label, f, unit, st]) => { str(0, r, label, S.resLabel); cell(1, A, f, st); cell(2, B, f, st); str(3, r, unit, S.unit); r++; });
    r++;
    str(0, r, '累積キャッシュフロー（万円）', S.resTitle); r++;
    ['年', 'シナリオA', 'シナリオB'].forEach((h, i) => str(i, r, h, S.thead)); r++;
    const N = Math.max(A ? A.series.length : 0, B ? B.series.length : 0);
    for (let y = 0; y < N; y++, r++) {
      numc(0, r, y, S.tyear);
      [A, B].forEach((x, k) => { const p = x && x.series[y]; if (p) numc(k + 1, r, p.cum, S.tman); else sh.blank(k + 1, r, S.tman); });
    }
    return sh.xml({ cols: [[1, 40], [2, 18], [3, 18], [4, 10]], view: '<sheetView workbookViewId="0" showGridLines="0"/>' });
  }

  // ============ 読み込み ============
  function xmlUnesc(s) {
    return s.replace(/&(lt|gt|quot|apos|amp|#(\d+)|#x([0-9a-fA-F]+));/g, (m, n, d, h) =>
      d ? String.fromCodePoint(+d) : h ? String.fromCodePoint(parseInt(h, 16)) : { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[n]);
  }
  // <t> の中身を連結（ふりがな <rPh> は除く）
  function textOf(xml) {
    let s = ''; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g; let m;
    xml = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    while ((m = re.exec(xml))) s += m[1] ? xmlUnesc(m[1]) : '';
    return s;
  }
  function attr(attrs, name) { const m = new RegExp('\\b' + name + '="([^"]*)"').exec(attrs); return m ? xmlUnesc(m[1]) : null; }
  function resolvePath(base, target) {
    if (target.startsWith('/')) return target.slice(1);
    const parts = base.split('/'); parts.pop();
    target.split('/').forEach(p => { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); });
    return parts.join('/');
  }

  /** .xlsx → 先頭シート（「入力・計算」があればそれ）の A〜E 列の行×セル配列 */
  async function readSheetRows(bytes) {
    const z = await unzip(bytes);
    const dec = new TextDecoder();
    const get = p => (z[p] ? dec.decode(z[p]) : null);
    const wb = get('xl/workbook.xml');
    if (!wb) throw new Error('Excel ファイル（.xlsx）として読めませんでした');
    const sheets = []; let m; const reS = /<sheet\b([^>]*)\/?>/g;
    while ((m = reS.exec(wb))) sheets.push({ name: attr(m[1], 'name'), rid: attr(m[1], 'r:id') });
    const target = sheets.find(s => s.name === SHEET_NAME) || sheets[0];
    const rels = get('xl/_rels/workbook.xml.rels') || '';
    let path = 'xl/worksheets/sheet1.xml';
    const reR = /<Relationship\b([^>]*)\/?>/g;
    while ((m = reR.exec(rels))) if (target && attr(m[1], 'Id') === target.rid) path = resolvePath('xl/workbook.xml', attr(m[1], 'Target'));
    const sst = [];
    const ss = get('xl/sharedStrings.xml');
    if (ss) { const reSi = /<si>([\s\S]*?)<\/si>/g; while ((m = reSi.exec(ss))) sst.push(textOf(m[1])); }
    const sheet = get(path);
    if (!sheet) throw new Error('シートが見つかりませんでした');
    const out = [];
    const reC = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    while ((m = reC.exec(sheet))) {
      const r = attr(m[1], 'r'); if (!r) continue;
      const cm = /^([A-Z]+)(\d+)$/.exec(r); if (!cm || cm[1].length > 1) continue;
      const col = cm[1].charCodeAt(0) - 65, row = +cm[2] - 1;
      if (col > 4) continue;
      const t = attr(m[1], 't'), body = m[2] || '';
      const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
      let v = '';
      if (t === 's') v = vm ? (sst[+vm[1]] || '') : '';
      else if (t === 'inlineStr') v = textOf(body);
      else if (t === 'b') v = vm && vm[1] === '1' ? 'TRUE' : 'FALSE';
      else v = vm ? xmlUnesc(vm[1]) : '';
      (out[row] = out[row] || [])[col] = v;
    }
    for (let i = 0; i < out.length; i++) { out[i] = out[i] || []; for (let c = 0; c < 5; c++) if (out[i][c] === undefined) out[i][c] = ''; }
    return out;
  }

  /** .xlsx → LXCSV.importState と同じ結果（{state, applied, skipped, format:'xlsx'} | {error}） */
  async function importXlsx(bytes, current) {
    const rows = await readSheetRows(bytes);
    const h = rows.findIndex(r => r.map(c => String(c).trim()).includes('キー') && r.map(c => String(c).trim()).includes('値'));
    if (h < 0) return { error: 'このツールの入力シート（Excel）ではないようです（「値」「キー」列が見つかりません）' };
    const res = CSV.importState([[CSV.DATA_SECTION]].concat(rows.slice(h)), current);
    if (!res.error) res.format = 'xlsx';
    return res;
  }

  return { MIME, SHEET_NAME, SHEET2_NAME, GROUPS, buildXlsx, zipStore, unzip, crc32, readSheetRows, importXlsx };
});
