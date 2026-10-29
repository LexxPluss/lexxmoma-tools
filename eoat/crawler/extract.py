# -*- coding: utf-8 -*-
"""取得した HTML(raw/pages/)から、本文・見出し・画像候補・動画・日付を取り出す → data/extracted/<id>.json。

- 本文は <article> / <main> / 最も文章の多いブロック。nav・header・footer・aside・「関連記事」の節は除く
- 画像は本文の <img>(lazy 属性・srcset も見る)と og:image。ロゴ・アイコン・極小のものは除く
- noindex / noai の印が付いたページは出力しない(取り込まない)
使い方: python extract.py [--ids id ...] [--force]
"""
import argparse
import json
import re
import urllib.parse

from bs4 import BeautifulSoup, Comment

from common import DATA, RAW, RunLog, clean_text, jdump, jload, load_sources

PAGES = RAW / "pages"
OUT = DATA / "extracted"
DROP_TAGS = ["script", "style", "noscript", "nav", "header", "footer", "aside", "form", "iframe", "svg", "button", "select", "template"]
RELATED = re.compile(r"related|more (case|stories|articles)|other (case|stories)|you may also|recommended|関連|おすすめ|他の事例|その他の事例|similar|share this|newsletter|contact us|お問い合わせ|sidebar|breadcrumb|cookie|社会|popular|추천|관련|다른 사례|相关案例|推荐", re.I)
BAD_IMG = re.compile(r"logo|icon|sprite|avatar|badge|flag|arrow|button|pixel|tracking|spacer|blank|placeholder|loading|share|social|facebook|twitter|linkedin|youtube_|banner|cta|map\b|qr", re.I)
LAZY_ATTRS = ["data-src", "data-lazy-src", "data-original", "data-srcset", "data-lazy", "data-image", "data-bg"]


def _ptext(el):
    return sum(len(p.get_text(" ", strip=True)) for p in el.find_all(["p", "li", "h2", "h3"]))


def pick_main(soup):
    """本文のブロック: article / main などの候補のうち段落の文章が最も多いもの。body の 6 割に満たなければ(候補が写真の説明などの小さな枠だったら)body を使う。"""
    body = soup.body or soup
    total = _ptext(body) or 1
    best, best_len = None, 0
    for sel in ["article", "main", "[role=main]", "#main", "#content", ".content", ".article", ".case-study", ".post", ".entry-content", ".case-detail"]:
        for el in soup.select(sel):
            n = _ptext(el)
            if n > best_len:
                best, best_len = el, n
    if best is not None and best_len >= 0.6 * total:
        return best
    return body


def best_src(img, base):
    cands = []
    ss = img.get("srcset") or img.get("data-srcset") or ""
    for part in ss.split(","):
        p = part.strip().split()
        if p:
            w = 0
            if len(p) > 1 and p[1].endswith("w"):
                try:
                    w = int(p[1][:-1])
                except ValueError:
                    w = 0
            cands.append((w, p[0]))
    for a in ["src"] + LAZY_ATTRS:
        v = img.get(a)
        if v and not v.startswith("data:"):
            cands.append((1, v.strip()))
    if not cands:
        return None
    cands.sort(reverse=True)
    u = urllib.parse.urljoin(base, cands[0][1])
    return u if u.startswith("http") else None


def int_attr(v):
    try:
        return int(re.sub(r"[^\d]", "", str(v))) if v else None
    except ValueError:
        return None


