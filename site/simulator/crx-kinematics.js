/* =====================================================================
 * FANUC CRX-20iA/L 運動学（順運動学・逆運動学）
 *  - 単位: 長さ mm / 角度 rad（定数表は deg で書き、読み込み時に変換）
 *  - 関節の配置・可動範囲・最大速度は FANUC 公式の ROS 2 記述
 *    (FANUC-CORPORATION/fanuc_description, fanuc_crx_description/urdf/
 *     crx20ia_l_urdf_macro.xacro, Apache-2.0) の値をそのまま使う。
 *  - 依存なし。ブラウザでは window.CRX、Node では module.exports。
 *
 * 座標系（アーム基準座標 = URDF の wbase）:
 *   原点 = J1 回転軸上・取付面から 245 mm 上（J1 と J2 の交点）、x 前、y 左、z 上
 *   全関節 0° の姿勢: 上腕（710）が真上、前腕（540）が前（+x）、
 *   フランジ中心 = (700, -150, 710)、手首の横オフセット 150 mm は -y 側
 *
 * 行列は 4x4 の行優先 16 要素配列（m[r*4+c]）。
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CRX = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  /* ---------------- モデル定数（公式 xacro の値） ---------------- */
  const L = { base: 245, l1: 0, l2: 710, l3: 0, l4: 540, l5: 150, l6: 160 };
  const MODEL = {
    name: "FANUC CRX-20iA/L",
    reach: 1418,                   // カタログ値 [mm]
    L,
    // 各関節: 親フレームでの原点 [mm] と回転軸（単位ベクトル）。J1 の原点は base_link 基準。
    joints: [
      { name: "J1", origin: [L.l1, 0, L.base], axis: [0, 0, 1] },
      { name: "J2", origin: [0, 0, 0],         axis: [0, 1, 0] },
      { name: "J3", origin: [0, 0, L.l2],      axis: [0, -1, 0] },
      { name: "J4", origin: [0, 0, L.l3],      axis: [-1, 0, 0] },
      { name: "J5", origin: [L.l4, 0, 0],      axis: [0, -1, 0] },
      { name: "J6", origin: [0, -L.l5, 0],     axis: [-1, 0, 0] },
    ],
    flange: [L.l6, 0, 0],          // J6 フレームでのフランジ中心
    // フランジ座標 → FANUC フランジ座標（z がツール方向、rpy = 180°, -90°, 0°）
    fanucFlangeRot: [0, 0, 1, 0, -1, 0, 1, 0, 0],
    limitsDeg: [[-179.9, 179.9], [-179.9, 179.9], [-270, 270], [-190, 190], [-179.9, 179.9], [-225, 225]],
    vmaxDeg: [80, 80, 120, 112.5, 90, 112.5],   // 最大角速度 [°/s]（公式）
    accTime: 0.4,                               // 角加速度は非公開: 最大速度に 0.4 s で到達する仮定
    // 衝突判定用メッシュ（collision/*.stl, mm）の各リンクフレームでの配置（公式 xacro の collision origin）
    meshOffsets: {
      base: [0, 0, 0],
      j1: [0, 0, 127.7 - L.base],
      j2: [-L.l1, 0, 245 - L.base],
      j3: [-L.l1, 0, 955 - L.base - L.l2],
      j4: [540 - L.l1, 0, 955 - L.base - L.l2 - L.l3],
      j5: [540 - L.l1 - L.l4, -150, 955 - L.base - L.l2 - L.l3],
      j6: [700 - L.l1 - L.l4, -150 + L.l5, 955 - L.base - L.l2 - L.l3],
    },
  };
  MODEL.limits = MODEL.limitsDeg.map(([a, b]) => [a * D2R, b * D2R]);
  MODEL.vmax = MODEL.vmaxDeg.map(v => v * D2R);
  MODEL.accDeg = MODEL.vmaxDeg.map(v => Math.round(v / MODEL.accTime * 10) / 10);
  MODEL.acc = MODEL.accDeg.map(v => v * D2R);

  /* ---------------- 4x4 行列ユーティリティ ---------------- */
  function ident() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  function mul(a, b) {
    const r = new Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      r[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j] + a[i * 4 + 3] * b[12 + j];
    }
    return r;
  }
  function translation(v) { const m = ident(); m[3] = v[0]; m[7] = v[1]; m[11] = v[2]; return m; }
  // 任意軸回りの回転（ロドリゲス）
  function rotAxis(axis, th) {
    const [x, y, z] = axis, c = Math.cos(th), s = Math.sin(th), t = 1 - c;
    return [
      t * x * x + c,     t * x * y - s * z, t * x * z + s * y, 0,
      t * x * y + s * z, t * y * y + c,     t * y * z - s * x, 0,
      t * x * z - s * y, t * y * z + s * x, t * z * z + c,     0,
      0, 0, 0, 1,
    ];
  }
  function fromRotPos(R, p) { // R: 3x3 行優先 9 要素, p: [x,y,z]
    return [R[0], R[1], R[2], p[0], R[3], R[4], R[5], p[1], R[6], R[7], R[8], p[2], 0, 0, 0, 1];
  }
  function rotOf(m) { return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]; }
  function posOf(m) { return [m[3], m[7], m[11]]; }
  function transformPoint(m, p) {
    return [
      m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
      m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
      m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
    ];
  }
  function transformDir(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
      m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
    ];
  }
  function invRigid(m) { // 剛体変換の逆行列
    const R = rotOf(m), p = posOf(m);
    const Rt = [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
    const q = [-(Rt[0] * p[0] + Rt[1] * p[1] + Rt[2] * p[2]),
               -(Rt[3] * p[0] + Rt[4] * p[1] + Rt[5] * p[2]),
               -(Rt[6] * p[0] + Rt[7] * p[1] + Rt[8] * p[2])];
    return fromRotPos(Rt, q);
  }
  function mul3(a, b) {
    const r = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    return r;
  }
  function transpose3(R) { return [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]; }
  // 回転行列 → 回転ベクトル（軸×角）
  function rotToVec(R) {
    const tr = R[0] + R[4] + R[8];
    const c = Math.min(1, Math.max(-1, (tr - 1) / 2));
    const th = Math.acos(c);
    if (th < 1e-9) return [0, 0, 0];
    if (Math.PI - th < 1e-5) { // 180° 付近: 対角から軸を取る
      const x = Math.sqrt(Math.max(0, (R[0] + 1) / 2)), y = Math.sqrt(Math.max(0, (R[4] + 1) / 2)), z = Math.sqrt(Math.max(0, (R[8] + 1) / 2));
      const sx = (R[7] - R[5]) < 0 ? -1 : 1, sy = (R[2] - R[6]) < 0 ? -1 : 1, sz = (R[3] - R[1]) < 0 ? -1 : 1;
      return [sx * x * th, sy * y * th, sz * z * th];
    }
    const k = th / (2 * Math.sin(th));
    return [(R[7] - R[5]) * k, (R[2] - R[6]) * k, (R[3] - R[1]) * k];
  }

  /* ---------------- FANUC の WPR（固定軸 XYZ オイラー角、deg） ----------------
   * R = Rz(R) · Ry(P) · Rx(W) */
  function wprToRot(w, p, r) {
    const Rx = rotAxis([1, 0, 0], w * D2R), Ry = rotAxis([0, 1, 0], p * D2R), Rz = rotAxis([0, 0, 1], r * D2R);
    return rotOf(mul(Rz, mul(Ry, Rx)));
  }
  function rotToWPR(R) {
    const p = Math.atan2(-R[6], Math.hypot(R[0], R[3]));
    let w, r;
    if (Math.abs(Math.cos(p)) < 1e-9) { // ジンバルロック: R=0 に固定
      r = 0; w = Math.atan2(R[1], R[4]) * (p > 0 ? 1 : -1);
      if (p > 0) w = Math.atan2(R[1], R[4]); else w = -Math.atan2(R[1], R[4]);
    } else {
      w = Math.atan2(R[7], R[8]);
      r = Math.atan2(R[3], R[0]);
    }
    return [w * R2D, p * R2D, r * R2D];
  }

  /* ---------------- 順運動学 ----------------
   * q: 6 関節角 [rad]、toolLen: FANUC フランジ z 方向のツール長 [mm]
   * 戻り値: { frames: [T_J1..T_J6]（各関節回転後のリンクフレーム、base_link 基準）,
   *           flange: T, fanucFlange: T, tcp: T,
   *           points: { j1, j2, j3, j4, j5, j6, flange, tcp }（base_link 基準の位置 [mm]） }
   * base_link 原点 = アーム取付面の中心（J1 原点はその 245 mm 上） */
  function fk(q, toolLen) {
    toolLen = toolLen || 0;
    let T = ident();
    const frames = [], points = {};
    for (let i = 0; i < 6; i++) {
      const j = MODEL.joints[i];
      T = mul(T, translation(j.origin));
      points["j" + (i + 1)] = posOf(T);
      T = mul(T, rotAxis(j.axis, q[i] || 0));
      frames.push(T);
    }
    const flange = mul(T, translation(MODEL.flange));
    const fanucFlange = mul(flange, fromRotPos(MODEL.fanucFlangeRot, [0, 0, 0]));
    const tcp = mul(fanucFlange, translation([0, 0, toolLen]));
    points.flange = posOf(flange);
    points.tcp = posOf(tcp);
    return { frames, flange, fanucFlange, tcp, points };
  }

  /* wbase（J1 原点・アーム基準座標）基準に直す平行移動 */
  const T_base_to_wbase = translation([0, 0, -L.base]);
  function toWbase(T) { return mul(T_base_to_wbase, T); }
  function fromWbase(T) { return mul(translation([0, 0, L.base]), T); }

  /* TCP の要約（アーム基準座標 wbase で表現） */
  function tcpInfo(q, toolLen) {
    const f = fk(q, toolLen);
    const Tw = toWbase(f.tcp);
    const p = posOf(Tw);
    const wpr = rotToWPR(rotOf(Tw));
    return {
      x: p[0], y: p[1], z: p[2],
      w: wpr[0], p: wpr[1], r: wpr[2],
      horizontal: Math.hypot(p[0], p[1]),   // J1 軸からの水平距離
      heightAboveMount: p[2] + L.base,       // 取付面からの高さ
      fk: f,
    };
  }

  function clampLimits(q) {
    return q.map((v, i) => Math.min(MODEL.limits[i][1], Math.max(MODEL.limits[i][0], v)));
  }
  function withinLimits(q, margin) {
    margin = margin || 0;
    return q.every((v, i) => v >= MODEL.limits[i][0] - margin && v <= MODEL.limits[i][1] + margin);
  }

  /* ---------------- 逆運動学（減衰最小二乗法） ----------------
   * target: TCP の目標姿勢（base_link 基準の 4x4）、q0: 初期値、toolLen: ツール長
   * opts: { iters=150, posTol=0.05 mm, rotTol=1e-4 rad, lambda=0.05, rotWeight=... , respectLimits=true }
   * 戻り値: { q, ok, posErr, rotErr, iters }。ok=false でも最も近づいた q を返す。 */
  function ik(target, q0, toolLen, opts) {
    opts = opts || {};
    const iters = opts.iters || 150, posTol = opts.posTol || 0.05, rotTol = opts.rotTol || 1e-4;
    const lambda0 = opts.lambda || 0.05;
    const respect = opts.respectLimits !== false;
    const pT = posOf(target), RT = rotOf(target);
    let q = q0.slice();
    if (respect) q = clampLimits(q);
    let best = null;
    // 位置と姿勢のスケール合わせ: 1 rad ≒ 500 mm として扱う
    const rotScale = opts.rotScale || 500;
    for (let it = 0; it <= iters; it++) {
      const f = fk(q, toolLen);
      const pC = posOf(f.tcp), RC = rotOf(f.tcp);
      const ep = [pT[0] - pC[0], pT[1] - pC[1], pT[2] - pC[2]];
      const er = rotToVec(mul3(RT, transpose3(RC)));
      const posErr = Math.hypot(ep[0], ep[1], ep[2]);
      const rotErr = Math.hypot(er[0], er[1], er[2]);
      const score = posErr + rotErr * rotScale;
      if (!best || score < best.score) best = { q: q.slice(), score, posErr, rotErr, iters: it };
      if (posErr < posTol && rotErr < rotTol) return { q, ok: true, posErr, rotErr, iters: it };
      if (it === iters) break;
      // 幾何ヤコビアン（6x6）: 列 i = [z_i × (p_tcp - p_i); z_i]
      const J = [];
      for (let i = 0; i < 6; i++) {
        const Ti = f.frames[i];
        const z = transformDir(Ti, MODEL.joints[i].axis);
        const pi = posOf(Ti);
        const d = [pC[0] - pi[0], pC[1] - pi[1], pC[2] - pi[2]];
        const lin = [z[1] * d[2] - z[2] * d[1], z[2] * d[0] - z[0] * d[2], z[0] * d[1] - z[1] * d[0]];
        J.push([lin[0], lin[1], lin[2], z[0] * rotScale, z[1] * rotScale, z[2] * rotScale]); // 行 i = 列 i の転置
      }
      const e = [ep[0], ep[1], ep[2], er[0] * rotScale, er[1] * rotScale, er[2] * rotScale];
      // Δq = Jᵀ (J Jᵀ + λ² I)⁻¹ e
      const lambda = lambda0 * Math.max(1, Math.min(10, score / 50)); // 遠いほど強く減衰
      const A = new Array(36).fill(0);
      for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
        let s = 0;
        for (let k = 0; k < 6; k++) s += J[k][r] * J[k][c];
        A[r * 6 + c] = s + (r === c ? lambda * lambda * rotScale * rotScale * 0.01 : 0);
      }
      const y = solve6(A, e);
      if (!y) break;
      let dq = new Array(6);
      for (let i = 0; i < 6; i++) { let s = 0; for (let k = 0; k < 6; k++) s += J[i][k] * y[k]; dq[i] = s; }
      // 1 ステップの関節変化を制限（発散防止）
      const maxStep = 0.35;
      let mx = 0; for (const v of dq) mx = Math.max(mx, Math.abs(v));
      if (mx > maxStep) dq = dq.map(v => v * maxStep / mx);
      q = q.map((v, i) => v + dq[i]);
      if (respect) q = clampLimits(q);
    }
    return { q: best.q, ok: false, posErr: best.posErr, rotErr: best.rotErr, iters: best.iters };
  }

  // 6x6 連立一次方程式（ガウス消去・部分ピボット）
  function solve6(A, b) {
    const n = 6, M = [];
    for (let r = 0; r < n; r++) { M.push(A.slice(r * n, r * n + n).concat([b[r]])); }
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        if (!f) continue;
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  /* 目標姿勢を「アーム基準座標の位置 [mm] と WPR [deg]」から作る（base_link 基準の 4x4 を返す） */
  function targetFromXYZWPR(x, y, z, w, p, r) {
    return fromWbase(fromRotPos(wprToRot(w, p, r), [x, y, z]));
  }

  /* ---------------- 旧 2D 形式（q1, reach）からの変換 ----------------
   * 旧シミュレーターのアーム姿勢は「1 軸角 q1 と水平リーチ reach」だけだった。
   * ツールを真下に向け、TCP を J1 軸から水平距離 reach・高さ = J1 原点（取付面 +245 mm）に置く姿勢に変換する。
   * 届かない距離は IK が最も近い姿勢を返す。 */
  function fromLegacy(q1, reach, toolLen) {
    reach = Math.max(200, Math.min(reach || 1000, 1240));
    const hx = Math.cos(q1), hy = Math.sin(q1);
    // 目標: 位置 (reach·cos, reach·sin, 0)、z 軸 = 真下、x 軸 = 半径方向外向き
    const Rz = [0, 0, -1];
    const Rx = [hx, hy, 0];
    const Ry = [Rz[1] * Rx[2] - Rz[2] * Rx[1], Rz[2] * Rx[0] - Rz[0] * Rx[2], Rz[0] * Rx[1] - Rz[1] * Rx[0]];
    const R = [Rx[0], Ry[0], Rz[0], Rx[1], Ry[1], Rz[1], Rx[2], Ry[2], Rz[2]];
    const target = fromWbase(fromRotPos(R, [reach * hx, reach * hy, 0]));
    // 初期値: 前方に伸ばして手首を下に向けた姿勢（J5 = J2 - J3 - 90°）
    const j2 = 50 * D2R, j3 = 10 * D2R;
    const seed = [q1, j2, j3, 0, j2 - j3 - Math.PI / 2, 0];
    const res = ik(target, seed, toolLen || 0, { iters: 300 });
    return res.q;
  }

  /* 旧 2D 形式の見かけの値（1 軸角と水平リーチ）を 6 軸姿勢から求める */
  function toLegacy(q, toolLen) {
    const info = tcpInfo(q, toolLen);
    return { q1: Math.atan2(info.y, info.x), reach: info.horizontal };
  }

  /* 2D ビュー用: 上から見たアーム各点の位置（base_link 基準 [mm]、z 付き） */
  function topViewPoints(q, toolLen) {
    const f = fk(q, toolLen);
    return f.points;
  }

  return {
    MODEL, D2R, R2D,
    ident, mul, translation, rotAxis, fromRotPos, rotOf, posOf, transformPoint, transformDir, invRigid, rotToVec, rotToWPR, wprToRot,
    fk, ik, tcpInfo, toWbase, fromWbase, targetFromXYZWPR, clampLimits, withinLimits,
    fromLegacy, toLegacy, topViewPoints,
  };
});
