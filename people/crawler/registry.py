# -*- coding: utf-8 -*-
"""企業マスタの作成(SPEC §2.1 / §4 registry / §11-1)。

入力: 工場マップの companies(平文 site/internal/factory-db/data/factories.json があればそれ、
      無ければ公開側 site/members/factory-map/data.enc.json を共通パスワード(FACTORY_PW / PEOPLE_PW)で復号)
      EDINET コードリスト CSV(金融庁公開。raw/edinetcode.csv にキャッシュ。無ければダウンロード)
      manual/ir_urls.json(各社の役員一覧/組織図/ニュース URL)
出力: data/companies.json、data/registry_todo.json(EDINET コード未照合の上場企業)

使い方: python registry.py [--factory <factories.json>] [--edinet-csv <csv>] [--out <dir>]
"""
import argparse
import base64
import csv
import io
import json
import os
import re
import zipfile

from common import DATA, FACTORY_ENC, FACTORY_PLAIN, MANUAL, RAW, RunLog, fetch, jdump, jload, nfkc, today

EDINET_CODELIST_URL = "https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip"


def load_factory_companies(path=None, password=None):
    """工場マップの企業マスタ。平文が無ければ暗号化データを復号する(工場マップと同じ PBKDF2-SHA256 → AES-256-GCM)。"""
    if path:
        return jload(path)
    if FACTORY_PLAIN.exists():
        return jload(FACTORY_PLAIN)
    pw = password or os.environ.get("FACTORY_PW") or os.environ.get("PEOPLE_PW")
    if not pw:
        raise SystemExit("工場マップの平文が無く、パスワード(FACTORY_PW)も無いので企業マスタを読めません")
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    enc = jload(FACTORY_ENC)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=base64.b64decode(enc["salt"]), iterations=enc["iter"]).derive(pw.encode("utf-8"))
    plain = AESGCM(key).decrypt(base64.b64decode(enc["iv"]), base64.b64decode(enc["ct"]), None)
    return json.loads(plain.decode("utf-8"))


def load_edinet_codes(csv_path=None):
    """EDINET コードリスト → [{edinet_code, name, sec_code(4桁), listed, industry}]。"""
    if csv_path:
        text = open(csv_path, encoding="utf-8").read()
    else:
        cache = RAW / "edinetcode.csv"
        if not cache.exists():
            data, _ = fetch(EDINET_CODELIST_URL, binary=True)
            z = zipfile.ZipFile(io.BytesIO(data))
            name = [n for n in z.namelist() if n.lower().endswith(".csv")][0]
            text = z.read(name).decode("cp932", errors="replace")
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(text, encoding="utf-8")
        else:
            text = cache.read_text(encoding="utf-8")
    lines = text.splitlines()
    # 1 行目は「ダウンロード実行日,…」、2 行目がヘッダ
    start = next(i for i, l in enumerate(lines) if l.startswith("ＥＤＩＮＥＴコード") or l.startswith("EDINETコード"))
    rows = list(csv.DictReader(lines[start:]))
    out = []
    for r in rows:
        r = {nfkc(k): v for k, v in r.items()}
        sec = (r.get("証券コード") or "").strip()
        out.append({"edinet_code": r.get("EDINETコード", "").strip(), "name": r.get("提出者名", "").strip(),
                    "sec_code": sec[:4] if len(sec) == 5 else (sec or None), "listed": r.get("上場区分", "").strip(),
                    "industry": r.get("提出者業種", "").strip(), "kind": r.get("提出者種別", "").strip()})
    return out


def name_key(n):
    s = nfkc(n or "")
    s = re.sub(r"株式会社|\(株\)|㈱|有限会社|合同会社", "", s)
    s = re.sub(r"[\s・．.,，、()（）]", "", s)
    return s.lower()


