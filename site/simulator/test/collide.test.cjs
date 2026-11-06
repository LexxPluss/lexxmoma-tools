// アームと設備の当たり判定のテスト:  node --test site/simulator/test/collide.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const COLLIDE = require("../collide.js");
const CRX = require("../crx-kinematics.js");

const D2R = Math.PI / 180;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} expected ${b} got ${a} (tol ${tol})`);
// アームの点を床基準へ（取付面を床から 750 mm・原点に置く。向きはアーム基準のまま）
function armPts(q, at) {
  at = at || [0, 0, 750];
  const f = CRX.fk(q, 150).points, out = {};
  for (const [k, p] of Object.entries(Object.assign({ mount: [0, 0, 0] }, f))) out[k] = [p[0] + at[0], p[1] + at[1], p[2] + at[2]];
  return out;
}
const box = (x, y, w, d, h, o) => Object.assign({ x, y, w, d, h, z0: 0, yaw: 0 }, o);

test("点と箱の距離: 中は 0、上は高さの差、斜めの箱も向きを考える", () => {
  const b = box(0, 0, 1000, 600, 800);
  near(COLLIDE.pointBoxDist([100, 100, 400], b), 0, 1e-9, "中");
  near(COLLIDE.pointBoxDist([0, 0, 900], b), 100, 1e-9, "真上");
  near(COLLIDE.pointBoxDist([600, 0, 400], b), 100, 1e-9, "横");
  near(COLLIDE.pointBoxDist([600, 400, 900], b), Math.hypot(100, 100, 100), 1e-9, "角");
  near(COLLIDE.pointBoxDist([0, 0, 50], box(0, 0, 100, 100, 100, { z0: 200 })), 150, 1e-9, "浮いた箱の下");
  const r = box(0, 0, 1000, 200, 800, { yaw: 90 * D2R }); // 90° 回すと幅が y 方向になる
  near(COLLIDE.pointBoxDist([0, 550, 400], r), 50, 1e-9, "回した箱");
  near(COLLIDE.pointBoxDist([150, 0, 400], r), 50, 1e-9, "回した箱（短い方）");
});

test("前に伸ばした腕は、前の台に当たり、遠い台・低い台には当たらない", () => {
  const q = [0, 0, 0, 0, 0, 0]; // 上腕が真上、前腕が前（+x）。腕の高さは床から 750 + 955 mm
  const pts = armPts(q);
  assert.ok(COLLIDE.armHit(pts, [box(600, -150, 300, 300, 2000)]), "前腕の先の高い台");
  assert.equal(COLLIDE.armHit(pts, [box(3000, 0, 300, 300, 2000)]), null, "遠い台");
  assert.equal(COLLIDE.armHit(pts, [box(600, -150, 300, 300, 800)]), null, "腕より低い台");
  assert.ok(COLLIDE.armHit(pts, [box(0, 0, 200, 200, 2000, { z0: 1500 })]), "上腕の上の棚");
});

test("触れてよい球の中だけは当たりにしない（手先を台に下ろす）", () => {
  // ツールを真下に向けて、手先を台の上面（床から 800 mm）に置く
  const T = CRX.targetFromXYZWPR(700, 0, 800 - 750 - 245, 180, 0, 0);
  const r = CRX.ik(T, [0, 40, 0, 0, -50, 0].map(v => v * D2R), 150, { iters: 200 });
  assert.ok(r.ok, "IK");
  const pts = armPts(r.q), table = box(800, 0, 400, 400, 800);
  near(pts.tcp[2], 800, 0.5, "手先の高さ");
  assert.ok(COLLIDE.armHit(pts, [table]), "触れてよい球が無ければ当たる");
  assert.equal(COLLIDE.armHit(pts, [table], [{ p: pts.tcp, r: COLLIDE.ALLOW_R }]), null, "手先の所は触れてよい");
  // 台が 200 mm 高いと、球（手先から 200 mm）の外のフランジ側も台の上面にかかる
  const high = box(800, 0, 400, 400, 1000);
  assert.ok(COLLIDE.armHit(pts, [high], [{ p: pts.tcp, r: COLLIDE.ALLOW_R }]), "球の外は当たる");
});

test("遠い設備を外す近道をしても、全部の点を調べたときと結果が同じ", () => {
  // 近道なしの判定（棒の上の点を全部、全部の箱と比べる）
  const slow = (pts, boxes) => {
    for (const [ka, kb, rad] of COLLIDE.LINKS) {
      const a = pts[ka], b = pts[kb], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 15));
      for (let k = 0; k <= n; k++) {
        const t = k / n, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        if (boxes.some(o => COLLIDE.pointBoxDist(p, o) < rad)) return true;
      }
    }
    return false;
  };
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let hits = 0;
  for (let i = 0; i < 300; i++) {
    const q = [0, 1, 2, 3, 4, 5].map(() => (rnd() * 2 - 1) * 150 * D2R);
    const pts = armPts(q);
    const boxes = [0, 1, 2].map(() => box((rnd() * 2 - 1) * 1500, (rnd() * 2 - 1) * 1500, 100 + rnd() * 1200, 100 + rnd() * 1200, rnd() * 2000, { yaw: rnd() * Math.PI, z0: rnd() < 0.3 ? rnd() * 1200 : 0 }));
    const fast = !!COLLIDE.armHit(pts, boxes);
    assert.equal(fast, slow(pts, boxes), `例 ${i}`);
    if (fast) hits++;
  }
  assert.ok(hits > 30 && hits < 270, `当たる例と当たらない例の両方がある（当たる ${hits}/300）`);
});

test("skip に入れた棒は、その箱とは見ない（車体の上の台座）", () => {
  const pts = armPts([0, 0, 0, 0, 0, 0]); // 台座は取付面（床から 750 mm）から J2 まで
  const body = box(0, 0, 750, 600, 750); // 車体: 上面が取付面
  assert.ok(COLLIDE.armHit(pts, [body]), "台座の棒は車体の上面に触れている");
  const hit = COLLIDE.armHit(pts, [Object.assign({ skip: [0] }, body)]);
  assert.equal(hit, null, "台座の棒（0 番）を外せば当たらない");
  const low = armPts([0, 90 * D2R, 0, 0, 0, 0]); // 上腕を前に倒すと、前腕の先が車体の高さまで下がる
  assert.ok(COLLIDE.armHit(low, [Object.assign({ skip: [0] }, box(500, 0, 750, 600, 750))]), "台座以外の棒は見る");
});
