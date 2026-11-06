# -*- coding: utf-8 -*-
"""工場マップ 韓国・台湾拡張 共通処理(people/crawler/common.py と同じ作法)。

- パス定義(factory/ 配下と公開先 site/members/factory-map/)
- HTTP 取得: robots.txt を尊重し、1 ドメインあたり 2 秒以上あける。User-Agent に社名と連絡先を入れる
- 安定 ID(日本の工場マップと同じ: 会社 c-<sha1 8桁>、工場 f-<sha1 10桁>)
- 既存の暗号化データ(日本)の復号と、統合後の暗号化(PBKDF2-SHA256 310,000 回 → AES-256-GCM。工場マップの app.js が読む v1 形式)
"""
import base64
import hashlib
import json
import os
import re
import threading
import time
import unicodedata
import urllib.parse
import urllib.robotparser
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent          # factory/crawler
FACTORY = HERE.parent                           # factory/
REPO = FACTORY.parent
RAW = FACTORY / "raw"                           # 取得原本(.gitignore)
DATA = FACTORY / "data"                         # 平文の中間データ(.gitignore)
MANUAL = FACTORY / "manual"                     # 手動の対応表・修正(Git 管理)
LOGS = FACTORY / "logs"                         # 実行ログ(.gitignore)
SITE_OUT = REPO / "site" / "members" / "factory-map"
ENC_JSON = SITE_OUT / "data.enc.json"

CONTACT = os.environ.get("FACTORY_CONTACT", "https://lexxpluss.com/")
USER_AGENT = f"Mozilla/5.0 (compatible; LexxPluss-factory-db/0.1; +https://lexxpluss.com; contact: {CONTACT})"
MIN_INTERVAL = float(os.environ.get("FACTORY_MIN_INTERVAL", "2.0"))   # 秒/ドメイン

# 日本の工場マップの業種(この 11 区分に韓国・台湾も合わせる)
INDUSTRIES = ["自動車(完成車)", "自動車部品", "半導体・電子部品", "半導体製造装置", "工作機械", "産業機械・ロボット",
              "電機・精密", "化学・素材", "鉄鋼・非鉄", "食品・飲料", "医薬・医療"]

# 国の定義(UI の並び順・通貨・円換算の概算。fx は 1 億<現地通貨> あたりの億円)
COUNTRIES = [
    {"code": "JP", "name": "日本", "flag": "🇯🇵", "unit": "億円", "fx": 1},
    {"code": "KR", "name": "韓国", "flag": "🇰🇷", "unit": "億ウォン", "fx": 0.11, "fxNote": "1 KRW ≈ 0.11 JPY"},
    {"code": "TW", "name": "台湾", "flag": "🇹🇼", "unit": "億台湾ドル", "fx": 4.8, "fxNote": "1 TWD ≈ 4.8 JPY"},
    {"code": "US", "name": "米国", "flag": "🇺🇸", "unit": "億ドル", "fx": 150, "fxNote": "1 USD ≈ 150 JPY"},
    {"code": "CA", "name": "カナダ", "flag": "🇨🇦", "unit": "億カナダドル", "fx": 108, "fxNote": "1 CAD ≈ 108 JPY"},
]

_last_hit = {}
_robots = {}
_hit_lock = threading.Lock()


class RobotsDisallowed(Exception):
    pass


def _robots_ok(url):
    parts = urllib.parse.urlsplit(url)
    base = f"{parts.scheme}://{parts.netloc}"
    rp = _robots.get(base)
    if rp is None:
        rp = urllib.robotparser.RobotFileParser()
        try:
            import requests
            r = requests.get(base + "/robots.txt", headers={"User-Agent": USER_AGENT}, timeout=20)
            rp.parse(r.text.splitlines() if r.status_code == 200 else [])
        except Exception:
            rp.parse([])
        _robots[base] = rp
    try:
        return rp.can_fetch(USER_AGENT, url)
    except Exception:
        return True


def polite_wait(url, interval=None):
    host = urllib.parse.urlsplit(url).netloc.replace("www.", "")
    with _hit_lock:
        slot = max(time.time(), _last_hit.get(host, 0) + (MIN_INTERVAL if interval is None else interval))
        _last_hit[host] = slot
    w = slot - time.time()
    if w > 0:
        time.sleep(w)


