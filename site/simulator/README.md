# LexxMoMa 動作シミュレーター（Motion Simulator）

営業担当が顧客の工程に対して「どれくらいのサイクルタイムで回るか」を見積もるツール。
2D（上から）の表示で全体のレイアウトと走行を組み、3D 表示でアームの届く高さ・距離と手先の姿勢を確かめる。
公開版: https://lexxpluss.github.io/lexxmoma-tools/simulator/lexxmoma-2d.html
（元は PoC-Code_MoMaCycleTimeSimulator。このリポジトリが正）

## ファイル

| ファイル | 役割 |
|---|---|
| `lexxmoma-2d.html` | 本体（UI、2D 描画、シーケンスの時間計算、再生、保存・読込、録画）。古典スクリプト |
| `crx-kinematics.js` | FANUC CRX-20iA/L の運動学。順運動学・逆運動学（減衰最小二乗）・WPR 変換・旧形式の変換。依存なし。ブラウザでは `window.CRX`、Node ではモジュール |
| `sim3d.js` | 3D ビュー（Three.js、ES モジュール）。`window.LexxSim3D` を本体に提供。手先ギズモ（TransformControls）、視点操作（OrbitControls）、公式メッシュの読込 |
| `vendor/` | Three.js と使用アドオン（同梱。`vendor/README.md` に版と取得元） |
| `meshes/crx20ia_l/` | FANUC 公式 ROS 2 記述（fanuc_description）の衝突判定用 STL（Apache-2.0）。見た目は簡略だが関節ごとに分かれていて正確に動く |
| `test/kinematics.test.cjs` | 運動学のテスト（`node --test`）。CI でも走る |
| `LexxMoMa_Simulator_Spec_v1.0.md` | 最初のヒアリングで確定した仕様（2D） |

`*.md`・`test/` は GitHub Pages には公開されない（`.github/workflows/pages.yml`）。

## アームのモデル（3D・6 軸）

- 関節配置・リンク長・可動範囲・最大角速度は FANUC 公式の
  `fanuc_crx_description/urdf/crx20ia_l_urdf_macro.xacro` の値（`crx-kinematics.js` の `MODEL`）。
  取付面→J2 245 mm、上腕 710 mm、前腕 540 mm、手首オフセット 150 mm、フランジ 160 mm、最大リーチ 1,418 mm。
- 角加速度は非公開のため「最大速度に 0.4 s で到達」の推定値（2D 版からの前提を踏襲）。
- アーム基準座標は URDF の `wbase`（J1 回転中心・取付面の 245 mm 上、x 前・y 左・z 上）。
  手先の姿勢は FANUC 表記の W/P/R（固定軸 XYZ）。ツール長は FANUC フランジの z 方向。
- アーム取付: 車体中心、床から 750 mm（`ARM_MOUNT_Z`。Output/02 の案、要確認）。車体は 750×600 mm（従来どおり）。
- 逆運動学は数値解（減衰最小二乗、関節制限内にクランプ）。届かない目標には最も近い姿勢を返し、UI に警告を出す。
- 2D の表示は同じ 6 軸姿勢を上から投影したもの。Shift＋↑↓ の「伸縮」と Shift＋PgUp/PgDn の「上下」は
  手先の姿勢を保ったまま IK で解く。

## 保存ファイルの互換

- `version: 2`（rev.63〜）: `armPoses[].q` と `robot.arm.q` は 6 関節角 [rad]、`toolLen` [mm] を追加。
- `version: 1`（〜rev.62）: `{q1, reach}` 形式。読込時に `CRX.fromLegacy()` で「ツール下向き・水平リーチ一致・
  高さ = J1 原点」の 6 軸姿勢に変換する（元の 2D では高さの情報が無いため）。

## 次の段階（予定）

1. 3D の障害物・設備（四角を描いて押し出すなど）を置けるようにする
2. 運ぶ物（STEP などの形状）を実寸で読み込み、シーケンスに「掴む／離す」を加えて手先に付けて動かす

## 開発

- ローカル確認: `python3 scripts/serve.py` で `site/` を配信し `http://localhost:8000/simulator/lexxmoma-2d.html`
  を開く（ES モジュールを使うため `file://` では 3D が動かない）
- テスト: `node --test site/simulator/test/kinematics.test.cjs`
- 変更のたびにヘッダーの `rev.N` を上げる。保存 JSON にも rev が記録される
- 行末は CRLF（`lexxmoma-2d.html`）
