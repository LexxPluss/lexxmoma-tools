# -*- coding: utf-8 -*-
"""LLM レビューの結果(data/llm_out/*.json)を分類結果(data/classified/)に反映する。

- is_case が false の事例は落とす(data/rejected.json に理由 "LLM: 事例ではない")
- 規則と違う値は LLM の値で置き換え、fieldSources に method: "inferred" と evidence(本文の引用)を残す。信頼度は 0.8 に揃える
- 語彙に無いキーは無視する(語彙の変更は taxonomy/ で行う)
使い方: python llm_merge.py
"""
from common import DATA, TAXONOMY, RunLog, jdump, jload, yload

CLASSES = {"産業用", "協働"}


def main():
    cats = {it["key"] for g in yload(TAXONOMY / "categories.yaml")["groups"] for it in g["items"]}
    prs = {it["key"] for g in yload(TAXONOMY / "principles.yaml")["groups"] for it in g["items"]}
    mats = {m["key"] for m in yload(TAXONOMY / "materials.yaml")["materials"]}
    tasks = {t["key"] for t in yload(TAXONOMY / "tasks.yaml")["tasks"]}
    log = RunLog("llm_merge")
    rejected = jload(DATA / "rejected.json", {})
    n_fix, n_drop, n_same = 0, 0, 0
    for p in sorted((DATA / "llm_out").glob("*.json")):
        for rv in jload(p, []):
            cp = DATA / "classified" / f"{rv['id']}.json"
            if not cp.exists():
                continue
            r = jload(cp)
            if rv.get("is_case") is False:
                rejected[rv["id"]] = {"url": r["sources"][0]["url"], "why": "LLM: 事例ではない: " + (rv.get("note") or "")[:120]}
                cp.unlink()
                n_drop += 1
                continue
            ev = (rv.get("evidence") or "")[:80]
            changed = False

            def src(field, method="inferred"):
                return {"source": 0, "method": method, "evidence": [ev] if ev else [], "note": (rv.get("note") or "")[:120]}

            def setlist(path, key, vals, allowed):
                nonlocal changed
                vals = [v for v in (vals or []) if v in allowed][:3]
                if vals and vals != path[key]:
                    path[key] = vals
                    changed = True
                    return True
                return False

            if setlist(r["workpiece"], "categories", rv.get("categories"), cats):
                r["fieldSources"]["workpiece.categories"] = src("workpiece.categories")
            if setlist(r["end_effector"], "principles", rv.get("principles"), prs):
                r["fieldSources"]["end_effector.principles"] = src("end_effector.principles")
                r["end_effector"]["subtype"] = None
            if setlist(r, "tasks", rv.get("tasks"), tasks):
                r["fieldSources"]["tasks"] = src("tasks")
            if setlist(r["workpiece"], "materials", rv.get("materials"), mats):
                r["fieldSources"]["workpiece.materials"] = src("workpiece.materials")
            rc = rv.get("robot_class")
            if rc in CLASSES and rc != r["robot"].get("class"):
                r["robot"]["class"] = rc
                r["fieldSources"]["robot.class"] = src("robot.class")
                changed = True
            if rv.get("is_mobile") is True and not r["robot"].get("is_mobile_manipulator"):
                r["robot"]["is_mobile_manipulator"] = True
                r["fieldSources"]["robot.is_mobile_manipulator"] = src("robot.is_mobile_manipulator")
                changed = True
            m = rv.get("mass_kg")
            from normalize import payload_class
            if isinstance(m, (int, float)) and m > 0 and (r["workpiece"].get("mass_kg") or {}).get("max") != float(m):
                # レビューの数値は規則の値(可搬重量を拾いがち)より優先する
                r["workpiece"]["mass_kg"] = {"min": float(m), "max": float(m)}
                r["payload_class"] = payload_class(float(m))
                r["fieldSources"]["workpiece.mass_kg"] = src("workpiece.mass_kg")
                r["fieldSources"]["payload_class"] = {"source": 0, "method": "derived", "evidence": ["ワークの重さ(LLM が本文から読み取り)から"]}
                changed = True
            elif "mass_kg" in rv and m is None and r["workpiece"].get("mass_kg"):
                # レビューが「本文に無い」と判断した重さは消し、可搬帯はロボット・ハンドの可搬から引き直す(ループ 9: 規則の重さの大半がロボットの可搬だった)
                r["workpiece"]["mass_kg"] = None
                r["fieldSources"].pop("workpiece.mass_kg", None)
                rp = r["robot"].get("payload_kg")
                if rp:
                    r["payload_class"] = payload_class(rp)
                    r["fieldSources"]["payload_class"] = {"source": 0, "method": "derived", "evidence": [f"ロボットの可搬 {rp} kg から"]}
                else:
                    r["payload_class"] = "不明"
                    r["fieldSources"].pop("payload_class", None)
                changed = True
            if rv.get("workpiece_name") and not r["workpiece"].get("name"):
                r["workpiece"]["name"] = str(rv["workpiece_name"])[:40]
                changed = True
            if changed:
                r["quality"]["confidence"] = {"category": 0.8, "principle": 0.8, "robot_class": 0.8 if r["robot"].get("class") else 0.0}
                r["quality"]["needs_review"] = False
                r["quality"]["llm_reviewed"] = True
                n_fix += 1
            else:
                r["quality"]["llm_reviewed"] = True
                r["quality"]["needs_review"] = False
                n_same += 1
            jdump(r, cp)
    jdump(rejected, DATA / "rejected.json")
    print(f"LLM レビュー反映: 修正 {n_fix} / 一致 {n_same} / 事例でない {n_drop}")
    log.save()


if __name__ == "__main__":
    main()
