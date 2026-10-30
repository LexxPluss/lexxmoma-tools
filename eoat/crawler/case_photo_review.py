# -*- coding: utf-8 -*-
"""事例ごとに、題名・本文の冒頭と写真をまとめて見直す(ループ 15 の品質ループ)。

ループ 14 の採点で残った誤りの多くは「写真を見れば分かるのに、本文からしか付けていない」ものだった:
ロボットの区分・メーカー(橙の KUKA・UR の青い関節・スカラ)、汎用(その他)のままのワーク、写真と食い違う推定の掴み方、
別の案件の写真(実績一覧ページの他の事例・業界誌の広告)。画像を 1 枚ずつ見る点検(image_audit.py)では、どの事例の写真かが分からないので拾えない。

- sheets: data/cases.json の事例を 8 件ずつ、写真 3 枚までを 1 行に並べたシート(case_review/sheets/c_NNN.jpg)と、
  事例ごとの題名・本文の冒頭 400 字・今の値(c_NNN.json)を作る
- 見直し: サブエージェントが case_photo_review_instructions.md の手順で case_review/out/c_NNN.json に書く
- merge: 反映は今の値が空・推定・汎用のときだけ(本文から確定した値は書き換えない)。fieldSources は method: "photo"。
  別の案件の写真は manual/suppressions.json に、事例でないものは data/rejected.json に
使い方: python case_photo_review.py sheets / python case_photo_review.py merge [--dry-run]
"""
import argparse

from common import DATA, MANUAL, TAXONOMY, jdump, jload, today, yload

D = DATA / "case_review"
PER = 8


def labels():
    L = {}
    for g in yload(TAXONOMY / "categories.yaml")["groups"]:
        for it in g["items"]:
            L[it["key"]] = f"{g['label']}>{it['label']}"
    for g in yload(TAXONOMY / "principles.yaml")["groups"]:
        for it in g["items"]:
            L[it["key"]] = f"{g['label']}>{it['label']}"
    return L


def sheets(a):
    from PIL import Image, ImageDraw, ImageFont
    L = labels()
    cs = jload(DATA / "cases.json")["cases"]
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 26)
    except OSError:
        font = ImageFont.load_default()
    TW, TH = 420, 300
    (D / "sheets").mkdir(parents=True, exist_ok=True)
    n = 0
    for s in range(0, len(cs), PER):
        chunk = cs[s:s + PER]
        W = Image.new("RGB", (3 * TW, len(chunk) * TH), "white")
        d = ImageDraw.Draw(W)
        meta = []
        for j, r in enumerate(chunk):
            for k, im in enumerate(r["images"][:3]):
                I = Image.open(DATA / "img" / "detail" / f"{im['id']}.webp").convert("RGB")
                I.thumbnail((TW - 8, TH - 8))
                W.paste(I, (k * TW, j * TH))
                d.rectangle([k * TW, j * TH, k * TW + 64, j * TH + 34], fill="yellow")
                d.text((k * TW + 4, j * TH + 2), f"{j + 1}-{k + 1}", fill="black", font=font)
            ex = jload(DATA / "extracted" / f"{r['id']}.json", {})
            fs = (r.get("fieldSources") or {}).get("end_effector.principles") or {}
            meta.append({"n": j + 1, "id": r["id"], "title": (ex.get("title") or "")[:120], "text": (ex.get("text") or "")[:400],
                         "images": [im["id"] for im in r["images"][:3]],
                         "current": {"categories": [L.get(c, c) for c in r["workpiece"]["categories"]],
                                     "principles": [L.get(p, p) for p in r["end_effector"]["principles"]], "principles_basis": fs.get("method"),
                                     "robot_maker": r["robot"].get("maker"), "robot_class": r["robot"].get("class")}})
        n += 1
        W.save(D / "sheets" / f"c_{n:03d}.jpg", quality=82)
        jdump(meta, D / "sheets" / f"c_{n:03d}.json")
    print(f"事例 {len(cs)} 件 → シート {n} 枚({D / 'sheets'})")


