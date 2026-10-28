/* LexxMoMa 3D 見積依頼 — 商品カタログ
 * ここを編集するだけで index.html に並びます(ビルド不要)。お客様に公開されるファイルです。
 *
 * このツールは正式な見積を作るものではなく、LexxPluss へ見積依頼をすばやく送るためのもの。
 * 選んでもらうのは本体の台数と、お客様が判断できるオプションだけ。適合業務・設計・製作・現地導入・提出図書は
 * LexxPluss からは事前に見積れないので選択肢にせず、「ヒアリング後に別途費用としてご提示」と案内する(HEARING)。
 *
 * 価格の出し方は「販売パートナー向けガイド：価格と商流に関する LexxPluss の方針」に従う:
 *   - 本体は「本体標準価格」という一本の数字で出す。「参考価格」「〜」「目安」「個別見積」のような幅のある表現は使わない
 *   - 本体と別途費用を分けて見せる(工程に合わせる部分は本体ではなく別途費用)
 *   - どの販売経路(直接 / SIer / 商社)でも同じ価格。経路は価格を変えず、窓口を決めるためだけに伺う
 *   - 原価・仕入れ先・部品メーカー・型番・値引き条件は書かない(本体に含む CRX-20iA/L は公開済みの表記)
 * cat はエクセル「LexxMoMa-見積」のカテゴリ名(標準商品・準標準商品・非標準商品・安全対応 …)。区分は変えない。
 *
 * オプションの書き方:
 *   id    : 英数字の一意な ID(公開後は変えない。下書きの保存と見積依頼の送信に使う)
 *   price : 単価(税別・円)。0 で later: true なら「ヒアリング後にご提示」
 *   max   : 2 以上なら台数を選べる。qty は付けたときの既定数
 *   who   : true なら「SIer・パートナーが用意 / LexxPluss に相談」を選んでもらう(SIer が用意する場合はこの見積に含めない)
 *   part  : 3D で取り付く部品(scene.js)
 */
window.QUOTE_CONFIG = {
  updated: "2026-10",
  bodyPrice: 11800000,       // LexxMoMa 本体標準価格(税別・アームセット込み)。2026-10-21 に確定
  armlessPrice: 7300000,     // アームセットをお客様が自ら調達する場合の本体価格(税別)。2026-10-21 に表示を決定
  taxRate: 0.1,
  // 見積依頼の送信先(Google Apps Script の Web アプリ URL)。空ならテストモード(送信せず、内容の確認だけ)。手順は SETUP.md
  endpoint: "",
  contactWeb: "https://lexxpluss.com/",
  privacyUrl: "",            // プライバシーポリシーの URL(空なら文言だけ表示)
  policyVersion: 1,          // 価格の考え方の内容を変えたら上げる(全員にもう一度確認してもらう)
};

window.QUOTE_BODY = {
  id: "moma", cat: "標準商品", name: "LexxMoMa 本体", unit: "台", max: 10,
  includes: ["モバイルベース", "ロボットアーム(FANUC CRX-20iA/L)", "制御システム一式", "標準バッテリー一式"],
  // アームセット: 込み(本体標準価格)か、お客様が自ら調達するか
  arms: [
    { id: "set", label: "アームセット込み", desc: "" },
    { id: "own", label: "アームセットを自ら調達", desc: "お手持ちまたはお客様調達の FANUC CRX-20iA/L を使います。取付・適合確認は別途費用です。" },
  ],
};

window.QUOTE_OPTIONS = [
  { id: "charger", cat: "準標準商品", name: "充電器", unit: "台", qty: 2, max: 6, price: 150000, part: "charger", desc: "標準バッテリー用。交代でバッテリーを充電するなら 2 台が目安です。" },
  { id: "tablet", cat: "準標準商品", name: "操作用タブレット", unit: "台", qty: 1, max: 1, price: 150000, part: "tablet", desc: "動作の指示や、エラーの確認・再開に使います。" },
  { id: "ee", cat: "非標準商品", name: "ハンド(エンドエフェクタ)・治具", unit: "式", qty: 1, max: 1, price: 0, later: true, who: true, part: "ee", desc: "ワークをつかむ部分。ワークに合わせて用意します。" },
  { id: "camera", cat: "非標準商品", name: "ビジョンカメラ", unit: "式", qty: 1, max: 1, price: 0, later: true, who: true, part: "camera", desc: "ワークの位置を補正したいときに使います。" },
  { id: "panel", cat: "非標準商品", name: "工程盤(設備との接続)", unit: "式", qty: 1, max: 1, price: 0, later: true, part: "panel", desc: "既存の設備と信号をやりとりする盤です。" },
  { id: "estop", cat: "安全対応", name: "無線非常停止システム", unit: "式", qty: 1, max: 1, price: 400000, part: "estop", desc: "離れた場所から止められる非常停止。取付・動作確認を含みます。" },
];

// 選択肢にしない別途費用(エクセルのカテゴリ名)。ヒアリング後に別途費用としてご提示する
window.QUOTE_HEARING = [
  { cat: "システム事前適合業務", name: "ハンド・工程盤との適合確認" },
  { cat: "現地導入工数", name: "設置・立ち上げ支援、操作教育" },
  { cat: "カスタム設計・製造", name: "工程設計、周辺設備との接続" },
  { cat: "提出図書", name: "完成図・取扱説明書" },
  { cat: "保守", name: "保守契約" },
];

// 見積依頼フォームの選択肢(送信値は id。apps-script.gs の CHANNEL と合わせる)
window.QUOTE_CHANNELS = [
  { id: "direct", label: "LexxPluss と直接" },
  { id: "sier", label: "お付き合いのある SIer と" },
  { id: "trader", label: "お付き合いのある商社を通して" },
  { id: "undecided", label: "未定・相談したい" },
];

// お付き合いのある SIer・商社の入力欄に出す候補(入力しかけると候補として出る。自由入力もできる)
// 連携中のパートナーを候補に出すかは未定(2026-10)。決まったら会社名を並べる。空なら候補は出ない
window.QUOTE_PARTNERS = {
  sier: [],
  trader: [],
};
