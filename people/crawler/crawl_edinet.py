# -*- coding: utf-8 -*-
"""EDINET API v2 から有価証券報告書を取り、「役員の状況」の部分を保存する(SPEC §3.1)。

TODO(spec): エンドポイント・パラメータ名は金融庁「EDINET API 仕様書」で実装時に確認する。ここでは公開仕様書
  (https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/WZEK0110.html) の v2 の記述に従っている:
  - 書類一覧  GET https://api.edinet-fsa.go.jp/api/v2/documents.json?date=YYYY-MM-DD&type=2&Subscription-Key=<key>
      results[].docID / edinetCode / secCode / docTypeCode(120=有価証券報告書, 130=訂正有価証券報告書) / submitDateTime / periodEnd
  - 書類取得  GET https://api.edinet-fsa.go.jp/api/v2/documents/<docID>?type=2&Subscription-Key=<key>   (type=2: PDF, 1: XBRL zip, 5: CSV)
TODO(spec): XBRL のテキストブロック要素(jpcrp_cor:InformationAboutOfficersTextBlock と推定)は実データで確認するまで使わず、
  PDF を pdfplumber で読んで「（２）【役員の状況】」〜「② 社外役員の状況」の範囲を表として保存する。

出力: raw/<cid>/yuho_<docID>.pdf, raw/<cid>/yuho_<docID>_officers.json(parse_officers.py の入力形式), raw/<cid>/sources.json

使い方: python crawl_edinet.py --from 2026-06-20 --to 2026-07-10 [--only E02216]
        python crawl_edinet.py --pdf <ローカルPDF> --company E02216 --doc-id S100YHRY --url <取得元URL>   (API キー無しで 1 件処理)
環境変数: EDINET_API_KEY
"""
import argparse
import os
import re
import sys
from datetime import date, timedelta
from pathlib import Path

from common import DATA, RAW, RunLog, append_source, fetch, jdump, jload, nfkc, sha256_of, source_id, today

API = "https://api.edinet-fsa.go.jp/api/v2"
DOC_TYPES = {"120": "有価証券報告書", "130": "訂正有価証券報告書"}

START_RE = re.compile(r"[（(]\s*[２2]\s*[）)]\s*【?\s*役員の状況")
END_RE = re.compile(r"[②2]\s*社外役員の状況|[（(]\s*[３3]\s*[）)]\s*【?\s*監査の状況")


def _page_record(pg, i, text):
    """ページの文字・表に加えて、役員の表はセルごとに行の縦位置(top)を残す。
    略歴が「年月」「内容」の 2 列に分かれる書式で、折り返し行を位置で年月に対応づけるため(parse_officers.parse_career)。"""
    rec = {"page": i + 1, "text": text, "tables": [], "tables_lines": []}
    try:
        found = pg.find_tables()
    except Exception:
        found = []
    for tb in found:
        rows = tb.extract() or []
        rec["tables"].append(rows)
        lines = None
        head = " ".join(c or "" for c in (rows[0] if rows else []))
        if "略歴" in head:
            lines = []
            for r in tb.rows:
                cells = []
                for bbox in r.cells:
                    if not bbox:
                        cells.append(None)
                        continue
                    try:
                        ls = pg.crop(bbox).extract_text_lines(strip=True)
                        cells.append([[round(l["top"], 1), l["text"]] for l in ls])
                    except Exception:
                        cells.append(None)
                lines.append(cells)
        rec["tables_lines"].append(lines)
    if not found:
        rec["tables"] = pg.extract_tables() or []
        rec["tables_lines"] = [None] * len(rec["tables"])
    return rec


def extract_officer_pages(pdf_path, max_pages=30):
    """役員の状況の節(表を含むページ)を pdfplumber で抜き出す。目次行(数十文字で終わる)は飛ばす。"""
    import pdfplumber
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        on = False
        for i, pg in enumerate(pdf.pages):
            text = pg.extract_text() or ""
            t = nfkc(text)
            if not on:
                m = START_RE.search(t)
                if m and re.search(r"(氏名|略歴|生年月日)", t[m.end():m.end() + 800]):
                    on = True
            if on:
                pages.append(_page_record(pg, i, text))
                if END_RE.search(t) or len(pages) >= max_pages:
                    break
    return pages


