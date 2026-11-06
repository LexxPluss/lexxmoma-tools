# -*- coding: utf-8 -*-
"""北米(米国・カナダ)の工場: 調査結果(raw/na/out/batch*.json)→ 工場マップの形式(data/na/factories.json)。

対象 = 日本の工場マップにある自動車関連(自動車(完成車)・自動車部品)の会社(data/na/targets.json、外資系の日本法人は除外)。
北米の工場は、その日本の会社(cid)に属する工場として載せる(会社は増やさない)。運営会社(op)は現地法人の正式名。

  python na_build.py              変換 + 座標(Nominatim、data/na/geocache.json に残す)
  python na_build.py --no-geo     座標を付けずに変換だけ(件数の確認用)

出力: data/na/factories.json(build.py が統合する)、data/na/report.json(会社ごとの件数・未解決)
"""
import argparse
import glob
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATA, MANUAL, RAW, factory_id, fetch, jdump, jload, squash

NA = DATA / "na"
GEOCACHE = NA / "geocache.json"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
ACRE = 4046.8564224
SQFT = 0.09290304
SRC_TYPES = {"official", "yuho", "public"}
FORBIDDEN = re.compile(r"wikipedia\.org|zoominfo|dnb\.com|manta\.com|bizapedia|opencorporates|crunchbase|indeed\.|glassdoor|linkedin\.com|"
                       r"google\.[a-z.]+/maps|mapcarta|baseconnect|salesnow|autonews\.com|reuters\.com|bloomberg\.com|nikkei\.com", re.I)
US_STATES = {"AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
             "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky",
             "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
             "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
             "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island",
             "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
             "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia"}
CA_PROV = {"ON": "Ontario", "QC": "Quebec", "BC": "British Columbia", "AB": "Alberta", "MB": "Manitoba", "SK": "Saskatchewan", "NS": "Nova Scotia",
           "NB": "New Brunswick", "PE": "Prince Edward Island", "NL": "Newfoundland and Labrador"}


def state_name(country, s):
    s = squash(s or "").strip(" .")
    if not s:
        return None
    table = US_STATES if country == "US" else CA_PROV
    if s.upper() in table:
        return table[s.upper()]
    for v in table.values():
        if v.lower() == s.lower() or v.lower().replace(" ", "") == s.lower().replace(" ", ""):
            return v
    if country == "CA" and s.lower() in ("québec",):
        return "Quebec"
    return s


def num(x):
    if x is None or x == "":
        return None
    if isinstance(x, (int, float)):
        return x
    m = re.search(r"[\d,.]+", str(x))
    try:
        return float(m.group(0).replace(",", "")) if m else None
    except ValueError:
        return None


