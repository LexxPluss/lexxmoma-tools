# 掴み方の読み直し(本文の全文。サブエージェント向け)

対象は、これまでのレビューで掴み方が「記載なし(hand_unspecified)」になった事例。前回は本文の冒頭しか読んでいない。**全文**(`text`、7,000 字まで)と画像の alt・キャプション(`image_alts`)を読み、ハンド(エンドエフェクタ)の方式が分かるかだけを判断する。

入力: `eoat/data/grasp_batches/batch_NNN.json`(30 件)。語彙のキーは `eoat/data/grasp_batches/legend.json` の principles。
出力: `eoat/data/llm_out/z_grasp_NNN.json`(入力と同じ順で全件。JSON の配列 1 つ)
```json
[{"id": "…", "principles": ["multi_pad"], "basis": "text", "evidence": "vacuum gripper with four suction cups", "note": ""},
 {"id": "…", "principles": [], "basis": "none", "evidence": "", "note": "ハンドの種類の記載なし"}]
```

## 付けてよい根拠(basis)
- `text`: 本文・alt・キャプションのどこかに方式が書いてある(吸着・吸盤・vacuum・suction・2 指・parallel gripper・jaws・fingers・クランプ・フォーク・磁石・magnet・soft gripper・needle など。日本語・英語以外の言語も)
- `product`: ハンドの製品名・型式、または製品の系列が一つの方式に決まるハンドメーカーが書いてある。例: Robotiq 2F-85 / Hand-E → parallel2、OnRobot RG2 / RG6 / 2FG → parallel2、OnRobot VG10 / VGC10 → multi_pad、Schmalz・Piab・VMECA・Coval・Joulin の「グリッパ」→ 吸着(個数が分からなければ single_pad ではなく multi_pad を避け、本文に合う方)、Soft Robotics mGrip → soft_finger、Magswitch → 磁石(electropermanent)、Zimmer・Schunk は系列が多いので型式が無ければ付けない

## 付けてはいけないもの
- 用途・ワーク・業種からの推測(「パレタイズだから吸着」「段ボールだから吸着」は不可)。書いていなければ `principles: []`、`basis: "none"`
- ロボット本体の型式(UR10e・CRX など)だけからの推測
- 溶接・塗装などの作業ツールは、それが主役のときだけ process 群のキー(screwdriver / welding / sanding / dispensing / camera)

## その他
- 最大 3 つ、主なものを先頭。`evidence` は根拠になった原文の引用(原文の言語のまま 50 字以内)。
- 画像は見ない(本文の判断だけ。写真からの判定は別の工程で済んでいる)。
- 30 件すべてを書く。