def merge(a):
    cats = {it["key"] for g in yload(TAXONOMY / "categories.yaml")["groups"] for it in g["items"]}
    G = {it["key"]: g["key"] for g in yload(TAXONOMY / "principles.yaml")["groups"] for it in g["items"]}
    sup = jload(MANUAL / "suppressions.json", {"cases": [], "images": [], "domains": [], "log": []})
    have = {s["id"] for s in sup["images"]}
    rejected = jload(DATA / "rejected.json", {})
    n = {"img": 0, "class": 0, "maker": 0, "grasp": 0, "cat": 0, "drop": 0}
    for p in sorted((D / "out").glob("c_*.json")):
        meta = {m["n"]: m for m in jload(D / "sheets" / p.name)}
        for v in jload(p, []):
            m = meta.get(v.get("n"))
            if not m:
                continue
            cp = DATA / "classified" / f"{m['id']}.json"
            if not cp.exists():
                continue
            r = jload(cp)
            note = str(v.get("note") or "")[:80]
            if v.get("is_case") is False:
                rejected[m["id"]] = {"url": r["sources"][0]["url"], "why": "写真と本文の見直し: 事例ではない: " + note}
                n["drop"] += 1
                if not a.dry_run:
                    cp.unlink()
                continue
            for k in v.get("images_bad") or []:
                if isinstance(k, int) and 1 <= k <= len(m["images"]) and m["images"][k - 1] not in have:
                    iid = m["images"][k - 1]
                    sup["images"].append({"id": iid, "reason": "ループ15の見直し: 別の案件・事例と関係ない写真", "date": today()})
                    have.add(iid)
                    n["img"] += 1
            src = lambda ev: {"source": 0, "method": "photo", "evidence": [ev] if ev else [], "note": "写真から判定(事例ごとの見直し)"}
            rb, ee, wp = r["robot"], r["end_effector"], r["workpiece"]
            if v.get("robot_class") in ("協働", "産業用") and not rb.get("class"):
                rb["class"] = v["robot_class"]
                r["fieldSources"]["robot.class"] = src(note)
                n["class"] += 1
            if v.get("robot_maker") and not rb.get("maker"):
                rb["maker"] = str(v["robot_maker"])[:40]
                r["fieldSources"]["robot.maker"] = src(note)
                n["maker"] += 1
            fs = (r.get("fieldSources") or {}).get("end_effector.principles") or {}
            g = v.get("grasp") or {}
            key = g.get("subtype") if G.get(g.get("subtype")) == g.get("group") else (f"{g.get('group')}_photo" if g.get("group") in ("mech", "vacuum") else None)
            if g.get("conf") == "high" and key in G and G[key] not in ("process", "unknown") and \
                    (ee["principles"][0] == "hand_unspecified" or fs.get("method") == "estimated"):
                ee["principles"] = [key]
                ee["subtype"] = None
                ee["by_photo"] = True
                ee.pop("estimated", None)
                r["fieldSources"]["end_effector.principles"] = src(g.get("seen") or note)
                n["grasp"] += 1
            c = v.get("category")
            if c in cats and c != "generic" and wp["categories"][0] == "generic":
                wp["categories"] = [c] + [x for x in wp["categories"] if x not in ("generic", c)][:2]
                r["fieldSources"]["workpiece.categories"] = src(note)
                n["cat"] += 1
            if not a.dry_run:
                jdump(r, cp)
    if not a.dry_run:
        jdump(sup, MANUAL / "suppressions.json")
        jdump(rejected, DATA / "rejected.json")
    print(f"反映: {n}" + ("(--dry-run)" if a.dry_run else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["sheets", "merge"])
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    {"sheets": sheets, "merge": merge}[a.cmd](a)


if __name__ == "__main__":
    main()