def norm_key(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def addr_key(f):
    """同じ工場の判定: 運営会社(現地法人)+ 番地(先頭の数字+通り名の頭)+ 市。
    運営会社を含めるのは、完成車工場の敷地内に部品会社の工場がある(同じ番地)ため。"""
    a = (f.get("addr") or "").lower()
    m = re.match(r"\s*(\d+[a-z]?)\s+([a-z]+)", a)
    op = norm_key(re.sub(r"(inc|llc|corp|corporation|co|ltd|limited|company|of america|usa|u s a)", "", (f.get("op") or "").lower()))[:24]
    city = norm_key(f.get("city"))
    if m:
        return f"{f['country']}|{op}|{m.group(1)}|{m.group(2)[:5]}|{city}"
    return f"{f['country']}|{op}|{city}|{norm_key(f.get('nameEn'))[:12]}"


def jp_partner(p, names):
    """合弁相手の表記 → 日本の会社名(対象にあれば)。'Toyota Industries Corporation (豊田自動織機, 60%)' → 豊田自動織機"""
    m = re.search(r"[(（]([^,，、)）]*[぀-ヿ一-鿿][^,，、)）]*)", p)
    if m:
        return squash(m.group(1))
    q = norm_key(re.sub(r"(inc|llc|corp|corporation|co|ltd|limited|company|holdings)", "", p.lower()))
    for en, ja in EN_JA.items():
        if q.startswith(en):
            return ja
    return squash(re.sub(r"\s*\(.*?\)", "", p))


EN_JA = {"toyotamotor": "トヨタ自動車", "toyota": "トヨタ自動車", "toyotaindustries": "豊田自動織機", "denso": "デンソー", "mazdamotor": "マツダ", "mazda": "マツダ",
         "hondamotor": "本田技研工業", "honda": "本田技研工業", "nissanmotor": "日産自動車", "aisin": "アイシン", "subaru": "SUBARU", "toyotaboshoku": "トヨタ紡織",
         "toyodagosei": "豊田合成", "jtekt": "ジェイテクト", "sumitomoelectric": "住友電気工業", "bridgestone": "ブリヂストン"}
EN_JA = dict(sorted(EN_JA.items(), key=lambda kv: -len(kv[0])))   # 長い名前から当てる


# ---------------------------------------------------------------- 座標
_geo = None


def geocode(country, addr, city, state):
    global _geo
    if _geo is None:
        _geo = jload(GEOCACHE, {})
    cname = "USA" if country == "US" else "Canada"
    cands = []
    if addr:
        cands.append((addr if cname.lower() in addr.lower() else f"{addr}, {cname}", "address"))
        a2 = re.sub(r"\b(suite|ste\.?|unit|bldg\.?|building|#)\s*[\w-]+,?", "", addr, flags=re.I)
        if a2 != addr:
            cands.append((f"{a2}, {cname}", "address"))
    if city and state:
        cands.append((f"{city}, {state}, {cname}", "city"))
    if state:
        cands.append((f"{state}, {cname}", "prefecture"))
    if country == "US" and addr and re.match(r"\s*\d", addr):   # 米国の番地は国勢調査局の住所照合が確実(公的機関・無料)
        key = f"census|{addr}"
        if key not in _geo:
            try:
                body, _ = fetch(CENSUS, params={"address": addr, "benchmark": "Public_AR_Current", "format": "json"}, interval=0.5, respect_robots=False)
                m = json.loads(body)["result"]["addressMatches"]
                _geo[key] = {"lat": m[0]["coordinates"]["y"], "lng": m[0]["coordinates"]["x"]} if m else None
            except Exception as e:  # noqa: BLE001
                print("  census 失敗:", addr, e)
                _geo[key] = None
            jdump(_geo, GEOCACHE, compact=True)
        if _geo[key]:
            return _geo[key]["lat"], _geo[key]["lng"], "address"
    for q, prec in cands:
        key = f"{country}|{q}"
        if key not in _geo:
            try:
                body, _ = fetch(NOMINATIM, params={"q": q, "format": "jsonv2", "limit": 1, "countrycodes": country.lower(), "accept-language": "en"},
                                interval=1.1, respect_robots=False)
                r = json.loads(body)
                _geo[key] = {"lat": float(r[0]["lat"]), "lng": float(r[0]["lon"]), "type": r[0].get("addresstype") or r[0].get("type")} if r else None
            except Exception as e:  # noqa: BLE001 — 取得失敗は「当たらず」として次の候補へ
                print("  geocode 失敗:", q, e)
                _geo[key] = None
            jdump(_geo, GEOCACHE, compact=True)
        g = _geo[key]
        if g:
            p = prec
            if prec == "address" and g.get("type") in ("city", "town", "village", "municipality", "county", "state", "hamlet", "suburb", "postcode"):
                p = "city"   # 番地で引いたのに市町村に落ちた
            return g["lat"], g["lng"], p
    return None, None, None


# ---------------------------------------------------------------- 変換
def same_group(a, b):
    return bool(b) and (a["name"] == b.get("parent") or b["name"] == a.get("parent") or (a.get("group") and a.get("group") == b.get("group")))


def more_direct(new, cur):
    """同じ工場を 2 社が挙げたとき、new の方が直接の持ち主か(cur の子会社 / 同グループで売上が小さい)。"""
    if new.get("parent") == cur["name"]:
        return True
    if cur.get("parent") == new["name"]:
        return False
    return same_group(new, cur) and (new.get("rev") or 0) < (cur.get("rev") or 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-geo", action="store_true")
    a = ap.parse_args()
    T = jload(NA / "targets.json")
    tg = {t["id"]: t for t in T["targets"]}
    byname = {t["name"]: t for t in T["targets"]}
    out, report, seen, problems = [], [], {}, []
    by_op = {}
    files = sorted(glob.glob(str(RAW / "na" / "out" / "batch*.json")))
    done = set()
    for path in files:
        try:
            recs = json.load(open(path, encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            problems.append(f"{Path(path).name}: JSON が読めない {e}")
            continue
        for r in recs:
            t = tg.get(r.get("input_id")) or byname.get(r.get("input_name"))
            if not t:
                problems.append(f"{Path(path).name}: 対象に無い会社 {r.get('input_name')}")
                continue
            done.add(t["id"])
            n_in = 0
            for x in r.get("factories") or []:
                country = (x.get("country") or "").upper()
                if country not in ("US", "CA"):
                    problems.append(f"{t['name']} {x.get('name')}: 国 {country} は対象外")
                    continue
                src = x.get("source_url") or ""
                if not src.startswith("http"):
                    problems.append(f"{t['name']} {x.get('name')}: 出所 URL が無い")
                    continue
                if FORBIDDEN.search(src):
                    problems.append(f"{t['name']} {x.get('name')}: 禁止ソース {src}")
                    continue
                state = state_name(country, x.get("state"))
                city = squash(x.get("city") or "") or None
                addr = squash(x.get("address") or "") or None
                if not addr and city and state:
                    addr = f"{city}, {state}"
                if not addr:
                    problems.append(f"{t['name']} {x.get('name')}: 所在地が無い")
                    continue
                area = num(x.get("site_area_m2")) or (num(x.get("site_area_acres")) or 0) * ACRE or None
                floor = num(x.get("floor_area_m2")) or (num(x.get("floor_area_sqft")) or 0) * SQFT or None
                op = squash(x.get("operator") or "") or t["name"]
                name_en = squash(x.get("name") or "") or None
                name = squash(x.get("name_ja") or "") or name_en or (city and f"{city} 工場")
                st = x.get("source_type") if x.get("source_type") in SRC_TYPES else "official"
                jv = [squash(p) for p in (x.get("jv_partners") or []) if squash(p)]
                f = {"cid": t["id"], "oid": t["id"], "op": op, "name": name, "addr": addr, "pref": state, "city": city,
                     "prod": squash(x.get("products") or "") or None, "seg": squash(x.get("segment") or "") or None,
                     "area": round(area) if area else None, "floor": round(floor) if floor else None,
                     "emp": int(num(x.get("employees"))) if num(x.get("employees")) else None,
                     "empAsof": str(x["employees_asof"]) if x.get("employees_asof") else None,
                     "est": int(num(x.get("established"))) if num(x.get("established")) else None,
                     "src": src, "src2": None, "srcType": st, "srcLabel": None, "lat": None, "lng": None, "prec": None,
                     "country": country, "nameEn": name_en if name_en != name else None, "opEn": None, "jv": jv or None}
                k = addr_key(f)
                k2 = f"{country}|{norm_key(op)}|{state}"
                if k not in seen and k2 in by_op and t["name"] not in by_op[k2]["_from"]:
                    k = by_op[k2]["_key"]      # 別の会社が同じ現地法人を別の住所表記で挙げた(合弁の両社など)
                if k in seen:          # 2 社から挙がった同じ工場(合弁、または親会社と子会社の両方が挙げた)→ 1 件にまとめる
                    g = seen[k]
                    g["_from"].add(t["name"]); g["_jvsrc"].update(jv)
                    if g["cid"] != t["id"] and more_direct(t, tg[g["cid"]]):
                        g["cid"] = g["oid"] = t["id"]          # 子会社が挙げた方を持ち主にする(アイシン → アドヴィックス 等)
                    for fld in ("area", "floor", "emp", "empAsof", "est", "prod", "seg"):
                        if not g.get(fld) and f.get(fld):
                            g[fld] = f[fld]
                    continue
                f["_from"] = {t["name"]}; f["_jvsrc"] = set(jv); f["_key"] = k
                by_op.setdefault(k2, f)
                f["id"] = factory_id(country, op, name_en or name, addr)
                seen[k] = f
                out.append(f)
                n_in += 1
            report.append({"id": t["id"], "name": t["name"], "batch": t["batch"], "status": r.get("status"), "factories": n_in, "note": r.get("note")})
    # 合弁相手: 出所に書かれた相手(jv_partners)だけを載せる。挙げた会社が同じグループの親子なら合弁ではない
    fixes = jload(MANUAL / "na_fixes.json", [])
    for f in out:
        owner = tg[f["cid"]]
        names = {jp_partner(p, byname) for p in f.pop("_jvsrc")}
        f.pop("_from"); f.pop("_key")
        names = {n for n in names if n and n != owner["name"] and not same_group(owner, byname.get(n))}
        f["jv"] = sorted(names) or None
    for x in fixes:
        hit = [f for f in out if f["op"] == x["match"]["op"] and (not x["match"].get("city") or f["city"] == x["match"]["city"])]
        if not hit:
            problems.append(f"na_fixes.json: 当たらない {x['match']}")
        for f in hit:
            f[x["field"]] = x["value"]
    out = [f for f in out if not f.pop("_exclude", None)]   # 閉鎖などで人手で除外したもの
    missing = [t["name"] for t in T["targets"] if t["id"] not in done]
    if not a.no_geo:
        print("座標:", len(out), "件(Nominatim 1 秒間隔。キャッシュ済みは即時)")
        for i, f in enumerate(out, 1):
            f["lat"], f["lng"], f["prec"] = geocode(f["country"], f["addr"], f["city"], f["pref"])
            if i % 50 == 0:
                print(" ", i)
    ids = set()
    for f in out:
        while f["id"] in ids:          # 同名・同住所の別工場(まれ)
            f["id"] = f["id"][:-1] + "x"
        ids.add(f["id"])
    jdump(out, NA / "factories.json")
    by_status = {}
    for r in report:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
    summary = {"targets": len(T["targets"]), "researched": len(done), "notResearched": missing, "byStatus": by_status,
               "companiesWithPlants": sum(1 for r in report if r["factories"]), "factories": len(out),
               "US": sum(1 for f in out if f["country"] == "US"), "CA": sum(1 for f in out if f["country"] == "CA"),
               "geocoded": sum(1 for f in out if f["lat"] is not None),
               "prec": {p: sum(1 for f in out if f["prec"] == p) for p in ("address", "city", "prefecture", None)},
               "withProducts": sum(1 for f in out if f["prod"]), "withEmployees": sum(1 for f in out if f["emp"]),
               "withArea": sum(1 for f in out if f["area"]), "excluded": T["excluded"], "problems": problems}
    jdump({"summary": summary, "companies": report}, NA / "report.json")
    print(json.dumps({k: v for k, v in summary.items() if k not in ("problems", "excluded")}, ensure_ascii=False))
    print("問題", len(problems), "件(report.json の problems)")


if __name__ == "__main__":
    main()
