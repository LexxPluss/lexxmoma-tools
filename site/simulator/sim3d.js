/* =====================================================================
 * LexxMoMa 動作シミュレーター — 3D ビュー（Three.js）
 *  - 単位は本体と同じ mm、ワールドは z 上（床 = z=0）
 *  - 本体（lexxmoma-2d.html の古典スクリプト）からは window.LexxSim3D 経由で使う。
 *    本体 → 3D: setRobot / syncScene / setGizmoMode などで状態を流し込む
 *    3D → 本体: ギズモ操作時に callbacks.onTcpTarget(T_base_link) を呼ぶ（IK は本体側）
 *  - アームの形状は FANUC 公式の衝突判定用 STL（meshes/crx20ia_l, Apache-2.0）。meshes/crx20ia_l.js に埋め込んだものを使う
 *  - HTML をダブルクリック（file://）で開いても動くよう、ES モジュールは使わない普通のスクリプト。
 *    Three.js は vendor/three.bundle.js（build.py が vendor/ のモジュールから作る）の window.THREE
 * ===================================================================== */
(() => {
const THREE = window.THREE;
const { OrbitControls, TransformControls, STLLoader } = THREE;

const CRX = window.CRX;
const M = CRX.MODEL;
const LABEL_PX = 13; // ラベルの文字の大きさ（画面上の px）

const COLORS = {
  floor: 0xf4f6f8, grid: 0xdfe5ea, gridMajor: 0xc3ccd4,
  body: 0xf6f8f9, bodyEdge: 0x6d7a84, drive: 0x3a4145, bumper: 0x3da9fc,
  link: 0xf2f4f5, ring: 0x43b02a, flange: 0x7f8c8d,
  ghost: 0x2471a3, pathFwd: 0x2471a3, pathRev: 0xe67e22,
  envelope: 0x43b02a,
};

class Sim3D {
  constructor() {
    this.ready = false;
    this.callbacks = {};
    this.meshes = {};
    this.bgKey = ""; this.ghostKey = ""; this.pathKey = "";
    this.follow = true;
    this.hideAux = false; // 3D に浮いている目印（箱の名前ラベル、登録した車体位置の枠）を隠す。床面の物はそのまま
    this.lastBody = null;
    this.gizmoMode = null;
    this.dragging = false;
    this.toolLen = 0;
  }

  /* ---------------- 初期化 ---------------- */
  init(container, callbacks) {
    if (this.ready) return;
    this.callbacks = callbacks || {};
    this.container = container;
    const w = Math.max(200, container.clientWidth), h = Math.max(200, container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0xffffff, 1);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.tabIndex = 0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, w / h, 10, 200000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(4500, -4500, 3200);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0, 600);
    this.orbit.enableDamping = true; this.orbit.dampingFactor = 0.12;
    this.orbit.screenSpacePanning = false;
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.02; // 床の下には回り込まない
    this.orbit.minDistance = 300; this.orbit.maxDistance = 60000;
    this.orbit.addEventListener("start", () => { this.userOrbiting = true; });
    this.orbit.addEventListener("end", () => { this.userOrbiting = false; });

    // 光源
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a949c, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(3000, -2000, 6000);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-4000, 3000, 2500);
    this.scene.add(fill);

    // 床・グリッド（1 m、10 m ごとに濃く）
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200000, 200000), new THREE.MeshBasicMaterial({ color: COLORS.floor }));
    floor.position.z = -2;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(60000, 60, COLORS.gridMajor, COLORS.grid);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -1;
    this.scene.add(grid);
    // 原点マーク
    this.axes = new THREE.AxesHelper(400);
    this.axes.position.z = 1;
    this.scene.add(this.axes);

    // 背景（図形・文字・画像）・ゴースト・パスのグループ
    this.bgGroup = new THREE.Group(); this.scene.add(this.bgGroup);
    this.ghostGroup = new THREE.Group(); this.scene.add(this.ghostGroup);
    this.pathGroup = new THREE.Group(); this.scene.add(this.pathGroup);

    // ロボット
    this.buildBody();
    this.buildArm();
    this.buildShadow();

    // TCP 目標（ギズモで動かす対象）: ワールド座標に置き、base_link 基準へ変換して本体に渡す
    this.tcpTarget = new THREE.Group();
    this.tcpTarget.add(new THREE.AxesHelper(160));
    this.scene.add(this.tcpTarget);
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(0.9);
    this.gizmo.attach(this.tcpTarget);
    this.gizmo.addEventListener("dragging-changed", (e) => {
      this.dragging = e.value;
      this.orbit.enabled = !e.value;
      if (!e.value && this.callbacks.onTcpDragEnd) this.callbacks.onTcpDragEnd();
      if (e.value && this.callbacks.onTcpDragStart) this.callbacks.onTcpDragStart();
    });
    this.gizmo.addEventListener("objectChange", () => {
      if (!this.callbacks.onTcpTarget) return;
      // ワールド → base_link（アーム取付面）基準
      this.armRoot.updateMatrixWorld(true);
      this.tcpTarget.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(this.armRoot.matrixWorld).invert();
      const T = new THREE.Matrix4().multiplyMatrices(inv, this.tcpTarget.matrixWorld);
      const e = T.elements; // 列優先
      const rowMajor = [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14], 0, 0, 0, 1];
      this.callbacks.onTcpTarget(rowMajor);
    });
    this.gizmoHelper = this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo;
    this.scene.add(this.gizmoHelper);
    this.setGizmoMode(null);

    // 可動範囲（J2 中心・半径 1418 mm の球）
    this.envelope = new THREE.Mesh(
      new THREE.SphereGeometry(M.reach, 48, 32),
      new THREE.MeshBasicMaterial({ color: COLORS.envelope, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }),
    );
    const envEdges = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.SphereGeometry(M.reach, 24, 12)),
      new THREE.LineBasicMaterial({ color: COLORS.envelope, transparent: true, opacity: 0.18 }),
    );
    this.envelope.add(envEdges);
    this.envelope.position.set(0, 0, M.L.base);
    this.envelope.visible = false;
    this.armRoot.add(this.envelope);

    this.loadMeshes();
    this.ready = true;
  }

  /* 車体: 750×600 の箱（床から少し浮かせる）、差動二輪の駆動輪（φ180・車体中央の左右）、
   * 前端の青いバンパー、アーム取付面。車輪は回転させない（位置のイメージ用） */
  buildBody() {
    const { bodyLen, bodyWid, mountZ } = this.dims || { bodyLen: 750, bodyWid: 600, mountZ: 750 };
    this.bodyGroup = new THREE.Group();
    this.scene.add(this.bodyGroup);
    const WHEEL_D = 180, WHEEL_W = 50;      // 駆動輪 直径・幅 [mm]
    const CLEAR = 60;                        // 車体下面の床からの高さ（車輪が 60 mm 見える）
    const H = mountZ - CLEAR;
    const box = new THREE.Mesh(new THREE.BoxGeometry(bodyLen, bodyWid, H), new THREE.MeshStandardMaterial({ color: COLORS.body, roughness: 0.85 }));
    box.position.z = CLEAR + H / 2;
    this.bodyGroup.add(box);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: COLORS.bodyEdge }));
    edges.position.z = CLEAR + H / 2;
    this.bodyGroup.add(edges);
    // 駆動輪: 車体中央（x=0）の左右、側面から少し内側。軸は y 方向
    const tire = new THREE.MeshStandardMaterial({ color: 0x2b3135, roughness: 0.9 });
    const hub = new THREE.MeshStandardMaterial({ color: 0x8e9ba5, roughness: 0.4, metalness: 0.3 });
    const tireGeo = new THREE.CylinderGeometry(WHEEL_D / 2, WHEEL_D / 2, WHEEL_W, 32);
    const hubGeo = new THREE.CylinderGeometry(WHEEL_D * 0.22, WHEEL_D * 0.22, WHEEL_W + 4, 20);
    for (const s of [-1, 1]) {
      const y = s * (bodyWid / 2 - WHEEL_W / 2 - 10);
      const t = new THREE.Mesh(tireGeo, tire);          // CylinderGeometry の軸は y → そのまま左右方向
      t.position.set(0, y, WHEEL_D / 2);
      this.bodyGroup.add(t);
      const h = new THREE.Mesh(hubGeo, hub);
      h.position.copy(t.position);
      this.bodyGroup.add(h);
      // 車輪の外形線（側面から輪郭が分かるように）
      const ring = new THREE.LineSegments(new THREE.EdgesGeometry(tireGeo, 30), new THREE.LineBasicMaterial({ color: 0x6d7a84 }));
      ring.position.copy(t.position);
      this.bodyGroup.add(ring);
    }
    // 駆動輪の車軸線（床面に薄く。左右の車輪を結ぶ）
    const axle = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -bodyWid / 2 - 60, 2), new THREE.Vector3(0, bodyWid / 2 + 60, 2)]),
      new THREE.LineDashedMaterial({ color: 0x6d7a84, dashSize: 30, gapSize: 20, transparent: true, opacity: 0.6 }),
    );
    axle.computeLineDistances();
    this.bodyGroup.add(axle);
    // 前後の目印: 前端は青いバンパー＋「FRONT」、後端は赤いテールランプ＋「REAR」、天面に前向きの大きな矢印
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(30, bodyWid * 0.7, 40), new THREE.MeshBasicMaterial({ color: COLORS.bumper }));
    bumper.position.set(bodyLen / 2 - 10, 0, mountZ - 30);
    this.bodyGroup.add(bumper);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(30, bodyWid * 0.7, 40), new THREE.MeshBasicMaterial({ color: 0xe74c3c }));
    tail.position.set(-bodyLen / 2 + 10, 0, mountZ - 30);
    this.bodyGroup.add(tail);
    // 前面・後面の文字（面に貼る板）
    const faceLabel = (text, color) => {
      const cv = document.createElement("canvas"); cv.width = 512; cv.height = 160;
      const g = cv.getContext("2d");
      g.fillStyle = color; g.font = "bold 120px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(text, 256, 84);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      return new THREE.Mesh(new THREE.PlaneGeometry(bodyWid * 0.6, bodyWid * 0.6 * 160 / 512), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    };
    const front = faceLabel("FRONT", "#3da9fc");
    front.position.set(bodyLen / 2 + 1, 0, (CLEAR + mountZ) / 2 + 60);
    front.rotation.set(Math.PI / 2, Math.PI / 2, 0); // 前面（+x を向く面）に立てる
    this.bodyGroup.add(front);
    const rear = faceLabel("REAR", "#e74c3c");
    rear.position.set(-bodyLen / 2 - 1, 0, (CLEAR + mountZ) / 2 + 60);
    rear.rotation.set(Math.PI / 2, -Math.PI / 2, 0); // 後面（-x を向く面）
    this.bodyGroup.add(rear);
    // 天面の矢印（前向き）: アーム基部（半径約 100 mm）にかからないよう、前端寄りに置く
    const arrow = new THREE.Shape();
    const tipX = bodyLen / 2 - 50, tailX = tipX - 150, aw = bodyWid * 0.18, shaft = aw * 0.4;
    arrow.moveTo(tipX, 0); arrow.lineTo(tipX - 80, aw); arrow.lineTo(tipX - 80, shaft); arrow.lineTo(tailX, shaft);
    arrow.lineTo(tailX, -shaft); arrow.lineTo(tipX - 80, -shaft); arrow.lineTo(tipX - 80, -aw); arrow.closePath();
    const arrowMesh = new THREE.Mesh(new THREE.ShapeGeometry(arrow), new THREE.MeshBasicMaterial({ color: COLORS.bumper, transparent: true, opacity: 0.9 }));
    arrowMesh.position.set(0, 0, mountZ + 1.5);
    this.bodyGroup.add(arrowMesh);
    // アーム取付面（base_link 原点）
    this.armRoot = new THREE.Group();
    this.armRoot.position.set(0, 0, mountZ);
    this.armRoot.rotation.z = (this.dims && this.dims.mountYaw) || 0; // 取付向き（J1 = 0° が向く方向）
    this.bodyGroup.add(this.armRoot);
  }

  /* アーム: 関節ごとの Group の入れ子。各 Group の回転軸は公式 xacro の axis。 */
  buildArm() {
    this.joints = [];
    let parent = this.armRoot;
    for (let i = 0; i < 6; i++) {
      const j = M.joints[i];
      const g = new THREE.Group();
      g.position.set(j.origin[0], j.origin[1], j.origin[2]);
      g.userData.axis = new THREE.Vector3(j.axis[0], j.axis[1], j.axis[2]);
      parent.add(g);
      this.joints.push(g);
      parent = g;
    }
    // フランジ（J6 から +x 160）→ FANUC フランジ（z がツール方向）
    this.flange = new THREE.Group();
    this.flange.position.set(M.flange[0], M.flange[1], M.flange[2]);
    this.joints[5].add(this.flange);
    this.fanucFlange = new THREE.Group();
    const R = M.fanucFlangeRot;
    this.fanucFlange.setRotationFromMatrix(new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1));
    this.flange.add(this.fanucFlange);
    // ツール（長さはあとから変える）: フランジ面の円盤＋ツール方向の棒＋先端
    this.toolGroup = new THREE.Group();
    this.fanucFlange.add(this.toolGroup);
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(55, 55, 10, 32), new THREE.MeshStandardMaterial({ color: COLORS.flange }));
    disk.rotation.x = Math.PI / 2; disk.position.z = 5;
    this.toolGroup.add(disk);
    this.toolBar = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 1, 16), new THREE.MeshStandardMaterial({ color: 0x5d6d7e }));
    this.toolBar.rotation.x = Math.PI / 2;
    this.toolGroup.add(this.toolBar);
    this.tcpMarker = new THREE.Mesh(new THREE.SphereGeometry(22, 16, 12), new THREE.MeshBasicMaterial({ color: 0xd6336c }));
    this.toolGroup.add(this.tcpMarker);
    this.tcpAxes = new THREE.AxesHelper(120);
    this.toolGroup.add(this.tcpAxes);
    this.setToolLen(0);
  }

  setToolLen(len) {
    this.toolLen = len || 0;
    const L = Math.max(1, this.toolLen);
    this.toolBar.scale.set(1, L, 1);
    this.toolBar.position.z = L / 2 + 10;
    this.toolBar.visible = this.toolLen > 1;
    this.tcpMarker.position.z = this.toolLen;
    this.tcpAxes.position.z = this.toolLen;
  }

  /* 影のロボット: 一覧やブロックにマウスを乗せたとき、その姿勢を半透明のオレンジで重ねる（2D の影と同じ役目）。
   * 車体は箱だけ、アームは本体と同じメッシュを半透明で使う（メッシュは loadMeshes で足す） */
  buildShadow() {
    if (this.shadow) this.scene.remove(this.shadow);
    const { bodyLen, bodyWid, mountZ } = this.dims || { bodyLen: 750, bodyWid: 600, mountZ: 750 };
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0xe67e22, transparent: true, opacity: 0.35, depthWrite: false });
    this.shadow = new THREE.Group();
    this.shadow.visible = false;
    this.scene.add(this.shadow);
    this.shadowBody = new THREE.Group(); // 車体の箱（車体を動かさない影では隠す）
    const box = new THREE.Mesh(new THREE.BoxGeometry(bodyLen, bodyWid, mountZ - 60), this.shadowMat);
    box.position.z = 60 + (mountZ - 60) / 2;
    this.shadowBody.add(box);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: 0xe67e22, transparent: true, opacity: 0.9 }));
    edges.position.copy(box.position);
    this.shadowBody.add(edges);
    this.shadow.add(this.shadowBody);
    const root = new THREE.Group();
    root.position.set(0, 0, mountZ);
    root.rotation.z = (this.dims && this.dims.mountYaw) || 0;
    this.shadow.add(root);
    this.shadowJoints = [];
    let parent = root;
    for (let i = 0; i < 6; i++) {
      const j = M.joints[i];
      const g = new THREE.Group();
      g.position.set(j.origin[0], j.origin[1], j.origin[2]);
      g.userData.axis = new THREE.Vector3(j.axis[0], j.axis[1], j.axis[2]);
      parent.add(g);
      this.shadowJoints.push(g);
      parent = g;
    }
    this.shadowParents = [root, ...this.shadowJoints];
  }
  /* 影の姿勢。pose = { body: {x, y, th}, q: [6], showBody } か null（隠す） */
  setShadow(pose) {
    if (!this.ready || !this.shadow) return;
    if (!pose) { this.shadow.visible = false; return; }
    this.shadow.visible = true;
    this.shadow.position.set(pose.body.x, pose.body.y, 0);
    this.shadow.rotation.set(0, 0, pose.body.th);
    this.shadowBody.visible = !!pose.showBody;
    for (let i = 0; i < 6; i++) this.shadowJoints[i].setRotationFromAxisAngle(this.shadowJoints[i].userData.axis, pose.q[i] || 0);
  }

  loadMeshes() {
    const loader = new STLLoader();
    const names = ["base", "j1", "j2", "j3", "j4", "j5", "j6"];
    const parents = [this.armRoot, ...this.joints];
    const ringLinks = new Set(["j1", "j3", "j5"]); // 緑のアクセント（実機の緑リング位置に近いリンク）
    // 埋め込んだ STL（window.CRX_MESHES、base64）があればそれを使う。無ければファイルを読む（サーバー経由のときだけ動く）
    const loadStl = (nm, onLoad, onError) => {
      const b64 = window.CRX_MESHES && window.CRX_MESHES[nm];
      if (!b64) { loader.load(`meshes/crx20ia_l/${nm}.stl`, onLoad, undefined, onError); return; }
      try {
        const bin = atob(b64), buf = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k);
        onLoad(loader.parse(buf.buffer));
      } catch (e) { onError(e); }
    };
    names.forEach((nm, i) => {
      loadStl(nm, (geo) => {
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({
          color: ringLinks.has(nm) ? 0xdfeeda : COLORS.link, roughness: 0.6, metalness: 0.05, flatShading: true,
        });
        const mesh = new THREE.Mesh(geo, mat);
        const o = M.meshOffsets[nm];
        mesh.position.set(o[0], o[1], o[2]);
        parents[i].add(mesh);
        // 影のロボットにも同じ形を半透明で付ける
        if (this.shadowParents) {
          const sm = new THREE.Mesh(geo, this.shadowMat);
          sm.position.copy(mesh.position);
          this.shadowParents[i].add(sm);
        }
        // 輪郭線（低ポリの面が読みやすいように）
        const ed = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: 0x8a969e, transparent: true, opacity: 0.6 }));
        ed.position.copy(mesh.position);
        parents[i].add(ed);
        this.meshes[nm] = mesh;
      }, () => {
        // 読めない時は関節位置を結ぶ簡易形状で代用
        if (nm === "base") return;
        const idx = i - 1;
        const next = M.joints[idx + 1] ? M.joints[idx + 1].origin : M.flange;
        const len = Math.hypot(next[0], next[1], next[2]);
        if (len < 1) return;
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(55, 55, len, 16), new THREE.MeshStandardMaterial({ color: COLORS.link }));
        const dir = new THREE.Vector3(next[0], next[1], next[2]).normalize();
        cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        cyl.position.copy(dir.clone().multiplyScalar(len / 2));
        parents[i].add(cyl);
      });
    });
  }

  /* ---------------- 状態の反映 ---------------- */
  /* body: {x,y,th} [mm, rad]、q: 6 関節 [rad] */
  setRobot(body, q, toolLen) {
    if (!this.ready) return;
    if (toolLen !== undefined && toolLen !== this.toolLen) this.setToolLen(toolLen);
    // カメラ追従: 車体が動いた分だけカメラと注視点を平行移動
    if (this.follow && this.lastBody && !this.userOrbiting) {
      const dx = body.x - this.lastBody.x, dy = body.y - this.lastBody.y;
      if (dx || dy) { this.camera.position.x += dx; this.camera.position.y += dy; this.orbit.target.x += dx; this.orbit.target.y += dy; }
    }
    this.lastBody = { x: body.x, y: body.y };
    this.bodyGroup.position.set(body.x, body.y, 0);
    this.bodyGroup.rotation.set(0, 0, body.th);
    for (let i = 0; i < 6; i++) this.joints[i].setRotationFromAxisAngle(this.joints[i].userData.axis, q[i] || 0);
    // ギズモの目標を現在の TCP に合わせる（ドラッグ中は動かさない）
    if (!this.dragging) {
      this.scene.updateMatrixWorld(true);
      const T = new THREE.Matrix4().copy(this.toolGroup.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(0, 0, this.toolLen));
      T.decompose(this.tcpTarget.position, this.tcpTarget.quaternion, this.tcpTarget.scale);
      this.tcpTarget.scale.set(1, 1, 1);
    }
  }

  /* 車体寸法・取付高さ（本体側の設定値） */
  setDims(d) {
    this.dims = d;
    if (!this.ready) return;
    // 作り直し（寸法変更は稀なので簡単に）
    const q = this.joints.map(g => 0);
    this.scene.remove(this.bodyGroup);
    this.buildBody(); this.buildArm(); this.buildShadow(); this.loadMeshes();
    this.armRoot.add(this.envelope);
  }

  /* 背景（四角・直線・文字・画像）、登録済み車体位置（ゴースト）、予定パスを同期。
   * 変化の検出はキー文字列の比較で行う（本体側のあちこちから呼ばれるため）。 */
  syncScene({ objects, selectedId, targetNums, bodyPoses, paths, dims }) {
    if (!this.ready) return;
    // 変化検出のキー。下絵の dataURL は長いので長さだけ見る
    const bgKey = JSON.stringify([objects.map(o => o.type === "image" ? Object.assign({}, o, { src: o.src ? o.src.length : 0 }) : o), selectedId, targetNums]);
    if (bgKey !== this.bgKey) { this.bgKey = bgKey; this.rebuildBackground(objects, selectedId, targetNums || {}); }
    const gKey = JSON.stringify(bodyPoses.map(p => [p.x, p.y, p.th, p.name]));
    if (gKey !== this.ghostKey) { this.ghostKey = gKey; this.rebuildGhosts(bodyPoses, dims); }
    const pKey = JSON.stringify(paths);
    if (pKey !== this.pathKey) { this.pathKey = pKey; this.rebuildPaths(paths); }
  }

  clearGroup(g) {
    while (g.children.length) {
      const c = g.children.pop();
      c.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    }
  }

  /* objects: 本体の state.objects（box / line / text）。selectedId の物は青い縁取りで強調 */
  rebuildBackground(objects, selectedId, targetNums) {
    this.clearGroup(this.bgGroup);
    this.pickables = [];
    this.texCache = this.texCache || new Map(); // 下絵の src → テクスチャ
    const SEL = 0x0a6ebd;
    const objs = (objects || []).filter(o => o.visible !== false);
    // 箱: 高さ h [mm] があれば箱（設備・机など）、無ければ床に薄い塗り＋枠（区画）。z0 は底面の高さ、yaw は向き
    for (const o of objs) {
      if (o.type !== "box") continue;
      const w = o.w, d = o.d, hz = Math.max(0, o.h || 0), z0 = Math.max(0, o.z0 || 0);
      if (w < 1 || d < 1) continue;
      const col = new THREE.Color(o.color);
      const sel = o.id === selectedId;
      let m, ed;
      if (hz > 0) {
        const geo = new THREE.BoxGeometry(w, d, hz);
        m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: sel ? 0.6 : 0.45, roughness: 0.9, depthWrite: false, emissive: sel ? new THREE.Color(SEL) : new THREE.Color(0), emissiveIntensity: 0.25 }));
        m.position.set(o.x, o.y, z0 + hz / 2);
        ed = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: sel ? SEL : col }));
      } else {
        const geo = new THREE.PlaneGeometry(w, d);
        m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: sel ? SEL : col, transparent: true, opacity: sel ? 0.25 : 0.12, depthWrite: false }));
        m.position.set(o.x, o.y, 2);
        ed = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: sel ? SEL : col }));
      }
      m.rotation.z = o.yaw || 0; ed.rotation.z = o.yaw || 0;
      ed.position.copy(m.position);
      m.userData.id = o.id;
      this.bgGroup.add(m, ed);
      this.pickables.push(m);
      // 名前ラベル（箱の上）。目印扱い
      if (o.name) { const lb = this.makeLabel(o.name, o.x, o.y, z0 + hz + 120, col.getStyle()); lb.userData.aux = true; this.bgGroup.add(lb); }
    }
    // 直線（選択中は太く見せるため床に細長い板も置く）
    for (const o of objs) {
      if (o.type !== "line") continue;
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(o.x1, o.y1, 3), new THREE.Vector3(o.x2, o.y2, 3)]);
      const ln = new THREE.Line(g, new THREE.LineBasicMaterial({ color: new THREE.Color(o.id === selectedId ? SEL : o.color) }));
      this.bgGroup.add(ln);
      // クリック用の当たり板
      const len = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
      if (len > 1) {
        const pm = new THREE.Mesh(new THREE.PlaneGeometry(len, 80), new THREE.MeshBasicMaterial({ color: SEL, transparent: true, opacity: o.id === selectedId ? 0.35 : 0, depthWrite: false }));
        pm.position.set((o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2, 2.5);
        pm.rotation.z = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
        pm.userData.id = o.id;
        this.bgGroup.add(pm); this.pickables.push(pm);
      }
    }
    // 文字: Canvas に描いて床に貼る
    for (const T of objs) {
      if (T.type !== "text") continue;
      const chars = Array.from(T.text || "");
      if (!chars.length) continue;
      const fontPx = 64;
      const cv = document.createElement("canvas");
      const g2 = cv.getContext("2d");
      g2.font = `${fontPx}px sans-serif`;
      let wPx, hPx;
      if (T.vertical) { wPx = fontPx * 1.1; hPx = fontPx * chars.length; }
      else { wPx = g2.measureText(T.text).width + 8; hPx = fontPx * 1.2; }
      cv.width = Math.ceil(wPx); cv.height = Math.ceil(hPx);
      g2.font = `${fontPx}px sans-serif`; g2.fillStyle = T.color; g2.textAlign = "center"; g2.textBaseline = "middle";
      if (T.vertical) chars.forEach((ch, i) => g2.fillText(ch, cv.width / 2, fontPx * (i + 0.5)));
      else g2.fillText(T.text, cv.width / 2, cv.height / 2);
      const tex = new THREE.CanvasTexture(cv);
      tex.anisotropy = 4;
      const scale = T.size / fontPx; // 文字高さ [mm] / フォント px
      const m = new THREE.Mesh(new THREE.PlaneGeometry(cv.width * scale, cv.height * scale),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      m.position.set(T.x, T.y, 4);
      m.userData.id = T.id;
      this.bgGroup.add(m);
      this.pickables.push(m);
      if (T.id === selectedId) {
        const ed = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: SEL }));
        ed.position.copy(m.position); ed.position.z = 5;
        this.bgGroup.add(ed);
      }
    }
    // 手先の目標: 赤い球（設備や車体に隠れても見えるよう手前に描く）、ツールの向きの矢印、床からの点線、「回る順番. 名前」
    for (const o of objs) {
      if (o.type !== "target") continue;
      const col = new THREE.Color(o.id === selectedId ? SEL : (o.color || "#c0392b"));
      const z = o.z || 0;
      const top = (mat) => { mat.depthTest = false; return mat; };
      const ball = new THREE.Mesh(new THREE.SphereGeometry(30, 16, 12), top(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85 })));
      ball.position.set(o.x, o.y, z); ball.renderOrder = 10;
      ball.userData.id = o.id;
      this.bgGroup.add(ball); this.pickables.push(ball);
      // ツールの向き（ツール座標の +z = 手先が向かう方向）。W/P/R は床の座標（R = Rz(r)·Ry(p)·Rx(w)）
      const d2r = Math.PI / 180;
      const dir = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler((o.w || 0) * d2r, (o.p || 0) * d2r, (o.r || 0) * d2r, "ZYX"));
      const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(o.x, o.y, z).addScaledVector(dir, -250), 250, col.getHex(), 70, 40);
      arrow.traverse(c => { if (c.material) top(c.material); c.renderOrder = 10; });
      this.bgGroup.add(arrow);
      const pole = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(o.x, o.y, 0), new THREE.Vector3(o.x, o.y, z)]),
        new THREE.LineDashedMaterial({ color: col, dashSize: 40, gapSize: 30 }));
      pole.computeLineDistances();
      this.bgGroup.add(pole);
      const no = targetNums && targetNums[o.id];
      const lb = this.makeLabel(`${no ? no + ". " : ""}${o.name || ""}`, o.x, o.y, z + 120, col.getStyle());
      lb.userData.aux = true; this.bgGroup.add(lb);
    }
    this.applyAuxVisibility();
    // 下絵: 床に貼る（何枚でも。配列の順に少しずつ浮かせて重なり順を保つ）
    let zi = 0;
    for (const o of objs) {
      if (o.type !== "image" || !o.src) continue;
      const z = 1 + 0.2 * (zi++);
      let tex = this.texCache.get(o.src);
      const place = (t) => {
        if (!t.image || !t.image.naturalWidth) return;
        const wMm = t.image.naturalWidth * 1000 / o.pxPerM, hMm = t.image.naturalHeight * 1000 / o.pxPerM;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(wMm, hMm), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: o.opacity, depthWrite: false }));
        m.position.set(o.x, o.y, z);
        this.bgGroup.add(m);
        if (o.id === selectedId) {
          const ed = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: SEL }));
          ed.position.copy(m.position); ed.position.z = z + 0.1;
          this.bgGroup.add(ed);
        }
      };
      if (tex) place(tex);
      else {
        tex = new THREE.TextureLoader().load(o.src, () => { this.bgKey = ""; }); // 読めたら次のフレームで作り直す
        tex.colorSpace = THREE.SRGBColorSpace;
        this.texCache.set(o.src, tex);
      }
    }
  }

  rebuildGhosts(poses, dims) {
    this.clearGroup(this.ghostGroup);
    const { bodyLen, bodyWid, mountZ } = dims;
    const mat = new THREE.LineBasicMaterial({ color: COLORS.ghost, transparent: true, opacity: 0.55 });
    const boxGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(bodyLen, bodyWid, mountZ));
    // 向きだけ違う同じ場所の位置は、名前を 1 つのラベルにまとめる（重ねて書くと読めないため）
    const labelOf = new Map();
    for (const p of poses) {
      const near = [...labelOf.keys()].find(q => Math.hypot(q.x - p.x, q.y - p.y) < 80);
      if (near) labelOf.set(near, labelOf.get(near) + "・" + p.name); else labelOf.set(p, p.name);
    }
    for (const p of poses) {
      const g = new THREE.Group();
      g.position.set(p.x, p.y, 0); g.rotation.z = p.th;
      const e = new THREE.LineSegments(boxGeo, mat); e.position.z = mountZ / 2; g.add(e);
      // 前方向の矢印（床面）
      const tri = new THREE.Shape();
      tri.moveTo(bodyLen * 0.42, 0); tri.lineTo(bodyLen * 0.10, -bodyWid * 0.28); tri.lineTo(bodyLen * 0.10, bodyWid * 0.28); tri.closePath();
      const tm = new THREE.Mesh(new THREE.ShapeGeometry(tri), new THREE.MeshBasicMaterial({ color: COLORS.ghost, transparent: true, opacity: 0.3, depthWrite: false }));
      tm.position.z = 5; g.add(tm);
      // 名前ラベル（ビルボード）
      if (labelOf.has(p)) {
        const lb = this.makeLabel(labelOf.get(p), 0, 0, mountZ + 120);
        lb.position.set(p.x, p.y, mountZ + 120); // 車体の向きによらず真上に出す
        this.ghostGroup.add(lb);
      }
      this.ghostGroup.add(g);
    }
  }

  /* 画面上で一定の大きさ（文字 LABEL_PX）に見えるビルボード文字。近づいても大きくならない。
   * 大きさは render() の updateLabelScale で画面の高さに合わせる */
  makeLabel(text, x, y, z, color) {
    const cv = document.createElement("canvas");
    const g2 = cv.getContext("2d");
    // 画面の画素と 1 対 1 で描く（縮めて貼ると文字がにじんで薄く見えるため）
    const dpr = Math.min(3, window.devicePixelRatio || 1), fs = LABEL_PX * dpr, pad = 4 * dpr;
    const font = `bold ${fs}px sans-serif`;
    g2.font = font;
    cv.width = Math.ceil(g2.measureText(text).width + pad * 2); cv.height = Math.ceil(fs * 1.5);
    g2.font = font; g2.textBaseline = "middle"; g2.lineJoin = "round";
    g2.strokeStyle = "rgba(255,255,255,0.92)"; g2.lineWidth = 3 * dpr; g2.strokeText(text, pad, cv.height / 2); // 白い縁取りで、何の上でも読める
    g2.fillStyle = color || "rgba(24,92,140,1)";
    g2.fillText(text, pad, cv.height / 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; // 色が白っぽく飛ばないように
    tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: false, toneMapped: false }));
    sp.userData.labelPx = [cv.width / dpr, cv.height / dpr];
    sp.renderOrder = 10;
    this.scaleLabel(sp);
    sp.position.set(x, y, z);
    return sp;
  }
  /* sizeAttenuation:false のスプライトは scale × (画面の高さ ÷ 2tan(fov/2)) [px] に見える */
  scaleLabel(sp) {
    const h = Math.max(200, this.container ? this.container.clientHeight : 600);
    const k = 2 * Math.tan(this.camera.fov * Math.PI / 360) / h;
    sp.scale.set(sp.userData.labelPx[0] * k, sp.userData.labelPx[1] * k, 1);
  }
  updateLabelScale() {
    const h = this.container ? this.container.clientHeight : 0;
    if (h === this.labelH) return;
    this.labelH = h;
    this.scene.traverse(o => { if (o.isSprite && o.userData.labelPx) this.scaleLabel(o); });
  }

  /* paths: [{ pts: [[x,y],...], reverse: bool }] */
  rebuildPaths(paths) {
    this.clearGroup(this.pathGroup);
    for (const P of paths || []) {
      if (!P.pts || P.pts.length < 2) continue;
      const g = new THREE.BufferGeometry().setFromPoints(P.pts.map(p => new THREE.Vector3(p[0], p[1], 6)));
      const line = new THREE.Line(g, new THREE.LineDashedMaterial({ color: P.reverse ? COLORS.pathRev : COLORS.pathFwd, dashSize: 90, gapSize: 70, transparent: true, opacity: 0.8 }));
      line.computeLineDistances();
      this.pathGroup.add(line);
    }
  }

  /* ---------------- 操作 ---------------- */
  /* 画面座標のクリック位置にあるオブジェクトの id（無ければ null） */
  pick(clientX, clientY) {
    if (!this.ready || !this.pickables || !this.pickables.length) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const hits = rc.intersectObjects(this.pickables, false);
    return hits.length ? hits[0].object.userData.id : null;
  }
  setGizmoMode(mode) { // 'translate' | 'rotate' | null
    this.gizmoMode = mode;
    if (!this.gizmo) return;
    if (mode) { this.gizmo.setMode(mode); this.gizmo.enabled = true; this.gizmoHelper.visible = true; }
    else { this.gizmo.enabled = false; this.gizmoHelper.visible = false; }
    this.tcpTarget.visible = !!mode;
  }
  setGizmoSpace(space) { if (this.gizmo) this.gizmo.setSpace(space); } // 'world' | 'local'
  setEnvelope(on) { if (this.envelope) this.envelope.visible = !!on; }
  /* 3D に浮いている目印（箱の名前ラベル、登録した車体位置の枠と名前）を隠す。床面の区画・文字・直線・予定パスはそのまま */
  setHideAux(on) { this.hideAux = !!on; this.applyAuxVisibility(); }
  applyAuxVisibility() {
    if (!this.ready) return;
    const show = !this.hideAux;
    this.ghostGroup.visible = show;
    for (const c of this.bgGroup.children) if (c.userData.aux) c.visible = show;
  }
  setFollow(on) { this.follow = !!on; }

  /* 視点プリセット。注視点は車体（取付面の少し上） */
  setView(preset) {
    if (!this.ready) return;
    const b = this.bodyGroup.position;
    const c = new THREE.Vector3(b.x, b.y, 700);
    const th = this.bodyGroup.rotation.z;
    const d = 4200;
    const rot = (x, y) => [x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th)];
    let p;
    if (preset === "front") { const [x, y] = rot(d, 0); p = new THREE.Vector3(c.x + x, c.y + y, 1200); }
    else if (preset === "side") { const [x, y] = rot(0, -d); p = new THREE.Vector3(c.x + x, c.y + y, 1200); }
    else if (preset === "top") { p = new THREE.Vector3(c.x, c.y - 1, d * 1.3); }
    else { const [x, y] = rot(d * 0.7, -d * 0.7); p = new THREE.Vector3(c.x + x, c.y + y, 3000); } // iso
    this.camera.position.copy(p);
    this.orbit.target.copy(c);
    this.orbit.update();
  }

  resize() {
    if (!this.ready) return;
    this.labelH = -1; // ラベルの大きさを画面の高さに合わせ直す
    const w = Math.max(200, this.container.clientWidth), h = Math.max(200, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    if (!this.ready) return;
    this.orbit.update();
    this.updateLabelScale();
    this.renderer.render(this.scene, this.camera);
  }

  get canvas() { return this.renderer ? this.renderer.domElement : null; }
}

window.LexxSim3D = new Sim3D();
window.dispatchEvent(new Event("lexxsim3d-ready"));
})();
