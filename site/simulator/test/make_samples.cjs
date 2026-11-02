// サンプル JSON を作り直す:  node site/simulator/test/make_samples.cjs  → site/simulator/samples/*.json
// 手で JSON を編集してもよいが、シーケンスの組み替えはここを直して再生成するほうが間違えにくい。
// 形式は本体の「設定保存」と同じ（version 1: アーム姿勢は q1 [rad] と reach [mm]）。
const fs = require("fs");
const path = require("path");

const body = (pose, mode) => ({ type: "body", pose, mode, reverse: mode === "backward" });
const arm = (pose) => ({ type: "arm", pose });
const wait = (name, sec) => ({ type: "other", name, wait: sec });
const st = (...blocks) => ({ blocks });
const deg = (d) => d * Math.PI / 180;
const save = (name, data) => {
  const out = Object.assign({ version: 1, rev: "rev.63", savedAt: "2026-11-02T00:00:00.000Z" }, data, { bgImage: null, bodyVmax: 1.5 });
  fs.writeFileSync(path.join(__dirname, "..", "samples", name), JSON.stringify(out, null, 2) + "\n");
  console.log("wrote", name);
};

/* ---------- 展示会デモ ----------
 * 位置は 2026-10-16 の展示会ブースの保存ファイルから。
 * F = 前（Pick 台）、B = 後ろ（加工機）、R = 右（加工機・Drop 台）。_1 が引っ込めた姿勢、_2 が伸ばした姿勢 */
{
  const bodyPoses = [
    { name: "Init", x: 326.13, y: -631.88, th: deg(90) },
    { name: "Start", x: 326.13, y: -285.56, th: deg(90) },
    { name: "P3", x: 326.13, y: 1765.80, th: deg(90) },
    { name: "P4", x: -739.88, y: 1039.28, th: deg(270) },
    { name: "P5", x: -739.88, y: -1012.16, th: deg(270) },
    { name: "2", x: -739.88, y: 1039.28, th: 0 },
  ];
  const armPoses = [
    { name: "F_1", q1: 0, reach: 330 },
    { name: "F_2", q1: 0, reach: 920 },
    { name: "B_1", q1: -Math.PI, reach: 420 },
    { name: "B_2", q1: -Math.PI, reach: 900 },
    { name: "R_1", q1: -Math.PI / 2, reach: 350 },
    { name: "R_2", q1: -Math.PI / 2, reach: 790 },
  ];
  const program = [
    st(body("Start", "auto")),
    // ① Pick 台: 走行中は引っ込めた姿勢で前を向き、着いたら 撮像 → 伸ばす → 把持 → 引く
    st(body("P3", "auto"), arm("F_1")),
    st(wait("撮像（位置確認）", 1.0)),
    st(arm("F_2")),
    st(wait("把持", 1.5)),
    st(arm("F_1")),
    // ② 後退しながら後ろを向き、加工機に置く
    st(body("2", "backward"), arm("B_1")),
    st(arm("B_2")),
    st(wait("リリース", 1.0)),
    st(arm("B_1")),
    // ③ 加工機の動作（3 s）を待つ間に、車体の向きを変えてアームを右へ構える（同じ段＝並列）
    st(wait("加工機の動作", 3.0), body("P4", "auto"), arm("R_1")),
    st(wait("撮像（位置確認）", 1.0)),
    st(arm("R_2")),
    st(wait("把持", 1.5)),
    st(arm("R_1")),
    // ④ Drop 台へ移動して置く
    st(body("P5", "auto")),
    st(arm("R_2")),
    st(wait("リリース", 1.0)),
    st(arm("R_1")),
    // ⑤ 前を向いて Start へ戻る
    st(body("Start", "backward"), arm("F_1")),
  ];
  const bgRects = [
    { x1: -2000, y1: -2000, x2: 2500, y2: 3000, color: "#84e7b3" },        // ブース床
    { x1: -1871.56, y1: 1488.80, x2: -1350.03, y2: 503.74, color: "#e7d184" }, // 加工機
    { x1: -2000, y1: 3000, x2: 2500, y2: 3932.09, color: "#e68282" },      // バックヤード（壁）
    { x1: 877.84, y1: 2218.54, x2: -426.94, y2: 2918.01, color: "#848ae7" }, // Pick 台
    { x1: -1841.77, y1: -516.48, x2: -1299.42, y2: -1561.75, color: "#84e7b3" }, // Drop 台
  ];
  const bgTexts = [
    { x: 265.21, y: 3502.82, text: "バックヤード", size: 300, color: "#888888", vertical: false },
    { x: 233.31, y: 2580.07, text: "Pick", size: 300, color: "#888888", vertical: false },
    { x: -1629.55, y: 1008.22, text: "加工", size: 300, color: "#888888", vertical: true },
    { x: -1574.53, y: -1011.61, text: "Drop", size: 200, color: "#888888", vertical: true },
  ];
  save("booth-demo.json", {
    bodyPoses, armPoses, initial: { bodyPose: "Init", armPose: "F_1" }, program, bgRects, bgLines: [], bgTexts,
    robot: { body: { ...bodyPoses[0], name: undefined }, arm: { q1: 0, reach: 330 } },
  });
}
