/* LexxMoMa Tools 共通「常連パス」(ブックマーク + アプリとして追加 → マイ LexxMoMa)
 * assets/theme.js が全ページで自動で読み込む。theme.js は manifest.webmanifest へのリンクも付ける
 *   - スタンプは 2 つ。どちらも「実際にそこから開いた」ときに押す(自己申告では押さない)
 *     🔖 ブックマーク: パスを開いている間と Ctrl+D を押した瞬間に URL へ ?via=bm を付けておき、
 *        その URL(=ブックマーク)から新しく開かれたら押す。再読込・戻る/進むでは押さない。印は読んだらすぐ URL から消す
 *        Ctrl+D を押しただけなら「仮押し」(次にブックマークから開くと本押し)
 *     📱 アプリ: アプリとして開かれた(display-mode: standalone)ときに押す。どのページでも押す
 *   - 2 つそろうと特典: ジオラマの LexxMoMa に名前を付けられる(キャビネットに名札・再訪時に「◯日ぶりですね」)
 *     + 稼働記録(パス完成日から数える稼働日数、訪問をまたいだ累計の箱数、節目でお祝い)
 *     1 つ目のスタンプでもロボットが喜ぶ(途中のごほうび)
 *   - 画面(パスのカード・ヘッダーのボタン・ジオラマとの連動)を出すのは <meta name="lx-keep" content="show"> を書いたページだけ
 *     (現在はトップ index.html のみ)。利用日数とアプリのスタンプは全ページで数える
 *   - 別の日に 3 回目の利用をした人には、トップでパスのカードを自動で 1 回開く(× は 14 日、「今後表示しない」は以後自動では開かない)
 *   - 計測: lxTrack("keep/…" / "pass/…") (assets/track.js)
 *   - 確認用: ?lx_keep=1 でカードを開く、?lx_keep=app でアプリのスタンプを押したことにする、?lx_keep=reset で記録を消す
 * 保存先 localStorage(すべてこのブラウザの中だけ。名前も送信しない):
 *   lx_visit {n: 利用した日数, last: 前回の日付}, lx_keep {until: 次に自動で開いてよい時刻(ms), never: true}
 *   lx_pass {bm, app, pend: スタンプを押した/仮押しした時刻(ms), done: 完成時刻, start: 稼働開始日, name, boxes: 累計箱数, ms: 祝った節目, seen: 演出済みのスタンプ}
 */
