# -*- coding: utf-8 -*-
"""抽出(サブエージェント)の仕事割り: 公式サイトの取得が済み、まだ抽出結果の無い会社を N 社ずつの束にして一覧する。
  python extract_batches.py tw [--size 15] [--redo site_blocked]
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATA, RAW, jload


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cc", choices=["tw", "kr"])
    ap.add_argument("--size", type=int, default=15)
    ap.add_argument("--redo", default="", help="この status の会社もやり直す(例: site_blocked)")
    a = ap.parse_args()
    cos = jload(DATA / a.cc / "companies.json", [])
    ready = []
    for c in cos:
        idx = RAW / a.cc / "sites" / c["id"] / "index.json"
        if not idx.exists():
            continue
        ex = jload(DATA / a.cc / "extracted" / f"{c['id']}.json")
        if ex and ex.get("status") != a.redo:
            continue
        w = RAW / a.cc / "wiki" / c["id"] / "article.txt"
        ready.append(f"{c['id']}\t{c['name']}\t{c['legal']}\tsites={RAW / a.cc / 'sites' / c['id']}\twiki={'yes' if w.exists() else 'no'}")
    print(f"ready {len(ready)} / {len(cos)}")
    for i in range(0, len(ready), a.size):
        print(f"--- batch {i // a.size + 1}")
        print("\n".join(ready[i:i + a.size]))


if __name__ == "__main__":
    main()
