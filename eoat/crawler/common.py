# -*- coding: utf-8 -*-
"""エンドエフェクタ事例データベース(eoat/) 共通処理。

- パス定義(eoat/ 配下と公開先 site/members/eoat-db/)
- HTTP 取得: robots.txt を尊重し、1ドメインあたり 2 秒以上あける。User-Agent に社名と連絡先を入れる。
  取得した原本は raw/ に残し(gitignore)、同じ URL は再取得しない(冪等)
- JSON の読み書き、安定 ID、実行ログ(logs/YYYY-MM-DD.json)
people/crawler/common.py と同じ作法。
"""
import hashlib
import json
import os
import re
import threading
import time
import unicodedata
import urllib.parse
import urllib.robotparser
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent          # eoat/crawler
EOAT = HERE.parent                              # eoat/
REPO = EOAT.parent                              # リポジトリ直下
RAW = EOAT / "raw"                              # 取得原本(HTML・元画像)(.gitignore)
DATA = EOAT / "data"                            # 平文の中間データ(.gitignore)
MANUAL = EOAT / "manual"                        # 削除依頼・画像方針・レビュー(Git 管理)
LOGS = EOAT / "logs"                            # 実行ログ(.gitignore)
TAXONOMY = EOAT / "taxonomy"
TESTS = EOAT / "tests"
FIXTURES = TESTS / "fixtures"
SITE_OUT = REPO / "site" / "members" / "eoat-db"   # 公開 UI と暗号化データ
SIER_DATA = REPO / "site" / "robot-sier-map" / "data" / "siers.js"

CONTACT = os.environ.get("EOAT_CONTACT", "https://lexxpluss.com/")   # 連絡先は環境変数で渡す(公開リポジトリに個人のアドレスを書かない)
USER_AGENT = f"Mozilla/5.0 (compatible; LexxPluss-eoat-db/0.1; +https://lexxpluss.com; contact: {CONTACT})"
MIN_INTERVAL = 2.0   # 秒/ドメイン

_last_hit = {}
_robots = {}
_hit_lock = threading.Lock()


# ---------------------------------------------------------------- HTTP
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


def crawl_delay(url):
    """robots.txt の Crawl-delay(ループ 10: knapp.com が 10 秒)。無ければ MIN_INTERVAL。_robots_ok の後に呼ぶ。"""
    parts = urllib.parse.urlsplit(url)
    rp = _robots.get(f"{parts.scheme}://{parts.netloc}")
    try:
        d = rp.crawl_delay(USER_AGENT) if rp else None
    except Exception:
        d = None
    return max(MIN_INTERVAL, float(d or 0))


def _reserve_shared(host, slot, interval=MIN_INTERVAL):
    """別のプロセス(discover と crawl、取得元を調べるエージェント)が同じドメインに同時に行っても 2 秒あくよう、
    ドメインごとの予約時刻を logs/.ratelimit/<host> に置いてファイルロックで回す(ループ 10)。使えない環境ではプロセス内の予約だけ。"""
    try:
        import fcntl
        d = LOGS / ".ratelimit"
        d.mkdir(parents=True, exist_ok=True)
        with open(d / re.sub(r"[^A-Za-z0-9.-]", "_", host), "a+") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            f.seek(0)
            try:
                prev = float(f.read().strip() or 0)
            except ValueError:
                prev = 0.0
            slot = max(slot, prev + interval)
            f.seek(0)
            f.truncate()
            f.write(f"{slot:.3f}")
        return slot
    except Exception:
        return slot


def polite_wait(url):
    """同一ドメインへの前回アクセスから MIN_INTERVAL 秒(robots.txt に Crawl-delay があればその秒数)以上あける。並列実行でも守れるよう、ロックの中で次の枠を予約してから待つ。"""
    host = urllib.parse.urlsplit(url).netloc.replace("www.", "")
    with _hit_lock:
        interval = crawl_delay(url)
        slot = max(time.time(), _last_hit.get(host, 0) + interval)
        slot = _reserve_shared(host, slot, interval)
        _last_hit[host] = slot
    w = slot - time.time()
    if w > 0:
        time.sleep(w)


def fetch(url, timeout=40, binary=False, respect_robots=True, headers=None):
    """GET。robots.txt で禁止なら RobotsDisallowed。戻り値は (bytes|str, content_type, final_url, headers)。"""
    import requests
    if respect_robots and not _robots_ok(url):
        raise RobotsDisallowed(url)
    polite_wait(url)
    h = {"User-Agent": USER_AGENT, "Accept-Language": "ja,en;q=0.8"}
    if headers:
        h.update(headers)
    r = requests.get(url, headers=h, timeout=timeout, allow_redirects=True)
    r.raise_for_status()
    ct = r.headers.get("content-type", "")
    if binary:
        return r.content, ct, r.url, r.headers
    if not r.encoding or r.encoding.lower() in ("iso-8859-1", "ascii"):
        r.encoding = r.apparent_encoding
    return r.text, ct, r.url, r.headers


