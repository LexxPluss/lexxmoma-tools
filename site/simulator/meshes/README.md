# アームの形状データ

`crx20ia_l/*.stl` は FANUC 公式の ROS 2 ロボット記述リポジトリ
https://github.com/FANUC-CORPORATION/fanuc_description
（`fanuc_crx_description/meshes/crx20ia_l/collision/`）の衝突判定用メッシュ。
SPDX-FileCopyrightText: 2025-2026, FANUC America Corporation / FANUC CORPORATION、
SPDX-License-Identifier: Apache-2.0（`LICENSE.Apache-2.0.txt`）。

- 単位 mm。各リンクフレームでの配置は同リポジトリの `crx20ia_l_urdf_macro.xacro` の collision origin
  （`crx-kinematics.js` の `MODEL.meshOffsets`）。
- 見た目を上げたいときは同じ場所の `visual/*.dae`（合計約 7 MB）に差し替えられる。
