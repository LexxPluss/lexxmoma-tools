// 展示会レイアウト（sample_booth_rev61.json、旧形式）を 3D 向けに作り直す:
//   node site/simulator/test/make_sample_booth.cjs  →  sample_booth_rev66.json
// - 設備の四角に高さを付ける（Pick 台 800、加工機 900、Drop 台 800 mm）
// - アーム姿勢を 6 軸で作り直す（各作業位置に「上空で待つ姿勢」と「台の上の把持位置」）
// - 撮像・把持・リリース・加工の待ち時間を入れ、ピックが一瞬で終わらないようにする
const fs = require("fs");
const path = require("path");
const CRX = require("../crx-kinematics.js");

const D2R = Math.PI / 180;
const src = JSON.parse(fs.readFileSync(path.join(__dirname, "sample_booth_rev61.json"), "utf8"));

const MOUNT_Z = 750;              // アーム取付面の床からの高さ（本体の ARM_MOUNT_Z と同じ）
const J1_Z = MOUNT_Z + CRX.MODEL.L.base; // アーム基準座標の原点の床からの高さ = 995
const TOOL = 150;                 // グリッパ長 [mm]
const TABLE = { pick: 800, machine: 900, drop: 800 }; // 台の高さ [mm]
const GRIP_ABOVE = 20;            // 把持時に TCP を台の天面からどれだけ上に置くか
const APPROACH = 300;             // 把持位置の上空で待つ高さ

/* アーム基準座標での TCP 目標 → IK。dirDeg: 水平方向（0=前、180=後、-90=右）、reach: 水平距離 */
function pose(name, dirDeg, reach, zFloor, seedQ) {
  const th = dirDeg * D2R;
  const x = reach * Math.cos(th), y = reach * Math.sin(th), z = zFloor - J1_Z;
  // ツールは真下（W=180）、手首の向きは作業方向に合わせる（R = dirDeg）
  const T = CRX.targetFromXYZWPR(x, y, z, 180, 0, dirDeg);
  const j2 = 45 * D2R, j3 = 0;
  // 手首の横オフセット（150 mm）のぶん J1 は作業方向より約 10° 回る。180° 方向は可動範囲（±179.9°）を
  // 越えないよう -170° 側から解く
  const j1 = Math.atan2(Math.sin(th + 10 * D2R), Math.cos(th + 10 * D2R));
  const seed = seedQ || [j1, j2, j3, 0, j2 - j3 - Math.PI / 2, 0];
  const r = CRX.ik(T, seed, TOOL, { iters: 400 });
  const info = CRX.tcpInfo(r.q, TOOL);
  if (!r.ok) console.warn(`${name}: IK 未収束 pos ${r.posErr.toFixed(1)} mm rot ${r.rotErr.toFixed(4)}`);
  console.log(`${name.padEnd(4)} J=${r.q.map(v => (v / D2R).toFixed(0).padStart(5)).join(",")}  TCP 水平 ${info.horizontal.toFixed(0)} mm 床から ${(info.z + J1_Z).toFixed(0)} mm`);
  return { name, q: r.q.map(v => Math.round(v * 1e5) / 1e5) };
}

// 作業方向と距離: Pick 台は車体の前（P3 で y+ を向く）、加工機は車体の後ろ（"2"）／右（P4）、Drop 台は右（P5）
const armPoses = [
  pose("F_1", 0, 850, TABLE.pick + GRIP_ABOVE + APPROACH),       // Pick 台の上空
  pose("F_2", 0, 850, TABLE.pick + GRIP_ABOVE),                  // Pick 台の把持位置
  pose("B_1", 180, 900, TABLE.machine + GRIP_ABOVE + APPROACH),  // 加工機の上空（後ろ向き）
  pose("B_2", 180, 900, TABLE.machine + GRIP_ABOVE),             // 加工機に置く位置
  pose("R_1", -90, 850, TABLE.machine + GRIP_ABOVE + APPROACH),  // 右側の上空（加工機／Drop 台）
  pose("R_2", -90, 850, TABLE.machine + GRIP_ABOVE),             // 加工機から取る位置（右向き）
  pose("R_3", -90, 850, TABLE.drop + GRIP_ABOVE),                // Drop 台に置く位置（右向き）
  pose("Home", 0, 450, J1_Z + 150, [0, 10 * D2R, -40 * D2R, 0, -60 * D2R, 0]), // 走行中の畳んだ姿勢
];