def save_officers(company_id, pdf_path, doc_id, url, edinet_code, sec_code=None, submitted=None, period_end=None, log=None):
    cdir = RAW / company_id
    cdir.mkdir(parents=True, exist_ok=True)
    pages = extract_officer_pages(pdf_path)
    if not pages:
        if log:
            log.fail(company_id, f"役員の状況が見つからない: {doc_id}")
        return None
    out = {"doc_id": doc_id, "url": url, "edinet_code": edinet_code, "sec_code": sec_code, "submitted": submitted, "period_end": period_end,
           "retrieved_at": today(), "pages": pages}
    # 別会社の有報を取り込まない: ページ上部の「会社名(E00000)」が企業マスタの EDINET コードと違えば退ける
    from check_yuho_owner import owner_code
    code, name = owner_code(out)
    if code and edinet_code and code != edinet_code:
        jdump(out, cdir / f"yuho_{doc_id}_officers.wrong_company.json")
        if log:
            log.fail(company_id, f"{doc_id}: 別会社の有報({name} {code})なので取り込まない")
        return None
    jdump(out, cdir / f"yuho_{doc_id}_officers.json")
    sid = source_id("yuho", company_id, doc_id)
    append_source(cdir, {"id": sid, "company_id": company_id, "kind": "yuho", "title": f"有価証券報告書 {period_end or ''}".strip() + f"({doc_id})",
                         "date": submitted or today(), "url": url, "retrieved_at": today(),
                         "raw_path": str(Path(pdf_path).relative_to(RAW.parent)) if str(pdf_path).startswith(str(RAW)) else str(pdf_path),
                         "hash": sha256_of(Path(pdf_path).read_bytes())})
    if log:
        log.ok(company_id, f"{doc_id}: 役員の状況 {len(pages)} ページ")
    return out


def list_documents(day, key):
    text, _ = fetch(f"{API}/documents.json", params={"date": day, "type": 2, "Subscription-Key": key}, respect_robots=False)
    import json
    j = json.loads(text)
    return j.get("results") or []


def download_pdf(doc_id, key, dest):
    data, ct = fetch(f"{API}/documents/{doc_id}", params={"type": 2, "Subscription-Key": key}, binary=True, respect_robots=False)
    if not data[:5].startswith(b"%PDF"):
        raise ValueError(f"PDF ではない({ct})")
    Path(dest).write_bytes(data)
    return dest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="d_from")
    ap.add_argument("--to", dest="d_to")
    ap.add_argument("--only")
    ap.add_argument("--companies", default=str(DATA / "companies.json"))
    ap.add_argument("--pdf")
    ap.add_argument("--company")
    ap.add_argument("--doc-id")
    ap.add_argument("--url")
    a = ap.parse_args()
    log = RunLog("crawl_edinet")
    if a.pdf:
        save_officers(a.company, a.pdf, a.doc_id or Path(a.pdf).stem, a.url or f"file://{a.pdf}", a.company, log=log)
        log.save()
        return
    key = os.environ.get("EDINET_API_KEY")
    if not key:
        sys.exit("EDINET_API_KEY が未設定(SPEC §13-1: 会社アカウントで取得)")
    reg = jload(a.companies)
    if not reg:
        sys.exit("data/companies.json が無い。先に registry.py")
    by_code = {c["edinet_code"]: c for c in reg["companies"] if c.get("edinet_code")}
    d_to = date.fromisoformat(a.d_to) if a.d_to else date.today()
    d_from = date.fromisoformat(a.d_from) if a.d_from else d_to - timedelta(days=1)
    day = d_from
    while day <= d_to:
        try:
            docs = list_documents(day.isoformat(), key)
        except Exception as e:
            log.fail("-", f"{day}: 書類一覧の取得失敗: {e}")
            day += timedelta(days=1)
            continue
        for d in docs:
            if d.get("docTypeCode") not in DOC_TYPES:
                continue
            c = by_code.get(d.get("edinetCode"))
            if not c or (a.only and c["id"] != a.only):
                continue
            doc_id = d["docID"]
            cdir = RAW / c["id"]
            cdir.mkdir(parents=True, exist_ok=True)
            pdf = cdir / f"yuho_{doc_id}.pdf"
            if (cdir / f"yuho_{doc_id}_officers.json").exists():
                continue   # 冪等: 同じ書類は再処理しない
            try:
                if not pdf.exists():
                    download_pdf(doc_id, key, pdf)
                url = f"https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/{doc_id}.pdf"
                save_officers(c["id"], pdf, doc_id, url, d.get("edinetCode"), d.get("secCode"), (d.get("submitDateTime") or "")[:10], d.get("periodEnd"), log)
            except Exception as e:
                log.fail(c["id"], f"{doc_id}: {e}")
        day += timedelta(days=1)
    log.save()


if __name__ == "__main__":
    main()
