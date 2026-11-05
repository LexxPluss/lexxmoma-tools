# -*- coding: utf-8 -*-
"""統合と暗号化。

入力: 日本 = 公開側 site/members/factory-map/data.enc.json(共通パスワードで復号。平文 data/jp/factories.json があればそれ)
      韓国・台湾 = data/kr/companies.json + factories.json、data/tw/companies.json + factories.json(各クローラの出力)
出力: data/merged.json(平文・確認用)、site/members/factory-map/data.enc.json と data.enc.js(暗号化)

  python build.py --plain-only          平文だけ作る(FACTORY_PW が要る: 日本の復号に使う)
  python build.py                       暗号化して公開側を更新
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import COUNTRIES, DATA, ENC_JSON, INDUSTRIES, decrypt_file, encrypt, jdump, jload, password, today
from normalize import check


def load_jp(pw):
    p = DATA / "jp" / "factories.json"
    d = jload(p)
    if d is None:
        d = decrypt_file(ENC_JSON, pw)
        # 既に統合済みのデータ(韓国・台湾入り)なら日本分だけ取り出す
        d = {"builtAt": d.get("builtAt"), "industries": d.get("industries", INDUSTRIES),
             "companies": [c for c in d["companies"] if (c.get("country") or "JP") == "JP"],
             "factories": [f for f in d["factories"] if (f.get("country") or "JP") == "JP"]}
        jdump(d, p)
    for c in d["companies"]:
        c.setdefault("country", "JP")
        c.pop("facs", None)
    for f in d["factories"]:
        f.setdefault("country", "JP")
    return d


def load_cc(cc):
    cs = jload(DATA / cc / "companies.json", [])
    fs = jload(DATA / cc / "factories.json", [])
    return cs, fs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plain-only", action="store_true")
    ap.add_argument("--password")
    ap.add_argument("--skip", default="", help="取り込まない国(例: KR,TW)")
    a = ap.parse_args()
    pw = a.password or password()
    jp = load_jp(pw)
    companies, factories = list(jp["companies"]), list(jp["factories"])
    stats = {"JP": {"companies": len(companies), "factories": len(factories)}}
    for cc in ("KR", "TW"):
        if cc in a.skip.upper():
            continue
        cs, fs = load_cc(cc.lower())
        have = {f["cid"] for f in fs} | {f.get("oid") for f in fs}
        dropped = [c["name"] for c in cs if c["id"] not in have]
        cs = [c for c in cs if c["id"] in have]                 # 日本と同じく、工場が 1 件以上ある会社だけを載せる
        for c in cs:
            for k in ("indLocal", "ksic", "dartKey", "masterSrc", "cap", "empSrc", "est"):
                c.pop(k, None)
        errs = check(cs, fs)
        if errs:
            print(f"[{cc}] スキーマ検査で {len(errs)} 件:")
            for e in errs[:30]:
                print("  ", e)
            raise SystemExit(1)
        companies += cs; factories += fs
        stats[cc] = {"companies": len(cs), "factories": len(fs), "geocoded": sum(1 for f in fs if f.get("lat") is not None), "dropped_no_factory": len(dropped)}
    # ID 重複の最終確認(国をまたいでも一意)
    seen = set()
    for x in companies + factories:
        if x["id"] in seen:
            raise SystemExit(f"id 重複: {x['id']} {x.get('name')}")
        seen.add(x["id"])
    used = {c["country"] for c in companies}
    data = {"builtAt": today(), "industries": INDUSTRIES, "countries": [k for k in COUNTRIES if k["code"] in used],
            "fxAsof": "2026-11", "companies": companies, "factories": factories}
    jdump(data, DATA / "merged.json", compact=True)
    print("統合:", {k: v for k, v in stats.items()}, "合計", len(companies), "社", len(factories), "件")
    if a.plain_only:
        return
    encrypt(data, pw, ENC_JSON)
    print("暗号化:", ENC_JSON, ENC_JSON.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
