# -*- coding: utf-8 -*-
"""重複判定(4-5): 同じ出典 URL / 同じ画像(phash) / メーカー+型式+ワーク+用途 が同じ事例を 1 件に束ねる。
束ねられた側の出典は sources に残す。build.py から呼ぶ。"""
import re
from collections import Counter
import urllib.parse

from common import canon_url

# 記事の中身を変えないクエリ(一覧の何ページ目・どのタグから来たか)。ループ 10: ロボットダイジェストの同じ記事が &r= と &ca=5 で 21 件重複していた
NAV_PARAMS = {"r", "ca", "cat", "category", "tag", "from", "src"}


def url_key(u):
    """重複判定用の URL: canon_url から上の一覧用クエリも落とす(url_id は変えない)。"""
    p = urllib.parse.urlsplit(canon_url(u))
    q = [(k, v) for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True) if k.lower() not in NAV_PARAMS]
    return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, urllib.parse.urlencode(q), ""))


def _key_mmwt(r):
    ee, wp = r.get("end_effector", {}), r.get("workpiece", {})
    if not (ee.get("maker") and ee.get("model")):
        return None
    return (ee["maker"], ee["model"], tuple(wp.get("categories", [])[:1]), tuple(r.get("tasks", [])[:1]), r.get("robot", {}).get("model"))


_STOP = {"robot", "robots", "robotiq", "cobot", "cobots", "case", "study", "studies", "story", "stories", "with", "from", "that", "this", "their", "using", "solution",
         "palletizing", "palletising", "palletizer", "automation", "automated", "automates", "gripper", "universal", "application", "customer", "success", "industrial", "collaborative"}


def _names(r):
    """題名に出る固有名詞らしい語(英数字 4 文字以上、一般語を除く)。製品キーが同じでも顧客が違えば別の事例(ループ 9: Robotiq の段ボールパレタイズ 7 社が 1 件に束ねられていた)。"""
    import re
    ee = r.get("end_effector", {})
    product = {w.lower() for w in re.findall(r"[A-Za-z0-9][A-Za-z0-9&'-]{2,}", f"{ee.get('maker') or ''} {ee.get('model') or ''}")}   # 製品名の語は顧客名ではない
    out = set()
    for t in [r.get("title_orig") or ""] + [s.get("title") or "" for s in r.get("sources", [])]:
        for w in re.findall(r"[A-Za-z][A-Za-z0-9&'-]{3,}", t):
            if w.lower() not in _STOP and w.lower() not in product:
                out.add(w.lower())
    return out


def _hamming(a, b):
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def _slug(u):
    """URL の末尾(言語・地域のパスを除いた最後の部分)。/case-stories/evco-plastics と /ja/case-stories/evco-plastics を同じと見る。"""
    p = urllib.parse.urlsplit(u)
    path = [x for x in p.path.lower().split("/") if x]
    last = path[-1].split(".")[0] if path else ""
    # 記事をクエリで区別するサイト(robot-digest の /contents/?id=…、detail.html?p_id=…)は id もスラッグに含める。
    # ループ 14: 「contents」が同じで、サイト共通の画像 1 枚を共有する別の記事を束ねていた
    q = sorted((k, v) for k, v in urllib.parse.parse_qsl(p.query) if k.lower() not in NAV_PARAMS)
    slug = last + ("?" + urllib.parse.urlencode(q) if q else "")
    return slug if len(last) >= 6 or q else ""   # index / top のような短い名前は使わない


def dedupe(cases, image_thr=4):
    """cases(list) → (残した list, 束ねた件数, 理由の一覧)。先に出てきた(=出典の多い・画像の多い)方を残す。"""
    cases = sorted(cases, key=lambda r: (-len(r.get("images", [])), -len(r.get("sources", [])), r["id"]))
    kept, by_url, by_key, merged, reasons = [], {}, {}, 0, []
    phashes = []   # (phash, kept_index)
    all_ph = []    # 残した事例のすべての画像 (phash, kept_index)
    for r in cases:
        urls = [url_key(s["url"]) for s in r.get("sources", [])]
        target, why = None, None
        for u in urls:
            if u in by_url:
                target, why = by_url[u], "同じ出典 URL"
                break
        if target is None:
            k = _key_mmwt(r)
            if k and k in by_key and (_names(r) & _names(kept[by_key[k]])):
                target, why = by_key[k], "メーカー+型式+ワーク+用途が同じ(題名の固有名詞も共通)"
        if target is None and r.get("images"):
            # 代表画像が同じ(phash が近い) かつ 同じ取得元の種類
            ph = r["images"][0]["phash"]
            for p, ki in phashes:
                if _hamming(ph, p) <= image_thr and kept[ki]["case_type"] == r["case_type"] and set(kept[ki]["workpiece"]["categories"]) & set(r["workpiece"]["categories"]):
                    target, why = ki, "同じ画像"
                    break
        if target is None and r.get("images"):
            # 言語・地域違いの同じ事例(UR の英語版と日本語版、安川の各国サイト、SIer の記事と業界誌の転載。ループ 14 で 176 組):
            # ほぼ同じ画像を 2 枚以上共有するか、1 枚共有して URL の末尾が同じなら同じ事例。1 枚だけの共有は共通の宣材写真のことがあるので束ねない
            mine = [im["phash"] for im in r["images"]]
            shared = Counter(ki for p, ki in all_ph for q in mine if _hamming(p, q) <= image_thr)
            slugs = {_slug(s["url"]) for s in r.get("sources", [])} - {""}
            doms = {urllib.parse.urlsplit(s["url"]).netloc.lower().removeprefix("www.") for s in r.get("sources", [])}
            for ki, n in shared.most_common():
                same_slug = bool(slugs & {_slug(s["url"]) for s in kept[ki]["sources"]})
                same_dom = bool(doms & {urllib.parse.urlsplit(s["url"]).netloc.lower().removeprefix("www.") for s in kept[ki]["sources"]})
                # 同じサイトの別の記事は宣材写真を 2 枚共有することがある(Schmalz の Halloren と Woitinek)ので、同じドメインなら末尾が同じか 3 枚以上
                if same_slug or (n >= 3) or (n >= 2 and not same_dom):
                    target, why = ki, f"同じ画像 {n} 枚" + (" + 同じ URL の末尾" if same_slug else "")
                    break
        if target is not None:
            t = kept[target]
            known = {url_key(s["url"]) for s in t["sources"]}
            for s in r.get("sources", []):
                if url_key(s["url"]) not in known:
                    t["sources"].append(s)
            merged += 1
            reasons.append({"kept": t["id"], "dropped": r["id"], "why": why})
            continue
        ki = len(kept)
        kept.append(r)
        for u in urls:
            by_url[u] = ki
        k = _key_mmwt(r)
        if k:
            by_key[k] = ki
        for im in r.get("images", [])[:1]:
            phashes.append((im["phash"], ki))
        for im in r.get("images", []):
            all_ph.append((im["phash"], ki))
    return kept, merged, reasons
