# -*- coding: utf-8 -*-
"""検索の評価(7-2): queries.yaml → JSON → node eval_queries.cjs(UI と同じ search.js) → data/eval_queries.json。
使い方: python eoat/tests/eval_queries.py [--cases eoat/data/cases.json]"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", default=str(HERE.parent / "data" / "cases.json"))
    a = ap.parse_args()
    q = yaml.safe_load((HERE / "queries.yaml").read_text(encoding="utf-8"))
    tmp = HERE.parent / "data" / "queries.json"
    tmp.write_text(json.dumps(q, ensure_ascii=False), encoding="utf-8")
    out = subprocess.run(["node", str(HERE / "eval_queries.cjs"), str(tmp), a.cases], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(out.stderr)
    res = json.loads(out.stdout)
    (HERE.parent / "data" / "eval_queries.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"queries {res['n']}: precision@12 = {res['precision_at_12']}  zero_result_rate = {res['zero_result_rate']} (厳密一致 0 件 {res['zero_strict']})  trend_accuracy = {res['trend_accuracy']} ({res['trend_n']} 問)")
    worst = sorted(res["rows"], key=lambda r: r["p"])[:12]
    for r in worst:
        print(f"  p={r['p']:.2f} strict={r['strict']:3d} relaxed={r['relaxed']}  {r['q']}  chips={r['chips']} words={r['words']}" + (f"  trend {r['trendTop']} (期待 {r['trend']})" if r['trend'] else ""))


if __name__ == "__main__":
    main()
