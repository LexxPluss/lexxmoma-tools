# Web 検索による事例の発掘(検索エージェント向けの共通手順)

目的: 「あるワークを、あるハンド(エンドエフェクタ)で、ロボットが扱った実例」が **写真付きで** 載っている公開ページの URL を集める。
集めた URL は後段(crawl → extract → classify → 画像 → LLM レビュー)で機械的に選別するので、ここでは **当たりそうな URL を広く** 出してよい(採用率は 2 割程度でよい)。

## 分担
地域 × カテゴリで分ける(例: 北米 × 物流、アジア × 製造、産業用、移動マニピュレータ)。分担の `tag` は起動時に渡される。

## 制限(守ること)
- 検索(WebSearch)は **1 エージェント 25 回まで**(日本語の site: 指定は standard モードで効かないことがある。SIer 事例を狙うときは extended モード)。ページを開いて確かめる(WebFetch)のは必要なときだけ(目安 10 回まで)。**curl 等で直接取らない**(2 秒間隔・robots.txt は後段の crawl.py が守る)。
- `eoat/data/crawl_blocked.txt`(無ければ README の blocked の取得元)にあるドメインは取れないので **除外**する(検索語に `-site:` を付ける)。
- 既に一覧ページを巡回している取得元は、この分担では **狙わない**(別の手段で取っている): universal-robots.com, robotiq.com, onrobot.com, schunk.com, schmalz.com, piab.com, kuka.com, fanuc.co.jp, fanuc.eu, fanucamerica.com, robotsi.fanuc.co.jp, kawasakirobotics.com, motoman.com, yaskawa.co.jp, mujin.co.jp, mech-mind.com, formic.co, tm-robot.com, zimmer-group.com, weiss-robotics.com, dobot-robots.com, kassowrobots.com, aubo-robotics.cn, elibot.com, daihen-robot.com, global.yamaha-motor.com, mobile-industrial-robots.com, vention.com, hirebotics.com, ifr.org, soft-gripping.com, xyzrobotics.com, neura-robotics.com, denso-wave.com, iai-robot.co.jp
- 研究論文(arXiv・PMC・Wiley 等。実機の導入事例ではない)・PDF・動画だけのページ(YouTube 等)・SNS・ログインが要るページ・ニュースリリースの一覧ページ・製品カタログの一覧は出さない。**1 事例 = 1 ページ** の URL だけ。
- robots.txt やボット対策を回避する手段は使わない。

## 良い URL の条件
1. 1 つの導入事例・適用例のページ(SIer の「導入事例」、ロボット/ハンドメーカーの「事例」「アプリケーション」、ユーザー企業の事例紹介、大学・研究の事例)
2. ハンドがワークを掴んでいる(または吸着している)**写真** があること。人物のインタビュー写真だけ・工場の全景だけは不可
3. 本文に、ワーク(何を)・掴み方(真空吸着・2 指・3 指・ソフトハンド・磁力・袋用・カスタムなど)・ロボット(メーカー/型式、協働か産業用か)の少なくとも 2 つが書かれていること
4. 地域の偏りを直すため、狙いは **北米・アジア(韓国・台湾・東南アジア・インド)・産業用アーム(FANUC/ABB/KUKA/安川/不二越/デンソー等の SIer 事例)・移動マニピュレータ(AMR+アーム)**

## 検索語のヒント
- 英語: "case study" gripper robot palletizing / "end effector" "case study" / "vacuum gripper" "case study" depalletizing / integrator "case study" robot "machine tending" / "mobile manipulator" "case study" / "bin picking" "case study" gripper
- 日本語: 導入事例 ハンド 把持 ロボット / 事例 吸着ハンド パレタイズ / 導入事例 協働ロボット ピッキング / 移動ロボット アーム 事例
- 韓国語: 로봇 그리퍼 적용사례 / 협동로봇 도입사례 그리퍼 / 팔레타이징 로봇 사례
- 中国語: 机器人 夹爪 应用案例 / 真空吸盘 码垛 案例 / 协作机器人 案例 抓取
- 業種別に「palletizing / depalletizing / machine tending / bin picking / case packing / bag handling / sheet metal / glass / food / pharma」を組み合わせる
- サイト内の事例一覧(`/case-studies/`, `/cases/`, `/applications/`, `/jirei/`, `/works/`)を見つけたら、そこから個別ページの URL を複数拾う(WebFetch 1 回で 10〜30 本取れる)

## 出力
`eoat/data/search_result_<tag>.json` に **JSON 配列 1 つ** で書く(UTF-8)。1 行 = 1 URL:
```json
[{"url": "https://example.com/cases/abc", "title": "…", "region": "na", "category_hint": "carton", "robot_hint": "industrial", "query": "検索語"}]
```
- `region`: jp / na / eu / cn / asia / other
- `category_hint`(任意): carton, tote, sack, round, block, sheet, casting, bulk_parts, molded, pcb, glass_plate, fresh, bakery, vial, bottle, textile, pallet, piece, …(分からなければ空)
- `robot_hint`(任意): cobot / industrial / mobile
- 1 分担で **30〜80 本** を目標。同じ URL は 1 回だけ。末尾の `/` や `?utm_…` は落とす。
- 終わったら、検索回数・見つけた本数・狙いどおりに取れなかった理由(ある地域で事例が PDF だけ、など)を 5 行以内で報告する。
