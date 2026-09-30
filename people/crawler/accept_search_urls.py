# -*- coding: utf-8 -*-
"""Web 検索で見つけた役員一覧 URL の候補を、実際に取得して確かめてから manual/ir_urls_auto.json に入れる。

採用の条件(すべて満たすもの):
  1. 会社の公式サイト(企業マスタの web)と同じ登録ドメイン(例: *.toray.co.jp)。第三者サイトは入れない
  2. robots.txt で許可され、取得できる
  3. 役員の並び(役職 → 氏名)が 3 名以上読める(crawl_sites.parse_executives)
候補ファイル: data/search_result_*.json({"会社略称": "URL" | null})

使い方: python accept_search_urls.py
"""
import glob
import json
import re
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

from common import DATA, MANUAL, fetch, jdump, jload, today
from crawl_sites import parse_executives


def reg_domain(url):
    h = urllib.parse.urlsplit(url or "").netloc.lower().split(":")[0]
    parts = h.split(".")
    if len(parts) >= 3 and parts[-1] == "jp" and parts[-2] in ("co", "or", "ne", "ac", "go", "gr"):
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def check(item):
    name, url, web = item
    res = {"name": name, "url": url, "ok": False, "why": None, "n": 0}
    if not url:
        res["why"] = "候補なし"
        return res
    if url.lower().endswith(".pdf"):
        res["why"] = "PDF"
        return res
    if web and reg_domain(url) != reg_domain(web):
        res["why"] = f"公式サイトと別ドメイン({reg_domain(url)} ≠ {reg_domain(web)})"
        return res
    try:
        html, ct = fetch(url, timeout=30)
    except Exception as e:
        res["why"] = f"取得失敗: {e}"[:120]
        return res
    n = len(parse_executives(html))
    res["n"] = n
    res["ok"] = n >= 3
    res["why"] = None if res["ok"] else f"役員の並びを読めない({n} 名)"
    return res


def main():
    reg = {c["short_name"]: c for c in jload(DATA / "companies.json")["companies"]}
    cand = {}
    for f in sorted(glob.glob(str(DATA / "search_result_*.json"))):
        cand.update(jload(f, {}))
    items = [(k, v, (reg.get(k) or {}).get("web")) for k, v in cand.items() if k in reg]
    with ThreadPoolExecutor(12) as ex:
        results = list(ex.map(check, items))
    auto = jload(MANUAL / "ir_urls_auto.json", {})
    ok = 0
    for r in results:
        e = auto.setdefault(r["name"], {"name": r["name"], "company_id": reg[r["name"]]["id"]})
        if r["ok"] and not e.get("executives"):
            e.update({"executives": r["url"], "exec_count": r["n"], "error": None, "found_by": "web_search", "checked_at": today(), "confirmed": False})
            ok += 1
        elif not e.get("executives"):
            e["search_candidate"] = r["url"]
            e["search_reject"] = r["why"]
    jdump(auto, MANUAL / "ir_urls_auto.json")
    from collections import Counter
    print(f"候補 {len(items)} / 採用 {ok}")
    print(Counter((r["why"] or "採用")[:24] for r in results).most_common(10))


if __name__ == "__main__":
    main()
