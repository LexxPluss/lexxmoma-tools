/* LexxMoMa 3D 見積 — 商品カタログ
 * ここを編集するだけで index.html に並びます(ビルド不要)。お客様に公開されるファイルです。
 *
 * 価格の出し方は「販売パートナー向けガイド：価格と商流に関する LexxPluss の方針」に従う:
 *   - 本体は「本体標準価格」という一本の数字で出す。「参考価格」「〜」「目安」「個別見積」のような幅のある表現は使わない
 *   - 本体と別途費用を分けて見せる(工程に合わせる部分は本体ではなく別途費用)
 *   - どの商流(直接 / SIer / 商社・販売店)でも同じ価格。商流は価格を変えず、窓口を決めるためだけに聞く
 *   - 原価・仕入れ先・部品メーカー・型番・値引き条件は書かない(本体に含む CRX-20iA/L は公開済みの表記)
 * カテゴリの区分は社内の見積エクセル「LexxMoMa-見積」に合わせる。標準商品 = 本体標準価格、それ以外 = 別途費用。
 *
 * 商品の書き方:
 *   id       : 英数字の一意な ID(公開後は変えない。下書きの保存と見積依頼の送信に使う)
 *   name / desc / unit / qty(付けたときの既定数)/ min / max
 *   price    : 単価(税別・円)。manday: true なら人日の工数で、単価は dayRate
 *   variants : 手配の選択肢 [{ id, label, price, desc, later: true(=金額はヒアリング後にご提示), outside: true(=この見積に含めない), with }]
 *   with     : 付けたときにセットで足す商品 ID(適合確認・設計など)
 *   part     : 3D で取り付く部品(scene.js)。crew: 工数を表す作業員(fit / onsite / design / mfg)
 *   text     : true なら金額は計上せず、条件として載せる
 *   required : true なら外せない(本体)
 */
window.QUOTE_CONFIG = {
  updated: "2026-10",
  bodyPrice: 11800000,       // LexxMoMa 本体標準価格(税別)。2026-10-21 に確定
  dayRate: 96000,            // エンジニア工数 1 人日の単価(税別)
  taxRate: 0.1,
  // 見積依頼の送信先(Google Apps Script の Web アプリ URL)。空ならテストモード(送信せず、内容の確認だけ)。手順は SETUP.md
  endpoint: "",
  contactWeb: "https://lexxpluss.com/",
  privacyUrl: "",            // プライバシーポリシーの URL(空なら文言だけ表示)
};

