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

const routeFromSave = new Function(grab("routeFromSave") + "\nreturn routeFromSave;")();
test("回る順番の「この回だけの拘束」（rev.111〜）は読み込んでも残る", () => {
  const cons = { hand: "fixed", pos: "free", ori: "face" };
  const r = routeFromSave({ route: ["t1", { t: "t2", cons }, { pose: "P1" }, { t: "t3" }, 5, null, { foo: 1 }] });
  assert.deepEqual(r, ["t1", { t: "t2", cons }, { pose: "P1" }, "t3"]);
  assert.notEqual(r[1].cons, cons, "拘束は写しにする（読み込んだデータと共有しない）");
  assert.deepEqual(routeFromSave({}), []);
});
