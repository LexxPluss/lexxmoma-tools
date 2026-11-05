# -*- coding: utf-8 -*-
"""スキーマ(日本の工場マップと同じ)への正規化と検査。

会社: id name legal industry group parent listed rev revFy revUrl emp hq web  + country nameEn nameJa
工場: id cid oid op name addr pref city prod seg area floor emp empAsof est src src2 srcType lat lng prec + country nameEn opEn srcLabel
"""
import re
from common import INDUSTRIES, company_id, factory_id, nfkc, squash, to_int

COMPANY_KEYS = ["id", "name", "legal", "industry", "group", "parent", "listed", "rev", "revFy", "revUrl", "emp", "hq", "web",
                "country", "nameEn", "nameJa", "code"]
FACTORY_KEYS = ["id", "cid", "oid", "op", "name", "addr", "pref", "city", "prod", "seg", "area", "floor", "emp", "empAsof", "est",
                "src", "src2", "srcType", "srcLabel", "lat", "lng", "prec", "country", "nameEn", "opEn", "fix"]

# ---------------------------------------------------------------- 住所 → 都道府県相当・市区町村相当
KR_PREF = ["서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시", "울산광역시", "세종특별자치시",
           "경기도", "강원특별자치도", "강원도", "충청북도", "충청남도", "전북특별자치도", "전라북도", "전라남도", "경상북도", "경상남도", "제주특별자치도"]
KR_SHORT = {"서울": "서울특별시", "부산": "부산광역시", "대구": "대구광역시", "인천": "인천광역시", "광주": "광주광역시", "대전": "대전광역시",
            "울산": "울산광역시", "세종": "세종특별자치시", "경기": "경기도", "강원": "강원특별자치도", "충북": "충청북도", "충남": "충청남도",
            "전북": "전북특별자치도", "전남": "전라남도", "경북": "경상북도", "경남": "경상남도", "제주": "제주특별자치도"}
KR_RENAME = {"강원도": "강원특별자치도", "전라북도": "전북특별자치도"}
TW_PREF = ["臺北市", "台北市", "新北市", "桃園市", "臺中市", "台中市", "臺南市", "台南市", "高雄市", "基隆市", "新竹市", "嘉義市",
           "新竹縣", "苗栗縣", "彰化縣", "南投縣", "雲林縣", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "台東縣", "澎湖縣", "金門縣", "連江縣"]
TW_RENAME = {"台北市": "臺北市", "台中市": "臺中市", "台南市": "臺南市", "台東縣": "臺東縣"}


def clean_addr(country, addr):
    a = squash(addr)
    a = re.sub(r"^\(?\d{3}(?:-?\d{2,3})?\)?\s*", "", a)       # 郵便番号(韓国 5 桁 / 台湾 3〜6 桁)
    a = re.sub(r"^\(?(우|郵遞區號)\s*[:：]?\s*\d{3,6}\)?\s*", "", a)
    a = re.sub(r"^(대한민국|한국|台灣|臺灣|中華民國)\s*", "", a)
    if country == "KR":
        a = re.sub(r"\s*\([^)]*\)\s*$", "", a)                      # 末尾の括弧(법정동・건물명)は残さない
    return a.strip(" ,")


def split_admin(country, addr):
    """住所の先頭から 1 次(都道府県相当)と 2 次(市区町村相当)を取り出す。"""
    a = clean_addr(country, addr)
    if country == "KR":
        pref = city = None
        for p in KR_PREF:
            if a.startswith(p):
                pref = p; rest = a[len(p):].strip(); break
        else:
            m = re.match(r"^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\s", a)
            if m:
                pref = KR_SHORT[m.group(1)]; rest = a[m.end():].strip()
            else:
                rest = a
        pref = KR_RENAME.get(pref, pref)
        m = re.match(r"^(\S+?(?:시|군|구))(?=\s|$)(?:\s+(\S+(?:구|군))(?=\s|$))?", rest)
        if m:
            city = m.group(1) + (" " + m.group(2) if m.group(2) and m.group(1).endswith("시") else "")
        return pref, city
    if country == "TW":
        pref = city = None
        for p in TW_PREF:
            if a.startswith(p):
                pref = TW_RENAME.get(p, p); rest = a[len(p):].strip(); break
        else:
            rest = a
        m = re.match(r"^([^\d\s]{1,4}?(?:區|鄉|鎮|市))", rest)
        if m:
            city = m.group(1)
        return pref, city
    return None, None


