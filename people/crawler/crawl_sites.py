# -*- coding: utf-8 -*-
"""会社サイトの役員一覧・組織図・ニュースのスナップショットと差分(SPEC §3.3 / §11-5)。

役員一覧: HTML を raw/<cid>/site_executives_<date>.html に保存し、役職と氏名の組を
          raw/<cid>/site_executives_<date>.json に抜き出す。前回スナップショットとの diff を
          raw/<cid>/site_events_<date>.json に書く(追加=appointed / 削除=resigned / 肩書変更=title_changed)。
組織図:   本文に組織が文字で無く画像だけなら画像を保存し needs_manual にする(org_units は自動更新しない)。
ニュース: 静的ページに PDF リンクがあれば「役員」「人事」「組織変更」を含むものを取る(E-IR Parts 等の JS 描画は取れない → needs_manual)。

使い方: python crawl_sites.py [--only <company_id>] [--companies data/companies.json]
"""
import argparse
import re
import sys
from pathlib import Path

from common import DATA, RAW, RobotsDisallowed, RunLog, append_source, display_name, era_to_ad, fetch, jdump, jload, nfkc, normalize_name, sha256_of, source_id, today

TITLE_RE = re.compile(r"(取締役|監査役|執行役員|社長|会長|副社長|相談役|顧問|CEO|CFO|COO|CTO|本部長|部長|室長|工場長|支配人|理事)")
NAME_RE = re.compile(r"^[一-龥々ぁ-んァ-ヶーA-Za-z]{1,6}[\s　]?[一-龥々ぁ-んァ-ヶーA-Za-z]{1,6}(?:[（(][^）)]{1,6}[）)])?$")
KEYWORDS = ("役員", "人事", "代表取締役", "組織変更", "異動", "組織改正")


def text_nodes(html):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    for t in soup(["script", "style", "noscript", "header", "footer", "nav"]):
        t.decompose()
    main = soup.find("main") or soup.body or soup
    out = []
    for s in main.stripped_strings:
        s = re.sub(r"[\s　]+", " ", s).strip()
        if s:
            out.append(s)
    return out, soup


UNIT_TAIL_RE = re.compile(r"(本部長|事業部長|部長|室長|工場長|所長|センター長|統括|担当|CEO|CFO|COO|CTO|CIO|CHRO|CSO|CDO|本部|部門長|グループ長)$")
NOT_NAME_RE = re.compile(r"(登録|入社|入行|入所|退任|退社|弁護士|会計士|税理士|教授|ホーム|サイトマップ|メニュー|戻る|閉じる|開く|詳細|もっと見る|一覧へ|写真|検索|ログイン|プライバシー|アクセス|English|情報|構成|一覧|紹介|体制|メッセージ|理念|概要|沿革|会社|企業|事業|製品|サービス|採用|お問い合わせ|ニュース|トップ|TOP|CONTENTS|MENU|ページ|サイト|株主|投資家|IR|ガバナンス|取締役|監査役|執行役|役員|社長|会長|委員|本部|部長|室長|担当|統括|社外|独立|常勤|非常勤|年|月|日|名$|略歴|経歴|就任|選任|議長)")
SAME_LINE_RE = re.compile(r"^(.{2,40}?(?:取締役|監査役|執行役員?|社長|会長|CEO|COO|CFO|CTO|本部長|部長|室長|工場長|統括|担当)[^\s]*)\s+([一-龥々〆ヶ][一-龥々〆ヶぁ-んァ-ヶー]{0,5}[\s　]?[一-龥々〆ヶぁ-んァ-ヶー]{1,6})(?:[（(]([^）)]{1,8})[）)])?$")


PHOTO_NOTE = re.compile(r"[（(]写真[^）)]{0,4}[）)]")
PAREN_OK = re.compile(r"^[（(](社外|独立|常勤|非常勤|新任|議長|取締役会議長|[ぁ-んァ-ヶー]+[\s　][ぁ-んァ-ヶー]+)[）)]$")   # 読み仮名は「姓 名」の形だけ
NAME_TAIL_BAD = re.compile(r"(所|学|問|者|化|策|題|組み|室|部|課|社|会|団|院|局|庁|省|店|場|館|署|センター|グループ|チーム|ライン|事業|本部|工場|担当|戦略|推進|管理|開発|企画|製造|営業|品質|技術|生産|調達|購買|経理|財務|人事|総務|法務|広報|監査|研究|設計|販売|物流)$")


