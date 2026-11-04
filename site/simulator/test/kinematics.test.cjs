// CRX-20iA/L 運動学のテスト:  node --test site/simulator/test/kinematics.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const CRX = require("../crx-kinematics.js");

const D2R = Math.PI / 180;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} expected ${b} got ${a} (tol ${tol})`);

test("全関節 0° でフランジは (700, -150, 955) [base_link 基準]", () => {
  const f = CRX.fk([0, 0, 0, 0, 0, 0]);
  near(f.points.flange[0], 700, 1e-6); near(f.points.flange[1], -150, 1e-6); near(f.points.flange[2], 955, 1e-6);
  near(f.points.j2[2], 245, 1e-6, "J2 高さ"); near(f.points.j3[2], 955, 1e-6, "J3 高さ"); near(f.points.j5[0], 540, 1e-6, "J5 前後");
});

test("0° 姿勢では FANUC フランジの z（ツール方向）は +x を向く", () => {
  const f = CRX.fk([0, 0, 0, 0, 0, 0]);
  const z = CRX.transformDir(f.fanucFlange, [0, 0, 1]);
  near(z[0], 1, 1e-9); near(z[1], 0, 1e-9); near(z[2], 0, 1e-9);
  const t = CRX.fk([0, 0, 0, 0, 0, 0], 100);
  near(t.points.tcp[0], 800, 1e-6, "ツール長 100 で TCP は 100 mm 前へ");
});

test("J1 を 90° 回すとフランジは +y 側へ回る", () => {
  const f = CRX.fk([90 * D2R, 0, 0, 0, 0, 0]);
  near(f.points.flange[0], 150, 1e-6); near(f.points.flange[1], 700, 1e-6);
});

test("J2 を +90° で上腕は前へ倒れる（J3 は J2 の 710 mm 前）", () => {
  const f = CRX.fk([0, 90 * D2R, 0, 0, 0, 0]);
  near(f.points.j3[0], 710, 1e-6); near(f.points.j3[2], 245, 1e-6);
});

test("WPR と回転行列の相互変換", () => {
  for (const [w, p, r] of [[0, 0, 0], [30, -40, 120], [-170, 60, -45], [180, 0, 90]]) {
    const R = CRX.wprToRot(w, p, r);
    const back = CRX.rotToWPR(R);
    const R2 = CRX.wprToRot(...back);
    for (let i = 0; i < 9; i++) near(R2[i], R[i], 1e-9, `WPR ${w},${p},${r}`);
  }
});

test("IK は FK の姿勢を復元する（ランダム 60 姿勢）", () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let okCount = 0;
  for (let n = 0; n < 60; n++) {
    const q = CRX.MODEL.limits.map(([lo, hi]) => (lo + (hi - lo) * rnd()) * 0.6);
    const target = CRX.fk(q, 80).tcp;
    const q0 = q.map(v => v + (rnd() - 0.5) * 0.6); // ±17° 程度ずらした初期値
    const res = CRX.ik(target, q0, 80);
    if (res.ok) okCount++;
    assert.ok(res.posErr < 0.5, `pos err ${res.posErr}`);
    assert.ok(res.rotErr < 2e-3, `rot err ${res.rotErr}`);
  }
  assert.ok(okCount >= 55, `収束 ${okCount}/60`);
});

test("届かない目標でも ok=false で最も近い姿勢を返す", () => {
  const target = CRX.targetFromXYZWPR(3000, 0, 0, 0, 0, 0);
  const res = CRX.ik(target, [0, 0.5, 0.2, 0, 0, 0], 0);
  assert.equal(res.ok, false);
  assert.ok(CRX.withinLimits(res.q, 1e-9), "可動範囲内");
  const info = CRX.tcpInfo(res.q, 0);
  assert.ok(info.horizontal > 1300, `最大限伸びる: ${info.horizontal}`);
});

test("旧形式（q1, reach）からの変換: 1 軸角と水平リーチが保たれ、ツールは下向き", () => {
  for (const [q1, reach] of [[0, 800], [45 * D2R, 1000], [-120 * D2R, 600]]) {
    const q = CRX.fromLegacy(q1, reach, 0);
    const leg = CRX.toLegacy(q, 0);
    near(leg.reach, reach, 1.0, "reach");
    near(Math.atan2(Math.sin(leg.q1 - q1), Math.cos(leg.q1 - q1)), 0, 0.01, "q1");
    const z = CRX.transformDir(CRX.fk(q).fanucFlange, [0, 0, 1]);
    near(z[2], -1, 0.01, "ツール下向き");
  }
});

test("関節の最大速度と推定角加速度（公式値 / 0.4 s 到達）", () => {
  assert.deepEqual(CRX.MODEL.vmaxDeg, [80, 80, 120, 112.5, 90, 112.5]);
  assert.deepEqual(CRX.MODEL.accDeg, [200, 200, 300, 281.3, 225, 281.3]);
});
