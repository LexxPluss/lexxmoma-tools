# LLM レビューの手順(サブエージェント向け)

目的: 規則で分類した「エンドエフェクタ(ハンド)の事例」を、本文を読んで確かめ、誤りを直す。値は語彙のキーで書く(`legend.json`)。

入力: `eoat/data/llm_batches/batch_NNN.json`(1 件 = 1 ページ: title / description / headings / text(冒頭 1,800 字) / image_alts / rule(規則の結果))
出力: `eoat/data/llm_out/batch_NNN.json`(同じ順で 1 件ずつ、次の形)

```json
{"id": "…", "is_case": true, "categories": ["carton"], "principles": ["single_pad"], "tasks": ["palletizing"], "materials": ["paper"],
 "robot_class": "協働", "is_mobile": false, "mass_kg": 12, "workpiece_name": "段ボール箱", "evidence": "vacuum gripper lifts 12 kg boxes", "note": ""}
```

判断の規則:
- `is_case`: 「あるワークを、あるハンドで、ロボットが扱った実例(製品の適用例を含む)」なら true。会社案内・製品一覧・展示会案内・ロボット本体だけ・溶接や塗装だけでハンドの把持が無いページは false(note に理由)。
- `categories`: 実際に扱っているワークだけ(最大 3、主なものを先頭)。本文に「他の用途の例」として並ぶ語は入れない。該当が無ければ `generic`。
- `principles`: 本文・alt から分かる掴み方(最大 3、主なものを先頭)。製品名から分かるものも可(例: VG10 → multi_pad、RG2 → parallel2、AX10 → multi_pad)。
  溶接トーチ・研磨・ねじ締めなどの作業ツールは、それが主役のときだけ `process` 群のキーを使う。本文に掴み方の情報が無く写真にも無いなら、規則の値をそのまま残して note に「掴み方の記載なし」と書く。
- `tasks`: 主な作業(最大 3)。`materials`: ワークの材料(分かるものだけ)。
- `robot_class`: 本文に型式かメーカー、または「協働/cobot」「産業用」の明記があるときだけ。無ければ null(推測しない)。`is_mobile`: AMR/台車にアームを載せた形態のときだけ true。
- `mass_kg`: ワーク 1 個の重さが本文に数値で書いてあるときだけ(単位は kg に直す)。無ければ null。
- `evidence`: 判断の根拠になった本文の短い引用(原文の言語のまま 40 字以内)。
- 規則の結果(`rule`)と同じでよければ同じ値を書く。分からないことは推測せず、規則の値を残して note に書く。
- 1 バッチ 40 件をすべて書く。JSON は配列 1 つ。文字列は UTF-8。
