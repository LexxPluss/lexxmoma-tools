# -*- coding: utf-8 -*-
"""有報が未取得の上場企業について、各社の IR ページから最新の有価証券報告書 PDF を探して取り込む(EDINET API キー無しの補完)。

探し方(会社ごと): IR ニュース / IR ライブラリ / 定番パス(/ir/library/ 等)のページで、
  リンク文字に「有価証券報告書」を含み(四半期・半期・訂正・英語版・内部統制は除く)、PDF を指すものを集め、
  文字の中の年(2026年3月期・第88期 等)が新しいものを選ぶ。EDINET の PDF(disclosure2dl…/S100XXXX.pdf)も可。
取得: PDF を raw/<cid>/yuho_<id>.pdf に保存 → crawl_edinet.save_officers で「役員の状況」を取り出す(出典は取得元 URL)。
間隔・robots は common.fetch が守る。

使い方: python find_yuho.py [--workers 12] [--only 会社名]
"""
import argparse
import hashlib
import re
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

from common import DATA, RAW, RobotsDisallowed, RunLog, fetch, jdump, jload, nfkc, today
from crawl_edinet import save_officers

IR_PATHS = ["/ir/", "/ir/library/", "/ir/library/securities/", "/ir/library/yuho/", "/ir/library/report/", "/ir/library/security_reports/",
            "/ir/lib/", "/ir/data/", "/ir/document/", "/ir/documents/", "/ir/filing/", "/ir/yuho/", "/ir/securities/", "/ir/library/yuka/",
            "/ja/ir/library/", "/jp/ir/library/", "/corporate/ir/library/", "/company/ir/library/"]
YUHO_TEXT = re.compile(r"有価証券報告書")
YUHO_BAD = re.compile(r"(四半期|半期|半期報告|訂正|英文|英語|English|内部統制|確認書|臨時|発行登録|目論見|株主総会|招集|決算短信|要約)", re.I)
IR_LINK = re.compile(r"(IR|投資家|株主|ライブラリ|library|有価証券報告書|法定開示|disclosure|財務)", re.I)


def anchors(html, base):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    out = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href.startswith(("mailto:", "tel:", "javascript:")):
            continue
        # リンク文字 + 近くの見出し(表の行・リスト)も含めて判定する
        ctx = a.get_text(" ", strip=True)
        par = a.find_parent(["tr", "li", "dd", "div"])
        if par is not None:
            ctx = (par.get_text(" ", strip=True)[:200] + " " + ctx)
        out.append((urllib.parse.urljoin(base, href).split("#")[0], re.sub(r"\s+", " ", ctx)))
    return out


def year_key(text):
    t = nfkc(text)
    ys = [int(y) for y in re.findall(r"(20\d\d)\s*年", t)]
    ki = [int(k) for k in re.findall(r"第\s*(\d{1,3})\s*期", t)]
    return (max(ys) if ys else 0, max(ki) if ki else 0)


def pick_pdf(pages):
    cand = {}
    for base, html in pages:
        for url, ctx in anchors(html, base):
            is_pdf = url.lower().split("?")[0].endswith(".pdf") or "disclosure2dl.edinet-fsa.go.jp" in url
            if is_pdf and YUHO_TEXT.search(ctx) and not YUHO_BAD.search(ctx[-120:]):
                cand.setdefault(url, ctx)
    if not cand:
        return None, None
    best = sorted(cand.items(), key=lambda kv: year_key(kv[1]), reverse=True)[0]
    return best


def find_for(c):
    res = {"company": c["short_name"], "id": c["id"], "pdf": None, "ctx": None, "why": None}
    web = c.get("web")
    base = "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(web)) if web else None
    pages, seen = [], set()
    urls = [u for u in [(c.get("ir_urls") or {}).get("news")] if u]
    if web:
        try:
            top, _ = fetch(web, timeout=30)
            pages.append((web, top))
            seen.add(web)
            urls += [u for u, t in anchors(top, web) if IR_LINK.search(t) and urllib.parse.urlsplit(u).netloc == urllib.parse.urlsplit(web).netloc][:6]
        except Exception as e:
            res["why"] = f"トップ取得失敗: {e}"[:120]
        urls += [base + p for p in IR_PATHS]
    for u in urls:
        if u in seen or len(pages) > 14:
            continue
        seen.add(u)
        try:
            html, ct = fetch(u, timeout=30)
        except Exception:
            continue
        if "html" not in (ct or "html"):
            continue
        pages.append((u, html))
        pdf, ctx = pick_pdf(pages)
        if pdf:
            break
        # IR トップ → ライブラリ・有報ページを 1 段たどる
        for v, t in anchors(html, u):
            if v not in seen and re.search(r"(有価証券報告書|ライブラリ|library|法定開示)", t, re.I) and urllib.parse.urlsplit(v).netloc == urllib.parse.urlsplit(u).netloc:
                urls.append(v)
    pdf, ctx = pick_pdf(pages)
    if not pdf:
        res["why"] = res["why"] or "有報 PDF のリンクが見つからない"
        return res
    res["pdf"], res["ctx"] = pdf, ctx[-120:]
    cdir = RAW / c["id"]
    cdir.mkdir(parents=True, exist_ok=True)
    m = re.search(r"(S100[0-9A-Z]{4})", pdf)
    doc_id = m.group(1) if m else hashlib.sha1(pdf.encode()).hexdigest()[:8]
    path = cdir / f"yuho_{doc_id}.pdf"
    try:
        if not path.exists():
            data, ct = fetch(pdf, binary=True, timeout=90)
            if not data[:5].startswith(b"%PDF"):
                res["why"] = f"PDF ではない({ct})"
                return res
            path.write_bytes(data)
        out = save_officers(c["id"], path, doc_id, pdf, c.get("edinet_code"))
        res["why"] = None if out else "役員の状況が見つからない"
        res["pages"] = len(out["pages"]) if out else 0
    except Exception as e:
        res["why"] = f"取得・抽出失敗: {e}"[:160]
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--only")
    a = ap.parse_args()
    reg = jload(DATA / "companies.json")
    if not reg:
        sys.exit("先に registry.py")
    todo = [c for c in reg["companies"] if c["listing_status"] == "listed" and (not a.only or c["short_name"] == a.only)
            and not list((RAW / c["id"]).glob("yuho_*_officers.json"))]
    print(f"対象 {len(todo)} 社")
    log = RunLog("find_yuho")
    results = []
    with ThreadPoolExecutor(a.workers) as ex:
        futs = {ex.submit(find_for, c): c for c in todo}
        for f in as_completed(futs):
            r = f.result()
            results.append(r)
            print(f"{r['company']}: {r['pdf'] or ''} {r['why'] or 'OK ' + str(r.get('pages'))}", flush=True)
            (log.fail if r["why"] else log.ok)(r["id"], f"{r['company']}: {r['why'] or r['pdf']}")
    jdump(results, DATA / f"find_yuho_{today()}.json")
    log.save()
    print(f"取り込み {sum(1 for r in results if not r['why'])} / {len(results)}")


if __name__ == "__main__":
    main()
