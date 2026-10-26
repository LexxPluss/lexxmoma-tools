# -*- coding: utf-8 -*-
"""監査(7-1): data/cases.json の指標を data/audit.json と audit_history.json に出す。
目標値(README の表)と比べ、未達を列挙する。無作為 50 件の抜き取りリストも作る(data/spot_check.json)。
使い方: python audit.py [--check-links]
"""
import argparse
import random
from collections import Counter

from common import DATA, SITE_OUT, jdump, jload, today, TAXONOMY, yload

TARGETS = {
    "total": (">=", 2000), "image_stored_rate": (">=", 0.95), "image_attribution_coverage": (">=", 1.0), "field_source_coverage": (">=", 1.0),
    "category_rate": (">=", 1.0), "principle_rate": (">=", 1.0), "robot_class_rate": (">=", 0.85), "material_rate": (">=", 0.80), "payload_rate": (">=", 0.70),
    "image_bytes_total_mb": ("<=", 300), "link_only_rate": ("<=", 0.05), "bad_records": ("<=", 0),
    "dist.payload_le20": (">=", 0.60), "dist.payload_20_100": (">=", 0.15), "dist.payload_unknown": ("<=", 0.05),
    "dist.cobot": (">=", 0.45), "dist.industrial": (">=", 0.40), "dist.mobile_count": (">=", 100),
    "dist.maker_product": ("<=", 0.35), "dist.sier_case": (">=", 0.40), "dist.custom": (">=", 0.15),
    "dist.region_japan": (">=", 0.30), "dist.region_na": (">=", 0.20), "dist.region_eu": (">=", 0.20), "dist.region_asia": (">=", 0.10),
    "dist.category_min": (">=", 30), "dist.principle_min": (">=", 20),
}
# 「上位のワークカテゴリ」「主要な掴み方」: 最低件数を要求する対象
MAIN_CATEGORIES = ["carton", "tote", "sack", "round", "block", "sheet", "casting", "bulk_parts", "molded", "pcb", "glass_plate", "fresh", "bakery", "vial", "bottle", "textile", "pallet", "piece"]
MAIN_PRINCIPLES = ["parallel2", "parallel3", "adaptive", "clamp_fork", "single_pad", "multi_pad", "area", "electropermanent", "soft_finger", "hybrid", "tool_changer"]


def rate(n, d):
    return round(n / d, 3) if d else 0.0


