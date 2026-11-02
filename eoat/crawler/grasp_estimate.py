# -*- coding: utf-8 -*-
"""掴み方の推定(ループ 13)。本文にも写真にも手がかりが無い事例(hand_unspecified のまま)に、大分類だけを推定して付ける。

- 手がかり: ワークのカテゴリ・作業・材料・可搬帯・ロボット区分・移動の有無・取得元・本文の語(4 字以上の英単語)・写真の CLIP 特徴(photo_grasp.py が作る data/photo_grasp/clip_b32.npz)
- 学習: 本文・LLM レビューで掴み方が確定した事例(写真から判定・推定で付けたものは使わない)を教師に、機械式・吸着・ソフト・磁石の 4 群の多クラスロジスティック回帰
- 反映: 確率が --min-prob(既定 0.55)以上のときだけ、語彙の *_est(「機械式(推定)」など。estimate_only)を付ける。小分類は付けない。
  fieldSources は method: "estimated"(evidence に確率と主な手がかり)、end_effector.estimated = true。本文・写真で分かった掴み方は書き換えない
- 精度: 5 分割の交差検証(教師の事例を順に伏せて当てる)で、しきい値ごとの付く割合と正解率を data/grasp_estimate/eval.md に書く(ループ 13: 0.6 以上で 78% に付き正解率 80%、0.55 で約 78%。記載なしを 10% 以下にするため 0.55)
使い方: python grasp_estimate.py [--min-prob 0.6] [--dry-run]
photo_grasp.py merge の後、build.py の前に実行する。
"""
import argparse
import random
import re
from collections import Counter

from common import DATA, TAXONOMY, jdump, jload, yload

OUT = DATA / "grasp_estimate"
C = ["mech", "vacuum", "soft", "magnet"]
EST_KEY = {g: f"{g}_est" for g in C}
WORD = re.compile(r"[a-z]{4,}")


def tokens(r, ex):
    t = ["cat:" + c for c in r["workpiece"]["categories"]] + ["task:" + x for x in r["tasks"]] + ["mat:" + m for m in r["workpiece"]["materials"]]
    t += ["pl:" + str(r.get("payload_class")), "rc:" + str(r["robot"].get("class")), "mob:" + str(bool(r["robot"].get("is_mobile_manipulator")))]
    t += ["src:" + (s.get("publisher") or "")[:40] for s in r["sources"][:1]]
    t += ["w:" + w for w in set(WORD.findall(((ex.get("title") or "") + " " + (ex.get("text") or "")[:4000]).lower()))]
    return t


