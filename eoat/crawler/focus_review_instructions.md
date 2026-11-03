# 掴み方・作業・ワークの精査(ループ 16 の品質ループ。サブエージェント向け)

ループ 15 の採点で残った誤りは、掴み方 20%・作業 12%・ワーク 10% だった。公開中の全事例を本文の全文で読み、この 3 項目だけを直す。
語彙のキーは `eoat/data/focus_batches/legend.json`(categories / principles / tasks)。それ以外のキーは書かない。

入力: `eoat/data/focus_batches/batch_NNN.json`(25 件。title・text(全文 6,000 字まで)・image_alts・current)
出力: `eoat/data/llm_out/zzz_focus_NNN.json`(入力と同じ順で 25 件すべて。JSON の配列 1 つ)。1 件の形:
```json
{"id": "…", "categories": ["casting"], "tasks": ["machine_tending"], "principles": ["parallel2", "tool_changer"],
 "evidence": "pneumatic 2-jaw gripper with tool changer", "note": "principles: ツールチェンジャ追加"}
```
- `categories`・`tasks` は**必ず書く**(今の値が正しければ同じ値をそのまま。並びは大事なものから、3 つまで)
- `principles` は本文・alt に掴み方かハンドの製品名が**書いてあるとき**か、今の値が下の「誤りの型」に当たるときだけ書く。それ以外はキーごと省く(写真の判定・推定を残すため)
- `is_case`・材料・重さ・ロボットは書かない(この回では触らない)
- `note` に直した項目と理由を短く。直していなければ ""

## 掴み方(principles)の誤りの型
1. **工具と把持の取り違え**: 作業ツール(sanding・dispensing・camera・screwdriver・welding)は、その工具を**ロボットの手先に付けている**ときだけ。
   ロボットがワークを持って、床に固定した研磨機・ベルトサンダ・バリ取り機・カメラ・塗布機に当てる/見せる場合は、ワークを持つハンドの方式を書く
   (方式が本文に無ければ `["hand_unspecified"]`、「グリッパ」とだけあれば `["mech_text"]`)。作業は tasks の finishing / inspection で表す
2. **溶接**: welding はロボットが溶接トーチを持つときだけ。溶接セルへの部品の供給・取り出し・治具への投入をするロボットは把持の方式を書く
3. **複合の片方の取りこぼし**: 1 つのハンドで吸着と把持を併用 → `hybrid` に加えて主な方式(例 `["hybrid", "multi_pad", "parallel2"]`)。
   磁石とグリッパの併用 → 両方(`parallel2` と `electromagnet` など)。ツールチェンジャで持ち替える → `tool_changer` とグリッパ/パッドの方式の両方。
   複数のハンドを並べる → `multi_tool` と方式。本文に出てくる方式をすべて(3 つまで)
4. **小分類の取り違え**: 2 つの爪が平行に開閉 = parallel2、3 爪 = parallel3、角度開閉(ジョーが回る)= angular、穴の内側を広げて持つ = internal、
   多指・アダプティブ(Robotiq 2F/3F は adaptive)= adaptive。パッド 1 個 = single_pad、2 個以上 = multi_pad、フォーム・面で吸う = area。
   製品名から決まるもの: Schunk PGN/PGL・Zimmer GEP・OnRobot RG2/RG6・2FG7 = parallel2、OnRobot VGC10/VG10・Piab piCOBOT = multi_pad(パッド数による)、
   Schmalz FXP/FMP = area、Magswitch = electropermanent、Soft Robotics mGrip = soft_finger、Robotiq Hand-E = parallel2
5. 本文に「グリッパ」「爪」「チャック」「pinza」などとだけあって指の形が書いていなければ `mech_text`(機械式(指の形の記載なし))、
   「吸着」「suction」とだけあってパッドの形が書いていなければ `vacuum_text`。`hand_unspecified` は方式がまったく書いていないときだけ
6. 本文に方式が無く、今の値が写真の判定・推定で、上の 1・2 に当たらなければ principles は省く

## 作業(tasks)
- 実際にしている作業だけ。本文の「用途の例」の列挙、会社の他の事業は入れない
- bin_picking はばら積み(乱雑に積まれた)ワークを取るときだけ。整列したワークを取るのは pick_place / machine_tending
- sorting は種類・品質で振り分けるとき。向きを揃える・整列は pick_place
- packing は箱・袋・トレイに詰める工程が本文にあるときだけ。パレットに積むのは palletizing
- 工作機械・プレス・射出成形機への投入/取り出し = machine_tending。パレット間・コンベヤ間の積み替えは palletizing / depalletizing / pick_place
- welding / finishing / inspection は、そのロボットがその作業をするときだけ(ハンドリング担当のロボットなら入れない)

## ワーク(categories)
- 実際に扱うワークすべて(3 つまで、主なものから)。例として並ぶだけの品目は入れない
- 自動車部品(body_panel・engine・ev_battery・tire・seat_interior)は自動車向けのときだけ。船舶・建機・汎用エンジンの部品は casting / block / round
- ev_battery は EV・車載の電池だけ(鉛蓄電池・据え置き蓄電池・電池セル一般は component)
- sack は粉体袋・米袋・肥料袋のような柔らかい袋。網袋・パウチ・小袋は pouch
- generic は本当に分からないときだけ
