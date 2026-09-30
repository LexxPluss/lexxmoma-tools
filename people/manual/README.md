# manual/ — レビュー・運用データ(Git 管理)

ここに置くのは **公開情報に基づく** 手入力データだけ。面談・名刺で得た情報は Notion 案件ページへ(SPEC §3.4 / §9)。

| ファイル | 中身 | 書く人 |
|---|---|---|
| `reviews.json` | シグナルのレビュー状態(確認済 / 非表示 / コメント)。UI「レビューを書き出す」の JSON をマージ | レビュー責任者(§13-4) |
| `suppressions.json` | 削除・訂正依頼。`crawler/delete_person.py` が書く | CEO 室 |
| `sales_notes.json` | 人物の営業メモ(公開情報のみ) | 営業メンバー |
| `ir_urls.json` | 各社サイトの役員一覧 / 組織図 / IR ニュースの URL(人が確認したもの。自動候補より優先) | ツール担当 |
| `ir_urls_auto.json` | `crawler/discover_sites.py` が自動で見つけた URL 候補(confirmed: false) | 自動 |
| `edinet_overrides.json` | EDINET コードを名寄せできない会社の手当て `{"会社名": "E00000"}` | ツール担当 |
| `unit_aliases.json` | 組織の改称の明示 `{"会社ID": {"旧名称": "新名称"}}` | ツール担当 |

手動投入の機能(UI のフォームと `YYYY-MM-DD_<会社>.json`)は 2026-09-30 に廃止しました。