def main():
    import numpy as np
    import torch
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-prob", type=float, default=0.55)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    G = {it["key"]: g["key"] for g in yload(TAXONOMY / "principles.yaml")["groups"] for it in g["items"]}
    z = np.load(DATA / "photo_grasp" / "clip_b32.npz")
    feats = dict(zip(z["ids"].tolist(), z["X"]))
    lab, unk = [], []
    for p in sorted((DATA / "classified").glob("*.json")):
        r = jload(p)
        if not r.get("images"):
            continue
        fs = (r.get("fieldSources") or {}).get("end_effector.principles") or {}
        k = (r["end_effector"]["principles"] or ["hand_unspecified"])[0]
        if k == "hand_unspecified" or fs.get("method") == "estimated":
            unk.append(r)
        elif G.get(k) in C and fs.get("method") != "photo":
            lab.append(r)
    ex = {r["id"]: jload(DATA / "extracted" / f"{r['id']}.json", {}) for r in lab + unk}
    voc = Counter(t for r in lab for t in set(tokens(r, ex[r["id"]])))
    V = {t: i for i, t in enumerate(t for t, n in voc.items() if n >= 3)}

    def vec(r):
        v = np.zeros(len(V), np.float32)
        for t in tokens(r, ex[r["id"]]):
            if t in V:
                v[V[t]] = 1
        im = [feats[i["id"]] for i in r["images"] if i["id"] in feats]
        return np.concatenate([v, (np.mean(im, 0) if im else np.zeros(512, np.float32)) * 5])

    X = np.stack([vec(r) for r in lab])
    Y = np.array([C.index(G[r["end_effector"]["principles"][0]]) for r in lab])

    def fit(Xt, yt):
        Xt, yt = torch.tensor(Xt), torch.tensor(yt)
        W = torch.zeros(Xt.shape[1], len(C), requires_grad=True)
        b = torch.zeros(len(C), requires_grad=True)
        opt = torch.optim.LBFGS([W, b], max_iter=200)

        def closure():
            opt.zero_grad()
            loss = torch.nn.functional.cross_entropy(Xt @ W + b, yt) + 3e-3 * (W ** 2).sum()
            loss.backward()
            return loss
        opt.step(closure)
        return W.detach(), b.detach()

    prob = lambda W, b, Xs: torch.softmax(torch.tensor(Xs) @ W + b, 1).numpy()
    # 交差検証(教師の事例を 5 つに分け、1 つずつ伏せて当てる)
    fold = np.array([random.Random(r["id"]).randrange(5) for r in lab])
    P = np.zeros((len(lab), len(C)))
    for f in range(5):
        W, b = fit(X[fold != f], Y[fold != f])
        P[fold == f] = prob(W, b, X[fold == f])
    ok, cf = P.argmax(1) == Y, P.max(1)
    lines = ["# 掴み方の推定: 交差検証", "", f"教師 {len(lab)} 件(本文・レビューで掴み方が確定した事例、4 群: {dict(Counter(C[y] for y in Y))})。多い群だけを答えると {np.bincount(Y).max() / len(Y):.2f}。", "",
             "| 確率のしきい値 | 付く割合 | 正解率 |", "|---|---|---|"]
    for t in [0.4, 0.5, 0.6, 0.7, 0.8]:
        m = cf >= t
        lines.append(f"| {t} | {m.mean():.2f} | {ok[m].mean():.3f} |")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "eval.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))

    W, b = fit(X, Y)
    Pu = prob(W, b, np.stack([vec(r) for r in unk])) if unk else []
    n_set, by = 0, Counter()
    # カテゴリごとの教師の群: 教師が 5 件以上あって一度も使われていない群は、そのカテゴリでは推定しない
    # (ループ 15 の採点: 鋳物・エンジン部品・歯車に「吸着(推定)」が付いていた。写真の特徴に引っぱられる)
    seen = {}
    for r, y in zip(lab, Y):
        seen.setdefault(r["workpiece"]["categories"][0], Counter())[y] += 1
    for r, p in zip(unk, Pu):
        cc = seen.get(r["workpiece"]["categories"][0])
        if cc and sum(cc.values()) >= 5:
            for i in range(len(C)):
                if not cc[i]:
                    p[i] = 0   # 割り直さない(残りの群の確率を水増ししない)
        g = C[int(p.argmax())]
        if p.max() < a.min_prob:
            if r["end_effector"].pop("estimated", None) and not a.dry_run:   # 前回は付けたが今回は確率が足りない: 記載なしに戻す
                r["end_effector"]["principles"] = ["hand_unspecified"]
                r["fieldSources"].pop("end_effector.principles", None)
                jdump(r, DATA / "classified" / f"{r['id']}.json")
            continue
        hint = [t.split(":", 1)[1] for t in tokens(r, ex[r["id"]]) if t.startswith(("cat:", "task:"))][:3]
        r["end_effector"]["principles"] = [EST_KEY[g]]
        r["end_effector"]["subtype"] = None
        r["end_effector"]["estimated"] = True     # 一覧用データで「推定」を数える
        r["fieldSources"]["end_effector.principles"] = {"source": 0, "method": "estimated",
                                                        "evidence": [f"確率 {p.max():.2f}(手がかり: {'・'.join(hint) or '写真の特徴'})"],
                                                        "note": "本文・写真に掴み方の手がかりが無いため、用途・ワーク・取得元・写真の特徴から推定"}
        r["quality"].setdefault("confidence", {})["principle"] = round(float(p.max()) * 0.6, 2)
        by[g] += 1
        n_set += 1
        if not a.dry_run:
            jdump(r, DATA / "classified" / f"{r['id']}.json")
    print(f"推定を付けた {n_set} / 対象 {len(unk)} 件 {dict(by)}" + ("(--dry-run)" if a.dry_run else ""))


if __name__ == "__main__":
    main()
