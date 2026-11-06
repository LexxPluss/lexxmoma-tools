/* =====================================================================
 * 動きの時間の計算（台形速度・アームの関節動作）
 *  - 依存なし。ブラウザでは window.MOTION、Node では module.exports（テストと共有）
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MOTION = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  /* ---------------- 台形速度プロファイル ----------------
   * 距離 d、加速度 a（＝減速度）、最大速度 vmax */
  function trapDur(d, a, vmax) {
    d = Math.abs(d);
    if (d < 1e-9) return 0;
    const da = vmax * vmax / a;          // 加減速で進む距離の合計
    if (d < da) return 2 * Math.sqrt(d / a);   // 三角プロファイル
    return d / vmax + vmax / a;
  }
  function trapPos(t, d, a, vmax) {
    d = Math.abs(d);
    if (d < 1e-9) return 0;
    const T = trapDur(d, a, vmax);
    t = clamp(t, 0, T);
    const da = vmax * vmax / a;
    if (d < da) { // 三角
      const tp = T / 2;
      return (t <= tp) ? 0.5 * a * t * t : d - 0.5 * a * (T - t) * (T - t);
    }
    const ta = vmax / a;
    if (t <= ta) return 0.5 * a * t * t;
    if (t <= T - ta) return 0.5 * a * ta * ta + vmax * (t - ta);
    return d - 0.5 * a * (T - t) * (T - t);
  }

  /* ---------------- アームの関節動作（FANUC の J 動作） ----------------
   * 全関節が同時に動き始め、同時に止まる。どの時刻でも全関節が同じ割合だけ進む（関節の空間で直線）。
   * 進み具合 s（0→1）を 1 本の台形で動かし、その速度・加速度の上限は、
   * 各関節の上限 ÷ その関節の移動量 の一番小さいもの（＝一番きつい関節）で決める。
   * joints[i] = { a: 角加速度, w: 角速度 }（rad/s², rad/s）。戻り値 { dur, at(t) → q } */
  function jointMove(qs, qg, joints) {
    const dq = qg.map((v, i) => v - qs[i]);
    let ws = Infinity, as = Infinity;
    dq.forEach((d, i) => {
      const ad = Math.abs(d);
      if (ad < 1e-9) return;
      ws = Math.min(ws, joints[i].w / ad);
      as = Math.min(as, joints[i].a / ad);
    });
    if (!isFinite(ws)) return { dur: 0, at: () => qg.slice() };
    const dur = trapDur(1, as, ws);
    return {
      dur,
      at: (t) => {
        if (t >= dur) return qg.slice();
        const s = trapPos(t, 1, as, ws);
        return qs.map((v, i) => v + dq[i] * s);
      },
    };
  }

  return { trapDur, trapPos, jointMove };
});
