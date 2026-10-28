# -*- coding: utf-8 -*-
"""公開側の暗号化データ(site/members/eoat-db/)を、別のパスワードで暗号化し直す。data/ が無い環境でも使える。

data.enc.json・data.detail.enc.json と画像(img/thumb/*.bin・img/detail/*.bin)を古い鍵で全部復号できることを確かめてから、新しい salt・鍵で書き換える。
1 件ずつ [iv 12B][ct] を同じ長さで暗号化し直すので、パック内の位置(thumb.off / len)と事例データの中身は変わらない。
新しいパスワードは環境変数 EOAT_PW(または FACTORY_PW / PEOPLE_PW)。古いパスワードは --old-password(既定はパイロット用の pilot-test)。
使い方: python rekey.py [--old-password pilot-test]
注: data/ がある環境では data/packs.json の key_check が古いままになる。次の build.py は鍵の違いを検出して画像パックを作り直す。
"""
import argparse
import base64
import json
import os
import sys
import zlib

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from build import derive_key, encrypt_json, seal
from common import SITE_OUT


def open_record(key, blob):
    return AESGCM(key).decrypt(blob[:12], blob[12:], None)


def main():
    sys.stdout.reconfigure(encoding="utf-8")   # Windows のコンソール(cp1252 等)でも日本語の表示で落ちないように
    ap = argparse.ArgumentParser()
    ap.add_argument("--old-password", default="pilot-test")
    a = ap.parse_args()
    new_pw = os.environ.get("EOAT_PW") or os.environ.get("FACTORY_PW") or os.environ.get("PEOPLE_PW")
    if not new_pw:
        raise SystemExit("新しいパスワードを環境変数 EOAT_PW に入れてください")
    if new_pw == a.old_password:
        raise SystemExit("新しいパスワードが古いパスワードと同じです")

    enc = json.loads((SITE_OUT / "data.enc.json").read_text(encoding="utf-8"))
    old_key = derive_key(a.old_password, base64.b64decode(enc["salt"]))
    try:
        data = json.loads(zlib.decompress(open_record(old_key, base64.b64decode(enc["iv"]) + base64.b64decode(enc["ct"]))))
    except InvalidTag:
        raise SystemExit("古いパスワードで data.enc.json を復号できません(--old-password を確認)")
    # 詳細用(ループ 10 から。data.enc.json と同じ salt・鍵)
    detail = None
    dp = SITE_OUT / "data.detail.enc.json"
    if dp.exists():
        denc = json.loads(dp.read_text(encoding="utf-8"))
        try:
            detail = json.loads(zlib.decompress(open_record(old_key, base64.b64decode(denc["iv"]) + base64.b64decode(denc["ct"]))))
        except InvalidTag:
            raise SystemExit("古いパスワードで data.detail.enc.json を復号できません")

    # 一覧用パック: 事例データの thumb.{pack, off, len} が各レコードの位置。パック全体を隙間なく覆うことも確かめる
    thumb_dir, detail_dir = SITE_OUT / "img" / "thumb", SITE_OUT / "img" / "detail"
    spans = {}
    detail_files = set()
    for c in data["cases"]:
        for im in c.get("images", []):
            t = im.get("thumb") or {}
            if "pack" in t:
                spans.setdefault(t["pack"], set()).add((t["off"], t["len"]))
            d = im.get("detail") or {}
            if "file" in d:
                detail_files.add(d["file"])
    packs = {f.name for f in thumb_dir.glob("*.bin")}
    if packs != set(spans):
        raise SystemExit(f"パックの一覧が事例データと合いません: ファイルだけ {sorted(packs - set(spans))} / データだけ {sorted(set(spans) - packs)}")
    on_disk = {f.name for f in detail_dir.glob("*.bin")}
    if on_disk != detail_files:
        raise SystemExit(f"詳細画像が事例データと合いません: ファイルだけ {len(on_disk - detail_files)} 件 / データだけ {len(detail_files - on_disk)} 件")

    salt = os.urandom(16)
    new_key = derive_key(new_pw, salt)
    out = {}   # 書き出すファイル → 中身(全部そろってから書く)
    for name, recs in sorted(spans.items()):
        buf = (thumb_dir / name).read_bytes()
        pos, parts = 0, []
        for off, ln in sorted(recs):
            if off != pos:
                raise SystemExit(f"{name}: {pos} バイト目からのレコードが事例データにありません")
            parts.append(seal(new_key, open_record(old_key, buf[off:off + ln])))
            pos = off + ln
        if pos != len(buf):
            raise SystemExit(f"{name}: 末尾 {len(buf) - pos} バイトが事例データにありません")
        out[thumb_dir / name] = b"".join(parts)
    for name in sorted(detail_files):
        out[detail_dir / name] = seal(new_key, open_record(old_key, (detail_dir / name).read_bytes()))

    for path, blob in out.items():
        path.write_bytes(blob)
    encrypt_json(data, new_key, salt, SITE_OUT / "data.enc.json")
    if detail is not None:
        encrypt_json(detail, new_key, salt, dp, js=False)
    print(f"暗号化し直しました: 事例 {len(data['cases'])} 件・一覧用パック {len(spans)}・詳細画像 {len(detail_files)} 枚")


if __name__ == "__main__":
    main()