# ---------------------------------------------------------------- 業種
def map_industry(country, code_or_text, products=""):
    """各国の業種区分・製品説明 → 日本の 11 区分。manual/industry_map.json を優先し、無ければ語で判定。"""
    t = (nfkc(code_or_text) + " " + nfkc(products)).lower()
    rules = [
        ("自動車(完成車)", r"완성차|자동차 제조|승용차|상용차|汽車製造|整車|automobile manufactur|motor corp|自動車\(完成車\)"),
        ("半導体製造装置", r"반도체 장비|반도체장비|半導體設備|半導體製程設備|semiconductor equipment|wafer fab equipment|探針|晶圓設備"),
        ("半導体・電子部品", r"반도체|전자부품|디스플레이|mlcc|pcb|半導體|電子零組件|面板|被動元件|印刷電路板|光電|ic design|foundry|封測|記憶體|led"),
        ("自動車部品", r"자동차 부품|자동차부품|차량 부품|타이어|汽車零件|汽車零組件|車用|輪胎|auto parts|automotive"),
        ("工作機械", r"공작기계|工具機|機床|machine tool|切削|cnc"),
        ("産業機械・ロボット", r"기계|로봇|産業機械|機械設備|機械|robot|automation|自動化|建設기계|重工|重機|幫浦|壓縮機|電動工具"),
        ("電機・精密", r"전기|전자|가전|정밀|電機|電子|家電|精密|光學|電線電纜|電源|連接器|computer|電腦|通信|camera"),
        ("化学・素材", r"화학|소재|석유화학|플라스틱|섬유|고무|시멘트|유리|化學|塑膠|橡膠|纖維|材料|玻璃|水泥|紡織|造紙|油電|石化|chemical|material"),
        ("鉄鋼・非鉄", r"철강|비철|금속|제강|鋼鐵|金屬|鋁|銅|steel|metal|alloy"),
        ("食品・飲料", r"식품|음료|제과|주류|食品|飲料|農業|畜牧|food|beverage|dairy"),
        ("医薬・医療", r"제약|의약|바이오|의료|生技|醫療|製藥|藥品|pharma|bio|medical"),
    ]
    for ind, pat in rules:
        if re.search(pat, t):
            return ind
    return None


# ---------------------------------------------------------------- 正規化
def company(country, name, legal=None, industry=None, group=None, parent=None, listed=None, rev=None, revFy=None, revUrl=None,
            emp=None, hq=None, web=None, nameEn=None, nameJa=None, code=None):
    name = squash(name)
    c = {"id": company_id(country, name), "name": name, "legal": squash(legal or name), "industry": industry, "group": squash(group or name),
         "parent": squash(parent) or None, "listed": listed, "rev": rev, "revFy": revFy, "revUrl": revUrl, "emp": to_int(emp),
         "hq": squash(hq) or None, "web": web, "country": country, "nameEn": squash(nameEn) or None, "nameJa": squash(nameJa) or None, "code": code}
    return c


def factory(country, cid, op, name, addr, prod=None, src=None, srcType="official", seg=None, area=None, floor=None, emp=None, empAsof=None,
            est=None, src2=None, srcLabel=None, oid=None, nameEn=None, opEn=None, lat=None, lng=None, prec=None):
    addr = clean_addr(country, addr) if addr else None
    pref, city = split_admin(country, addr) if addr else (None, None)
    name = squash(name) or None
    f = {"cid": cid, "op": squash(op), "name": name, "addr": addr, "pref": pref, "city": city, "prod": squash(prod) or None, "seg": squash(seg) or None,
         "area": to_int(area), "floor": to_int(floor), "emp": to_int(emp), "empAsof": empAsof, "est": est, "src": src, "src2": src2, "srcType": srcType,
         "srcLabel": srcLabel, "oid": oid or cid, "lat": lat, "lng": lng, "prec": prec, "country": country, "nameEn": squash(nameEn) or None,
         "opEn": squash(opEn) or None, "id": factory_id(country, op, name, addr)}
    return f


def check(companies, factories):
    """必須項目と参照の検査。問題は文字列のリストで返す(空なら合格)。"""
    errs = []
    ids = {}
    for c in companies:
        for k in ("id", "name", "legal", "industry", "group", "web", "country"):
            if not c.get(k):
                errs.append(f"company {c.get('id')} {c.get('name')}: {k} が空")
        if c.get("industry") and c["industry"] not in INDUSTRIES:
            errs.append(f"company {c['name']}: 業種 {c['industry']} が 11 区分に無い")
        if c["id"] in ids:
            errs.append(f"company id 重複 {c['id']} {c['name']} / {ids[c['id']]}")
        ids[c["id"]] = c["name"]
    fids = set()
    for f in factories:
        for k in ("id", "cid", "op", "src", "srcType", "country"):
            if not f.get(k):
                errs.append(f"factory {f.get('op')} {f.get('name')}: {k} が空")
        if f.get("cid") not in ids:
            errs.append(f"factory {f.get('op')} {f.get('name')}: cid {f.get('cid')} の会社が無い")
        if f.get("oid") and f["oid"] not in ids:
            errs.append(f"factory {f.get('op')} {f.get('name')}: oid {f.get('oid')} の会社が無い")
        if f["id"] in fids:
            errs.append(f"factory id 重複 {f['id']} {f.get('op')} {f.get('name')}")
        fids.add(f["id"])
        if not f.get("src", "").startswith("http"):
            errs.append(f"factory {f.get('op')} {f.get('name')}: 出所 URL が無い({f.get('src')})")
    return errs
