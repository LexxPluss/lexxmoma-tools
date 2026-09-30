# -*- coding: utf-8 -*-
"""営業シグナルの生成(SPEC §6)。規則の条件と文面は rules/*.yaml。事実(events/tenures)と解釈を ID で結ぶ。

generate(company, persons, tenures, events, org_units, rules, today) → signals[]
各シグナル: {id, company_id, rule, level, title, fact, event_ids, tenure_ids, person_id, source_ids, interpretation,
             verify_question, is_speculative, generated_by: "rule", reviewed_by: None, review_status: None, created_at}
"""
import re
from pathlib import Path

from common import RULES, age_at, stable_id, today as _today
from normalize import rank_level

ORIGIN = [("開発", re.compile(r"開発|技術|設計|研究")), ("生産", re.compile(r"生産|製造|工場|工機|品質")), ("営業", re.compile(r"営業|販売|マーケ")),
          ("管理", re.compile(r"管理|経理|経営企画|人事|総務|財務|購買|調達"))]


def load_rules(path=None):
    import yaml
    files = [Path(path)] if path else sorted(RULES.glob("*.yaml"))
    rules, vocab = [], {"forbidden": [], "replace": {}}
    for f in files:
        y = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        rules.extend(y.get("rules") or [])
        v = y.get("vocabulary") or {}
        vocab["forbidden"] += v.get("forbidden") or []
        vocab["replace"].update(v.get("replace") or {})
    return rules, vocab


def check_vocabulary(texts, vocab):
    """禁止語(削減人数・置き換え 等)を含む文字列を返す(受入基準 15)。"""
    bad = []
    for t in texts:
        for w in vocab.get("forbidden") or []:
            if w in (t or ""):
                bad.append((w, t))
    return bad


def fmt(tpl, **kw):
    class D(dict):
        def __missing__(self, k):
            return "?"
    return (tpl or "").format_map(D(**{k: (v if v is not None else "?") for k, v in kw.items()}))


def _units_str(t):
    return "・".join(t.get("unit_names") or []) or t.get("rank") or ""


def _main_unit(t):
    for u in t.get("units_detail") or []:
        if u.get("is_head"):
            return u["name"]
    return (t.get("unit_names") or [None])[0]


