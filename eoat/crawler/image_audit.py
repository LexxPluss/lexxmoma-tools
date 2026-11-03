# -*- coding: utf-8 -*-
"""公開中の画像を目で点検する(ループ 14 の品質ループ)。CLIP の判定を通っても、人物だけ・ロゴ・図表・イメージ写真が 1〜2 割残っていた。

- sheets: data/cases.json の全画像を 20 枚ずつ番号付きのシートにする → data/image_audit/sheets/i_NNN.jpg と並び i_NNN.json
- 点検: サブエージェントが image_audit_instructions.md の手順で見て data/image_audit/out/i_NNN.json({"bad": [{"n", "why"}]})に書く
- merge: bad の画像を manual/suppressions.json に画像単位で足す(削除依頼と同じ仕組み。build.py が外し、画像の無くなった事例は載せない)
使い方: python image_audit.py sheets / python image_audit.py merge [--dry-run]
"""
import argparse

from common import DATA, MANUAL, jdump, jload, today

D = DATA / "image_audit"


def sheets(a):
    from PIL import Image, ImageDraw, ImageFont
    cs = jload(DATA / "cases.json")["cases"]
    ims = [(r["id"], im["id"]) for r in cs for im in r["images"]]
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 24)
    except OSError:
        font = ImageFont.load_default()
    TW, TH, C, R = 330, 250, 5, 4
    (D / "sheets").mkdir(parents=True, exist_ok=True)
    n = 0
    for s in range(0, len(ims), C * R):
        W = Image.new("RGB", (C * TW, R * TH), "white")
        d = ImageDraw.Draw(W)
        for k, (cid, iid) in enumerate(ims[s:s + C * R]):
            x, y = (k % C) * TW, (k // C) * TH
            im = Image.open(DATA / "img" / "detail" / f"{iid}.webp").convert("RGB")
            im.thumbnail((TW - 8, TH - 8))
            W.paste(im, (x, y))
            d.rectangle([x, y, x + 40, y + 30], fill="yellow")
            d.text((x + 4, y + 2), str(k + 1), fill="black", font=font)
        n += 1
        W.save(D / "sheets" / f"i_{n:03d}.jpg", quality=82)
        jdump([{"case": c, "image": i} for c, i in ims[s:s + C * R]], D / "sheets" / f"i_{n:03d}.json")
    print(f"画像 {len(ims)} 枚 → シート {n} 枚({D / 'sheets'})")


def merge(a):
    sup = jload(MANUAL / "suppressions.json", {"cases": [], "images": [], "domains": [], "log": []})
    have = {s["id"] for s in sup["images"]}
    added, seen = 0, 0
    for p in sorted((D / "out").glob("i_*.json")):
        order = jload(D / "sheets" / p.name)
        for b in (jload(p, {}) or {}).get("bad", []):
            n = b.get("n")
            if not isinstance(n, int) or not 1 <= n <= len(order):
                continue
            seen += 1
            iid = order[n - 1]["image"]
            if iid in have:
                continue
            reason = "ループ14の画像点検: " + str(b.get("why") or "事例の写真でない")[:40]
            sup["images"].append({"id": iid, "reason": reason, "date": today()})
            sup["log"].append({"date": today(), "what": iid, "reason": reason})
            have.add(iid)
            added += 1
    if not a.dry_run:
        jdump(sup, MANUAL / "suppressions.json")
    print(f"点検で bad {seen} 枚 → 新しく外す {added} 枚" + ("(--dry-run)" if a.dry_run else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["sheets", "merge"])
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    {"sheets": sheets, "merge": merge}[a.cmd](a)


if __name__ == "__main__":
    main()
