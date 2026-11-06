# -*- coding: utf-8 -*-
"""韓国: 会社マスタ。金融監督院 DART(전자공시시스템)の「기업개황 → 업종별」検索(robots.txt で許可された /dsae001/search.ax と select.ax)から
上場(유가증권시장 KOSPI・코스닥 KOSDAQ)の製造業を集め、業種の枠(manual/kr_quota.json)で選ぶ。目標 250 社。

出所: https://dart.fss.or.kr/dsae001/main.do(기업개황)。会社ごとの概況(select.ax)に 주소・홈페이지・업종명・법인구분 がある。
規模の指標が DART の一覧には無いので、KOSPI 200 構成銘柄(위키백과)→ KOSPI → KOSDAQ の順を優先する。
"""
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bs4 import BeautifulSoup
from common import DATA, MANUAL, RAW, company_id, fetch, jdump, jload, log_run, squash, today
from normalize import company

SEARCH = "https://dart.fss.or.kr/dsae001/search.ax"
SELECT = "https://dart.fss.or.kr/dsae001/select.ax"
KOSPI200 = "https://ko.wikipedia.org/wiki/%EC%BD%94%EC%8A%A4%ED%94%BC_200"

# 한국표준산업분류(KSIC) コード → 日本の 11 区分。長いコードを優先して当てる
KSIC = {
    "301": "自動車(完成車)", "302": "自動車部品", "303": "自動車部品", "304": "自動車部品",
    "261": "半導体・電子部品", "262": "半導体・電子部品", "263": "電機・精密", "264": "電機・精密", "265": "電機・精密", "266": "電機・精密",
    "271": "医薬・医療", "272": "電機・精密", "273": "電機・精密", "274": "電機・精密",
    "281": "電機・精密", "282": "電機・精密", "283": "電機・精密", "284": "電機・精密", "285": "電機・精密", "289": "電機・精密",
    "291": "産業機械・ロボット", "292": "産業機械・ロボット", "2922": "工作機械", "29271": "半導体製造装置", "29272": "半導体製造装置", "2928": "産業機械・ロボット",
    "20": "化学・素材", "22": "化学・素材", "23": "化学・素材", "17": "化学・素材", "13": "化学・素材", "19": "化学・素材",
    "24": "鉄鋼・非鉄", "25": "鉄鋼・非鉄",
    "10": "食品・飲料", "11": "食品・飲料",
    "21": "医薬・医療",
}
SEARCH_CODES = ["301", "302", "303", "304", "261", "262", "263", "264", "265", "266", "271", "272", "273", "274", "281", "282", "283", "284", "285", "289",
                "291", "292", "20", "22", "23", "17", "13", "19", "24", "25", "10", "11", "21"]
FINE_CODES = ["2922", "29271", "29272", "2928"]   # 3 桁の中の細分(工作機械・半導体製造装置・ロボット)


def search(code):
    """業種コードで上場会社(KOSPI・KOSDAQ)を全ページ取る。戻り値: [(market, corpKey, name, stockCode)]"""
    out, page = [], 1
    while True:
        data = [("currentPage", page), ("maxResults", 100), ("maxLinks", 10), ("sort", ""), ("series", ""), ("gubun", ""), ("selectKey", ""), ("searchIndex", ""),
                ("textCrpCik", ""), ("autoSearch", "true"), ("businessCode", code), ("bsnRgsNo", ""), ("corpTypeAll", ""), ("autoSearchCorp", "Y"), ("searchType", "1"),
                ("textCrpNm", ""), ("crpRgsNo", ""), ("corpType", "P"), ("corpType", "A")]
        cp = RAW / "kr" / "dart_search" / f"{code}_{page}.html"
        if cp.exists():
            body = cp.read_text(encoding="utf-8")
        else:
            body, _ = fetch(SEARCH, method="POST", data=data, respect_robots=True)
            cp.parent.mkdir(parents=True, exist_ok=True)
            cp.write_text(body, encoding="utf-8")
        s = BeautifulSoup(body, "lxml")
        rows = 0
        for tr in s.select("#corpTable tbody tr"):
            a = tr.select_one("a[href*='select(']")
            if not a:
                continue
            tag = tr.select_one("span[class^=tagCom_]")
            market = (tag["class"][0] if tag else "").replace("tagCom_", "")
            key = re.search(r"select\('(\d+)'\)", a["href"]).group(1)
            tds = tr.select("td")
            stock = squash(tds[-1].get_text()) if tds else ""
            out.append((market, key, squash(a.get_text()), stock))
            rows += 1
        m = re.search(r"\[(\d+)/(\d+)\]", s.get_text())
        if not m or int(m.group(1)) >= int(m.group(2)) or rows == 0:
            break
        page += 1
    return out


