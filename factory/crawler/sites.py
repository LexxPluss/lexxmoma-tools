# -*- coding: utf-8 -*-
"""公式サイトから「工場・事業所・拠点」のページを探して本文を保存する(韓国・台湾共通)。

  python sites.py tw [--limit N] [--workers 4] [--only 2330,2201]
  python sites.py kr ...

1. トップページを取り、サイト内リンクのうち拠点らしい語(사업장・공장・생산・Locations・廠區・據點・生產基地・公司簡介・關於 など)を含むものを候補にする
2. 候補ページ(最大 MAX_PAGES)を取り、本文テキスト(script/style/nav 除去)を raw/<cc>/sites/<会社id>/<n>.txt に保存。index.json に URL と見出しを残す
3. 本文に住所らしい文字列(韓国: 시/도+시군구+로/길, 台湾: 縣市+區+路/號)が何個あるかを数え、工場ページらしさの点数を付ける
robots.txt を守り、1 ドメイン 2 秒以上あける。JS 描画のサイトは本文が取れないので、その旨を index.json に残す(手動 URL は manual/<cc>_site_urls.json)。
"""
import argparse
import json
import re
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bs4 import BeautifulSoup
from common import DATA, MANUAL, RAW, RobotsDisallowed, fetch, jdump, jload, log_run, squash

MAX_PAGES = 10
KEYS = {
    "KR": r"사업장|공장|생산|제조|네트워크|network|location|사업소|사업부|지점|회사\s*소개|회사개요|기업개요|about|overview|사업\s*영역|plant|factory|site|오시는|찾아오시는|contact|global",
    "TW": r"廠|據點|基地|生產|製造|營運|location|network|關於|公司簡介|公司概況|集團簡介|about|overview|plant|factory|site|聯絡|contact|global|事業|營業據點|分公司|工廠",
}
ADDR = {
    "KR": r"(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)[^\n]{2,40}?(로|길|읍|면|동|리)\s*\d",
    "TW": r"(臺北|台北|新北|桃園|臺中|台中|臺南|台南|高雄|基隆|新竹|嘉義|苗栗|彰化|南投|雲林|屏東|宜蘭|花蓮|臺東|台東|澎湖|金門|連江)(市|縣)[^\n]{1,30}?(路|街|道|段)[^\n]{0,20}?號",
}
MIN_TEXT = 300      # これより本文が短ければ JS 描画とみなし Chromium で描画し直す


def render(url, cc):
    """Chromium で描画した HTML(render.js)。robots.txt の確認と待ち時間は fetch と同じ規律で行う。"""
    import os
    import subprocess
    from common import USER_AGENT, _robots_ok, polite_wait
    if not _robots_ok(url):
        raise RobotsDisallowed(url)
    polite_wait(url)
    env = dict(os.environ, FACTORY_UA=USER_AGENT, FACTORY_LOCALE="ko-KR" if cc == "KR" else "zh-TW")
    r = subprocess.run(["node", str(Path(__file__).resolve().parent / "render.js"), url], capture_output=True, text=True, timeout=120, env=env)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:200] or "render failed")
    return r.stdout


SKIP_EXT = re.compile(r"\.(pdf|jpg|jpeg|png|gif|zip|doc|docx|xls|xlsx|mp4|svg|css|js)(\?|$)", re.I)


def text_of(html):
    full = BeautifulSoup(html, "lxml")          # リンクはナビゲーションを含む全体から取る
    s = BeautifulSoup(html, "lxml")
    for t in s(["script", "style", "noscript", "iframe", "svg", "header", "footer", "nav"]):
        t.decompose()
    title = squash(s.title.get_text()) if s.title else ""
    txt = s.get_text("\n")
    txt = re.sub(r"[ \t\u3000]+", " ", txt)
    txt = re.sub(r"\n\s*\n+", "\n", txt).strip()
    return title, txt, full


def links_of(soup, base):
    out = []
    for a in soup.select("a[href]"):
        href = a.get("href", "").strip()
        if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
            continue
        u = urllib.parse.urljoin(base, href)
        u = u.split("#")[0]
        if SKIP_EXT.search(u):
            continue
        out.append((u, squash(a.get_text()) or squash(a.get("title", ""))))
    return out


def same_site(u, base):
    h1 = urllib.parse.urlsplit(u).netloc.lower().replace("www.", "")
    h2 = urllib.parse.urlsplit(base).netloc.lower().replace("www.", "")
    return h1 == h2 or h1.endswith("." + h2) or h2.endswith("." + h1)