def extract_images(main, soup, base):
    out, seen = [], set()
    og = soup.find("meta", property="og:image") or soup.find("meta", attrs={"name": "og:image"})
    if og and og.get("content"):
        u = urllib.parse.urljoin(base, og["content"].strip())
        if not BAD_IMG.search(u):
            out.append({"url": u, "alt": "", "w": None, "h": None, "in_main": False, "og": True, "order": 0})
            seen.add(u)
    order = 1
    for img in main.find_all("img"):
        u = best_src(img, base)
        if not u or u in seen or u.lower().endswith((".svg", ".gif")):
            continue
        alt = clean_text(img.get("alt") or img.get("title") or "")
        w, h = int_attr(img.get("width")), int_attr(img.get("height"))
        if (w and w < 150) or (h and h < 150):
            continue
        if BAD_IMG.search(u) or BAD_IMG.search(alt):
            continue
        # figure / figcaption のキャプション
        cap = ""
        fig = img.find_parent("figure")
        if fig and fig.find("figcaption"):
            cap = clean_text(fig.find("figcaption").get_text(" ", strip=True))
        out.append({"url": u, "alt": alt, "caption": cap, "w": w, "h": h, "in_main": True, "og": False, "order": order})
        seen.add(u)
        order += 1
    # 本文の写真を <img> でなく CSS の background-image や拡大表示のリンク(<a href="….jpg">)で載せるサイト(ループ 10: MESH・Olympus・HD現代ロボティクス)。
    # 中身の確認(大きさ・CLIP・顔)は <img> と同じなので、候補に足すだけ
    for el in main.find_all(style=re.compile(r"background(-image)?\s*:[^;]*url\(", re.I)):
        m = re.search(r"url\(\s*['\"]?([^'\")]+)", el.get("style") or "", re.I)
        u = urllib.parse.urljoin(base, m.group(1).strip()) if m else ""
        if u.startswith("http") and u not in seen and not u.lower().endswith((".svg", ".gif")) and not BAD_IMG.search(u):
            out.append({"url": u, "alt": "", "caption": "", "w": None, "h": None, "in_main": True, "og": False, "order": order, "css_bg": True})
            seen.add(u)
            order += 1
    for a in main.find_all("a", href=re.compile(r"\.(jpe?g|png|webp)(\?|$)", re.I)):
        u = urllib.parse.urljoin(base, a["href"].strip())
        if u not in seen and not BAD_IMG.search(u):
            out.append({"url": u, "alt": clean_text(a.get("title") or ""), "caption": "", "w": None, "h": None, "in_main": True, "og": False, "order": order, "link": True})
            seen.add(u)
            order += 1
    return out


def extract_videos(soup, base):
    vids = set()
    for el in soup.find_all(["iframe", "a", "video", "source"]):
        u = el.get("src") or el.get("href") or ""
        if re.search(r"youtube\.com/(embed|watch)|youtu\.be/|vimeo\.com/", u):
            vids.add(urllib.parse.urljoin(base, u))
    return sorted(vids)[:3]


def extract_date(soup, text):
    for sel, attr in [("meta[property='article:published_time']", "content"), ("meta[name='date']", "content"), ("meta[name='pubdate']", "content"), ("time[datetime]", "datetime")]:
        el = soup.select_one(sel)
        if el and el.get(attr):
            m = re.search(r"(20\d{2})", el.get(attr))
            if m:
                return int(m.group(1))
    m = re.search(r"\b(20[12]\d)年|\b(20[12]\d)[-/.]\d{1,2}\b|\b(20[12]\d)\b", text[:3000])
    if m:
        return int(next(g for g in m.groups() if g))
    return None


def ld_json(soup):
    out = {}
    for s in soup.find_all("script", type="application/ld+json"):
        try:
            d = json.loads(s.string or "")
        except Exception:
            continue
        items = d if isinstance(d, list) else [d]
        for it in items:
            if not isinstance(it, dict):
                continue
            if it.get("@type") in ("Article", "NewsArticle", "BlogPosting", "Product", "VideoObject", "WebPage"):
                out.setdefault("headline", it.get("headline") or it.get("name"))
                out.setdefault("description", it.get("description"))
                img = it.get("image") or it.get("thumbnailUrl")
                if isinstance(img, dict):
                    img = img.get("url")
                if isinstance(img, list) and img:
                    img = img[0] if isinstance(img[0], str) else img[0].get("url")
                if isinstance(img, str):
                    out.setdefault("image", img)
                if it.get("datePublished"):
                    out.setdefault("date", it["datePublished"])
    return out


