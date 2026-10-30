# 事例データの採点(品質ループ)

入力: `<prefix>.json`(事例ごとに 本文 text・今の値 current・画像番号 images)と、画像のシート `<prefix>_img_N.jpg`(1 枚に 10 事例、1 行 = 1 事例、黄色の番号「事例番号-画像番号」)。
各事例について、本文と写真を見て、今の値が正しいかを項目ごとに採点する。推測で「正しい」にしない。

## 項目と判定(verdict)
- `ok`: 正しい / `wrong`: 誤り(正しい値を fix に書く) / `missing`: 空欄だが本文・写真から分かる(fix に書く) / `na`: 本文・写真から決められない、または空欄で正しい
1. `is_case`: ロボットのハンド(エンドエフェクタ)がワークを扱う実例か(作業ツールが主役のねじ締め・研磨も実例)。製品紹介・展示会・ニュースだけ・溶接だけは wrong
2. `categories`: ワークの種類(先頭が主なワークか)
3. `tasks`: 作業(パレタイズ・機械への投入・ピッキングなど)
4. `principles`: 掴み方。`principles_basis` が `estimated`(用途からの推定)なら、写真か本文で確かめられるときだけ ok/wrong、決められなければ na
5. `materials`: ワークの材料
6. `robot_maker` / `robot_model`: ロボット本体のメーカー・型式(ハンドのメーカーではない)
7. `robot_class`: 協働 / 産業用(型式から分かれば判定してよい)
8. `mass_kg`: ワーク 1 個の重さ(ロボットの可搬重量を入れていたら wrong)
9. 画像(images の番号ごと): `ok` = この事例のロボット・ハンド・ワークのどれかが写った写真(ハンド製品の写真も可)/ `bad` = 事例と関係ない(人物だけ・ロゴ・図表・文字バナー・別の製品・イメージ写真・工場の外観)

## 出力
`<prefix>_grade_<担当>.json` に JSON 配列(担当の事例すべて):
```json
[{"no": 1, "id": "…", "is_case": "ok", "categories": "ok", "tasks": "wrong", "principles": "na", "materials": "missing", "robot_maker": "ok", "robot_model": "missing", "robot_class": "ok", "mass_kg": "na",
  "images": {"1-1": "ok", "1-2": "bad"}, "fix": {"tasks": ["機械への投入"], "materials": ["鉄鋼"], "robot_model": "CRX-10iA"}, "note": "…"}]
```
