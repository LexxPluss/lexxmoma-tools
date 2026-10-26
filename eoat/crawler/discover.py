# -*- coding: utf-8 -*-
"""取得元(sources.yaml)の一覧ページを巡回し、事例ページの候補 URL を集める → data/candidates.json。

- 同じ URL は 1 件にまとめ、見つけた取得元・日付を残す(冪等。何度実行しても増えるだけ)
- ページ送り(paginate)は、新しい URL が 1 件も出なくなった時点で止める
使い方: python discover.py [--source key ...] [--workers 6]
"""
import argparse
import concurrent.futures as cf
import re
import urllib.parse

from bs4 import BeautifulSoup

from common import DATA, RunLog, canon_url, fetch, jdump, jload, load_sources, today, RobotsDisallowed

CANDIDATES = DATA / "candidates.json"


def links_of(html, base_url):
    s = BeautifulSoup(html, "lxml")
    out = []
    for a in s.find_all("a", href=True):
        h = urllib.parse.urljoin(base_url, a["href"].strip()).split("#")[0]
        if h.startswith("http"):
            out.append((h, (a.get_text(" ", strip=True) or "")[:120]))
    return out


def discover_source(key, src, log):
    art = re.compile(src["article"])
    exc = re.compile(src["exclude"]) if src.get("exclude") else None
    found = {}
    pages = list(src.get("index_urls", []))
    if src.get("paginate"):
        pages += [src["paginate"].format(n=n) for n in range(2, int(src.get("max_pages", 1)) + 1)]
    stale = 0
    for i, u in enumerate(pages):
        try:
            html, ct, final, _ = fetch(u)
        except RobotsDisallowed:
            log.fail(key, f"robots.txt で禁止: {u}")
            break
        except Exception as e:
            log.fail(key, f"{u}: {e}")
            if i >= len(src.get("index_urls", [])):
                break
            continue
        new = 0
        for h, text in links_of(html, final):
            c = canon_url(h)
            if art.search(h) and not (exc and exc.search(h)) and c not in found:
                found[c] = {"url": h, "text": text}
                new += 1
        log.ok(key, f"{u}: {new} 件", url=u, new=new)
        # ページ送りで新しい URL が無ければ終わり(一覧ページ以降)
        if i >= len(src.get("index_urls", [])):
            stale = stale + 1 if new == 0 else 0
            if stale >= 1:
                break
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", nargs="*")
    ap.add_argument("--workers", type=int, default=6)
    a = ap.parse_args()
    sources = load_sources()
    keys = a.source or [k for k, s in sources.items() if s.get("status") == "ok"]
    log = RunLog("discover")
    cands = jload(CANDIDATES, {})
    with cf.ThreadPoolExecutor(a.workers) as ex:
        futs = {ex.submit(discover_source, k, sources[k], log): k for k in keys if sources[k].get("status") == "ok"}
        for f in cf.as_completed(futs):
            k = futs[f]
            try:
                found = f.result()
            except Exception as e:
                log.fail(k, e)
                continue
            n_new = 0
            for c, v in found.items():
                e = cands.setdefault(c, {"url": v["url"], "sources": [], "first_seen": today(), "text": v["text"]})
                if k not in e["sources"]:
                    e["sources"].append(k)
                    n_new += 1
            print(f"{k}: {len(found)} 件(新規 {n_new})")
    jdump(cands, CANDIDATES)
    print(f"候補 {len(cands)} 件 → {CANDIDATES.relative_to(DATA.parent)}")
    log.save()


if __name__ == "__main__":
    main()
