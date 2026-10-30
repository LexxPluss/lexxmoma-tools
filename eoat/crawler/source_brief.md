# 取得元の開拓(取得元を探すエージェント向けの共通手順)

目的: 「ロボットのハンド(エンドエフェクタ)がワークを扱った導入事例」の**一覧ページ**(またはサイトマップ)を持つサイトを見つけ、`sources.yaml` の取得元として使える形で提案する。
1 サイトで事例が 20 件以上あるものを優先する(1 件ずつ拾う検索より効率がよい)。

## 制限(守ること)
- 検索(WebSearch)は 1 エージェント 25 回まで。WebFetch は 1 サイトにつき 2〜3 回(一覧 1 回 + 事例 1 回 + 必要なら robots.txt)。全体で 40 回まで。curl 等で直接取らない。
- `eoat/data/exclude_domains_l11.txt` にあるドメインは調査済み・巡回済み・取れないもの。**提案しない**(サブドメイン違いも同じ扱い)。
- robots.txt で事例のパスが禁止されているサイト、403・Cloudflare のボット対策で取れないサイト、ログインが要るサイトは提案しない(回避しない)。
- 研究論文・PDF だけ・動画だけ(YouTube 埋め込みだけで写真が無い)・ニュースリリース一覧・製品カタログは対象外。

## 確かめること(1 サイトごと)
1. 一覧ページ(または sitemap.xml)に、個別の事例ページへのリンクが何本あるか。ページ送りがあれば、その URL の形(?page=2 /page/2/ など)
2. 個別の事例ページ 1 本を開き、ハンド・ワークの写真(<img>)が本文にあるか、本文に ワーク・掴み方・ロボット のどれか 2 つがあるか
3. 事例ページの URL の形を正規表現にする(一覧ページ自体・タグ・カテゴリのページは合わないように)

## 出力
`eoat/data/source_proposals_<tag>.yaml` に YAML のリストで書く(sources.yaml の 1 項目と同じ形)。例:
```yaml
- key: acme_cases            # 英小文字と _ だけ。一意に
  label: ACME Automation 導入事例
  type: sier                 # maker_gripper / maker_robot / sier / media / public / custom
  case_type: sier_case       # maker_product(メーカーの製品事例) / sier_case / custom
  region: 北米               # 日本 / 北米 / 欧州 / 中国 / アジア / その他
  country: 米国
  lang: en
  index_urls: ["https://acme.com/case-studies", "https://acme.com/case-studies/page/2"]
  article: "^https://acme\\.com/case-studies/[^/?#]+/?$"
  status: ok
  checked: 2026-10-29
  note: "一覧 2 ページで 34 件(例: /case-studies/xyz-palletizing)。事例ページに把持の写真あり。把持の事例は 6 割の見当"
```
- `note` に、数えた件数・事例ページの例 2 本・把持の事例の割合の見当を書く。
- ページ送りが多い(10 ページ以上)ときは `paginate: "https://acme.com/case-studies/page/{n}/"` と `max_pages: 20` を使ってよい。
- 終わったら、提案した数・合計の見込み件数・提案しなかった主なサイトと理由を 5 行以内で報告する。