def build_registry(factory, edinet_rows, ir_urls, ir_auto=None):
    ir_auto = ir_auto or {}
    by_key = {}
    for e in edinet_rows:
        by_key.setdefault(name_key(e["name"]), e)
    cos = factory["companies"]
    by_id = {c["id"]: c for c in cos}
    by_name = {c["name"]: c for c in cos}
    out, todo = [], []
    for c in cos:
        listed_flag = bool(c.get("listed")) and c["listed"] != "非上場"
        parent = by_name.get(c.get("parent") or "")
        parent_listed = bool(parent and parent.get("listed") and parent["listed"] != "非上場")
        status = "listed" if listed_flag else ("listed_parent" if parent_listed else "unlisted")
        e = by_key.get(name_key(c.get("legal") or c["name"])) or by_key.get(name_key(c["name"]))
        cid = e["edinet_code"] if e else c["id"]
        urls = ir_urls.get(c["name"]) or ir_urls.get(c["id"]) or {}
        auto = ir_auto.get(c["name"]) or {}
        # 人が確認した URL(ir_urls.json)を優先し、無い項目だけ自動候補(ir_urls_auto.json)で埋める
        urls = {k: urls.get(k) or auto.get(k) for k in ("executives", "organization", "news")}
        urls_confirmed = bool(ir_urls.get(c["name"]) or ir_urls.get(c["id"]))
        rec = {
            "id": cid, "name": c.get("legal") or c["name"], "short_name": c["name"],
            "securities_code": (e or {}).get("sec_code"), "edinet_code": (e or {}).get("edinet_code"),
            "listing_status": status, "listing_label": c.get("listed"),
            "parent_company_id": None, "parent_name": c.get("parent"), "group": c.get("group"), "industry": c.get("industry"),
            "factory_map_ids": [c["id"]],
            "ir_urls": {"executives": urls.get("executives"), "organization": urls.get("organization"), "news": urls.get("news")},
            "ir_urls_confirmed": urls_confirmed,
            "web": c.get("web"), "fiscal_year_end": None, "agm_month": None,
            "priority": 0,
        }
        out.append(rec)
        if listed_flag and not e:
            todo.append({"factory_map_id": c["id"], "name": c["name"], "legal": c.get("legal"), "listed": c.get("listed"),
                         "todo": "EDINET コードを照合できない。manual/edinet_overrides.json に {\"会社名\": \"E00000\"} を追加する"})
    # 親会社 ID
    id_by_fm = {r["factory_map_ids"][0]: r["id"] for r in out}
    for r in out:
        p = by_name.get(r["parent_name"] or "")
        r["parent_company_id"] = id_by_fm.get(p["id"]) if p else None
    # 一覧の並び: 上場 → 親会社上場 → 非上場(IH パイプラインでの優先付けは 2026-09-30 に廃止)
    for r in out:
        r["priority"] = {"listed": 1, "listed_parent": 2}.get(r["listing_status"], 3)
    out.sort(key=lambda r: (r["priority"], r["short_name"]))
    return out, todo


def apply_overrides(companies, overrides, edinet_rows):
    by_code = {e["edinet_code"]: e for e in edinet_rows}
    for c in companies:
        code = overrides.get(c["short_name"]) or overrides.get(c["name"])
        if code:
            e = by_code.get(code)
            c["edinet_code"], c["id"] = code, code
            c["securities_code"] = e["sec_code"] if e else c["securities_code"]
    return companies


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--factory")
    ap.add_argument("--edinet-csv")
    ap.add_argument("--out", default=str(DATA))
    ap.add_argument("--password")
    a = ap.parse_args()
    log = RunLog("registry")
    factory = load_factory_companies(a.factory, a.password)
    rows = load_edinet_codes(a.edinet_csv)
    ir_urls = jload(MANUAL / "ir_urls.json", {})
    overrides = jload(MANUAL / "edinet_overrides.json", {})
    ir_auto = jload(MANUAL / "ir_urls_auto.json", {})
    companies, todo = build_registry(factory, rows, ir_urls, ir_auto)
    companies = apply_overrides(companies, overrides, rows)
    todo = [t for t in todo if t["name"] not in overrides and (t["legal"] or "") not in overrides]
    from collections import Counter
    st = Counter(c["listing_status"] for c in companies)
    listed = [c for c in companies if c["listing_status"] == "listed"]
    matched = sum(1 for c in listed if c["edinet_code"])
    rate = matched / len(listed) if listed else 0
    summary = {"builtAt": today(), "factory_builtAt": factory.get("builtAt"), "counts": dict(st), "listed": len(listed),
               "edinet_matched": matched, "edinet_match_rate": round(rate, 3), "todo": len(todo)}
    jdump({"summary": summary, "companies": companies}, os.path.join(a.out, "companies.json"))
    jdump(todo, os.path.join(a.out, "registry_todo.json"))
    print(json.dumps(summary, ensure_ascii=False))
    for c in companies:
        log.ok(c["id"], "registered")
    if rate < 0.9:
        log.fail("-", f"EDINET 照合率 {rate:.1%} < 90%(受入基準 1)。data/registry_todo.json を確認")
    log.save()


if __name__ == "__main__":
    main()
