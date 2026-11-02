# -*- coding: utf-8 -*-
"""レビュー用のプレビュー一式を 1 つのフォルダに出す(9 章: Artifact などで非公開 URL にする)。

- 公開側の UI(index.html / app.js / search.js / style.css)とデータ・画像パック・共通の theme.js・ロゴだけをコピーする(2026-11 の社外公開からパスワードなし)
- 詳細用の画像(800px)は入れない(ファイル数が多すぎるため。app.js はサムネイルで代わりに出す)
- --limit N で代表 N 件に絞る(画像パックは必要な分だけ作り直す)
使い方: python preview.py --out <フォルダ> [--limit 300]
"""
import argparse
import base64
import json
import shutil
from pathlib import Path

from common import DATA, REPO, SITE_OUT, jload
import build


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    out = Path(a.out)
    if out.exists():
        shutil.rmtree(out)
    (out / "img" / "thumb").mkdir(parents=True)
    (out / "img" / "detail").mkdir(parents=True)
    (out / "assets").mkdir(parents=True)
    plain = jload(DATA / "cases.json")
    cases = plain["cases"][: a.limit] if a.limit else plain["cases"]
    pidx = {"version": 1, "packs": [], "images": {}, "detail": {}}
    for c in cases:   # パックの位置を作り直すので、前回の値を消す。詳細画像は入れない(サムネイルで代わりに出す)
        for im in c["images"]:
            im["thumb"] = {k: v for k, v in im["thumb"].items() if k in ("w", "h", "bytes")}
            im["detail"] = {k: v for k, v in im["detail"].items() if k in ("w", "h", "bytes")}
            pidx["detail"][im["id"]] = {}
    build.pack_images(cases, pidx, out)
    data = dict(plain, cases=cases, count=len(cases), packs=[p["name"] for p in pidx["packs"]], pack_version=1, preview=True)
    light, detail = build.split_public(data)
    (out / "data.js").write_text("window.EOAT_DATA=" + json.dumps(light, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    (out / "data.detail.json").write_text(json.dumps(detail, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for f in ("app.js", "search.js", "style.css"):
        shutil.copy(SITE_OUT / f, out / f)
    for f in ("theme.js", "lexxpluss-logo.png", "favicon.png"):
        shutil.copy(REPO / "site" / "assets" / f, out / "assets" / f)
    html = (SITE_OUT / "index.html").read_text(encoding="utf-8")
    html = html.replace("../assets/", "assets/").replace('href="../index.html"', 'href="#"')
    html = html.replace("<title>エンドエフェクタ事例データベース | LexxMoMa Tools</title>", "<title>事例DB 全件プレビュー</title>")
    (out / "index.html").write_text(html, encoding="utf-8")
    # バイナリを置けない場所(Artifact など)向けに、パックを base64 のテキストにも出す(app.js は preview:true のとき .txt を読む)
    for f in list(out.glob("img/**/*.bin")):
        f.with_name(f.name + ".txt").write_text(base64.b64encode(f.read_bytes()).decode("ascii"), encoding="ascii")
        f.unlink()
    total = sum(f.stat().st_size for f in out.glob("**/*") if f.is_file())
    print(f"{len(cases)} 件 / {len(pidx['images'])} 枚 → {out}  ({total/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
