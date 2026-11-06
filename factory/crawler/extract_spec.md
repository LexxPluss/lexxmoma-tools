# 工場情報の抽出(サブエージェント向けの手順)

入力(会社ごと): `factory/raw/<cc>/sites/<会社id>/index.json`(取得したページの URL と見出し)と `0.txt, 1.txt, …`(各ページの本文)、
`factory/raw/<cc>/wiki/<会社id>/info.json` と `article.txt`(ウィキペディアの記事。公式サイトから取れないときの補助)。
会社の基本情報は `factory/data/<cc>/companies.json`(id, name, legal, web, industry, hq)。

出力: `factory/data/<cc>/extracted/<会社id>.json`

```json
{
  "id": "c-xxxxxxxx",
  "status": "ok | no_factory_info | site_blocked",
  "company": { "emp": 12345, "empSrc": "<URL>", "rev": null, "revFy": null, "revUrl": null, "parent": null, "group": null, "nameJa": null },
  "factories": [
    {
      "name": "<工場名(原語のまま。例: 울산공장 / 仁武廠)>", "nameEn": "<英語名があれば>",
      "op": "<運営会社(その工場を運営する会社。通常は本社と同じ)>", "opEn": null,
      "addr": "<住所。ページに書かれた通り(郵便番号は除く)>",
      "prod": "<生産品目。ページの記述を短く(30 字程度まで)>",
      "seg": null, "area": <敷地面積 m²(数値。坪・평 は 3.3058 倍して m² に。無ければ null)>, "floor": null,
      "emp": <その工場の従業員数(数値。無ければ null)>, "empAsof": "<その数の時点。無ければ null>", "est": "<操業開始年(西暦 4 桁)。無ければ null>",
      "src": "<この工場の情報を読んだページの URL(index.json の url か info.json の url と完全一致)>",
      "srcType": "official | public"
    }
  ]
}
```

規律(日本の工場マップと同じ):
- 書いてあることだけを書く。推測で住所・品目・数値を埋めない。無い項目は null。
- 対象はその国(韓国 / 台湾)内の **製造拠点(工場・プラント・ファブ)** だけ。海外工場・営業所・倉庫・物流センター・研究所だけの拠点は入れない。
  本社が工場を兼ねる(本社工場)ときは入れる。
- 住所は都道府県相当(시/도、縣/市)から始まる完全なもの。市区町村までしか無いときはそこまでを書く(番地が無くても可)。
- `src` は必ず取得済みページの URL。ウィキペディアから取ったときは `srcType: "public"`。
- 会社の従業員数・売上高は公式サイト(会社概要)にあれば `company` に入れる(`empSrc` / `revUrl` に URL)。売上高は「億 <現地通貨>」の数値(韓国: 억원 → そのまま億ウォン、조원は ×10,000。台湾: 億元 → 億台湾ドル)。
- 工場が 1 件も読み取れないときは `status: "no_factory_info"`、サイトが取れていない(ページが 0 件・本文が空)ときは `status: "site_blocked"`。
- ページの本文に同じ工場が複数回出てきたら 1 件にまとめる。工場名が無ければ「<会社名> <市区町村名>工場」のように市区町村名で付ける。
