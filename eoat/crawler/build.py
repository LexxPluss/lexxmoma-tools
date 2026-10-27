# -*- coding: utf-8 -*-
"""分類済みの事例(data/classified/)を組み立てて、公開側の暗号化データと画像パックを作る。

出力(平文 = data/、公開 = site/members/eoat-db/):
  data/cases.json                      平文の事例一覧(確認用。gitignore)
  data/packs.json                      画像 ID → パック・位置 の索引(追記型。gitignore だが作り直しても同じ結果になる)
  site/members/eoat-db/data.enc.json / data.enc.js   事例データ(PBKDF2-SHA256 310,000 回 → AES-256-GCM、deflate)
  site/members/eoat-db/img/thumb/p-NNNN.bin          一覧用サムネイルの暗号化パック([iv 12B][ct] の連結。追記型)
  site/members/eoat-db/img/detail/<id>.bin           詳細用画像(1 枚ずつ [iv 12B][ct])
鍵は 1 つ(データと画像で共通。salt は前回の data.enc.json から引き継ぐので、パックを作り直さずに済む)。
パスワードは --password か環境変数 EOAT_PW / FACTORY_PW / PEOPLE_PW。
使い方: python build.py --password … [--plain-only] [--no-audit]
"""
import argparse
import base64
import json
import os
import re
import zlib
from pathlib import Path

from common import DATA, MANUAL, SITE_OUT, SIER_DATA, TAXONOMY, RunLog, jdump, jload, today, yload, domain_of
from dedupe import dedupe

ITER = 310000
PACK_MAX = 400 * 1024   # 1 パックの上限(バイト)。超えたら次のパックへ(回線が遅くても最初の 1 パック ≈ 24 枚分が 1 秒台で届く大きさ)


# ---------------------------------------------------------------- 暗号
def derive_key(pw, salt):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(pw.encode("utf-8"))


def seal(key, plain):
    """[iv 12B][ct+tag]"""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    iv = os.urandom(12)
    return iv + AESGCM(key).encrypt(iv, plain, None)


def encrypt_json(data, key, salt, out_json):
    plain = zlib.compress(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 9)
    blob = seal(key, plain)
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    enc = json.dumps({"v": 2, "kdf": "PBKDF2-SHA256", "iter": ITER, "salt": b64(salt), "iv": b64(blob[:12]), "z": "deflate", "ct": b64(blob[12:])})
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(enc, encoding="utf-8")
    out_json.with_name("data.enc.js").write_text("window.EOAT_ENC=" + enc + ";\n", encoding="utf-8")


# ---------------------------------------------------------------- 文章(自分の言葉で。原文は写さない)
class Labels:
    def __init__(self):
        c = yload(TAXONOMY / "categories.yaml")["groups"]
        p = yload(TAXONOMY / "principles.yaml")["groups"]
        self.cat = {it["key"]: it["label"] for g in c for it in g["items"]}
        self.cat_group = {it["key"]: g["key"] for g in c for it in g["items"]}
        self.groups = [{"key": g["key"], "label": g["label"], "items": [{"key": it["key"], "label": it["label"]} for it in g["items"]]} for g in c]
        self.pr = {it["key"]: it["label"] for g in p for it in g["items"]}
        self.pr_group = {it["key"]: g["key"] for g in p for it in g["items"]}
        self.pgroups = [{"key": g["key"], "label": g["label"], "pictogram": g.get("pictogram"), "items": [{"key": it["key"], "label": it["label"]} for it in g["items"]]} for g in p]
        self.mat = {m["key"]: m["label"] for m in yload(TAXONOMY / "materials.yaml")["materials"]}
        self.task = {t["key"]: t["label"] for t in yload(TAXONOMY / "tasks.yaml")["tasks"]}
        self.syn = yload(TAXONOMY / "synonyms.yaml")["synonyms"]

    def public(self):
        return {"categories": self.groups, "principles": self.pgroups,
                "materials": [{"key": k, "label": v} for k, v in self.mat.items()],
                "tasks": [{"key": k, "label": v} for k, v in self.task.items()],
                "synonyms": self.syn,
                "payload_classes": ["≤5kg", "5–20kg", "20–100kg", ">100kg", "不明"],
                "regions": ["日本", "北米", "欧州", "中国", "その他アジア", "その他"],
                "case_types": {"maker_product": "メーカー完成品の適用例", "sier_case": "SIer・導入事例", "user_custom": "カスタム品(ユーザー・SIer 設計)", "research": "研究・オープンソース"}}


