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
    if "<urlset" in (html or "")[:2000]:   # <?xml 宣言の無い sitemap もある(ループ 10: asa-automation.com)
        # sitemap.xml(index_urls に書ける。Photoneo・myrobotsolution のように一覧ページが JS 描画でも sitemap は素の XML)
        return [(m.group(1).strip(), "") for m in re.finditer(r"<loc>\s*([^<\s]+)\s*</loc>", html)]
    s = BeautifulSoup(html, "lxml")
    b = s.find("base", href=True)   # <base href> があれば相対リンクはそこを基準に(ループ 10)
    if b:
        base_url = urllib.parse.urljoin(base_url, b["href"].strip())
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


SEARCH_SOURCES = DATA / "search_sources.json"
REGION_OF = {"japan": "日本", "jp": "日本", "日本": "日本", "na": "北米", "us": "北米", "北米": "北米", "eu": "欧州", "europe": "欧州", "欧州": "欧州",
             "cn": "中国", "china": "中国", "中国": "中国", "asia": "その他アジア", "その他アジア": "その他アジア", "other": "その他", "その他": "その他"}


def from_search(cands, log):
    """Web 検索で見つけた候補(data/search_result_*.json: [{url, title, region, category_hint, robot_hint, query}])を候補に足す。
    取得元は search:<ファイルの tag>(種別 discovery)。事例の地域は結果の region から。採用の判断は crawl → extract → classify → 画像 → LLM レビューで行う。"""
    srcs = jload(SEARCH_SOURCES, {})
    added, files = 0, 0
    for p in sorted(DATA.glob("search_result_*.json")):
        tag = p.stem.replace("search_result_", "")
        try:
            rows = jload(p, [])
        except Exception as e:
            log.fail(p.name, e)
            continue
        if not isinstance(rows, list):
            continue
        files += 1
        key = f"search:{tag}"
        region = REGION_OF.get((rows[0].get("region") if rows else "") or tag.split("_")[0].lower(), "その他")
        srcs[key] = {"key": key, "label": f"ウェブ検索による発掘({tag})", "type": "discovery", "case_type": "sier_case", "region": region,
                     "country": None, "lang": "ja" if region == "日本" else ("zh" if region == "中国" else "en"), "index_urls": []}
        for r in rows:
            u = (r.get("url") or "").strip()
            if not u.startswith("http") or u.lower().endswith(".pdf"):
                continue
            c = canon_url(u)
            e = cands.setdefault(c, {"url": u, "sources": [], "first_seen": today(), "text": (r.get("title") or "")[:120]})
            if key not in e["sources"]:
                e["sources"].append(key)
                e["hints"] = {k: r.get(k) for k in ("region", "category_hint", "robot_hint", "query") if r.get(k)}
                e["hints"]["region_ja"] = REGION_OF.get(str(r.get("region") or "").lower(), REGION_OF.get(str(r.get("region") or ""), region))
                added += 1
    jdump(srcs, SEARCH_SOURCES)
    print(f"検索結果 {files} ファイル → 候補 +{added} 件")
    return added


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", nargs="*")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--from-search", action="store_true", help="data/search_result_*.json(Web 検索の結果)を候補に取り込む")
    a = ap.parse_args()
    if a.from_search:
        log = RunLog("discover-search")
        cands = jload(CANDIDATES, {})
        from_search(cands, log)
        jdump(cands, CANDIDATES)
        print(f"候補 {len(cands)} 件 → {CANDIDATES.relative_to(DATA.parent)}")
        log.save()
        return
    sources = load_sources()
    keys = a.source or [k for k, s in sources.items() if s.get("status") == "ok" and s.get("index_urls")]   # 検索・SIer 発見の取得元(一覧ページ無し)は飛ばす
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
