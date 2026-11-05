# -*- coding: utf-8 -*-
"""住所 → 緯度経度(Nominatim / OpenStreetMap)。結果は data/geocache.json に残し、同じ住所は再照会しない。

Nominatim の利用規約(1 リクエスト/秒、User-Agent に連絡先)を守る。精度(prec)は日本の工場マップと同じ区分:
  address(番地まで) / town(町・区の代表点) / city(市区町村の代表点) / prefecture(県の代表点)
番地まで当たらないときは、住所を後ろから削って(建物名 → 番地 → 道路)市区町村の代表点まで落とす。
"""
import re
import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATA, fetch, jdump, jload, nfkc, squash
from normalize import clean_addr, split_admin

CACHE = DATA / "geocache.json"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
_cache = None


def _load():
    global _cache
    if _cache is None:
        _cache = jload(CACHE, {})
    return _cache


def _save():
    jdump(_cache, CACHE, compact=True)


def _query(q, country, lang):
    body, _ = fetch(NOMINATIM, params={"q": q, "format": "jsonv2", "addressdetails": 1, "limit": 1, "countrycodes": country.lower(), "accept-language": lang},
                    interval=1.1, respect_robots=False)
    r = json.loads(body)
    return r[0] if r else None


def _variants(country, addr):
    """番地まで → 道路まで → 町・区まで → 市区町村まで、の順に候補を返す。"""
    a = clean_addr(country, addr)
    out = [(a, "address")]
    if country == "KR":
        b = re.sub(r"\s*\([^)]*\)", "", a)
        b = re.sub(r",.*$", "", b)
        if b != a:
            out.append((b, "address"))
        m = re.match(r"^(.*?\S+(?:로|길|대로))\s+\d[\d\-]*", b)       # 도로명 + 건물번호
        if m:
            out.append((m.group(1), "town"))
        m = re.match(r"^(.*?\S+(?:읍|면|동|리))\b", b)
        if m:
            out.append((m.group(1), "town"))
    if country == "TW":
        b = re.sub(r"\d+\s*樓.*$|之\d+.*$", "", a)
        if b != a:
            out.append((b, "address"))
        m = re.match(r"^(.*?(?:路|街|大道)(?:[一二三四五六七八九十\d]+段)?)", b)   # 道路まで
        if m and m.group(1) != b:
            out.append((m.group(1), "town"))
        m = re.match(r"^(.*?(?:里|村))", b)
        if m and m.group(1) != b:
            out.append((m.group(1), "town"))
    pref, city = split_admin(country, a)
    if pref and city:
        out.append((pref + " " + city, "city"))
    if pref:
        out.append((pref, "prefecture"))
    seen, res = set(), []
    for q, p in out:
        if q and q not in seen:
            seen.add(q); res.append((q, p))
    return res


def geocode(country, addr):
    """戻り値: {lat, lng, prec, q, osm} または None。"""
    if not addr:
        return None
    key = f"{country}|{squash(addr)}"
    c = _load()
    if key in c:
        return c[key]
    lang = "ko" if country == "KR" else "zh-TW"
    res = None
    for q, prec in _variants(country, addr):
        try:
            r = _query(q, country, lang)
        except Exception as e:
            r = None
        if r:
            # 番地まで照会したのに市区町村レベルしか返らないときは精度を落とす
            t = r.get("addresstype") or r.get("type") or ""
            got = prec
            if prec == "address" and t in ("city", "county", "town", "village", "suburb", "municipality", "state", "province", "administrative", "borough", "quarter", "neighbourhood"):
                got = "city" if t in ("city", "county", "municipality", "administrative", "borough") else "town" if t in ("town", "village", "suburb", "quarter", "neighbourhood") else "prefecture"
            res = {"lat": round(float(r["lat"]), 5), "lng": round(float(r["lon"]), 5), "prec": got, "q": q, "osm": r.get("osm_type", "") + str(r.get("osm_id", ""))}
            break
    c[key] = res
    _save()
    return res


def geocode_all(country, factories, verbose=True):
    n = 0
    for f in factories:
        if f.get("lat") is not None or not f.get("addr"):
            continue
        g = geocode(country, f["addr"])
        if g:
            f["lat"], f["lng"], f["prec"] = g["lat"], g["lng"], g["prec"]
            n += 1
        if verbose and n % 25 == 0 and n:
            print(f"  geocoded {n}", flush=True)
    return n


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("country")
    ap.add_argument("addr")
    a = ap.parse_args()
    print(json.dumps(geocode(a.country, a.addr), ensure_ascii=False))