def run(plain, check_links=False):
    cases = plain["cases"]
    n = len(cases)
    stored = [c for c in cases if c.get("image_policy") != "link_only"]
    link_only = n - len(stored)
    imgs = [im for c in cases for im in c.get("images", [])]
    with_img = sum(1 for c in stored if c.get("images"))
    attr = sum(1 for im in imgs if im.get("source_page_url") and im.get("credit"))
    # 値のある項目に出典があるか
    fs_have, fs_need = 0, 0
    for c in cases:
        fs = c.get("fieldSources", {})
        for k, v in [("workpiece.categories", c["workpiece"]["categories"]), ("end_effector.principles", c["end_effector"]["principles"]), ("tasks", c["tasks"]),
                     ("workpiece.materials", c["workpiece"]["materials"]), ("robot.class", c["robot"].get("class")), ("robot.model", c["robot"].get("model")),
                     ("robot.maker", c["robot"].get("maker")), ("industry", c.get("industry")), ("payload_class", c["payload_class"] if c["payload_class"] != "不明" else None)]:
            if v:
                fs_need += 1
                if k in fs or (k == "robot.maker" and ("robot.model" in fs or "robot.maker" in fs)) or (k == "robot.class" and ("robot.model" in fs or "robot.class" in fs or "robot.maker" in fs)):
                    fs_have += 1
    pay = Counter(c["payload_class"] for c in cases)
    cls = Counter(c["robot"].get("class") or "不明" for c in cases)
    ct = Counter(c["case_type"] for c in cases)
    rg = Counter(c.get("region") or "その他" for c in cases)
    cat = Counter(k for c in cases for k in c["workpiece"]["categories"][:1])
    pr = Counter(k for c in cases for k in c["end_effector"]["principles"][:1])
    img_bytes = sum(f.stat().st_size for f in (SITE_OUT / "img").glob("**/*.bin")) if (SITE_OUT / "img").exists() else 0
    bad = sum(1 for c in cases if not c["workpiece"]["categories"] or not c["end_effector"]["principles"] or (not c.get("images") and c.get("image_policy") != "link_only"))
    m = {
        "date": today(), "total": n, "link_only": link_only, "link_only_rate": rate(link_only, n),
        "image_stored_rate": rate(with_img, len(stored)), "images_total": len(imgs), "image_attribution_coverage": rate(attr, len(imgs)),
        "field_source_coverage": rate(fs_have, fs_need),
        "category_rate": rate(sum(1 for c in cases if c["workpiece"]["categories"]), n), "principle_rate": rate(sum(1 for c in cases if c["end_effector"]["principles"]), n),
        "principle_known_rate": rate(sum(1 for c in cases if c["end_effector"]["principles"] and c["end_effector"]["principles"][0] != "hand_unspecified"), n),
        "robot_class_rate": rate(sum(1 for c in cases if c["robot"].get("class")), n), "material_rate": rate(sum(1 for c in cases if c["workpiece"]["materials"]), n),
        "payload_rate": rate(sum(1 for c in cases if c["payload_class"] != "不明"), n), "task_rate": rate(sum(1 for c in cases if c["tasks"]), n),
        "needs_review_rate": rate(sum(1 for c in cases if c["quality"]["needs_review"]), n),
        "image_bytes_total_mb": round(img_bytes / 1e6, 1), "bad_records": bad,
        "dist": {
            "payload": dict(pay), "payload_le20": rate(pay["≤5kg"] + pay["5–20kg"], n), "payload_20_100": rate(pay["20–100kg"], n), "payload_gt100": rate(pay[">100kg"], n), "payload_unknown": rate(pay["不明"], n),
            "robot_class": dict(cls), "cobot": rate(cls["協働"], n), "industrial": rate(cls["産業用"], n), "mobile_count": sum(1 for c in cases if c["robot"].get("is_mobile_manipulator")),
            "case_type": dict(ct), "maker_product": rate(ct["maker_product"], n), "sier_case": rate(ct["sier_case"], n), "custom": rate(ct["user_custom"] + ct["research"], n),
            "region": dict(rg), "region_japan": rate(rg["日本"], n), "region_na": rate(rg["北米"], n), "region_eu": rate(rg["欧州"], n), "region_asia": rate(rg["中国"] + rg["その他アジア"], n),
            "categories": dict(cat), "principles": dict(pr),
            "category_min": min([cat.get(k, 0) for k in MAIN_CATEGORIES] or [0]), "principle_min": min([pr.get(k, 0) for k in MAIN_PRINCIPLES] or [0]),
            "category_short": {k: cat.get(k, 0) for k in MAIN_CATEGORIES if cat.get(k, 0) < 30}, "principle_short": {k: pr.get(k, 0) for k in MAIN_PRINCIPLES if pr.get(k, 0) < 20},
        },
    }
    unmet = []
    for key, (op, tgt) in TARGETS.items():
        v = m["dist"][key[5:]] if key.startswith("dist.") else m[key]
        ok = v >= tgt if op == ">=" else v <= tgt
        if not ok:
            unmet.append(f"{key} = {v} (目標 {op} {tgt})")
    m["unmet"] = unmet
    if check_links:
        m["dead_source_link_rate"] = check_dead_links(cases)
    jdump(m, DATA / "audit.json")
    hist = jload(DATA / "audit_history.json", [])
    hist.append({k: v for k, v in m.items() if k != "dist"} | {"dist_summary": {k: v for k, v in m["dist"].items() if not isinstance(v, dict)}})
    jdump(hist, DATA / "audit_history.json")
    # 抜き取り検査用(無作為 50 件)
    rnd = random.Random(today())
    sample = rnd.sample(cases, min(50, n)) if n else []
    jdump([{"id": c["id"], "title_ja": c["title_ja"], "url": c["sources"][0]["url"], "categories": c["workpiece"]["categories"], "principles": c["end_effector"]["principles"],
            "robot": c["robot"].get("class"), "images": [im["id"] for im in c.get("images", [])], "ok": None, "note": ""} for c in sample], DATA / "spot_check.json")
    print("--- 監査 ---")
    for k in ("total", "image_stored_rate", "image_attribution_coverage", "field_source_coverage", "category_rate", "principle_rate", "robot_class_rate", "material_rate", "payload_rate", "image_bytes_total_mb", "bad_records", "needs_review_rate"):
        print(f"{k}: {m[k]}")
    print("配分:", {k: v for k, v in m["dist"].items() if not isinstance(v, dict)})
    print("未達:", len(unmet))
    for u in unmet:
        print("  -", u)
    return m


def check_dead_links(cases, limit=200):
    import requests
    from common import USER_AGENT
    urls = list(dict.fromkeys(c["sources"][0]["url"] for c in cases))[:limit]
    dead = 0
    for u in urls:
        try:
            r = requests.head(u, headers={"User-Agent": USER_AGENT}, timeout=20, allow_redirects=True)
            if r.status_code >= 400:
                dead += 1
        except Exception:
            dead += 1
    return rate(dead, len(urls))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check-links", action="store_true")
    a = ap.parse_args()
    plain = jload(DATA / "cases.json")
    if not plain:
        raise SystemExit("data/cases.json が無い。先に build.py --plain-only")
    run(plain, a.check_links)


if __name__ == "__main__":
    main()
