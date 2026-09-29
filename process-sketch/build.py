#!/usr/bin/env python3
"""build.py — src/ を単一HTML dist/process-sketch.html にまとめる(メール添付・オフライン配布用)。
src 内の css/js/画像はインライン化。../../assets/track.js(利用計測)は外部参照のまま残す(無くても動く)。"""
import base64
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
OUT = ROOT / "dist" / "process-sketch.html"

html = (SRC / "index.html").read_text(encoding="utf-8")


def inline_css(m):
    return "<style>\n" + (SRC / m.group(1)).read_text(encoding="utf-8") + "\n</style>"


def inline_js(m):
    src = m.group(1)
    if src.startswith("../"):
        return m.group(0)  # 共通の計測スクリプトは外部のまま
    js = (SRC / src).read_text(encoding="utf-8")
    js = re.sub(r"</script", r"<\/script", js, flags=re.I)
    return "<script>\n" + js + "\n</script>"


html = re.sub(r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>', inline_css, html)
html = re.sub(r'<script\s+src="([^"]+)"([^>]*)></script>', inline_js, html)

MIME = {"png": "image/png", "webp": "image/webp", "svg": "image/svg+xml", "jpg": "image/jpeg"}


def inline_img(m):
    b64 = base64.b64encode((SRC / m.group(2)).read_bytes()).decode("ascii")
    return f"{m.group(1)}data:{MIME[m.group(3)]};base64,{b64}{m.group(4)}"


html = re.sub(r'(<img\b[^>]*\bsrc=")([^"]+\.(png|webp|svg|jpg))(")', inline_img, html)

if re.findall(r'(?:src|href)="(?:https?:)?//', html):
    print("外部リソース参照が残っています", file=sys.stderr)
    sys.exit(1)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding="utf-8", newline="\n")
print(f"built: {OUT.relative_to(ROOT)} ({len(html.encode('utf-8')) / 1024:.1f} KB)")