def fetch(url, params=None, timeout=60, binary=False, respect_robots=True, headers=None, method="GET", data=None, interval=None):
    """GET/POST。robots.txt で禁止なら RobotsDisallowed。戻り値は (bytes|str, content_type)。"""
    import requests
    if respect_robots and not _robots_ok(url):
        raise RobotsDisallowed(url)
    polite_wait(url, interval)
    h = {"User-Agent": USER_AGENT}
    if headers:
        h.update(headers)
    r = None
    for attempt in range(4):                       # 経路(プロキシ)の一時的な切断は少し待って再試行する
        try:
            r = requests.request(method, url, params=params, data=data, headers=h, timeout=timeout)
            if r.status_code in (429, 502, 503, 504) and attempt < 3:
                time.sleep(3 * (attempt + 1)); continue
            break
        except (requests.ConnectionError, requests.Timeout):
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))
    r.raise_for_status()
    ct = r.headers.get("content-type", "")
    if binary:
        return r.content, ct
    if not r.encoding or r.encoding.lower() in ("iso-8859-1", "ascii"):
        r.encoding = r.apparent_encoding
    return r.text, ct


def cached_fetch(url, cache_path, **kw):
    """raw/ に原本があればそれを返す(冪等)。無ければ取得して保存する。"""
    p = Path(cache_path)
    if p.exists():
        return p.read_bytes() if kw.get("binary") else p.read_text(encoding="utf-8")
    body, _ = fetch(url, **kw)
    p.parent.mkdir(parents=True, exist_ok=True)
    if kw.get("binary"):
        p.write_bytes(body)
    else:
        p.write_text(body, encoding="utf-8")
    return body


# ---------------------------------------------------------------- JSON / ファイル
def jload(path, default=None):
    p = Path(path)
    if not p.exists():
        return default
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def jdump(obj, path, compact=False):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=1)
            f.write("\n")


def today():
    return os.environ.get("FACTORY_TODAY") or date.today().isoformat()


def nfkc(s):
    return unicodedata.normalize("NFKC", str(s or "")).strip()


def squash(s):
    return re.sub(r"[\s　]+", " ", nfkc(s))


def company_id(country, name):
    return "c-" + hashlib.sha1(f"{country}:{nfkc(name)}".encode("utf-8")).hexdigest()[:8]


def factory_id(country, op, name, addr):
    return "f-" + hashlib.sha1(f"{country}:{nfkc(op)}|{nfkc(name)}|{nfkc(addr)}".encode("utf-8")).hexdigest()[:10]


def to_int(s):
    """'12,345 명' '1,234人' '約 3,000' → 12345。読めなければ None。"""
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return int(s)
    m = re.search(r"\d[\d,]*", nfkc(s).replace(" ", ""))
    return int(m.group(0).replace(",", "")) if m else None


# ---------------------------------------------------------------- 暗号化(工場マップと同じ方式)
def _key(pw, salt, it):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=it).derive(pw.encode("utf-8"))


def password(required=True):
    pw = os.environ.get("FACTORY_PW") or os.environ.get("PEOPLE_PW")
    if not pw and required:
        raise SystemExit("共通パスワードを環境変数 FACTORY_PW で渡してください(リポジトリには置かない)")
    return pw


def decrypt_file(path, pw):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    import zlib
    enc = jload(path)
    k = _key(pw, base64.b64decode(enc["salt"]), enc["iter"])
    plain = AESGCM(k).decrypt(base64.b64decode(enc["iv"]), base64.b64decode(enc["ct"]), None)
    if enc.get("z") == "deflate":
        plain = zlib.decompress(plain, -15)
    return json.loads(plain.decode("utf-8"))


def encrypt(data, pw, out_json=ENC_JSON):
    """v1 形式(deflate 無し。工場マップの app.js と members/index.html の両方が読める)。data.enc.js も併せて書く。"""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    salt, iv, it = os.urandom(16), os.urandom(12), 310000
    k = _key(pw, salt, it)
    plain = json.dumps(data, ensure_ascii=False, separators=(", ", ": ")).encode("utf-8")
    ct = AESGCM(k).encrypt(iv, plain, None)
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    enc = json.dumps({"v": 1, "kdf": "PBKDF2-SHA256", "iter": it, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)})
    out_json = Path(out_json)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(enc, encoding="utf-8")
    out_json.with_name("data.enc.js").write_text("window.FACTORY_ENC=" + enc + ";\n", encoding="utf-8")
    return out_json


# ---------------------------------------------------------------- 実行ログ
def log_run(step, counts, failures=None):
    p = LOGS / f"{today()}.json"
    log = jload(p, {"date": today(), "runs": []})
    log["runs"].append({"step": step, "at": time.strftime("%H:%M:%S"), "counts": counts, "failures": failures or []})
    jdump(log, p)
