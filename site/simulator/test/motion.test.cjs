// アームの関節動作のテスト:  node --test site/simulator/test/motion.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const MOTION = require("../motion.js");
const CRX = require("../crx-kinematics.js");

const D2R = Math.PI / 180;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} expected ${b} got ${a} (tol ${tol})`);
// シミュレーターと同じ関節の上限（rad/s²、rad/s）
const JOINTS = CRX.MODEL.vmaxDeg.map((w, i) => ({ a: CRX.MODEL.accDeg[i] * D2R, w: w * D2R }));
const QS = [0, 0, 0, 0, 0, 0];
const QG = [90, 10, -20, 5, 60, 180].map(v => v * D2R);

test("全関節が同時に止まり、途中のどの時刻でも同じ割合だけ進む", () => {
  const m = MOTION.jointMove(QS, QG, JOINTS);
  for (let k = 1; k < 20; k++) {
    const q = m.at(m.dur * k / 20);
    const fr = q.map((v, i) => (v - QS[i]) / (QG[i] - QS[i]));
    for (const f of fr) near(f, fr[0], 1e-9, `t=${k}/20 の進み具合`);
    assert.ok(fr[0] > 0 && fr[0] < 1, `t=${k}/20 で途中にいる`);
  }
  assert.deepEqual(m.at(m.dur), QG);
  assert.deepEqual(m.at(0).map(v => v + 0), QS);
});

test("時間は一番遅い関節を単独で動かしたときと同じ（サイクルタイムは変わらない）", () => {
  const m = MOTION.jointMove(QS, QG, JOINTS);
  const slowest = Math.max(...QG.map((g, i) => MOTION.trapDur(g - QS[i], JOINTS[i].a, JOINTS[i].w)));
  near(m.dur, slowest, 1e-9);
});

test("どの関節も最大角速度・最大角加速度を超えない", () => {
  const cases = [QG, [5, -60, 80, 170, -10, 2].map(v => v * D2R), [0.5, 0, 0, 0, 0, 0].map(v => v * D2R)];
  for (const qg of cases) {
    const m = MOTION.jointMove(QS, qg, JOINTS);
    const dt = m.dur / 2000;
    let prev = null, prevV = null;
    for (let k = 0; k <= 2000; k++) {
      const q = m.at(k * dt);
      if (prev) {
        const v = q.map((x, i) => (x - prev[i]) / dt);
        v.forEach((x, i) => assert.ok(Math.abs(x) <= JOINTS[i].w * (1 + 1e-6), `J${i + 1} 速度 ${x}`));
        if (prevV) v.forEach((x, i) => assert.ok(Math.abs(x - prevV[i]) / dt <= JOINTS[i].a * 1.02, `J${i + 1} 加速度`));
        prevV = v;
      }
      prev = q;
    }
  }
});

test("動かないときは時間 0 で、行き先をそのまま返す", () => {
  const m = MOTION.jointMove(QG, QG.slice(), JOINTS);
  assert.equal(m.dur, 0);
  assert.deepEqual(m.at(0), QG);
});
