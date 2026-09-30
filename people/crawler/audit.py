# -*- coding: utf-8 -*-
"""データ品質の監査(品質改善ループ用)。有報の本文にある「正解」と組み立て結果を突き合わせる。

正解として使う記載:
  - 「男性N名 女性M名(役員のうち女性の比率…)」 … 取締役・監査役の人数(提出日現在 a 表 / 総会後 b 表)
  - 「執行役員は次のN名」「執行役員(N名)」 … 執行役員の人数(記載がある会社のみ)
検査項目(会社ごと):
  officers_expected / officers_parsed / officers_ok  … a 表の人数一致
  exec_expected / exec_parsed / exec_ok              … 執行役員の人数一致(記載がある場合)
  born_rate    … 役員のうち生年月が取れた割合
  career_rate  … 役員のうち略歴が 2 行以上取れた割合
  current_rate … 役員のうち現職(当社役職)が出ている割合
  bad_names    … 氏名として不自然なもの(部署名・役職名・数字入り)
  own_career   … 略歴の「当社」行の割合(社名表記の当社判定が効いているか)
  site         … 会社サイトの役員一覧を取れたか・人数
出力: data/audit.json(会社ごと)と画面への要約。build.py の quality にも取り込む。

使い方: python audit.py [--top 20]   (build.py --plain-only の後に実行)
"""
import argparse
import glob
import re
from collections import Counter
from pathlib import Path

from common import DATA, RAW, jdump, jload, nfkc, normalize_name

GENDER_RE = re.compile(r"男性\s*(\d+)\s*名\s*[、,，]?\s*女性\s*(\d+)\s*名")
EXEC_N_RE = re.compile(r"執行役員(?:制度を導入して.*?)?(?:は|の)?(?:、)?\s*(?:次の|以下の)?\s*(\d+)\s*名")
BAD_NAME_RE = re.compile(r"(本部|部長|室長|担当|所長|工場|法人|名称|事務所|委員|取締役|監査役|執行役|\d)")


def expected_counts(doc):
    """有報の officers JSON から、a 表と b 表の役員数・執行役員数の記載を取る。"""
    out = {"a": None, "b": None, "exec_a": None, "exec_b": None}
    part = "a"
    for pg in doc.get("pages", []):
        t = nfkc(pg.get("text") or "")
        if re.search(r"[ｂb][．.]\s*\d{4}年\d{1,2}月\d{1,2}日開催予定の", t) or re.search(r"開催予定の(?:第\d+回)?定時株主総会[^\n]{0,80}(?:議案|承認)", t):
            # 同じページの中で a → b に切り替わる
            idx = re.search(r"開催予定の", t).start()
            for m in GENDER_RE.finditer(t):
                key = "a" if m.start() < idx and out["a"] is None else "b"
                out[key] = out[key] or int(m.group(1)) + int(m.group(2))
            part = "b"
            continue
        for m in GENDER_RE.finditer(t):
            if out[part] is None:
                out[part] = int(m.group(1)) + int(m.group(2))
        k = "exec_" + part
        if out[k] is None:
            # 「執行役員は…の10名で構成」「社長執行役員1名、専務執行役員2名、…執行役員11名で構成」: 構成の直前の人数、無ければ内訳の合計
            for m in re.finditer(r"執行役員(?:制度)?[^。]{0,200}?(\d+)\s*名\s*(?:で構成|です|であります|となって|の体制)", t):
                sent = m.group(0)
                parts = re.findall(r"執行役員\s*(\d+)\s*名", sent)
                total = int(m.group(1))
                if len(parts) >= 2 and not re.search(r"の\s*\d+\s*名で構成", sent):
                    total = sum(int(x) for x in parts)
                if 1 <= total <= 150:
                    out[k] = total
                    break
            if out[k] is None:
                m = re.search(r"執行役員は\s*(\d+)\s*名", t)   # 「執行役員は27名(うち4名が取締役を兼務)です」
                if m and 1 <= int(m.group(1)) <= 150:
                    out[k] = int(m.group(1))
    return out


