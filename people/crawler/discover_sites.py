# -*- coding: utf-8 -*-
"""各社サイトの「役員一覧」「組織図」「IR ニュース」ページの URL 候補を自動で探す(SPEC §3.3「初回は Claude Code が候補を入れて人が確認」)。

手順(会社ごと): 公式サイトのトップ → リンク文字・URL に「役員/経営陣/executive/officer」を含むページ。
               無ければ「会社情報/企業情報/company/corporate/about」ページを 1 段たどって同じように探す。
               候補ページを取得し、役員の並び(役職 → 氏名)が 3 名以上読めたものを採用する。
結果: manual/ir_urls_auto.json(自動。confirmed: false)。人が確認したものは manual/ir_urls.json に移す(こちらが優先)。
取得は robots.txt を守り、1 ドメイン 2 秒以上あける(common.fetch)。会社ごとに並列(ドメインが違うので間隔の規則は保たれる)。

使い方: python discover_sites.py [--workers 12] [--only 会社名] [--redo]
"""
import argparse
import re
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

from common import DATA, MANUAL, RobotsDisallowed, fetch, jdump, jload, today

EXEC_WORDS = re.compile(r"(役員一覧|役員紹介|役員構成|役員体制|役員|経営陣|経営体制|マネジメント|取締役|executive|officer|management|board|leadership|yakuin)", re.I)
EXEC_BAD = re.compile(r"(報酬|持株|株主総会|招集|選任|ガバナンス報告|pdf$|\.pdf|news|release|recruit|採用|ir_news|topics|sustainab)", re.I)
CORP_WORDS = re.compile(r"(会社情報|企業情報|会社概要|会社案内|企業概要|会社について|私たちについて|company|corporate|about|profile|outline|gaiyou)", re.I)
ORG_WORDS = re.compile(r"(組織図|組織|organization|organisation|soshiki)", re.I)
NEWS_WORDS = re.compile(r"(IRニュース|IR情報|適時開示|ニュースリリース|IRライブラリ|ir/news|ir/library|/ir/|investor)", re.I)


def links(html, base):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    host = urllib.parse.urlsplit(base).netloc.replace("www.", "")
    out = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        url = urllib.parse.urljoin(base, href).split("#")[0]
        h = urllib.parse.urlsplit(url).netloc.replace("www.", "")
        if not h or (h != host and not h.endswith("." + host) and not host.endswith("." + h)):
            continue
        text = re.sub(r"\s+", " ", a.get_text(" ", strip=True))[:60]
        out.append((url, text))
    return out


GUESS_PATHS = ["/company/officer/", "/company/profile/officer/", "/company/profile/executive/", "/company/about/officer/",
               "/corporate/about/officer/", "/corporate/profile/officer/", "/company/overview/officer/", "/company/info/officer/",
               "/corporate/officers/", "/company/directors/", "/corporate/directors/", "/company/board/", "/about/management/", "/company/officers/", "/company/executive/", "/company/executives/", "/corporate/officer/",
               "/corporate/executive/", "/aboutus/officer/", "/aboutus/executive/", "/about/officer/", "/about/executive/",
               "/company/yakuin/", "/company/management/", "/corporate/management/", "/aboutus/management/", "/company/profile/officer/"]


def sitemap_urls(web, limit=30000):
    """robots.txt の Sitemap と /sitemap.xml を読み、URL を返す(入れ子は 6 つまで)。"""
    base = "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(web))
    maps = []
    try:
        txt, _ = fetch(base + "/robots.txt", timeout=20, respect_robots=False)
        maps += re.findall(r"(?im)^sitemap:\s*(\S+)", txt)
    except Exception:
        pass
    maps = maps or [base + "/sitemap.xml", base + "/sitemap_index.xml"]
    out, seen, n = [], set(), 0
    while maps and n < 10 and len(out) < limit:
        m = maps.pop(0)
        if m in seen:
            continue
        seen.add(m)
        n += 1
        try:
            xml, _ = fetch(m, timeout=30)
        except Exception:
            continue
        locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml)
        for u in locs:
            if u.endswith(".xml") or "sitemap" in u.rsplit("/", 1)[-1]:
                # 入れ子: 会社情報系のサイトマップを優先
                (maps.insert(0, u) if re.search(r"(company|corporate|about|page)", u, re.I) else maps.append(u))
            else:
                out.append(u)
    return out[:limit]


def rank_exec(url, text):
    s = 0
    if re.search(r"役員一覧|役員紹介|役員構成|役員体制", text):
        s += 6
    elif re.search(r"役員|経営陣|経営体制", text):
        s += 4
    elif EXEC_WORDS.search(text):
        s += 2
    if re.search(r"(officer|executive|yakuin|management|board|役員)", url, re.I):
        s += 3
    if EXEC_BAD.search(url) or EXEC_BAD.search(text):
        s -= 8
    if "/en/" in url or url.rstrip("/").endswith("/en") or "/english/" in url:
        s -= 6
    return s


