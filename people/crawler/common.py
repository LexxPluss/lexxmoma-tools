# -*- coding: utf-8 -*-
"""顧客人事データベース 共通処理。

- パス定義(people/ 配下と公開先 site/members/people-db/)
- HTTP 取得: robots.txt を尊重し、1ドメインあたり 2 秒以上あける。User-Agent に社名と連絡先を入れる(SPEC §3.3 / §11-13)
- 日付・氏名の正規化、安定 ID、実行ログ(logs/YYYY-MM-DD.json)
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

HERE = Path(__file__).resolve().parent          # people/crawler
PEOPLE = HERE.parent                            # people/
REPO = PEOPLE.parent                            # リポジトリ直下
RAW = PEOPLE / "raw"                            # 取得原本(.gitignore)
DATA = PEOPLE / "data"                          # 平文の中間データ(.gitignore)
MANUAL = PEOPLE / "manual"                      # 手動投入・レビュー(Git 管理)
LOGS = PEOPLE / "logs"                          # 実行ログ(.gitignore)
RULES = HERE / "rules"
FIXTURES = PEOPLE / "tests" / "fixtures"
SITE_OUT = REPO / "site" / "members" / "people-db"   # 公開 UI と暗号化データ
FACTORY_PLAIN = REPO / "site" / "internal" / "factory-db" / "data" / "factories.json"
FACTORY_ENC = REPO / "site" / "members" / "factory-map" / "data.enc.json"

CONTACT = os.environ.get("PEOPLE_CONTACT", "https://lexxpluss.com/")   # 連絡先は環境変数 PEOPLE_CONTACT で渡す(公開リポジトリに個人のアドレスを書かない)
USER_AGENT = f"Mozilla/5.0 (compatible; LexxPluss-people-db/0.1; +https://lexxpluss.com; contact: {CONTACT})"
MIN_INTERVAL = 2.0   # 秒/ドメイン(SPEC §3.3)

_last_hit = {}
_robots = {}


# ---------------------------------------------------------------- HTTP
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


_hit_lock = threading.Lock()


def polite_wait(url):
    """同一ドメインへの前回アクセスから MIN_INTERVAL 秒以上あける。並列実行でも守れるよう、ロックの中で次の枠を予約してから待つ。"""
    host = urllib.parse.urlsplit(url).netloc.replace("www.", "")
    with _hit_lock:
        slot = max(time.time(), _last_hit.get(host, 0) + MIN_INTERVAL)
        _last_hit[host] = slot
    w = slot - time.time()
    if w > 0:
        time.sleep(w)


def fetch(url, params=None, timeout=60, binary=False, respect_robots=True):
    """GET。robots.txt で禁止なら RobotsDisallowed。戻り値は (bytes|str, content_type)。"""
    import requests
    if respect_robots and not _robots_ok(url):
        raise RobotsDisallowed(url)
    polite_wait(url)
    r = requests.get(url, params=params, headers={"User-Agent": USER_AGENT}, timeout=timeout)
    r.raise_for_status()
    ct = r.headers.get("content-type", "")
    if binary:
        return r.content, ct
    if not r.encoding or r.encoding.lower() in ("iso-8859-1", "ascii"):
        r.encoding = r.apparent_encoding
    return r.text, ct


class RobotsDisallowed(Exception):
    pass


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


def sha256_of(data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return "sha256:" + hashlib.sha256(data).hexdigest()


def today():
    return os.environ.get("PEOPLE_TODAY") or date.today().isoformat()


# ---------------------------------------------------------------- 文字・日付
def nfkc(s):
    return unicodedata.normalize("NFKC", str(s or ""))


_ZEN_SPACE = re.compile(r"[\s　]+")

# 旧字体・異体字 → 常用(氏名の名寄せ用。表示は原表記を残す)
OLD_CHARS = str.maketrans({
    "髙": "高", "﨑": "崎", "嵜": "崎", "齋": "斎", "齊": "斉", "澤": "沢", "邊": "辺", "邉": "辺", "廣": "広",
    "濵": "浜", "濱": "浜", "櫻": "桜", "國": "国", "眞": "真", "惠": "恵", "德": "徳", "𠮷": "吉", "靑": "青",
    "淸": "清", "曾": "曽", "壽": "寿", "與": "与", "萬": "万", "冨": "富", "槇": "槙", "彌": "弥", "隆": "隆",
})


def normalize_name(name):
    """氏名の正規化キー: NFKC → 読み仮名・注記((注)1, (社外) 等)を除く → 空白除去 → 旧字体を常用に。"""
    s = nfkc(split_reading(name)[0])
    s = re.sub(r"[（(]\s*注\s*[）)]\s*\d*", "", s)
    s = re.sub(r"(?:[\s/]*注\s*\d+\s*[、,，]?)+\s*$", "", s)   # 括弧なしの「注４」「注４、注５」
    s = re.sub(r"[（(]\s*(注|社外|常勤|非常勤|新任|再任|重任)[^）)]*[）)]", "", s)
    s = _ZEN_SPACE.sub("", s)
    s = s.translate(OLD_CHARS)
    return s


_KANA_READING = re.compile(r"[（(]\s*[ぁ-んァ-ヶー]+[\s　]+[ぁ-んァ-ヶー]+\s*[）)]\s*$")


def split_reading(name):
    """「小林 瑛二(コバヤシ エイジ)」→ ("小林 瑛二", "コバヤシ エイジ")。読みが無ければ (name, None)。"""
    s = nfkc(name)
    m = _KANA_READING.search(s)
    if not m:
        return name, None
    return s[:m.start()].strip(), re.sub(r"[（()）]", "", m.group(0)).strip()


def display_name(name):
    """表示用: 読み仮名・注記を除き、姓と名の間の空白を 1 つに。「時 田 孝 志」のような字間空白は詰める。"""
    s = nfkc(split_reading(name)[0])
    s = re.sub(r"[（(]\s*注\s*[）)]\s*\d*", "", s)
    s = re.sub(r"(?:[\s/]*注\s*\d+\s*[、,，]?)+\s*$", "", s)   # 括弧なしの「注４」「注４、注５」
    s = re.sub(r"[（(]\s*(注|社外|常勤|非常勤|新任|再任|重任)[^）)]*[）)]", "", s).strip()
    parts = [p for p in _ZEN_SPACE.split(s) if p]
    if len(parts) >= 3 and all(len(p) == 1 for p in parts):
        # 「時 田 孝 志」: 字間空白 → 空白なし(姓名の切れ目は分からない)
        return "".join(parts)
    return " ".join(parts)


_YM = re.compile(r"(\d{4})\s*年\s*(\d{1,2})\s*月")
_YMD = re.compile(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日")


ERA_BASE = {"明治": 1867, "大正": 1911, "昭和": 1925, "平成": 1988, "令和": 2018}
_ERA = re.compile(r"(明治|大正|昭和|平成|令和)\s*(元|\d{1,2})\s*年")


def era_to_ad(s):
    """和暦を西暦に置き換える(「昭和61年４月」→「1986年4月」「令和元年」→「2019年」)。"""
    return _ERA.sub(lambda m: f"{ERA_BASE[m.group(1)] + (1 if m.group(2) == '元' else int(m.group(2)))}年", nfkc(s))


def parse_ym(s):
    """「2024年６月」「2024年 6月」「平成30年11月」→ "2024-06"。見つからなければ None。"""
    m = _YM.search(era_to_ad(s))
    return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}" if m else None


def parse_ymd(s):
    m = _YMD.search(era_to_ad(s))
    return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else None


def ym(s):
    """日付文字列(YYYY-MM-DD / YYYY-MM)を YYYY-MM に切り詰める。"""
    return s[:7] if s else s


def months_between(a, b):
    """YYYY-MM 同士の差(月)。a が古い方。"""
    ya, ma = int(a[:4]), int(a[5:7])
    yb, mb = int(b[:4]), int(b[5:7])
    return (yb - ya) * 12 + (mb - ma)


def age_at(born_ym, at_date):
    if not born_ym:
        return None
    return months_between(born_ym, ym(at_date)) // 12


# ---------------------------------------------------------------- ID
def stable_id(company_id, prefix, *keys):
    """会社ID + 種別 + 内容ハッシュの安定 ID(例: E02216-P3f2a1c)。ビルドし直しても同じ値になる。"""
    h = hashlib.sha1("|".join(str(k) for k in keys).encode("utf-8")).hexdigest()[:6]
    return f"{company_id}-{prefix}{h}"


# ---------------------------------------------------------------- 実行ログ
class RunLog:
    """logs/YYYY-MM-DD.json に追記する実行ログ。失敗企業・パース失敗を UI の「データ品質」に出す。"""

    def __init__(self, step):
        self.step = step
        self.started = datetime.now().isoformat(timespec="seconds")
        self.items = []
        self.failures = []

    def ok(self, company_id, msg, **extra):
        self.items.append(dict(company_id=company_id, msg=msg, **extra))

    def fail(self, company_id, msg, **extra):
        self.failures.append(dict(company_id=company_id, msg=str(msg)[:500], **extra))
        print(f"  ! {company_id}: {msg}")

    def save(self):
        LOGS.mkdir(parents=True, exist_ok=True)
        p = LOGS / f"{today()}.json"
        log = jload(p, {"date": today(), "runs": []})
        log["runs"].append({"step": self.step, "started": self.started, "finished": datetime.now().isoformat(timespec="seconds"),
                            "ok": len(self.items), "failures": self.failures, "items": self.items})
        jdump(log, p)
        print(f"{self.step}: ok {len(self.items)} / fail {len(self.failures)} → {p.relative_to(PEOPLE)}")
        return log


def append_source(company_dir, src):
    """raw/<cid>/sources.json に出典レコードを追加(同じ URL + 取得日は 1 件にまとめる)。"""
    p = Path(company_dir) / "sources.json"
    srcs = jload(p, [])
    for s in srcs:
        if s.get("url") == src.get("url") and s.get("retrieved_at") == src.get("retrieved_at"):
            s.update(src)
            jdump(srcs, p)
            return s
    srcs.append(src)
    jdump(srcs, p)
    return src


def source_id(kind, company_id, key):
    return f"S-{kind}-{company_id}-{hashlib.sha1(str(key).encode('utf-8')).hexdigest()[:6]}"
