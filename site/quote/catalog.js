/* LexxMoMa 3D 見積 — 商品カタログ(参考価格)
 * ここを編集するだけで index.html に並びます(ビルド不要)。お客様に公開されるファイルなので、原価・社内メモ・協力会社名は書かない。
 * カテゴリの区分は社内の見積エクセル「LexxMoMa-見積」に合わせる(標準商品・準標準商品・非標準商品・適合業務…)。勝手に増やしたり統合したりしない。
 *
 * 商品の書き方:
 *   id       : 英数字の一意な ID(公開後は変えない。下書きの保存と見積依頼の送信に使う)
 *   name / sub / desc / unit / qty(付けたときの既定数)/ min / max
 *   price    : 単価(税抜・円)。manday: true なら人日の工数で、単価は dayRate
 *   variants : 手配の選択肢 [{ id, label, price, desc, quote: true(=金額は個別見積), with }]
 *   with     : 付けたときにセットで足す商品 ID(適合確認・設計など)
 *   part     : 3D で取り付く部品(scene.js)。crew: 工数を表す作業員(fit / onsite / design / mfg)
 *   text     : true なら金額は計上せず、見積に文言として載せる
 *   required : true なら外せない(本体)
 */
window.QUOTE_CONFIG = {
  updated: "2026-10",
  dayRate: 96000,            // エンジニア工数 1 人日の単価(税抜)
  taxRate: 0.1,
  // 見積依頼の送信先(Google Apps Script の Web アプリ URL)。空ならテストモード(送信せず、内容の確認だけ)。手順は SETUP.md
  endpoint: "",
  contactWeb: "https://lexxpluss.com/",
  privacyUrl: "",            // プライバシーポリシーの URL(空なら文言だけ表示)
};

