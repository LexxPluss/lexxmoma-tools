# -*- coding: utf-8 -*-
"""適時開示(TDnet)の役員異動系 PDF の収集(SPEC §3.2)。

収集手段(§3.2 の優先順。§13-2 で正を決める):
 (a) JPX 適時開示情報閲覧サービス(https://www.release.tdnet.info/inbs/I_list_001_YYYYMMDD.html)。
     ※ 2026-09-30 確認: robots.txt が「User-agent: * / Disallow: /」で全体を禁止している。common.fetch は robots.txt を守るので
       (a) は取得できない(RobotsDisallowed)。SPEC §13-2 の判断事項として報告済み。実運用は (b) か、JPX との契約・公式配信で代替する。
     公式 API は無いが、直近 1 か月分の日別一覧が静的 HTML で公開されているのでこれを読む(毎日 06:00 JST 実行想定)。
     TODO(spec): 一覧ページの HTML 構造(td.kjCode / kjName / kjTitle)は 2026-09 時点の観察に基づく。変わったら parse_list() を直す。
 (b) 各社 IR ページ(crawl_sites.py が site_news_<date>.json に PDF リンクを書き出す) → --from-sites で取得。
 (c) 第三者ミラーは使わない(§13-2 の判断待ち)。

出力: raw/<cid>/tdnet_<date>_<id>.pdf, raw/<cid>/tdnet_<date>_<id>.json(parse_disclosure.py の結果), raw/<cid>/sources.json,
      パース失敗は raw/<cid>/manual_queue.json に raw_text 付きで積む。
"""
import argparse
import re
import sys
from datetime import date, timedelta
from pathlib import Path

from common import DATA, RAW, RunLog, append_source, fetch, jdump, jload, sha256_of, source_id, today
from parse_disclosure import parse_pdf

LIST_URL = "https://www.release.tdnet.info/inbs/I_list_{page:03d}_{ymd}.html"
PDF_BASE = "https://www.release.tdnet.info/inbs/"
KEYWORDS = ("役員", "人事", "代表取締役", "組織変更", "異動", "組織改正")


def parse_list(html):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    rows = []
    for tr in soup.find_all("tr"):
        code = tr.find("td", class_=re.compile("kjCode"))
        name = tr.find("td", class_=re.compile("kjName"))
        title = tr.find("td", class_=re.compile("kjTitle"))
        if not (code and title):
            continue
        a = title.find("a", href=True)
        rows.append({"code": code.get_text(strip=True), "name": name.get_text(strip=True) if name else "", "title": title.get_text(" ", strip=True),
                     "href": (a["href"] if a else None)})
    return rows


def fetch_day(ymd):
    out, page = [], 1
    while page < 30:
        try:
            html, _ = fetch(LIST_URL.format(page=page, ymd=ymd))
        except Exception:
            break
        rows = parse_list(html)
        if not rows:
            break
        out.extend(rows)
        if not re.search(r"I_list_%03d_%s" % (page + 1, ymd), html):
            break
        page += 1
    return out


def save_pdf(c, url, title, d, log):
    cdir = RAW / c["id"]
    cdir.mkdir(parents=True, exist_ok=True)
    key = re.sub(r"\W+", "", Path(url).stem)[-12:]
    pdf = cdir / f"tdnet_{d}_{key}.pdf"
    if pdf.with_suffix(".json").exists():
        return  # 冪等
    data, ct = fetch(url, binary=True)
    if not data[:5].startswith(b"%PDF"):
        raise ValueError(f"PDF ではない({ct})")
    pdf.write_bytes(data)
    r = parse_pdf(pdf)
    sid = source_id("tdnet", c["id"], url)
    append_source(cdir, {"id": sid, "company_id": c["id"], "kind": "tdnet", "title": title, "date": r.get("doc_date") or d, "url": url,
                         "retrieved_at": today(), "raw_path": str(pdf.relative_to(RAW.parent)), "hash": sha256_of(data)})
    r["source_id"] = sid
    r["url"] = url
    jdump(r, pdf.with_suffix(".json"))
    if not r["parse_ok"]:
        q = jload(cdir / "manual_queue.json", [])
        q.append({"date": d, "title": title, "url": url, "source_id": sid, "reason": "新旧役職の表を読めない", "raw_text": r["raw_text"][:20000]})
        jdump(q, cdir / "manual_queue.json")
        log.fail(c["id"], f"パース失敗 → 手動確認キュー: {title}", needs_manual=True)
    else:
        log.ok(c["id"], f"{title}: {len(r['items'])} 行(有効 {r['effective']})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--companies", default=str(DATA / "companies.json"))
    ap.add_argument("--days", type=int, default=1, help="今日から遡る日数(JPX の一覧は約 1 か月分)")
    ap.add_argument("--from-sites", action="store_true", help="crawl_sites.py が見つけた各社 IR ページの PDF を取る")
    ap.add_argument("--only")
    a = ap.parse_args()
    reg = jload(a.companies)
    if not reg:
        sys.exit("data/companies.json が無い。先に registry.py")
    cos = [c for c in reg["companies"] if not a.only or c["id"] == a.only]
    log = RunLog("crawl_tdnet")
    if a.from_sites:
        for c in cos:
            for f in sorted((RAW / c["id"]).glob("site_news_*.json")) if (RAW / c["id"]).exists() else []:
                for link in jload(f).get("pdf_links", []):
                    try:
                        save_pdf(c, link["url"], link["title"], f.stem.split("_")[-1], log)
                    except Exception as e:
                        log.fail(c["id"], f"{link['url']}: {e}")
        log.save()
        return
    by_sec = {c["securities_code"]: c for c in cos if c.get("securities_code")}
    for i in range(a.days):
        day = date.today() - timedelta(days=i)
        ymd = day.strftime("%Y%m%d")
        rows = fetch_day(ymd)
        hit = 0
        for r in rows:
            c = by_sec.get(r["code"][:4])
            if not c or not any(k in r["title"] for k in KEYWORDS) or not r["href"]:
                continue
            hit += 1
            url = r["href"] if r["href"].startswith("http") else PDF_BASE + r["href"]
            try:
                save_pdf(c, url, r["title"], day.isoformat(), log)
            except Exception as e:
                log.fail(c["id"], f"{r['title']}: {e}")
        print(f"{day}: 開示 {len(rows)} 件 / 対象 {hit} 件")
    log.save()


if __name__ == "__main__":
    main()
