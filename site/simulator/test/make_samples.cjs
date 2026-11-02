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
  const out = Object.assign({ version: 1, rev: "rev.67", savedAt: "2026-11-02T00:00:00.000Z" }, data, { bgImage: null, bodyVmax: 1.5 });
  fs.writeFileSync(path.join(__dirname, "..", "samples", name), JSON.stringify(out, null, 2) + "\n");
  console.log("wrote", name);
};

/* 展示会デモ（booth-demo.json）は 3D 向けの make_sample_booth.cjs で生成する */

/* ---------- 2. 最小のピック＆プレース ／ 3. 同じ工程を順次だけで ----------
 * 台 A（x=+3 m 側）から台 B（x=−3 m 側）へ 1 個運ぶ。ロボットは台の手前で止まり、前（q1=0）に伸ばす */
{
  const bodyPoses = [
    { name: "Home", x: 0, y: 0, th: 0 },
    { name: "台A前", x: 2000, y: 0, th: 0 },
    { name: "台B前", x: -2000, y: 0, th: Math.PI },
  ];
  const armPoses = [
    { name: "引込", q1: 0, reach: 350 },
    { name: "伸長", q1: 0, reach: 950 },
  ];
  const bgRects = [
    { x1: 2600, y1: -600, x2: 3400, y2: 600, color: "#848ae7", h: 800 }, // 台 A
    { x1: -3400, y1: -600, x2: -2600, y2: 600, color: "#84e7b3", h: 800 }, // 台 B
  ];
  const bgTexts = [
    { x: 3000, y: 900, text: "台A（取る）", size: 250, color: "#888888", vertical: false },
    { x: -3000, y: 900, text: "台B（置く）", size: 250, color: "#888888", vertical: false },
  ];
  const common = { bodyPoses, armPoses, initial: { bodyPose: "Home", armPose: "引込" }, bgRects, bgLines: [], bgTexts,
                   robot: { body: { x: 0, y: 0, th: 0 }, arm: { q1: 0, reach: 350 } } };
  // 同時動作あり: 把持・リリースのあと、アームを引き込みながら走り出す（引込は走行中に終わる）
  save("pick-and-place-min.json", Object.assign({}, common, { program: [
    st(body("台A前", "auto")),
    st(wait("撮像（位置確認）", 1.0)),
    st(arm("伸長")),
    st(wait("把持", 1.5)),
    st(body("台B前", "auto"), arm("引込")), // 引き込みながら向きを変えて走る（最短時間の経路）
    st(arm("伸長")),
    st(wait("リリース", 1.0)),
    st(body("Home", "auto"), arm("引込")),  // 引き込みながら戻る
  ] }));
  // 同時動作なし: 車体が止まってからアームを動かし、アームが終わってから車体を動かす
  save("serial-only.json", Object.assign({}, common, { program: [
    st(body("台A前", "auto")),
    st(arm("引込")),
    st(wait("撮像（位置確認）", 1.0)),
    st(arm("伸長")),
    st(wait("把持", 1.5)),
    st(arm("引込")),
    st(body("台B前", "auto")),
    st(arm("伸長")),
    st(wait("リリース", 1.0)),
    st(arm("引込")),
    st(body("Home", "auto")),
  ] }));
}
