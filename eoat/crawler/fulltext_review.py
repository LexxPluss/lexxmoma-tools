# -*- coding: utf-8 -*-
"""公開中の事例を本文の全文で見直す入力を作る(ループ 14 の品質ループ)。
LLM レビュー(llm_prep.py)は本文の冒頭 1,800 字だけを渡していたので、後半にあるロボットの型式・材料・重さを取りこぼし、誤りも残っていた。
data/cases.json の事例ごとに 本文 6,000 字・画像の alt・今の値 を 25 件ずつ data/fulltext_batches/ に書く。
サブエージェントが fulltext_review_instructions.md の手順で data/llm_out/zz_full_NNN.json に書き、llm_merge.py が反映する
(ファイル名の zz_ は z_grasp_* と recovered_published.json より後に読ませるため)。
使い方: python fulltext_review.py [--size 25]
ループ 16: --focus で「掴み方・作業・ワーク」だけを精査する入力を data/focus_batches/ に作る(focus_review_instructions.md、出力は data/llm_out/zzz_focus_NNN.json)
"""
import argparse

from common import DATA, jdump, jload

OUT = DATA / "fulltext_batches"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=25)
    ap.add_argument("--focus", action="store_true")
    a = ap.parse_args()
    out = DATA / "focus_batches" if a.focus else OUT
    done = {r["id"] for p in (DATA / "llm_out").glob("zzz_focus_*.json" if a.focus else "zz_full_*.json") for r in jload(p, [])}
    recs = []
    for r in jload(DATA / "cases.json")["cases"]:
        if r["id"] in done:
            continue
        ex = jload(DATA / "extracted" / f"{r['id']}.json", {})
        fs = (r.get("fieldSources") or {}).get("end_effector.principles") or {}
        alts = [" ".join(x for x in (i.get("alt"), i.get("caption")) if x) for i in ex.get("images", [])]
        rb, wp = r["robot"], r["workpiece"]
        recs.append({"id": r["id"], "url": r["sources"][0]["url"], "title": ex.get("title", ""), "text": (ex.get("text") or "")[:6000],
                     "image_alts": [x for x in alts if x][:10],
                     "current": {"categories": wp["categories"], "workpiece_name": wp.get("name"), "tasks": r["tasks"],
                                 "principles": r["end_effector"]["principles"], "principles_basis": fs.get("method"),
                                 "materials": wp["materials"], "mass_kg": (wp.get("mass_kg") or {}).get("max"),
                                 "robot_maker": rb.get("maker"), "robot_model": rb.get("model"), "robot_class": rb.get("class"),
                                 "is_mobile": bool(rb.get("is_mobile_manipulator"))}})
    out.mkdir(parents=True, exist_ok=True)
    if a.focus and (OUT / "legend.json").exists():
        jdump(jload(OUT / "legend.json"), out / "legend.json")
    for f in out.glob("batch_*.json"):
        f.unlink()
    n = 0
    for i in range(0, len(recs), a.size):
        n += 1
        jdump(recs[i:i + a.size], out / f"batch_{n:03d}.json")
    print(f"{len(recs)} 件 → {n} バッチ({out})")


if __name__ == "__main__":
    main()
