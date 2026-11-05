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
# 英語表記の縣市 → 中国語(公式サイトの英語住所用)。新竹は市・縣の区別がつかないので 新竹市 とする
TW_EN = [("New Taipei", "新北市"), ("Taipei", "臺北市"), ("Taoyuan", "桃園市"), ("Taichung", "臺中市"), ("Tainan", "臺南市"), ("Kaohsiung", "高雄市"), ("Keelung", "基隆市"),
         ("Hsinchu County", "新竹縣"), ("Hsinchu", "新竹市"), ("Chiayi County", "嘉義縣"), ("Chiayi", "嘉義市"), ("Miaoli", "苗栗縣"), ("Changhua", "彰化縣"), ("Nantou", "南投縣"),
         ("Yunlin", "雲林縣"), ("Pingtung", "屏東縣"), ("Yilan", "宜蘭縣"), ("Ilan", "宜蘭縣"), ("Hualien", "花蓮縣"), ("Taitung", "臺東縣"), ("Penghu", "澎湖縣"), ("Kinmen", "金門縣")]
# 郷鎮市区名だけの住所(「鹿港」「中壢」など)→ 縣市
TW_TOWN = {"桃園市": "中壢 平鎮 楊梅 蘆竹 觀音 龜山 大園 龍潭 大溪 八德 新屋 桃園", "新北市": "泰山 樹林 新莊 土城 林口 五股 三重 板橋 中和 永和 汐止 淡水 鶯歌 三峽 新店 八里",
           "臺中市": "大雅 潭子 后里 西屯 大肚 烏日 太平 神岡 大甲 沙鹿 梧棲 豐原 清水 龍井 南屯 北屯 大里 霧峰 外埔", "新竹縣": "竹北 湖口 新豐 關西 竹東 寶山 新埔 芎林",
           "新竹市": "新竹 新竹科學園區 竹科", "苗栗縣": "頭份 竹南 銅鑼 苑裡 後龍 苗栗 通霄 三義 公館 造橋", "雲林縣": "麥寮 斗六 虎尾 斗南 土庫 北港 褒忠 大埤 林內",
           "彰化縣": "和美 員林 二林 溪州 伸港 鹿港 全興 福興 田中 北斗 社頭 芳苑 彰化 彰濱 彰化濱海工業區 線西", "南投縣": "草屯 南投 埔里 名間 竹山", "高雄市": "仁武 林園 路竹 大社 小港 楠梓 岡山 大寮 前鎮 永安 橋頭 燕巢 大樹 鳳山 湖內 阿蓮",
           "臺南市": "新市 永康 仁德 善化 官田 安南 安平 歸仁 麻豆 柳營 新營 學甲 山上 關廟 七股 安定 南科 臺南科學園區 台南科學園區", "嘉義市": "嘉義", "嘉義縣": "大林 民雄 水上 太保 朴子 中埔",
           "宜蘭縣": "宜蘭 羅東 礁溪 冬山 蘇澳 五結 員山", "屏東縣": "屏東 內埔 潮州 萬丹 新園 枋寮", "花蓮縣": "花蓮 吉安 新城", "基隆市": "基隆", "臺東縣": "臺東 台東", "臺北市": "內湖 南港 北投 士林 松山 大安 信義 中山 中正 文山 萬華 大同"}
TW_TOWN_IDX = {t: p for p, ts in TW_TOWN.items() for t in ts.split()}
# 韓国: 道名の無い市名 → 시・도
KR_CITY = {"경기도": "수원 화성 평택 안산 안성 용인 이천 파주 김포 시흥 부천 안양 군포 의왕 오산 양주 포천 여주 광명 하남 남양주 구리 고양 의정부 동두천 성남 과천 연천 가평 양평",
           "경상남도": "창원 김해 양산 거제 진주 함안 밀양 사천 통영 창녕 고성 의령 하동 산청 거창 합천 남해", "경상북도": "구미 포항 경주 경산 영천 김천 칠곡 안동 상주 문경 영주 성주 고령 청도 예천 봉화 울진 영덕 군위 의성",
           "충청남도": "천안 아산 당진 서산 논산 공주 예산 보령 홍성 계룡 태안 금산 부여 서천 청양", "충청북도": "청주 충주 음성 진천 제천 증평 옥천 괴산 보은 영동 단양",
           "전북특별자치도": "전주 익산 군산 완주 김제 정읍 남원 고창 부안 임실 순창 진안 무주 장수", "전라남도": "광양 여수 순천 나주 영암 목포 장성 화순 함평 무안 해남 담양 고흥 보성 장흥 강진 영광 곡성 구례 진도 완도 신안",
           "강원특별자치도": "원주 춘천 강릉 횡성 동해 삼척 속초 태백 홍천 평창 정선 철원 영월 양구 인제 고성 양양", "제주특별자치도": "제주 서귀포"}
KR_CITY_IDX = {c: p for p, cs in KR_CITY.items() for c in cs.split()}


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
                m = re.match(r"^(\S+?)(시|군)\b", a)
                if m and m.group(1) in KR_CITY_IDX:
                    pref = KR_CITY_IDX[m.group(1)]
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
            if re.search(r"[A-Za-z]{3}", a):                      # 英語住所
                for en, zh in TW_EN:
                    if re.search(r"\b" + re.escape(en) + r"\b", a, re.I):
                        pref = zh; break
                return pref, None
            m = re.match(r"^([^\d\s,]{1,8}?)(區|鄉|鎮|市|科學園區|工業區)?", a)
            key = (m.group(1) if m else "")
            for t, p in sorted(TW_TOWN_IDX.items(), key=lambda x: -len(x[0])):
                if a.startswith(t):
                    pref = p
                    if t not in TW_PREF and re.match(t + r"(區|鄉|鎮|市)", a):
                        city = re.match(t + r"(區|鄉|鎮|市)", a).group(0)
                    elif t not in TW_PREF and t not in ("新竹", "嘉義", "基隆", "花蓮", "宜蘭", "屏東", "臺東", "台東", "南投", "苗栗", "彰化", "桃園", "新竹科學園區", "竹科", "彰濱", "彰化濱海工業區", "南科", "臺南科學園區", "台南科學園區"):
                        city = t
                    break
                if a.startswith(t):
                    break
        m = re.match(r"^([^\d\s]{1,4}?(?:區|鄉|鎮|市))", rest)
        if m and not city:
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