window.QUOTE_CATALOG = [
  {
    id: "standard", group: "body", name: "標準商品", icon: "🤖",
    desc: "LexxMoMa は、お客様ごとに設計し直すカスタム設備ではなく、標準化された一つの製品です。価格も本体標準価格の一本です。",
    items: [
      {
        id: "moma", name: "LexxMoMa 本体", unit: "台", qty: 1, min: 1, max: 10, required: true, part: "moma", body: true,
        desc: "含むもの: モバイルベース、ロボットアーム(FANUC CRX-20iA/L)、制御システム一式、標準バッテリー一式。",
        get price() { return window.QUOTE_CONFIG.bodyPrice; },
      },
    ],
  },
  {
    id: "semi", group: "extra", name: "準標準商品", icon: "🔋",
    desc: "本体と組み合わせて使う標準の付属品。販売店やお客様で個別に調達いただくこともできます。",
    items: [
      { id: "charger", name: "充電器", unit: "台", qty: 2, min: 0, max: 6, price: 150000, part: "charger", desc: "標準バッテリー用の充電器。" },
      { id: "tablet", name: "操作用タブレット", unit: "台", qty: 1, min: 0, max: 5, price: 150000, part: "tablet", desc: "ステップ動作の指示や、エラーの表示・再開に使う操作画面。" },
    ],
  },
  {
    id: "nonstd", group: "extra", name: "非標準商品", icon: "🦾",
    desc: "お客様の工程に合わせる部分です。本体ではなく、ハンド・治具・周辺設備側で合わせます。",
    items: [
      {
        id: "ee", name: "エンドエフェクタ・治具", unit: "式", qty: 1, min: 0, max: 1, part: "ee",
        desc: "吸着・チャック、エアー・電動グリッパーなど。扱うすべてのワークに対応したハンドとします。",
        styles: [{ id: "gripper", label: "グリッパー" }, { id: "vacuum", label: "吸着" }],
        variants: [
          { id: "sier", label: "SIer・パートナーが用意", price: 0, outside: true, desc: "SIer・パートナーの範囲のため、この見積には含めません", with: ["fit-ee"] },
          { id: "lp", label: "LexxPluss が用意", price: 0, later: true, desc: "ワークと工程を伺ったうえで、金額をご提示します", with: ["fit-ee"] },
        ],
      },
      {
        id: "camera", name: "ビジョンカメラ", unit: "式", qty: 1, min: 0, max: 1, part: "camera",
        desc: "ワークの位置補正に使うカメラ。",
        variants: [
          { id: "sier", label: "SIer・パートナーが用意", price: 0, outside: true, desc: "SIer・パートナーの範囲のため、この見積には含めません" },
          { id: "lp", label: "LexxPluss が用意", price: 0, later: true, desc: "ワークと工程を伺ったうえで、金額をご提示します" },
        ],
      },
      { id: "panel", name: "工程盤", unit: "式", qty: 1, min: 0, max: 5, price: 370000, part: "panel", desc: "周辺設備との接続に使う工程盤(PLC)。", with: ["fit-panel", "design-panel", "mfg-panel"] },
    ],
  },
  {
    id: "fit", group: "extra", name: "システム事前適合業務", icon: "🔧",
    desc: "納入前に LexxPluss で行う、本体と周辺の適合確認。",
    items: [
      { id: "fit-ee", name: "エンドエフェクタとの適合確認", unit: "人日", qty: 1, min: 0, max: 60, manday: true, crew: "fit", desc: "" },
      { id: "fit-panel", name: "工程盤との適合確認", unit: "人日", qty: 5, min: 0, max: 60, manday: true, crew: "fit", desc: "" },
    ],
  },
  {
    id: "onsite", group: "extra", name: "現地導入工数", icon: "🚚",
    desc: "お客様の現場での設置・立ち上げ支援。",
    items: [
      { id: "setup", name: "設置・初期設定", unit: "人日", qty: 1, min: 0, max: 60, manday: true, crew: "onsite", hint: "現場の条件によっては 5 日程度かかります", desc: "設備との接続、床面や周囲環境への対応、ネットワーク接続、マップ作成。" },
      { id: "launch", name: "立ち上げ・操作教育", unit: "人日", qty: 0, min: 0, max: 60, manday: true, crew: "onsite", desc: "工程全体での動作確認と、保全担当の方への操作教育。" },
    ],
  },
  {
    id: "design", group: "extra", name: "カスタム設計", icon: "📐",
    desc: "本体ではなく、周辺設備(工程盤)の設計です。",
    items: [
      { id: "design-panel", name: "工程盤設計", unit: "人日", qty: 5, min: 0, max: 60, manday: true, crew: "design", desc: "" },
    ],
  },
  {
    id: "mfg", group: "extra", name: "カスタム製造", icon: "🏭",
    desc: "本体ではなく、周辺設備(工程盤)の製作です。",
    items: [
      { id: "mfg-panel", name: "工程盤製作", unit: "人日", qty: 5, min: 0, max: 60, manday: true, crew: "mfg", desc: "" },
    ],
  },
  {
    id: "safety", group: "extra", name: "安全対応", icon: "🛑",
    desc: "区画や非常停止など、現場の安全設備。",
    items: [
      { id: "estop", name: "無線非常停止システム", unit: "式", qty: 1, min: 0, max: 5, price: 400000, part: "estop", desc: "機器・配線・金具と、取付・動作確認を含みます。" },
    ],
  },
  {
    id: "docs", group: "extra", name: "提出図書", icon: "📚",
    desc: "納入時に提出する図書。",
    items: [
      { id: "doc-drawing", name: "完成図", unit: "人日", qty: 5, min: 0, max: 30, manday: true, part: "docs", desc: "図面一式。" },
      { id: "doc-manual", name: "取扱説明書", unit: "人日", qty: 5, min: 0, max: 30, manday: true, part: "docs", desc: "エラー時の対処などを含みます。" },
    ],
  },
  {
    id: "terms", group: "extra", name: "保守・ライセンス・消耗品", icon: "📝",
    desc: "見積に条件として記載します。",
    items: [
      { id: "maint", name: "保守契約", unit: "式", qty: 1, min: 0, max: 1, text: true, desc: "別途費用です。内容と条件は担当窓口からご案内します。" },
      { id: "license", name: "ソフトウェアライセンス", unit: "式", qty: 1, min: 0, max: 1, text: true, desc: "LexxAUTO・Lexx-HUB のライセンスはシステム費用に含みます。" },
      { id: "parts", name: "交換・消耗部品", unit: "式", qty: 1, min: 0, max: 1, text: true, desc: "部品リストを提出し、必要時に対応します。" },
    ],
  },
];

window.QUOTE_PRESETS = [
  { id: "bare", label: "本体だけから", items: { moma: { qty: 1 } } },
  {
    id: "typical", label: "よくある導入構成",
    items: {
      moma: { qty: 1 }, charger: { qty: 2 }, tablet: { qty: 1 },
      ee: { qty: 1, variant: "sier" }, camera: { qty: 1, variant: "sier" }, panel: { qty: 1 },
      "fit-ee": { qty: 1 }, "fit-panel": { qty: 5 }, setup: { qty: 1 },
      "design-panel": { qty: 5 }, "mfg-panel": { qty: 5 },
      estop: { qty: 1 }, "doc-drawing": { qty: 5 }, "doc-manual": { qty: 5 },
      maint: { qty: 1 }, license: { qty: 1 }, parts: { qty: 1 },
    },
  },
];

// 見積依頼フォームの選択肢(送信値は id。apps-script.gs の CHANNEL / TIMING と合わせる)
// 商流は価格を変えない。窓口(LexxPluss / SIer / 商社・販売店)を決めるために伺う
window.QUOTE_CHANNELS = [
  { id: "direct", label: "LexxPluss と直接進めたい" },
  { id: "sier", label: "お付き合いのある SIer と進めたい" },
  { id: "dealer", label: "商社・販売店を通して進めたい" },
  { id: "undecided", label: "未定・相談したい" },
];
window.QUOTE_TIMINGS = [
  { id: "", label: "選択してください" },
  { id: "3m", label: "3 か月以内" },
  { id: "6m", label: "半年以内" },
  { id: "1y", label: "1 年以内" },
  { id: "later", label: "1 年以上先・情報収集" },
];
