# -*- coding: utf-8 -*-
"""候補 URL(data/candidates.json)の事例ページを取得して原本を残す → raw/pages/<id>.html + <id>.json。

- 取得済み(同じ URL)は再取得しない(--refresh で取り直す)
- robots.txt・<meta name=robots> の noindex / noai を記録する(noindex のページは extract で除く)
- ドメインごとに 2 秒以上あける(common.fetch)。並列はドメインをまたぐ分だけ効く
使い方: python crawl.py [--source key ...] [--limit N] [--workers 8] [--refresh]
"""
import argparse
import concurrent.futures as cf

from common import RAW, DATA, RunLog, fetch, jdump, jload, load_sources, noindex_flags, today, url_id, RobotsDisallowed

PAGES = RAW / "pages"


def fetch_rendered(url):
    """JS で本文や画像を組み立てるサイト(sources.yaml の render: true)は、手元の Chromium(node の playwright, render.js)で描画してから HTML を取る。
    画像・フォント・メディアはダウンロードしない(属性だけ要る)。robots.txt と 2 秒間隔は通常の取得と同じ。"""
    import json
    import subprocess
    import tempfile
    from pathlib import Path
    from common import _robots_ok, polite_wait, RobotsDisallowed, USER_AGENT
    if not _robots_ok(url):
        raise RobotsDisallowed(url)
    polite_wait(url)
    with tempfile.NamedTemporaryFile(suffix=".html", delete=False) as tf:
        out = tf.name
    try:
        r = subprocess.run(["node", str(Path(__file__).with_name("render.js")), url, out, USER_AGENT], capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            raise RuntimeError(f"render.js: {r.stderr.strip()[:200]}")
        info = json.loads(r.stdout.strip().splitlines()[-1])
        if info["status"] >= 400:
            raise RuntimeError(f"HTTP {info['status']}")
        html = Path(out).read_text(encoding="utf-8")
    finally:
        Path(out).unlink(missing_ok=True)
    h = info.get("headers") or {}
    return html, h.get("content-type", "text/html"), info.get("url") or url, h


def crawl_one(c, log, refresh=False, render_keys=()):
    url = c["url"]
    pid = url_id(url)
    meta_p = PAGES / f"{pid}.json"
    if meta_p.exists() and not refresh:
        return pid, "skip"
    try:
        if set(c.get("sources", [])) & set(render_keys):
            html, ct, final, headers = fetch_rendered(url)
        else:
            html, ct, final, headers = fetch(url)
    except RobotsDisallowed:
        jdump({"id": pid, "url": url, "status": "robots", "retrieved_at": today(), "sources": c.get("sources", [])}, meta_p)
        log.fail(url, "robots.txt で禁止")
        return pid, "robots"
    except Exception as e:
        log.fail(url, e)
        return pid, "error"
    head = html[:20000]
    flags = noindex_flags(head, headers)
    (PAGES / f"{pid}.html").write_text(html, encoding="utf-8", newline="\n")
    jdump({"id": pid, "url": url, "final_url": final, "status": "ok", "content_type": ct, "retrieved_at": today(),
           "sources": c.get("sources", []), "robots_flags": sorted(flags), "bytes": len(html),
           "rendered": bool(set(c.get("sources", [])) & set(render_keys)), "hints": c.get("hints")}, meta_p)
    log.ok(url, f"{len(html)} bytes", id=pid)
    return pid, "ok"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", nargs="*")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--refresh", action="store_true")
    a = ap.parse_args()
    cands = jload(DATA / "candidates.json", {})
    sources = load_sources()
    render_keys = [k for k, s in sources.items() if s.get("render")]
    items = [c for c in cands.values() if not a.source or set(c.get("sources", [])) & set(a.source)]
    # 同じドメインが続くと 2 秒待ちが直列になるので、ドメインを交互に並べる
    import itertools
    from common import domain_of
    groups = {}
    for c in items:
        groups.setdefault(domain_of(c["url"]), []).append(c)
    items = [c for c in itertools.chain.from_iterable(itertools.zip_longest(*groups.values())) if c]
    if a.limit:
        items = items[: a.limit]
    PAGES.mkdir(parents=True, exist_ok=True)
    log = RunLog("crawl")
    counts = {}
    with cf.ThreadPoolExecutor(a.workers) as ex:
        for pid, st in ex.map(lambda c: crawl_one(c, log, a.refresh, render_keys), items):
            counts[st] = counts.get(st, 0) + 1
    print(counts)
    log.save()


if __name__ == "__main__":
    main()
