#!/usr/bin/env python3
"""Local preview server for site/ that disables browser caching.

`python3 -m http.server` sends no cache headers, so the browser may keep serving an
old copy of a page after you edit it. This server sends `Cache-Control: no-store`.

Usage: python3 scripts/serve.py [port]   (default 8000)
"""
import functools
import http.server
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(NoCacheHandler, directory=str(SITE))
    with http.server.ThreadingHTTPServer(("", port), handler) as httpd:
        print(f"Serving {SITE} at http://localhost:{port}/ (no cache)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