def extract_one(pid, meta, html, sources):
    soup = BeautifulSoup(html, "lxml")
    base = meta.get("final_url") or meta["url"]
    for c in soup.find_all(string=lambda t: isinstance(t, Comment)):
        c.extract()
    title = clean_text(soup.title.string if soup.title and soup.title.string else "")
    h1 = soup.find("h1")
    h1 = clean_text(h1.get_text(" ", strip=True)) if h1 else ""
    desc = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", property="og:description")
    desc = clean_text(desc["content"]) if desc and desc.get("content") else ""
    ld = ld_json(soup)
    lang = (soup.html.get("lang") or "")[:2].lower() if soup.html else ""
    for t in soup.find_all(DROP_TAGS):
        t.decompose()
    main = pick_main(soup)
    # 「関連記事」などの節を落とす
    for el in list(main.find_all(["section", "div", "ul"])):
        if el.attrs is None or el.decomposed:   # 親ごと消した要素
            continue
        cls = " ".join(el.get("class", [])) + " " + (el.get("id") or "")
        hd = el.find(["h2", "h3", "h4"])
        if RELATED.search(cls) or (hd and RELATED.search(hd.get_text(" ", strip=True)) and len(hd.get_text()) < 40):
            el.decompose()
    headings = [clean_text(h.get_text(" ", strip=True)) for h in main.find_all(["h1", "h2", "h3"])][:30]
    paras = [clean_text(p.get_text(" ", strip=True)) for p in main.find_all(["p", "li", "td", "h1", "h2", "h3", "h4", "blockquote"])]
    paras = [p for p in paras if len(p) > 1]
    text = "\n".join(paras)
    if len(text) < 200:
        text = clean_text(main.get_text("\n", strip=True))
    elif len(text) < 600:
        # 本文を <p> でなく <div> に直接書くサイト(ループ 10: jk.de の Referenzen は見出しだけ 247 字しか取れていなかった)
        full = clean_text(main.get_text("\n", strip=True))
        if len(full) > 3 * len(text):
            text = full
    text = text[:30000]
    images = extract_images(main, soup, base)
    if ld.get("image") and not any(i["url"] == ld["image"] for i in images):
        images.insert(0, {"url": urllib.parse.urljoin(base, ld["image"]), "alt": "", "w": None, "h": None, "in_main": False, "og": True, "order": 0})
    src_keys = meta.get("sources", [])
    src = sources.get(src_keys[0]) if src_keys else None
    return {
        "id": pid, "url": meta["url"], "final_url": base, "retrieved_at": meta.get("retrieved_at"), "sources": src_keys,
        "source_type": src.get("type") if src else None, "case_type": src.get("case_type") if src else None,
        "region": (meta.get("hints") or {}).get("region_ja") or (src.get("region") if src else None), "country": src.get("country") if src else None,
        "lang": lang or (src.get("lang") if src else None), "publisher": src.get("label") if src else None,
        "title": h1 or ld.get("headline") or title, "page_title": title, "description": desc or ld.get("description") or "",
        "headings": headings, "text": text, "images": images, "videos": extract_videos(soup, base),
        "year": extract_date(soup, (ld.get("date") or "") + " " + text), "robots_flags": meta.get("robots_flags", []),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", nargs="*")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    sources = load_sources()
    log = RunLog("extract")
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for mp in sorted(PAGES.glob("*.json")):
        meta = jload(mp)
        pid = meta["id"]
        if a.ids and pid not in a.ids:
            continue
        if meta.get("status") != "ok":
            continue
        flags = set(meta.get("robots_flags", []))
        if flags & {"noindex", "noai", "noimageai", "none"}:
            log.fail(meta["url"], f"robots の印 {sorted(flags)} のため取り込まない")
            continue
        op = OUT / f"{pid}.json"
        if op.exists() and not a.force:
            continue
        try:
            html = (PAGES / f"{pid}.html").read_text(encoding="utf-8")
            rec = extract_one(pid, meta, html, sources)
        except Exception as e:
            log.fail(meta["url"], e)
            continue
        jdump(rec, op)
        log.ok(meta["url"], f"{len(rec['text'])} 文字 / 画像 {len(rec['images'])}")
        n += 1
    print(f"抽出 {n} 件 → {OUT.relative_to(DATA.parent)}")
    log.save()


if __name__ == "__main__":
    main()