(function () {
  var MIN_DAYS = 3, SNOOZE_DAYS = 14, DELAY_MS = 4000, NAME_MAX = 8;
  var DAY_MS = [7, 30, 100, 200, 365, 500, 1000];
  var BOX_MS = [100, 500, 1000, 3000, 5000, 10000, 30000, 100000];

  function load(k) { try { return JSON.parse(localStorage.getItem(k) || "null") || {}; } catch (e) { return {}; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存不可の環境 */ } }
  function track(ev, title) { try { if (window.lxTrack) window.lxTrack(ev, title || ""); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function ymd(d) { return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function parse(s) { var a = String(s || "").split("-"); return a.length === 3 ? new Date(+a[0], a[1] - 1, +a[2]) : null; }
  function days(a, b) { var x = parse(a), y = parse(b); return x && y ? Math.round((y - x) / 864e5) : 0; }
  function jp(n) { return (n || 0).toLocaleString("ja-JP"); }

  var q = location.search;
  if (/[?&]lx_keep=reset\b/.test(q)) { try { ["lx_visit", "lx_keep", "lx_pass"].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {} }
  var force = /[?&]lx_keep=1\b/.test(q);
  // 確認用の指定は読んだら URL から消す(そのままブックマークされて毎回リセット、を防ぐ)
  if (/[?&]lx_keep=/.test(q)) {
    try { var u0 = new URL(location.href); u0.searchParams.delete("lx_keep"); history.replaceState(history.state, "", u0.pathname + u0.search + u0.hash); } catch (e) {}
  }

  var standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  var framed = false;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }

  // ---------- 利用日数(同じ日に何度開いても 1 日) ----------
  var today = ymd(new Date());
  var visit = load("lx_visit"), prevDay = visit.last || "", newDay = prevDay !== today;
  if (newDay) { visit = { n: (visit.n || 0) + 1, last: today }; save("lx_visit", visit); }
  if (standalone && newDay) addEventListener("load", function () { track("keep/standalone"); });

  // ---------- スタンプ ----------
  var P = load("lx_pass"); P.seen = P.seen || {}; P.ms = P.ms || [];
  var fresh = {};
  function savePass() { save("lx_pass", P); }

  var navType = "navigate";
  try { var ne = performance.getEntriesByType("navigation")[0]; if (ne && ne.type) navType = ne.type; } catch (e) {}
  if (/[?&]via=bm\b/.test(q)) {
    setVia(false);
    if (navType === "navigate" && !standalone && !P.bm) { P.bm = Date.now(); fresh.bm = 1; }
  }
  if ((standalone || /[?&]lx_keep=app\b/.test(q)) && !P.app) { P.app = Date.now(); fresh.app = 1; }
  if (P.bm && P.app && !P.done) { P.done = Date.now(); P.start = today; fresh.done = 1; }
  if (fresh.bm || fresh.app || fresh.done) savePass();
  addEventListener("load", function () {
    if (fresh.bm) track("pass/bm", "ブックマークから開いた");
    if (fresh.app) track("pass/app", "アプリとして開いた");
    if (fresh.done) track("pass/complete", "常連パス完成");
  });

  // ?via=bm の付け外し(他のクエリと #… はそのまま)
  function setVia(on) {
    try {
      var u = new URL(location.href);
      if (on === u.searchParams.has("via")) return;
      if (on) u.searchParams.set("via", "bm"); else u.searchParams.delete("via");
      history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    } catch (e) {}
  }

  // ---------- アプリとして追加 ----------
  var deferred = null;
  function isHub() { return !!document.querySelector('meta[name="lx-keep"][content="show"]'); }
  addEventListener("beforeinstallprompt", function (e) {
    if (!isHub() || P.app) return;  // トップ以外・押印済みならブラウザ標準の案内のまま
    e.preventDefault(); deferred = e; render();
  });
  addEventListener("appinstalled", function () { track("pass/installed"); deferred = null; render(); });

  var ua = navigator.userAgent || "";
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/.test(ua);
  var isMac = !isIOS && /Mac/.test(navigator.platform || ua);
  var isEdge = /Edg\//.test(ua), isFirefox = /Firefox\//.test(ua);
  var isSafari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg/.test(ua);

  function kbd(t) { return "<kbd>" + t + "</kbd>"; }
  function bmHint() {
    if (standalone) return "ブラウザでこのページを開いてブックマークすると押されます。";
    if (isIOS) return "共有 " + kbd("&#x2191;") + " →「ブックマークを追加」。";
    if (isAndroid) return "メニュー " + kbd("&#x22EE;") + " → " + kbd("&#x2606;") + " で保存。";
    return "この画面で " + kbd(isMac ? "&#x2318;" : "Ctrl") + " + " + kbd("D") + "。";
  }
  // 手順の細部はブラウザごとに違うので書かない。「何として追加し、どこから開くか」だけを短く
  function appHint() {
    if (isIOS || isAndroid) return "ホーム画面に追加して、そのアイコンから開くと押されます。";
    if (isSafari && isMac) return "Dock に追加して、そこから開くと押されます。";
    if (isFirefox) return "Chrome か Edge なら、デスクトップアプリとして追加できます。";
    return "デスクトップアプリとしてインストールして、そこから開くと押されます。";
  }

  // ---------- 画面(トップのみ) ----------
  var CSS = [
    '.lx-pass-chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--line,#d9e1ea);border-radius:999px;background:var(--panel,#fff);color:var(--text,#1F2933);font-family:inherit;font-weight:600;font-size:13px;line-height:1;white-space:nowrap;cursor:pointer;flex:none}',
    '.lx-pass-chip:hover{background:var(--panel-2,#eef3f8)}',
    '.lx-pass-chip .n{font-variant-numeric:tabular-nums;color:var(--muted,#5b6b7b)}',
    '.lx-pass-chip.done{border-color:#e0b43c;background:linear-gradient(135deg,#fff8e1,#fff);color:#7a5600}',
    '[data-theme="dark"] .lx-pass-chip.done{background:linear-gradient(135deg,#3a2e10,#171f26);color:#ffd66b;border-color:#8a6d1f}',
    '.lx-pass-chip.ping{animation:lxPing 1.2s ease-out 2}',
    '@keyframes lxPing{0%{box-shadow:0 0 0 0 rgba(0,104,183,.45)}100%{box-shadow:0 0 0 12px rgba(0,104,183,0)}}',
    '@media (max-width:480px){.lx-pass-chip .t{display:none}.lx-pass-chip{padding:0 10px}}',

    '.lx-pass{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:2147483000;width:380px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;border-radius:16px;background:var(--panel,#fff);color:var(--text,#1F2933);border:1px solid var(--line,#d9e1ea);box-shadow:0 18px 48px rgba(16,32,48,.22);font-family:"Noto Sans JP","Hiragino Sans","Yu Gothic UI",Meiryo,system-ui,sans-serif;font-size:13px;line-height:1.6;opacity:0;transform:translateY(10px) scale(.98);transition:opacity .25s,transform .25s}',
    '.lx-pass.on{opacity:1;transform:none}',
    '[data-theme="dark"] .lx-pass{box-shadow:0 18px 48px rgba(0,0,0,.55)}',
    '.lx-pass *{box-sizing:border-box}',
    '.lx-pass-hd{position:relative;padding:16px 44px 12px 18px;background:linear-gradient(135deg,#0068B7,#3EB370);color:#fff;border-radius:15px 15px 0 0}',
    '.lx-pass-hd small{display:block;font-size:11px;letter-spacing:.14em;opacity:.85}',
    '.lx-pass-hd b{display:block;font-size:17px;font-weight:800;letter-spacing:.02em}',
    '.lx-pass-hd p{margin:2px 0 0;font-size:12px;opacity:.92}',
    '.lx-pass-x{position:absolute;top:10px;right:10px;width:30px;height:30px;border:0;border-radius:8px;background:rgba(255,255,255,.14);color:#fff;font-size:18px;line-height:1;cursor:pointer}',
    '.lx-pass-x:hover{background:rgba(255,255,255,.26)}',
    '.lx-pass-bd{padding:14px 18px 16px}',
    '.lx-slots{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '.lx-slot{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;padding:12px 10px;border:1px solid var(--line,#d9e1ea);border-radius:12px;background:var(--panel-2,#f5f7fa)}',
    '.lx-slot h4{margin:0;font-size:12px;font-weight:700;color:var(--muted,#5b6b7b)}',
    '.lx-slot p{margin:0;font-size:11.5px;line-height:1.55;color:var(--muted,#5b6b7b)}',
    '.lx-seal{--c:#0068B7;width:62px;height:62px;border-radius:50%;display:grid;place-items:center;border:2px dashed var(--line,#c5d0db);color:var(--faint,#8a99a8);font-size:24px;line-height:1;position:relative}',
    '.lx-slot.app .lx-seal{--c:#3EB370}',
    '.lx-seal.pend{border-color:var(--c);border-style:dashed;color:var(--c)}',
    '.lx-seal.pend::after{content:"仮";position:absolute;right:-6px;top:-6px;width:20px;height:20px;border-radius:50%;background:var(--c);color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center}',
    '.lx-seal.got{border:3px double var(--c);color:var(--c);background:color-mix(in srgb,var(--c) 10%,transparent);transform:rotate(-12deg);font-size:13px;font-weight:800;flex-direction:column;display:flex;align-items:center;justify-content:center;gap:1px}',
    '.lx-seal.got i{font-style:normal;font-size:20px}',
    '.lx-seal.got em{font-style:normal;font-size:9px;font-weight:600;opacity:.8}',
    '.lx-seal.pop{animation:lxStamp .6s cubic-bezier(.2,1.4,.4,1) both}',
    '@keyframes lxStamp{0%{transform:scale(2.4) rotate(-40deg);opacity:0}55%{transform:scale(.88) rotate(-10deg);opacity:1}100%{transform:scale(1) rotate(-12deg)}}',
    '.lx-pass kbd{display:inline-block;min-width:1.5em;padding:0 5px;border:1px solid var(--line,#c5d0db);border-bottom-width:2px;border-radius:5px;background:var(--panel,#fff);color:var(--text,#1F2933);font-family:inherit;font-weight:600;font-size:11px;line-height:1.6;text-align:center}',
    '.lx-btn{display:inline-block;padding:6px 12px;border:0;border-radius:8px;background:#0068B7;color:#fff;font-family:inherit;font-weight:700;font-size:12px;line-height:1.4;cursor:pointer}',
    '.lx-slot.app .lx-btn{background:#3EB370}',
    '.lx-btn:hover{filter:brightness(1.08)}',
    '.lx-gift{display:flex;gap:10px;align-items:center;margin-top:12px;padding:10px 12px;border-radius:12px;border:1px dashed #e0b43c;background:color-mix(in srgb,#ffd66b 14%,transparent)}',
    '.lx-gift .ic{font-size:22px;flex:none}',
    '.lx-gift p{margin:0;font-size:12px;line-height:1.55}',
    '.lx-gift b{color:var(--text,#1F2933)}',
    '.lx-pass-ft{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:11px;color:var(--faint,#8a99a8)}',
    '.lx-link{margin-left:auto;padding:0;border:0;background:none;color:var(--faint,#8a99a8);font-family:inherit;font-size:11px;text-decoration:underline;cursor:pointer}',
    '.lx-done{text-align:center}',
    '.lx-medal{font-size:44px;line-height:1;margin:2px 0 4px}',
    '.lx-done h3{margin:0 0 2px;font-size:16px;font-weight:800}',
    '.lx-done .sub{margin:0 0 12px;font-size:12px;color:var(--muted,#5b6b7b)}',
    '.lx-name{display:flex;gap:6px;margin:0 0 6px}',
    '.lx-name input{flex:1;min-width:0;height:36px;padding:0 10px;border:1px solid var(--line,#c5d0db);border-radius:8px;background:var(--panel,#fff);color:var(--text,#1F2933);font-family:inherit;font-size:14px}',
    '.lx-name input:focus{outline:2px solid #0068B7;outline-offset:1px;border-color:transparent}',
    '.lx-plate{display:inline-block;margin:0 0 10px;padding:4px 14px;border:1.5px solid #0068B7;border-radius:6px;background:#fff;color:#0068B7;font-weight:800;font-size:16px;letter-spacing:.04em}',
    '.lx-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:4px 0 0}',
    '.lx-stats div{padding:8px 4px;border-radius:10px;background:var(--panel-2,#f5f7fa);border:1px solid var(--line,#d9e1ea)}',
    '.lx-stats b{display:block;font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.3}',
    '.lx-stats span{font-size:10.5px;color:var(--muted,#5b6b7b)}',
    '.lx-mini{display:flex;justify-content:center;gap:14px;margin:10px 0 0;font-size:11px;color:var(--faint,#8a99a8)}',
    '.lx-confetti{position:absolute;inset:0;pointer-events:none;overflow:hidden;border-radius:16px}',
    '.lx-confetti i{position:absolute;top:-10px;width:7px;height:11px;border-radius:2px;animation:lxFall 1.8s ease-in forwards}',
    '@keyframes lxFall{to{transform:translateY(420px) rotate(540deg);opacity:0}}',
    '.lx-pass button:focus-visible,.lx-pass-chip:focus-visible{outline:2px solid #0068B7;outline-offset:2px}',
    '@media (max-width:600px){.lx-pass{left:16px;right:16px;width:auto;max-width:none}}',
    '@media (prefers-reduced-motion:reduce){.lx-pass,.lx-seal.pop,.lx-pass-chip.ping{transition:none;animation:none}.lx-confetti{display:none}}',
    '.stage-stat.lx-op b{font-variant-numeric:tabular-nums}'
  ].join("");

  var chip = null, panel = null, mode = "", pops = {};

  function count() { return (P.bm ? 1 : 0) + (P.app ? 1 : 0); }
  function opDay() { return P.start ? days(P.start, today) + 1 : 0; }
  function when(ts) { var d = new Date(ts); return (d.getMonth() + 1) + "/" + d.getDate(); }

  function renderChip() {
    if (!chip) return;
    chip.classList.toggle("done", !!P.done);
    chip.innerHTML = P.done
      ? '🎖 <span class="t">' + esc(P.name || "常連パス") + "</span>"
      : '🎖 <span class="t">常連パス</span> <span class="n">' + count() + "/2</span>";
    chip.setAttribute("aria-label", "常連パス " + (P.done ? "完成" : count() + "/2"));
  }

  function seal(kind, icon, label) {
    var cls = P[kind] ? "got" : (kind === "bm" && P.pend) ? "pend" : "";
    if (P[kind] && pops[kind]) cls += " pop";
    var inner = P[kind] ? "<i>" + icon + "</i>" + label + "<em>" + when(P[kind]) + "</em>" : icon;
    return '<div class="lx-seal ' + cls + '">' + inner + "</div>";
  }

  function bodyCollect() {
    var bm = P.bm ? "<p>ブックマークから来てくれました！</p>"
      : P.pend ? "<p><b>仮押し中</b>。次にそのブックマークから開くと本押しです。</p>"
      : "<p>" + bmHint() + "<br>次回そのブックマークから開くと押されます。</p>";
    var app = P.app ? "<p>アプリで開いてくれました！</p>"
      : deferred ? '<button type="button" class="lx-btn" data-act="install">アプリとして追加</button><p>追加した' + (isIOS || isAndroid ? "アイコン" : "デスクトップアプリ") + 'から開くと押されます。</p>'
      : "<p>" + appHint() + "</p>";
    var left = 2 - count();
    return '<div class="lx-slots">' +
      '<div class="lx-slot bm"><h4>🔖 ブックマーク</h4>' + seal("bm", "🔖", "済") + bm + "</div>" +
      '<div class="lx-slot app"><h4>📱 アプリ</h4>' + seal("app", "📱", "済") + app + "</div></div>" +
      '<div class="lx-gift"><span class="ic">🎁</span><p>' +
      (left === 1 ? "<b>あと 1 つ！</b> " : "<b>2 つそろうと</b>、") +
      "ジオラマの LexxMoMa に<b>名前を付けられます</b>。稼働日数と運んだ箱の数も記録していきます。</p></div>" +
      '<div class="lx-pass-ft"><span>記録はこのブラウザの中だけに保存されます</span>' +
      (mode === "nudge" ? '<button type="button" class="lx-link" data-act="never">今後表示しない</button>' : "") + "</div>";
  }

  function bodyDone() {
    var named = !!P.name;
    var form = '<form class="lx-name" data-act="name"><input name="n" maxlength="' + NAME_MAX + '" placeholder="例: モマ太郎" value="' + esc(P.name || "") + '" aria-label="LexxMoMa の名前(' + NAME_MAX + '文字まで)" autocomplete="off"><button class="lx-btn">' + (named ? "変更" : "決定") + "</button></form>";
    return '<div class="lx-done"><div class="lx-medal">🎖</div>' +
      "<h3>" + (named ? esc(P.name) + " が稼働中" : "常連パス 完成！") + "</h3>" +
      '<p class="sub">' + (named ? "いつも来てくれてありがとうございます。" : "あなたの LexxMoMa に名前を付けてください。") + "</p>" +
      (named && mode !== "rename" ? '<div class="lx-plate">' + esc(P.name) + "</div>" : form) +
      '<div class="lx-stats"><div><b>' + jp(opDay()) + "</b><span>稼働日数</span></div>" +
      "<div><b>" + jp(P.boxes) + "</b><span>累計はこんだ箱</span></div>" +
      "<div><b>" + (P.start ? P.start.replace(/-/g, "/").replace(/^\d{4}\//, "") : "-") + "</b><span>稼働開始</span></div></div>" +
      '<div class="lx-mini"><span>🔖 ' + when(P.bm) + "</span><span>📱 " + when(P.app) + "</span>" +
      (named && mode !== "rename" ? '<button type="button" class="lx-link" data-act="rename" style="margin-left:0">名前を変える</button>' : "") + "</div></div>";
  }

  function render() {
    renderChip();
    if (!panel) return;
    var done = !!P.done;
    panel.querySelector(".lx-pass-bd").innerHTML = done ? bodyDone() : bodyCollect();
    panel.querySelector(".lx-pass-hd").innerHTML =
      '<small>LEXXMOMA REGULAR PASS</small><b>常連パス</b><p>' +
      (done ? "スタンプ 2/2 · 特典が開きました" : "スタンプ 2 つで、あなただけの LexxMoMa に。") + "</p>" +
      '<button type="button" class="lx-pass-x" data-act="close" aria-label="閉じる" title="閉じる">&times;</button>';
    pops = {};
  }

  function open(m) {
    if (!document.body) return;
    mode = m || "manual";
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "lx-pass";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "常連パス");
      panel.innerHTML = '<div class="lx-pass-hd"></div><div class="lx-pass-bd"></div>';
      panel.addEventListener("click", onClick);
      panel.addEventListener("submit", onSubmit);
      document.body.appendChild(panel);
      requestAnimationFrame(function () { requestAnimationFrame(function () { panel && panel.classList.add("on"); }); });
    }
    render();
    if (!P.bm && !standalone) setVia(true);   // このままブックマークされたら、戻ってきたときに分かるように
    if (mode === "nudge") track("keep/shown");
    if (P.done && !P.name) setTimeout(function () { var i = panel && panel.querySelector(".lx-name input"); if (i) i.focus(); }, 350);
  }
  function close(snooze) {
    if (!panel) return;
    if (snooze && mode === "nudge") save("lx_keep", { until: Date.now() + SNOOZE_DAYS * 864e5, never: load("lx_keep").never });
    if (!P.pend) setVia(false);
    var p = panel; panel = null;
    p.classList.remove("on");
    setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 300);
  }

  function onClick(e) {
    var t = e.target.closest("[data-act]");
    if (!t) return;
    var act = t.getAttribute("data-act");
    if (act === "close") { track(mode === "nudge" ? "keep/dismiss" : "pass/close"); close(true); }
    else if (act === "never") { track("keep/never"); save("lx_keep", { never: true }); close(false); }
    else if (act === "rename") { mode = "rename"; render(); var i = panel.querySelector(".lx-name input"); if (i) { i.focus(); i.select(); } }
    else if (act === "install" && deferred) {
      track("pass/install_click");
      var p = deferred; deferred = null;
      p.prompt();
      p.userChoice.then(function (r) { track(r && r.outcome === "accepted" ? "pass/install_ok" : "pass/install_cancel"); render(); });
    }
  }
  function onSubmit(e) {
    e.preventDefault();
    var v = (e.target.elements.n.value || "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
    if (!v) { e.target.elements.n.focus(); return; }
    var first = !P.name;
    P.name = v; savePass();
    mode = "manual"; render();
    withStage(function (st) { st.setName(v); st.cheer(first ? v + "です！よろしくお願いします" : v + "になりました！"); });
    track(first ? "pass/named" : "pass/renamed");
  }

  function confetti() {
    if (!panel) return;
    var c = document.createElement("div"); c.className = "lx-confetti";
    var colors = ["#0068B7", "#3EB370", "#ffd66b", "#ff7aa2", "#5aa8e6"];
    for (var i = 0; i < 28; i++) {
      var s = document.createElement("i");
      s.style.left = Math.random() * 100 + "%";
      s.style.background = colors[i % colors.length];
      s.style.animationDelay = (Math.random() * 0.5) + "s";
      s.style.transform = "rotate(" + (Math.random() * 180) + "deg)";
      c.appendChild(s);
    }
    panel.appendChild(c);
    setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 2600);
  }

  // Ctrl+D (⌘D) を押したら: 印を付けて仮押し。ブラウザのブックマーク動作はそのまま(preventDefault しない)
  function onKey(e) {
    if (P.bm || standalone) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "d" || e.key === "D")) {
      setVia(true);
      if (!P.pend) { P.pend = Date.now(); savePass(); track("pass/bm_pending", "Ctrl+D"); }
      render();
    }
  }

  function withStage(fn) {
    if (window.lxStage) return fn(window.lxStage);
    document.addEventListener("lx-stage-ready", function () { fn(window.lxStage); }, { once: true });
  }

  // 稼働記録: 下段に「稼働◯日目」、箱の数は訪問をまたいで積み上げる
  function stageRecords() {
    withStage(function (st) {
      st.setName(P.name || "");
      st.setBase(P.boxes || 0);
      var cnt = document.getElementById("stCount");
      if (cnt && cnt.parentNode) {
        var lab = cnt.parentNode.firstChild;
        if (lab && lab.nodeType === 3) lab.nodeValue = "累計はこんだ箱 ";
        if (!document.querySelector(".stage-stat.lx-op")) {
          var op = document.createElement("span");
          op.className = "stage-stat lx-op";
          op.title = "常連パスを完成させた日から数えた日数";
          op.innerHTML = "稼働 <b>" + jp(opDay()) + "</b> 日目";
          cnt.parentNode.parentNode.insertBefore(op, cnt.parentNode);
        }
      }
    });
    var lastSave = 0;
    document.addEventListener("lx-stage-box", function (e) {
      P.boxes = e.detail.total;
      var hit = BOX_MS.filter(function (m) { return P.boxes >= m && P.ms.indexOf("b" + m) < 0; }).pop();
      if (hit) {
        BOX_MS.forEach(function (m) { if (P.boxes >= m && P.ms.indexOf("b" + m) < 0) P.ms.push("b" + m); });
        withStage(function (st) { st.cheer("累計 " + jp(hit) + " 箱！いつもありがとうございます", 3.2); });
        track("pass/milestone/box" + hit);
      }
      if (hit || Date.now() - lastSave > 5000) { lastSave = Date.now(); savePass(); }
      if (panel && P.done) { var b = panel.querySelectorAll(".lx-stats b")[1]; if (b) b.textContent = jp(P.boxes); }
    });
    addEventListener("pagehide", savePass);
  }

  // 来てくれたときのひとこと(完成後・その日最初の 1 回)
  function greet() {
    if (!newDay || fresh.done) return;
    var d = opDay(), nm = P.name || "LexxMoMa";
    var dayHit = DAY_MS.filter(function (m) { return d >= m && P.ms.indexOf("d" + m) < 0; }).pop();
    if (dayHit) {
      DAY_MS.forEach(function (m) { if (d >= m && P.ms.indexOf("d" + m) < 0) P.ms.push("d" + m); });
      savePass();
      var msg = d === dayHit ? "稼働 " + jp(dayHit) + " 日目です！" : "稼働 " + jp(dayHit) + " 日を超えました！";
      setTimeout(function () { withStage(function (st) { st.cheer(msg, 3.4); }); }, 1500);
      track("pass/milestone/day" + dayHit);
      return;
    }
    var gap = prevDay ? days(prevDay, today) : 0;
    var text = gap >= 2 ? nm + "です。" + gap + "日ぶりですね！" : "おかえりなさい！" + nm + "、今日もはこびます";
    setTimeout(function () { withStage(function (st) { st.say(text, 3.2); }); }, 1500);
  }

  function ui() {
    if (!isHub() || framed) return;
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);

    chip = document.createElement("button");
    chip.type = "button";
    chip.className = "lx-pass-chip";
    chip.title = "常連パス";
    chip.addEventListener("click", function () { if (panel) close(false); else { track("pass/open"); open("manual"); } });
    var themeBtn = document.querySelector("header .lx-theme-btn");
    if (themeBtn) themeBtn.parentNode.insertBefore(chip, themeBtn); else document.body.appendChild(chip);
    renderChip();

    addEventListener("keydown", onKey, true);
    if (P.done) { stageRecords(); greet(); }

    // 押したばかりのスタンプ(別ページで押したものも含む)は、ここで演出する
    var unseen = ["bm", "app"].filter(function (k) { return P[k] && !P.seen[k]; });
    var celebrateDone = P.done && !P.seen.done;
    if (unseen.length || celebrateDone) {
      unseen.forEach(function (k) { pops[k] = 1; P.seen[k] = 1; });
      if (celebrateDone) P.seen.done = 1;
      savePass();
      setTimeout(function () {
        open("celebrate");
        chip.classList.add("ping");
        if (celebrateDone) {
          confetti();
          withStage(function (s) { s.cheer("パス完成！名前を付けてください", 3.4); });
        } else {
          withStage(function (s) { s.cheer(unseen[0] === "bm" ? "ブックマークありがとうございます！" : "アプリで来てくれた！", 3); });
          setTimeout(function () { withStage(function (s) { s.say("あと 1 つで名前をもらえます", 2.8); }); }, 3200);
        }
      }, 700);
      return;
    }

    var keep = load("lx_keep");
    var nudge = force || (!P.done && !standalone && !keep.never && (visit.n || 0) >= MIN_DAYS && Date.now() >= (keep.until || 0));
    if (nudge) setTimeout(function () { if (!panel) open("nudge"); }, force ? 300 : DELAY_MS);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ui); else ui();
})();
