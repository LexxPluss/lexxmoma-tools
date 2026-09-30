# -*- coding: utf-8 -*-
"""工場マップ作成時に取得済みの有報 PDF(site/internal/factory-db/yuho_pdf/)を、EDINET API キー無しで一括投入する。

対応表: site/internal/factory-db/yuho_sites.json(会社名 → 有報 URL)と raw/out_*.json(yuho_url)。
PDF のキャッシュ名は yuho_extract.py と同じ sha1(url)[:16].pdf。docID は URL の S100XXXX。

使い方: python import_local_yuho.py [--workers 4] [--only 会社名]
出力は crawl_edinet.py と同じ(raw/<cid>/yuho_<docID>_officers.json + sources.json)。
"""
import argparse
import glob
import hashlib
import json
import re
import sys
from multiprocessing import Pool
from pathlib import Path

from common import DATA, REPO, RAW, RunLog, jload, today
from crawl_edinet import save_officers

FDB = REPO / "site" / "internal" / "factory-db"
REDO = "--redo" in sys.argv


def url_map():
    m = {}
    for name, e in (jload(FDB / "yuho_sites.json", {}) or {}).items():
        if e.get("url"):
            m[name] = e["url"]
    for f in glob.glob(str(FDB / "raw" / "out_*.json")):
        for r in jload(f, []):
            if r.get("yuho_url") and r.get("name") and r["name"] not in m:
                m[r["name"]] = r["yuho_url"]
    return m


def job(args):
    cid, name, url = args
    pdf = FDB / "yuho_pdf" / (hashlib.sha1(url.encode()).hexdigest()[:16] + ".pdf")
    if not pdf.exists():
        return cid, name, None, "PDF キャッシュ無し"
    m = re.search(r"(S100[0-9A-Z]{4})", url)
    doc_id = m.group(1) if m else hashlib.sha1(url.encode()).hexdigest()[:8]
    if (RAW / cid / f"yuho_{doc_id}_officers.json").exists() and not REDO:
        return cid, name, doc_id, "済"
    try:
        out = save_officers(cid, pdf, doc_id, url, cid if cid.startswith("E") else None)
        return cid, name, doc_id, f"{len(out['pages'])} ページ" if out else "役員の状況が見つからない"
    except Exception as e:
        return cid, name, doc_id, f"失敗: {e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--only")
    ap.add_argument("--redo", action="store_true", help="取り出し済みでも PDF から取り直す")
    a = ap.parse_args()
    reg = jload(DATA / "companies.json")
    if not reg:
        sys.exit("先に registry.py")
    urls = url_map()
    jobs = []
    for c in reg["companies"]:
        u = urls.get(c["short_name"]) or urls.get(c["name"])
        if not u or (a.only and c["short_name"] != a.only):
            continue
        jobs.append((c["id"], c["short_name"], u))
    print(f"対象 {len(jobs)} 社(有報 URL あり)")
    log = RunLog("import_local_yuho")
    with Pool(a.workers) as pool:
        for cid, name, doc_id, msg in pool.imap_unordered(job, jobs):
            print(f"{name}: {doc_id} {msg}", flush=True)
            if msg.startswith(("失敗", "役員の状況", "PDF")):
                log.fail(cid, f"{name}: {msg}")
            else:
                log.ok(cid, f"{name}: {msg}")
    log.save()


if __name__ == "__main__":
    main()
