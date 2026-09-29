#!/usr/bin/env python3
"""build.py — build.js と同じ処理の Python 版（Node.js が無い環境向け）。
src/ を単一HTML dist/lexxmoma_roi.html にインライン結合する。"""
import base64
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
OUT = ROOT / "dist" / "lexxmoma_roi.html"

html = (SRC / "index.html").read_text(encoding="utf-8")


def inline_css(m: "re.Match[str]") -> str:
    css = (SRC / m.group(1)).read_text(encoding="utf-8")
    return f"<style>\n{css}\n</style>"


def inline_js(m: "re.Match[str]") -> str:
    if m.group(1).startswith("../"):  # サイト共通の assets/theme.js 等は外部参照のまま(無くても動く)
        return m.group(0)
    js = (SRC / m.group(1)).read_text(encoding="utf-8")
    js = re.sub(r"</script", r"<\\/script", js, flags=re.I)
    return f"<script>\n{js}\n</script>"


html = re.sub(r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>', inline_css, html)
html = re.sub(r'<script\s+src="([^"]+)"\s*></script>', inline_js, html)

MIME = {"png": "image/png", "webp": "image/webp", "svg": "image/svg+xml", "jpg": "image/jpeg"}


def inline_img(m: "re.Match[str]") -> str:
    src, ext = m.group(2), m.group(3)
    b64 = base64.b64encode((SRC / src).read_bytes()).decode("ascii")
    return f"{m.group(1)}data:{MIME[ext]};base64,{b64}{m.group(4)}"


html = re.sub(r'(<img\b[^>]*\bsrc=")([^"]+\.(png|webp|svg|jpg))(")', inline_img, html)

leftovers = re.findall(r'(?:src|href)="(?:https?:)?//', html)
if leftovers:
    print("外部リソース参照が残っています:", leftovers, file=sys.stderr)
    sys.exit(1)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding="utf-8", newline="\n")
print(f"built: {OUT.relative_to(ROOT)} ({len(html.encode('utf-8')) / 1024:.1f} KB)")
