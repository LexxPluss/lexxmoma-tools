/* =====================================================================
 * アームと設備（箱）の当たり判定
 *  - アームは、関節の点を結ぶ太さのある棒（カプセル）の並びとみなす。太さは実機の外形のおおよそ＋隙間
 *  - 設備は、向き yaw の直方体（中心 x,y・幅 w・奥行 d・底面 z0・高さ h [mm]）
 *  - 手先が触れてよい所（目標の上など）は、allow の球（中心 p・半径 r）の中だけ当たりにしない
 *  - 依存なし。ブラウザでは window.COLLIDE、Node では module.exports（テストと共有）
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.COLLIDE = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* アームの棒: [始点, 終点, 半径 mm]。点の名前は CRX.fk の points（mount は取付面の中心）。
   * 半径は CRX-20iA/L の外形を目で見たおおよその値に、隙間 30 mm 前後を足したもの（公式の値ではない） */
  const LINKS = [
    ["mount", "j2", 110],    // J1 の台座
    ["j2", "j3", 100],       // 上腕
    ["j3", "j5", 90],        // 前腕
    ["j5", "j6", 80],        // 手首
    ["j6", "flange", 70],
    ["flange", "tcp", 40],   // ツール
  ];
  const MAX_R = Math.max(...LINKS.map(l => l[2]));
  const STEP = 15;           // 棒の上を調べる間隔 [mm]
  const ALLOW_R = 200;       // 手先が触れてよい球の半径 [mm]（ツール 150 mm ＋ フランジの先）

  /* 点 p から箱 o までの距離 [mm]（中なら 0） */
  function pointBoxDist(p, o) {
    const c = Math.cos(-(o.yaw || 0)), s = Math.sin(-(o.yaw || 0));
    const dx = p[0] - o.x, dy = p[1] - o.y;
    const lx = dx * c - dy * s, ly = dx * s + dy * c;
    const z0 = o.z0 || 0;
    const ex = Math.max(0, Math.abs(lx) - o.w / 2);
    const ey = Math.max(0, Math.abs(ly) - o.d / 2);
    const ez = Math.max(0, z0 - p[2], p[2] - (z0 + o.h));
    return Math.hypot(ex, ey, ez);
  }
  const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  /* アームの点（床基準のワールド座標 [mm]）が、どれかの箱に当たるか。
   * 当たれば { box, link（LINKS の番号）}、当たらなければ null。allows: [{ p, r }]（触れてよい球） */
  function armHit(pts, boxes, allows) {
    allows = allows || [];
    // アーム全体を囲む箱（いちばん太い棒の分だけ広げる）と重ならない設備は、細かく調べない
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const k in pts) { const p = pts[k]; x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
    boxes = boxes.filter(o => {
      const e = Math.hypot(o.w, o.d) / 2 + MAX_R, bz = o.z0 || 0;
      return o.x + e >= x0 && o.x - e <= x1 && o.y + e >= y0 && o.y - e <= y1 && bz + o.h + MAX_R >= z0 && bz - MAX_R <= z1;
    });
    if (!boxes.length) return null;
    for (let li = 0; li < LINKS.length; li++) {
      const [ka, kb, rad] = LINKS[li], a = pts[ka], b = pts[kb];
      if (!a || !b) continue;
      const len = dist3(a, b), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const near = boxes.filter(o => pointBoxDist(mid, o) < len / 2 + rad); // 中点から遠い設備には、この棒のどこも届かない
      if (!near.length) continue;
      const n = Math.max(1, Math.ceil(len / STEP));
      for (let k = 0; k <= n; k++) {
        const t = k / n, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        if (allows.some(al => dist3(p, al.p) <= al.r)) continue;
        for (const o of near) if (pointBoxDist(p, o) < rad) return { box: o, link: li };
      }
    }
    return null;
  }

  return { LINKS, ALLOW_R, pointBoxDist, armHit };
});
