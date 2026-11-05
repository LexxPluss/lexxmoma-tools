# -*- coding: utf-8 -*-
"""品質の監査。日本の工場マップと同じ指標で韓国・台湾を比べる(目標: 日本と同じ水準)。

  python audit.py            data/merged.json(無ければ data/<cc>/ と日本の復号)を読んで国別の指標を表示し data/audit.json に残す
"""
import collections
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATA, jdump, jload, today

METRICS = [
    ("companies", "会社数"), ("factories", "工場数"), ("fac_per_co", "1社あたり工場数(中央値)"), ("co_with_fac", "工場が1件以上ある会社の割合"),
    ("addr", "住所あり"), ("geocoded", "緯度経度あり"), ("prec_address", "番地まで特定(address)"), ("prec_city_or_worse", "市区町村・県の代表点"),
    ("prod", "生産品目あり"), ("emp", "従業員数あり"), ("area", "敷地面積あり"), ("src_official", "出所が公式サイト・公的開示"),
    ("co_rev", "売上高あり(会社)"), ("co_emp", "従業員数あり(会社)"), ("co_hq", "本社住所あり(会社)"), ("co_listed", "上場区分あり(会社)"),
]


def pct(n, d):
    return round(100.0 * n / d, 1) if d else None


def metrics(cs, fs):
    byco = collections.Counter(f["cid"] for f in fs)
    per = sorted(byco.get(c["id"], 0) for c in cs)
    med = per[len(per) // 2] if per else 0
    n = len(fs) or 1
    return {
        "companies": len(cs), "factories": len(fs), "fac_per_co": med, "co_with_fac": pct(sum(1 for c in cs if byco.get(c["id"])), len(cs)),
        "addr": pct(sum(1 for f in fs if f.get("addr")), n), "geocoded": pct(sum(1 for f in fs if f.get("lat") is not None), n),
        "prec_address": pct(sum(1 for f in fs if f.get("prec") == "address"), n),
        "prec_city_or_worse": pct(sum(1 for f in fs if f.get("prec") in ("city", "prefecture")), n),
        "prod": pct(sum(1 for f in fs if f.get("prod")), n), "emp": pct(sum(1 for f in fs if f.get("emp")), n), "area": pct(sum(1 for f in fs if f.get("area")), n),
        "src_official": pct(sum(1 for f in fs if f.get("srcType") in ("official", "yuho")), n),
        "co_rev": pct(sum(1 for c in cs if c.get("rev")), len(cs)), "co_emp": pct(sum(1 for c in cs if c.get("emp")), len(cs)),
        "co_hq": pct(sum(1 for c in cs if c.get("hq")), len(cs)), "co_listed": pct(sum(1 for c in cs if c.get("listed")), len(cs)),
        "industries": dict(collections.Counter(c.get("industry") for c in cs)),
    }


def main():
    d = jload(DATA / "merged.json")
    if d is None:
        raise SystemExit("先に build.py --plain-only を実行してください")
    out = {"date": today(), "by_country": {}}
    for cc in ("JP", "KR", "TW"):
        cs = [c for c in d["companies"] if (c.get("country") or "JP") == cc]
        fs = [f for f in d["factories"] if (f.get("country") or "JP") == cc]
        if cs:
            out["by_country"][cc] = metrics(cs, fs)
    ccs = list(out["by_country"])
    print(f"{'指標':<28}" + "".join(f"{cc:>10}" for cc in ccs))
    for k, label in METRICS:
        print(f"{label:<28}" + "".join(f"{str(out['by_country'][cc].get(k)):>10}" for cc in ccs))
    print("業種の内訳:")
    for cc in ccs:
        print(" ", cc, out["by_country"][cc]["industries"])
    hist = jload(DATA / "audit_history.json", [])
    hist.append(out)
    jdump(hist, DATA / "audit_history.json")
    jdump(out, DATA / "audit.json")


if __name__ == "__main__":
    main()
