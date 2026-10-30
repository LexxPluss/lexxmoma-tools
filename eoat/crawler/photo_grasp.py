# -*- coding: utf-8 -*-
"""写真から掴み方を判定する(ループ 11)。本文に掴み方の記載が無い事例(hand_unspecified)に、写真に写ったハンドの形から方式を付ける。

- sheets: 対象の事例の写真を 15 事例ずつ 1 枚のシート(番号付き)にまとめる → data/photo_grasp/sheets/s_NNN.jpg と事例 id の並び s_NNN.json。
  本文から掴み方が分かっている事例を 1 枚に 3 件ずつ伏せて混ぜ、判定の正解率を測る
- 判定: サブエージェント(画像を読めるモデル)が photo_grasp_instructions.md の手順でシートを見て data/photo_grasp/out/s_NNN.json に書く。
  写っていないものは推測しない(写っていなければ unknown)
- closeup: 一次判定で medium(ハンドが小さくて迷う)だった事例を、元画像(raw/images/)から大きく切り出して 6 事例ずつのシートにする → sheets/m_NNN。
  二次判定は photo_grasp_instructions.md の「二次判定」の節の手順で out/m_NNN.json に書き、一次判定より優先する
- merge: 判定をシートの並びと突き合わせて data/photo_grasp/results.json(事例 id ごと、一次・二次・CLIP の確率)にし、
  パターン認識(CLIP の画像特徴 + 線形分類器、clip_probe)の確率と合わせて decide() の規則で大分類を決め、分類結果(data/classified/)に反映する。
  伏せた事例での本文との一致は eval.md。fieldSources は method: "photo"(見えたもの を evidence に)。作業ツール(カメラ・溶接トーチ)は写真からは付けない
- 規則・LLM レビューが本文から掴み方を付けた事例は書き換えない(本文の記載が写真より優先)
使い方: python photo_grasp.py sheets [--limit N] / closeup / merge [--dry-run]
llm_merge.py の後、build.py の前に merge を実行する(classify.py --force の後も merge をやり直せば同じ結果に戻る)。
"""
import argparse
import random
from collections import Counter

from common import DATA, RAW, TAXONOMY, jdump, jload, yload

PG = DATA / "photo_grasp"
GROUPS = ["mech", "vacuum", "magnet", "soft", "combo", "process"]
# 写真に写ったカメラ・溶接トーチは事例の主題(ハンド)でないことが多い(伏せた事例で 4/4 件が誤り)ので、写真からは作業ツールを付けない
APPLY_GROUPS = {"mech", "vacuum", "magnet", "soft", "combo"}
CONF = {"high", "medium", "low"}
TW, TH, COLS, ROWS = 250, 190, 3, 5


def group_of():
    return {it["key"]: g["key"] for g in yload(TAXONOMY / "principles.yaml")["groups"] for it in g["items"]}


def unspecified(r):
    return (r["end_effector"]["principles"] or ["hand_unspecified"])[0] == "hand_unspecified"


