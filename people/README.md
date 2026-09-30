# 顧客人事データベース(people/) — 運用手順

社内限定。営業メンバーが面談の前日に「この会社の誰が、いつから、何を任されているか」と「最近の異動が意味すること」を
10 分で把握するためのツール。仕様は SPEC v0.1(社内限定のため、このリポジトリには置かない。`people/SPEC.md` に置いても .gitignore で除外される)。

```
people/
  README.md   (SPEC.md は社内限定のため置かない)
  crawler/    registry.py  crawl_edinet.py  crawl_tdnet.py  crawl_sites.py
              parse_officers.py  parse_disclosure.py  normalize.py  signals.py  build.py  delete_person.py
              rules/phase1.yaml(シグナル規則)  requirements.txt  common.py
  manual/     レビュー・削除依頼・IR URL(Git 管理。manual/README.md)
  tests/      受入基準のテストとフィクスチャ(日本プラスト: 有報・適時開示 PDF・会社サイト)
  raw/ data/ logs/   取得原本・平文・実行ログ(.gitignore。リポジトリにはコミットしない)
site/members/people-db/   閲覧 UI(index.html, app.js, style.css)と暗号化データ(data.enc.json / data.enc.js)
```

## セットアップ

```sh
pip install -r people/crawler/requirements.txt
```

環境変数(リポジトリには置かない):