def audit(data):
    co = {c["id"]: c for c in data["companies"]}
    persons_by = {}
    for p in data["persons"]:
        persons_by.setdefault(p["company_id"], []).append(p)
    ten_by = {}
    for t in data["tenures"]:
        ten_by.setdefault(t["company_id"], []).append(t)
    rows = {}
    for cid, ps in persons_by.items():
        docs = sorted(glob.glob(str(RAW / cid / "yuho_*_officers.json")))
        doc = jload(docs[-1]) if docs else None
        exp = expected_counts(doc) if doc else {}
        parsed_a = None
        if doc:
            from parse_officers import parse_officers_json
            r0 = parse_officers_json(doc, [co.get(cid, {}).get("short_name"), co.get(cid, {}).get("name")])
            # 取締役・監査役(執行役・執行役員だけの行は数えない)。同じ人が 2 行(取締役 / 執行役)に出ても 1 人
            parsed_a = len({o["name_key"] for o in r0["officers"]})
        yuho_src = {s["id"] for s in data["sources"] if s["company_id"] == cid and s["kind"] == "yuho"}
        # 有報の a 表に載った人 = 有報出典の在任を持ち、born がある人(役員の表)
        officers = [p for p in ps if p.get("born") and set(p.get("source_ids") or []) & yuho_src]
        # 有報の「執行役員は N 名(うち M 名が取締役を兼務)」に合わせ、取締役兼務の執行役員も数える
        execs = [p for p in ps if any("執行役員" in (t or "") for t in p.get("current_titles") or [])]
        n = len(officers) or 1
        def _bad(n):
            k = normalize_name(n)
            if BAD_NAME_RE.search(k) or len(k) < 2 or re.search(r"(事務所|法人|パートナー|資料|名称|代行|カウンセル|長付)", k):
                return True
            foreign = re.fullmatch(r"[ァ-ヶー・A-Za-z.\s-]+", k)   # 外国籍の方の長い氏名は可
            return len(k) > (32 if foreign else 12)
        bad = [p["name"] for p in ps if _bad(p["name"])]
        # 社内の役員(社外でない人)のうち、略歴に「当社」の行が 1 つ以上ある割合
        insiders = [p for p in officers if not p.get("is_outside")]
        own_rate = round(sum(1 for p in insiders if any(c["text"].startswith("当社") for c in p.get("career") or [])) / len(insiders), 2) if insiders else 0
        careers = insiders
        site = sorted(glob.glob(str(RAW / cid / "site_executives_*.json")))
        site_snap = (jload(site[-1]) or {}) if site else {}
        site_n = len(site_snap.get("entries") or []) if site else None
        # 出典どうしの突き合わせ: 有報の最新の役員(総会後予定があればそれ)のうち、会社サイトの一覧にも載っている割合
        overlap = None
        if doc and site_snap.get("entries"):
            latest = r0["planned"]["officers"] or r0["officers"]
            yk = {o["name_key"] for o in latest}
            sk = {e["name_key"] for e in site_snap["entries"]}
            if yk:
                overlap = round(len(yk & sk) / len(yk), 2)
        site_careers = sum(1 for e in site_snap.get("entries") or [] if e.get("career_raw"))
        # a 表の人数: 生年月が付いた有報由来の人のうち、提出日時点で在任していた人
        a_expected = exp.get("a")
        rows[cid] = {
            "company_id": cid, "name": co.get(cid, {}).get("short_name", cid), "persons": len(ps),
            "officers_expected": a_expected, "officers_parsed": parsed_a if parsed_a is not None else len(officers),
            "officers_ok": (parsed_a == a_expected) if (a_expected and parsed_a is not None) else None,
            "exec_expected": exp.get("exec_a"), "exec_parsed": len(execs),
            "exec_ok": (abs(len(execs) - exp["exec_a"]) <= 1) if exp.get("exec_a") else None,
            "born_rate": round(sum(1 for p in officers if p.get("born")) / n, 2),
            "career_rate": round(sum(1 for p in officers if len(p.get("career") or []) >= 2) / n, 2),
            "current_rate": round(sum(1 for p in officers if p.get("current_titles")) / n, 2),
            "own_career": own_rate,
            "bad_names": bad[:10], "bad_name_count": len(bad),
            "site_persons": site_n, "site_yuho_overlap": overlap, "site_careers": site_careers, "tenures": len(ten_by.get(cid, [])),
            "signals": sum(1 for s in data["signals"] if s["company_id"] == cid),
        }
    return rows


