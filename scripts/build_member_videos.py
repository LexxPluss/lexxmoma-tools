"""共有動画(site/members/videos/)の一覧を暗号化して書き出す。

入力: site/internal/videos/videos.json(平文。internal/ なのでコミットされない)
  {
    "videos": [
      {"url": "https://www.youtube.com/watch?v=XXXXXXXXXXX", "title": "…", "desc": "…(任意)", "cat": "…(任意)", "date": "2026-10(任意)"}
    ]
  }
  url は watch?v= / youtu.be / shorts / embed / live のどれでもよい(動画 ID だけ取り出す)。並び順はこのファイルの順。
出力: site/members/videos/data.enc.json と data.enc.js
暗号化: 工場マップ・顧客人事DBと同じ。パスワード → PBKDF2-SHA256(310,000 回・salt 16B) → AES-256-GCM(iv 12B)。

使い方:  python scripts/build_member_videos.py        (共通パスワードを画面に出さずに入力)
"""
import base64
import json
import os
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "site" / "internal" / "videos" / "videos.json"
OUT = ROOT / "site" / "members" / "videos" / "data.enc.json"

ID_RE = re.compile(r"(?:v=|youtu\.be/|/shorts/|/embed/|/live/)([\w-]{11})")


def video_id(url):
    url = url.strip()
    if re.fullmatch(r"[\w-]{11}", url):
        return url
    m = ID_RE.search(url)
    if not m:
        sys.exit(f"YouTube の動画 ID が読み取れません: {url}")
    return m.group(1)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    src = json.loads(SRC.read_text(encoding="utf-8"))
    videos, seen = [], set()
    for v in src.get("videos", []):
        vid = video_id(v.get("url") or v.get("id") or "")
        if vid in seen:
            print(f"重複をスキップ: {vid}")
            continue
        seen.add(vid)
        out = {"id": vid, "title": (v.get("title") or "").strip()}
        for k in ("desc", "cat", "date"):
            if v.get(k):
                out[k] = str(v[k]).strip()
        videos.append(out)
    data = {"updated": date.today().isoformat(), "videos": videos}

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
    OUT.with_name("data.enc.js").write_text("window.VIDEOS_ENC=" + enc + ";\n", encoding="utf-8")
    print(f"動画 {len(videos)} 本 → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
