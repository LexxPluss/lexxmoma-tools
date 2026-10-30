# -*- coding: utf-8 -*-
"""LLM による分類の確認(4-5「曖昧なときは LLM で補ってよい。method: inferred と根拠を付ける」)の入力を作る。

規則で分類した事例(data/classified/、画像あり)を 1 バッチ 40 件に分け、題名・説明・本文の冒頭・画像の alt・規則の分類結果 を
data/llm_batches/batch_NNN.json に出す。レビュー担当(Claude のサブエージェント)は同じ形で data/llm_out/batch_NNN.json を書く:
  [{"id": "...", "is_case": true/false, "categories": [...], "principles": [...], "tasks": [...], "materials": [...],
    "robot_class": "産業用"|"協働"|null, "is_mobile": bool, "mass_kg": number|null, "workpiece_name": "...", "evidence": "本文からの短い引用(40 字以内)", "note": "..."}]
使い方: python llm_prep.py [--size 40] [--only-missing]
"""
import argparse

from common import DATA, TAXONOMY, jdump, jload, yload

OUT = DATA / "llm_batches"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=40)
    ap.add_argument("--only-missing", action="store_true", help="前回のレビュー(data/llm_out)に無い事例だけ")
    a = ap.parse_args()
    done = set()
    if a.only_missing:
        for p in (DATA / "llm_out").glob("*.json"):
            for r in jload(p, []):
                done.add(r["id"])
    cats = yload(TAXONOMY / "categories.yaml")["groups"]
    prs = yload(TAXONOMY / "principles.yaml")["groups"]
    legend = {
        "categories": {it["key"]: f"{g['label']}>{it['label']}" for g in cats for it in g["items"]},
        "principles": {it["key"]: f"{g['label']}>{it['label']}" for g in prs for it in g["items"] if not (it.get("photo_only") or it.get("estimate_only"))},
        "materials": {m["key"]: m["label"] for m in yload(TAXONOMY / "materials.yaml")["materials"]},
        "tasks": {t["key"]: t["label"] for t in yload(TAXONOMY / "tasks.yaml")["tasks"]},
    }
    recs = []
    for p in sorted((DATA / "classified").glob("*.json")):
        r = jload(p)
        if not r.get("images") or r["id"] in done:
            continue
        ex = jload(DATA / "extracted" / f"{r['id']}.json", {})
        recs.append({
            "id": r["id"], "url": r["sources"][0]["url"], "lang": r["sources"][0].get("lang"),
            "title": ex.get("title"), "description": (ex.get("description") or "")[:300],
            "headings": (ex.get("headings") or [])[:8],
            "text": (ex.get("text") or "")[:1800],
            "image_alts": [im.get("alt_ja") for im in r["images"] if im.get("alt_ja")][:3],
            "rule": {"categories": r["workpiece"]["categories"], "principles": r["end_effector"]["principles"], "tasks": r["tasks"],
                     "materials": r["workpiece"]["materials"], "robot_class": r["robot"].get("class"), "is_mobile": r["robot"].get("is_mobile_manipulator"),
                     "robot": " ".join(x for x in (r["robot"].get("maker"), r["robot"].get("model")) if x), "mass_kg": r["workpiece"].get("mass_kg"),
                     "ee": " ".join(x for x in (r["end_effector"].get("maker"), r["end_effector"].get("model")) if x)},
        })
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("batch_*.json"):
        f.unlink()
    jdump(legend, OUT / "legend.json")
    n = 0
    for i in range(0, len(recs), a.size):
        n += 1
        jdump(recs[i:i + a.size], OUT / f"batch_{n:03d}.json")
    print(f"{len(recs)} 件 → {n} バッチ({OUT.relative_to(DATA.parent)})")


if __name__ == "__main__":
    main()
