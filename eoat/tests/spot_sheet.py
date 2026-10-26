# -*- coding: utf-8 -*-
"""抜き取り検査(7-1 spot_check / image_relevance): audit.py が選んだ無作為 50 件(data/spot_check.json)の代表画像を 1 枚の一覧にして、
人が見て「ハンドが写っているか」「分類が合っているか」を記入できるようにする。結果は spot_check.json の ok / note に書く。
使い方: python eoat/tests/spot_sheet.py [出力 jpg]"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DATA / "spot_sheet.jpg"
    sample = json.loads((DATA / "spot_check.json").read_text(encoding="utf-8"))
    W, H, cols = 240, 180, 5
    rows = (len(sample) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * W, rows * (H + 46)), "white")
    d = ImageDraw.Draw(sheet)
    for i, s in enumerate(sample):
        x, y = (i % cols) * W, (i // cols) * (H + 46)
        if s.get("images"):
            p = DATA / "img" / "thumb" / f"{s['images'][0]}.webp"
            if p.exists():
                im = Image.open(p).convert("RGB")
                im.thumbnail((W, H))
                sheet.paste(im, (x + (W - im.width) // 2, y + (H - im.height) // 2))
        d.text((x + 2, y + H + 2), f"{i + 1:02d} {s['title_ja'][:22]}", fill="black")
        d.text((x + 2, y + H + 16), f"{','.join(s['categories'][:2])} / {','.join(s['principles'][:2])} / {s.get('robot') or '-'}", fill=(0, 80, 180))
        d.text((x + 2, y + H + 30), s["url"][8:60], fill=(120, 120, 120))
    sheet.save(out, quality=82)
    print(f"{len(sample)} 件 → {out}")


if __name__ == "__main__":
    main()
