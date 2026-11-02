# 動作シミュレーター（site/simulator）— 作業のルール

詳しい仕組みは `README.md`。ここには、直すときに必ず守ることだけを書く。

## 生成物を作り直す（build.py）

`lexxmoma-2d.html` をダブルクリック（`file://`）で開いても 3D とサンプルが動くよう、
`build.py` が次の 3 つを作る。ブラウザは `file://` では ES モジュールと fetch を止めるため。

| 元のファイル | 生成物 |
|---|---|
| `vendor/three.module.min.js`、`vendor/addons/` | `vendor/three.bundle.js` |
| `meshes/crx20ia_l/*.stl` | `meshes/crx20ia_l.js` |
| `samples/index.json`、`samples/*.json` | `samples/embedded.js` |

- 左の列のどれかを変えたら、`site/simulator` で `python3 build.py` を実行し、生成物も同じ commit に入れる
- 生成物は直接直さない（次の build で消える）
- 実行し忘れると CI（`.github/workflows/pages.yml` の「Check built tools are up to date」）で止まる。commit の前に自分で実行しておく

## コードを書くとき

- `sim3d.js` は普通のスクリプト（即時関数で包んである）。`import` / `export` を書かない。Three.js の部品は `window.THREE` から取る
- 新しいファイルを読み込むときも、`<script src>` で読める形にする。fetch・ES モジュールに頼ると、ダブルクリックで開いたときに動かなくなる
- サイトの一番上から始まる絶対パス（`/simulator/…`）を書かない。lexxpluss.com では `/lexxmoma-tools/` の下に置かれる
- `lexxmoma-2d.html` の行末は CRLF
- 変更のたびにヘッダーの `rev.N` を上げる（保存 JSON に記録される）

## 確かめる

- テスト: `node --test site/simulator/test/kinematics.test.cjs`
- サーバー経由: リポジトリの一番上で `python3 scripts/serve.py 8743` → `http://localhost:8743/simulator/lexxmoma-2d.html`
- ダブルクリック: `lexxmoma-2d.html` を直接開き、3D の切替と「📂 サンプル」が動くこと

## 公開

- main に入った `site/` は、GitHub Pages（`pages.yml`）と、lexxpluss.com（`sync-site-branch.yml` が `site/` を `cloudways-deploy` ブランチに写す）に出る
- main に直接 push・マージしない。ブランチと PR まで
