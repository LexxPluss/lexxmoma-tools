# 工場マップ 韓国・台湾拡張(factory/) — 運用手順

社内限定。日本の工場マップ(485 社・3,192 工場)と同じ構造・同じ品質で、韓国と台湾の製造業の会社と工場を集め、
同じ暗号化データ(`site/members/factory-map/data.enc.*`)に国タグ(JP / KR / TW)付きで統合する。
日本分のクローラ(`site/internal/factory-db/`、社内限定で未公開)には手を入れず、その出力(暗号化データ)を復号して使う。

```
factory/
  README.md
  crawler/   common.py(取得・ID・暗号化)  normalize.py(スキーマ・住所・業種)  geocode.py(Nominatim)
             tw_registry.py  tw_factories.py  kr_registry.py  kr_dart.py  sites.py(公式サイト)   ← 各国の取得
             build.py(統合・暗号化)  audit.py(品質の監査)  requirements.txt
  manual/    会社の選定・業種の対応表・手修正(Git 管理)
  tests/     受入テスト
  raw/ data/ logs/   取得原本・平文・実行ログ(.gitignore。リポジトリにはコミットしない)
site/members/factory-map/   閲覧 UI(index.html, app.js, style.css)と暗号化データ(data.enc.json / data.enc.js)
```

## データの構造(日本と同じ)

| 表 | 項目 |
|---|---|
| companies | id name legal industry group parent listed rev revFy revUrl emp hq web **country nameEn nameJa code** |
| factories | id cid oid op name addr pref city prod seg area floor emp empAsof est src src2 srcType srcLabel lat lng prec **country nameEn opEn** |

- `country`: JP / KR / TW。旧データ(無い場合)は JP とみなす。UI は国チップで絞り込み、「国別」で並べ替え、一覧に国タグを出す。
- `rev` は各国通貨の「億」(億円 / 億ウォン / 億台湾ドル)。UI の売上順は `countries[].fx`(概算の為替)で円換算して並べる。
- `pref` / `city`: 韓国は 시・도 / 시・군・구、台湾は 縣・市 / 區・鄉・鎮・市。地域の絞り込みは国ごとの区分。
- `prec`: address(番地まで) / town / city / prefecture(日本と同じ区分)。
- `srcType`: official(会社の公式サイト) / yuho(法定開示: 韓国 DART の事業報告書、台湾の年報) / public(公的機関の登記・名簿)。
- すべての工場に出所 URL(`src`)が付く。出所の無い値は保存しない(日本と同じ規律)。

## セットアップ

```sh
pip install -r factory/crawler/requirements.txt
export FACTORY_PW=<共通パスワード>      # 日本分の復号と統合後の暗号化に使う(リポジトリには置かない)
export FACTORY_CONTACT=<連絡先 URL>     # クローラの User-Agent(省略時 https://lexxpluss.com/)
```

## 手順(ローカル)

```sh
cd factory/crawler
python tw_registry.py                  # 台湾: 証券取引所・櫃買中心の OpenAPI から上場・上櫃の製造業を選び data/tw/companies.json
python tw_factories.py                 # 台湾: 経済部の工場登記(公示資料)・年報・公式サイトから工場を集め data/tw/factories.json
python kr_registry.py                  # 韓国: 上場製造業の会社一覧 data/kr/companies.json
python kr_dart.py                      # 韓国: DART の事業報告書(사업의 내용・생산설비)から工場を集め data/kr/factories.json
python build.py --plain-only           # 統合(data/merged.json)とスキーマ検査
python audit.py                        # 国別の品質指標(日本と比較)
python build.py                        # 暗号化して site/members/factory-map/data.enc.* を更新 → PR
```

各ステップは冪等(取得原本は raw/ に残し、同じ URL は再取得しない)。クロールは robots.txt を守り、1 ドメイン 1 リクエスト / 2 秒以上、Nominatim は 1 秒以上。

## 品質の基準(日本と同じ水準)

`audit.py` が出す指標を日本と比べる。目安は日本の値(2026-09-30 時点):
住所あり 99.8% / 緯度経度あり 99.8% / 番地まで特定 72.5% / 生産品目あり 87.9% / 従業員数あり 41.6% / 敷地面積あり 40.9% / 出所が公式・法定開示 99.5%。
