# -*- coding: utf-8 -*-
"""取得元ごとの採用率(ループ 10): 候補 → 取得 → 抽出 → 規則で分類 → 画像あり → レビューで事例 → 公開 を数えて
data/funnel.json と data/funnel.md に残す。採用率(公開 / 取得)が 10% 未満の取得元は後回しにする判断に使う。
search:* と sier:* はそれぞれ 1 行にまとめる(--detail で分ける)。
使い方: python funnel.py [--detail]
"""
import argparse

from common import DATA, RAW, jdump, jload, url_id

STAGES = ["候補", "取得", "抽出", "分類", "画像あり", "レビュー済み", "事例(レビュー)", "公開"]


def group_of(key, detail):
    if detail:
        return key
    for p in ("search:", "sier:"):
        if key.startswith(p):
            return p + "*"
    return key


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--detail", action="store_true")
    a = ap.parse_args()
    cands = jload(DATA / "candidates.json", {})
    reviewed, is_case = set(), set()
    for p in (DATA / "llm_out").glob("*.json"):
        for r in jload(p, []) or []:
            reviewed.add(r["id"])
            if r.get("is_case"):
                is_case.add(r["id"])
            else:
                is_case.discard(r["id"])
    pub = {c["id"] for c in (jload(DATA / "cases.json", {}) or {}).get("cases", [])}
    pub |= {s for c in (jload(DATA / "cases.json", {}) or {}).get("cases", []) for s in c.get("merged_ids", [])}
    rows = {}
    for c in cands.values():
        pid = url_id(c["url"])
        meta = jload(RAW / "pages" / f"{pid}.json", {}) or {}
        st = [True, meta.get("status") == "ok", (DATA / "extracted" / f"{pid}.json").exists()]
        cp = DATA / "classified" / f"{pid}.json"
        cl = jload(cp, None) if cp.exists() else None
        st += [cl is not None, bool(cl and cl.get("images")), pid in reviewed, pid in is_case and cl is not None, pid in pub]
        for k in {group_of(s, a.detail) for s in (c.get("sources") or ["?"])}:
            r = rows.setdefault(k, [0] * len(STAGES))
            for i, ok in enumerate(st):
                r[i] += int(ok)
    out = []
    for k, r in sorted(rows.items(), key=lambda kv: -kv[1][-1]):
        rate = r[-1] / r[1] if r[1] else 0.0
        out.append({"source": k, **dict(zip(STAGES, r)), "採用率(公開/取得)": round(rate, 3)})
    jdump(out, DATA / "funnel.json")
    lines = ["| 取得元 | " + " | ".join(STAGES) + " | 採用率 |", "|---" * (len(STAGES) + 2) + "|"]
    for o in out:
        lines.append(f"| {o['source']} | " + " | ".join(str(o[s]) for s in STAGES) + f" | {o['採用率(公開/取得)']:.0%} |")
    tot = [sum(o[s] for o in out) for s in STAGES]
    (DATA / "funnel.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:2] + lines[2:40]))
    print("(取得元の重複を含む合計)", dict(zip(STAGES, tot)))


if __name__ == "__main__":
    main()