def is_person_name(s):
    s = PHOTO_NOTE.sub("", s).strip()
    """役員一覧の文字列が氏名らしいか。「林 高史(社外)」「George Olcott」「ジャン-ピエール・…」は可、見出し・役職・略歴の断片は不可。"""
    m = re.search(r"[（(][^）)]{1,12}[）)]$", s)
    if m and not PAREN_OK.match(m.group(0)):
        return False   # 「同社特別顧問(現在に至る)」のような略歴の断片
    core = (s[:m.start()] if m else s).strip()
    if NAME_TAIL_BAD.search(re.sub(r"[\s　]", "", core)) or re.search(r"(場|所|部|室|課|局|署|ター|門|店)長$", core) or re.match(r"^[・\-‐―●○■□◆◇※*＊]", core):
        return False
    if re.search(r"(計画|方針|強化|定義|機能|取り組み|について|の|を|に|へ|と|が)", core) and not re.fullmatch(r"[ァ-ヶー・\s　]+", core):
        return False
    if re.search(r"(事務所|法人|監査|資料|名称|パートナー|代表|代行|開設|カウンセル|長付|室長|部長|短信|説明|管掌|分掌|担当|統括|委嘱|マネージャー|マネジメント)", core):
        return False
    kan = re.sub(r"[\s　]", "", core)
    if re.fullmatch(r"[一-龥々〆ヶぁ-ん]+", kan) and len(kan) > 7:
        return False   # 漢字・ひらがなだけで 8 字以上は氏名ではない
    k = re.sub(r"[\s　・]", "", core)
    if not (2 <= len(k) <= 12) or NOT_NAME_RE.search(core) or re.search(r"[0-9０-９:：/／@]", core):
        return False
    if re.fullmatch(r"[A-Za-z .'-]+", core):
        return bool(re.fullmatch(r"[A-Z][a-z'-]+(?: [A-Z][a-zA-Z'.-]+){1,3}", core))   # 英字は "George Olcott" 形式のみ
    return bool(re.fullmatch(r"[一-龥々〆ヶぁ-んァ-ヶーA-Za-z\s　・=＝-]+", core)) and bool(re.search(r"[一-龥ァ-ヶ]", core))


def is_title(s):
    base = s.split("（")[0].split("(")[0]
    return len(s) <= 50 and bool(TITLE_RE.search(base) or UNIT_TAIL_RE.search(base)) and not is_person_name(s)


CAREER_DATE_RE = re.compile(r"^\d{4}\s*年\s*\d{1,2}\s*月")