def make_sheets(a):
    from PIL import Image, ImageDraw, ImageFont
    G = group_of()
    done = set(jload(PG / "results.json", {}) or {})
    target, known = [], []
    for p in sorted((DATA / "classified").glob("*.json")):
        r = jload(p)
        if not r.get("images"):
            continue
        if unspecified(r):
            if r["id"] not in done:
                target.append(r["id"])
        elif G.get(r["end_effector"]["principles"][0]) in ("mech", "vacuum", "magnet", "soft", "process"):
            known.append(r["id"])
    rnd = random.Random(7)
    rnd.shuffle(target)
    rnd.shuffle(known)
    if a.limit:
        target = target[:a.limit]
    order, k = [], 0
    for s in range(0, len(target), 12):
        ch = target[s:s + 12] + known[k:k + 3]
        k += 3
        rnd.shuffle(ch)
        order += ch
        while len(order) % 15 and k < len(known):
            order.append(known[k])
            k += 1
    imgs = {r["id"]: [im["id"] for im in r["images"]] for r in (jload(p) for p in (DATA / "classified").glob("*.json")) if r["id"] in set(order)}
    (PG / "sheets").mkdir(parents=True, exist_ok=True)
    start = len(list((PG / "sheets").glob("s_*.json")))
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
    except OSError:
        font = ImageFont.load_default()
    n = 0
    for s in range(0, len(order), COLS * ROWS):
        W = Image.new("RGB", (COLS * (2 * TW + 20), ROWS * (TH + 10)), "white")
        d = ImageDraw.Draw(W)
        for i, cid in enumerate(order[s:s + COLS * ROWS]):
            x, y = (i % COLS) * (2 * TW + 20), (i // COLS) * (TH + 10)
            for j, iid in enumerate(imgs[cid][:2]):
                im = Image.open(DATA / "img" / "detail" / f"{iid}.webp").convert("RGB")
                im.thumbnail((TW - 4, TH - 4))
                W.paste(im, (x + j * TW, y))
            d.rectangle([x, y, x + 34, y + 28], fill="yellow")
            d.text((x + 3, y + 2), str(i + 1), fill="black", font=font)
        name = f"s_{start + n:03d}"
        W.save(PG / "sheets" / f"{name}.jpg", quality=85)
        jdump(order[s:s + COLS * ROWS], PG / "sheets" / f"{name}.json")
        n += 1
    print(f"シート {n} 枚(対象 {len(target)} 件 + 正解の分かっている事例 {k} 件)→ {PG / 'sheets'}")


def make_closeups(a):
    """一次判定が medium の事例(伏せた事例も含めて正解率を測る)を元画像から 460x345 で 6 事例ずつ。"""
    import hashlib
    from PIL import Image, ImageDraw, ImageFont
    res = jload(PG / "results.json", {}) or {}
    idx = jload(RAW / "images" / "index.json", {}) or {}
    done = {i for sp in (PG / "sheets").glob("m_*.json") for i in jload(sp)}
    ids = [cid for cid, v in res.items() if (v.get("p1") or {}).get("conf") == "medium" and cid not in done and (DATA / "classified" / f"{cid}.json").exists()]
    random.Random(3).shuffle(ids)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 30)
    except OSError:
        font = ImageFont.load_default()
    W_, H_ = 460, 345
    start = len(list((PG / "sheets").glob("m_*.json")))

    def load(im):
        f = idx.get(hashlib.sha256(im["source_image_url"].encode("utf-8")).hexdigest()[:16], {}).get("file")
        p = RAW / "images" / f if f else None
        return Image.open(p if p and p.exists() else DATA / "img" / "detail" / f"{im['id']}.webp").convert("RGB")
    n = 0
    for s in range(0, len(ids), 6):
        W = Image.new("RGB", (2 * (2 * W_ + 30), 3 * (H_ + 12)), "white")
        d = ImageDraw.Draw(W)
        for i, cid in enumerate(ids[s:s + 6]):
            x, y = (i % 2) * (2 * W_ + 30), (i // 2) * (H_ + 12)
            for j, im in enumerate(jload(DATA / "classified" / f"{cid}.json")["images"][:2]):
                I = load(im)
                I.thumbnail((W_ - 6, H_ - 6))
                W.paste(I, (x + j * W_, y))
            d.rectangle([x, y, x + 44, y + 38], fill="yellow")
            d.text((x + 6, y + 2), str(i + 1), fill="black", font=font)
        name = f"m_{start + n:03d}"
        W.save(PG / "sheets" / f"{name}.jpg", quality=88)
        jdump(ids[s:s + 6], PG / "sheets" / f"{name}.json")
        n += 1
    print(f"拡大シート {n} 枚(medium {len(ids)} 件)→ {PG / 'sheets'}")


def clip_probe(res, G):
    """パターン認識: CLIP(ViT-B/32)の画像特徴に線形分類器(多クラスのロジスティック回帰)を学習し、事例ごとに大分類の確率を出す。
    教師は本文から掴み方が分かっている事例(写真から付けたものは除く)。その事例自身の確率は 5 分割の交差検証の予測(自分を学習に使わない)。
    特徴は data/photo_grasp/clip_b32.npz に画像 id ごとに残し、次からは新しい画像だけ計算する。"""
    import numpy as np
    import open_clip
    import torch
    from PIL import Image
    C = ["mech", "vacuum", "soft", "magnet", "process"]
    cases = {}
    for p in sorted((DATA / "classified").glob("*.json")):
        r = jload(p)
        if r.get("images"):
            cases[r["id"]] = r
    cache = PG / "clip_b32.npz"
    feats = {}
    if cache.exists():
        z = np.load(cache)
        feats = dict(zip(z["ids"].tolist(), z["X"]))
    need = sorted({im["id"] for r in cases.values() for im in r["images"]} - set(feats))
    if need:
        model, _, pre = open_clip.create_model_and_transforms("ViT-B-32", pretrained="openai")
        model.eval()
        with torch.no_grad():
            for i in range(0, len(need), 32):
                b = torch.stack([pre(Image.open(DATA / "img" / "detail" / f"{j}.webp").convert("RGB")) for j in need[i:i + 32]])
                f = model.encode_image(b)
                f = (f / f.norm(dim=-1, keepdim=True)).numpy()
                feats.update(zip(need[i:i + 32], f))
        np.savez(cache, ids=np.array(list(feats)), X=np.stack(list(feats.values())))
    lab = []
    for cid, r in cases.items():
        fs = (r.get("fieldSources") or {}).get("end_effector.principles") or {}
        g = G.get(r["end_effector"]["principles"][0]) if r["end_effector"]["principles"] else None
        if g in C and fs.get("method") != "photo":
            lab.append((cid, C.index(g)))

    def fit(items):
        X = [feats[im["id"]] for cid, _ in items for im in cases[cid]["images"]]
        y = [k for cid, k in items for _ in cases[cid]["images"]]
        Xt, yt = torch.tensor(np.array(X)) * 10, torch.tensor(y)
        cnt = np.bincount(y, minlength=len(C))
        cw = torch.tensor(len(y) / (len(C) * np.maximum(cnt, 1)), dtype=torch.float32)   # 件数の少ない群(磁石・ソフト)に重み
        W = torch.zeros(Xt.shape[1], len(C), requires_grad=True)
        b = torch.zeros(len(C), requires_grad=True)
        opt = torch.optim.LBFGS([W, b], max_iter=300)

        def closure():
            opt.zero_grad()
            loss = torch.nn.functional.cross_entropy(Xt @ W + b, yt, weight=cw) + 1e-3 * (W ** 2).sum()
            loss.backward()
            return loss
        opt.step(closure)
        return W.detach(), b.detach()

    def prob(W, b, cid):
        X = torch.tensor(np.array([feats[im["id"]] for im in cases[cid]["images"]])) * 10
        return dict(zip(C, torch.softmax(X @ W + b, 1).mean(0).tolist()))
    out = {}
    fold = {cid: random.Random(cid).randrange(5) for cid, _ in lab}
    for f in range(5):
        W, b = fit([x for x in lab if fold[x[0]] != f])
        out.update({cid: prob(W, b, cid) for cid, _ in lab if fold[cid] == f and cid in res})
    W, b = fit(lab)
    out.update({cid: prob(W, b, cid) for cid in res if cid in cases and cid not in out})
    return out


def decide(v, clip):
    """一次・二次の判定と CLIP の確率から、反映する大分類を決める(伏せた事例で決めた規則、eval.md)。
    - 一次で high → その判定 / 二次(拡大)で high → その判定
    - 二次で medium のときは、一次と同じ大分類で、CLIP の最も確率の高い大分類とも一致するときだけ(視覚判定と特徴のパターン認識の合議)"""
    p1, p2 = v.get("p1") or {}, v.get("p2") or {}
    top = max(clip, key=clip.get) if clip else None
    if p1.get("conf") == "high" and p1.get("group") != "unknown":
        return p1, "一次 high"
    if p2.get("conf") == "high" and p2.get("group") != "unknown":
        return p2, "二次 high"
    if p2.get("conf") == "medium" and p2.get("group") not in (None, "unknown") and p2["group"] == p1.get("group") == top:
        return p2, "二次 medium + 一次 + CLIP"
    return None, None


def merge(a):
    G = group_of()
    res = jload(PG / "results.json", {}) or {}
    # 一次(s_)と二次(m_: 拡大して見直したもの)を事例ごとに両方残す
    for sp in sorted((PG / "out").glob("s_*.json")) + sorted((PG / "out").glob("m_*.json")):
        ids = jload(PG / "sheets" / sp.name)
        for v in jload(sp, []):
            n = v.get("n")
            if not isinstance(n, int) or not 1 <= n <= len(ids):
                continue
            g = v.get("group") if v.get("group") in GROUPS else "unknown"
            st = v.get("subtype") if G.get(v.get("subtype")) == g else None
            res.setdefault(ids[n - 1], {})["p2" if sp.stem.startswith("m_") else "p1"] = {
                "group": g, "subtype": st, "conf": v.get("conf") if v.get("conf") in CONF else "low", "seen": str(v.get("seen") or "")[:60], "sheet": sp.stem}
    clip = clip_probe(res, G)
    for cid, pr in clip.items():
        res[cid]["clip"] = {k: round(x, 3) for k, x in pr.items()}
    jdump(res, PG / "results.json")

    # 伏せた事例(本文から掴み方が分かっている)で、規則ごとの本文との一致を測る
    by_rule, dis = Counter(), []
    for cid, v in res.items():
        p = DATA / "classified" / f"{cid}.json"
        if not p.exists():
            continue
        r = jload(p)
        fs = (r.get("fieldSources") or {}).get("end_effector.principles") or {}
        if unspecified(r) or fs.get("method") == "photo" or G.get(r["end_effector"]["principles"][0]) == "combo":
            continue
        d, rule = decide(v, v.get("clip"))
        if not d or d["group"] not in APPLY_GROUPS:
            continue
        truth = {G.get(k) for k in r["end_effector"]["principles"]}
        ok = d["group"] in truth
        by_rule[(rule, ok)] += 1
        if not ok:
            dis.append(f"- {cid}: 写真 {d['group']}({d['seen']})/ 本文 {'・'.join(r['end_effector']['principles'])}")
    lines = ["# 写真からの掴み方の判定: 伏せた事例での本文との一致", "",
             "本文から掴み方が分かっている事例をシートに伏せて混ぜ、反映の規則に通ったものの大分類を本文と比べた。",
             "不一致には本文側の誤り(写真では吸盤なのに本文の語から「ソフト」など)も含むので、精度の下限の目安。", "",
             "| 規則 | 一致 | 不一致 | 一致率 |", "|---|---|---|---|"]
    for rule in ["一次 high", "二次 high", "二次 medium + 一次 + CLIP"]:
        t, f = by_rule[(rule, True)], by_rule[(rule, False)]
        lines.append(f"| {rule} | {t} | {f} | {t / max(1, t + f):.2f} |")
    t, f = sum(n for (_, ok), n in by_rule.items() if ok), sum(n for (_, ok), n in by_rule.items() if not ok)
    lines += [f"| 計 | {t} | {f} | {t / max(1, t + f):.2f} |", "", "不一致(目で裁定する):"] + dis
    (PG / "eval.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:12]))

    # 反映: 本文に掴み方の記載が無い事例だけ
    fallback = {g: f"{g}_photo" for g in GROUPS}
    known_keys = set(G)
    n_set, n_skip, by = 0, 0, Counter()
    for cid, v in res.items():
        p = DATA / "classified" / f"{cid}.json"
        if not p.exists():
            continue
        r = jload(p)
        fs = (r.get("fieldSources") or {}).get("end_effector.principles") or {}
        if not (unspecified(r) or fs.get("method") in ("photo", "estimated")):   # 推定より写真の判定を優先
            continue
        d, rule = decide(v, v.get("clip"))
        key = (d["subtype"] or fallback[d["group"]]) if d and d["group"] in APPLY_GROUPS else None
        if key not in known_keys:
            n_skip += 1
            if r["end_effector"].pop("by_photo", None) and not a.dry_run:   # 前回は付けたが今回の規則では付かない: 印と根拠を外して記載なしに戻す
                r["end_effector"]["principles"] = ["hand_unspecified"]
                r["fieldSources"].pop("end_effector.principles", None)
                jdump(r, p)
            continue
        r["end_effector"]["principles"] = [key]
        r["end_effector"]["subtype"] = None
        r["end_effector"]["by_photo"] = True     # 一覧用データで「写真から判定」を数える(fieldSources は詳細用にだけある)
        r["end_effector"].pop("estimated", None)
        r["fieldSources"]["end_effector.principles"] = {"source": 0, "method": "photo", "evidence": [d["seen"]] if d["seen"] else [],
                                                        "note": f"写真に写ったハンドの形から判定({rule})"}
        r["quality"].setdefault("confidence", {})["principle"] = 0.7 if "high" in rule else 0.6
        by[G[key]] += 1
        n_set += 1
        if not a.dry_run:
            jdump(r, p)
    print(f"反映 {n_set} 件 {dict(by)} / 判定できず {n_skip} 件" + ("(--dry-run: 書き込みなし)" if a.dry_run else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["sheets", "closeup", "merge"])
    ap.add_argument("--limit", type=int)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    {"sheets": make_sheets, "closeup": make_closeups, "merge": merge}[a.cmd](a)


if __name__ == "__main__":
    main()