def overview(key):
    """会社概況(select.ax): 주소・홈페이지・업종명・법인구분・영문명・설립일"""
    p = RAW / "kr" / "dart_select" / f"{key}.html"
    if p.exists():
        body = p.read_text(encoding="utf-8")
    else:
        body, _ = fetch(SELECT, method="POST", data={"selectKey": key}, respect_robots=True)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
    s = BeautifulSoup(body, "lxml")
    kv = {}
    for th in s.select("th"):
        td = th.find_next_sibling("td")
        if td:
            kv[squash(th.get_text())] = squash(td.get_text())
    return kv


def kospi200():
    p = RAW / "kr" / f"kospi200_{today()}.html"
    if p.exists():
        body = p.read_text(encoding="utf-8")
    else:
        body, _ = fetch(KOSPI200, respect_robots=True)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
    s = BeautifulSoup(body, "lxml")
    out = {}
    for t in s.select("table.wikitable"):
        for tr in t.select("tr")[1:]:
            c = [x.get_text(" ", strip=True) for x in tr.select("td")]
            if len(c) >= 2 and re.fullmatch(r"\d{6}", c[1]):
                out[c[1]] = c[2] if len(c) > 2 else ""
    return out


def industry_of(code):
    for n in (5, 4, 3, 2):
        if code[:n] in KSIC:
            return KSIC[code[:n]]
    return None


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-overview", action="store_true", help="概況(select.ax)を取らずに候補だけ作る")
    a = ap.parse_args()
    cand = {}   # corpKey → {...}
    for code in SEARCH_CODES + FINE_CODES:
        rows = search(code)
        for market, key, name, stock in rows:
            c = cand.setdefault(key, {"key": key, "name": name, "stock": stock, "market": market, "codes": []})
            c["codes"].append(code)
        print(f"  {code}: {len(rows)} 社", flush=True)
    for c in cand.values():
        fine = [x for x in c["codes"] if x in FINE_CODES]
        c["ksic"] = max(fine, key=len) if fine else max(c["codes"], key=len)
        c["industry"] = industry_of(c["ksic"])
    k200 = kospi200()
    over = jload(MANUAL / "kr_industry.json", {})      # 종목코드 → 業種(null は除外)
    quota = jload(MANUAL / "kr_quota.json", {})
    rows = []
    for c in cand.values():
        if c["stock"] in over:
            if over[c["stock"]] is None:
                continue
            c["industry"] = over[c["stock"]]
        if not c["industry"] or c["market"] not in ("kospi", "kosdaq"):
            continue
        c["prio"] = (0 if c["stock"] in k200 else 1 if c["market"] == "kospi" else 2, c["name"])
        rows.append(c)
    rows.sort(key=lambda c: c["prio"])
    jdump(rows, DATA / "kr" / "candidates.json", compact=True)
    from rounds import pick
    picked, info = pick("kr", rows, quota, lambda c: company_id("KR", c["name"]), lambda c: c["industry"])
    cnt = {}
    for c in picked:
        cnt[c["industry"]] = cnt.get(c["industry"], 0) + 1
    print("回の入れ替え:", info)
    print(f"候補 {len(rows)} 社 → 選定 {len(picked)} 社", cnt, flush=True)
    if a.no_overview:
        return
    companies, fails = [], []
    for i, c in enumerate(picked):
        try:
            kv = overview(c["key"])
        except Exception as e:
            fails.append({"name": c["name"], "error": str(e)[:200]}); continue
        web = kv.get("홈페이지") or kv.get("IR홈페이지") or ""
        if web and not web.startswith("http"):
            web = "https://" + web
        legal = kv.get("회사이름") or c["name"]
        listed = "KOSPI" if c["market"] == "kospi" else "KOSDAQ"
        co = company("KR", c["name"], legal=legal, industry=c["industry"], listed=listed, hq=kv.get("주소"), web=web or None, nameEn=kv.get("영문명"), code=c["stock"])
        co["indLocal"] = kv.get("업종명")
        co["ksic"] = c["ksic"]
        co["dartKey"] = c["key"]
        co["masterSrc"] = "https://dart.fss.or.kr/dsae001/main.do"
        co["est"] = kv.get("설립일")
        companies.append(co)
        if (i + 1) % 25 == 0:
            print(f"  概況 {i + 1}/{len(picked)}", flush=True)
            jdump(companies, DATA / "kr" / "companies.json")
    jdump(companies, DATA / "kr" / "companies.json")
    print("会社マスタ", len(companies), "社、失敗", len(fails))
    log_run("kr_registry", {"candidates": len(rows), "picked": len(picked), "companies": len(companies)}, fails)


if __name__ == "__main__":
    main()
