# -*- coding: utf-8 -*-
"""重複判定(4-5): 同じ出典 URL / 同じ画像(phash) / メーカー+型式+ワーク+用途 が同じ事例を 1 件に束ねる。
束ねられた側の出典は sources に残す。build.py から呼ぶ。"""
from common import canon_url


def _key_mmwt(r):
    ee, wp = r.get("end_effector", {}), r.get("workpiece", {})
    if not (ee.get("maker") and ee.get("model")):
        return None
    return (ee["maker"], ee["model"], tuple(wp.get("categories", [])[:1]), tuple(r.get("tasks", [])[:1]), r.get("robot", {}).get("model"))


def _hamming(a, b):
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def dedupe(cases, image_thr=4):
    """cases(list) → (残した list, 束ねた件数, 理由の一覧)。先に出てきた(=出典の多い・画像の多い)方を残す。"""
    cases = sorted(cases, key=lambda r: (-len(r.get("images", [])), -len(r.get("sources", [])), r["id"]))
    kept, by_url, by_key, merged, reasons = [], {}, {}, 0, []
    phashes = []   # (phash, kept_index)
    for r in cases:
        urls = [canon_url(s["url"]) for s in r.get("sources", [])]
        target, why = None, None
        for u in urls:
            if u in by_url:
                target, why = by_url[u], "同じ出典 URL"
                break
        if target is None:
            k = _key_mmwt(r)
            if k and k in by_key:
                target, why = by_key[k], "メーカー+型式+ワーク+用途が同じ"
        if target is None and r.get("images"):
            # 代表画像が同じ(phash が近い) かつ 同じ取得元の種類
            ph = r["images"][0]["phash"]
            for p, ki in phashes:
                if _hamming(ph, p) <= image_thr and kept[ki]["case_type"] == r["case_type"] and set(kept[ki]["workpiece"]["categories"]) & set(r["workpiece"]["categories"]):
                    target, why = ki, "同じ画像"
                    break
        if target is not None:
            t = kept[target]
            known = {canon_url(s["url"]) for s in t["sources"]}
            for s in r.get("sources", []):
                if canon_url(s["url"]) not in known:
                    t["sources"].append(s)
            merged += 1
            reasons.append({"kept": t["id"], "dropped": r["id"], "why": why})
            continue
        ki = len(kept)
        kept.append(r)
        for u in urls:
            by_url[u] = ki
        k = _key_mmwt(r)
        if k:
            by_key[k] = ki
        for im in r.get("images", [])[:1]:
            phashes.append((im["phash"], ki))
    return kept, merged, reasons
