# -*- coding: utf-8 -*-
"""ウィキペディア(韓国語版・中国語版)の会社記事: 売上高・従業員数(情報ボックス)と本文(工場・事業所の記述)を保存する。

公式サイトが取れない会社の補助情報源(srcType = public)。記事の URL を出所に残す。記事ページ(/wiki/...)だけを取り、API(/w/)は使わない(robots.txt)。
  python wiki.py tw|kr [--only ...]
"""
import argparse
import re
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bs4 import BeautifulSoup
from common import DATA, RAW, fetch, jdump, jload, log_run, squash, to_int

LANG = {"TW": "zh", "KR": "ko"}


def titles(cc, c):
    t = [c["name"], c["legal"]]
    if cc == "TW":
        t += [re.sub(r"股份有限公司$", "", c["legal"]), c["legal"].replace("台", "臺"), c["name"].replace("台", "臺")]
    if cc == "KR":
        t += [re.sub(r"\(주\)|주식회사", "", c["legal"]).strip(), c["name"].replace(" ", "")]
    out = []
    for x in t:
        x = squash(x)
        if x and x not in out:
            out.append(x)
    return out


def parse(cc, html, url):
    s = BeautifulSoup(html, "lxml")
    if cc == "TW":
        pass
    ib = s.select_one("table.infobox")
    info = {}
    if ib:
        for tr in ib.select("tr"):
            if tr.th and tr.td:
                info[squash(tr.th.get_text(" "))] = squash(tr.td.get_text(" "))
    body = s.select_one("#mw-content-text")
    for t in body(["script", "style", "sup", "table.navbox", ".reflist", ".mw-editsection"]) if body else []:
        t.decompose()
    text = re.sub(r"\n\s*\n+", "\n", body.get_text("\n")).strip() if body else ""
    out = {"url": url, "title": squash(s.select_one("h1").get_text()) if s.select_one("h1") else "", "info": info, "chars": len(text)}
    # 売上高・従業員数(億の単位に直す。韓国: 조=兆, 억=億 / 台湾: 兆・億 新臺幣)
    for k, v in info.items():
        if re.search(r"매출|營業額|营业额|營收|收入", k) and "rev" not in out:
            out["revRaw"] = v
            m = re.search(r"([\d.,]+)\s*조(?:\s*([\d.,]+)\s*억)?", v) if cc == "KR" else re.search(r"([\d.,]+)\s*(兆|億)", v)
            if m:
                if cc == "KR":
                    rev = float(m.group(1).replace(",", "")) * 10000 + (float(m.group(2).replace(",", "")) if m.group(2) else 0)
                else:
                    rev = float(m.group(1).replace(",", "")) * (10000 if m.group(2) == "兆" else 1)
                out["rev"] = round(rev, 1)
            elif cc == "KR" and re.search(r"([\d.,]+)\s*억", v):
                out["rev"] = round(float(re.search(r"([\d.,]+)\s*억", v).group(1).replace(",", "")), 1)
            y = re.search(r"(20\d\d)", v)
            if y:
                out["revFy"] = y.group(1) + "年"
        if re.search(r"직원|종업원|員工|员工|雇员", k) and "emp" not in out:
            out["empRaw"] = v
            m = re.search(r"(\d[\d,]{2,})", v)
            if m:
                out["emp"] = int(m.group(1).replace(",", ""))
    return out, text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cc", choices=["tw", "kr"])
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    cc = a.cc.upper()
    lang = LANG[cc]
    cos = jload(DATA / a.cc / "companies.json", [])
    if a.only:
        keys = set(a.only.split(","))
        cos = [c for c in cos if c["id"] in keys or (c.get("code") or "") in keys or c["name"] in keys]
    found = 0
    for c in cos:
        out_dir = RAW / a.cc / "wiki" / c["id"]
        if (out_dir / "info.json").exists():
            found += 1 if jload(out_dir / "info.json").get("url") else 0
            continue
        res, text = None, ""
        for t in titles(cc, c):
            url = f"https://{lang}.wikipedia.org/wiki/" + urllib.parse.quote(t.replace(" ", "_"))
            try:
                html, _ = fetch(url, timeout=45)
            except Exception as e:
                if "404" in str(e):
                    continue
                res = {"error": str(e)[:120]}; break
            if 'id="disambigbox"' in html or "dmbox" in html or "ambox-disambig" in html:   # 曖昧さ回避ページ(他ページへのリンクの mw-disambig は無視)
                continue
            res, text = parse(cc, html, url)
            # 会社の記事か(情報ボックスに会社らしい項目があるか)
            if not any(re.search(r"本社|본사|總部|总部|산업|產業|产业|설립|成立|創立|創辦", k) for k in res["info"]):
                res = None; continue
            break
        if res and res.get("error"):
            print(f"  {c['name']}: ERR {res['error']}", flush=True); continue   # 一時的な失敗は保存しない(次回やり直す)
        out_dir.mkdir(parents=True, exist_ok=True)
        jdump(res or {"url": None}, out_dir / "info.json")
        if text:
            (out_dir / "article.txt").write_text(text, encoding="utf-8")
        if res and res.get("url"):
            found += 1
        print(f"  {c['name']}: {(res or {}).get('url') or '-'}  rev={(res or {}).get('rev')} emp={(res or {}).get('emp')}", flush=True)
    print(f"記事あり {found}/{len(cos)}")
    log_run(f"wiki_{a.cc}", {"companies": len(cos), "found": found})


if __name__ == "__main__":
    main()