def generate(company, persons, tenures, events, org_units, rules, today=None):
    today = today or _today()
    cid = company["id"]
    by_person = {}
    for t in sorted(tenures, key=lambda t: (t["from"] or "")):
        by_person.setdefault(t["person_id"], []).append(t)
    pmap = {p["id"]: p for p in persons}
    out = []
    rule_map = {r["id"]: r for r in rules}

    def add(rule, person_id, title, interp, vq, tenure_ids=(), event_ids=(), key="", level=None, spec=None):
        t_ids = list(tenure_ids)
        e_ids = list(event_ids)
        src = []
        for t in tenures:
            if t["id"] in t_ids:
                src += t.get("source_ids") or []
        for e in events:
            if e["id"] in e_ids:
                src += [e["source_id"]] if e.get("source_id") else []
        src = list(dict.fromkeys(src))
        if not src:
            return  # 出典の無い解釈は保存しない(§0-5)
        fact = "; ".join(_fact_of(t) for t in tenures if t["id"] in t_ids) or "; ".join(_fact_of_event(e, pmap) for e in events if e["id"] in e_ids)
        out.append({
            "id": stable_id(cid, "SG", rule["id"], person_id, key), "company_id": cid, "rule": rule["id"], "rule_name": rule.get("name"),
            "level": level or rule.get("level", "mid"), "title": title, "fact": fact, "event_ids": e_ids, "tenure_ids": t_ids,
            "person_id": person_id, "source_ids": src, "interpretation": interp, "verify_question": vq,
            "is_speculative": bool(rule.get("is_speculative") if spec is None else spec),
            "generated_by": "rule", "reviewed_by": None, "review_status": None, "review_comment": None, "created_at": today,
        })

    # R1 生技系昇格
    r = rule_map.get("R1-seigi-promotion")
    if r:
        rx = re.compile(r["when"]["prev_title_regex"])
        def senior(t):   # 本部長以上 = 本部の責任者、または取締役以上
            return rank_level(t.get("rank")) >= 70 or any(u.get("kind") == "本部" and u.get("is_head") for u in t.get("units_detail") or [])
        for pid, ts in by_person.items():
            own = [t for t in ts if t["scope"] in ("own", "subsidiary")]
            hit = None
            for i, t in enumerate(own):
                if t["scope"] != "own" or not senior(t):
                    continue
                prevs = [p for p in own[:i] if rx.search(p.get("title_raw") or "") and not senior(p)]
                if prevs:
                    hit = (t, prevs[-1])
                    break   # 最初の昇格だけ
            if hit:
                t, p = hit
                person = pmap[pid]
                add(r, pid, fmt(r["title"], name=person["name"], title=t["title_raw"], prev_unit=_main_unit(p) or p["title_raw"]),
                    fmt(r["interpretation"], unit=_main_unit(t) or t["title_raw"], prev_unit=_main_unit(p) or p["title_raw"]),
                    fmt(r["verify_question"], unit=_main_unit(t) or t["title_raw"], prev_unit=_main_unit(p) or p["title_raw"]),
                    tenure_ids=[t["id"], p["id"]], key=t["id"])

    # R2 組織改称・分離(concurrent_released で残った側 / unit_renamed の新名が DX 系)
    r = rule_map.get("R2-unit-split-dx")
    if r:
        rx = re.compile(r["when"]["unit_regex"])
        tpl = r.get("templates") or {}
        for e in events:
            if e["type"] == "concurrent_released":
                remain = e.get("after") or ""
                if rx.search(remain):
                    person = pmap.get(e.get("person_id"), {"name": "?"})
                    tp = tpl.get("split") or r
                    add(r, e.get("person_id"), fmt(tp["title"], old_unit=e.get("before"), new_unit=remain, name=person["name"]),
                        fmt(tp["interpretation"], old_unit=e.get("before"), new_unit=remain), fmt(tp["verify_question"], old_unit=e.get("before"), new_unit=remain),
                        event_ids=[e["id"]], key=e["id"])
            elif e["type"] == "unit_renamed" and rx.search(e.get("after") or ""):
                tp = tpl.get("rename") or r
                add(r, e.get("person_id"), fmt(tp["title"], old_unit=e.get("before"), new_unit=e.get("after")),
                    fmt(tp["interpretation"], old_unit=e.get("before"), new_unit=e.get("after")), fmt(tp["verify_question"], old_unit=e.get("before"), new_unit=e.get("after")),
                    event_ids=[e["id"]], key=e["id"])

    # R3 原価・投資の兼務
    r = rule_map.get("R3-cost-concurrent")
    if r:
        rx_main, rx_con = re.compile(r["when"]["main_unit_regex"]), re.compile(r["when"]["concurrent_unit_regex"])
        for pid, ts in by_person.items():
            for t in ts:
                if t["scope"] != "own" or t.get("to"):
                    continue
                units = t.get("units_detail") or []
                mains = [u for u in units if u.get("is_head") and rx_main.search(u["name"])]
                cons = [u for u in units if rx_con.search(u["name"])]
                if mains and cons:
                    person = pmap[pid]
                    add(r, pid, fmt(r["title"], name=person["name"], unit=mains[0]["name"], prev_unit=cons[0]["name"]),
                        fmt(r["interpretation"], unit=mains[0]["name"], prev_unit=cons[0]["name"]), fmt(r["verify_question"], unit=mains[0]["name"], prev_unit=cons[0]["name"]),
                        tenure_ids=[t["id"]], key=t["id"])

    # R4 新任役員の前職
    r = rule_map.get("R4-new-officer-background")
    if r:
        kinds = {k: re.compile(v) for k, v in r["when"]["prev_kinds"].items()}
        for e in events:
            if e["type"] != "appointed" or rank_level(e.get("rank")) < 70:
                continue
            ts = by_person.get(e.get("person_id"), [])
            cur = next((t for t in ts if t["id"] == e.get("tenure_id")), None)
            prev = [t for t in ts if t is not cur and (t["from"] or "") <= (cur["from"] if cur else e["date"]) and t["id"] != e.get("tenure_id")]
            prev = [t for t in prev if not (cur and t["from"] == cur["from"] and t["scope"] == "own")]
            if not prev:
                continue
            p = sorted(prev, key=lambda t: t["from"] or "")[-1]
            kind = None
            for k, rx in kinds.items():
                if (k == "overseas" and p["scope"] == "subsidiary" and rx.search(p.get("rank") or p.get("title_raw") or "")) or \
                        (k != "overseas" and p["scope"] == "own" and rx.search(p.get("title_raw") or "")):
                    kind = k
                    break
            if not kind:
                continue
            tp = r["templates"][kind]
            person = pmap[e["person_id"]]
            unit = _main_unit(cur) if cur else ""
            add(r, e["person_id"], fmt(tp["title"], name=person["name"], title=e.get("after"), prev_unit=_main_unit(p) or p.get("title_raw")),
                fmt(tp["interpretation"], prev_unit=_main_unit(p) or p.get("title_raw"), unit=unit),
                fmt(tp["verify_question"], prev_unit=_main_unit(p) or p.get("title_raw"), unit=unit),
                tenure_ids=[cur["id"], p["id"]] if cur else [p["id"]], event_ids=[e["id"]], key=e["id"])

    # R5 代表交代
    r = rule_map.get("R5-new-ceo")
    if r:
        for e in events:
            if e["type"] != "new_ceo":
                continue
            ts = [t for t in by_person.get(e.get("person_id"), []) if t["scope"] == "own" and (t["from"] or "") < e["date"]]
            names = [u["name"] for t in ts for u in t.get("units_detail") or []]
            counts = {}
            for n in names:
                for o, rx in ORIGIN:
                    if rx.search(n):
                        counts[o] = counts.get(o, 0) + 1
                        break
            origin = max(counts, key=counts.get) if counts else "不明"
            prev_unit = next((n for n in reversed(names) if any(rx.search(n) for o, rx in ORIGIN if o == origin)), names[-1] if names else "?")
            person = pmap[e["person_id"]]
            add(r, e["person_id"], fmt(r["title"], name=person["name"], **{"from": e["date"]}, prev_unit=prev_unit, origin=origin),
                fmt(r["interpretation"], origin=origin, prev_unit=prev_unit), fmt(r["verify_question"]), event_ids=[e["id"]],
                tenure_ids=[e["tenure_id"]] if e.get("tenure_id") else [], key=e["id"])

    # R6 任期・年齢
    r = rule_map.get("R6-term-age")
    if r:
        w = r["when"]
        rx = re.compile(w.get("rank_regex", "取締役"))
        for pid, ts in by_person.items():
            person = pmap[pid]
            age = age_at(person.get("born"), today)
            if age is None or age < w.get("min_age", 65) or person.get("term_years") != w.get("term_years", 1):
                continue
            cur = [t for t in ts if t["scope"] == "own" and not t.get("to") and rx.search(t.get("rank") or "") and "監査役" not in (t.get("rank") or "")]
            if not cur:
                continue
            add(r, pid, fmt(r["title"], name=person["name"], title=cur[-1]["title_raw"], age=age, term=person["term_years"]),
                fmt(r["interpretation"]), fmt(r["verify_question"]), tenure_ids=[cur[-1]["id"]], key=cur[-1]["id"])

    return out


def _fact_of(t):
    span = (t.get("from") or "?") + "〜" + (t.get("to") or "")
    st = {"planned": "(予定)", "inferred": "(推定)"}.get(t.get("status"), "")
    return f"{t.get('person_name', '')} {t.get('title_raw')} {span}{st}".strip()


def _fact_of_event(e, pmap):
    nm = pmap.get(e.get("person_id"), {}).get("name", "")
    return f"{e.get('date')} {nm} {e.get('type')}: {e.get('before') or ''} → {e.get('after') or ''}".strip()