CASE_TYPE_JA = {"maker_product": "メーカーの適用例", "sier_case": "導入事例", "user_custom": "カスタムハンドの事例", "research": "研究事例"}


def compose_text(r, L):
    wp, ee, rb = r["workpiece"], r["end_effector"], r["robot"]
    work = "・".join(L.cat[k] for k in wp["categories"][:2])
    grip = "・".join(L.pr[k] for k in ee["principles"][:2])
    task = "・".join(L.task[k] for k in r["tasks"][:2]) if r["tasks"] else "ハンドリング"
    title = f"{work}の{task}({grip})"
    robot = ""
    if rb.get("maker"):
        robot = rb["maker"] + (" " + rb["model"] if rb.get("model") else "")
        if rb.get("class"):
            robot += f"({rb['class']}" + (f"、可搬 {rb['payload_kg']:g} kg" if rb.get("payload_kg") else "") + ")"
    elif rb.get("class"):
        robot = rb["class"] + "ロボット"
    ind = f"{r['industry'][0]}の現場で、" if r.get("industry") else ""
    mass = ""
    if wp.get("mass_kg"):
        m = wp["mass_kg"]
        mass = f"(約 {m['max']:g} kg)" if m["min"] == m["max"] else f"({m['min']:g}〜{m['max']:g} kg)"
    s = f"{ind}{work}{mass}を{grip}のハンドで{task}。"
    if robot:
        s += f"ロボットは {robot}。"
    if rb.get("is_mobile_manipulator"):
        s += "移動マニピュレータ(AMR+アーム)。"
    if ee.get("is_custom"):
        s += "ハンドはカスタム品。"
    s += CASE_TYPE_JA.get(r["case_type"], "") + "。"
    s = s.replace("。。", "。")
    return title[:60], s[:120]


def lexxmoma_fit(r):
    """LexxMoMa(可搬 20 kg・協働アーム・AMR)での適用可能性。推測であることを明記して interpretation に置く。"""
    pl, rb = r["payload_class"], r["robot"]
    reasons, level = [], "要確認"
    if pl in ("≤5kg", "5–20kg"):
        level = "高"
        reasons.append(f"可搬重量帯 {pl} は LexxMoMa の 20 kg の範囲")
    elif pl == "20–100kg":
        level = "中"
        reasons.append("20〜100 kg の事例。ワークの実重量が 20 kg 以下かを要確認")
    elif pl == ">100kg":
        level = "低"
        reasons.append("100 kg 超の事例。LexxMoMa の可搬を超える")
    else:
        reasons.append("重量の記載が無い")
    if rb.get("class") == "協働":
        reasons.append("協働ロボットでの事例(同種のアーム)")
    if rb.get("is_mobile_manipulator"):
        reasons.append("移動マニピュレータでの事例(同じ形態)")
    if "transport" in r["tasks"] or "machine_tending" in r["tasks"]:
        reasons.append("工程間搬送・マシンテンディングは LexxMoMa の主用途")
    return {"level": level, "reasons": reasons, "is_speculative": True,
            "verify": ["ワークの実重量と把持位置", "ハンドの重さを含めた可搬", "AMR 上での位置ずれへの許容(ビジョン・コンプライアンス)"]}


# ---------------------------------------------------------------- 検証(必須項目)
REQUIRED_IMG = ("id", "source_page_url", "credit", "retrieved_at", "policy")


def validate(r, L):
    errs = []
    if not r["workpiece"].get("categories"):
        errs.append("categories が空")
    if not r["end_effector"].get("principles"):
        errs.append("principles が空")
    if r["robot"].get("class") not in ("産業用", "協働", None):
        errs.append(f"robot.class が不正: {r['robot'].get('class')}")
    if r.get("image_policy") != "link_only" and not r.get("images"):
        errs.append("images が空")
    for im in r.get("images", []):
        for k in REQUIRED_IMG:
            if not im.get(k):
                errs.append(f"画像 {im.get('id')} に {k} が無い")
    if not r.get("sources"):
        errs.append("sources が空")
    for k in r["workpiece"]["categories"]:
        if k not in L.cat:
            errs.append(f"未知のカテゴリ {k}")
    for k in r["end_effector"]["principles"]:
        if k not in L.pr:
            errs.append(f"未知の掴み方 {k}")
    return errs