const body = (poseName, mode) => ({ type: "body", pose: poseName, mode, reverse: mode === "backward" });
const arm = (poseName) => ({ type: "arm", pose: poseName });
const wait = (name, sec) => ({ type: "other", name, wait: sec });
const st = (...blocks) => ({ blocks });

const program = [
  st(body("Start", "auto")),
  // ① Pick 台からワークを取る
  st(body("P3", "auto"), arm("F_1")),
  st(wait("撮像（位置確認）", 1.0)),
  st(arm("F_2")),
  st(wait("把持", 1.5)),
  st(arm("F_1")),
  // ② 後退しながら加工機の上空へ構え、ワークを加工機に置く
  st(body("2", "backward"), arm("B_1")),
  st(arm("B_2")),
  st(wait("リリース", 1.0)),
  st(arm("B_1")),
  st(wait("加工機の動作", 3.0)),
  // ③ 向きを変えて加工機からワークを取る（右側）
  st(body("P4", "auto"), arm("R_1")),
  st(wait("撮像（位置確認）", 1.0)),
  st(arm("R_2")),
  st(wait("把持", 1.5)),
  st(arm("R_1")),
  // ④ Drop 台へ移動して置く
  st(body("P5", "auto")),
  st(arm("R_3")),
  st(wait("リリース", 1.0)),
  st(arm("R_1")),
  // ⑤ 畳んで Start へ戻る
  st(body("Start", "backward"), arm("Home")),
];

// オブジェクト（version 3）: 旧 bgRects/bgTexts を名前付きの箱・区画・文字にする
// [0]=ブース床（区画）、[1]=加工機（黄）、[2]=バックヤード（区画）、[3]=Pick 台（青）、[4]=Drop 台（緑）
const RECT_META = [["ブース床", 0], ["加工機", TABLE.machine], ["バックヤード", 0], ["Pick 台", TABLE.pick], ["Drop 台", TABLE.drop]];
let n = 0;
const uid = () => "booth" + (++n).toString(36).padStart(3, "0");
const objects = [];
src.bgRects.forEach((r, i) => {
  const [name, h] = RECT_META[i] || [`箱${i + 1}`, 0];
  objects.push({ id: uid(), type: "box", name, visible: true, x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2, yaw: 0,
                 w: Math.abs(r.x2 - r.x1), d: Math.abs(r.y2 - r.y1), h, z0: 0, color: r.color });
});
(src.bgLines || []).forEach((l, i) => objects.push({ id: uid(), type: "line", name: `直線${i + 1}`, visible: true, x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, color: l.color }));
(src.bgTexts || []).forEach((t) => objects.push({ id: uid(), type: "text", name: t.text, visible: true, x: t.x, y: t.y, text: t.text, size: t.size, color: t.color, vertical: !!t.vertical }));

const out = {
  version: 3,
  rev: "rev.66",
  savedAt: new Date().toISOString(),
  armModel: CRX.MODEL.name,
  toolLen: TOOL,
  bodyPoses: src.bodyPoses,
  armPoses,
  initial: { bodyPose: "Init", armPose: "Home" },
  program,
  objects,
  bgImage: null,
  robot: { body: { ...src.bodyPoses[0] }, arm: { q: armPoses.find(p => p.name === "Home").q } },
  bodyVmax: 1.5,
};
delete out.robot.body.name;
const dst = path.join(__dirname, "sample_booth_rev66.json");
fs.writeFileSync(dst, JSON.stringify(out, null, 2) + "\n");
console.log("wrote", dst);
