# 同梱ライブラリ

オフラインでも動くようにリポジトリに同梱している。版を上げるときは下の URL から取り直し、この表を更新する。

| ファイル | 元 | 版 | ライセンス |
|---|---|---|---|
| `three.module.min.js` | https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js | r170 (0.170.0) | MIT（`LICENSE.three.txt`） |
| `addons/controls/OrbitControls.js` | https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js | 同上 | 同上 |
| `addons/controls/TransformControls.js` | https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/TransformControls.js | 同上 | 同上 |
| `addons/loaders/STLLoader.js` | https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/STLLoader.js | 同上 | 同上 |

`lexxmoma-2d.html` の importmap で `three` → `./vendor/three.module.min.js`、`three/addons/` → `./vendor/addons/` に対応づけている。