# ---------------------------------------------------------------- SIer DB との照合(取得元ドメイン = SIer の公式サイト)
def sier_index():
    if not SIER_DATA.exists():
        return {}
    s = SIER_DATA.read_text(encoding="utf-8")
    try:
        data = json.loads(s[s.index("=") + 1:].rstrip().rstrip(";"))
    except Exception:
        return {}
    out = {}
    for c in data:
        if c.get("website"):
            out[domain_of(c["website"])] = {"id": c["id"], "name": c["name"]}
    return out


# ---------------------------------------------------------------- 画像パック
def load_pack_index():
    return jload(DATA / "packs.json", {"packs": [], "images": {}, "detail": {}})


def pack_images(cases, key, pidx, out_dir):
    """未格納のサムネイルを最後のパックに追記(上限を超えたら新しいパック)。詳細画像は 1 枚ずつ。索引 pidx を更新して返す。"""
    thumb_dir, detail_dir = out_dir / "img" / "thumb", out_dir / "img" / "detail"
    thumb_dir.mkdir(parents=True, exist_ok=True)
    detail_dir.mkdir(parents=True, exist_ok=True)
    added_b = 0
    # 代表画像(各事例の 1 枚目)を先に詰め、2 枚目以降は後ろのパックへ。一覧の最初の画面に要るのは代表画像だけなので、最初のパックだけで表示が始まる
    order = [(r, im) for r in cases for im in r.get("images", [])[:1]] + [(r, im) for r in cases for im in r.get("images", [])[1:]]
    for r, im in order:
        if True:
            iid = im["id"]
            if iid not in pidx["images"]:
                src = DATA / "img" / "thumb" / f"{iid}.webp"
                if not src.exists():
                    continue
                blob = seal(key, src.read_bytes())
                if not pidx["packs"] or pidx["packs"][-1]["bytes"] + len(blob) > PACK_MAX:
                    pidx["packs"].append({"name": f"p-{len(pidx['packs']) + 1:04d}.bin", "bytes": 0, "n": 0})
                pk = pidx["packs"][-1]
                with open(thumb_dir / pk["name"], "ab") as f:
                    f.write(blob)
                pidx["images"][iid] = {"pack": pk["name"], "off": pk["bytes"], "len": len(blob)}
                pk["bytes"] += len(blob)
                pk["n"] += 1
                added_b += len(blob)
            if iid not in pidx["detail"]:
                src = DATA / "img" / "detail" / f"{iid}.webp"
                if src.exists():
                    blob = seal(key, src.read_bytes())
                    (detail_dir / f"{iid}.bin").write_bytes(blob)
                    pidx["detail"][iid] = {"file": f"{iid}.bin", "len": len(blob)}
                    added_b += len(blob)
            im["thumb"] = dict(im["thumb"], **pidx["images"].get(iid, {}))
            im["detail"] = dict(im["detail"], **pidx["detail"].get(iid, {}))
    return added_b