def score(r):
    """0〜100 の会社スコア(一覧で悪い順に直すため)。"""
    s = 0
    s += 30 if r["officers_ok"] else (10 if r["officers_ok"] is None else 0)
    s += 15 if r["exec_ok"] or (r["exec_expected"] is None and r["exec_parsed"]) else 0
    s += 15 * r["current_rate"] + 15 * r["career_rate"] + 5 * r["born_rate"]
    s += 10 if r["bad_name_count"] == 0 else 0
    s += 10 if r["site_persons"] else 0
    return round(s)


def career_coverage(data):
    ps = data["persons"]
    return round(sum(1 for p in ps if len(p.get("career") or []) >= 2) / len(ps), 3) if ps else 0


def summarize(rows):
    # 有報の指標(人数一致・生年月・略歴・当社判定)は有報のある会社だけで平均する。会社サイトだけの会社は site_* で見る
    rs = [r for r in rows.values() if r["officers_expected"] is not None or r["officers_parsed"]]
    site_only = [r for r in rows.values() if r not in rs]
    def rate(k):
        v = [r[k] for r in rs if r[k] is not None]
        return round(sum(1 for x in v if x) / len(v), 3) if v else None
    def mean(k):
        return round(sum(r[k] for r in rs) / len(rs), 3) if rs else 0
    return {"companies": len(rs), "officers_ok_rate": rate("officers_ok"), "exec_ok_rate": rate("exec_ok"),
            "exec_any": round(sum(1 for r in rs if r["exec_parsed"]) / len(rs), 3) if rs else 0,
            "current_rate": mean("current_rate"), "career_rate": mean("career_rate"), "born_rate": mean("born_rate"),
            "own_career": mean("own_career"), "bad_names": sum(r["bad_name_count"] for r in rs),
            "site_rate": round(sum(1 for r in rows.values() if r["site_persons"]) / len(rows), 3) if rows else 0,
            "site_only_companies": len(site_only), "all_companies": len(rows),
            "site_yuho_overlap": (lambda v: round(sum(v) / len(v), 3) if v else None)([r["site_yuho_overlap"] for r in rows.values() if r.get("site_yuho_overlap") is not None]),
            "site_mismatch_companies": sum(1 for r in rows.values() if r.get("site_yuho_overlap") is not None and r["site_yuho_overlap"] < 0.6),
            "persons_with_career": None,
            "site_only_bad_names": sum(r["bad_name_count"] for r in site_only),
            "score_mean": round(sum(r["score"] for r in rs) / len(rs), 1) if rs else 0}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=15)
    a = ap.parse_args()
    data = jload(DATA / "people_all.json")
    rows = audit(data)
    for r in rows.values():
        r["score"] = score(r)
    s = summarize(rows)
    hist = jload(DATA / "audit_history.json", [])
    hist.append(s)
    jdump({"summary": s, "companies": rows}, DATA / "audit.json")
    jdump(hist[-50:], DATA / "audit_history.json")
    print("summary", s)
    worst = sorted(rows.values(), key=lambda r: r["score"])[:a.top]
    for r in worst:
        print(f"{r['score']:3d} {r['name'][:14]:14s} off {r['officers_parsed']}/{r['officers_expected']} exec {r['exec_parsed']}/{r['exec_expected']} "
              f"cur {r['current_rate']} car {r['career_rate']} own {r['own_career']} bad {r['bad_names'][:3]} site {r['site_persons']}")


if __name__ == "__main__":
    main()