def parse_executives(html):
    """役員一覧ページから {title, name, is_outside} を拾う(汎用ヒューリスティック)。
    対応する並び: 「役職」→「氏名」(カード型)、役職が複数ノードに分かれる(「常務執行役員」「生産本部長」「山田 太郎」)、
    「氏名」→「役職」(逆順)、1 行に「代表取締役社長 山田 太郎」、表(th/td)・定義リスト(dt/dd)。"""
    nodes, soup = text_nodes(html)
    entries = []
    pending, pending_name = [], None
    section = {"rank": None}   # 見出しとしての役位(「常務執行役員」の下に担当だけのカードが並ぶ書式)
    RANK_ONLY = re.compile(r"^(代表取締役|取締役|社外取締役|監査役|社外監査役|常勤監査役|執行役|代表執行役|社長執行役員|副社長執行役員|専務執行役員|常務執行役員|上席執行役員|上級執行役員|執行役員|フェロー|理事)$")
    RANK_WORD = re.compile(r"(取締役|監査役|執行役|社長|会長|相談役|顧問|理事|フェロー)")
    def add(title, name):
        t = re.sub(r"\s+", "", title)
        if section["rank"] and not RANK_WORD.search(t):
            t = section["rank"] + t   # 見出しの役位を付ける
        entries.append({"title": t, "name": display_name(name), "name_key": normalize_name(name),
                        "is_outside": "社外" in name or "社外" in title})
    pending_date = None
    for s in nodes:
        # 略歴の行(「1990年4月 当社入社」、または年月と内容が別ノード)は直前の人に付ける
        s2 = era_to_ad(s).strip()
        dm = CAREER_DATE_RE.match(s2)
        if pending_date is not None:
            if entries and not dm:
                entries[-1].setdefault("career_raw", []).append(pending_date + " " + s2)
                pending_date = None
                continue
            pending_date = None
        if dm and entries:
            rest = s2[dm.end():].strip(" 　:：")
            if rest:
                entries[-1].setdefault("career_raw", []).append(dm.group(0) + " " + rest)
            else:
                pending_date = dm.group(0)
            pending, pending_name = [], None
            continue
        m = SAME_LINE_RE.match(s)
        if m and is_person_name(m.group(2)) and not NOT_NAME_RE.search(m.group(2)):
            add(m.group(1), m.group(2) + (f"({m.group(3)})" if m.group(3) else ""))
            pending, pending_name = [], None
            continue
        if is_title(s):
            if RANK_ONLY.match(s.split("（")[0].split("(")[0]):
                section["rank"] = s.split("（")[0].split("(")[0]
            if pending_name:
                add(s, pending_name)
                pending_name = None
                pending = []
                continue
            # 役職の続き(「常務執行役員」→「生産本部長」)は連結、見出し(「取締役及び監査役」)は置き換え
            rank_word = re.search(r"(取締役|監査役|執行役|社長|会長|相談役|顧問|理事)", s.split("（")[0])
            if pending and len(pending) < 3 and not rank_word and not re.search(r"(及び|および|一覧)", "".join(pending)):
                pending.append(s)   # 役位の後ろの担当(「常務執行役員」→「生産本部長」)
            else:
                pending = [s]
            continue
        if is_person_name(s):
            s = PHOTO_NOTE.sub("", s).strip()
            if pending:
                add("".join(pending), s)
                pending = []
            else:
                pending_name = s
            continue
        if len(s) > 40:
            pending, pending_name = [], None
    # ローマ字表記の重複(「新藤 恵悟」と「Keigo Shindo」が同じ長い役職で並ぶ)を落とす
    ja_titles = {e["title"] for e in entries if not re.fullmatch(r"[A-Za-z .'-]+", e["name"])}
    entries = [e for e in entries if not (re.fullmatch(r"[A-Za-z .'-]+", e["name"]) and len(e["title"]) > 8 and e["title"] in ja_titles)]
    # 同じ人が 2 回出たら 1 つにまとめる(役職を兼務として結合)。見出しだけの役職は落とす
    merged, seen = [], {}
    for e in entries:
        if re.search(r"(及び|および|一覧|体制|紹介)", e["title"]):
            continue
        if e["name_key"] in seen:
            if e["title"] not in seen[e["name_key"]]["title"]:
                seen[e["name_key"]]["title"] += "兼" + e["title"]
        else:
            seen[e["name_key"]] = e
            merged.append(e)
    return merged


def diff_snapshots(prev, cur):
    """2 スナップショット間の差分 → events(appointed / resigned / title_changed)。"""
    pm = {e["name_key"]: e for e in (prev or [])}
    cm = {e["name_key"]: e for e in (cur or [])}
    ev = []
    for k, e in cm.items():
        if k not in pm:
            ev.append({"type": "appointed", "name": e["name"], "name_key": k, "before": None, "after": e["title"]})
        elif normalize_name(pm[k]["title"]) != normalize_name(e["title"]):
            ev.append({"type": "title_changed", "name": e["name"], "name_key": k, "before": pm[k]["title"], "after": e["title"]})
    for k, e in pm.items():
        if k not in cm:
            ev.append({"type": "resigned", "name": e["name"], "name_key": k, "before": e["title"], "after": None})
    return ev


def latest_snapshot(cdir, before=None):
    files = sorted(Path(cdir).glob("site_executives_*.json"))
    files = [f for f in files if not before or f.name < f"site_executives_{before}.json"]
    return (jload(files[-1]), files[-1]) if files else (None, None)


PROFILE_MAX = 60   # 1 社あたり紹介ページの取得上限(1 ドメイン 2 秒なので最大 2 分)


def profile_links(html, base, entries):
    """役員一覧ページで、氏名がリンクになっている(=各人の紹介ページ)ものを {name_key: url} で返す。"""
    from bs4 import BeautifulSoup
    import urllib.parse
    soup = BeautifulSoup(html, "lxml")
    host = urllib.parse.urlsplit(base).netloc
    keys = {e["name_key"]: e for e in entries}
    out = {}
    for a in soup.find_all("a", href=True):
        txt = normalize_name(a.get_text(" ", strip=True))
        if not txt:
            continue
        for k in keys:
            if k and k in txt and len(txt) <= len(k) + 40:
                u = urllib.parse.urljoin(base, a["href"]).split("#")[0]
                if urllib.parse.urlsplit(u).netloc == host and u.rstrip("/") != base.rstrip("/") and not u.lower().endswith(".pdf"):
                    out.setdefault(k, u)
                break
    return out


