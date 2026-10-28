# -*- coding: utf-8 -*-
"""SIer DB(site/robot-sier-map/data/siers.js)の 1,500 社の公式サイトから「事例」ページを見つけて候補に足す。

1. 各社のトップページを取得し、「事例・導入事例・納入実績・実績・ソリューション事例・case」のリンクを最大 2 本選ぶ(一覧ページ)
2. 一覧ページを取得し、同じパスの下の深いリンクを記事の候補にする(最大 40 本/社)
3. data/candidates.json に source key "sier:<id>" で足す。data/sier_sources.json に各社の取得元情報(名前・地域)を残す(classify / extract が参照)
robots.txt・2 秒間隔は common.fetch。使い方: python sier_discover.py [--limit N] [--workers 16] [--offset N]
"""
import argparse
import concurrent.futures as cf
import json
import re
import urllib.parse

from bs4 import BeautifulSoup

from common import DATA, SIER_DATA, RunLog, canon_url, domain_of, fetch, jdump, jload, today, RobotsDisallowed

LINK_TEXT = re.compile(r"導入事例|事例|納入実績|納入事例|実績紹介|製作実績|設備実績|ソリューション事例|case ?stud|works|showcase|実績", re.I)
LINK_HREF = re.compile(r"case|jirei|works|example|result|jisseki|solution|showcase|achievement", re.I)
SKIP = re.compile(r"recruit|採用|news|お知らせ|privacy|contact|お問い合わせ|company|会社|ir/|pdf$|\.pdf|login|mailto:|tel:", re.I)
# ロボット・ハンド・把持 の語(トップページにも事例一覧にも無い会社は、事例ページを候補にしない: 無関係なページが 9 割を占めていた)
ROBOT_TERMS = re.compile(r"ロボット|robot|ハンド|gripper|グリッパ|把持|吸着|協働|パレタイ|ピッキング|マニピュレータ|アーム", re.I)


def sier_list():
    s = SIER_DATA.read_text(encoding="utf-8")
    data = json.loads(s[s.index("=") + 1:].rstrip().rstrip(";"))
    return [c for c in data if c.get("website")]


def links(html, base):
    out = []
    for a in BeautifulSoup(html, "lxml").find_all("a", href=True):
        h = urllib.parse.urljoin(base, a["href"].strip()).split("#")[0]
        if h.startswith("http"):
            out.append((h, a.get_text(" ", strip=True)[:60]))
    return out


def discover(c, log):
    site = c["website"]
    dom = domain_of(site)
    try:
        html, ct, final, _ = fetch(site, timeout=25)
    except RobotsDisallowed:
        return c["id"], None, "robots"
    except Exception as e:
        return c["id"], None, f"top: {str(e)[:80]}"
    page_text = BeautifulSoup(html, "lxml").get_text(" ", strip=True)
    robot_site = bool(ROBOT_TERMS.search(page_text))
    idx = []
    for h, t in links(html, final):
        if domain_of(h) != dom or SKIP.search(h):
            continue
        if LINK_TEXT.search(t) or LINK_HREF.search(h.replace(final, "")):
            if h.rstrip("/") != final.rstrip("/") and h not in idx:
                idx.append(h)
    idx = idx[:2]
    if not idx:
        return c["id"], {"index": [], "articles": []}, "no-index"
    arts = []
    for u in idx:
        try:
            h2, ct2, f2, _ = fetch(u, timeout=25)
        except Exception as e:
            log.fail(c["name"], f"{u}: {str(e)[:80]}")
            continue
        base_path = urllib.parse.urlsplit(f2).path.rstrip("/")
        if not robot_site and not ROBOT_TERMS.search(BeautifulSoup(h2, "lxml").get_text(" ", strip=True)):
            continue   # トップにも事例一覧にもロボット・ハンドの語が無い
        robot_site = True
        for h, t in links(h2, f2):
            p = urllib.parse.urlsplit(h).path.rstrip("/")
            if domain_of(h) != dom or SKIP.search(h) or h.rstrip("/") == f2.rstrip("/"):
                continue
            # 一覧ページのパスの下で、1 段以上深いもの(例: /case/ → /case/abc/)
            if base_path and p.startswith(base_path + "/") and p.count("/") > base_path.count("/") and not re.search(r"/(page|category|tag)/", p):
                if h not in arts:
                    arts.append((0 if ROBOT_TERMS.search(t) else 1, h))   # リンク文字にロボットの語があるものを先に
        if len(arts) >= 40:
            break
    if not robot_site:
        return c["id"], {"index": idx, "articles": []}, "no-robot"
    arts = [h for _, h in sorted(arts, key=lambda x: x[0])]
    return c["id"], {"index": idx, "articles": arts[:40]}, "ok"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--workers", type=int, default=16)
    a = ap.parse_args()
    siers = sier_list()[a.offset:]
    if a.limit:
        siers = siers[: a.limit]
    log = RunLog("sier_discover")
    cands = jload(DATA / "candidates.json", {})
    srcs = jload(DATA / "sier_sources.json", {})
    done = jload(DATA / "sier_discover_done.json", {})
    todo = [c for c in siers if c["id"] not in done]
    counts, added = {}, 0
    with cf.ThreadPoolExecutor(a.workers) as ex:
        for cid, res, st in ex.map(lambda c: discover(c, log), todo):
            counts[st] = counts.get(st, 0) + 1
            done[cid] = {"status": st, "date": today(), "n": len(res["articles"]) if res else 0}
            if not res or not res["articles"]:
                continue
            c = next(x for x in siers if x["id"] == cid)
            key = f"sier:{cid}"
            srcs[key] = {"key": key, "label": c["name"], "type": "sier", "case_type": "sier_case", "region": "日本", "country": "日本", "lang": "ja",
                         "sier_db_id": cid, "index_urls": res["index"]}
            for u in res["articles"]:
                cu = canon_url(u)
                e = cands.setdefault(cu, {"url": u, "sources": [], "first_seen": today(), "text": ""})
                if key not in e["sources"]:
                    e["sources"].append(key)
                    added += 1
    jdump(cands, DATA / "candidates.json")
    jdump(srcs, DATA / "sier_sources.json")
    jdump(done, DATA / "sier_discover_done.json")
    print(counts, f"候補 +{added} 件(合計 {len(cands)})、事例ページのある SIer {len(srcs)} 社")
    log.save()


if __name__ == "__main__":
    main()
