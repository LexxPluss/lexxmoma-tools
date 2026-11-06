// 保存ファイルの読み込みのテスト:  node --test site/simulator/test/save-load.test.cjs
// 読み込みの関数は lexxmoma-2d.html の中にあるので、本文から取り出して動かす
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "lexxmoma-2d.html"), "utf8");
function grab(name) { // 「function name(」から、対応する閉じ括弧まで
  const i = html.indexOf("function " + name + "(");
  assert.ok(i >= 0, name + " が見つからない");
  let depth = 0;
  for (let k = html.indexOf("{", i); k < html.length; k++) {
    if (html[k] === "{") depth++;
    else if (html[k] === "}" && --depth === 0) return html.slice(i, k + 1);
  }
  throw new Error(name + " の終わりが見つからない");
}
const objectsFromSave = new Function("makeBox", grab("uid") + "\n" + grab("objectsFromSave") + "\nreturn objectsFromSave;")(() => ({}));

test("手先の目標は読み込んでも消えない（位置・高さ・向き・名前・id をそのまま）", () => {
  const data = { objects: [
    { id: "b1", type: "box", name: "台", x: 0, y: 0, w: 1000, d: 600, h: 800 },
    { id: "t1", type: "target", name: "A", visible: true, x: -1234.5, y: 678.9, z: 800, w: 180, p: 0, r: 30, color: "#c0392b" },
  ] };
  const objs = objectsFromSave(data);
  const t = objs.find(o => o.type === "target");
  assert.ok(t, "手先の目標が残る");
  assert.equal(t.id, "t1"); // 回る順番は id で手先を指すので、id が変わると順番も消える
  assert.equal(t.name, "A");
  assert.deepEqual([t.x, t.y, t.z, t.w, t.p, t.r], [-1234.5, 678.9, 800, 180, 0, 30]);
  assert.equal(t.h, undefined, "箱の項目（高さ h）は足さない");
  assert.equal(objs.find(o => o.type === "box").h, 800);
});

test("手先の目標の拘束（rev.110〜）も読み込んでも残る", () => {
  const cons = { hand: "spin", pos: "fixed", ori: "fixed", bx: -1500, by: 2000, bth: 1.5708 };
  const t = objectsFromSave({ objects: [{ id: "t1", type: "target", name: "D", x: 0, y: 0, z: 800, cons }] })[0];
  assert.deepEqual(t.cons, cons);
});

test("知らない種類の物は読み捨て、手先の数値がおかしければ 0 にする", () => {
  const objs = objectsFromSave({ objects: [{ type: "robot" }, null, { id: "t2", type: "target", x: "12", y: null, z: "abc" }] });
  assert.equal(objs.length, 1);
  assert.deepEqual([objs[0].x, objs[0].y, objs[0].z, objs[0].w], [12, 0, 0, 0]);
});

const routeFromSave = new Function(grab("withVisit") + "\n" + grab("routeFromSave") + "\nreturn routeFromSave;")();
test("回る順番の「この回だけの拘束」（rev.111〜）は読み込んでも残る", () => {
  const cons = { hand: "fixed", pos: "free", ori: "face" };
  const r = routeFromSave({ route: ["t1", { t: "t2", cons }, { pose: "P1" }, { t: "t3" }, 5, null, { foo: 1 }] });
  assert.deepEqual(r, ["t1", { t: "t2", cons }, { pose: "P1" }, "t3"]);
  assert.notEqual(r[1].cons, cons, "拘束は写しにする（読み込んだデータと共有しない）");
  assert.deepEqual(routeFromSave({}), []);
});

const withVisit = new Function(grab("withVisit") + "\nreturn withVisit;")();
test("回る順番の「この回での作業」（rev.118〜）は読み込んでも残り、秒がおかしければ外す", () => {
  const r = routeFromSave({ route: [
    { t: "t1", work: { name: "つかむ", sec: 1.5 } },
    { t: "t2", cons: { ori: "face" }, work: { name: "離す", sec: "2" } },
    { pose: "P1", work: { name: "待つ", sec: 3 } },
    { t: "t3", work: { name: "x", sec: 0 } },
    { pose: "P2", work: { sec: "abc" } },
  ] });
  assert.deepEqual(r, [
    { t: "t1", work: { name: "つかむ", sec: 1.5 } },
    { t: "t2", cons: { ori: "face" }, work: { name: "離す", sec: 2 } },
    { pose: "P1", work: { name: "待つ", sec: 3 } },
    "t3",
    { pose: "P2" },
  ]);
});
test("回の項目を外すと、何も付いていない手先の目標は id の文字に戻る", () => {
  assert.equal(withVisit({ t: "t1", work: { name: "a", sec: 1 } }, { work: null }), "t1");
  assert.deepEqual(withVisit("t1", { cons: { ori: "face" } }), { t: "t1", cons: { ori: "face" } });
  assert.deepEqual(withVisit({ t: "t1", cons: { ori: "face" }, work: { name: "a", sec: 1 } }, { cons: null }), { t: "t1", work: { name: "a", sec: 1 } });
  assert.deepEqual(withVisit({ pose: "P1", work: { name: "a", sec: 1 } }, { work: null }), { pose: "P1" });
});

const autoCfgFromSave = new Function("AUTO_CFG_RANGE", grab("autoCfgFromSave") + "\nreturn autoCfgFromSave;")({ z: [300, 1600], r: [150, 1000] });
test("走行中の手先の制約（rev.118〜）は読み込んでも残り、範囲の外は既定に戻す", () => {
  assert.deepEqual(autoCfgFromSave({ autoCfg: { z: 900, r: 550 } }), { z: 900, r: 550 });
  assert.deepEqual(autoCfgFromSave({ autoCfg: { z: 5000, r: 550 } }), { r: 550 });
  assert.equal(autoCfgFromSave({}), null);
  assert.equal(autoCfgFromSave({ autoCfg: { z: "abc" } }), null);
});
