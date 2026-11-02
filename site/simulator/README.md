# PoC-Code_MoMaCycleTimeSimulator


[Try to use on online](https://lexxpluss.github.io/PoC-Code_MoMaCycleTimeSimulator/)
## サンプル（`samples/`）

- シミュレーターの「📂 サンプル」ボタン（`samples.js`）が `samples/index.json` の一覧をカードで出し、選んだ JSON を本体の
  `applyLoadedData()` に渡す。カードにはレイアウトの簡易プレビューとサイクルタイム（本体の計算で算出）が出る
- `?sample=<id>`（`&play=1` で再生まで）を URL に付けると起動時にそのサンプルを開く。共有リンクやツアーから使う
- サンプルを足すときは JSON を `samples/` に置き、`index.json` に 1 件追加する。形式は「設定保存」と同じ
- `test/make_samples.cjs` で現在のサンプル 3 本（展示会デモ、最小のピック＆プレース、同時動作なしの比較）を再生成できる