def url_id(url):
    """URL から安定した短い ID(sha1 の先頭 12 桁)。"""
    return hashlib.sha1(canon_url(url).encode("utf-8")).hexdigest()[:12]


def canon_url(url):
    """比較用の URL: スキーム小文字・www. と末尾 / を落とす・フラグメントと追跡パラメータを除く。"""
    p = urllib.parse.urlsplit(url.strip())
    host = p.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    q = [(k, v) for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True)
         if not k.lower().startswith(("utm_", "fbclid", "gclid", "ref", "mc_"))]
    path = re.sub(r"/+$", "", p.path) or "/"
    return urllib.parse.urlunsplit((p.scheme.lower() or "https", host, path, urllib.parse.urlencode(q), ""))


def domain_of(url):
    host = urllib.parse.urlsplit(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def noindex_flags(html_head_text, headers=None):
    """<meta name=robots> と X-Robots-Tag から noindex / noimageindex / noai を読む。"""
    flags = set()
    for m in re.finditer(r'<meta[^>]+name=["\']?(?:robots|googlebot)["\']?[^>]*content=["\']([^"\']*)', html_head_text or "", re.I):
        flags |= {t.strip().lower() for t in m.group(1).split(",")}
    for m in re.finditer(r'<meta[^>]+content=["\']([^"\']*)["\'][^>]*name=["\']?(?:robots|googlebot)', html_head_text or "", re.I):
        flags |= {t.strip().lower() for t in m.group(1).split(",")}
    if headers:
        xr = headers.get("x-robots-tag") or headers.get("X-Robots-Tag") or ""
        flags |= {t.strip().lower() for t in xr.split(",") if t.strip()}
    return flags


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


def yload(path):
    import yaml
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def sha256_hex(data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def today():
    return os.environ.get("EOAT_TODAY") or date.today().isoformat()


def nfkc(s):
    return unicodedata.normalize("NFKC", str(s or ""))


def clean_text(s):
    s = nfkc(s).replace(" ", " ")
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r"\n\s*\n+", "\n", s)
    return s.strip()


# ---------------------------------------------------------------- 実行ログ
class RunLog:
    """logs/YYYY-MM-DD.json に追記する実行ログ。失敗は監査(audit.py)にも出す。"""

    def __init__(self, step):
        self.step = step
        self.started = datetime.now().isoformat(timespec="seconds")
        self.items = []
        self.failures = []
        self._lock = threading.Lock()

    def ok(self, key, msg, **extra):
        with self._lock:
            self.items.append(dict(key=key, msg=msg, **extra))

    def fail(self, key, msg, **extra):
        with self._lock:
            self.failures.append(dict(key=key, msg=str(msg)[:500], **extra))
        print(f"  ! {key}: {str(msg)[:160]}")

    def save(self):
        LOGS.mkdir(parents=True, exist_ok=True)
        p = LOGS / f"{today()}.json"
        log = jload(p, {"date": today(), "runs": []})
        log["runs"].append({"step": self.step, "started": self.started, "finished": datetime.now().isoformat(timespec="seconds"),
                            "ok": len(self.items), "failures": self.failures, "items": self.items[:2000]})
        jdump(log, p)
        print(f"{self.step}: ok {len(self.items)} / fail {len(self.failures)} → {p.relative_to(EOAT)}")
        return log


# ---------------------------------------------------------------- 取得元
def load_sources():
    """sources.yaml の取得元 + sier_discover.py が見つけた SIer の事例ページ(data/sier_sources.json, key は "sier:<id>")。"""
    src = yload(HERE / "sources.yaml")
    out = {}
    for s in src["sources"]:
        out[s["key"]] = s
    for k, s in (jload(DATA / "sier_sources.json", {}) or {}).items():
        out[k] = dict(s, status="ok")
    for k, s in (jload(DATA / "search_sources.json", {}) or {}).items():   # Web 検索による発掘(discover.py --from-search)
        out[k] = dict(s, status="ok")
    return out


def load_image_policy():
    return jload(MANUAL / "image_policy.json", {"domains": {}})


def image_policy_for(url, policy=None):
    """ドメインごとの画像利用方針: "stored"(既定) / "link_only"。"""
    policy = policy or load_image_policy()
    d = domain_of(url)
    for dom, v in policy.get("domains", {}).items():
        if d == dom or d.endswith("." + dom):
            return v.get("policy", "stored")
    return "stored"
