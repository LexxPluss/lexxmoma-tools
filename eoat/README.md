# エンドエフェクタ事例データベース(eoat/) — 運用手順

社内限定・試験運用。「掴みたいモノ」「やりたいこと」を入れると、世界の SIer・メーカー・ユーザーが公開している
エンドエフェクタ(ハンド)の実例が画像付きで出て、「このワークはこう掴むのが一般的」が 1 分で分かるツール。
閲覧 UI は `site/members/eoat-db/`(社内ツールの入口から。データも画像も暗号化)。

## 守るべき流儀(このリポジトリの他のツールから)
1. 目的から作る: 利用者の問い(このワークはどう掴む? 誰がどこでやった?)に最短で答える機能だけ足す
2. 静的サイト・素の JS・cdnjs の固定版だけ。assets/theme.js の共通ヘッダー、ロゴでトップへ、ライト/ダーク両対応
3. 出典の無い値は保存しない。項目ごとに `fieldSources`(URL・取得日・方法)を持ち、確認できない値は空欄
4. 事実と解釈を分ける。LexxMoMa での適用可能性は `interpretation` に `is_speculative: true` で置く
5. 品質ループ: 指標を数値で定義 → 悪い順に原因を分析 → 直す → 回ごとの数値を表に残す(people/ と同じ)
6. 抜けは「なぜ漏れたか」(名簿・語彙・判定・巡回)から直し、同じ原因の他の事例も一緒に拾う(sier #20・#41 と同じ)
7. 足す → 複雑さを評価 → 簡素化 を DESIGN.md に記録(process-sketch と同じ)
8. 社内限定: 原本・平文・ログ・元画像はコミットしない(.gitignore + pages.yml の混入チェック)
9. クロールは robots.txt を守り、1 ドメイン 2 秒以上、UA に社名と連絡先。計測では入力内容を送らず件数だけ
10. 平易な日本語。「人の置き換え」「削減人数」は使わない

```
eoat/
  README.md  DESIGN.md
  crawler/   common.py sources.yaml discover.py crawl.py extract.py normalize.py classify.py images.py dedupe.py audit.py build.py delete_case.py
  taxonomy/  categories.yaml materials.yaml principles.yaml tasks.yaml robot_models.yaml synonyms.yaml
  manual/    suppressions.json(削除依頼) image_policy.json(ドメインごとの画像方針) reviews.json(レビュー)
  tests/     test_pipeline.py queries.yaml eval_queries.py / .cjs playwright_eval.js
  raw/ data/ logs/   取得原本(HTML・元画像)・平文・実行ログ(.gitignore。コミットしない)
site/members/eoat-db/  index.html app.js search.js style.css test/ui.test.cjs
                       data.enc.json / data.enc.js(事例)  img/thumb/p-NNNN.bin(一覧用パック) img/detail/<id>.bin(詳細用)
```

## セットアップ

```sh
pip install -r eoat/crawler/requirements.txt      # + 顔検出に opencv-python-headless(任意。無ければ顔の除外を飛ばす)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu && pip install open_clip_torch   # 画像の中身判定(任意。無ければ規則だけ)
```

| 環境変数 | 用途 |
|---|---|
| `EOAT_PW`(または `FACTORY_PW` / `PEOPLE_PW`) | 暗号化の共通パスワード(社内ツールの入口と同じ)。工場マップ・顧客人事DB と同じ方式(PBKDF2-SHA256 310,000 回 → AES-256-GCM) |
| `EOAT_CONTACT` | クローラの User-Agent に入れる連絡先(既定は https://lexxpluss.com/) |

## 手順(ローカル)

```sh
cd eoat/crawler
python discover.py                 # sources.yaml の一覧ページを巡回 → data/candidates.json(冪等・増えるだけ)
python crawl.py --workers 10       # 事例ページを取得 → raw/pages/(取得済みは再取得しない)
python extract.py                  # 本文・見出し・画像候補・動画・年 → data/extracted/(noindex / noai は取り込まない)
python classify.py --force         # 語彙との一致で分類 → data/classified/。事例でないページは data/rejected.json
python images.py --workers 10      # 画像の取得・確認・縮小(240px / 400px WebP, EXIF 除去, phash, 顔検出, CLIP で中身判定) → raw/images/ と data/img/
python llm_prep.py                 # LLM レビューの入力(data/llm_batches/)。レビューは llm_review_instructions.md の手順でサブエージェントが data/llm_out/ に書く
python llm_merge.py                # レビューを分類結果に反映(method: inferred + 本文の引用)
python sier_discover.py            # (任意)SIer DB 1,500 社の公式サイトから事例ページを発見して候補に足す → その後 crawl.py から
python build.py --password …       # 重複除去 → 検証 → data/cases.json(平文)→ 暗号化データと画像パック(site/members/eoat-db/)→ 監査
python -m unittest discover -s ../tests            # 受入テスト
python ../tests/eval_queries.py                    # 検索の評価(precision@12 など)
node --test ../../site/members/eoat-db/test/ui.test.cjs
python3 ../../scripts/serve.py 8750 &  EOAT_PW=… node ../tests/playwright_eval.js   # ブラウザでの速さ・崩れの確認
```

- 各ステップは冪等。`--force` で分類だけやり直せる(画像は `images.py --force`)。
- 画像パックは追記型: 既存のパックは書き換えず、新しい画像は新しいパックへ。パスワードを変えたときだけ全部作り直す(`data/packs.json` の key_check)。
  `data/packs.json` が無い環境では公開側のパックを削除して作り直す(履歴が膨らむので、できれば同じ環境で続ける)。
- `build.py --plain-only` は平文だけ作る(確認用)。

閲覧: `python3 scripts/serve.py 8750` → http://localhost:8750/members/eoat-db/ (共通パスワードは社内ツールの入口で入れる)。

## 画像の権利方針(4-3)

法的な拠り所は **著作権法 47 条の 5(所在検索サービスにおける軽微利用)**。その条件を満たす形でだけ画像を格納する。
- 収集の作法: robots.txt で禁止されたページ・画像は取得しない。`<meta name="robots">` の noindex / noimageindex / noai、X-Robots-Tag も尊重する(extract.py・images.py)。
  1 ドメイン 1 リクエスト / 2 秒以上。User-Agent に社名と連絡先。ログイン・有料の壁は越えない。
- 適法に公開されている画像だけ。転載物と思われる画像は使わず原典を探す。
- 軽微な利用: 格納するのは縮小版だけ(一覧 240px / 詳細 400px、WebP 品質 72、EXIF・位置情報は削除)。元のサイズの画像は `raw/images/` にだけ置き(gitignore)、
  利用者には「元の画像を見る」で出典元へ送る。
- 所在の提示: すべての画像に元ページ URL・元画像 URL・クレジット(サイト名)・取得日を付け、UI では画像の隣に常に表示する。
- 改変しない: トリミング・注釈の焼き込み・色の変更はしない(縮小だけ)。ハンドの位置は `hand_bbox` として別に持ち、UI 上で枠を重ねる。
- 規約で画像の利用を明示的に禁じているサイトは `manual/image_policy.json` に `{"domains": {"example.com": {"policy": "link_only", "note": "…"}}}` と記録する。
  その事例は画像を置かず、掴み方のピクトグラムと出典リンクだけにする(2,000 件に数えない。全体の 5% 以下)。
- 人物: 顔が主役の画像は避ける(顔検出で面積 4% 超を除外。見逃したものはレビューで差し替え)。
- 本文は長く写さない。`summary_ja` は分類から組み立てた自分の言葉(原文は `title_orig` の題名だけ)。
- 海外サイトの画像も同じルール。**社外公開の前に法務の確認を挟む**(47 条の 5 の「軽微」の範囲、海外画像の扱い)。

### 削除・訂正依頼(7 営業日以内)
1. 依頼を受けたら `python delete_case.py --case <id> --reason "依頼日・経路"`(画像なら `--image <画像id>`、サイトごとなら `--domain example.com`)。
   `manual/suppressions.json` に登録され、次のビルドから除かれる(log に氏名は残さない)。
2. `python build.py --password …` で暗号化データを更新してコミット。
3. 訂正は、出典を確かめて `taxonomy/` か `manual/reviews.json` を直して再ビルド。原本(raw/)は残す。
4. 窓口: 社内ツールの担当者(本 README の更新者)。社外からの依頼は会社の問い合わせ窓口経由。

## データの規律
- 1 件 = あるワークを、あるハンドで、あるロボットで扱った実例。スキーマは指示書 3-2(classify.py の出力)。
- 分類は語彙との一致だけで付け、一致した語を `fieldSources` に残す。LLM で補う場合は `method: inferred` を付ける(初版では未使用)。
- ロボットの区分は型式(`taxonomy/robot_models.yaml`)か本文の明記からだけ。型式が無ければ「不明」。
- 「LexxMoMa での適用可能性」は `interpretation.lexxmoma_fit`(`is_speculative: true`、根拠と「確認すること」付き)。

## 指標の定義(7-1 / 7-2 / 7-3)
| 指標 | 意味 | 目標 |
|---|---|---|
| total | 重複除去・画像格納済みの事例数 | ≥ 2,000 |
| image_stored_rate | 画像を格納できた事例の割合(link_only を除く) | ≥ 95% |
| image_attribution_coverage | 格納画像に元ページ URL とクレジットがある割合 | 100% |
| image_relevance_error_rate | 無作為 50 枚を目視してハンドが写っていない割合(`data/spot_check.json` に記入) | ≤ 3% |
| image_bytes_total | 公開側の画像の合計 | ≤ 300 MB |
| field_source_coverage | 値のある項目に出典がある割合 | 100% |
| category_rate / principle_rate / robot_class_rate | 付与済みの割合 | 100% / 100% / ≥ 85% |
| material_rate / payload_rate | 付与済みの割合 | ≥ 80% / ≥ 70% |
| 配分 | 可搬(≤20kg 60%+)・区分(協働 45%+・産業用 40%+・移動 100 件+)・種別(完成品 35%−・SIer 40%+・カスタム 15%+)・地域(日本 30%+・北米 20%+・欧州 20%+・アジア 10%+)・主要カテゴリ 30 件+・主要な掴み方 20 件+ | すべて満たす |
| spot_check_error_rate | 無作為 50 件を出典と画像で照合したときの誤り率 | ≤ 5% |
| dead_source_link_rate | 出典ページのリンク切れ(`audit.py --check-links`) | ≤ 5% |
| precision@12 / zero_result_rate / trend_accuracy | `tests/queries.yaml` 42 問での検索評価 | ≥ 0.85 / 0 / ≥ 0.9 |
| 速さ | ロック解除 → 最初の 24 枚 ≤ 1.5 秒(Fast 3G ≤ 4 秒・2 回目 ≤ 0.8 秒)、絞り込み → 画像 ≤ 300 ms、詳細 ≤ 150 ms、外部画像リクエスト 0 | `tests/playwright_eval.js` |

## 品質ループの記録
(回 | 直したこと | total | image_stored | 最初の 24 枚の表示秒 | precision@12 | 誤り率 | 画像 MB | 配分の未達)

| 回 | 直したこと | total | image_stored | 24 枚の表示秒(初回/2回目/3G) | precision@12 | 抜き取り誤り率 | 画像 MB | 配分の未達 |
|---|---|---|---|---|---|---|---|---|
| 1 | パイロット: 取得元 28 件(うち巡回できたもの 25)・候補 894 ページ → 事例 143 件。OnRobot の共通バナーと安川のサイドバー定型文を除外(同じ取得元で繰り返す画像・段落)。顔検出で人物写真を除外 | 143 | 100% | 0.74 / 0.52 / 8.8 | — | — | 7.1 | 14 |
| 2 | UR の本文が写真の説明欄になっていた(本文ブロックの選び方: 段落の最も多い候補を選び body の 6 割未満なら body)→ UR 19 → 70 件。OnRobot・Techman は JS 描画なので Chromium で描画して取得(render.js) | 218 | 100% | 0.46 / 0.39 / 22.5 | 0.787 | — | 11.2 | 13 |
| 3 | 作業ツール(研磨・塗布…)は見出しに語があるときだけ付ける(UR の用途一覧の本文で誤って付いていた 21 件を除外)。傾向パネルで作業ツールを最後に。同義語「板」「木」「移動マニピュレータ(作業側)」を整理。パックを 400 KB・代表画像を先に詰め、残りのパックは最初の 24 枚が出てから取る | 191 | 100% | 0.70 / 0.46 / 8.2 | 0.803 | 画像 24% / 分類 20%(各 50 件) | 9.2 | 13 |

| 4 | 画像の中身判定を入れた(CLIP ViT-B/32 のゼロショット: 「ハンドがワークを扱う写真」の確率 < 0.45 を除外 → 683 枚中 175 枚を除外。AMR だけ・工場全景・タブレットを見る人・肖像が主)。代表画像はこの確率が最も高いもの。ハンド製品辞書(ee_products.yaml 64 型式)で掴み方と可搬を補う | 194 | 100% | — | 0.809 | 画像 12% | 8.6 | 13 |
| 5 | 分類の弱い一致を抑える(ワーク・掴み方とも「見出しに語がある」か「本文で 2 語以上」)。CLIP のしきい値 0.52、縁に単色の帯がある画像(動画の静止画)を除外。中国語の同義語 80 語 | 145 | 100% | — | 0.72 | 画像 10% / 分類 16% | 6.6 | 13 |

ループ 5 の評価: 規則を厳しくすると件数が 194 → 145 に減り、検索の precision も下がる(当たる事例そのものが減る)。規則だけでは「本文に多くのワークが出る事例」を正しく読めないので、
ループ 6 からは **規則で候補を集め、公開する事例だけ LLM(サブエージェント)で確認する**(llm_prep.py → data/llm_batches → レビュー → llm_merge.py。値は method: inferred と本文の引用付き)。

ループ 3 回目の時点の未達(フェーズ 2 で直す順): 画像の関連性(人物・工場全景・画面写真が 24%: 画像の内容判定が無い → 軽量な画像分類モデルか、alt の無い og 画像を使わない規則)、
分類の誤り(20%: 製品ページの定型語と用途一覧 → 取得元ごとの抽出規則)、可搬重量の不明 50%(ハンド製品の可搬から推定する規則)、Fast 3G 8.2 秒(data.enc の復号 2.3 秒 + 最初のパック 400 KB → fieldSources の証拠文を短くする・パックを 200 KB に)、
配分(件数が 2,000 に届くまで判断しない。北米・アジア・産業用・移動マニピュレータ・カスタム品が少ない)、検索の zero_result 10/42(卵・ガラス・試験管・磁石など、事例そのものが無いカテゴリ)。

## 収集の進捗(セッションをまたいで続きから再開するためのメモ)
- 取得元の調査(2026-10-26): `crawler/sources.yaml` の `status` を見る。ok = 巡回できる / blocked = Cloudflare 等で取れない / todo = URL 未特定・要再調査。
- 未着手の取得元(次に足す): ロボットメーカー日本(FANUC 日本・不二越・三菱・エプソン・ヤマハ・ダイヘン: 事例 URL を要特定)、ABB(応答が遅い。timeout 90 秒で再試行)、
  SIer DB(`site/robot-sier-map/data/siers.js` 1,500 社の公式サイトから「事例」ページを発見する discover の拡張)、海外 SIer(A3 会員など)、
  公的事例集(経産省・NEDO・RRI の PDF: 要 PDF 抽出)、ユーザー・研究(GitHub / GrabCAD / 大学: 要 API か検索)、中国(Elite・Dobot・Mech-Mind は語彙が英語のみ → 中国語の同義語を足す)。
- Web 検索による発掘は未実施(1 セッションの検索回数に上限。地域 × カテゴリで分担する手順は指示書 4-2)。
