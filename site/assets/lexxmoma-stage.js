/* LexxMoMa Tools — トップページの「稼働中」ジオラマ
 * 横から見た LexxMoMa(AMR台車+背高キャビネット+白い協働アーム)が
 * 工作機械の払い出し台から箱を取り、台車へ積む。台車が満載になると出荷されて入れ替わる。
 * シーン内時計(1秒≒8分)で昼夜が巡り、夜は作業者が帰ってもロボットは働き続ける。
 * クリックでジャンプ+ハート。prefers-reduced-motion では停止状態で表示し、▶で再生できる。
 * 依存なし。座標は viewBox 640×280、床 y=240。
 */
(function () {
  "use strict";
  var svg = document.getElementById("stageSvg");
  if (!svg) return;
  var stageEl = document.getElementById("stage");
  var NS = "http://www.w3.org/2000/svg";

  // ---------- 小道具 ----------
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(e);
    return e;
  }
  function set(e, attrs) { for (var k in attrs) e.setAttribute(k, attrs[k]); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeIn(t) { return t * t * t; }
  var DEG = 180 / Math.PI;
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // ---------- 寸法 ----------
  var FLOOR = 240;
  var ARM_Y = -134;               // アーム根元(J2)のロボット局所座標
  var L1 = 78, L2 = 70;           // リンク長
  var TOOL = 16;                  // 手首点→箱上面
  var BOX_W = 30, BOX_H = 22;
  var PICK_X = 228, PLACE_X = 460;
  var TABLE_TOP = 176, SUPPLY_X = 138;
  var CART_X0 = 528;              // 台車の定位置(左端)
  var DECK = 196;                 // 台車の荷台上面
  var SLOTS = [[25, 0], [61, 0], [25, 1], [61, 1]]; // 台車内の箱中心x と段

  // ---------- 背景 ----------
  var defs = el("defs", {});
  var hl = el("linearGradient", { id: "lxBeam", x1: "0", x2: "1", y1: "0", y2: "0" }, defs);
  el("stop", { offset: "0", "stop-color": "#ffe9a8", "stop-opacity": ".75" }, hl);
  el("stop", { offset: "1", "stop-color": "#ffe9a8", "stop-opacity": "0" }, hl);

  var sky = el("g", {});
  var sun = el("circle", { r: 13, fill: "#ffc94a", opacity: 0.9 }, sky);
  var moon = el("g", {}, sky);
  el("circle", { r: 11, fill: "#f3f0d7" }, moon);
  el("circle", { r: 9, cx: 5, cy: -3, fill: "var(--sky1)" }, moon);
  var stars = el("g", { opacity: 0 }, sky);
  [[70, 30], [150, 18], [230, 44], [320, 22], [410, 38], [500, 16], [590, 34], [120, 60], [380, 64]].forEach(function (p) {
    el("circle", { cx: p[0], cy: p[1], r: 1.3, fill: "#fff" }, stars);
  });

  // 工場の壁と窓・柱
  el("rect", { x: 0, y: 92, width: 640, height: 148, fill: "var(--wall)", opacity: 0.55 });
  for (var i = 0; i < 6; i++) {
    el("rect", { x: 40 + i * 104, y: 104, width: 60, height: 26, rx: 3, fill: "var(--sky2)", stroke: "var(--floor2)", "stroke-width": 1.5, opacity: 0.8 });
  }
  for (var j = 0; j < 4; j++) el("rect", { x: 10 + j * 208, y: 92, width: 8, height: 148, fill: "var(--floor2)", opacity: 0.7 });

  // 床と走行レーン
  el("rect", { x: 0, y: FLOOR, width: 640, height: 40, fill: "var(--floor)" });
  el("line", { x1: 0, y1: FLOOR, x2: 640, y2: FLOOR, stroke: "var(--floor2)", "stroke-width": 2 });
  el("line", { x1: 170, y1: 258, x2: 520, y2: 258, stroke: "#3EB370", "stroke-width": 3, "stroke-dasharray": "14 10", opacity: 0.55 });
  var laneTxt = el("text", { x: 345, y: 274, "text-anchor": "middle", "font-size": 9, fill: "var(--ink)", opacity: 0.55, "font-weight": 700, "letter-spacing": "2" });
  laneTxt.textContent = "AMR LANE";

  // 作業者(背景側・昼だけ)
  var worker = el("g", { transform: "translate(338,236) scale(.92)" });
  el("rect", { x: -8, y: -30, width: 16, height: 30, rx: 5, fill: "#6b7a89" }, worker);      // 脚
  el("rect", { x: -11, y: -62, width: 22, height: 36, rx: 7, fill: "#2f5e8f" }, worker);      // 作業着
  el("circle", { cx: 0, cy: -72, r: 9, fill: "#f2c9a0" }, worker);                           // 顔
  el("path", { d: "M-10 -74 a10 10 0 0 1 20 0 z", fill: "#3EB370" }, worker);                // 帽子
  el("circle", { cx: 3, cy: -72, r: 1.2, fill: "#333" }, worker);
  var wArm = el("g", { transform: "translate(8,-54)" }, worker);
  el("rect", { x: -3, y: -2, width: 6, height: 20, rx: 3, fill: "#2f5e8f" }, wArm);
  el("rect", { x: -4, y: 14, width: 9, height: 10, rx: 2, fill: "#fff", stroke: "#8a99a8" }, wArm); // カップ
  var steam = el("path", { d: "M0 10 q3 -4 0 -8 q-3 -4 0 -8", fill: "none", stroke: "#8a99a8", "stroke-width": 1.2, "stroke-linecap": "round", opacity: 0.7 }, wArm);

  // 工作機械+払い出し台+シューター
  var mc = el("g", {});
  el("rect", { x: 10, y: 108, width: 88, height: 132, rx: 6, fill: "#c9d3dc", stroke: "#9fb0bf", "stroke-width": 1.5 }, mc);
  el("rect", { x: 22, y: 124, width: 52, height: 40, rx: 3, fill: "#34414d" }, mc);
  var mcGlow = el("rect", { x: 26, y: 128, width: 44, height: 32, rx: 2, fill: "#5aa8e6", opacity: 0.35 }, mc);
  el("rect", { x: 22, y: 176, width: 64, height: 6, rx: 2, fill: "#9fb0bf" }, mc);
  var mcLamp = [el("circle", { cx: 84, cy: 128, r: 4, fill: "#3EB370" }, mc), el("circle", { cx: 84, cy: 140, r: 4, fill: "#f0b840", opacity: 0.3 }, mc)];
  var mcTxt = el("text", { x: 54, y: 214, "text-anchor": "middle", "font-size": 10, "font-weight": 700, fill: "#5b6b7b" }, mc);
  mcTxt.textContent = "MC-01";
  el("rect", { x: 96, y: TABLE_TOP, width: 64, height: 6, rx: 2, fill: "#8a99a8" }, mc);
  el("rect", { x: 100, y: TABLE_TOP + 6, width: 5, height: FLOOR - TABLE_TOP - 6, fill: "#9fb0bf" }, mc);
  el("rect", { x: 150, y: TABLE_TOP + 6, width: 5, height: FLOOR - TABLE_TOP - 6, fill: "#9fb0bf" }, mc);
  el("path", { d: "M118 0 V70 M158 0 V70", stroke: "#9fb0bf", "stroke-width": 3 }, mc); // シューター
  el("rect", { x: 116, y: 66, width: 44, height: 5, rx: 2, fill: "#9fb0bf" }, mc);

  function boxShape(parent) {
    var g = el("g", {}, parent);
    el("rect", { x: -BOX_W / 2, y: 0, width: BOX_W, height: BOX_H, rx: 2, fill: "#d9a86c", stroke: "#a97a45", "stroke-width": 1.2 }, g);
    el("rect", { x: -3, y: 0, width: 6, height: BOX_H, fill: "#c4914f" }, g);
    el("rect", { x: -BOX_W / 2 + 3, y: 13, width: 8, height: 5, rx: 1, fill: "#fff", opacity: 0.85 }, g);
    return g;
  }
  var supplyBox = boxShape(svg);

  // 台車(カゴ台車)
  var cart = el("g", {});
  el("rect", { x: 0, y: DECK, width: 86, height: 8, rx: 2, fill: "#5aa8e6" }, cart);
  el("path", { d: "M84 " + DECK + " V" + (DECK - 50) + " h6", stroke: "#8a99a8", "stroke-width": 3, fill: "none", "stroke-linecap": "round" }, cart);
  var cartWheels = [];
  [12, 74].forEach(function (x) {
    var w = el("g", { transform: "translate(" + x + "," + (FLOOR - 8) + ")" }, cart);
    el("rect", { x: x - 2, y: DECK + 8, width: 4, height: FLOOR - 8 - DECK - 8, fill: "#8a99a8" }, cart);
    var wr = el("g", {}, w);
    el("circle", { r: 8, fill: "#3a4651" }, wr);
    el("line", { x1: -5, y1: 0, x2: 5, y2: 0, stroke: "#c9d3dc", "stroke-width": 1.5 }, wr);
    cartWheels.push(wr);
  });
  var cartBoxes = el("g", {}, cart);

  // ---------- ロボット ----------
  var robot = el("g", { id: "lxRobot", tabindex: 0, role: "button", "aria-label": "LexxMoMaをなでる" });
  var glowG = null; // 夜の光は暗幕の上に描くので後で作る
  var body = el("g", {}, robot);
  el("ellipse", { cx: 0, cy: 1, rx: 64, ry: 4, fill: "#000", opacity: 0.12 }, body);                // 影
  var wheels = [];
  [-40, 40].forEach(function (x) {
    var w = el("g", { transform: "translate(" + x + ",-9)" }, body);
    var wr = el("g", {}, w);
    el("circle", { r: 9, fill: "#2b333b" }, wr);
    el("circle", { r: 3.5, fill: "#8a99a8" }, wr);
    el("line", { x1: 0, y1: -7, x2: 0, y2: 7, stroke: "#5b6b7b", "stroke-width": 1.5 }, wr);
    wheels.push(wr);
  });
  el("rect", { x: -62, y: -34, width: 124, height: 24, rx: 7, fill: "#d9dee4", stroke: "#b7c1cb", "stroke-width": 1.2 }, body); // AMR台車
  el("rect", { x: -62, y: -24, width: 124, height: 4, fill: "#0068B7" }, body);
  el("rect", { x: -62, y: -20, width: 124, height: 2, fill: "#3EB370" }, body);
  el("path", { d: "M-50 -34 V-110 L-40 -120 H40 L50 -110 V-34 Z", class: "lx-cab", fill: "#eef1f4", stroke: "#b7c1cb", "stroke-width": 1.2 }, body); // キャビネット
  el("line", { x1: 0, y1: -66, x2: 0, y2: -38, stroke: "#c9d1d9", "stroke-width": 1 }, body);
  el("circle", { cx: -5, cy: -52, r: 1.5, fill: "#a9b4bf" }, body);
  el("circle", { cx: 5, cy: -52, r: 1.5, fill: "#a9b4bf" }, body);
  // 顔(側面ディスプレイ)
  el("rect", { x: -27, y: -104, width: 54, height: 30, rx: 8, fill: "#1f2933" }, body);
  var eyesN = el("g", {}, body);
  var eyeL = el("rect", { x: -13, y: -94, width: 7, height: 10, rx: 3.5, fill: "#5fe3a1" }, eyesN);
  var eyeR = el("rect", { x: 6, y: -94, width: 7, height: 10, rx: 3.5, fill: "#5fe3a1" }, eyesN);
  var eyesH = el("g", { opacity: 0 }, body);
  el("path", { d: "M-14 -86 l4.5 -6 l4.5 6 M5 -86 l4.5 -6 l4.5 6", stroke: "#5fe3a1", "stroke-width": 2.6, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, eyesH);
  var cheeks = el("g", { opacity: 0 }, body);
  el("ellipse", { cx: -20, cy: -80, rx: 4, ry: 2, fill: "#ff8fa3" }, cheeks);
  el("ellipse", { cx: 20, cy: -80, rx: 4, ry: 2, fill: "#ff8fa3" }, cheeks);
  var beacon = el("circle", { cx: -36, cy: -123, r: 3.5, fill: "#3EB370" }, body);
  // アーム
  el("rect", { x: -15, y: -134, width: 30, height: 15, rx: 3, fill: "#2b333b" }, robot);  // J1ベース
  var link1 = el("g", {}, robot);
  el("rect", { x: -7, y: -8, width: L1 + 14, height: 16, rx: 8, fill: "#fbfcfd", stroke: "#c3ccd5", "stroke-width": 1.2 }, link1);
  var link2 = el("g", {}, robot);
  el("rect", { x: -6, y: -6.5, width: L2 + 10, height: 13, rx: 6.5, fill: "#fbfcfd", stroke: "#c3ccd5", "stroke-width": 1.2 }, link2);
  function ring(parent) { var g = el("g", {}, parent); el("circle", { r: 9, fill: "#fff", stroke: "#3EB370", "stroke-width": 3 }, g); el("circle", { r: 3, fill: "#c3ccd5" }, g); return g; }
  var shoulder = ring(robot); set(shoulder, { transform: "translate(0," + ARM_Y + ")" });
  var elbow = ring(robot);
  var wrist = el("g", {}, robot);
  el("circle", { r: 6.5, fill: "#fff", stroke: "#3EB370", "stroke-width": 2.5 }, wrist);
  el("rect", { x: -6, y: 2, width: 12, height: 10, rx: 2, fill: "#2b333b" }, wrist);        // ツール
  el("rect", { x: 5, y: 3, width: 6, height: 5, rx: 1.5, fill: "#2b333b" }, wrist);         // 手首カメラ
  el("circle", { cx: 9.5, cy: 5.5, r: 1.6, fill: "#5aa8e6" }, wrist);
  var heldBox = boxShape(wrist); set(heldBox, { transform: "translate(0," + TOOL + ")", opacity: 0 });
  var fingerL = el("rect", { y: 10, width: 4, height: 18, rx: 1.5, fill: "#44525f" }, wrist);
  var fingerR = el("rect", { y: 10, width: 4, height: 18, rx: 1.5, fill: "#44525f" }, wrist);

  // ---------- 夜の暗幕と、その上に描く光・吹き出し ----------
  var night = el("rect", { x: 0, y: 0, width: 640, height: 280, fill: "#081428", opacity: 0, "pointer-events": "none" });
  var winGlow = el("g", { opacity: 0, "pointer-events": "none" });
  for (var k = 0; k < 6; k++) el("rect", { x: 40 + k * 104, y: 104, width: 60, height: 26, rx: 3, fill: "#0e2344" }, winGlow);
  glowG = el("g", { "pointer-events": "none" });
  var beam = el("path", { d: "M0 -22 L120 -4 L120 2 L0 -14 Z", fill: "url(#lxBeam)", opacity: 0 }, glowG);
  var beaconGlow = el("circle", { cx: -36, cy: -123, r: 7, fill: "#3EB370", opacity: 0 }, glowG);
  var eyeGlow = el("rect", { x: -16, y: -97, width: 32, height: 16, rx: 8, fill: "#5fe3a1", opacity: 0 }, glowG);
  var mcNight = el("circle", { cx: 84, cy: 128, r: 7, fill: "#3EB370", opacity: 0, "pointer-events": "none" });
  var fx = el("g", { "pointer-events": "none" });   // ハート等
  var bubble = el("g", { opacity: 0, "pointer-events": "none" });
  var bubRect = el("rect", { rx: 9, fill: "#fff", stroke: "#0068B7", "stroke-width": 1.5 }, bubble);
  var bubTail = el("path", { fill: "#fff", stroke: "#0068B7", "stroke-width": 1.5, "stroke-linejoin": "round" }, bubble);
  var bubText = el("text", { "font-size": 12, "font-weight": 700, fill: "#1f2933", "text-anchor": "middle", "dominant-baseline": "central" }, bubble);

  // ---------- 状態 ----------
  var S = {
    rx: PLACE_X, dir: -1, bounce: 0, jumpT: -1, happyT: 0, blinkT: 2.5, wheelA: 0,
    arm: { x: 20, y: -36 }, grip: 0, held: false, moving: false,
    supply: { state: "rest", y: TABLE_TOP - BOX_H, vy: 0, wait: 0 },
    cart: { x: CART_X0, n: 0, state: "ready", t: 0, wheelA: 0 },
    minutes: 9 * 60, count: 0, lastHour: 9,
    bub: { t: 0, text: "", who: "robot" },
    workerA: 1, sipT: 0, hearts: []
  };
  var REST = { x: 20, y: -36 }, CARRY = { x: 6, y: -24 };

  // ---------- 逆運動学(肘上げ解・手先は常に下向き) ----------
  function ik(tx, ty) {
    var d = clamp(Math.hypot(tx, ty), Math.abs(L1 - L2) + 1, L1 + L2 - 0.5);
    var base = Math.atan2(ty, tx);
    var a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    var s1 = base - a, s2 = base + a;
    var e1y = L1 * Math.sin(s1), e2y = L1 * Math.sin(s2);
    var s = e1y < e2y ? s1 : s2;
    var ex = L1 * Math.cos(s), ey = L1 * Math.sin(s);
    // 到達不能時は届く範囲に手首を寄せる
    var r = Math.hypot(tx, ty), k = r > d ? d / r : 1;
    var wx = tx * k, wy = ty * k;
    return { s: s, ex: ex, ey: ey, l2: Math.atan2(wy - ey, wx - ex), wx: wx, wy: wy };
  }

  // ---------- 工程キュー ----------
  var Q = [], cur = null, ct = 0;
  function push(o) { Q.push(o); }
  function drive(to) {
    var from;
    push({
      dur: 0, start: function () { from = S.rx; this.dur = Math.max(0.6, Math.abs(to - from) / 115 + 0.5); S.dir = to > from ? 1 : -1; S.moving = true; },
      run: function (p) { var nx = lerp(from, to, ease(p)); S.wheelA += (nx - S.rx) / 9 * DEG; S.rx = nx; },
      end: function () { S.moving = false; }
    });
  }
  function armTo(target, dur) {
    var from;
    push({ dur: dur, start: function () { from = { x: S.arm.x, y: S.arm.y }; }, run: function (p) { var e = ease(p); S.arm.x = lerp(from.x, target().x, e); S.arm.y = lerp(from.y, target().y, e); } });
  }
  function gripTo(g, dur, end) { var from; push({ dur: dur, start: function () { from = S.grip; }, run: function (p) { S.grip = lerp(from, g, p); }, end: end }); }
  function waitUntil(fn) { push({ dur: Infinity, until: fn }); }
  function later(fn) { push({ dur: 0, start: fn }); }
  function local(wx, boxTop) { return { x: wx - S.rx, y: boxTop - TOOL - (FLOOR + ARM_Y) }; }

  function planCycle() {
    drive(PICK_X);
    waitUntil(function () { return S.supply.state === "rest"; });
    armTo(function () { return local(SUPPLY_X, TABLE_TOP - BOX_H - 34); }, 0.6);
    armTo(function () { return local(SUPPLY_X, TABLE_TOP - BOX_H); }, 0.35);
    gripTo(1, 0.2, function () {
      S.held = true; S.supply.state = "gone"; S.supply.wait = 0.7;
      if (Math.random() < 0.3) say(pick(["よいしょ", "いただきます", "つかみました"]));
    });
    armTo(function () { return local(SUPPLY_X, TABLE_TOP - BOX_H - 34); }, 0.35);
    armTo(function () { return CARRY; }, 0.45);
    drive(PLACE_X);
    waitUntil(function () { return S.cart.state === "ready"; });
    var slot;
    later(function () { slot = SLOTS[S.cart.n]; });
    function slotTop() { return DECK - BOX_H * (slot[1] + 1); }
    armTo(function () { return local(CART_X0 + slot[0], slotTop() - 30); }, 0.6);
    armTo(function () { return local(CART_X0 + slot[0], slotTop()); }, 0.35);
    gripTo(0, 0.2, function () {
      S.held = false;
      var b = boxShape(cartBoxes); set(b, { transform: "translate(" + slot[0] + "," + slotTop() + ")" });
      S.cart.n++; S.count++; document.getElementById("stCount").textContent = S.count;
      if (S.cart.n >= SLOTS.length) { S.cart.state = "leaving"; S.cart.t = 0; say("満載です！出荷〜", 1.8); }
      else if (Math.random() < 0.3) say(pick(["お届け！", "ぴったり！", "まだまだ！", "つぎ行きます"]));
    });
    armTo(function () { return local(CART_X0 + slot[0], slotTop() - 30); }, 0.3);
    armTo(function () { return REST; }, 0.45);
  }

  function dropSupply() { S.supply.state = "falling"; S.supply.y = -40; S.supply.vy = 0; }

  // ---------- 吹き出し ----------
  function say(text, secs, who) { S.bub = { t: secs || 1.6, text: text, who: who || "robot" }; bubText.textContent = text; layoutBubble(); }
  function layoutBubble() {
    var w = 16 + (bubText.getComputedTextLength ? bubText.getComputedTextLength() : S.bub.text.length * 12);
    var h = 24;
    set(bubRect, { x: -w / 2, y: -h, width: w, height: h });
    set(bubText, { x: 0, y: -h / 2 });
    set(bubTail, { d: "M-5 -1 L0 8 L5 -1" });
  }

  // ---------- クリックで喜ぶ ----------
  function pet() {
    if (S.jumpT >= 0) return;
    S.jumpT = 0; S.happyT = 1.4;
    say(pick(["えへへ", "がんばります！", "くすぐったい", "ありがとうございます！", "24時間おまかせ！"]), 1.6);
    for (var i = 0; i < 5; i++) {
      var h = el("text", { "font-size": 12 + Math.random() * 6, fill: pick(["#ff6b8a", "#3EB370", "#0068B7"]), "text-anchor": "middle" }, fx);
      h.textContent = "♥";
      S.hearts.push({ e: h, x: S.rx + (Math.random() - 0.5) * 60, y: FLOOR - 120, vx: (Math.random() - 0.5) * 30, vy: -40 - Math.random() * 40, t: 0 });
    }
    if (window.lxTrack) window.lxTrack("hub/robot/pet", "LexxMoMaをなでた");
  }
  robot.addEventListener("click", pet);
  robot.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pet(); } });

  // ---------- 1フレーム更新 ----------
  function update(dt) {
    // 工程
    if (!cur) { if (!Q.length) planCycle(); cur = Q.shift(); ct = 0; if (cur.start) cur.start.call(cur); }
    if (cur.until) { if (cur.until()) cur = null; }
    else {
      ct += dt;
      var p = cur.dur > 0 ? Math.min(1, ct / cur.dur) : 1;
      if (cur.run) cur.run(p);
      if (p >= 1) { if (cur.end) cur.end(); cur = null; }
    }

    // 払い出しの箱(シューターから落ちてきてバウンド)
    var sp = S.supply;
    if (sp.state === "gone") { sp.wait -= dt; if (sp.wait <= 0) dropSupply(); }
    if (sp.state === "falling") {
      sp.vy += 900 * dt; sp.y += sp.vy * dt;
      var rest = TABLE_TOP - BOX_H;
      if (sp.y >= rest) { sp.y = rest; if (sp.vy > 120) sp.vy = -sp.vy * 0.28; else { sp.vy = 0; sp.state = "rest"; } }
    }

    // 台車の入れ替え
    var c = S.cart;
    if (c.state === "leaving" || c.state === "coming") {
      c.t += dt;
      var q = Math.min(1, c.t / 1.3), ox = c.x;
      if (c.state === "leaving") { c.x = lerp(CART_X0, 700, easeIn(q)); if (q >= 1) { while (cartBoxes.firstChild) cartBoxes.removeChild(cartBoxes.firstChild); c.n = 0; c.state = "coming"; c.t = -0.4; } }
      else if (c.t >= 0) { c.x = lerp(700, CART_X0, easeOut(q)); if (q >= 1) { c.x = CART_X0; c.state = "ready"; } }
      c.wheelA += (c.x - ox) / 8 * DEG;
    }

    // 時計・昼夜
    S.minutes = (S.minutes + dt * 8) % 1440;
    var hr = S.minutes / 60, hInt = Math.floor(hr);
    if (hInt !== S.lastHour) {
      S.lastHour = hInt;
      if (S.bub.t > 0.3) { /* 表示中の吹き出しを優先 */ }
      else if (hInt === 8) say("おはようございます！", 1.8);
      else if (hInt === 18) say("おつかれさまです！", 1.8);
      else if (hInt === 22) say("夜もはたらきます 🌙", 2);
      else if (hInt === 3) say("まだまだ元気です", 1.8);
      else if (hInt === 12) say("お昼もノンストップ", 1.8);
    }
    var nightF = hr >= 19 ? clamp((hr - 19) / 2, 0, 1) : hr < 7 ? clamp((7 - hr) / 2, 0, 1) : 0;
    S.nightF = nightF;
    var present = hr >= 8 && hr < 18;
    S.workerA = clamp(S.workerA + (present ? dt : -dt) * 1.5, 0, 1);
    if (present && S.bub.t <= 0 && Math.random() < dt * 0.05) say(pick(["助かる〜☕", "今日も順調", "ほかの仕事がはかどる"]), 1.8, "worker");

    // まばたき・喜び・ジャンプ
    S.blinkT -= dt; if (S.blinkT < -0.12) S.blinkT = 2 + Math.random() * 3;
    S.happyT = Math.max(0, S.happyT - dt);
    if (S.jumpT >= 0) { S.jumpT += dt; S.bounce = -20 * Math.sin(Math.PI * Math.min(1, S.jumpT / 0.55)); if (S.jumpT >= 0.55) { S.jumpT = -1; S.bounce = 0; } }
    else S.bounce = S.moving ? -Math.abs(Math.sin(S.rx / 9)) * 0.8 : 0;
    S.sipT += dt;

    // ハート
    S.hearts = S.hearts.filter(function (h) {
      h.t += dt; h.x += h.vx * dt; h.y += h.vy * dt; h.vy += 10 * dt;
      set(h.e, { x: h.x, y: h.y, opacity: Math.max(0, 1 - h.t / 1.4) });
      if (h.t > 1.4) { fx.removeChild(h.e); return false; }
      return true;
    });
    S.bub.t -= dt;
  }

  // ---------- 描画 ----------
  function draw() {
    var hr = S.minutes / 60, nf = S.nightF || 0;
    // 太陽・月
    var dayP = (hr - 6) / 12, nightP = ((hr + 6) % 24) / 12;
    set(sun, { cx: lerp(30, 610, dayP), cy: 78 - 58 * Math.sin(Math.PI * clamp(dayP, 0, 1)), opacity: dayP > 0 && dayP < 1 ? 0.9 : 0 });
    var mOn = nightP > 0 && nightP < 1;
    set(moon, { transform: "translate(" + lerp(30, 610, nightP) + "," + (78 - 58 * Math.sin(Math.PI * clamp(nightP, 0, 1))) + ")", opacity: mOn ? 1 : 0 });
    set(stars, { opacity: nf });
    set(night, { opacity: nf * 0.5 });
    set(winGlow, { opacity: nf * 0.6 });
    set(worker, { opacity: S.workerA });
    set(wArm, { transform: "translate(8,-54) rotate(" + (Math.sin(S.sipT * 0.9) > 0.85 ? -115 : -10) + ")" });
    set(steam, { opacity: 0.4 + 0.3 * Math.sin(S.sipT * 3) });

    // 工作機械のランプ
    var running = S.supply.state !== "rest";
    set(mcLamp[0], { opacity: running ? 0.35 : 1 });
    set(mcLamp[1], { opacity: running ? (Math.sin(S.sipT * 10) > 0 ? 1 : 0.3) : 0.3 });
    set(mcGlow, { opacity: running ? 0.6 : 0.3 });
    set(mcNight, { opacity: nf * (running ? 0 : 0.5) });
    set(supplyBox, { transform: "translate(" + SUPPLY_X + "," + S.supply.y + ")", opacity: S.supply.state === "gone" ? 0 : 1 });

    // 台車
    set(cart, { transform: "translate(" + S.cart.x + ",0)" });
    cartWheels.forEach(function (w) { set(w, { transform: "rotate(" + S.cart.wheelA + ")" }); });

    // ロボット本体
    var tr = "translate(" + S.rx.toFixed(2) + "," + (FLOOR + S.bounce).toFixed(2) + ")";
    set(robot, { transform: tr });
    set(glowG, { transform: tr });
    wheels.forEach(function (w) { set(w, { transform: "rotate(" + S.wheelA + ")" }); });
    var look = S.moving ? S.dir * 4 : (S.arm.x < 0 ? -3 : 3);
    var blink = S.blinkT < 0 ? 0.15 : 1;
    set(eyeL, { x: -13 + look, height: 10 * blink, y: -94 + 5 * (1 - blink) });
    set(eyeR, { x: 6 + look, height: 10 * blink, y: -94 + 5 * (1 - blink) });
    var happy = S.happyT > 0;
    set(eyesN, { opacity: happy ? 0 : 1 });
    set(eyesH, { opacity: happy ? 1 : 0, transform: "translate(" + look + ",0)" });
    set(cheeks, { opacity: happy ? 1 : 0 });
    var flash = S.moving ? (Math.sin(S.wheelA / 25) > 0 ? 1 : 0.25) : 1;
    set(beacon, { fill: S.moving ? "#3EB370" : "#5aa8e6", opacity: flash });
    set(beaconGlow, { fill: S.moving ? "#3EB370" : "#5aa8e6", opacity: nf * 0.6 * flash });
    set(eyeGlow, { opacity: nf * 0.25 });
    set(beam, { opacity: nf * (S.moving ? 1 : 0.35), transform: "translate(" + (S.dir * 60) + ",0) scale(" + S.dir + ",1)" });

    // アーム
    var k = ik(S.arm.x, S.arm.y);
    set(link1, { transform: "translate(0," + ARM_Y + ") rotate(" + (k.s * DEG) + ")" });
    set(elbow, { transform: "translate(" + k.ex + "," + (ARM_Y + k.ey) + ")" });
    set(link2, { transform: "translate(" + k.ex + "," + (ARM_Y + k.ey) + ") rotate(" + (k.l2 * DEG) + ")" });
    set(wrist, { transform: "translate(" + k.wx + "," + (ARM_Y + k.wy) + ")" });
    var gap = lerp(BOX_W / 2 + 5, BOX_W / 2 + 1, S.grip);
    set(fingerL, { x: -gap - 4 }); set(fingerR, { x: gap });
    set(heldBox, { opacity: S.held ? 1 : 0 });

    // 吹き出し
    var bt = S.bub.t;
    if (bt > 0) {
      var bx = S.bub.who === "worker" ? 338 : clamp(S.rx, 70, 570);
      var by = S.bub.who === "worker" ? 150 : FLOOR - 190 + S.bounce;
      set(bubble, { opacity: Math.min(1, bt * 4), transform: "translate(" + bx + "," + by + ")" });
    } else set(bubble, { opacity: 0 });

    // 下段の時計
    var m = Math.floor(S.minutes), hh = Math.floor(m / 60), mm = m % 60;
    clockEl.textContent = (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
    clockIcon.textContent = nf > 0.5 ? "🌙" : "🕘";
  }

  var clockEl = document.getElementById("stClock"), clockIcon;
  // 時計アイコンをテキストノードから差し替え可能な span にする
  (function () {
    var p = clockEl.parentNode, span = document.createElement("span");
    span.textContent = "🕘"; p.replaceChild(span, p.firstChild); p.insertBefore(document.createTextNode(" "), clockEl);
    clockIcon = span;
  })();

  // ---------- ループ制御 ----------
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var paused = reduce, visible = true, last = 0;
  var btn = document.getElementById("stToggle");
  function syncBtn() {
    btn.textContent = paused ? "▶" : "⏸";
    btn.setAttribute("aria-label", paused ? "再生" : "一時停止");
    stageEl.classList.toggle("paused", paused);
  }
  btn.addEventListener("click", function () { paused = !paused; syncBtn(); last = 0; });
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; last = 0; }).observe(stageEl);
  document.addEventListener("visibilitychange", function () { last = 0; });

  function frame(dt) { update(dt); draw(); }
  function loop(ts) {
    requestAnimationFrame(loop);
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
    last = ts;
    if (document.hidden || !visible) return;
    if (paused) { if (S.jumpT >= 0 || S.hearts.length || S.bub.t > 0) petOnly(dt); return; }
    frame(dt);
  }
  // 停止中でもクリックの反応(ジャンプ・ハート・吹き出し)だけは動かす
  function petOnly(dt) {
    if (S.jumpT >= 0) { S.jumpT += dt; S.bounce = -20 * Math.sin(Math.PI * Math.min(1, S.jumpT / 0.55)); if (S.jumpT >= 0.55) { S.jumpT = -1; S.bounce = 0; } }
    S.happyT = Math.max(0, S.happyT - dt);
    S.hearts = S.hearts.filter(function (h) {
      h.t += dt; h.x += h.vx * dt; h.y += h.vy * dt;
      set(h.e, { x: h.x, y: h.y, opacity: Math.max(0, 1 - h.t / 1.4) });
      if (h.t > 1.4) { fx.removeChild(h.e); return false; }
      return true;
    });
    S.bub.t -= dt;
    draw();
  }

  syncBtn();
  frame(0);
  requestAnimationFrame(loop);
  // 検証用フック
  window.__lxStage = { S: S, step: function (sec) { for (var t = 0; t < sec; t += 1 / 60) update(1 / 60); draw(); }, pet: pet, say: say };
})();