# ---------------------------------------------------------------- 組み立て
def assemble(log):
    L = Labels()
    sup = jload(MANUAL / "suppressions.json", {"cases": [], "images": [], "domains": []})
    sup_cases = {s["id"] for s in sup.get("cases", [])}
    sup_imgs = {s["id"] for s in sup.get("images", [])}
    sup_doms = set(sup.get("domains", []))
    siers = sier_index()
    cases = []
    for p in sorted((DATA / "classified").glob("*.json")):
        r = jload(p)
        if r["id"] in sup_cases:
            continue
        if any(domain_of(s["url"]) in sup_doms for s in r["sources"]):
            continue
        r["images"] = [im for im in r.get("images", []) if im["id"] not in sup_imgs]
        if not r["images"] and r.get("image_policy") != "link_only":
            log.fail(r["sources"][0]["url"], "画像が無いので載せない")
            continue
        r["title_ja"], r["summary_ja"] = compose_text(r, L)
        r["interpretation"] = {"lexxmoma_fit": lexxmoma_fit(r)}
        d = domain_of(r["sources"][0]["url"])
        if d in siers:
            r["integrator"] = {"name": siers[d]["name"], "country": "日本", "sier_db_id": siers[d]["id"]}
        errs = validate(r, L)
        if errs:
            log.fail(r["sources"][0]["url"], "; ".join(errs))
            continue
        r.pop("image_candidates", None)
        r.pop("_text_head", None)
        cases.append(r)
    cases, merged, reasons = dedupe(cases)
    jdump(reasons, DATA / "dedupe_log.json")
    # UI の既定の並び(search.js の score: 5–20kg > ≤5kg > 20–100kg、協働・移動マニピュレータを先)に合わせる。最初のパックが最初の画面になる
    # search.js の score() と同じ式(条件なしのとき): 可搬帯 + 協働 + 移動 + 画像の枚数 + 分類の確信度。並びが違うと最初の 24 枚が 4 つのパックに散り、Fast 3G で 16 秒かかった(ループ 8)
    def ui_score(r):
        s = {"5–20kg": 2, "≤5kg": 1.5, "20–100kg": 0.5}.get(r["payload_class"], 0)
        s += 1 if r["robot"].get("class") == "協働" else 0
        s += 1.5 if r["robot"].get("is_mobile_manipulator") else 0
        s += min(len(r["images"]), 3) * 0.3
        conf = (r.get("quality") or {}).get("confidence") or {}
        s += (conf.get("category") or 0) + (conf.get("principle") or 0)
        return s
    cases.sort(key=lambda r: (-ui_score(r), r["id"]))
    return cases, L, merged


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--password")
    ap.add_argument("--plain-only", action="store_true")
    ap.add_argument("--no-audit", action="store_true")
    ap.add_argument("--repack", action="store_true", help="画像パックを並び順どおりに作り直す(既定は追記。並びを変えたときに使う)")
    a = ap.parse_args()
    log = RunLog("build")
    cases, L, merged = assemble(log)
    plain = {"built_at": today(), "count": len(cases), "taxonomy": L.public(), "cases": cases}
    jdump(plain, DATA / "cases.json")
    print(f"事例 {len(cases)} 件(重複で束ねた {merged} 件)→ data/cases.json")
    if not a.plain_only:
        pw = a.password or os.environ.get("EOAT_PW") or os.environ.get("FACTORY_PW") or os.environ.get("PEOPLE_PW")
        if not pw:
            raise SystemExit("パスワードが必要です(--password か EOAT_PW)。平文だけなら --plain-only")
        prev = jload(SITE_OUT / "data.enc.json")
        pidx = load_pack_index()
        salt = base64.b64decode(prev["salt"]) if prev and pidx["packs"] else os.urandom(16)
        if prev and not pidx["packs"]:
            # 索引が無い(別の環境で作った)ときは、パックを作り直す
            for f in (SITE_OUT / "img").glob("**/*.bin"):
                f.unlink()
        key = derive_key(pw, salt)
        # 鍵が変わったら(パスワード変更)パックは全部作り直す
        kc = pidx.get("key_check")
        import hashlib
        kc_now = hashlib.sha256(key + b"eoat").hexdigest()[:16]
        if kc and kc != kc_now:
            print("パスワードが変わったので画像パックを作り直します")
            for f in (SITE_OUT / "img").glob("**/*.bin"):
                f.unlink()
            pidx = {"packs": [], "images": {}, "detail": {}}
        if a.repack:
            # 追記だけだと、並びを変えても既存の画像は古いパックに残り、最初の画面が 4〜5 パックに散る(ループ 8)。並びを変えたときは作り直す
            print("画像パックを作り直します(--repack)")
            for f in (SITE_OUT / "img" / "thumb").glob("*.bin"):
                f.unlink()
            pidx = {"packs": [], "images": {}, "detail": pidx.get("detail", {}), "key_check": kc_now}
        pidx["key_check"] = kc_now
        added = pack_images(cases, key, pidx, SITE_OUT)
        # 公開しなくなった画像の詳細ファイルは消す
        used = {im["id"] for r in cases for im in r.get("images", [])}
        for iid in [i for i in pidx["detail"] if i not in used]:
            (SITE_OUT / "img" / "detail" / pidx["detail"][iid]["file"]).unlink(missing_ok=True)
            del pidx["detail"][iid]
        jdump(pidx, DATA / "packs.json")
        plain["packs"] = [p["name"] for p in pidx["packs"]]
        plain["cases"] = cases
        encrypt_json(plain, key, salt, SITE_OUT / "data.enc.json")
        total = sum(f.stat().st_size for f in (SITE_OUT / "img").glob("**/*.bin"))
        print(f"暗号化 → {SITE_OUT.relative_to(SITE_OUT.parents[2])}/data.enc.json  画像 +{added/1e6:.1f} MB(合計 {total/1e6:.1f} MB, パック {len(pidx['packs'])})")
    log.save()
    if not a.no_audit:
        import audit
        audit.run(plain)


if __name__ == "__main__":
    main()