def parse_profile(html):
    """紹介ページの略歴行と生年月を取り出す。"""
    nodes, _ = text_nodes(html)
    lines, pend, born = [], None, None
    for n in nodes:
        t = era_to_ad(n).strip()
        if born is None:
            bm = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(?:\d{1,2}\s*日)?\s*生", t)
            if bm:
                born = f"{int(bm.group(1)):04d}-{int(bm.group(2)):02d}"
        dm = CAREER_DATE_RE.match(t)
        if pend is not None and not dm:
            lines.append(pend + " " + t)
            pend = None
            continue
        if dm:
            rest = t[dm.end():].strip(" 　:：")
            if rest:
                lines.append(dm.group(0) + " " + rest)
            else:
                pend = dm.group(0)
    return lines, born


def crawl_profiles(c, cdir, url, html, entries, log):
    links = profile_links(html, url, entries)
    got = 0
    for k, u in list(links.items())[:PROFILE_MAX]:
        e = next(x for x in entries if x["name_key"] == k)
        if e.get("career_raw"):
            continue
        try:
            ph, ct = fetch(u, timeout=30)
        except Exception:
            continue
        if "html" not in (ct or "html"):
            continue
        lines, born = parse_profile(ph)
        if len(lines) >= 2:
            e["career_raw"] = lines
            e["profile_url"] = u
            if born:
                e["born"] = born
            sid = source_id("hp", c["id"], u)
            append_source(cdir, {"id": sid, "company_id": c["id"], "kind": "website", "title": f"役員紹介(会社サイト)", "date": today(), "url": u,
                                 "retrieved_at": today(), "raw_path": None, "hash": sha256_of(ph)})
            e["profile_source_id"] = sid
            got += 1
    return got


def crawl_executives(c, cdir, log):
    url = (c.get("ir_urls") or {}).get("executives")
    if not url:
        return
    d = today()
    html, _ = fetch(url)
    (cdir / f"site_executives_{d}.html").write_text(html, encoding="utf-8")
    entries = parse_executives(html)
    n_prof = crawl_profiles(c, cdir, url, html, entries, log) if entries else 0
    sid = source_id("hp", c["id"], url + d)
    src = append_source(cdir, {"id": sid, "company_id": c["id"], "kind": "website", "title": "役員一覧(会社サイト)", "date": d, "url": url,
                              "retrieved_at": d, "raw_path": str((cdir / f"site_executives_{d}.html").relative_to(RAW.parent)), "hash": sha256_of(html)})
    prev, prev_path = latest_snapshot(cdir, before=d)
    snap = {"date": d, "url": url, "source_id": sid, "entries": entries, "parse_ok": len(entries) > 0}
    jdump(snap, cdir / f"site_executives_{d}.json")
    if not entries:
        log.fail(c["id"], f"役員一覧を読めない(構造が想定外): {url}", needs_manual=True)
        return
    if prev:
        ev = diff_snapshots(prev["entries"], entries)
        jdump({"date": d, "prev": prev["date"], "prev_source_id": prev.get("source_id"), "source_id": sid, "events": ev}, cdir / f"site_events_{d}.json")
        log.ok(c["id"], f"役員一覧 {len(entries)} 名・差分 {len(ev)} 件")
    else:
        log.ok(c["id"], f"役員一覧 {len(entries)} 名(初回)・紹介ページの略歴 {n_prof} 名")


