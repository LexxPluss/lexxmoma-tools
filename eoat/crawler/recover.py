# -*- coding: utf-8 -*-
"""別の環境で再開するときの復元(ループ 9): 公開側の暗号化データ(site/members/eoat-db/data.enc.json)から、
候補 URL(data/candidates.json)・取得元(data/search_sources.json, data/sier_sources.json)・LLM レビュー結果(data/llm_out/recovered_published.json)を作る。

data/ と raw/ は gitignore なので、環境が変わると消える。公開データには事例ごとの出典 URL とレビュー済みの値(method: inferred)が入っているので、
そこから「取得し直す URL」と「レビューをやり直さなくてよい値」を戻せる。原本 HTML・画像は crawl.py / images.py で取り直す(2 秒間隔)。
使い方: python recover.py --password …   → そのあと crawl.py → extract.py → classify.py → images.py → llm_merge.py → build.py
"""
import argparse
import base64
import json
import os
import re
import zlib

from common import DATA, SIER_DATA, SITE_OUT, HERE, canon_url, domain_of, jdump, jload, yload, today, url_id

REGION_OF = {"japan": "日本", "jp": "日本", "na": "北米", "us": "北米", "eu": "欧州", "europe": "欧州", "cn": "中国", "china": "中国", "asia": "その他アジア"}


def decrypt(password):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from build import derive_key
    enc = jload(SITE_OUT / "data.enc.json")
    key = derive_key(password, base64.b64decode(enc["salt"]))
    plain = zlib.decompress(AESGCM(key).decrypt(base64.b64decode(enc["iv"]), base64.b64decode(enc["ct"]), None))
    return json.loads(plain)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--password")
    a = ap.parse_args()
    pw = a.password or os.environ.get("EOAT_PW") or os.environ.get("FACTORY_PW") or os.environ.get("PEOPLE_PW")
    if not pw:
        raise SystemExit("パスワードが必要です(--password か EOAT_PW)")
    pub = decrypt(pw)
    jdump(pub, DATA / "published_prev.json")
    src_yaml = {s["label"]: s for s in yload(HERE / "sources.yaml")["sources"]}
    s = SIER_DATA.read_text(encoding="utf-8")
    siers = json.loads(s[s.index("=") + 1:].rstrip().rstrip(";"))
    sier_by_name = {c["name"]: c for c in siers}
    sier_by_dom = {domain_of(c["website"]): c for c in siers if c.get("website")}
    cands = jload(DATA / "candidates.json", {})
    search_src = jload(DATA / "search_sources.json", {})
    sier_src = jload(DATA / "sier_sources.json", {})
    reviews, unknown = [], set()
    for r in pub["cases"]:
        for i, so in enumerate(r["sources"]):
            pubn = so.get("publisher") or ""
            key = None
            m = re.match(r"ウェブ検索による発掘\((.+)\)$", pubn)
            if pubn in src_yaml:
                key = src_yaml[pubn]["key"]
            elif m:
                tag = m.group(1)
                key = f"search:{tag}"
                region = REGION_OF.get(tag.split("_")[0].lower(), r["region"] if i == 0 else "その他")
                search_src.setdefault(key, {"key": key, "label": pubn, "type": "discovery", "case_type": "sier_case", "region": region, "country": None,
                                            "lang": "ja" if region == "日本" else ("zh" if region == "中国" else "en"), "index_urls": []})
            else:
                c = sier_by_name.get(pubn) or sier_by_dom.get(domain_of(so["url"]))
                if c:
                    key = f"sier:{c['id']}"
                    sier_src.setdefault(key, {"key": key, "label": c["name"], "type": "sier", "case_type": "sier_case", "region": "日本", "country": "日本",
                                              "lang": "ja", "sier_db_id": c["id"], "index_urls": []})
            if not key:
                unknown.add(pubn)
                continue
            e = cands.setdefault(canon_url(so["url"]), {"url": so["url"], "sources": [], "first_seen": today(), "text": (so.get("title") or "")[:120]})
            if key not in e["sources"]:
                e["sources"].append(key)
            if key.startswith("search:"):
                e["hints"] = {"region_ja": r["region"] if i == 0 else search_src[key]["region"], "recovered": True}
        ev, note = "", ""
        for k in ("workpiece.categories", "end_effector.principles", "tasks"):
            fs = r["fieldSources"].get(k) or {}
            if fs.get("method") == "inferred" and fs.get("evidence"):
                ev, note = fs["evidence"][0], fs.get("note") or ""
                break
        mass = r["workpiece"].get("mass_kg")
        reviews.append({"id": r["id"], "is_case": True, "categories": r["workpiece"]["categories"], "principles": r["end_effector"]["principles"],
                        "tasks": r["tasks"], "materials": r["workpiece"]["materials"], "robot_class": r["robot"].get("class"),
                        "is_mobile": bool(r["robot"].get("is_mobile_manipulator")), "mass_kg": (mass["max"] if mass else None),
                        "workpiece_name": r["workpiece"].get("name") or "", "evidence": ev, "note": note or "(公開済みデータから復元)"})
    jdump(cands, DATA / "candidates.json")
    jdump(search_src, DATA / "search_sources.json")
    jdump(sier_src, DATA / "sier_sources.json")
    jdump(reviews, DATA / "llm_out" / "recovered_published.json")
    bad = [r["id"] for r in pub["cases"] if url_id(r["sources"][0]["url"]) != r["id"]]
    print(f"公開 {len(pub['cases'])} 件 → 候補 {len(cands)} / 検索取得元 {len(search_src)} / SIer {len(sier_src)} / レビュー {len(reviews)}"
          f"(取得元が分からない publisher: {sorted(unknown)}、id の不一致 {len(bad)})")


if __name__ == "__main__":
    main()