window.QUOTE_CATALOG = [
  {
    id: "standard", name: "標準商品", icon: "🤖",
    desc: "LexxMoMa 本体。走行台車(バッテリー 4 個)と協働ロボット FANUC CRX。",
    items: [
      {
        id: "moma", name: "LexxMoMa", unit: "台", qty: 1, min: 1, max: 10, required: true, part: "moma",
        desc: "含むもの: 走行台車・バッテリー 4 個。含まないもの: 充電器・操作用タブレット・機体に載らない工程盤(下のカテゴリで選べます)。",
        variants: [
          { id: "crx", label: "CRX 込み", price: 11800000, desc: "走行台車 + 協働ロボット CRX" },
          { id: "nocrx", label: "CRX をお客様で手配", price: 7300000, desc: "走行台車のみ。お手持ちの CRX との適合確認が必要です", with: ["fit-crx"] },
        ],
      },
    ],
  },
  {
    id: "semi", name: "準標準商品", icon: "🔋",
    desc: "LexxPluss のほか、お客様・販売店でも個別に調達できる商品です。",
    items: [
      { id: "charger", name: "充電器", sub: "ホンダ純正", unit: "台", qty: 2, min: 0, max: 6, price: 150000, part: "charger", desc: "バッテリー用のホンダ純正充電器。" },
      { id: "tablet", name: "操作用タブレット", sub: "Xiaomi Pad", unit: "台", qty: 1, min: 0, max: 5, price: 150000, part: "tablet", desc: "ステップ動作の指示・状態表示に使う操作画面。" },
    ],
  },
  {
    id: "nonstd", name: "非標準商品", icon: "🦾",
    desc: "ワークや設備に合わせて仕様が変わる商品。SIer からの提供か、LexxPluss での手配かを選べます。",
    items: [
      {
        id: "ee", name: "エンドエフェクタ(ハンド)", unit: "式", qty: 1, min: 0, max: 1, part: "ee",
        desc: "吸着・チャック、エアー・電動グリッパーなど。扱うすべてのワークに対応したハンドとします。",
        styles: [{ id: "gripper", label: "グリッパー" }, { id: "vacuum", label: "吸着" }],
        variants: [
          { id: "sier", label: "SIer から提供", price: 0, desc: "SIer の範囲のため、この見積には含みません", with: ["fit-ee"] },
          { id: "lp", label: "LexxPluss で手配", price: 0, quote: true, desc: "ワークに合わせて設計するため、個別にお見積りします", with: ["fit-ee"] },
        ],
      },
      {
        id: "camera", name: "カメラ", unit: "式", qty: 1, min: 0, max: 1, part: "camera",
        desc: "Mech-Mind・FANUC 純正など、ワークの位置補正に使うビジョンカメラ。",
        variants: [
          { id: "sier", label: "SIer から提供", price: 0, desc: "SIer の範囲のため、この見積には含みません" },
          { id: "lp", label: "LexxPluss で手配", price: 0, quote: true, desc: "機種を選定のうえ、個別にお見積りします" },
        ],
      },
      { id: "panel", name: "工程盤", sub: "仕様はご相談", unit: "式", qty: 1, min: 0, max: 5, price: 370000, part: "panel", desc: "設備との連携に使う工程盤(PLC)。", with: ["fit-panel", "design-panel", "mfg-panel"] },
    ],
  },
  {
    id: "fit", name: "システム事前適合業務", icon: "🔧",
    desc: "納入前に LexxPluss で行う適合確認。",
    items: [
      { id: "fit-crx", name: "CRX との適合確認", unit: "人日", qty: 5, min: 0, max: 60, manday: true, crew: "fit", desc: "CRX をお客様で手配される場合。" },
      { id: "fit-ee", name: "エンドエフェクタとの適合確認", unit: "人日", qty: 1, min: 0, max: 60, manday: true, crew: "fit", desc: "SIer と連携して確認します。" },
      { id: "fit-panel", name: "工程盤との適合確認", unit: "人日", qty: 5, min: 0, max: 60, manday: true, crew: "fit", desc: "SIer と連携して確認します。" },
    ],
  },
  {
    id: "onsite", name: "現地導入工数", icon: "🚚",
    desc: "お客様の現場での立ち上げ。",
    items: [
      { id: "setup", name: "LexxMoMa 初期設定", unit: "人日", qty: 1, min: 0, max: 60, manday: true, crew: "onsite", hint: "現場の条件によっては 5 日程度かかります", desc: "設備との接続、床面や周囲環境への対応、ネットワーク接続。" },
      { id: "launch", name: "システム立ち上げ", unit: "人日", qty: 0, min: 0, max: 60, manday: true, crew: "onsite", desc: "工程全体での動作確認・調整。" },
    ],
  },
  {
    id: "design", name: "カスタム設計", icon: "📐",
    desc: "案件に合わせた設計。",
    items: [
      { id: "design-panel", name: "工程盤設計", unit: "人日", qty: 5, min: 0, max: 60, manday: true, crew: "design", desc: "" },
      { id: "design-crx10", name: "CRX-10 対応仕様確認", unit: "人日", qty: 5, min: 0, max: 60, manday: true, crew: "design", desc: "CRX-10 を使う場合の仕様確認。" },
    ],
  },
  {
    id: "mfg", name: "カスタム製造", icon: "🏭",
    desc: "案件ごとの内容で費用が変わります。",
    items: [
      { id: "mfg-panel", name: "工程盤製作", unit: "人日", qty: 5, min: 0, max: 60, manday: true, crew: "mfg", desc: "" },
    ],
  },
  {
    id: "safety", name: "安全対応", icon: "🛑",
    desc: "LexxPluss で購入・取付・動作確認まで行います。",
    items: [
      { id: "estop", name: "安全無線非常停止システム", sub: "@seguro wes", unit: "式", qty: 1, min: 0, max: 5, price: 400000, part: "estop", desc: "無線の非常停止システム。機器・配線・金具と取付・動作確認を含みます。" },
    ],
  },
  {
    id: "docs", name: "提出図書", icon: "📚",
    desc: "納入時に提出する図書。",
    items: [
      { id: "doc-drawing", name: "完成図", unit: "人日", qty: 5, min: 0, max: 30, manday: true, part: "docs", desc: "図面一式。" },
      { id: "doc-manual", name: "取扱説明書", unit: "人日", qty: 5, min: 0, max: 30, manday: true, part: "docs", desc: "エラー時の対処などを含みます。" },
    ],
  },
  {
    id: "terms", name: "保守・ライセンス・消耗品", icon: "📝",
    desc: "金額は計上せず、見積に条件として記載します。",
    items: [
      { id: "maint", name: "メンテナンス・保守", unit: "式", qty: 1, min: 0, max: 1, text: true, desc: "保守の内容と範囲はご相談のうえ決めます。" },
      { id: "license", name: "ソフトウェアライセンス", unit: "式", qty: 1, min: 0, max: 1, text: true, desc: "LexxAUTO・Lexx-HUB のライセンスはシステム費用に含みます。" },
      { id: "parts", name: "交換・消耗部品", unit: "式", qty: 1, min: 0, max: 1, text: true, desc: "部品リストを提出し、必要時に対応します。" },
    ],
  },
];

window.QUOTE_PRESETS = [
  { id: "bare", label: "本体だけから", items: { moma: { qty: 1, variant: "crx" } } },
  {
    id: "typical", label: "標準的な導入構成",
    items: {
      moma: { qty: 1, variant: "crx" }, charger: { qty: 2 }, tablet: { qty: 1 },
      ee: { qty: 1, variant: "sier" }, camera: { qty: 1, variant: "sier" }, panel: { qty: 1 },
      "fit-ee": { qty: 1 }, "fit-panel": { qty: 5 }, setup: { qty: 1 },
      "design-panel": { qty: 5 }, "design-crx10": { qty: 5 }, "mfg-panel": { qty: 5 },
      estop: { qty: 1 }, "doc-drawing": { qty: 5 }, "doc-manual": { qty: 5 },
      maint: { qty: 1 }, license: { qty: 1 }, parts: { qty: 1 },
    },
  },
];

// 見積依頼フォームの選択肢(送信値は id。apps-script.gs の ALLOW と合わせる)
window.QUOTE_CHANNELS = [
  { id: "direct", label: "LexxPluss から直接購入したい" },
  { id: "sier", label: "お付き合いのある SIer 経由で進めたい" },
  { id: "dealer", label: "商社・販売店経由で進めたい" },
  { id: "undecided", label: "未定・相談したい" },
];
window.QUOTE_TIMINGS = [
  { id: "", label: "選択してください" },
  { id: "3m", label: "3 か月以内" },
  { id: "6m", label: "半年以内" },
  { id: "1y", label: "1 年以内" },
  { id: "later", label: "1 年以上先・情報収集" },
];