def crawl_organization(c, cdir, log):
    url = (c.get("ir_urls") or {}).get("organization")
    if not url:
        return
    d = today()
    html, _ = fetch(url)
    nodes, soup = text_nodes(html)
    textual = [s for s in nodes if re.search(r"(本部|事業部|部|室|工場)$", s) and len(s) <= 20]
    imgs = []
    for img in soup.find_all("img"):
        src = img.get("src") or img.get("data-src") or ""
        alt = img.get("alt") or ""
        if re.search(r"(org|soshiki|chart|組織)", src + alt, re.I) or (re.search(r"組織図", "".join(nodes)) and "uploads" in src and re.search(r"\d{4}/\d{2}", src)):
            imgs.append(src if src.startswith("http") else re.sub(r"/[^/]*$", "/", url) + src.lstrip("./"))
    rec = {"date": d, "url": url, "text_units": textual if len(textual) >= 3 else [], "image_urls": imgs, "needs_manual": len(textual) < 3}
    if imgs:
        try:
            data, ct = fetch(imgs[0], binary=True)
            ext = ".png" if "png" in ct else ".jpg"
            p = cdir / f"org_chart_{d}{ext}"
            p.write_bytes(data)
            rec["image_path"] = str(p.relative_to(RAW.parent))
        except Exception as e:
            log.fail(c["id"], f"組織図画像の取得失敗: {e}")
    sid = source_id("hp", c["id"], url + d)
    append_source(cdir, {"id": sid, "company_id": c["id"], "kind": "website", "title": "会社概要・組織図(会社サイト)", "date": d, "url": url,
                         "retrieved_at": d, "raw_path": None, "hash": sha256_of(html)})
    rec["source_id"] = sid
    jdump(rec, cdir / f"org_chart_{d}.json")
    log.ok(c["id"], "組織図: " + ("文字あり" if not rec["needs_manual"] else f"画像のみ({len(imgs)}件) → needs_manual"))


def crawl_news(c, cdir, log):
    url = (c.get("ir_urls") or {}).get("news")
    if not url:
        return
    html, _ = fetch(url)
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    hits = []
    for a in soup.find_all("a", href=True):
        t = a.get_text(" ", strip=True)
        if a["href"].lower().endswith(".pdf") and any(k in t for k in KEYWORDS):
            hits.append({"title": t, "url": a["href"] if a["href"].startswith("http") else re.sub(r"/[^/]*$", "/", url) + a["href"].lstrip("./")})
    if not hits and re.search(r"eir-parts|eir_v5|irpocket|magicalir|xj-storage|pronexus", html, re.I):
        log.fail(c["id"], f"IR ニュースが JS で描画される(E-IR Parts 等)ため静的取得不可: {url}", needs_manual=True)
        return
    jdump({"date": today(), "url": url, "pdf_links": hits}, cdir / f"site_news_{today()}.json")
    log.ok(c["id"], f"IR ニュース: 役員関連 PDF {len(hits)} 件(取得は crawl_tdnet.py --from-sites)")


def crawl_company(c, log):
    cdir = RAW / c["id"]
    cdir.mkdir(parents=True, exist_ok=True)
    for fn in (crawl_executives, crawl_organization, crawl_news):
        try:
            fn(c, cdir, log)
        except RobotsDisallowed as e:
            log.fail(c["id"], f"robots.txt で禁止: {e}")
        except Exception as e:
            log.fail(c["id"], f"{fn.__name__}: {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--companies", default=str(DATA / "companies.json"))
    ap.add_argument("--only")
    ap.add_argument("--workers", type=int, default=12, help="会社ごとの並列数(同じドメインへの間隔 2 秒は common.fetch が守る)")
    ap.add_argument("--reparse", action="store_true", help="取得済みの HTML を読み直して site_executives_*.json を作り直す(取得しない)")
    a = ap.parse_args()
    if a.reparse:
        n = 0
        for h in sorted(RAW.glob("*/site_executives_*.html")):
            j = h.with_suffix(".json")
            snap = jload(j, {}) or {}
            entries = parse_executives(h.read_text(encoding="utf-8", errors="replace"))
            old = {e["name_key"]: e for e in snap.get("entries") or []}
            for e in entries:
                o = old.get(e["name_key"]) or {}
                if not e.get("career_raw") and o.get("profile_url"):
                    for k in ("career_raw", "profile_url", "profile_source_id", "born"):
                        if o.get(k):
                            e[k] = o[k]
            snap.update({"entries": entries, "parse_ok": len(entries) > 0})
            jdump(snap, j)
            n += 1
        print(f"読み直し {n} 件")
        return
    reg = jload(a.companies)
    if not reg:
        sys.exit("data/companies.json が無い。先に registry.py")
    log = RunLog("crawl_sites")
    cos = [c for c in reg["companies"] if (not a.only or a.only in (c["id"], c["short_name"])) and any((c.get("ir_urls") or {}).values())]
    print(f"対象 {len(cos)} 社")
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(a.workers) as ex:
        list(ex.map(lambda c: crawl_company(c, log), cos))
    log.save()


if __name__ == "__main__":
    main()