def crawl(cc, co, manual_urls):
    out_dir = RAW / cc.lower() / "sites" / co["id"]
    idx_p = out_dir / "index.json"
    if idx_p.exists():
        return jload(idx_p)
    idx = {"id": co["id"], "name": co["name"], "web": co.get("web"), "pages": [], "note": None}
    keys = re.compile(KEYS[cc], re.I)
    addr = re.compile(ADDR[cc])
    seen, queue = set(), []
    for u in manual_urls.get(co["id"], []) + manual_urls.get(co.get("code") or "", []):
        queue.append((u, "manual", 100))
    base = co.get("web")
    if base:
        try:
            html, _ = fetch(base, timeout=45)
            title, txt, soup = text_of(html)
            if len(txt) < MIN_TEXT:
                html = render(base, cc); title, txt, soup = text_of(html); idx["rendered"] = True
            n_addr = len(addr.findall(txt))
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / "0.txt").write_text(txt, encoding="utf-8")
            idx["pages"].append({"n": 0, "url": base, "title": title, "chars": len(txt), "addrs": n_addr, "why": "top"})
            seen.add(base)
            cands = []
            for u, label in links_of(soup, base):
                if u in seen or not same_site(u, base):
                    continue
                hay = (label + " " + urllib.parse.unquote(u))
                m = keys.search(hay)
                if m:
                    score = 2 if re.search(r"사업장|공장|생산|廠|據點|基地|生產|plant|factory|location", hay, re.I) else 1
                    cands.append((u, label, score))
            cands.sort(key=lambda x: -x[2])
            for u, label, score in cands:
                if u not in seen and not any(u == q[0] for q in queue):
                    queue.append((u, label, score))
            if len(txt) < 200:
                idx["note"] = "top page has little text (JS rendered?)"
        except RobotsDisallowed:
            idx["note"] = "robots.txt disallows"
            jdump(idx, idx_p); return idx
        except Exception as e:
            idx["note"] = f"top fetch failed: {str(e)[:120]}"
    n = 1
    for u, label, score in queue[:MAX_PAGES * 2]:
        if n > MAX_PAGES:
            break
        if u in seen:
            continue
        seen.add(u)
        try:
            html, ct = fetch(u, timeout=45)
            if "html" not in ct and "<" not in html[:200]:
                continue
            title, txt, soup = text_of(html)
            if len(txt) < MIN_TEXT:
                try:
                    html = render(u, cc); title, txt, soup = text_of(html)
                except Exception:
                    pass
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / f"{n}.txt").write_text(txt, encoding="utf-8")
            idx["pages"].append({"n": n, "url": u, "title": title, "chars": len(txt), "addrs": len(addr.findall(txt)), "why": label})
            # 拠点ページの中のさらに下の階層(各工場の個別ページ)も少し辿る
            if score >= 2 and n <= 4:
                for u2, l2 in links_of(soup, u):
                    if u2 not in seen and same_site(u2, base or u) and keys.search(l2 + " " + urllib.parse.unquote(u2)) and len(queue) < MAX_PAGES * 3:
                        queue.append((u2, l2, 1))
            n += 1
        except RobotsDisallowed:
            idx["pages"].append({"n": None, "url": u, "why": label, "error": "robots"})
        except Exception as e:
            idx["pages"].append({"n": None, "url": u, "why": label, "error": str(e)[:100]})
    jdump(idx, idx_p)
    return idx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cc", choices=["tw", "kr"])
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    cc = a.cc.upper()
    cos = jload(DATA / a.cc / "companies.json", [])
    if a.only:
        keys = set(a.only.split(","))
        cos = [c for c in cos if c["id"] in keys or (c.get("code") or "") in keys or c["name"] in keys]
    if a.limit:
        cos = cos[:a.limit]
    manual_urls = jload(MANUAL / f"{a.cc}_site_urls.json", {})
    manual_urls = {k: v for k, v in manual_urls.items() if not k.startswith("_")}
    done = 0
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        for idx in ex.map(lambda c: crawl(cc, c, manual_urls), cos):
            done += 1
            best = max([p.get("addrs", 0) for p in idx["pages"]] or [0])
            print(f"  {idx['name']}: {len(idx['pages'])} pages, max addrs {best}{(' / ' + idx['note']) if idx.get('note') else ''}", flush=True)
    log_run(f"sites_{a.cc}", {"companies": done})


if __name__ == "__main__":
    main()
