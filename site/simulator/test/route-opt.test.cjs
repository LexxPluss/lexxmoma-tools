// 順番全体の最短の選び方のテスト:  node --test site/simulator/test/route-opt.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const { bestPath, spread } = require("../route-opt.js");

let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
// 総当たりで、本当の時間の合計が最小の並び
function brute(sizes, real) {
  let best = null;
  const walk = (k, path, cost) => {
    if (k === sizes.length) { if (!best || cost < best.cost) best = { path: path.slice(), cost }; return; }
    for (let j = 0; j < sizes[k]; j++) {
      const c = k ? real(k - 1, path[k - 1], j) : 0;
      if (!isFinite(c)) continue;
      path.push(j); walk(k + 1, path, cost + c); path.pop();
    }
  };
  walk(0, [], 0);
  return best;
}

test("見積もりが本当の時間以下なら、総当たりと同じ最短の合計になる", () => {
  for (let trial = 0; trial < 40; trial++) {
    const sizes = [1, 2 + Math.floor(rnd() * 3), 2 + Math.floor(rnd() * 3), 2 + Math.floor(rnd() * 3), 2 + Math.floor(rnd() * 3)];
    const R = {}, E = {};
    for (let k = 0; k + 1 < sizes.length; k++) for (let i = 0; i < sizes[k]; i++) for (let j = 0; j < sizes[k + 1]; j++) {
      const r = rnd() < 0.15 ? Infinity : 1 + rnd() * 10; // 行けない移動もある
      R[[k, i, j]] = r; E[[k, i, j]] = isFinite(r) ? r * rnd() : rnd() * 5; // 見積もりは本当以下（行けない所も小さく見積もる）
    }
    let calls = 0;
    const real = (k, i, j) => { calls++; return R[[k, i, j]]; };
    const got = bestPath(sizes, (k, i, j) => E[[k, i, j]], real);
    const want = brute(sizes, (k, i, j) => R[[k, i, j]]);
    if (!want) { assert.equal(got, null, `例 ${trial}: 行ける並びが無い`); continue; }
    assert.ok(got, `例 ${trial}: 並びが見つかる`);
    assert.ok(Math.abs(got.cost - want.cost) < 1e-9, `例 ${trial}: ${got.cost} と ${want.cost}`);
    let sum = 0; // 返した並びの本当の時間を足すと cost になる
    for (let k = 0; k + 1 < got.path.length; k++) sum += R[[k, got.path[k], got.path[k + 1]]];
    assert.ok(Math.abs(sum - got.cost) < 1e-9);
  }
});

test("見積もりでは速くても、本当は行けない並びは選ばない", () => {
  // 0 回目 → 1 回目の候補 0 は見積もりでは 1 秒だが本当は行けない。候補 1 は 5 秒
  const est = (k, i, j) => (j === 0 ? 1 : 5);
  const real = (k, i, j) => (j === 0 ? Infinity : 5);
  const got = bestPath([1, 2], est, real);
  assert.deepEqual(got.path, [0, 1]);
  assert.equal(got.cost, 5);
  assert.ok(got.rounds >= 2, "選び直している");
});

test("どの並びも行けなければ null", () => {
  assert.equal(bestPath([1, 2, 2], () => 1, () => Infinity), null);
});

test("本当の時間は、選んだ並びの上だけ計算する（全部の組み合わせは計算しない）", () => {
  const sizes = [1, 20, 20, 20];
  let calls = 0;
  const got = bestPath(sizes, () => 1, () => { calls++; return 1; });
  assert.equal(got.cost, 3);
  assert.equal(calls, 3, "見積もりどおりなら、選んだ並びの 3 つだけ");
});

test("互いに離れたものから選ぶ", () => {
  const pts = [0, 1, 2, 3, 10, 11, 20].map(x => ({ x }));
  const got = spread(pts, 3, (a, b) => Math.abs(a.x - b.x)).map(p => p.x);
  assert.deepEqual(got, [0, 20, 10]);
  assert.equal(spread(pts, 10, (a, b) => Math.abs(a.x - b.x)).length, 7, "数が足りなければ全部");
});
