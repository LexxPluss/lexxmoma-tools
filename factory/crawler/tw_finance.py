# -*- coding: utf-8 -*-
"""台湾: 売上高(証券取引所・櫃買中心の月次営業収入 OpenAPI、累計)を会社マスタに付ける。

出所: https://openapi.twse.com.tw/v1/opendata/t187ap05_L(上市)、https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O(上櫃)
値は千台湾ドル → 億台湾ドル。年度の途中なので「YYYY年1〜M月(累計)」と明記する。
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATA, RAW, cached_fetch, jdump, jload, log_run, today

TWSE = "https://openapi.twse.com.tw/v1/opendata/t187ap05_L"
TPEX = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O"


def main():
    rev = {}
    for url, name in ((TWSE, "twse"), (TPEX, "tpex")):
        rows = json.loads(cached_fetch(url, RAW / "tw" / f"{name}_t187ap05_{today()}.json", respect_robots=False))
        for r in rows:
            ym = r.get("資料年月") or ""
            v = r.get("累計營業收入-當月累計營收")
            try:
                v = int(str(v).replace(",", ""))
            except Exception:
                continue
            y, m = int(ym[:-2]) + 1911, int(ym[-2:])
            rev[r["公司代號"]] = {"rev": round(v / 100000, 1), "revFy": f"{y}年1〜{m}月(累計)", "revUrl": url}
    cos = jload(DATA / "tw" / "companies.json", [])
    n = 0
    for c in cos:
        r = rev.get(c.get("code"))
        if r:
            c.update(r); n += 1
    jdump(cos, DATA / "tw" / "companies.json")
    print(f"売上高を付けた会社 {n}/{len(cos)}")
    log_run("tw_finance", {"companies": len(cos), "with_rev": n})


if __name__ == "__main__":
    main()
