/* 見学ツアー SPOT 5「ご相談カウンター」— アイデア投稿フォーム + みんなのアイデアボード
 *
 * 保存先: Google スプレッドシート(Apps Script の Web アプリ)。URL は materials.js の LIB_CONFIG.board.endpoint。
 *   空のあいだは「テストモード」: 投稿はこのブラウザにだけ保存され、ボードには記入例と自分の投稿だけが出る。
 *   セットアップは board/SETUP.md、サーバー側コードは board/apps-script.gs。
 * 前提: materials.js を先に読み込むこと。
 */
(function () {
  var CFG = (window.LIB_CONFIG && window.LIB_CONFIG.board) || {};
  var ENDPOINT = CFG.endpoint || "";
  var MINE_KEY = "lx_board_mine_v1";

  // ---- 選択肢(ボードの色分け・絞り込みにも使う) ----
  var PROCESSES = [
    { id: "machine", t: "工作機械へのワーク投入・取出", s: "工作機械", c: "y" },
    { id: "feed",    t: "部品供給・工程間の運搬",       s: "部品供給・運搬", c: "b" },
    { id: "assy",    t: "組立・組付けの補助",           s: "組立補助", c: "g" },
    { id: "inspect", t: "検査・計測",                   s: "検査・計測", c: "p" },
    { id: "pack",    t: "箱詰め・積み付け(パレタイズ)", s: "箱詰め・積み付け", c: "o" },
    { id: "logi",    t: "倉庫・物流センターでの仕分け・ピッキング", s: "物流・仕分け", c: "v" },
    { id: "other",   t: "その他",                       s: "その他", c: "w" },
  ];
  var SHIFTS = [
    { id: "day", t: "日勤のみ" }, { id: "two", t: "2直" }, { id: "night", t: "夜間・休日は無人で" }, { id: "24h", t: "24時間" },
  ];
  var INDUSTRIES = [
    { id: "auto", t: "自動車・輸送機器" }, { id: "elec", t: "電機・電子" }, { id: "metal", t: "金属加工・機械" },
    { id: "resin", t: "樹脂・化学" }, { id: "food", t: "食品・日用品" }, { id: "logi", t: "物流・倉庫" }, { id: "other", t: "その他" },
  ];
  var REACTIONS = [
    { id: "wow", e: "🤩", t: "うちでも使えそう！" }, { id: "fun", e: "😀", t: "おもしろい" },
    { id: "more", e: "🤔", t: "もう少し知りたい" }, { id: "meh", e: "😐", t: "まだピンとこない" },
  ];
  var PLUSES = [
    { id: "unmanned", t: "夜間・休日の無人運転" }, { id: "multi", t: "1台で複数設備を掛け持ち" },
    { id: "changeover", t: "段取り替えもおまかせ" }, { id: "noretrofit", t: "既存設備を改造せずに" },
    { id: "narrow", t: "狭い通路でも動ける" }, { id: "cowork", t: "人のすぐ隣で作業" },
    { id: "roi", t: "導入前に効果を試算したい" }, { id: "trial", t: "短期間お試ししたい" },
  ];
  var LIMIT = { processText: 120, impression: 200, plusText: 120 };

  // サンプル(LexxPluss が用意した記入例。実際の投稿ではないことをボード上で必ず明示する。常に表示)
  var EXAMPLES = [
    { id: "ex1", example: true, at: "", process: ["machine"], processText: "夜のあいだに旋盤3台へ素材を入れて、加工済みの部品をカゴ台車に並べておいてほしい", shift: "night", industry: "metal", reaction: "wow", impression: "走りながらアームが動くのが想像以上に速かった", plus: ["unmanned", "multi"], plusText: "" },
    { id: "ex2", example: true, at: "", process: ["feed", "assy"], processText: "組立ラインの横に、次に使う部品の箱を順番どおりに届けてほしい", shift: "two", industry: "auto", reaction: "more", impression: "ライン横の狭い場所で本当に回れるのか知りたい", plus: ["narrow", "cowork"], plusText: "" },
    { id: "ex3", example: true, at: "", process: ["pack"], processText: "検査が終わった製品を段ボールに詰めて、パレットに積むところまで", shift: "day", industry: "food", reaction: "fun", impression: "", plus: ["roi", "trial"], plusText: "まずは1か月だけ試してみたい" },
    { id: "ex4", example: true, at: "", process: ["inspect", "machine"], processText: "成形機から取り出した部品を検査機にセットして、良品と不良品をトレーに分けたい", shift: "24h", industry: "resin", reaction: "wow", impression: "動画の11分がずっと止まらずに動いていたのがよかった", plus: ["changeover", "noretrofit"], plusText: "型替えのときに治具も交換してくれたら最高" },
  ];

  // ---- 個人・法人を特定しうる情報の簡易チェック(送信前にブロック。サーバー側でも同様に確認) ----
  var PII = [
    { re: /[\w.+-]+@[\w-]+\.[\w.-]+/, t: "メールアドレス" },
    { re: /(?:\+81|0)\d{1,4}[-(（\s]?\d{1,4}[-)）\s]?\d{3,4}/, t: "電話番号" },
    { re: /https?:\/\/|www\./i, t: "URL" },
    { re: /〒|\b\d{3}-\d{4}\b/, t: "郵便番号" },
    { re: /株式会社|有限会社|合同会社|合資会社|\(株\)|（株）|㈱|\(有\)|（有）|㈲|Inc\.?\b|Co\.,?\s?Ltd|Corporation|Corp\./i, t: "会社名" },
    { re: /[^\s、。]{1,12}(?:工場|製作所|事業所|営業所|センター)(?:様|さま)?/, t: "工場・事業所の名前", soft: true },
    { re: /(?:北海道|東京都|大阪府|京都府|.{2,3}県).{1,8}[市区町村郡]/, t: "所在地" },
    { re: /(?:様|さん|氏)(?:[\s、。]|$)/, t: "お名前", soft: true },
  ];
  // soft: 「〇〇工場」「〇〇様」は一般的な語でも当たるので、固有名詞らしい場合だけ注意(ブロックはしない)
  function piiCheck(text) {
    var hits = [];
    PII.forEach(function (p) { if (p.re.test(text || "")) hits.push({ t: p.t, soft: !!p.soft }); });
    return hits;
  }

  // ---- 保存・取得 ----
  function load(k, d) { try { return JSON.parse(localStorage.getItem(k) || "null") || d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function month(d) { d = new Date(d || Date.now()); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2); }

  // 自分の投稿は内容ごとこのブラウザに控える(テストモードの保存先を兼ねる。ライブでも確認待ちの間は自分にだけ見せる)
  function mine() { return load(MINE_KEY, []); }
  function list() {
    var my = mine().map(function (p) { return Object.assign({ mine: true }, p); });
    if (!ENDPOINT) return Promise.resolve({ mode: "test", posts: my.concat(EXAMPLES) });
    return fetch(ENDPOINT + (ENDPOINT.indexOf("?") < 0 ? "?" : "&") + "action=list", { method: "GET" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var posts = (j && j.posts) || [], ids = {};
        posts.forEach(function (p) { ids[p.id] = 1; });
        my.forEach(function (p) { if (ids[p.id]) posts.forEach(function (q) { if (q.id === p.id) q.mine = true; }); });
        var extra = my.filter(function (p) { return !ids[p.id]; }).map(function (p) { return Object.assign({}, p, { pending: true }); });
        posts = extra.concat(posts);
        posts = posts.concat(EXAMPLES);
        return { mode: "live", posts: posts };
      })
      .catch(function () { return { mode: "error", posts: my.concat(EXAMPLES) }; });
  }

  function submit(data) {
    var post = Object.assign({ v: 1 }, data);
    var remember = function (p) { var m = mine(); m.unshift(p); save(MINE_KEY, m.slice(0, 10)); };
    if (!ENDPOINT) {
      post.id = "local-" + Date.now().toString(36); post.at = month(); post.test = true;
      remember(post);
      return Promise.resolve({ ok: true, mode: "test", post: post });
    }
    // text/plain で送ると CORS のプリフライトが起きない(Apps Script は OPTIONS を受けられないため)
    return fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(post) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || "送信に失敗しました");
        delete post.website;
        post.id = j.id; post.at = month();
        remember(post);
        return { ok: true, mode: "live", post: post, status: j.status };
      });
  }

  function label(arr, id) { var x = arr.filter(function (a) { return a.id === id; })[0]; return x ? x.t : ""; }
  function procOf(id) { return PROCESSES.filter(function (p) { return p.id === id; })[0] || PROCESSES[PROCESSES.length - 1]; }

  window.lxBoard = {
    PROCESSES: PROCESSES, SHIFTS: SHIFTS, INDUSTRIES: INDUSTRIES, REACTIONS: REACTIONS, PLUSES: PLUSES, LIMIT: LIMIT,
    live: !!ENDPOINT, EXAMPLES: EXAMPLES, piiCheck: piiCheck, list: list, submit: submit, mine: mine, label: label, procOf: procOf,
  };
})();
