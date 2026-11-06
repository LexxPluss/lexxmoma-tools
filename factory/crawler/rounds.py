# -*- coding: utf-8 -*-
"""クロールの「回」の管理(会社の入れ替え)。

工場が 1 件以上取れた会社は残し、抽出済みで工場が取れなかった会社は外し、候補から次の会社を足す。
目標(台湾 150 社・韓国 250 社)に届くまで、registry → sites → wiki → 抽出 → extract_merge を繰り返す。
  keep_and_tried(cc) -> (工場のある会社 id の集合, 抽出済みで工場の無い会社 id の集合)
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATA, jload

TARGET = {"tw": 150, "kr": 250}


def keep_and_tried(cc):
    facs = jload(DATA / cc / "factories.json", [])
    keep = {f["cid"] for f in facs}
    tried = set()
    for p in (DATA / cc / "extracted").glob("*.json"):
        if p.stem not in keep:
            tried.add(p.stem)
    return keep, tried


def pick(cc, cands, quota, idf, indf):
    """cands は優先順に並んだ候補。idf(c) で会社 id、indf(c) で業種。
    工場のある会社は必ず残す → 業種の枠で足す → 枠を超えて優先順に足す。足す数は「目標との差の 2 倍」(1 回目の歩留まりが約 5〜6 割のため)。"""
    keep, tried = keep_and_tried(cc)
    target = TARGET[cc]
    kept = [c for c in cands if idf(c) in keep]
    need = max(0, target - len(kept))
    budget = (need * 2 if need >= 20 else need * 4) if keep else target   # 残りが少ないときは歩留まりのぶれを見込んで多めに
    fresh = [c for c in cands if idf(c) not in keep and idf(c) not in tried]
    cnt = {}
    for c in kept:
        cnt[indf(c)] = cnt.get(indf(c), 0) + 1
    add = []
    for c in fresh:                                   # 業種の枠の中で
        if len(add) >= budget:
            break
        if cnt.get(indf(c), 0) < quota.get(indf(c), 0):
            cnt[indf(c)] = cnt.get(indf(c), 0) + 1
            add.append(c)
    for c in fresh:                                   # 枠を超えて優先順に
        if len(add) >= budget:
            break
        if c not in add:
            add.append(c)
    return kept + add, {"kept": len(kept), "added": len(add), "tried_without_factory": len(tried), "target": target}
