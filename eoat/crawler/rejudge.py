# -*- coding: utf-8 -*-
"""imgjudge の文を変えたあと、判定済みの画像を全部もう一度判定する(raw/images/index.json の clip / clip_label を書き直す)。
使い方: python rejudge.py [--out index_new.json](out を付けると index.json は触らず別ファイルに書く)"""
import argparse, json, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import imgjudge
from common import RAW
RAW_IMG = RAW / "images"
ap = argparse.ArgumentParser(); ap.add_argument("--out"); a = ap.parse_args()
idx = json.load(open(RAW_IMG / "index.json", encoding="utf-8"))
t0 = time.time(); n = 0
for k, r in idx.items():
    if "clip" not in r or not r.get("file") or not (RAW_IMG / r["file"]).exists():
        continue
    sc, lb = imgjudge.judge(RAW_IMG / r["file"])
    r["clip"], r["clip_label"] = sc, lb
    n += 1
    if n % 200 == 0:
        print(n, f"{time.time()-t0:.0f}s", flush=True)
out = Path(a.out) if a.out else RAW_IMG / "index.json"
json.dump(idx, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print("done", n, f"{time.time()-t0:.0f}s", out)
