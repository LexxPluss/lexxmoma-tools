# -*- coding: utf-8 -*-
"""台湾: 会社マスタ。臺灣證券交易所(上市)と櫃買中心(上櫃)の OpenAPI(公開情報)から製造業を選ぶ。

出所: https://openapi.twse.com.tw/v1/opendata/t187ap03_L(上市公司基本資料)
      https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O(上櫃公司基本資料)
業種は 產業別 コード → 日本の 11 区分に対応(manual/tw_industry.json で個別に上書き)。
規模は実収資本額で並べ、業種ごとの枠(manual/tw_quota.json)で上位から選ぶ。目標 150 社。
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATA, MANUAL, RAW, cached_fetch, jdump, jload, log_run, nfkc, squash, today
from normalize import company

TWSE = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L"
TPEX = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O"

# 產業別 コード(證交所・櫃買中心 共通)→ 日本の 11 区分(None は対象外)
IND = {
    "01": "化学・素材",        # 水泥
    "02": "食品・飲料",        # 食品
    "03": "化学・素材",        # 塑膠
    "04": "化学・素材",        # 紡織纖維
    "05": "産業機械・ロボット",  # 電機機械
    "06": "電機・精密",        # 電器電纜
    "08": "化学・素材",        # 玻璃陶瓷
    "09": "化学・素材",        # 造紙
    "10": "鉄鋼・非鉄",        # 鋼鐵
    "11": "化学・素材",        # 橡膠
    "12": "自動車部品",        # 汽車
    "21": "化学・素材",        # 化學
    "22": "医薬・医療",        # 生技醫療
    "24": "半導体・電子部品",   # 半導體
    "25": "電機・精密",        # 電腦及週邊設備
    "26": "半導体・電子部品",   # 光電
    "27": "電機・精密",        # 通信網路
    "28": "半導体・電子部品",   # 電子零組件
    "31": "電機・精密",        # 其他電子
}
IND_NAME = {"01": "水泥", "02": "食品", "03": "塑膠", "04": "紡織纖維", "05": "電機機械", "06": "電器電纜", "08": "玻璃陶瓷", "09": "造紙", "10": "鋼鐵",
            "11": "橡膠", "12": "汽車", "21": "化學", "22": "生技醫療", "24": "半導體", "25": "電腦及週邊", "26": "光電", "27": "通信網路", "28": "電子零組件", "31": "其他電子"}


def load_lists():
    twse = json.loads(cached_fetch(TWSE, RAW / "tw" / f"twse_t187ap03_L_{today()}.json", respect_robots=False))
    tpex = json.loads(cached_fetch(TPEX, RAW / "tw" / f"tpex_t187ap03_O_{today()}.json", respect_robots=False))
    rows = []
    for r in twse:
        rows.append({"code": r["公司代號"], "legal": r["公司名稱"], "name": r["公司簡稱"], "ind": r["產業別"].strip(), "hq": r["住址"], "web": r.get("網址"),
                     "cap": int(r.get("實收資本額") or 0), "est": r.get("成立日期"), "nameEn": r.get("英文簡稱"), "listed": "上市", "foreign": r.get("外國企業註冊地國", "").strip(" －-"),
                     "src": TWSE})
    for r in tpex:
        rows.append({"code": r["SecuritiesCompanyCode"], "legal": r["CompanyName"], "name": r["CompanyAbbreviation"], "ind": r["SecuritiesIndustryCode"].strip(), "hq": r.get("Address"),
                     "web": r.get("WebAddress") or r.get("Website") or r.get("網址"), "cap": int(r.get("Paidin.Capital.NTDollars") or 0), "est": r.get("DateOfIncorporation"),
                     "nameEn": r.get("EnglishAbbreviation") or r.get("EnglishName"), "listed": "上櫃", "foreign": (r.get("Registration") or "").strip(" －-"), "src": TPEX})
    return rows


def main():
    rows = load_lists()
    over = jload(MANUAL / "tw_industry.json", {})          # 公司代號 → 業種(個別の上書き)。null なら除外
    quota = jload(MANUAL / "tw_quota.json", {})
    exclude = set(jload(MANUAL / "tw_exclude.json", []))
    cands = []
    for r in rows:
        if r["code"] in exclude or r["foreign"]:            # 外国企業(KY 株)は台湾に工場が無いことが多いので除く
            continue
        ind = over.get(r["code"], IND.get(r["ind"]))
        if ind is None or r["code"] in over and over[r["code"]] is None:
            continue
        r["industry"] = ind
        cands.append(r)
    cands.sort(key=lambda r: -r["cap"])
    picked, cnt = [], {}
    for r in cands:
        q = quota.get(r["industry"], 0)
        if cnt.get(r["industry"], 0) >= q:
            continue
        cnt[r["industry"]] = cnt.get(r["industry"], 0) + 1
        picked.append(r)
    companies = []
    for r in picked:
        legal = squash(r["legal"])
        name = re.sub(r"股份有限公司$", "", legal) if len(squash(r["name"])) <= 2 else squash(r["name"])
        web = (r.get("web") or "").strip()
        if web and not web.startswith("http"):
            web = "https://" + web
        c = company("TW", name, legal=legal, industry=r["industry"], listed=r["listed"], hq=r["hq"], web=web or None, nameEn=r.get("nameEn"), code=r["code"])
        c["indLocal"] = IND_NAME.get(r["ind"], r["ind"])
        c["cap"] = r["cap"]
        c["masterSrc"] = r["src"]
        companies.append(c)
    jdump(companies, DATA / "tw" / "companies.json")
    jdump(cands, DATA / "tw" / "candidates.json", compact=True)
    print(f"候補 {len(cands)} 社 → 選定 {len(companies)} 社", cnt)
    log_run("tw_registry", {"candidates": len(cands), "picked": len(companies)})


if __name__ == "__main__":
    main()
