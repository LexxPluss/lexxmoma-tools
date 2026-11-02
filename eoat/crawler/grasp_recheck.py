# -*- coding: utf-8 -*-
"""掴み方「記載なし」の事例を、本文の全文で読み直す準備(ループ 13)。
LLM レビュー(llm_prep.py)は本文の冒頭 1,800 字しか渡していないので、後半に出るハンドの名前・型式・メーカーを見落としていた。
掴み方が hand_unspecified の事例(写真から判定したものを除く)について、本文 7,000 字・画像の alt / キャプションを 30 件ずつ data/grasp_batches/ に書く。
サブエージェントが grasp_recheck_instructions.md の手順で読み、data/llm_out/z_grasp_NNN.json に書く(ファイル名の z_ は llm_merge.py が最後に読むため。
recovered_published.json より後でないと「記載なし」に戻される)。反映は llm_merge.py(method: inferred + 本文の引用)。
使い方: python grasp_recheck.py [--size 30]
"""
import argparse

from common import DATA, jdump, jload

OUT = DATA / "grasp_batches"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=30)
    a = ap.parse_args()
    done = set()
    for p in (DATA / "llm_out").glob("z_grasp_*.json"):
        done |= {r["id"] for r in jload(p, [])}
    recs = []
    for p in sorted((DATA / "classified").glob("*.json")):
        r = jload(p)
        fs = (r.get("fieldSources") or {}).get("end_effector.principles") or {}
        if not r.get("images") or r["id"] in done or fs.get("method") == "photo":
            continue
        if (r["end_effector"]["principles"] or ["hand_unspecified"])[0] != "hand_unspecified":
            continue
        ex = jload(DATA / "extracted" / f"{r['id']}.json", {})
        alts = [" ".join(x for x in (i.get("alt"), i.get("caption")) if x) for i in ex.get("images", [])]
        recs.append({"id": r["id"], "title": ex.get("title", ""), "description": ex.get("description", ""),
                     "text": (ex.get("text") or "")[:7000], "image_alts": [x for x in alts if x][:15],
                     "rule": {"categories": r["workpiece"]["categories"], "tasks": r["tasks"]}})
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("batch_*.json"):
        f.unlink()
    n = 0
    for i in range(0, len(recs), a.size):
        n += 1
        jdump(recs[i:i + a.size], OUT / f"batch_{n:03d}.json")
    print(f"{len(recs)} 件 → {n} バッチ({OUT})")


if __name__ == "__main__":
    main()
