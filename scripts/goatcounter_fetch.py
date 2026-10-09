#!/usr/bin/env python3
"""GoatCounter (lexxmoma.goatcounter.com) のページ別訪問数を取得して JSON/CSV に出力する。

ダッシュボードの「secret token」閲覧権限（Settings → Dashboard viewable by →
"Logged in users or with secret token"）で発行されるトークンを使う。API トークン不要。

使い方:
    GC_ACCESS_TOKEN=xxxx python scripts/goatcounter_fetch.py --start 2026-10-01 --end 2026-10-07 --json out.json --csv out.csv

出力 (JSON):
    {"start": "...", "end": "...", "total_visits": N,
     "pages": [{"path": "/hub", "title": "...", "count": 88, "daily": {"2026-10-01": 13, ...}}, ...]}

数値は GoatCounter の「visits」（セッション単位のユニーク訪問）であり pageview ではない。
"""
import argparse
import csv
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request

SITE = os.environ.get("GC_SITE_URL", "https://lexxmoma.goatcounter.com")


def _get(path, params, token):
    url = f"{SITE}{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"Cookie": f"access-token={token}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read().decode("utf-8")
    if "Need to log in" in body:
        sys.exit("GoatCounter: token rejected (Need to log in)")
    return body


ROW_RE = re.compile(r'<tr id="(?P<path>[^"]*)" data-id="(?P<id>\d+)" data-count="(?P<count>\d+)".*?</tr>', re.S)
TITLE_RE = re.compile(r'<small class="page-title[^"]*">\s*\|?\s*(.*?)</small>', re.S)
STATS_RE = re.compile(r'data-stats="([^"]*)"')


def parse_rows(h):
    rows = []
    for m in ROW_RE.finditer(h):
        chunk = m.group(0)
        t = TITLE_RE.search(chunk)
        title = html.unescape(re.sub(r"\s+", " ", t.group(1))).strip() if t else ""
        daily = {}
        s = STATS_RE.search(chunk)
        if s:
            for d in json.loads(html.unescape(s.group(1))):
                daily[d["day"]] = d.get("daily", 0)
        rows.append({
            "id": m.group("id"),
            "path": html.unescape(m.group("path")),
            "title": title,
            "count": int(m.group("count")),
            "daily": daily,
        })
    return rows


def fetch_pages(start, end, token):
    pages, exclude = [], []
    while True:
        params = {
            "widget": 0, "period-start": start, "period-end": end,
            "daily": "false", "max": 100, "total": 0, "group": "day",
            "exclude": ",".join(exclude),
        }
        data = json.loads(_get("/load-widget", params, token))
        rows = parse_rows(data["html"])
        if not rows:
            break
        pages.extend(rows)
        exclude.extend(r["id"] for r in rows)
        if not data.get("more"):
            break
    return pages


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True, help="YYYY-MM-DD (inclusive)")
    ap.add_argument("--end", required=True, help="YYYY-MM-DD (inclusive)")
    ap.add_argument("--token", default=os.environ.get("GC_ACCESS_TOKEN"))
    ap.add_argument("--json", help="write JSON here")
    ap.add_argument("--csv", help="write CSV here")
    a = ap.parse_args()
    if not a.token:
        sys.exit("set GC_ACCESS_TOKEN or pass --token")

    pages = fetch_pages(a.start, a.end, a.token)
    out = {"start": a.start, "end": a.end,
           "total_visits": sum(p["count"] for p in pages),  # 全パス（イベント含む）の合計
           "pages": pages}

    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
    if a.csv:
        with open(a.csv, "w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["path", "title", "visits"])
            for p in pages:
                w.writerow([p["path"], p["title"], p["count"]])
    if not a.json and not a.csv:
        for p in pages:
            print(f"{p['count']:6d}  {p['path']}  {p['title']}")
        print(f"total visits: {out['total_visits']}")


if __name__ == "__main__":
    main()