def try_exec_page(url):
    from crawl_sites import parse_executives
    html, ct = fetch(url, timeout=30)
    if "html" not in (ct or "html"):
        return None, 0
    return html, len(parse_executives(html))


def discover(c):
    web = c.get("web")
    res = {"company_id": c["id"], "name": c["short_name"], "web": web, "executives": None, "organization": None, "news": None,
           "exec_count": 0, "checked_at": today(), "confirmed": False, "error": None}
    if not web:
        res["error"] = "公式サイト URL が企業マスタに無い"
        return res
    try:
        top, _ = fetch(web, timeout=30)
    except RobotsDisallowed:
        res["error"] = "robots.txt で禁止"
        return res
    except Exception as e:
        res["error"] = f"トップ取得失敗: {e}"[:200]
        return res
    cand = links(top, web)
    pages = [(web, cand)]
    # 会社情報ページを 1〜2 つたどる
    corp = sorted({u for u, t in cand if CORP_WORDS.search(t) or re.search(r"/(company|corporate|about|profile|kaisya|kigyo)", u, re.I)},
                  key=lambda u: (len(u), u))[:2]
    for u in corp:
        try:
            h, _ = fetch(u, timeout=30)
            pages.append((u, links(h, u)))
        except Exception:
            continue
    allc = {}
    for _, ls in pages:
        for u, t in ls:
            allc.setdefault(u, t)
    # トップのリンクが JS 描画で少ない会社: sitemap.xml と定番パスから候補を足す
    if not any(rank_exec(u, t) > 0 for u, t in allc.items()):
        for u in sitemap_urls(web):
            if re.search(r"(officer|executive|yakuin|management|board|leadership|役員)", u, re.I) and not EXEC_BAD.search(u):
                allc.setdefault(u, "役員(sitemap)")
        sp = urllib.parse.urlsplit(web)
        base = "{0.scheme}://{0.netloc}".format(sp)
        prefixes = {""}
        m = re.match(r"^(/(?:jp|ja|jpn|japan|ja-jp|jp/ja))(?:/|$)", sp.path)
        if m:
            prefixes.add(m.group(1))   # 「https://www.azbil.com/jp/」のような言語プレフィックス
        for pre in sorted(prefixes):
            for path in GUESS_PATHS:
                allc.setdefault(base + pre + path, "役員(定番パス)")
    execs = sorted(((rank_exec(u, t), u) for u, t in allc.items()), reverse=True)
    for sc, u in [x for x in execs if x[0] > 0][:4]:
        try:
            html, n = try_exec_page(u)
        except Exception:
            continue
        if n >= 3:
            res["executives"], res["exec_count"] = u, n
            break
    orgs = [u for u, t in allc.items() if ORG_WORDS.search(t) and not EXEC_BAD.search(u)]
    res["organization"] = orgs[0] if orgs else None
    news = [u for u, t in allc.items() if NEWS_WORDS.search(t) or NEWS_WORDS.search(u)]
    res["news"] = sorted(news, key=len)[0] if news else None
    if not res["executives"]:
        res["error"] = "役員一覧ページを見つけられない"
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--only")
    ap.add_argument("--redo", action="store_true")
    ap.add_argument("--list", help="この一覧(1 行 1 社名)の会社だけ探し直す")
    a = ap.parse_args()
    reg = jload(DATA / "companies.json")
    if not reg:
        sys.exit("先に registry.py")
    out_path = MANUAL / "ir_urls_auto.json"
    found = jload(out_path, {})
    only_list = set(open(a.list, encoding="utf-8").read().splitlines()) if a.list else None
    todo = [c for c in reg["companies"] if (not a.only or c["short_name"] == a.only) and (not only_list or c["short_name"] in only_list)
            and (a.redo or a.only or only_list or c["short_name"] not in found)]
    print(f"対象 {len(todo)} 社")
    done = 0
    with ThreadPoolExecutor(a.workers) as ex:
        futs = {ex.submit(discover, c): c for c in todo}
        for f in as_completed(futs):
            c = futs[f]
            try:
                r = f.result()
            except Exception as e:
                r = {"company_id": c["id"], "name": c["short_name"], "error": str(e)[:200], "executives": None, "checked_at": today()}
            found[c["short_name"]] = r
            done += 1
            print(f"[{done}/{len(todo)}] {c['short_name']}: {r.get('executives') or r.get('error')} ({r.get('exec_count', 0)})", flush=True)
            if done % 20 == 0:
                jdump(found, out_path)
    jdump(found, out_path)
    ok = sum(1 for r in found.values() if r.get("executives"))
    print(f"役員一覧を見つけた会社 {ok} / {len(found)}")


if __name__ == "__main__":
    main()
