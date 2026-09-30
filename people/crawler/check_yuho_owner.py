# -*- coding: utf-8 -*-
"""保存済みの有報(raw/<cid>/yuho_*_officers.json)が、本当にその会社のものかを確かめる。

有報 PDF の各ページ上部には「EDINET提出書類 / <提出会社名>(E00000)」が印字されている。
この EDINET コードが企業マスタの edinet_code と違うものは別会社の有報(取得元 URL の取り違え)なので、
ファイル名を *.wrong_company.json に変えて取り込まないようにする(build は yuho_*_officers.json だけを読む)。

使い方: python check_yuho_owner.py [--dry-run]
"""
import argparse
import re
from pathlib import Path

from common import DATA, RAW, jdump, jload, nfkc

HEAD_RE = re.compile(r"([^\s]{2,40}?)\s*[（(](E\d{5})[）)]")


def owner_code(doc):
    for pg in doc.get("pages", [])[:4]:
        m = HEAD_RE.search(nfkc((pg.get("text") or "")[:400]))
        if m:
            return m.group(2), m.group(1)
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    reg = {c["id"]: c for c in jload(DATA / "companies.json")["companies"]}
    files = sorted(RAW.glob("*/yuho_*_officers.json"))
    bad, nohead = [], 0
    for f in files:
        cid = f.parent.name
        c = reg.get(cid, {})
        code, name = owner_code(jload(f))
        if not code:
            nohead += 1
            continue
        want = c.get("edinet_code")
        if want and code != want:
            bad.append({"company": c.get("short_name"), "company_id": cid, "expected": want, "found": code, "found_name": name, "file": f.name})
            if not a.dry_run:
                f.rename(f.with_name(f.stem + ".wrong_company.json"))
    jdump(bad, DATA / "yuho_wrong_company.json")
    print(f"確認 {len(files)} 件 / 見出しなし {nohead} / 別会社 {len(bad)}")
    for b in bad:
        print(f"  {b['company']} ({b['expected']}) ← {b['found_name']} ({b['found']})")


if __name__ == "__main__":
    main()
