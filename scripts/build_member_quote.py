"""3D 見積ツール(site/members/quote/)の価格マスタを暗号化して書き出す。

入力: site/internal/quote/price-master.json(平文。原価・粗利を含む。internal/ なのでコミットされない)
  カテゴリ(標準商品・準標準商品・非標準商品・適合業務・現地導入…)と商品・単価・原価・人日単価・ひな形。
  元はエクセル「LexxMoMa-見積 社内検討」。カテゴリの区分はエクセルに合わせて変えないこと。
出力: site/members/quote/data.enc.json と data.enc.js
暗号化: 工場マップ・顧客人事DB・共有動画と同じ。パスワード → PBKDF2-SHA256(310,000 回・salt 16B) → AES-256-GCM(iv 12B)。

使い方:  python scripts/build_member_quote.py        (共通パスワードを画面に出さずに入力)
"""
import base64
import json
import os
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "site" / "internal" / "quote" / "price-master.json"
OUT = ROOT / "site" / "members" / "quote" / "data.enc.json"


def check(data):
    ids = set()
    for c in data["categories"]:
        for it in c["items"]:
            if it["id"] in ids:
                sys.exit(f"商品 ID が重複しています: {it['id']}")
            ids.add(it["id"])
            if not it.get("manday") and "price" not in it and not it.get("variants"):
                sys.exit(f"単価がありません: {it['id']}")
    for c in data["categories"]:
        for it in c["items"]:
            for ref in it.get("with", []) + [r for v in it.get("variants", []) for r in v.get("with", [])]:
                if ref not in ids:
                    sys.exit(f"{it['id']} の with に知らない商品があります: {ref}")
    for p in data.get("presets", []):
        for ref in p["items"]:
            if ref not in ids:
                sys.exit(f"ひな形 {p['id']} に知らない商品があります: {ref}")
    return len(ids)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    data = json.loads(SRC.read_text(encoding="utf-8"))
    n = check(data)
    data["updated"] = date.today().isoformat()

    pw = os.environ.get("FACTORY_PW")
    if not pw:
        # コマンド履歴に残さないよう、画面に出さずに入力してもらう
        import getpass
        pw = getpass.getpass("共通パスワード(表示されません): ")
        if not pw:
            sys.exit("パスワードが空です")

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    # 打ち間違い防止: 工場マップのデータが同じパスワードで開けることを確かめてから書き出す
    fm = json.loads((OUT.parent.parent / "factory-map" / "data.enc.json").read_text(encoding="utf-8"))
    fk = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=base64.b64decode(fm["salt"]), iterations=fm["iter"]).derive(pw.encode("utf-8"))
    try:
        AESGCM(fk).decrypt(base64.b64decode(fm["iv"]), base64.b64decode(fm["ct"]), None)
    except Exception:
        sys.exit("パスワードが社内ツールの共通パスワードと違います(工場マップのデータを開けません)。書き出していません")
    salt, iv, it = os.urandom(16), os.urandom(12), 310000
    k = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=it).derive(pw.encode("utf-8"))
    ct = AESGCM(k).encrypt(iv, json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), None)
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    enc = json.dumps({"v": 1, "kdf": "PBKDF2-SHA256", "iter": it, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)})
    OUT.write_text(enc, encoding="utf-8")
    # ファイルを直接開いた(file://)場合は fetch が使えないので、<script> で読める形でも書き出す
    OUT.with_name("data.enc.js").write_text("window.QUOTE_ENC=" + enc + ";\n", encoding="utf-8")
    print(f"商品 {n} 点 → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
