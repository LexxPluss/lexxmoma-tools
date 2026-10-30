# 全文の見直し(品質ループ。サブエージェント向け)

公開中の事例を、本文の**全文**(`text`、6,000 字まで)で見直し、今の値(`current`)の誤りを直し、空欄を本文から埋める。
基本の判断規則は `llm_review_instructions.md` と同じ(先に読むこと)。語彙のキーは `eoat/data/fulltext_batches/legend.json`。

入力: `eoat/data/fulltext_batches/batch_NNN.json`(25 件)
出力: `eoat/data/llm_out/zz_full_NNN.json`(入力と同じ順で全件。JSON の配列 1 つ)。1 件の形:
```json
{"id": "…", "is_case": true, "categories": ["carton"], "tasks": ["palletizing"], "materials": ["paper"], "mass_kg": null,
 "robot_maker": "FANUC", "robot_model": "M-410iC/185", "robot_class": "産業用", "is_mobile": false, "workpiece_name": "段ボール箱",
 "evidence": "FANUC M-410iC palletizes 20 kg cases", "note": ""}
```

## 書き方
- **すべてのキーを書く**(今の値が正しければ同じ値をそのまま書く)。ただし `principles` は、本文・alt に掴み方(吸着・2 指・磁石・ソフトなど)か、方式が決まるハンドの製品名が**書いてあるときだけ**書く。書いていなければ `principles` のキーごと省く(写真からの判定・推定を残すため)
- `is_case`: llm_review_instructions.md の基準。迷ったら true のまま(落とすのは明らかに事例でないとき: 製品紹介だけ・展示会の案内・ニュースの一覧・溶接/塗装だけ)
- `categories` / `tasks`: 実際に扱っているワーク・作業だけ。本文に例として並ぶだけの語は入れない
- `materials`: 本文に材料が書いてあるか、ワークから明らか(段ボール → paper、ガラス板 → glass)なものだけ。分からなければ `[]`
- `mass_kg`: ワーク 1 個の重さが本文に数値であるときだけ(kg に直す)。ロボットの可搬重量・ハンドの可搬は入れない。無ければ `null`
- `robot_maker` / `robot_model`: **ロボット本体**のメーカーと型式(ハンドのメーカーではない)。本文に無ければ `null`(推測しない)
- `robot_class`: 型式かメーカーの系列から分かれば「協働」/「産業用」。分からなければ `null`
- `evidence`: 直した値の根拠になった原文の短い引用(原文の言語のまま 60 字以内)。`note` に直した項目を短く(例: "materials 追加, robot_model 追加, tasks 修正")
- 25 件すべてを書く。