| 変数 | 用途 |
|---|---|
| `PEOPLE_PW`(または `FACTORY_PW`) | 暗号化の共通パスワード。工場マップと同じ方式(PBKDF2-SHA256 310,000 回 → AES-256-GCM)。工場マップの平文が無い環境では企業マスタの復号にも使う |
| `EDINET_API_KEY` | EDINET API v2 のサブスクリプションキー(SPEC §13-1: 会社アカウントで取得) |
| `PEOPLE_CONTACT` | クローラの User-Agent に入れる連絡先(既定は https://lexxpluss.com/) |

## 手順(ローカル)

```sh
cd people/crawler
python registry.py                       # 工場マップの企業マスタ → data/companies.json(上場区分・証券コード・EDINET コード)
python crawl_edinet.py --from 2026-06-20 --to 2026-07-10   # 有報(要 EDINET_API_KEY)
python crawl_tdnet.py --days 7           # 適時開示(JPX の日別一覧。直近 1 か月分だけ取れる)
python crawl_sites.py                    # 会社サイトの役員一覧・組織図・IR ニュース(manual/ir_urls.json にある会社)
python -m unittest discover -s ../tests  # 受入テスト
python build.py --password <共通パスワード>   # data/*.json(平文)と site/members/people-db/data.enc.*(暗号化)
```

- 各ステップは冪等(同じ書類・同じ日付の取得は再処理しない)。失敗は `logs/YYYY-MM-DD.json` と UI「データ品質」に出る。
- API キー無しで手元の有報 PDF を処理する: `python crawl_edinet.py --pdf <PDF> --company E02216 --doc-id S100YHRY --url <取得元 URL>`
- 工場マップ作成時に取得済みの有報 PDF(`site/internal/factory-db/yuho_pdf/`、約270社分)を一括投入する: `python import_local_yuho.py --workers 6`
  (2026-09-30 に実行済み。255 社分の役員・執行役員が入っている。それ以外の会社は EDINET API キー取得後に crawl_edinet.py で追加)
- 暗号化データは平文を deflate で縮めてから AES-GCM にかける(`"z": "deflate"`)。ブラウザ側は DecompressionStream で戻すため、古いブラウザでは開けない。
- `build.py --plain-only` は平文だけ作り、公開側の暗号化ファイルを更新しない(確認用)。
- `build.py --raw-dir ../tests/fixtures --plain-only` でフィクスチャ(日本プラスト)だけを組み立てられる。

閲覧: `python scripts/serve.py 8749` → http://localhost:8749/members/people-db/ (file:// でも data.enc.js があれば開ける)。

## データの質を上げるループ

有報の本文には「男性N名 女性M名」(役員の人数)と「執行役員はN名」が書いてあるので、これを正解にして組み立て結果を毎回監査する。

```sh
cd people/crawler
python discover_sites.py --workers 16      # 役員一覧ページの URL を自動で探す(manual/ir_urls_auto.json)
python accept_search_urls.py               # Web 検索で見つけた候補(data/search_result_*.json)を取得・解析して確かめてから採用
                                           # (候補は Claude Code のサブエージェントが Web 検索で作る。1 セッションの検索回数に上限がある)
python find_yuho.py                       # 有報の無い上場企業: 各社 IR ページから有報 PDF を探して取り込む
python check_yuho_owner.py                # 有報の持ち主(ページ上部の「会社名(E00000)」)を確かめ、別会社のものを除外
python registry.py && python crawl_sites.py --workers 16   # 役員一覧 + 各人の紹介ページの略歴
python build.py --plain-only               # audit.py も同時に回り、data/audit.json と履歴(audit_history.json)に残る
python audit.py --top 20                   # スコアの低い会社から順に原因を見る → パーサを直す → build → audit を繰り返す
```

| 指標 | 意味 |
|---|---|
| officers_ok_rate | 有報の a 表(提出日現在)から読めた役員数が「男性N名 女性M名」と一致した会社の割合 |
| exec_ok_rate / exec_any | 執行役員の人数が記載(±1)と一致 / 執行役員が 1 名以上いる会社の割合 |
| current_rate / career_rate / own_career | 現職・略歴・社内役員の「当社」経歴が取れた割合 |
| bad_names | 氏名として不自然なもの(部署名・略歴の断片など)の件数 |
| site_rate | 会社サイトの役員一覧を取れた会社の割合 |
| site_yuho_overlap | 有報の役員のうち会社サイトの一覧にも載っている割合(出典どうしの突き合わせ。3 割未満の一覧は取り込まない) |
| persons_with_career | 略歴が 2 行以上ある人物の割合(有報 + 会社サイトの略歴・紹介ページ) |

UI の「データ品質」タブに同じ指標と会社ごとのスコアが出る(スコアの低い順)。2026-09-30 のループの経過は下の「品質ループの記録」。

### 品質ループの記録(2026-09-30)

| 回 | 直したこと | officers_ok | exec_any | current | bad_names | 平均スコア |
|---|---|---|---|---|---|---|
| 1 | 監査を作成(基準値) | 70% | 41% | 88% | 10 | 67.1 |
| 2 | 会社サイトの役員一覧を自動発見(249 社)・取得 | 69% | 77% | 64% | 409 | 65.0 |
| 3 | 氏名判定を厳しく・和暦・氏名欄の生年月日・見出しの空白・略歴 2 列の位置合わせ | 69% | 75% | 89% | 164 | 76.3 |
| 4〜5 | 読み仮名の分離・b 表(総会後予定)の検出を「2 つ目の男性N名女性M名」に | 63%※ | 73% | 87% | 21 | 75.4 |
| 6 | 補欠監査役の表を除外 | 88% | 73% | 88% | 21 | 82.4 |
| 7〜9 | ＊印・外国籍の方の氏名・外字、サイトの見出し役位の継承、執行役員数の読み取り | 91% | 83% | 87% | 3 | 85.1 |
| 10〜12 | Web 検索で役員一覧 URL を補う(取得・解析で確認できた 51 社を採用)、担当・管掌・統括を担当役員として組織に、ローマ字重複の除去 | 91% | 84% | 87% | 5 | 86.1 |

| 13〜16 | 有報の持ち主チェック(別会社の有報 6 件を除外)、IR ページから有報を補完(16 社)、サイトの略歴・紹介ページの取り込み、有報とサイトの突き合わせ(重ならない一覧 17 件を除外)、「注４」・読点入りの人数見出し | 92% | 83% | 86% | 4 | 86.2 |

人事データのある会社は 246 → 356 社、1 社あたりの人物は中央値 14 → 21 名、執行役員は 0 → 9.5 名になった。
会社サイトの役員一覧は 297 社分(84%)。見つからない・取得できない会社(403 や JS 描画など)は約 130 社残る。

※ 4 回目から「a 表の人数を完全一致で比べる」厳しい基準に変えたため下がって見える。

## 毎週月曜のチェック(営業定例)

1. UI「新着」で過去 30 日の異動とシグナルを担当者で絞り、「Slack に送る文面をコピー」で定例チャンネルに貼る(投稿は手動。Phase 3 で自動化)。
2. 「営業シグナル」の **レビュー待ち** を担当者が読み、「確認済」か「非表示」を付ける。規則が出した解釈は推測を含むので、確認済にしたものだけを営業トークに使う。
3. 「レビューを書き出す」で落ちる `reviews.json` を `people/manual/reviews.json` にマージしてコミット(ブラウザ内の状態は下書きで、他の人には見えない)。
4. 「データ品質」で失敗企業・パース失敗(手動確認キュー)・EDINET 未照合を見て、`manual/` の該当ファイルを直す。

## 削除・訂正依頼(SPEC §9: 7 営業日以内)

1. 依頼を受けたら `python people/crawler/delete_person.py --person-id <persons.id> --reason "<依頼日・経路>"`
   (ID が分からなければ `--company <会社ID> --name "<氏名>"`)。`manual/suppressions.json` に登録され、平文データからも除かれる。
2. `python people/crawler/build.py --password …` で暗号化データを更新してコミット(`--rebuild` を付ければ続けて実行)。
3. 訂正依頼は、誤りの出典を確かめて `manual/` の該当ファイルを直し、再ビルドする。原本(raw/)は残す。
4. 依頼と対応日を情報管理の記録に残す(suppressions.json の log には氏名を残さない)。

## データの規律

- 保存する個人属性は氏名・生年月(月まで)・入社年月・役職履歴のみ。生年月日の「日」、住所、写真、株式数、報酬は保存しない。
- すべての在任・イベント・シグナルに `source_id`(出典 URL・取得日)が付く。出典の無い値は保存しない。
- 「事実」と「解釈(営業シグナル)」は別テーブル・別表示。解釈には `is_speculative` と「面談で確認する問い」が必ず付く。
- 文面に「削減人数」「置き換え」を使わない(テストで検出)。省人化は「省人化(再配置)」。
- クロールは robots.txt を守り、1 ドメイン 1 リクエスト / 2 秒以上、User-Agent に社名と連絡先。

## 実行のしかた(自動化はしていない)

定期実行(GitHub Actions)は置いていない。収集したい情報を今後足していく前提で、必要なときに手元で上の手順を実行し、
暗号化データ(`site/members/people-db/data.enc.*`)を更新して PR で出す。

## 未決事項(SPEC §13)と TODO(spec)

- EDINET API の名義・キー取得(§13-1)。キーが無いと有報は `--pdf` での手動処理のみ。
- TDnet の収集手段(§13-2)。**(a) JPX 適時開示情報閲覧サービスは robots.txt が全体を禁止している(2026-09-30 確認)ため取得しない。**
  現状は (b) 各社 IR の静的ページだけ。第三者ミラー(c)は未使用。E-IR Parts など JS 描画の IR ページ(日本プラスト等)は取れない。
  異動の予告を網羅するには、JPX の公式配信(TDnet API 等の契約)か第三者ミラーの利用可否の判断が必要。
- 手動投入の運用者(§13-3)、レビュー責任者(§13-4)、社内規程への追記(§13-5)。
- `TODO(spec)` コメント: `crawl_edinet.py`(API 仕様・XBRL 要素名)、`crawl_tdnet.py`(一覧 HTML の構造)。
- 参考 MVP `nihon-plast-people-db.html` はリポジトリにも Downloads にも無かったため、MVP の手書き note / signals の manual/ への移行(§8)は未実施。
  代わりに有報(S100YHRY)の実データ(役員 10 名 + 執行役員 5 名)を基準フィクスチャにしている。
- 組織図が画像のみの会社は `needs_manual`。UI は会社サイト上の画像 URL をそのまま表示する(画像は raw/ に保存、公開側には置かない)。

- IH パイプライン・担当者・担当案(直販 / 代理店 / CEO)はこの DB では持たない(2026-09-30 の指示で削除)。案件の情報は Notion 側で扱う。
