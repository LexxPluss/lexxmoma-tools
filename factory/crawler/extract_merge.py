# -*- coding: utf-8 -*-
"""抽出結果(data/<cc>/extracted/<会社id>.json)を検査・正規化し、緯度経度を付けて data/<cc>/factories.json にまとめる。
会社の売上高・従業員数が無ければ、抽出結果(公式サイト)→ ウィキペディア(public)の順で補う。

抽出は Claude Code のサブエージェントが raw/<cc>/sites/<会社id>/*.txt(公式サイト)と raw/<cc>/wiki/<会社id>/article.txt を読んで行う
(手順と出力の形式は extract_spec.md)。このスクリプトは機械的な検査だけを行う:
  - 出所 URL(src)が index.json か wiki の URL のどれかと一致すること
  - 住所がその国のもの(都道府県相当が取れること)。取れないものは「要確認」に落として採用しない
  - 同じ会社・同じ住所の重複を 1 件にする

  python extract_merge.py tw|kr [--no-geocode]
"""
import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATA, RAW, jdump, jload, log_run, squash, to_int
from geocode import geocode_all
from normalize import check, factory, split_admin


def allowed_urls(cc, cid):
    urls = set()
    idx = jload(RAW / cc / "sites" / cid / "index.json")
    if idx:
        for p in idx.get("pages", []):
            if p.get("url"):
                urls.add(p["url"])
        if idx.get("web"):
            urls.add(idx["web"])
    w = jload(RAW / cc / "wiki" / cid / "info.json")
    if w and w.get("url"):
        urls.add(w["url"])
    man = jload(DATA / cc / "manual_sources.json", {})
    for u in man.get(cid, []):
        urls.add(u)
    return urls


def norm_url(u):
    return (u or "").strip().rstrip("/").lower().replace("http://", "https://")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cc", choices=["tw", "kr"])
    ap.add_argument("--no-geocode", action="store_true")
    a = ap.parse_args()
    cc = a.cc
    CC = cc.upper()
    cos = jload(DATA / cc / "companies.json", [])
    by_id = {c["id"]: c for c in cos}
    facs, issues, stats = [], [], {"companies": len(cos), "extracted": 0, "factories": 0, "rejected": 0, "no_info": 0}
    for c in cos:
        ex = jload(DATA / cc / "extracted" / f"{c['id']}.json")
        if not ex:
            stats["no_info"] += 1
            continue
        stats["extracted"] += 1
        urls = {norm_url(u) for u in allowed_urls(cc, c["id"])}
        # 会社の補足(従業員数・売上高・親会社・グループ・日本語名)
        comp = ex.get("company") or {}
        for k in ("parent", "group", "nameJa"):
            if comp.get(k) and not c.get(k):
                c[k] = squash(comp[k])
        if comp.get("emp") and not c.get("emp") and norm_url(comp.get("empSrc")) in urls:
            c["emp"] = to_int(comp["emp"]); c["empSrc"] = comp["empSrc"]
        if comp.get("rev") and not c.get("rev") and norm_url(comp.get("revUrl")) in urls:
            c["rev"], c["revFy"], c["revUrl"] = comp["rev"], comp.get("revFy"), comp["revUrl"]
        w = jload(RAW / cc / "wiki" / c["id"] / "info.json") or {}
        if w.get("emp") and not c.get("emp"):
            c["emp"] = w["emp"]; c["empSrc"] = w["url"]
        if w.get("rev") and not c.get("rev"):
            c["rev"], c["revFy"], c["revUrl"] = w["rev"], w.get("revFy"), w["url"]
        seen = set()
        for f in ex.get("factories") or []:
            src = f.get("src")
            if norm_url(src) not in urls:
                issues.append({"company": c["name"], "factory": f.get("name"), "why": f"出所 URL が取得済みページに無い: {src}"}); stats["rejected"] += 1; continue
            if not f.get("addr"):
                issues.append({"company": c["name"], "factory": f.get("name"), "why": "住所なし"}); stats["rejected"] += 1; continue
            pref, city = split_admin(CC, f["addr"])
            if not pref:
                issues.append({"company": c["name"], "factory": f.get("name"), "why": f"国内の住所と読めない: {f['addr']}"}); stats["rejected"] += 1; continue
            key = (squash(f.get("op") or c["name"]), squash(f["addr"]))
            if key in seen:
                continue
            seen.add(key)
            st = f.get("srcType") or ("public" if "wikipedia.org" in (src or "") else "official")
            label = f.get("srcLabel") or ("ウィキペディア(公的情報ではありません)" if st == "public" else None)
            facs.append(factory(CC, c["id"], f.get("op") or c["name"], f.get("name") or (c["name"] + " 工場" if CC == "TW" else c["name"] + " 공장"), f["addr"],
                                prod=f.get("prod"), src=src, srcType=st, seg=f.get("seg"), area=f.get("area"), floor=f.get("floor"), emp=f.get("emp"),
                                empAsof=f.get("empAsof"), est=f.get("est"), src2=f.get("src2"), srcLabel=label, nameEn=f.get("nameEn"), opEn=f.get("opEn")))
    stats["factories"] = len(facs)
    # 既存の緯度経度を引き継ぐ(同じ id)
    old = {f["id"]: f for f in jload(DATA / cc / "factories.json", [])}
    for f in facs:
        o = old.get(f["id"])
        if o and o.get("lat") is not None:
            f["lat"], f["lng"], f["prec"] = o["lat"], o["lng"], o["prec"]
    if not a.no_geocode:
        n = geocode_all(CC, facs)
        stats["geocoded_now"] = n
    errs = check(cos, facs)
    if errs:
        print("スキーマ検査:", len(errs)); [print("  ", e) for e in errs[:20]]
    jdump(cos, DATA / cc / "companies.json")
    jdump(facs, DATA / cc / "factories.json")
    jdump(issues, DATA / cc / "extract_issues.json")
    print(stats, "要確認", len(issues))
    log_run(f"extract_merge_{cc}", stats)


if __name__ == "__main__":
    main()
