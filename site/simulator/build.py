#!/usr/bin/env python3
"""LexxMoMa 動作シミュレーター: HTML をダブルクリック（file://）で開いても 3D とサンプルが動くようにする生成物を作る。

ブラウザは file:// から開いたページでは ES モジュール（import）と fetch を止めるので、それらを使わない形に直す。

  vendor/three.bundle.js   vendor/ の Three.js（ES モジュール）と使うアドオンを、普通のスクリプト 1 本にまとめる（window.THREE）
  meshes/crx20ia_l.js      アームの形（meshes/crx20ia_l/*.stl）を base64 で埋め込む（window.CRX_MESHES）
  samples/embedded.js      サンプルの一覧（samples/index.json）と各 JSON を埋め込む（window.LEXX_SAMPLES）

使い方: site/simulator で `python3 build.py`。STL・サンプル・vendor を変えたら実行して、生成物もコミットする
（CI の「Check built tools are up to date」で、作り直した結果がコミットと同じかを確かめる）。
"""
import base64
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENDOR = HERE / "vendor"
ADDONS = ["addons/controls/OrbitControls.js", "addons/controls/TransformControls.js", "addons/loaders/STLLoader.js"]
MESH_NAMES = ["base", "j1", "j2", "j3", "j4", "j5", "j6"]
NOTE = "/* build.py が生成したファイル。直接直さず、元のファイルを直して `python3 build.py` を実行する */\n"


def write(path: Path, text: str) -> None:
    path.write_bytes(text.encode("utf-8"))  # 改行は LF のまま（どの環境で作っても同じ中身になるように）
    print(f"wrote {path.relative_to(HERE)} ({len(text):,} bytes)")


def bundle_three() -> str:
    src = (VENDOR / "three.module.min.js").read_text(encoding="utf-8")
    if re.search(r"^\s*import[\s{]", src, re.M):
        raise SystemExit("three.module.min.js が別のファイルを import している（版を上げたときは build.py を見直す）")
    m = re.search(r"export\s*\{([^}]*)\}\s*;?\s*$", src)
    if not m:
        raise SystemExit("three.module.min.js の末尾に export{...} が見つからない")
    pairs = []
    for item in m.group(1).split(","):
        item = item.strip()
        if not item:
            continue
        local, _, name = item.partition(" as ")
        pairs.append(f"{(name or local).strip()}:{local.strip()}")
    out = [NOTE, "(function(){\n", src[:m.start()], "\nwindow.THREE={", ",".join(pairs), "};\n})();\n"]
    for rel in ADDONS:
        s = (VENDOR / rel).read_text(encoding="utf-8")
        s, n_imp = re.subn(r"^import\s*\{([^}]*)\}\s*from\s*['\"]three['\"]\s*;", lambda mm: "const {" + mm.group(1) + "} = window.THREE;", s, flags=re.M)
        s, n_exp = re.subn(r"^export\s*\{([^}]*)\}\s*;", lambda mm: "Object.assign(window.THREE, {" + mm.group(1) + "});", s, flags=re.M)
        if n_imp != 1 or n_exp != 1 or re.search(r"^\s*(import|export)\b", s, re.M):
            raise SystemExit(f"{rel}: import / export の形が想定と違う（版を上げたときは build.py を見直す）")
        out += [f"/* ---- {rel} ---- */\n(function(){{\n", s, "\n})();\n"]
    return "".join(out)


def embed_meshes() -> str:
    lines = [NOTE, "/* FANUC CRX-20iA/L の衝突判定用メッシュ（meshes/crx20ia_l/*.stl、Apache-2.0。meshes/README.md） */\n", "window.CRX_MESHES = {\n"]
    for nm in MESH_NAMES:
        b64 = base64.b64encode((HERE / "meshes" / "crx20ia_l" / f"{nm}.stl").read_bytes()).decode("ascii")
        lines.append(f'  "{nm}": "{b64}",\n')
    lines.append("};\n")
    return "".join(lines)


def embed_samples() -> str:
    index = json.loads((HERE / "samples" / "index.json").read_text(encoding="utf-8"))
    files = {}
    for s in index.get("samples", []):
        files[s["file"]] = json.loads((HERE / "samples" / s["file"]).read_text(encoding="utf-8"))
    data = {"index": index, "files": files}
    return NOTE + "window.LEXX_SAMPLES = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"


def main() -> None:
    write(VENDOR / "three.bundle.js", bundle_three())
    write(HERE / "meshes" / "crx20ia_l.js", embed_meshes())
    write(HERE / "samples" / "embedded.js", embed_samples())


if __name__ == "__main__":
    main()
