/* LexxMoMa 見学ツアー — 掲載データ(見学スポット = 資料・動画)
 * ここを編集するだけで index.html に並びます(ビルド不要)。
 *
 * 1件の書き方:
 *   id       : 英数字の一意なID(直リンク #m=<id> や計測に使う。公開後は変えない)
 *   cat      : "company" 会社紹介 / "product" 製品資料 / "video" 動画 / "case" 導入事例 / "other" その他
 *   type     : "pdf"     … src に PDF の相対パス(files/ に置く) or URL
 *              "youtube" … youtube に動画ID(限定公開推奨。URL の v= の後ろ11文字)
 *              "video"   … src に mp4 の相対パス(videos/ に置く) or URL(GitHub Pages は1ファイル100MBまで)
 *                          thumb にサムネイル画像を指定すると一覧・再生前に表示
 *              "link"    … src に外部ページURL(新しいタブで開く)
 *              "form"    … アイデア投稿フォーム(board.js)。ほかのスポットをすべて見たあと最後に開く。投稿でツアー完了
 *   title / desc / meta(「12ページ」「3:20」など) / updated("2026-09")
 *   spot     : 見学ルート上のスポット名(例「受付」)。stamp: スタンプの絵柄(絵文字1文字)
 *   featured : true でトップページ・ツアー冒頭のおすすめに出す(2〜3件まで)
 *   並び順 = 見学ルートの順番。準備中(src 空)のスポットはルートに「準備中」で表示され、スタンプの対象外
 *   thumb    : サムネイル画像の相対パス(任意。youtube は自動取得)
 *   src や youtube が空の項目は「準備中」と表示され、開けません。
 */
window.LIB_CONFIG = {
  company: "LexxPluss",
  siteName: "LexxMoMa 見学ツアー",
  lead: "工場見学のように、会社紹介 → 紹介動画 → 実機映像の順に回れるオンライン見学ツアーです。見たスポットにはスタンプが押され、すべて集めると見学修了証をお渡しします。",
  teaser: "videos/teaser-lexxmoma.mp4",   // トップページの「上映中」で流す短い無音ループ(library/ からの相対)
  contact: {
    // お問い合わせ導線(URL の ?rep= で営業担当を指定すると、その担当の表示に切り替わります)
    web: "https://lexxpluss.com/",   // お問い合わせフォームのURLに差し替え可
    note: "資料のご不明点・デモのご依頼はお気軽にご連絡ください。",
  },
  reps: {
    // ?rep=<キー> で表示。例: ?rep=aso
    // aso: { name: "麻生", email: "masaya.aso@lexxpluss.com" },
  },
  board: {
    // みんなのアイデアボードの保存先(Google Apps Script の Web アプリ URL)。空ならテストモード。手順は board/SETUP.md
    endpoint: "https://script.google.com/macros/s/AKfycbxl0GlvSXzBh8nOoJh8lIpl5485uMIBcBuqwTwhZ9IWBXofhFsY4ECpHFO_EGN7iMuf/exec",
  },
  toolsHub: "../index.html",   // LexxMoMa Tools(シミュレーター等)への導線。空文字で非表示
};

window.MATERIALS = [
  {
    id: "company-intro", cat: "company", type: "pdf", featured: true, spot: "受付", stamp: "🏢",
    title: "LexxPluss 会社紹介資料",
    desc: "会社概要と沿革、インダストリアルヒューマノイド事業(LexxMoMa)とトランスポーテーション事業(LexxTug・Lexx500)、導入実績をまとめた基本資料です。",
    src: "files/lexxpluss-company-intro.pdf", thumb: "thumbs/company-intro.jpg", meta: "36ページ", updated: "2026-08",
  },
  {
    // 動画は後日差し替え(videos/ に置いて src・thumb・meta を埋める)
    id: "company-video", cat: "video", type: "video", featured: true, spot: "会社紹介シアター", stamp: "🎬",
    title: "LexxPluss 会社紹介動画",
    desc: "LexxPlussが目指すことと、事業・製品の全体像を映像でご紹介します。",
    src: "", meta: "", updated: "",
  },
  {
    // 動画は後日差し替え
    id: "lexxmoma-intro", cat: "video", type: "video", featured: true, spot: "LexxMoMaシアター", stamp: "🎥",
    title: "LexxMoMa 紹介動画",
    desc: "自走するロボットアーム LexxMoMa の特長と、現場での使われ方をご紹介します。",
    src: "", meta: "", updated: "",
  },
  {
    id: "lexxmoma-demo", cat: "video", type: "video", spot: "実機見学エリア", stamp: "🤖",
    title: "LexxMoMa 実機デモ動画(11分)",
    desc: "ラボ内での動作映像。走行しながらアームを動かす「シンクロ動作」で、移動と作業を同時にこなす様子をご覧いただけます。",
    src: "videos/lexxmoma-mobile-manipulator.mp4", thumb: "thumbs/lexxmoma-demo.jpg", meta: "11:34", updated: "2025-07",
  },
  {
    // お客さまに情報を入力していただくスポット(仕様は後日確定。現在は枠のみ)
    id: "your-info", cat: "other", type: "form", spot: "ご相談カウンター", stamp: "✍️",
    title: "あなたの現場での使い道を教えてください",
    desc: "見学の最後に、LexxMoMa をどんな工程で使えそうか、感想とあわせて匿名で投稿。みんなのアイデアボードに貼り出されます。",
    meta: "約2分・匿名",
  },
];
