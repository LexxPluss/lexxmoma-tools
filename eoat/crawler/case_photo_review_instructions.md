# 事例ごとの写真と本文の見直し(ループ 15 の品質ループ。サブエージェント向け)

`eoat/data/case_review/sheets/c_NNN.jpg` は事例 8 件を 1 行ずつ並べたシート。行の写真には黄色で `行-枚目`(例 `3-2` = 3 件目の 2 枚目)が付いている。
同じ名前の `c_NNN.json` に、各事例の `n`(行)・題名・本文の冒頭 400 字・今の値(`current`)がある。
**シートの画像を Read で開いて実際に見てから**判定する。画像が読み込めなかったシートは出力を書かない(見ていないものを判定しない)。

## 事例ごとに見ること
1. **is_case**: 本文と写真が「ロボット(+ハンド)で何かを掴む・扱う導入事例・実証・応用例」でなければ `false`。
   - false にするもの: ロボットと関係ない記事・求人・会社概要・IR・展示会の告知だけ・ソフトウェアの広告だけ・ハンドが一切出てこない製品の一般紹介
   - 迷ったら `null`(残す)。製品ページでも「何をどう掴むか」の応用例が写真か本文にあれば残す
2. **images_bad**: その事例の写真として使えない画像の「枚目」番号(1〜3)。人物だけ・ロゴ・図表・明らかに別の案件(題名と関係ないワークや業界)・広告・風景。迷ったら入れない
3. **robot_class**: 写真でロボットが見え、区分がはっきり分かるときだけ。`今の値が空のときだけ`意味がある
   - `協働`: UR(水色/灰色の丸い関節)、FANUC CRX(白/緑)、Doosan、Techman、Kinova、Franka、ABB YuMi/GoFa、安全柵なしで人の隣
   - `産業用`: KUKA(橙)、FANUC(黄)、ABB IRB(白/橙)、安川(青/白)、川崎・Nachi・Stäubli、スカラ・パラレルリンク・パレタイザ、柵の中
4. **robot_maker**: ロゴか、そのメーカーとはっきり分かる意匠のときだけ(例 "KUKA", "FANUC", "Universal Robots", "ABB", "Yaskawa")。推測なら null
5. **grasp**: ハンドが写っていて、掴み方の大分類がはっきり分かるとき
   - `group`: mech / vacuum / magnet / soft / combo のどれか(作業ツール=溶接・ねじ締め等は書かない)
   - `subtype`: 下の小分類キー。分からなければ null
   - `conf`: high(指・吸盤がはっきり見える)/ medium / low。反映されるのは high だけ
   - `seen`: 見えたもの(例 "2 本指の平行グリッパでシャフトを把持")
6. **category**: 今のワークの 1 つ目が「汎用(その他)」のときだけ、写真と本文から分かるワークのキーを 1 つ。分からなければ null
7. **note**: 判断の短い理由(80 字まで)

## 小分類キー(掴み方)
- mech: parallel2(2 指平行) parallel3(3 指) adaptive(多指・アダプティブ) angular(角度開閉) internal(内径把持) clamp_fork(クランプ・フォーク) hook(フック・吊り)
- vacuum: single_pad(単パッド) multi_pad(複数パッド) area(フォーム・エリア吸着) bernoulli(ベルヌーイ) magnet_vacuum(静電・ゲッコー)
- magnet: electropermanent electromagnet permanent
- soft: soft_finger(空気圧ソフトフィンガ) jamming needle inflatable
- combo: hybrid(吸着+把持) tool_changer multi_tool(多連)

## ワークのキー
carton tote container tray / sack fibc pouch / round block sheet casting bulk_parts gear / molded film / pcb component device /
glass_plate panel wafer / fresh meat_fish bakery ready_meal egg dairy / vial tube plate medical / bottle can cup /
textile cable rubber / timber building / body_panel tire engine ev_battery seat_interior / pallet / piece luggage / paper cosmetics

## 出力
`eoat/data/case_review/out/c_NNN.json` に、シートの全事例(8 件)を配列で:
```json
[{"n": 1, "is_case": null, "images_bad": [], "robot_class": "産業用", "robot_maker": "KUKA",
  "grasp": {"group": "vacuum", "subtype": "multi_pad", "conf": "high", "seen": "吸盤 4 個で段ボールを吸着"},
  "category": null, "note": "橙色のアーム、ロゴ KUKA"}]
```
値が無い項目は null(images_bad は [])。本文から既に確定している値と食い違っても、写真で見えたことをそのまま書く(反映は空・推定・汎用のときだけ)。
