/* 3D 見積 — ガレージの 3D シーン(three.js)
 * ターンテーブルの上の LexxMoMa(AMR 台車 + 背高キャビネット + 白い協働アーム CRX)に、見積で選んだパーツが取り付く。
 * 機体の外(床)には充電器・工程盤・提出図書と、エンジニア工数を表す作業員(ピットクルー)が並ぶ。
 * 外から: window.lxQuoteScene = {
 *   set(state)            — app.js の sceneState() をそのまま渡す。見た目を合わせる(付いた/外れたパーツはアニメーション)
 *   fx(part, kind)        — 'add' | 'remove' | 'bump' | 'finish'。part は 'moma' 'ee' 'charger' … 'crew-fit' / 'all'
 *   focus(part|null)      — カメラをそのパーツへ寄せる(null で全体)
 *   screenPos(part)       — そのパーツの画面上の位置(ガレージ内の %)。金額の吹き出しに使う
 *   spin(bool)            — ターンテーブルの回転
 * }
 * 準備ができたら document に "lx-quote-scene-ready"、WebGL が使えなければ "lx-quote-scene-failed" を出す。
 * 単位はメートル。床 y=0、機体の前は +x。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas = document.getElementById('scene');
const garage = document.getElementById('garage');

function fail() { document.dispatchEvent(new Event('lx-quote-scene-failed')); }

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch (e) { fail(); throw e; }
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 60);
const HOME = { pos: new THREE.Vector3(4.3, 3.0, 5.0), target: new THREE.Vector3(0, 0.85, 0) };
camera.position.copy(HOME.pos);
const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 2.2;
controls.maxDistance = 9;
controls.maxPolarAngle = Math.PI * 0.48;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- 色と材質
const C = {
  brand: 0x0068b7, accent: 0x3eb370, body: 0x2b3440, white: 0xf4f6f8, gray: 0x9aa6b2, dark: 0x1b222a,
  rubber: 0x15191e, yellow: 0xf2c230, red: 0xd63c3c, orange: 0xf08a24
};
const mat = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.55, metalness: 0.1 }, o));
const M = {
  body: mat(C.body, { roughness: 0.45, metalness: 0.25 }), white: mat(C.white, { roughness: 0.35 }), gray: mat(C.gray),
  dark: mat(C.dark, { roughness: 0.6 }), rubber: mat(C.rubber, { roughness: 0.9 }), brand: mat(C.brand, { roughness: 0.4 }),
  accent: mat(C.accent, { roughness: 0.4 }), yellow: mat(C.yellow), red: mat(C.red, { roughness: 0.35 }), orange: mat(C.orange),
  glass: mat(0x1e3a5a, { roughness: 0.15, metalness: 0.3, emissive: 0x0b4f8a, emissiveIntensity: 0.6 }),
  lens: mat(0x0a0d12, { roughness: 0.1, metalness: 0.6 }),
  ledG: mat(0x3eb370, { emissive: 0x3eb370, emissiveIntensity: 1.2 }),
  ledY: mat(0xf2c230, { emissive: 0xf2c230, emissiveIntensity: 0.4 }),
  ledR: mat(0xd63c3c, { emissive: 0xd63c3c, emissiveIntensity: 0.4 }),
  paper: mat(0xffffff), skin: mat(0xf1c9a5)
};

function box(w, h, d, m, x = 0, y = 0, z = 0, parent) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z); o.castShadow = o.receiveShadow = true;
  if (parent) parent.add(o);
  return o;
}
function cyl(r, h, m, x = 0, y = 0, z = 0, parent, seg = 28, r2) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r2 == null ? r : r2, h, seg), m);
  o.position.set(x, y, z); o.castShadow = o.receiveShadow = true;
  if (parent) parent.add(o);
  return o;
}
function sph(r, m, x = 0, y = 0, z = 0, parent) {
  const o = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), m);
  o.position.set(x, y, z); o.castShadow = true;
  if (parent) parent.add(o);
  return o;
}
function group(parent, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); if (parent) parent.add(g); return g; }

// 文字の札(常にカメラを向く)
function label(text, color = '#0068B7', scale = 0.32) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d');
  g.font = '700 56px "Noto Sans JP", system-ui, sans-serif';
  const w = Math.min(500, g.measureText(text).width + 56);
  g.fillStyle = color; roundRect(g, (512 - w) / 2, 18, w, 92, 46); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 66);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
  sp.material.map.colorSpace = THREE.SRGBColorSpace;
  sp.scale.set(scale * 4, scale, 1); sp.renderOrder = 10;
  return sp;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

// ---------------------------------------------------------------- 光と床
scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 6, 3); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 15 });
scene.add(sun);
const rim = new THREE.DirectionalLight(0x9fd0ff, 0.8); rim.position.set(-4, 3, -3); scene.add(rim);

const floorMat = mat(0xe6ebf0, { roughness: 0.95 });
const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 64), floorMat);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(14, 28, 0x0068b7, 0xb8c4d0);
grid.material.opacity = 0.25; grid.material.transparent = true; grid.position.y = 0.002; scene.add(grid);

// ターンテーブル(マリオカートの車体選択台)
const table = group(scene);
const plate = cyl(1.25, 0.08, mat(0xfafbfc, { roughness: 0.3, metalness: 0.2 }), 0, 0.04, 0, table, 64);
const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.025, 12, 96), mat(C.brand, { emissive: C.brand, emissiveIntensity: 0.6 }));
ring.rotation.x = Math.PI / 2; ring.position.y = 0.08; table.add(ring);
const turn = group(table, 0, 0.08, 0);   // 回る部分(機体はこの上)
for (let i = 0; i < 24; i++) {        // 外周の目盛り(回っているのが分かるように)
  const t = box(0.06, 0.004, 0.14, i % 6 ? M.gray : M.accent, 0, 0.002, 0, turn);
  const a = (i / 24) * Math.PI * 2; t.position.set(Math.cos(a) * 1.08, 0.002, Math.sin(a) * 1.08); t.rotation.y = -a;
}

// ---------------------------------------------------------------- LexxMoMa 本体
const moma = group(turn, 0, 0, 0);
// 台車
const base = group(moma, 0, 0.1, 0);
box(1.0, 0.3, 0.7, M.body, 0, 0.15, 0, base);
box(1.02, 0.05, 0.72, M.dark, 0, 0.0, 0, base);
box(1.005, 0.04, 0.705, M.brand, 0, 0.22, 0, base);           // 青い帯
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  const w = cyl(0.09, 0.07, M.rubber, sx * 0.34, -0.01, sz * 0.36, base, 24); w.rotation.x = Math.PI / 2;
}
for (const sx of [-1, 1]) {                                     // LiDAR(前後の角)
  cyl(0.045, 0.05, M.dark, sx * 0.47, 0.33, sx * 0.3, base, 20);
  cyl(0.04, 0.02, M.ledG, sx * 0.47, 0.36, sx * 0.3, base, 20);
}
box(0.01, 0.06, 0.4, M.ledG, 0.505, 0.1, 0, base);              // 前の表示灯
// 背高キャビネット(後ろ半分)
const cab = group(moma, -0.22, 0.4, 0);
box(0.54, 0.74, 0.62, M.white, 0, 0.37, 0, cab);
box(0.545, 0.05, 0.625, M.brand, 0, 0.62, 0, cab);
box(0.005, 0.3, 0.4, M.gray, 0.272, 0.32, 0, cab);              // 扉
const logo = label('LexxMoMa', '#0068B7', 0.12); logo.position.set(0.28, 0.5, 0); // 札は前から見える位置
cab.add(logo);
// 荷台(前半分)
box(0.44, 0.03, 0.62, M.gray, 0.27, 0.415, 0, moma);
const ARM_BASE = new THREE.Vector3(-0.22, 1.14, 0);

// 協働アーム CRX(J1→J2→J3→手首→フランジ)
const arm = group(moma, ARM_BASE.x, ARM_BASE.y, ARM_BASE.z);
const armMeshes = [];
function am(o) { armMeshes.push(o); return o; }
am(cyl(0.11, 0.06, M.dark, 0, 0.03, 0, arm));
const j1 = group(arm, 0, 0.06, 0);
am(cyl(0.095, 0.16, M.white, 0, 0.08, 0, j1));
const j2 = group(j1, 0, 0.2, 0);
am(cyl(0.085, 0.2, M.white, 0, 0, 0, j2)).rotation.x = Math.PI / 2;
am(cyl(0.087, 0.02, M.accent, 0, 0, 0.1, j2)).rotation.x = Math.PI / 2;
am(cyl(0.06, 0.52, M.white, 0, 0.26, 0.06, j2, 24, 0.055));
const j3 = group(j2, 0, 0.52, 0.06);
am(cyl(0.07, 0.17, M.white, 0, 0, -0.02, j3)).rotation.x = Math.PI / 2;
am(cyl(0.072, 0.02, M.accent, 0, 0, -0.1, j3)).rotation.x = Math.PI / 2;
am(cyl(0.05, 0.44, M.white, 0, 0.22, -0.06, j3, 24, 0.045));
const j5 = group(j3, 0, 0.44, -0.06);
am(sph(0.06, M.white, 0, 0, 0, j5));
const flange = group(j5, 0, 0.07, 0);
am(cyl(0.04, 0.03, M.dark, 0, 0, 0, flange));
const tool = group(flange, 0, 0.015, 0);                         // エンドエフェクタ・カメラの取付点
const crxTag = label('CRX 先方支給', '#5b6b7b', 0.14); crxTag.position.set(0, 0.95, 0); arm.add(crxTag);
const ghostMat = new THREE.MeshStandardMaterial({ color: 0xbfd6ea, transparent: true, opacity: 0.28, depthWrite: false, roughness: 0.4 });
armMeshes.forEach((m) => { m.userData.real = m.material; });
function setCrx(real) {
  armMeshes.forEach((m) => { m.material = real ? m.userData.real : ghostMat; m.castShadow = real; });
  crxTag.visible = !real;
}
const qtyTag = label('× 1 台', '#3EB370', 0.18); qtyTag.position.set(0.3, 1.9, 0); moma.add(qtyTag);

// ---------------------------------------------------------------- パーツ(付け外しでポップする)
const parts = {};   // key → { obj, s, target, anim }
function part(key, obj) { const base = obj.scale.clone(); obj.scale.setScalar(0.0001); obj.visible = false; parts[key] = { obj, s: 0, target: 0, from: 0, t0: 0, base }; return obj; }

// エンドエフェクタ(グリッパー / 吸着)
const eeG = group(tool);
box(0.12, 0.05, 0.07, M.dark, 0, 0.03, 0, eeG);
const fingerL = box(0.02, 0.1, 0.05, M.gray, -0.035, 0.1, 0, eeG);
const fingerR = box(0.02, 0.1, 0.05, M.gray, 0.035, 0.1, 0, eeG);
part('ee-gripper', eeG);
const eeV = group(tool);
cyl(0.03, 0.06, M.dark, 0, 0.03, 0, eeV);
box(0.16, 0.02, 0.16, M.gray, 0, 0.07, 0, eeV);
for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.022, 0.03, M.rubber, sx * 0.055, 0.095, sz * 0.055, eeV, 16, 0.03);
part('ee-vacuum', eeV);
const eeTag = label('SIer 提供', '#c98a00', 0.1); eeTag.position.set(0, 0.25, 0); tool.add(eeTag); eeTag.visible = false;

// カメラ(手首の横)
const cam = group(j5, 0.08, 0.02, 0);
box(0.05, 0.05, 0.12, M.dark, 0.02, 0, 0, cam);
const lens = cyl(0.018, 0.02, M.lens, 0.02, 0.035, 0.03, cam, 16); lens.rotation.x = 0;
cyl(0.018, 0.02, M.lens, 0.02, 0.035, -0.03, cam, 16);
part('camera', cam);

// 操作用タブレット(キャビネット横のスタンド)
const tab = group(cab, 0.05, 0.55, 0.33);
box(0.02, 0.2, 0.02, M.gray, 0, -0.06, 0.02, tab);
const tabBody = group(tab, 0, 0.08, 0.04); tabBody.rotation.x = -0.35;
box(0.26, 0.17, 0.012, M.dark, 0, 0, 0, tabBody);
box(0.24, 0.15, 0.002, M.glass, 0, 0, 0.007, tabBody);
box(0.06, 0.03, 0.002, M.ledG, -0.07, 0.04, 0.009, tabBody);
part('tablet', tab);

// 安全無線非常停止(キャビネット前面のボタン + アンテナ)
const est = group(cab, 0.28, 0.15, -0.18);
box(0.04, 0.12, 0.12, M.yellow, 0, 0, 0, est);
const mush = cyl(0.045, 0.03, M.red, 0.035, 0, 0, est, 24); mush.rotation.z = Math.PI / 2;
cyl(0.006, 0.28, M.dark, -0.27, 0.75, 0.22, est, 8);
sph(0.016, M.ledR, -0.27, 0.9, 0.22, est);
part('estop', est);

// 床に置くもの(回らない)
const yard = group(scene);
// 充電器(後ろに並ぶ)
const chargers = [];
for (let i = 0; i < 6; i++) {
  const g = group(yard, -2.0, 0, -1.1 + i * 0.55);
  box(0.28, 0.5, 0.4, M.white, 0, 0.25, 0, g);
  box(0.285, 0.06, 0.405, M.accent, 0, 0.42, 0, g);
  box(0.005, 0.06, 0.12, M.ledG, 0.143, 0.3, 0, g);
  const cable = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 8, 24, Math.PI * 1.4), M.rubber);
  cable.position.set(0.15, 0.15, 0.12); cable.rotation.y = Math.PI / 2; g.add(cable);
  chargers.push(part('charger' + i, g));
}
// 工程盤(右手)
for (let i = 0; i < 3; i++) {
  const g = group(yard, 0.6 + i * 0.7, 0, -1.9);
  box(0.6, 1.2, 0.35, M.gray, 0, 0.6, 0, g);
  box(0.5, 0.5, 0.005, M.dark, 0, 0.75, 0.178, g);
  for (let k = 0; k < 4; k++) box(0.05, 0.03, 0.01, k % 2 ? M.ledG : M.ledY, -0.15 + k * 0.1, 0.4, 0.18, g);
  cyl(0.03, 0.3, M.dark, 0.2, 1.35, 0, g, 12);
  cyl(0.04, 0.07, M.ledR, 0.2, 1.53, 0, g, 16); cyl(0.04, 0.07, M.ledY, 0.2, 1.6, 0, g, 16); cyl(0.04, 0.07, M.ledG, 0.2, 1.67, 0, g, 16);
  part('panel' + i, g);
}
// 提出図書(奥の机にバインダー)
const desk = group(yard, -0.7, 0, -2.1);
box(0.7, 0.04, 0.45, M.white, 0, 0.55, 0, desk);
for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.03, 0.55, 0.03, M.gray, sx * 0.32, 0.275, sz * 0.2, desk);
part('desk', desk);
for (let i = 0; i < 2; i++) {
  const g = group(desk, -0.15 + i * 0.3, 0.57, 0);
  [M.brand, M.accent, M.yellow].forEach((m, k) => box(0.22, 0.04, 0.3, m, 0, 0.02 + k * 0.045, 0, g));
  box(0.2, 0.002, 0.28, M.paper, 0, 0.16, 0, g);
  part('docs' + i, g);
}
// ピットクルー(エンジニア工数)
const CREW = { fit: { m: M.brand, at: [2.2, -0.8], tool: 'wrench', name: '適合' }, onsite: { m: M.yellow, at: [-1.9, 0.9], tool: 'flag', name: '現地' }, design: { m: M.accent, at: [-1.0, 1.9], tool: 'plan', name: '設計' }, mfg: { m: M.orange, at: [2.4, 0.4], tool: 'box', name: '製造' } };
for (const k of Object.keys(CREW)) {
  const c = CREW[k];
  const g = group(yard, c.at[0], 0, c.at[1]);
  g.lookAt(0, 0, 0); g.scale.setScalar(0.85);
  cyl(0.11, 0.55, mat(0x2b3440), 0, 0.42, 0, g, 16, 0.13);
  sph(0.1, M.skin, 0, 0.82, 0, g);
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), c.m);
  hat.position.y = 0.84; hat.castShadow = true; g.add(hat);
  cyl(0.14, 0.012, c.m, 0, 0.845, 0.03, g, 20);
  if (c.tool === 'wrench') box(0.03, 0.22, 0.03, M.gray, 0.14, 0.5, 0.06, g).rotation.z = 0.5;
  if (c.tool === 'flag') { box(0.012, 0.5, 0.012, M.gray, 0.14, 0.7, 0.05, g); box(0.16, 0.1, 0.005, M.accent, 0.22, 0.88, 0.05, g); }
  if (c.tool === 'plan') box(0.24, 0.005, 0.17, mat(0x5aa8e6), 0, 0.55, 0.17, g).rotation.x = -0.6;
  if (c.tool === 'box') box(0.16, 0.12, 0.12, mat(0xc9a06a), 0, 0.48, 0.15, g);
  const tag = label(c.name, '#1f2933', 0.1); tag.position.set(0, 1.1, 0); g.add(tag);
  part('crew-' + k, g);
}

// ---------------------------------------------------------------- 火花(付けたときのキラキラ)
const sparks = [];
const sparkGeo = new THREE.OctahedronGeometry(0.03);
const sparkMats = [0x0068b7, 0x3eb370, 0xf2c230, 0xffffff].map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true }));
function burst(pos, n = 22) {
  if (REDUCED) return;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(sparkGeo, sparkMats[i % sparkMats.length].clone());
    m.position.copy(pos);
    const a = Math.random() * Math.PI * 2, u = Math.random() * 0.8 + 0.4;
    m.userData = { v: new THREE.Vector3(Math.cos(a) * u, Math.random() * 1.6 + 0.8, Math.sin(a) * u), life: 0.9 + Math.random() * 0.4, age: 0 };
    scene.add(m); sparks.push(m);
  }
}
function confetti() {
  for (let i = 0; i < 6; i++) burst(new THREE.Vector3((Math.random() - 0.5) * 3, 2.2, (Math.random() - 0.5) * 3), 16);
}

// ---------------------------------------------------------------- 状態 → 見た目
let state = null, cheer = 0;
function show(key, on) {
  const p = parts[key]; if (!p) return;
  const t = on ? 1 : 0;
  if (p.target === t) return;
  p.from = p.s; p.target = t; p.t0 = performance.now();
  if (on) p.obj.visible = true;
}
function set(s) {
  const first = !state; state = s;
  setCrx(s.crx);
  qtyTag.visible = s.momaQty > 1;
  if (s.momaQty > 1 && qtyTag.userData.n !== s.momaQty) { qtyTag.material.map.dispose(); qtyTag.material.map = label('× ' + s.momaQty + ' 台', '#3EB370', 0.18).material.map; qtyTag.userData.n = s.momaQty; }
  show('ee-gripper', s.ee === 'gripper'); show('ee-vacuum', s.ee === 'vacuum');
  eeTag.visible = !!s.ee && s.eeSupplied;
  show('camera', s.camera); show('tablet', s.tablet); show('estop', s.estop);
  for (let i = 0; i < 6; i++) show('charger' + i, i < s.charger);
  for (let i = 0; i < 3; i++) show('panel' + i, i < s.panel);
  show('desk', s.docs > 0); show('docs0', s.docs > 0); show('docs1', s.docs > 1);
  for (const k of Object.keys(CREW)) show('crew-' + k, !!s.crew[k]);
  floorMat.color.set(s.dark ? 0x1a232c : 0xe6ebf0);
  grid.material.opacity = s.dark ? 0.35 : 0.25;
  plate.material.color.set(s.dark ? 0x2a3540 : 0xfafbfc);
  if (first) for (const k in parts) { const p = parts[k]; p.s = p.from = p.target; p.obj.visible = p.target > 0; p.obj.scale.copy(p.base).multiplyScalar(Math.max(0.0001, p.s)); }
}

const ANCHOR = {
  moma: () => moma, ee: () => tool, camera: () => cam, tablet: () => tab, estop: () => est,
  charger: () => chargers[Math.max(0, (state ? state.charger : 1) - 1)], panel: () => parts['panel' + Math.max(0, (state ? state.panel : 1) - 1)].obj,
  docs: () => desk, crew: () => yard
};
function anchor(part) {
  if (part && part.indexOf('crew-') === 0) return parts[part] && parts[part].obj;
  return ANCHOR[part] ? ANCHOR[part]() : null;
}
function worldPos(o) { const v = new THREE.Vector3(); o.updateWorldMatrix(true, false); o.getWorldPosition(v); return v; }

function fx(part, kind) {
  if (kind === 'finish') { confetti(); cheer = performance.now(); return; }
  if (part === 'all') { confetti(); cheer = performance.now(); return; }
  const o = anchor(part); if (!o) return;
  if (kind === 'add') { burst(worldPos(o).add(new THREE.Vector3(0, 0.15, 0))); cheer = performance.now(); bounce = performance.now(); }
  if (kind === 'bump') { bounce = performance.now(); burst(worldPos(o), 8); }
}
let bounce = 0;

// カメラの寄り先
let focusTo = null, focusT0 = 0;
function focus(part) {
  const o = part ? anchor(part) : null;
  if (!o || part === 'moma' || part === 'crew') { focusTo = { pos: HOME.pos.clone(), target: HOME.target.clone() }; }
  else {
    const p = worldPos(o);
    const dir = p.clone().setY(0); if (dir.lengthSq() < 0.01) dir.set(1, 0, 1);
    dir.normalize();
    focusTo = { target: p.clone().lerp(HOME.target, 0.35), pos: p.clone().add(dir.multiplyScalar(2.6)).add(new THREE.Vector3(0.9, 1.1, 0.9)) };
  }
  focusT0 = performance.now();
}
function screenPos(part) {
  const o = anchor(part); if (!o) return null;
  const v = worldPos(o).project(camera);
  return { x: Math.max(8, Math.min(92, (v.x + 1) * 50)), y: Math.max(10, Math.min(85, (1 - v.y) * 50)) };
}
let spinning = !REDUCED, idleUntil = 0;
controls.addEventListener('start', () => { idleUntil = Infinity; focusTo = null; });
controls.addEventListener('end', () => { idleUntil = performance.now() + 4000; });

// ---------------------------------------------------------------- ループ
function resize() {
  const w = garage.clientWidth, h = garage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < 520 ? 46 : 36;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(garage);
resize();

const backOut = (k) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
let last = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (spinning && now > idleUntil) turn.rotation.y += dt * 0.35;

  // 付け外しのポップ(付けるときは少し行き過ぎて戻る)
  for (const k in parts) {
    const p = parts[k];
    if (p.s === p.target && p.t0 === 0) continue;
    const kk = REDUCED ? 1 : Math.min(1, (now - p.t0) / (p.target ? 520 : 280));
    p.s = p.target ? p.from + (1 - p.from) * backOut(kk) : p.from * (1 - kk * kk);
    p.obj.scale.copy(p.base).multiplyScalar(Math.max(0.0001, p.s));
    if (kk >= 1) { p.s = p.target; p.t0 = 0; p.obj.visible = p.target > 0; p.obj.scale.copy(p.base).multiplyScalar(Math.max(0.0001, p.s)); }
  }

  // 機体の弾み(パーツを付けたとき)
  const b = (now - bounce) / 1000;
  moma.position.y = b < 0.5 && !REDUCED ? Math.sin(b * Math.PI * 4) * 0.03 * (1 - b * 2) : 0;

  // アームの待機モーション。付けた直後は手を振る
  const t = now / 1000, ch = (now - cheer) / 1000;
  const wave = ch < 1.6 && !REDUCED ? Math.sin(ch * 9) * 0.35 * (1 - ch / 1.6) : 0;
  const idle = REDUCED ? 0 : 1;
  j1.rotation.y = 0.5 + Math.sin(t * 0.5) * 0.35 * idle + wave;
  j2.rotation.x = 0.35 + Math.sin(t * 0.7) * 0.08 * idle;
  j3.rotation.x = -1.6 + Math.sin(t * 0.7 + 1) * 0.12 * idle - wave * 0.6;
  j5.rotation.x = -0.4 + Math.sin(t * 0.9) * 0.1 * idle;
  const grip = 0.035 + (Math.sin(t * 1.4) > 0 ? 0.012 : 0) * idle;
  fingerL.position.x = -grip; fingerR.position.x = grip;

  // 火花
  for (let i = sparks.length - 1; i >= 0; i--) {
    const m = sparks[i], u = m.userData;
    u.age += dt; u.v.y -= 4.5 * dt;
    m.position.addScaledVector(u.v, dt); m.rotation.x += dt * 8; m.rotation.y += dt * 6;
    m.material.opacity = Math.max(0, 1 - u.age / u.life);
    if (u.age >= u.life || m.position.y < 0) { scene.remove(m); m.material.dispose(); sparks.splice(i, 1); }
  }

  // カメラの寄り
  if (focusTo) {
    const k = Math.min(1, (now - focusT0) / 900), e = 1 - Math.pow(1 - k, 3);
    camera.position.lerp(focusTo.pos, e * 0.12);
    controls.target.lerp(focusTo.target, e * 0.12);
    if (k >= 1 && camera.position.distanceTo(focusTo.pos) < 0.02) focusTo = null;
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

window.lxQuoteScene = { set, fx, focus, screenPos, spin: (on) => { spinning = on; idleUntil = 0; } };
document.dispatchEvent(new Event('lx-quote-scene-ready'));
