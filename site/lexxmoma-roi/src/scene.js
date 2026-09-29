/* LexxMoMa 費用対効果 簡易計算ツール — scene.js
 * 工場タイクーン 3D：入力が増える・良くなるほど育つ工場を、外部ライブラリなしの軽量3D（Canvas 2D にポリゴン投影・奥行きソート）で描く。
 *  - Before（現状：手作業）／After（LexxMoMa 導入後）の切替、ドラッグで視点回転、ホイールで拡大縮小、再生/一時停止
 *  - LexxMoMa は AMR台車＋制御筐体＋協働アーム（手首カメラ・ハンド）。台数＝「機体」の数量
 *  - イベントボタン：フル稼働指示／猛暑／災害（地震）。一定時間で通常運用に戻る。イベントが3回重なると作業者が倒れ救急搬送
 * 稟議出力（印刷・CSV）には含めない。数値は calc.js の出力（p, r, state）だけを使い、ここで式は書かない。 */
(function (root) {
  'use strict';
  const C = root.LXCALC;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const PAL = {
    primary: '#0068B7', accent: '#3EB370', accentDark: '#2E8F58', yellow: '#F2B705', grey: '#9AA0A6', text: '#1F2933', muted: '#5F6B7A',
    warn: '#D93025', wood: '#B08968', gold: '#E9B949', goldDark: '#B48A1E', white: '#EEF2F5', dark: '#3B4754', black: '#1F2933', orange: '#F28C28'
  };

  // ---------- 入力 → 工場の状態 ----------
  function factoryModel(p, r, state) {
    const b = state.base, d = state.detail, detail = state.mode === 'detail';
    const has = v => !C.isBlank(v) && C.num(v) > 0;
    const m = {
      shifts: p.shifts,
      workers: clamp(Math.round(p.shifts * p.effectivePersonsPerShift), 0, 12),
      robot: has(b.capex.robot),
      units: has(b.capex.robot) ? clamp(p.robotUnits || 1, 1, 4) : 0,
      camera: has(b.capex.camera),
      hand: has(b.capex.endEffector),
      fence: detail ? (has(d.capex.si) || has(d.capex.safety)) : has(b.capex.integration),
      layout: detail ? has(d.capex.layout) : has(b.capex.integration),
      training: detail && has(d.capex.training),
      spares: detail && has(d.capex.spares),
      monitor: detail ? has(d.opex.software) : has(b.opexAnnual),
      toolbox: detail ? has(d.opex.maintenance) : has(b.opexAnnual),
      charger: detail ? has(d.opex.power) : has(b.capex.robot),
      quality: detail && has(d.extra.qualitySaving),
      uptime: detail && has(d.extra.downtimeSaving),
      availability: detail ? C.num(d.ops.availability) : 95,
      stations: detail ? clamp(Math.round(C.num(d.ops.stationsPerRobot)) || 1, 1, 3) : 1,
      abSaved: !!(state.scenarios.A && state.scenarios.B),
      saving: r.annualSaving0,
      years: r.years,
      payback: r.error ? null : r.paybackYears,
      color: C.paybackColor(r.error ? null : r.paybackYears, state.thresholds)
    };
    m.score = ['robot', 'camera', 'hand', 'fence', 'layout', 'training', 'spares', 'monitor', 'toolbox', 'quality', 'uptime', 'abSaved'].filter(k => m[k]).length;
    m.grade = m.score <= 1 ? '町工場' : m.score <= 4 ? '自動化ライン' : m.score <= 8 ? 'スマート工場' : '未来工場';
    m.stars = clamp(Math.ceil(m.score / 3), 0, 4);
    m.next = nextUnlock(m, detail);
    return m;
  }
  function nextUnlock(m, detail) {
    if (!m.robot) return '「機体」に単価と台数を入れると LexxMoMa が搬入され、After が見られます';
    if (!m.camera) return '「カメラ・ビジョン」を入れると手首にカメラが付きます';
    if (!m.hand) return '「エンドエフェクタ」を入れるとハンドが付いてワークを掴みます';
    if (!m.fence) return detail ? '「SI・ティーチング」「安全対策・柵」で安全柵と走行テープが敷かれます' : '「導入・周辺費用」で安全柵と走行テープが敷かれます';
    if (!m.monitor) return detail ? '「フリート管理・ソフトライセンス」で壁に稼働モニターが付きます' : '「年間ランニング費」で壁に稼働モニターと保守工具が付きます';
    if (!detail) return '精緻モードに切り替えると、教育・予備品・不良低減など増える設備がまだあります';
    if (!m.training) return '「教育」を入れると安全講習の掲示が出ます';
    if (!m.spares) return '「予備品」で部品棚が置かれます';
    if (!m.quality) return '「不良低減」で品質ポスターが貼られます';
    if (!m.uptime) return '「ラインストップ低減」で稼働ランプが増えます';
    if (!m.abSaved) return 'シナリオA/Bを両方保存すると社長賞の盾が飾られます';
    return 'フル装備の未来工場です！';
  }

  // ---------- イベント定義 ----------
  const EVENTS = {
    rush: { dur: 9, label: '🚨 フル稼働指示', color: PAL.orange },
    heat: { dur: 10, label: '🌡 猛暑日 35℃', color: '#E85D04' },
    quake: { dur: 13, label: '🌏 地震発生', color: PAL.warn },
    medic: { dur: 11, label: '🚑 救急搬送', color: PAL.warn }
  };

  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function shade(hex, k) { const [r, g, b] = hexToRgb(hex); return `rgb(${clamp(r * k, 0, 255) | 0},${clamp(g * k, 0, 255) | 0},${clamp(b * k, 0, 255) | 0})`; }

  // ============================================================
  // 軽量3Dエンジン
  // ============================================================
  function create(canvas, opts) {
    const ctx = canvas.getContext('2d');
    const onView = (opts && opts.onView) || (() => {});
    const onEvent = (opts && opts.onEvent) || (() => {});
    const H = 320;
    let W = 800, dpr = 1;
    const DEF = { yaw: -0.62, pitch: 0.52, dist: 2300 };
    const cam = Object.assign({}, DEF, { tx: 650, ty: 50, tz: 300, F: 1050 });
    const LIGHT = norm([-0.45, 1, 0.55]);
    let m = null, view = 'before', userView = null, running = true, t = 0, rt = 0, last = 0, raf = 0;
    let prims = [], bg = [], curObj = null, seq = 0, amb = 1;
    let cy, sy, cp, sp;
    // イベント状態
    let ev = null, evCount = 0;
    const wk = [];                       // 作業者の現在位置など
    let shake = 0;

    function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
    function rot(x, y, z) {
      const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
      const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      return [x1, y2, z2];
    }
    // 部品ローカル座標 → ワールド座標の縮尺変換（LexxMoMa を実寸比に縮めて描くため）
    let XF = null;   // { x, z, s }：床上の (x, z) を中心に s 倍
    function xf(pt) { return XF ? [XF.x + (pt[0] - XF.x) * XF.s, pt[1] * XF.s, XF.z + (pt[2] - XF.z) * XF.s] : pt; }
    function toLocal(pt) { return XF ? [XF.x + (pt[0] - XF.x) / XF.s, pt[1] / XF.s, XF.z + (pt[2] - XF.z) / XF.s] : pt; }
    const xs = () => (XF ? XF.s : 1);
    function camSpace(pt) { const q = xf(pt); return rot(q[0] - cam.tx, q[1] - cam.ty, q[2] - cam.tz); }
    function proj(pt) {
      const [x1, y2, z2] = camSpace(pt);
      const depth = cam.dist - z2, s = cam.F / Math.max(80, depth);
      return { x: W / 2 + x1 * s, y: H * 0.58 - y2 * s, z: z2, s };
    }
    /** オブジェクト単位でまとめて奥行きソートする（面ごとのソートによる「見えたり消えたり」を防ぐ） */
    function begin(cx, cyy, cz, bias) { curObj = { z: camSpace([cx, cyy, cz])[2] + (bias || 0) }; }
    function end() { curObj = null; }
    function push(q) {
      q.oz = curObj ? curObj.z : q.z; q.seq = seq++;
      if (curObj && curObj.ordered) q.z = 0;      // 凸な部品の組立順どおりに描く（描画順＝登録順）
      (q.layer === 'bg' ? bg : prims).push(q);
    }
    /** 面がカメラを向いているか（透視カメラ基準） */
    function facing(pt, n) {
      const c = camSpace(pt), nc = rot(n[0], n[1], n[2]);
      return nc[0] * -c[0] + nc[1] * -c[1] + nc[2] * (cam.dist - c[2]) > 0;
    }
    function poly(pts, color, n, opt) {
      const pp = pts.map(proj);
      let k = 1;
      if (n) {
        // 透視カメラ基準の裏面判定：面の中心→カメラ位置ベクトルと法線の内積
        const c = camSpace([pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length, pts.reduce((a, q) => a + q[2], 0) / pts.length]);
        const nc = rot(n[0], n[1], n[2]);
        const toCam = [-c[0], -c[1], cam.dist - c[2]];
        if (nc[0] * toCam[0] + nc[1] * toCam[1] + nc[2] * toCam[2] < 0 && !(opt && opt.twoSided)) return;
        k = 0.62 + 0.38 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      }
      push({ t: 'poly', pp, color: n ? shade(color, k * amb) : color, z: pp.reduce((a, q) => a + q.z, 0) / pp.length, stroke: opt && opt.stroke, layer: opt && opt.layer });
    }
    function line(a, b, color, w, opt) {
      const pa = proj(a), pb = proj(b);
      push({ t: 'line', pa, pb, color, w: w * xs() * (pa.s + pb.s) / 2, z: (pa.z + pb.z) / 2 + ((opt && opt.bias) || 0), layer: opt && opt.layer });
    }
    function disc(c, r, color, bias) { const pc = proj(c); push({ t: 'disc', pc, r: r * xs() * pc.s, color, z: pc.z + (bias || 0) }); }
    function text(c, str, size, color, bold) { const pc = proj(c); push({ t: 'text', pc, str, size: size * xs() * pc.s, color, z: pc.z + 6, bold }); }
    function box(cx, y0, cz, w, h, d, color, opt) {
      const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
      if (!(opt && opt.noTop)) poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], color, [0, 1, 0], opt);
      poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], color, [0, 0, 1], opt);
      poly([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], color, [0, 0, -1], opt);
      poly([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], color, [-1, 0, 0], opt);
      poly([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], color, [1, 0, 0], opt);
    }
    function cylinder(cx, y0, cz, r, h, color, sides) {
      sides = sides || 10;
      const top = [];
      for (let i = 0; i < sides; i++) {
        const a0 = i / sides * Math.PI * 2, a1 = (i + 1) / sides * Math.PI * 2;
        const p0 = [cx + r * Math.cos(a0), y0, cz + r * Math.sin(a0)], p1 = [cx + r * Math.cos(a1), y0, cz + r * Math.sin(a1)];
        poly([p0, p1, [p1[0], y0 + h, p1[2]], [p0[0], y0 + h, p0[2]]], color, [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)]);
        top.push([p0[0], y0 + h, p0[2]]);
      }
      poly(top, color, [0, 1, 0]);
    }

    // ---------- 配置定数 ----------
    const ST_X = [180, 430, 680];
    const MZ = 110, CONV_Z = 215, WORK_Z = 292, PATH_Z = 272;
    const FX0 = 70, FX1 = 790, FZ0 = 40, FZ1 = PATH_Z + 42;    // 安全柵の範囲（走行レーンを内包）
    const LANE_X0 = 140, LANE_X1 = 720;                         // LexxMoMa の走行範囲（台数で区間分け）
    const EVAC = [1260, 610];            // 避難場所
    const EXIT = [1420, 520];            // 搬出口

    // ---------- イベント制御 ----------
    function trigger(type) {
      if (ev || !EVENTS[type] || !m) return false;
      ev = { type, t0: t };
      if (type !== 'medic') evCount++;
      onEvent(ev, evCount);
      return true;
    }
    function evElapsed() { return ev ? t - ev.t0 : 0; }
    function evType() { return ev ? ev.type : null; }
    function quakePhase() {       // 'shake' | 'calm' | 'recover'
      const e = evElapsed(); return e < 3 ? 'shake' : e < 5 ? 'calm' : 'recover';
    }
    function robotStopped() { return evType() === 'quake' && evElapsed() < 5; }
    function robotSpeed() { return evType() === 'rush' ? 1.9 : robotStopped() ? 0 : 1; }
    function tickEvents(dt) {
      if (!ev) return;
      if (evElapsed() >= EVENTS[ev.type].dur) {
        const wasMedic = ev.type === 'medic';
        ev = null;
        onEvent(null, evCount);
        if (wasMedic) evCount = 0;
        else if (evCount >= 3 && m.workers >= 2) { trigger('medic'); }
      }
    }

    // ---------- 作業者の目標位置 ----------
    function normalTarget(i, after) {
      if (after) return [940 + (i % 5) * 46, 430 + Math.floor(i / 5) * 58, Math.PI];
      const st = ST_X[i % 3], row = Math.floor(i / 3);
      return [st - 40 + (row % 2) * 80 + (row >= 2 ? 20 : 0), WORK_Z + row * 22, 0];
    }
    function updateWorkers(dt, after) {
      const n = m.workers;
      while (wk.length < n) { const i = wk.length; const tg = normalTarget(i, after); wk.push({ x: tg[0], z: tg[1], tx: tg[0], tz: tg[1], walking: false, arrived: true, arriveT: 0 }); }
      wk.length = n;
      const type = evType(), e = evElapsed();
      wk.forEach((w, i) => {
        let tg = normalTarget(i, after), speed = 90;
        w.mode = 'normal';
        if (type === 'rush') { w.mode = 'panic'; speed = 200; tg = [tg[0] + Math.sin(t * 9 + i * 2) * 10, tg[1] + Math.cos(t * 7 + i) * 8]; }
        else if (type === 'heat') { w.mode = 'heat'; speed = 45; }
        else if (type === 'quake') {
          const ph = quakePhase();
          if (ph !== 'recover') { w.mode = 'evac'; speed = 230; tg = [EVAC[0] + (i % 4) * 34 - 50, EVAC[1] + Math.floor(i / 4) * 34 - 30]; }
          else { w.mode = 'check'; speed = 75; }
        } else if (type === 'medic') {
          if (i === 0) { w.mode = e < 1 ? 'wobble' : 'down'; tg = [w.tx, w.tz]; }
          else if (i === 1 || i === 2) {
            const v = wk[0];
            if (e < 4.5) { w.mode = 'helper'; speed = 160; tg = [v.x + (i === 1 ? -26 : 26), v.z + 4]; }
            else { w.mode = 'carry'; speed = 130; tg = [EXIT[0] + (i === 1 ? -26 : 26), EXIT[1]]; }
          }
        }
        w.tx = tg[0]; w.tz = tg[1];
        const dx = w.tx - w.x, dz = w.tz - w.z, dist = Math.hypot(dx, dz);
        if (dist > 1.5) { const st = Math.min(dist, speed * dt); w.x += dx / dist * st; w.z += dz / dist * st; w.walking = true; w.arrived = false; }
        else { if (!w.arrived) { w.arrived = true; w.arriveT = t; } w.walking = false; }
      });
      // 搬送中：倒れた作業者は担架（ヘルパーの中点）に乗る
      if (type === 'medic' && e >= 4.5 && wk.length >= 3) { wk[0].x = (wk[1].x + wk[2].x) / 2; wk[0].z = (wk[1].z + wk[2].z) / 2 - 4; }
    }

    // ---------- シーン ----------
    function drawWorld(now) {
      const night = m.shifts >= 3, dusk = m.shifts === 2;
      amb = night ? 0.78 : 1;
      const after = view === 'after' && m.robot;
      const type = evType(), e = evElapsed();
      // 背景レイヤ（床・壁・窓）：常に最初に描く
      const BG = { layer: 'bg' };
      poly([[-60, 0, 0], [1460, 0, 0], [1460, 0, 760], [-60, 0, 760]], night ? '#4A586C' : '#DDE3E9', [0, 1, 0], BG);
      for (let x = 0; x <= 1400; x += 100) line([x, 0.5, 0], [x, 0.5, 760], night ? '#55647A' : '#CDD5DD', 1.2, BG);
      for (let z = 100; z <= 700; z += 100) line([-60, 0.5, z], [1460, 0.5, z], night ? '#55647A' : '#CDD5DD', 1.2, BG);
      poly([[-60, 0, 0], [1460, 0, 0], [1460, 280, 0], [-60, 280, 0]], night ? '#2C3848' : dusk ? '#F3E3CF' : type === 'heat' ? '#FBE3C8' : '#EEF2F6', [0, 0, 1], BG);
      for (let x = 0; x <= 1400; x += 100) line([x, 0, 1], [x, 280, 1], night ? '#3B4858' : '#E0E6EC', 1, BG);
      const win = night ? '#FFE08A' : type === 'heat' ? '#FFB347' : dusk ? '#F7B267' : '#BFDCF3';
      for (let i = 0; i < 6; i++) { const x = 90 + i * 210; poly([[x, 170, 2], [x + 110, 170, 2], [x + 110, 240, 2], [x, 240, 2]], win, null, BG); line([x + 55, 170, 3], [x + 55, 240, 3], night ? '#2C3848' : '#8FA6BA', 1.5, BG); line([x, 205, 3], [x + 110, 205, 3], night ? '#2C3848' : '#8FA6BA', 1.5, BG); }
      // 壁の掲示（壁と同じ背景レイヤ）
      if (m.monitor) { poly([[495, 100, 4], [625, 100, 4], [625, 176, 4], [495, 176, 4]], '#1F2933', null, BG); poly([[500, 106, 5], [620, 106, 5], [620, 170, 5], [500, 170, 5]], '#0F1620', null, BG); line([508, 122, 6], [530, 140, 6], PAL.accent, 3, BG); line([530, 140, 6], [560, 132, 6], PAL.accent, 3, BG); line([560, 132, 6], [612, 158, 6], PAL.accent, 3, BG); text([560, 150, 7], robotStopped() ? '緊急停止' : '稼働モニター', 11, robotStopped() ? PAL.warn : '#fff'); }
      if (m.quality) { poly([[700, 100, 4], [790, 100, 4], [790, 160, 4], [700, 160, 4]], '#fff', null, Object.assign({ stroke: '#C9CFD6' }, BG)); text([745, 128, 5], '不良ゼロ', 13, PAL.warn, true); text([745, 112, 5], '品質第一', 10, PAL.text); }
      if (m.uptime) { poly([[810, 100, 4], [900, 100, 4], [900, 160, 4], [810, 160, 4]], '#fff', null, Object.assign({ stroke: '#C9CFD6' }, BG)); text([855, 140, 5], 'ラインストップ', 10, PAL.text); text([855, 118, 5], '↓ 低減', 14, PAL.accent, true); }
      if (m.training) { poly([[920, 100, 4], [1010, 100, 4], [1010, 160, 4], [920, 160, 4]], PAL.yellow, null, Object.assign({ stroke: '#C99A00' }, BG)); text([965, 132, 5], '安全講習', 13, PAL.text, true); text([965, 114, 5], '教育中', 10, PAL.text); }
      if (m.abSaved) { poly([[1040, 96, 4], [1080, 106, 4], [1120, 96, 4], [1120, 150, 4], [1080, 166, 4], [1040, 150, 4]], PAL.gold, null, Object.assign({ stroke: PAL.goldDark }, BG)); text([1080, 128, 5], '社長賞', 11, '#5A4300', true); }
      // 避難場所・搬出口の床表示
      poly([[EVAC[0] - 90, 0.6, EVAC[1] - 60], [EVAC[0] + 90, 0.6, EVAC[1] - 60], [EVAC[0] + 90, 0.6, EVAC[1] + 60], [EVAC[0] - 90, 0.6, EVAC[1] + 60]], type === 'quake' ? 'rgba(62,179,112,.35)' : night ? '#4F5F74' : '#D3DAE1', null, BG);
      text([EVAC[0], 2, EVAC[1]], '避難場所', 11, type === 'quake' ? PAL.accentDark : (night ? '#8FA0B4' : '#9AA0A6'), true);
      // 天井灯（3直）
      if (night) for (let i = 0; i < 4; i++) { const x = 250 + i * 280; begin(x, 250, 180); box(x, 250, 180, 70, 6, 18, '#FFF3C4'); end(); }

      // 機械（3ステーション）とコンベア
      ST_X.forEach((x, i) => {
        const active = (after ? true : i < m.stations) && !(type === 'quake' && e < 5);
        begin(x, 60, MZ);
        box(x, 0, MZ, 130, 120, 110, '#C9D1DA');
        box(x, 62, MZ + 56, 70, 40, 6, '#E9EEF3');
        box(x + 42, 90, MZ + 56, 20, 8, 4, '#9AA0A6'); box(x + 42, 74, MZ + 56, 20, 8, 4, '#9AA0A6');
        disc([x + 46, 40, MZ + 58], 5, active && Math.sin(now * (type === 'rush' ? 8 : 3) + i) > 0 ? PAL.accent : (type === 'quake' && e < 5 ? PAL.warn : '#B9C6D2'), 2);
        text([x, 24, MZ + 58], `ST${i + 1}`, 10, PAL.muted);
        end();
      });
      begin(430, 20, CONV_Z, -40);
      box(430, 0, CONV_Z, 690, 40, 32, '#8D99A6');
      box(430, 40, CONV_Z, 690, 4, 26, '#B9C6D2');
      if (!robotStopped()) for (let x = 100; x <= 760; x += 60) { const off = ((now * (type === 'rush' ? 90 : 40)) % 60); line([x + off, 45, CONV_Z - 10], [x + off, 45, CONV_Z + 10], '#DCE2E8', 2, { bias: 2 }); }
      end();
      // 安全柵・走行テープ（After）
      if (after && m.fence) {      // 全台が走る1レーン（FZ1 まで）を囲む
        const post = (x, z) => { begin(x, 40, z); line([x, 0, z], [x, 60, z], PAL.yellow, 4); line([x, 60, z], [x, 78, z], PAL.black, 4); end(); };
        for (let x = FX0; x <= FX1; x += 80) { post(x, FZ0); post(x, FZ1); }
        for (let z = FZ0 + 80; z < FZ1; z += 80) { post(FX0, z); post(FX1, z); }
        const cxm = (FX0 + FX1) / 2, czm = (FZ0 + FZ1) / 2;
        begin(cxm, 40, FZ0, -60); line([FX0, 50, FZ0], [FX1, 50, FZ0], PAL.yellow, 2.5); line([FX0, 24, FZ0], [FX1, 24, FZ0], PAL.yellow, 1.5); end();
        begin(cxm, 40, FZ1, -60); line([FX0, 50, FZ1], [FX1, 50, FZ1], PAL.yellow, 2.5); line([FX0, 24, FZ1], [FX1, 24, FZ1], PAL.yellow, 1.5); end();
        begin(FX0, 40, czm, -60); line([FX0, 50, FZ0], [FX0, 50, FZ1], PAL.yellow, 2.5); line([FX0, 24, FZ0], [FX0, 24, FZ1], PAL.yellow, 1.5); end();
        begin(FX1, 40, czm, -60); line([FX1, 50, FZ0], [FX1, 50, FZ1], PAL.yellow, 2.5); line([FX1, 24, FZ0], [FX1, 24, FZ1], PAL.yellow, 1.5); end();
      }
      if (after && m.layout) for (let x = FX0 + 20; x < FX1 - 40; x += 70) { line([x, 1, PATH_Z + 24], [x + 40, 1, PATH_Z + 24], PAL.yellow, 3, BG); }
      // 右側設備
      if (m.spares) { begin(1000, 40, 90); box(1000, 0, 90, 90, 78, 40, '#B9C6D2'); box(1000, 38, 90, 90, 3, 40, '#8D99A6'); [0, 1, 2].forEach(i => box(975 + i * 26, 41, 90, 20, 20, 24, PAL.wood)); [0, 1].forEach(i => box(982 + i * 34, 3, 90, 26, 22, 26, PAL.primary)); text([1000, 90, 112], '予備品', 10, night ? '#E8EDF2' : PAL.muted); end(); }
      if (m.toolbox) { begin(870, 10, 100); box(870, 0, 100, 36, 18, 22, PAL.warn); box(870, 18, 100, 14, 5, 6, PAL.black); text([870, 34, 112], '保守', 10, night ? '#E8EDF2' : PAL.muted); end(); }
      if (after && m.charger) { begin(1150, 20, PATH_Z); box(1150, 0, PATH_Z, 30, 40, 40, '#8D99A6'); box(1150, 12, PATH_Z + 21, 16, 14, 2, PAL.accent); text([1150, 56, PATH_Z], '充電', 10, night ? '#E8EDF2' : PAL.muted); end(); }
      // 人と機体
      const n = m.workers;
      if (after) {
        begin(1170, 45, 470); box(1170, 0, 470, 8, 90, 90, '#8D99A6'); box(1170, 40, 470, 4, 60, 84, '#fff'); text([1165, 88, 470], '改善ボード', 9, PAL.text, true); box(1165, 62, 448, 2, 14, 22, PAL.yellow); box(1165, 62, 486, 2, 14, 22, PAL.accent); end();
        if (n && !type) text([1050, 100, 560], `創出工数：${n}人分を改善活動へ`, 12, night ? '#E8EDF2' : PAL.text, true);
        for (let k = 0; k < m.units; k++) robotAt(k, rt, now);
      } else {
        if (n && !type) text([430, 150, WORK_Z + 60], `現状：${n}人が手作業で投入・取出し`, 12, night ? '#E8EDF2' : PAL.text, true);
        if (n && type !== 'quake' && type !== 'medic') {    // 手運びの作業者
          const sp = type === 'rush' ? 0.3 : type === 'heat' ? 0.06 : 0.12;
          const ph = (now * sp) % 1, x = lerp(ST_X[0], ST_X[2], ph < 0.5 ? ease(ph * 2) : ease(2 - ph * 2));
          drawWorker({ x, z: WORK_Z + 50, walking: true, mode: type === 'rush' ? 'panic' : type === 'heat' ? 'heat' : 'normal' }, 99, now, true);
        }
        if (m.robot) text([1000, 40, 500], 'After に切り替えると LexxMoMa が稼働します', 11, night ? '#C9D3DE' : PAL.muted);
        else { begin(1000, 1, PATH_Z); box(1000, 0, PATH_Z, 100, 2, 70, night ? '#5A6980' : '#C9D1DA'); text([1000, 30, PATH_Z], 'LexxMoMa 搬入予定地', 11, PAL.primary, true); end(); }
      }
      wk.forEach((w, i) => drawWorker(w, i, now, false, after));
      // 担架・搬送口
      if (type === 'medic' && wk.length >= 3 && e >= 4.5) {
        const a = wk[1], b = wk[2];
        begin((a.x + b.x) / 2, 24, (a.z + b.z) / 2, 4);
        line([a.x, 26, a.z - 6], [b.x, 26, b.z - 6], '#fff', 3.5); line([a.x, 26, a.z + 6], [b.x, 26, b.z + 6], '#fff', 3.5);
        box((a.x + b.x) / 2, 24, (a.z + b.z) / 2, Math.abs(b.x - a.x) - 14, 3, 16, '#fff');
        end();
      }
      if (type === 'medic') { begin(EXIT[0], 30, EXIT[1]); box(EXIT[0], 0, EXIT[1], 40, 50, 60, '#fff'); box(EXIT[0], 50, EXIT[1], 14, 8, 14, Math.sin(now * 12) > 0 ? PAL.warn : '#F5B7B1'); box(EXIT[0] - 21, 22, EXIT[1], 2, 14, 6, PAL.warn); box(EXIT[0] - 21, 26, EXIT[1], 2, 6, 14, PAL.warn); text([EXIT[0], 66, EXIT[1]], '救急車', 10, PAL.warn, true); end(); }
    }

    // ---------- 作業者 ----------
    function drawWorker(w, i, now, carryBox, after) {
      const mode = w.mode || 'normal';
      const col = i % 2 ? PAL.accent : PAL.primary;
      const x = w.x, z = w.z;
      begin(x, 30, z, 6);
      if (mode === 'down' || mode === 'carry') {      // 倒れている／担架に乗っている
        const y = mode === 'carry' ? 27 : 2;
        box(x, y, z, 26, 10, 14, col); disc([x - 17, y + 6, z], 6.5, '#F6D6B8'); line([x + 13, y + 4, z - 4], [x + 24, y + 3, z - 4], PAL.dark, 4); line([x + 13, y + 4, z + 4], [x + 24, y + 3, z + 4], PAL.dark, 4);
        if (mode === 'down') text([x, 34, z], Math.sin(now * 6) > 0 ? '…' : '', 12, PAL.warn, true);
        end(); return;
      }
      const speedBob = mode === 'panic' || mode === 'evac' ? 14 : mode === 'heat' ? 1.6 : after ? 2.2 : 3.6;
      const amp = mode === 'panic' || mode === 'evac' ? 3.5 : mode === 'heat' ? 0.8 : 2;
      const bob = Math.sin(now * speedBob + i) * amp + (mode === 'heat' ? -4 : 0);
      const swing = w.walking ? Math.sin(now * (mode === 'evac' || mode === 'panic' ? 22 : 12) + i) * 7 : 0;
      line([x - 4, 0, z], [x - 4, 22, z + swing], PAL.dark, 4.5); line([x + 4, 0, z], [x + 4, 22, z - swing], PAL.dark, 4.5);
      box(x, 22 + bob, z, 15, 24, 10, col);
      disc([x, 54 + bob, z], 6.5, '#F6D6B8', 1);
      disc([x, 58.5 + bob, z], 6.2, col, 2);                 // ヘルメット
      if (mode === 'wobble') { text([x, 72, z], '！', 14, PAL.warn, true); }
      if (mode === 'panic') { text([x, 74 + bob, z], '！', 14, PAL.orange, true); line([x - 9, 40 + bob, z], [x - 16, 52 + bob + Math.sin(now * 20) * 4, z], '#F6D6B8', 4); line([x + 9, 40 + bob, z], [x + 16, 52 + bob - Math.sin(now * 20) * 4, z], '#F6D6B8', 4); }
      else if (mode === 'heat') { for (let k = 0; k < 2; k++) { const f = ((now * 1.4 + i * 0.37 + k * 0.5) % 1); disc([x + (k ? 9 : -9), 62 + bob - f * 22, z + 2], 1.8, '#4FA3E8', 3); } text([x, 74 + bob, z], '暑…', 10, '#E85D04', true); }
      else if (mode === 'evac') { text([x, 74 + bob, z], '！', 13, PAL.warn, true); }
      else if (mode === 'check') { box(x + 11, 34 + bob, z - 2, 8, 11, 2, '#fff'); if (w.arrived) text([x, 74 + bob, z], (now - w.arriveT) % 2 < 1.2 ? '安全確認' : '✓', 10, PAL.accentDark, true); }
      else if (mode === 'helper') { text([x, 74 + bob, z], '急げ', 10, PAL.warn, true); }
      else if (after && !w.walking) box(x + 11, 34 + bob, z - 2, 8, 11, 2, '#fff');
      else if (carryBox) box(x, 30 + bob, z - 12, 16, 12, 14, PAL.wood);
      else if (!after) box(x, 28 + bob, z - 10, 6, 5, 8, '#8D99A6');
      end();
    }

    // ---------- LexxMoMa（実機形状：AMR台車＋制御キャビネット＋協働アーム） ----------
    const CAB = '#BCC2C8', CAB_DOOR = '#B0B7BE', CAB_EDGE = '#8E969F', ARM = '#E4E7EA', ARM_BLACK = '#2A2F35';
    const L1 = 112, L2 = 96, CAB_TOP = 126;
    const RS = 0.30;   // 実寸比：全高（アーム待機姿勢）≈ 76 ≒ 2.0m（作業者 ≈ 65 ≒ 1.7m）
    function robotAt(k, rnow, now) {
      // 台数で走行区間を等分し、各台は自区間内だけを往復（柵内の1レーン・台同士が重ならない）
      const n = m.units, seg = (LANE_X1 - LANE_X0) / n, cx = LANE_X0 + seg * (k + 0.5);
      const A = n === 1 ? 250 : Math.max(8, (seg - 112 * RS - 12) / 2);
      const xa = cx - A, xb = cx + A;
      const T = 9, ph = ((rnow + k * 2.3) % T) / T;
      let x, moving = false, reach = 0, hold = false;
      if (ph < 0.25) { x = lerp(xa, xb, ease(ph / 0.25)); moving = true; }
      else if (ph < 0.40) { x = xb; reach = ease((ph - 0.25) / 0.15); hold = ph > 0.38; }
      else if (ph < 0.52) { x = xb; reach = 1 - ease((ph - 0.40) / 0.12); hold = true; }
      else if (ph < 0.77) { x = lerp(xb, xa, ease((ph - 0.52) / 0.25)); moving = true; hold = true; }
      else if (ph < 0.90) { x = xa; reach = ease((ph - 0.77) / 0.13); hold = ph < 0.88; }
      else { x = xa; reach = 1 - ease((ph - 0.90) / 0.10); }
      const z = PATH_Z;
      XF = { x, z, s: RS };      // 以降はローカル（実機の相対寸法）で組み立て、描画時に縮尺
      const stopped = robotStopped(), type = evType(), e = evElapsed();
      if (stopped) moving = false;
      const ledCol = stopped ? (Math.sin(now * 10) > 0 ? PAL.warn : '#F5B7B1') : type === 'rush' && Math.sin(now * 14) > 0 ? '#7ED9A5' : moving ? PAL.accent : PAL.primary;

      // ===== 本体（台車＋キャビネット）：凸部品を組立順に描く =====
      const bodyZ = camSpace([x, 60, z])[2];
      curObj = { z: bodyZ, ordered: true };
      box(x, 0, z, 104, 24, 100, '#9DA4AC');                 // AMR 台車
      box(x, 24, z, 110, 5, 106, '#C7CCD2');                 // 台車上のフランジ
      if (facing([x, 12, z + 50], [0, 0, 1])) box(x, 10, z + 50.6, 80, 3, 1, ledCol);   // 状態LED
      if (facing([x + 52, 12, z], [1, 0, 0])) box(x + 52.6, 10, z, 1, 3, 70, ledCol);
      if (facing([x - 52, 12, z], [-1, 0, 0])) box(x - 52.6, 10, z, 1, 3, 70, ledCol);
      box(x, 29, z, 96, 85, 92, CAB, { noTop: true });      // キャビネット側面
      // 面取りした天面（ベベル4面＋天板）
      const yb = 114, yt = CAB_TOP, bx = 48, bz = 46, tx = 38, tz = 36;
      poly([[x - bx, yb, z + bz], [x + bx, yb, z + bz], [x + tx, yt, z + tz], [x - tx, yt, z + tz]], CAB, [0, 0.64, 0.77]);
      poly([[x + bx, yb, z - bz], [x - bx, yb, z - bz], [x - tx, yt, z - tz], [x + tx, yt, z - tz]], CAB, [0, 0.64, -0.77]);
      poly([[x + bx, yb, z + bz], [x + bx, yb, z - bz], [x + tx, yt, z - tz], [x + tx, yt, z + tz]], CAB, [0.77, 0.64, 0]);
      poly([[x - bx, yb, z - bz], [x - bx, yb, z + bz], [x - tx, yt, z + tz], [x - tx, yt, z - tz]], CAB, [-0.77, 0.64, 0]);
      poly([[x - tx, yt, z - tz], [x + tx, yt, z - tz], [x + tx, yt, z + tz], [x - tx, yt, z + tz]], '#C9CED3', [0, 1, 0]);
      poly([[x - 16, yt + 0.4, z - 30], [x + 16, yt + 0.4, z - 30], [x + 16, yt + 0.4, z + 2], [x - 16, yt + 0.4, z + 2]], '#D5D9DD', [0, 1, 0]);   // 取付プレート
      // 扉（前面・側面）
      if (facing([x, 70, z + 46], [0, 0, 1])) {
        poly([[x - 42, 38, z + 46.6], [x + 10, 38, z + 46.6], [x + 10, 108, z + 46.6], [x - 42, 108, z + 46.6]], CAB_DOOR, [0, 0, 1], { stroke: CAB_EDGE });
        poly([[x + 14, 38, z + 46.6], [x + 44, 38, z + 46.6], [x + 44, 108, z + 46.6], [x + 14, 108, z + 46.6]], CAB_DOOR, [0, 0, 1], { stroke: CAB_EDGE });
        line([x + 5, 66, z + 47.2], [x + 5, 78, z + 47.2], '#6B7580', 2.4);
        text([x - 16, 100, z + 47.4], 'LexxMoMa', 7.5, PAL.primary, true);
      }
      if (facing([x + 48, 70, z], [1, 0, 0])) {
        poly([[x + 48.6, 38, z + 40], [x + 48.6, 38, z - 8], [x + 48.6, 108, z - 8], [x + 48.6, 108, z + 40]], CAB_DOOR, [1, 0, 0], { stroke: CAB_EDGE });
        line([x + 49.2, 66, z - 2], [x + 49.2, 78, z - 2], '#6B7580', 2.4);
      }
      if (facing([x - 48, 70, z], [-1, 0, 0])) poly([[x - 48.6, 38, z - 40], [x - 48.6, 38, z + 8], [x - 48.6, 108, z + 8], [x - 48.6, 108, z - 40]], CAB_DOOR, [-1, 0, 0], { stroke: CAB_EDGE });
      disc([x + 30, yt + 1.5, z + 26], 3.2, stopped ? ledCol : Math.sin(now * 4) > 0 ? (m.availability >= 95 ? PAL.accent : m.availability >= 90 ? PAL.yellow : PAL.warn) : '#B9C6D2');
      end();

      // ===== 協働アーム =====
      // 天面より上の部品は常に本体の手前に、下へ伸びた部品は実際の奥行きで並べる
      const sub = (pt, bias) => { const cz = camSpace(pt)[2] + (bias || 0); curObj = { z: pt[1] > CAB_TOP + 2 ? Math.max(bodyZ + 0.5, cz) : cz, ordered: true }; };
      const M = [x, CAB_TOP, z - 14];
      sub([M[0], CAB_TOP + 8, M[2]]);
      cylinder(M[0], CAB_TOP, M[2], 19, 13, ARM_BLACK, 12);          // J1 ベース（黒）
      cylinder(M[0], CAB_TOP + 13, M[2], 19.5, 3, PAL.accent, 12);    // 緑リング
      cylinder(M[0], CAB_TOP + 16, M[2], 15, 12, ARM, 12);            // J1 旋回部
      end();
      const S = [M[0], CAB_TOP + 40, M[2]];                            // J2 肩
      // IK ターゲット：待機姿勢 ⇔ コンベア上のワーク
      const sway = moving ? Math.sin(now * 2 + k) * 6 : 0;
      const Wrest = [x + (n === 1 ? 60 : 0) + sway, 150, S[2] - 110];
      const Wc = toLocal([x, 44, CONV_Z + 4]);
      const Wpick = [Wc[0], Wc[1] + 22 + 30, Wc[2]];   // ワーク底面＝コンベア上面
      const Wt = [lerp(Wrest[0], Wpick[0], reach), lerp(Wrest[1], Wpick[1], reach), lerp(Wrest[2], Wpick[2], reach)];
      let hx = Wt[0] - S[0], hz = Wt[2] - S[2], d = Math.hypot(hx, hz);
      const dirH = d > 1 ? [hx / d, hz / d] : [0, -1];
      let dy = Wt[1] - S[1], D = Math.hypot(d, dy);
      const Dc = clamp(D, L1 - L2 + 8, L1 + L2 - 2);
      if (Dc !== D) { d *= Dc / D; dy *= Dc / D; D = Dc; }
      const phi = Math.atan2(dy, d), alpha = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
      const th1 = phi + alpha;                                          // エルボーアップ
      const E = [S[0] + dirH[0] * Math.cos(th1) * L1, S[1] + Math.sin(th1) * L1, S[2] + dirH[1] * Math.cos(th1) * L1];
      const Wr = [S[0] + dirH[0] * d, S[1] + dy, S[2] + dirH[1] * d];
      const lat = [-dirH[1], 0, dirH[0]];
      const near = (J) => camSpace([J[0] + lat[0], J[1], J[2] + lat[2]])[2] > camSpace([J[0] - lat[0], J[1], J[2] - lat[2]])[2] ? 1 : -1;
      const add = (P, v, s) => [P[0] + v[0] * s, P[1] + v[1] * s, P[2] + v[2] * s];
      const link = (a, b, w, color) => {                                // リンクを3分割して奥行きを正しく
        for (let i = 0; i < 3; i++) {
          const p0 = [lerp(a[0], b[0], i / 3), lerp(a[1], b[1], i / 3), lerp(a[2], b[2], i / 3)];
          const p1 = [lerp(a[0], b[0], (i + 1) / 3), lerp(a[1], b[1], (i + 1) / 3), lerp(a[2], b[2], (i + 1) / 3)];
          sub([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2]);
          line(p0, p1, color, w); end();
        }
      };
      const joint = (J, hl, w) => {                                     // 関節ハウジング（横向きカプセル）＋手前側に緑リング
        const s = near(J);
        sub(J, 0.4);
        line(add(J, lat, -hl), add(J, lat, hl), ARM, w);
        line(add(J, lat, s * (hl - 1)), add(J, lat, s * (hl + 3)), PAL.accent, w + 2);
        line(add(J, lat, s * (hl + 3)), add(J, lat, s * (hl + 5)), ARM, w - 4);
        end();
      };
      // J1 → J2 の立ち上がり
      sub([S[0], CAB_TOP + 34, S[2]]); line([M[0], CAB_TOP + 26, M[2]], S, ARM, 22); end();
      link(S, E, 22, ARM);            // 上腕
      link(E, Wr, 16, ARM);           // 前腕
      joint(S, 15, 30);               // J2 肩
      joint(E, 12, 25);               // J3 肘
      joint(Wr, 8, 17);               // J5 手首
      // ツール（黒フランジ＋グリッパ）・手首カメラ
      const T1 = [Wr[0], Wr[1] - 14, Wr[2]], TE = [Wr[0], Wr[1] - 30, Wr[2]];
      sub(T1, 0.2);
      line([Wr[0], Wr[1] - 6, Wr[2]], T1, PAL.accent, 16);
      line(T1, TE, ARM_BLACK, 14);
      if (m.hand) {
        line(add(TE, [dirH[0], 0, dirH[1]], -15), add(TE, [dirH[0], 0, dirH[1]], 15), ARM_BLACK, 7);
        disc(add(add(TE, [dirH[0], 0, dirH[1]], -12), [0, 1, 0], -5), 4.5, ARM_BLACK);
        disc(add(add(TE, [dirH[0], 0, dirH[1]], 12), [0, 1, 0], -5), 4.5, ARM_BLACK);
      }
      end();
      if (m.hand && hold) { sub([TE[0], TE[1] - 14, TE[2]], 0.1); box(TE[0], TE[1] - 22, TE[2], 30, 13, 22, PAL.wood); end(); }
      if (m.camera) {
        const s = near(Wr), C0 = add([Wr[0], Wr[1] - 8, Wr[2]], lat, s * 13);
        sub(C0, 0.6);
        box(C0[0], C0[1] - 6, C0[2], 11, 12, 11, ARM_BLACK);
        disc([C0[0] + dirH[0] * 6, C0[1] - 2, C0[2] + dirH[1] * 6], 2.6, PAL.yellow);
        end();
      }
      // 状態ラベル
      XF = null;                  // 状態ラベルはワールド座標・等倍文字
      if (stopped) text([x, 100, z], '緊急停止', 11, PAL.warn, true);
      else if (type === 'quake' && e < 7.5) text([x, 100, z], '復旧 ✓ 即時再開', 11, PAL.accentDark, true);
      else if (type === 'rush') text([x, 100, z], '増速 ×1.9', 10, PAL.orange, true);
    }

    // ---------- HUD（2D） ----------
    function hud() {
      const night = m.shifts >= 3, dusk = m.shifts === 2;
      const type = evType(), e = evElapsed();
      ctx.save();
      if (type === 'heat') { ctx.fillStyle = 'rgba(255,140,0,0.10)'; ctx.fillRect(0, 0, W, H); ctx.font = '26px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('☀', W / 2 + 140, 32); }
      rrect(14, 12, 236, 40, 7, night ? '#1F2933' : '#fff', PAL.primary);
      ctx.font = '700 17px sans-serif'; ctx.fillStyle = PAL.primary; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(m.grade, 28, 32);
      ctx.font = '15px sans-serif'; ctx.fillStyle = PAL.yellow; ctx.fillText('★'.repeat(m.stars), 160, 32);
      ctx.fillStyle = night ? '#5A6980' : '#C9CFD6'; ctx.fillText('★'.repeat(4 - m.stars), 160 + m.stars * 15.5, 32);
      const badge = `${m.shifts}直 ${night ? '🌙 24時間稼働' : dusk ? '🌇 夕方も稼働' : '☀ 日勤のみ'}`;
      ctx.font = '12px sans-serif'; const bw = ctx.measureText(badge).width + 26;
      rrect(W - bw - 14, 14, bw, 26, 13, night ? '#1F2933' : '#fff', night ? '#FFE08A' : '#B9C6D2');
      ctx.fillStyle = night ? '#FFE08A' : PAL.text; ctx.textAlign = 'center'; ctx.fillText(badge, W - bw / 2 - 14, 27);
      // イベントバナー
      if (type) {
        const def = EVENTS[type], prog = clamp(e / def.dur, 0, 1);
        let sub = '';
        if (type === 'rush') sub = 'フル稼働の指示 — 人：焦り・残業　／　LexxMoMa：速度アップで淡々と対応';
        else if (type === 'heat') sub = '人：汗・作業量ダウン・熱中症リスク　／　LexxMoMa：変わらず稼働';
        else if (type === 'quake') sub = e < 3 ? '人：避難　／　LexxMoMa：緊急停止' : e < 5 ? '揺れ収束 — 安全確認へ' : `復旧：LexxMoMa 即時再開 ✓　／　人：安全確認中… あと ${Math.ceil(def.dur - e)} 秒`;
        else sub = 'イベントが重なり作業者が倒れました — 人に依存した生産の脆さ';
        ctx.font = '700 13px sans-serif';
        const title = def.label, tw = ctx.measureText(title).width;
        ctx.font = '11px sans-serif'; const sw = ctx.measureText(sub).width;
        const bwid = Math.min(W - 40, Math.max(tw, sw) + 36), bx = (W - bwid) / 2;
        rrect(bx, 58, bwid, 46, 8, night ? 'rgba(31,41,51,.94)' : 'rgba(255,255,255,.95)', def.color);
        ctx.fillStyle = def.color; ctx.font = '700 13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(title, W / 2, 72);
        ctx.fillStyle = night ? '#E8EDF2' : PAL.text; ctx.font = '11px sans-serif';
        ctx.save(); ctx.beginPath(); ctx.rect(bx + 4, 58, bwid - 8, 46); ctx.clip(); ctx.fillText(sub, W / 2, 90); ctx.restore();
        ctx.fillStyle = '#E5E9EE'; ctx.fillRect(bx + 10, 100, bwid - 20, 3); ctx.fillStyle = def.color; ctx.fillRect(bx + 10, 100, (bwid - 20) * (1 - prog), 3);
      }
      // 年間効果・回収
      const eff = `年間効果 ${C.fmtMan(m.saving)} 万円`;
      const pb = m.payback === null ? (m.robot ? `${m.years}年内 未回収` : '') : `回収 ${C.fmtYears(m.payback)} 年`;
      const pbc = { green: PAL.accent, yellow: PAL.yellow, grey: PAL.grey }[m.color];
      ctx.font = '700 12px sans-serif'; const ew = ctx.measureText(eff).width + 44, pw = pb ? ctx.measureText(pb).width + 30 : 0;
      rrect(W - ew - pw - 24, H - 40, ew, 28, 6, night ? '#1F2933' : '#fff', PAL.goldDark);
      ctx.fillStyle = PAL.gold; ctx.beginPath(); ctx.arc(W - ew - pw - 24 + 18, H - 26, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5A4300'; ctx.font = '700 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('¥', W - ew - pw - 24 + 18, H - 25.5);
      ctx.fillStyle = night ? '#E8EDF2' : PAL.text; ctx.font = '700 12px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(eff, W - ew - pw - 24 + 34, H - 26);
      if (pb) { rrect(W - pw - 14, H - 40, pw, 28, 6, pbc, pbc); ctx.fillStyle = m.color === 'yellow' ? PAL.text : '#fff'; ctx.textAlign = 'center'; ctx.fillText(pb, W - pw / 2 - 14, H - 26); }
      // 次のアンロック
      ctx.font = '11px sans-serif'; const nx = `次：${m.next}`; const nw = Math.min(W - ew - pw - 60, ctx.measureText(nx).width + 22);
      rrect(14, H - 36, nw, 22, 11, night ? 'rgba(31,41,51,.9)' : 'rgba(255,255,255,.92)', null);
      ctx.fillStyle = night ? '#C9D3DE' : PAL.muted; ctx.textAlign = 'left';
      ctx.save(); ctx.beginPath(); ctx.rect(14, H - 36, nw, 22); ctx.clip(); ctx.fillText(nx, 24, H - 25); ctx.restore();
      ctx.restore();
    }
    function rrect(x, y, w, h, r, fill, stroke) {
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke(); }
    }

    // ---------- フレーム ----------
    function frame(now) {
      if (!m) return;
      const q = evType() === 'quake' && evElapsed() < 3 ? (1 - evElapsed() / 3) : 0;
      const yawOff = q ? Math.sin(now * 47) * 0.02 * q : 0, pitchOff = q ? Math.cos(now * 39) * 0.012 * q : 0;
      cy = Math.cos(cam.yaw + yawOff); sy = Math.sin(cam.yaw + yawOff); cp = Math.cos(cam.pitch + pitchOff); sp = Math.sin(cam.pitch + pitchOff);
      prims = []; bg = []; seq = 0;
      drawWorld(now);
      const order = (a, b) => (a.oz - b.oz) || (a.z - b.z) || (a.seq - b.seq);
      prims.sort(order);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = m.shifts >= 3 ? '#1B2430' : m.shifts === 2 ? '#F7EBDD' : '#F1F5F9'; ctx.fillRect(0, 0, W, H);
      ctx.save();
      if (q) ctx.translate((Math.random() - 0.5) * 10 * q, (Math.random() - 0.5) * 8 * q);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const drawList = list => {
        for (const p of list) {
          if (p.t === 'poly') {
            ctx.beginPath(); ctx.moveTo(p.pp[0].x, p.pp[0].y); for (let i = 1; i < p.pp.length; i++) ctx.lineTo(p.pp[i].x, p.pp[i].y); ctx.closePath();
            ctx.fillStyle = p.color; ctx.fill();
            if (p.stroke) { ctx.strokeStyle = p.stroke; ctx.lineWidth = 1; ctx.stroke(); }
          } else if (p.t === 'line') {
            ctx.beginPath(); ctx.moveTo(p.pa.x, p.pa.y); ctx.lineTo(p.pb.x, p.pb.y); ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(0.6, p.w); ctx.stroke();
          } else if (p.t === 'disc') {
            ctx.beginPath(); ctx.arc(p.pc.x, p.pc.y, Math.max(0.5, p.r), 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill();
          } else if (p.t === 'text') {
            if (p.size < 4) continue;
            ctx.font = `${p.bold ? '700 ' : ''}${p.size.toFixed(1)}px sans-serif`; ctx.fillStyle = p.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(p.str, p.pc.x, p.pc.y);
          }
        }
      };
      drawList(bg);          // 床・壁は常に最初
      drawList(prims);
      ctx.restore();
      hud();
    }
    function loop(ts) {
      raf = 0;
      if (!running) return;
      if (document.hidden) { raf = requestAnimationFrame(loop); return; }
      const rect = canvas.getBoundingClientRect();
      const visible = rect.bottom > 0 && rect.top < window.innerHeight;
      if (ts - last >= 33) {
        const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
        last = ts; t += dt; rt += dt * robotSpeed();
        tickEvents(dt);
        updateWorkers(dt, view === 'after' && m.robot);
        if (visible) frame(t);
      }
      raf = requestAnimationFrame(loop);
    }
    function start() { if (!raf) raf = requestAnimationFrame(loop); }
    function resize() {
      dpr = window.devicePixelRatio || 1;
      W = Math.max(320, canvas.clientWidth || canvas.parentElement.clientWidth);
      cam.F = W * 1.9;
      canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (m) frame(t);
    }

    // ---------- 操作 ----------
    let drag = null;
    canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch }; canvas.classList.add('drag'); canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!drag) return;
      cam.yaw = drag.yaw + (e.clientX - drag.x) * 0.006;
      cam.pitch = clamp(drag.pitch + (e.clientY - drag.y) * 0.005, 0.12, 1.25);
      if (!running) frame(t);
    });
    const endDrag = () => { drag = null; canvas.classList.remove('drag'); };
    canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist = clamp(cam.dist * (e.deltaY > 0 ? 1.08 : 0.93), 1100, 4200); if (!running) frame(t); }, { passive: false });
    window.addEventListener('resize', resize);

    // ---------- 公開API ----------
    function update(p, r, state) {
      const hadRobot = m && m.robot;
      m = factoryModel(p, r, state);
      if (!m.robot) view = 'before';
      else if (!hadRobot) view = userView || 'after';
      else view = userView || view;
      onView(view);
      resize();
      start();
      return m;
    }
    function setView(v) { userView = v; view = m && !m.robot ? 'before' : v; onView(view); frame(t); }
    function toggle() { running = !running; if (running) { last = 0; start(); } return running; }
    function resetCamera() { Object.assign(cam, DEF); frame(t); }
    resize();
    return { update, setView, toggle, resetCamera, trigger, cam, get running() { return running; }, get event() { return ev; }, get eventCount() { return evCount; }, EVENTS };
  }

  root.LXSCENE = { factoryModel, create, EVENTS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
