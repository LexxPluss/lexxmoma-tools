# -*- coding: utf-8 -*-
"""抽出結果(data/extracted/)を分類して事例レコードにする → data/classified/<id>.json。

- 語彙(taxonomy/*.yaml)との一致で、ワークのカテゴリ・材料・掴み方・作業・ロボット(メーカー/型式/区分)・可搬重量・業種・性質を付ける
- 一致した語と回数を fieldSources に残す(method: keyword)。一致が無い項目は空欄(推測で埋めない)
- タイトル・見出し・説明文の一致は本文の 3 倍の重み
- カテゴリと掴み方の両方が付かないページは「事例ではない」として落とす(data/rejected.json に理由を残す)
使い方: python classify.py [--ids ...] [--force]
"""
import argparse
import re

from common import DATA, TAXONOMY, RunLog, jdump, jload, nfkc, yload
from normalize import count_terms, norm_text, payload_class, weights_kg, workpiece_mass

IN = DATA / "extracted"
OUT = DATA / "classified"
TITLE_W = 3

INDUSTRIES = {
    "自動車": ["自動車", "車載", "automotive", "automobile", "car manufacturer", "vehicle", "OEM", "tier 1", "tier-1"],
    "食品・飲料": ["食品", "飲料", "製菓", "製パン", "food", "beverage", "bakery", "dairy", "meat", "snack", "brewery", "confectionery"],
    "物流・倉庫": ["物流", "倉庫", "配送", "通販", "logistics", "warehouse", "distribution center", "distribution centre", "fulfillment", "fulfilment", "3PL", "e-commerce", "parcel"],
    "電機・電子": ["電機", "電子", "半導体", "electronics", "semiconductor", "electrical", "consumer electronics"],
    "機械・金属加工": ["機械加工", "金属加工", "部品加工", "切削", "鋳造", "鍛造", "板金", "machine shop", "machining", "metalworking", "metal fabrication", "foundry", "job shop", "contract manufacturer", "precision parts", "CNC"],
    "樹脂・ゴム": ["樹脂", "プラスチック", "射出成形", "ゴム", "plastics", "injection molding", "injection moulding", "rubber", "polymer"],
    "医薬・医療・化粧品": ["医薬", "製薬", "医療", "化粧品", "pharma", "pharmaceutical", "medical", "healthcare", "cosmetics", "laboratory", "life science"],
    "化学・素材": ["化学", "素材", "chemical", "chemicals", "materials", "cement", "paint", "coatings"],
    "建材・木工・家具": ["建材", "木工", "家具", "住宅", "furniture", "woodworking", "construction material", "building products", "timber", "lumber"],
    "農業": ["農業", "農場", "農園", "agriculture", "farm", "greenhouse", "horticulture"],
    "航空・宇宙": ["航空", "宇宙", "aerospace", "aircraft", "aviation"],
    "教育・研究": ["大学", "研究所", "教育", "university", "research", "institute", "laboratory", "education"],
    "日用品・パッケージ": ["日用品", "包装資材", "製紙", "packaging", "paper", "printing", "household", "consumer goods", "FMCG"],
}
PRESENTATION = {
    "整列": ["整列", "トレイに整列", "aligned", "in trays", "tray", "fixture", "magazine", "pallet jig"],
    "ばら積み": ["ばら積み", "バラ積み", "山積み", "bin picking", "random bin", "bulk", "randomly oriented", "unstructured"],
    "箱入り": ["箱入り", "箱から", "in boxes", "from boxes", "in a box", "in cartons"],
    "袋入り": ["袋入り", "袋詰め", "bagged", "in bags", "pouches"],
    "パレット積み": ["パレット", "pallet", "palletized", "palletised"],
    "コンベヤ上": ["コンベヤ", "コンベア", "ベルト", "conveyor", "belt", "moving line", "inline"],
    "棚": ["棚", "ラック", "shelf", "shelves", "rack", "racks", "storage"],
    "工作機内": ["工作機械内", "チャック", "工作機", "chuck", "machine chuck", "inside the machine", "CNC"],
}
SENSORS = {"力覚": ["力覚", "力センサ", "force sensor", "force/torque", "force-torque", "F/T sensor", "HEX-E", "force control"],
           "カメラ": ["カメラ", "画像認識", "ビジョン", "3Dビジョン", "camera", "vision", "3D vision", "2D vision", "machine vision", "Eye", "vision system"],
           "近接": ["近接センサ", "proximity sensor", "proximity"],
           "真空圧": ["真空圧", "真空センサ", "vacuum sensor", "vacuum switch", "pressure sensor"]}
DRIVE = {"電動": ["電動", "サーボ", "electric", "servo", "electrically"], "空圧": ["空圧", "エア", "pneumatic", "compressed air", "air-driven"],
         "真空": ["真空", "吸着", "vacuum", "suction"], "磁力": ["磁", "magnet"], "油圧": ["油圧", "hydraulic"]}
CUSTOM = ["カスタム", "特注", "自社製", "専用ハンド", "自作", "custom gripper", "custom-made", "custom end effector", "custom-designed", "custom designed", "custom end-of-arm", "bespoke", "in-house", "in house", "3D printed", "3D-printed", "designed their own", "designed its own", "developed its own", "developed their own", "custom tooling"]


class Taxonomy:
    def __init__(self):
        self.categories = yload(TAXONOMY / "categories.yaml")["groups"]
        self.materials = yload(TAXONOMY / "materials.yaml")["materials"]
        self.principles = yload(TAXONOMY / "principles.yaml")["groups"]
        self.tasks = yload(TAXONOMY / "tasks.yaml")["tasks"]
        self.robots = yload(TAXONOMY / "robot_models.yaml")
        self.synonyms = yload(TAXONOMY / "synonyms.yaml")["synonyms"]
        self.cat_items = [(g["key"], it) for g in self.categories for it in g["items"]]
        self.pr_items = [(g["key"], it) for g in self.principles for it in g["items"]]
        self.cat_label = {it["key"]: it["label"] for _, it in self.cat_items}
        self.cat_group = {it["key"]: g for g, it in self.cat_items}
        self.pr_label = {it["key"]: it["label"] for _, it in self.pr_items}
        self.pr_group = {it["key"]: g for g, it in self.pr_items}
        self.mat_label = {m["key"]: m["label"] for m in self.materials}
        self.task_label = {t["key"]: t["label"] for t in self.tasks}
        self.group_label = {g["key"]: g["label"] for g in self.categories}
        self.pgroup_label = {g["key"]: g["label"] for g in self.principles}
        # 同義語を語彙に足す(canonical: category:key など)
        extra = {}
        for s in self.synonyms:
            kind, key = s["canonical"].split(":", 1)
            extra.setdefault((kind, key), []).extend(s["terms"])
        for _, it in self.cat_items:
            it["terms"] = list(dict.fromkeys(it["terms"] + extra.get(("category", it["key"]), [])))
        for m in self.materials:
            m["terms"] = list(dict.fromkeys(m["terms"] + extra.get(("material", m["key"]), [])))
        for _, it in self.pr_items:
            it["terms"] = list(dict.fromkeys(it["terms"] + extra.get(("principle", it["key"]), [])))
        for t in self.tasks:
            t["terms"] = list(dict.fromkeys(t["terms"] + extra.get(("task", t["key"]), [])))
        self.properties = {k: v for (kind, k), v in extra.items() if kind == "property"}
        # ロボット型式: パターンの長い順
        self.models = []
        for mk in self.robots["makers"]:
            for m in mk.get("models", []):
                self.models.append({"maker": mk["name"], "model": m["model"], "re": re.compile(m["pattern"], re.I),
                                    "class": m.get("class") or mk.get("class"), "payload": m.get("payload"), "mobile": m.get("mobile", False),
                                    "plen": len(m["pattern"])})
        self.models.sort(key=lambda m: -m["plen"])
        self.makers = [(mk["name"], mk.get("aliases", [mk["name"]]), mk.get("class")) for mk in self.robots["makers"]]
        # ハンド製品の型式 → メーカー・掴み方・可搬(taxonomy/ee_products.yaml)。長い pattern を先に
        self.products = [dict(p, re=re.compile(p["pattern"], re.I)) for p in yload(TAXONOMY / "ee_products.yaml")["products"]]
        self.products.sort(key=lambda p: -len(p["pattern"]))

    def payload_of(self, maker, model):
        for m in self.models:
            if m["maker"] == maker and m["model"] == model:
                return m["payload"]
        return None


# 「汎用語」: 単独では弱い証拠(製品ページの定型文で頻出)。タイトル以外では半分に数える
WEAK = {"gripper", "grippers", "fingers", "hand", "vacuum", "suction", "metal", "plastic", "items", "box", "boxes", "case", "cases", "parts", "part", "把持", "吸着", "樹脂", "金属", "ハンド", "容器", "部品", "製品", "ワーク", "transfer", "loading", "unloading", "tending", "stacking", "sheet", "block", "plates", "plate", "seal", "seals", "wire", "wires", "tube", "tubes", "cup", "cups", "bag", "bags", "sack", "tray", "trays", "bin", "bins", "film", "foil", "label", "labels", "paper", "board", "panel", "panels", "glass", "wood", "stone", "foam", "chip", "chips", "item", "order", "shelf", "cart", "mobile", "cylinder", "blank", "blanks", "fillet", "egg", "eggs", "can", "cans", "tin", "tins", "jar", "jars", "tub", "tubs"}


def scored(text_t, text_b, items, key_of, terms_of, keep=3, min_score=2):
    """タイトル側(×3)と本文側の語の一致を合計し、上位 keep 件を返す [(key, score, evidence)]。"""
    res = []
    for it in items:
        key, terms = key_of(it), terms_of(it)
        ct, cb = count_terms(text_t, terms), count_terms(text_b, terms)
        sc = 0.0
        for t, n in ct.items():
            sc += TITLE_W * n * (0.5 if t.lower() in WEAK else 1)
        for t, n in cb.items():
            sc += min(n, 6) * (0.25 if t.lower() in WEAK else 1)
        if sc >= min_score:
            ev = sorted(set(ct) | set(cb), key=lambda t: -(ct.get(t, 0) * TITLE_W + cb.get(t, 0)))[:5]
            res.append((key, round(sc, 2), ev))
    res.sort(key=lambda r: -r[1])
    return res[:keep]


def strip_boilerplate(recs):
    """同じ取得元の多くのページに同じ段落が出るなら定型文(ナビ・用途一覧・フッタ)として本文から除く。
    見出し・画像の alt も同様。返り値は {id: (text, headings, alts)}。"""
    by_src = {}
    for r in recs:
        by_src.setdefault((r.get("sources") or ["?"])[0], []).append(r)
    out = {}
    for key, rs in by_src.items():
        df = {}
        for r in rs:
            seen = set(l.strip() for l in (r.get("text") or "").split("\n") if l.strip())
            seen |= set(h for h in (r.get("headings") or []))
            seen |= set((i.get("alt") or "") for i in r.get("images", []) if i.get("alt"))
            for l in seen:
                df[l] = df.get(l, 0) + 1
        n = len(rs)
        boiler = {l for l, c in df.items() if n >= 3 and c >= 3 and c / n >= 0.4}
        for r in rs:
            text = "\n".join(l for l in (r.get("text") or "").split("\n") if l.strip() and l.strip() not in boiler)
            heads = [h for h in (r.get("headings") or []) if h not in boiler]
            alts = [i.get("alt") or "" for i in r.get("images", []) if i.get("in_main") and (i.get("alt") or "") not in boiler][:4]
            out[r["id"]] = (text, heads, alts)
    return out


def classify_one(rec, tx, cleaned=None):
    text, heads, alts = cleaned or (rec.get("text") or "", rec.get("headings") or [], [i.get("alt") or "" for i in rec.get("images", []) if i.get("in_main")][:4])
    rec = dict(rec, text=text, headings=heads)
    title_side = norm_text(" ".join([rec.get("title") or "", rec.get("description") or ""] + heads + alts))
    body = norm_text(rec.get("text") or "")
    src_idx = 0   # sources[0] = 事例ページ
    fs = {}

    def src(method, evidence):
        return {"source": src_idx, "method": method, "evidence": evidence}

    cats = scored(title_side, body, tx.cat_items, lambda it: it[1]["key"], lambda it: it[1]["terms"], keep=4, min_score=2)
    cats = [c for c in cats if c[0] != "generic"]
    # 本文だけの弱い一致(語 1 つが 2〜3 回)はワークとして付けない: 見出し側に語があるか、本文で 2 つ以上の異なる語が出ているときだけ
    cat_terms = {it["key"]: it["terms"] for _, it in tx.cat_items}
    # (ループ 6 から: 規則は候補を広く集める役。精度は LLM レビュー(llm_prep / llm_merge)で担保するので、ここでは見出しか 2 語以上か 3 点以上)
    cats = [c for c in cats if count_terms(title_side, cat_terms[c[0]]) or len(c[2]) >= 2 or c[1] >= 3][:3]
    prs = scored(title_side, body, tx.pr_items, lambda it: it[1]["key"], lambda it: it[1]["terms"], keep=4, min_score=2)
    # 作業ツール(溶接トーチ・研磨・塗布…)は、用途一覧の本文に出るだけでは付けない(見出し・説明に語があるときだけ)
    pr_terms = {it["key"]: it["terms"] for _, it in tx.pr_items}
    prs = [p for p in prs if tx.pr_group[p[0]] != "process" or count_terms(title_side, pr_terms[p[0]])]
    # 掴み方も同じ: 見出し側に語があるか、本文で 2 つ以上の異なる語(または 1 語でも 4 回以上)
    prs = [p for p in prs if count_terms(title_side, pr_terms[p[0]]) or len(p[2]) >= 2 or p[1] >= 3][:3]
    tasks = scored(title_side, body, tx.tasks, lambda t: t["key"], lambda t: t["terms"], keep=3, min_score=2)
    mats = scored(title_side, body, tx.materials, lambda m: m["key"], lambda m: m["terms"], keep=3, min_score=2)
    # 食品カテゴリなら材料は食品、段ボールなら紙 のような整合
    cat_keys = [c[0] for c in cats]
    if any(tx.cat_group[k] == "food" for k in cat_keys) and "food" not in [m[0] for m in mats]:
        mats.insert(0, ("food", 2, ["(食品カテゴリから)"]))
    if "carton" in cat_keys and "paper" not in [m[0] for m in mats]:
        mats.insert(0, ("paper", 2, ["(段ボールカテゴリから)"]))

    # ロボット
    full = title_side + " " + body
    raw_full = nfkc((rec.get("title") or "") + " " + (rec.get("description") or "") + " " + (rec.get("text") or ""))
    robot = {"class": None, "is_mobile_manipulator": False, "form": None, "maker": None, "model": None, "payload_kg": None}
    for m in tx.models:
        mm = m["re"].search(raw_full)
        if mm:
            robot.update({"maker": m["maker"], "model": m["model"], "class": m["class"], "payload_kg": m["payload"]})
            fs["robot.model"] = src("pattern", [mm.group(0)])
            if m["mobile"]:
                robot["is_mobile_manipulator"] = True
            break
    if not robot["maker"]:
        for name, aliases, cls in tx.makers:
            hit = count_terms(full, aliases)
            if hit:
                robot["maker"] = name
                fs["robot.maker"] = src("keyword", list(hit)[:3])
                if cls:  # メーカー全体が協働専業(UR・Doosan など)なら区分だけ付ける
                    robot["class"] = cls
                break
    if not robot["class"]:
        for cls, terms in tx.robots["class_terms"].items():
            hit = count_terms(full, terms)
            if hit:
                robot["class"] = cls
                fs["robot.class"] = src("keyword", list(hit)[:3])
                break
    elif "robot.class" not in fs:
        fs["robot.class"] = fs.get("robot.model") or fs.get("robot.maker")
    mob = count_terms(full, tx.robots["mobile_terms"])
    if mob:
        robot["is_mobile_manipulator"] = True
        fs["robot.is_mobile_manipulator"] = src("keyword", list(mob)[:3])
    for form, terms in {"スカラ": ["スカラ", "SCARA", "scara"], "パラレル": ["パラレルリンク", "デルタロボット", "delta robot", "parallel robot", "FlexPicker"],
                        "直交": ["直交ロボット", "ガントリー", "gantry", "cartesian robot", "linear robot"], "双腕": ["双腕", "dual-arm", "dual arm", "two-armed", "YuMi", "duAro"]}.items():
        if count_terms(full, terms):
            robot["form"] = form
            break
    if robot["maker"] and not robot["form"]:
        robot["form"] = "垂直多関節"

    ee_maker, ee_model, ee_payload = None, None, None
    # ハンドの製品型式(ee_products.yaml): 本文に出れば メーカー・型式・掴み方・可搬 の根拠になる
    prod = None
    for p in tx.products:
        mm = p["re"].search(raw_full)
        if mm:
            prod = p
            ee_maker, ee_model, ee_payload = p["maker"], p["model"], p.get("payload")
            fs["end_effector.model"] = src("pattern", [mm.group(0)])
            if p["principle"] not in [k for k, _, _ in prs]:
                prs.insert(0, (p["principle"], 6.0, [mm.group(0)]))
            elif prs and prs[0][0] != p["principle"]:
                prs.sort(key=lambda x: x[0] != p["principle"])   # 製品が示す掴み方を先頭に
            break
    if not ee_maker:
        EE_MAKERS = {"robotiq": "Robotiq", "onrobot": "OnRobot", "schunk": "SCHUNK", "schmalz": "Schmalz", "piab": "Piab", "zimmer": "Zimmer Group", "weiss": "Weiss Robotics", "softgripping": "SoftGripping"}
        for k, name in EE_MAKERS.items():
            if k in rec.get("sources", []) or count_terms(full, [name]):
                ee_maker = name
                break

    # 重量: ワークの重さ(文脈付き)→ 無ければロボットの可搬
    mass = workpiece_mass(rec.get("text") or "")
    if mass:
        fs["workpiece.mass_kg"] = src("regex", [f"{mass['min']}–{mass['max']} kg"])
    pl = None
    if mass:
        pl = payload_class(mass["max"])
        fs["payload_class"] = src("derived", ["ワークの重さから"])
    elif robot["payload_kg"]:
        pl = payload_class(robot["payload_kg"])
        fs["payload_class"] = src("derived", [f"ロボットの可搬 {robot['payload_kg']} kg から"])
    elif ee_payload:
        pl = payload_class(ee_payload)
        fs["payload_class"] = src("derived", [f"ハンド {ee_model} の可搬 {ee_payload} kg から"])
    else:
        pl = "不明"

    # 業種・性質・置かれ方・センサ・駆動・カスタム
    inds = [(k, count_terms(full, v)) for k, v in INDUSTRIES.items()]
    inds = sorted([(k, sum(h.values()), list(h)[:3]) for k, h in inds if h], key=lambda x: -x[1])[:2]
    props = [(k, list(h)[:3]) for k, v in tx.properties.items() if (h := count_terms(full, v))]
    pres = sorted([(k, sum(h.values()), list(h)[:3]) for k, v in PRESENTATION.items() if (h := count_terms(full, v))], key=lambda x: -x[1])[:1]
    sens = [(k, list(h)[:3]) for k, v in SENSORS.items() if (h := count_terms(full, v))]
    drives = sorted([(k, sum(h.values())) for k, v in DRIVE.items() if (h := count_terms(full, v))], key=lambda x: -x[1])
    custom_hit = count_terms(full, CUSTOM)

    case_type = rec.get("case_type") or "sier_case"
    if custom_hit and case_type != "research":
        case_type = "user_custom"
    if rec.get("source_type") == "custom":
        case_type = "user_custom"

    # 掴み方の種類が書かれていない(「ロボットハンド」「把持」とだけある)事例: 「記載なし(写真で確認)」として残す。種類が分かるものが 1 つでもあれば使わない
    prs = [p for p in prs if p[0] != "hand_unspecified"] or [p for p in prs if p[0] == "hand_unspecified"]
    # 事例ではない(カテゴリも掴み方も付かない)ページは落とす。本文だけの弱い一致しか無いページ(業界紹介・会社案内)も落とす
    if not cats or not prs:
        return None, f"カテゴリ {len(cats)} / 掴み方 {len(prs)} が付かない"
    strong_cat = bool(count_terms(title_side, [t for _, it in tx.cat_items for t in it["terms"]]))
    strong_pr = bool(count_terms(title_side, [t for _, it in tx.pr_items for t in it["terms"]]))
    total = cats[0][1] + prs[0][1]
    need = 4 if (strong_cat or strong_pr) else 8
    if total < need:
        return None, f"一致が弱い(カテゴリ {cats[0][1]} + 掴み方 {prs[0][1]} < {need}、見出しの語: ワーク {strong_cat} / 掴み方 {strong_pr})"

    cat_keys = [c[0] for c in cats]
    prs.sort(key=lambda p: tx.pr_group[p[0]] in ("process", "unknown"))   # 作業ツール・記載なし は掴み方の後ろに
    pr_keys = [p[0] for p in prs]
    fs["workpiece.categories"] = src("keyword", [f"{tx.cat_label[k]}: {', '.join(e)}" for k, s, e in cats])
    fs["end_effector.principles"] = src("keyword", [f"{tx.pr_label[k]}: {', '.join(e)}" for k, s, e in prs])
    if tasks:
        fs["tasks"] = src("keyword", [f"{tx.task_label[k]}: {', '.join(e)}" for k, s, e in tasks])
    if mats:
        fs["workpiece.materials"] = src("keyword", [f"{tx.mat_label[k]}: {', '.join(e)}" for k, s, e in mats])
    if inds:
        fs["industry"] = src("keyword", [f"{k}: {', '.join(e)}" for k, s, e in inds])
    if props:
        fs["workpiece.properties"] = src("keyword", [f"{k}: {', '.join(e)}" for k, e in props])
    if pres:
        fs["workpiece.presentation"] = src("keyword", [f"{k}: {', '.join(e)}" for k, s, e in pres])
    if sens:
        fs["end_effector.sensors"] = src("keyword", [f"{k}: {', '.join(e)}" for k, e in sens])
    if ee_maker:
        fs["end_effector.maker"] = src("keyword", [ee_maker])
    if ee_model and "end_effector.model" not in fs:
        fs["end_effector.model"] = src("keyword", [ee_model])
    if custom_hit:
        fs["end_effector.is_custom"] = src("keyword", list(custom_hit)[:3])
    for k in ("title_orig", "summary_ja", "year", "video_url", "region", "country", "case_type"):
        fs[k] = src("page", [])

    # 信頼度: 一致の強さ
    def conf(lst):
        if not lst:
            return 0.0
        top = lst[0][1]
        return round(min(1.0, 0.4 + top / 10), 2)

    region = rec.get("region")
    rec_out = {
        "id": rec["id"],
        "title_orig": rec.get("title") or rec.get("page_title"),
        "title_ja": None,          # build.py で summary と一緒に組み立てる
        "summary_ja": None,
        "case_type": case_type,
        "workpiece": {"categories": cat_keys, "name": None, "materials": [m[0] for m in mats], "mass_kg": mass, "size_mm": None,
                      "shapes": [], "surfaces": [], "properties": [p[0] for p in props], "presentation": pres[0][0] if pres else None},
        "tasks": [t[0] for t in tasks],
        "end_effector": {"principles": pr_keys, "subtype": tx.pr_label[pr_keys[0]], "fingers": None,
                         "drive": drives[0][0] if drives else None, "maker": ee_maker, "model": ee_model,
                         "is_custom": bool(custom_hit), "tool_changer": "tool_changer" in pr_keys, "multi_tool": "multi_tool" in pr_keys,
                         "sensors": [s[0] for s in sens], "design_notes": None},
        "robot": robot,
        "payload_class": pl,
        "industry": [i[0] for i in inds],
        "integrator": {"name": None, "country": None, "sier_db_id": None},
        "end_user": None,
        "country": rec.get("country"), "region": region, "year": rec.get("year"),
        "images": [],   # images.py が入れる
        "image_candidates": rec.get("images", []),
        "video_url": (rec.get("videos") or [None])[0],
        "sources": [{"url": rec["url"], "title": rec.get("page_title") or rec.get("title"), "publisher": rec.get("publisher"),
                     "type": rec.get("source_type"), "retrieved_at": rec.get("retrieved_at"), "lang": rec.get("lang")}],
        "fieldSources": fs,
        "interpretation": {"lexxmoma_fit": None},   # build.py で付ける(推測と明記)
        "quality": {"confidence": {"category": conf(cats), "principle": conf(prs), "robot_class": 0.9 if fs.get("robot.model") else (0.6 if robot["class"] else 0.0)},
                    "needs_review": conf(cats) < 0.7 or conf(prs) < 0.7, "scores": {"categories": cats, "principles": prs, "tasks": tasks, "materials": mats}},
        "_text_head": (rec.get("text") or "")[:600],
    }
    return rec_out, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", nargs="*")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    tx = Taxonomy()
    log = RunLog("classify")
    OUT.mkdir(parents=True, exist_ok=True)
    rejected = jload(DATA / "rejected.json", {})
    n = 0
    recs = [jload(p) for p in sorted(IN.glob("*.json"))]
    cleaned = strip_boilerplate(recs)
    for rec in recs:
        if a.ids and rec["id"] not in a.ids:
            continue
        op = OUT / f"{rec['id']}.json"
        if op.exists() and not a.force and rec["id"] not in rejected:
            continue
        out, why = classify_one(rec, tx, cleaned.get(rec["id"]))
        if out is None:
            rejected[rec["id"]] = {"url": rec["url"], "why": why}
            if op.exists():
                op.unlink()
            continue
        rejected.pop(rec["id"], None)
        jdump(out, op)
        n += 1
        log.ok(rec["url"], f"{out['workpiece']['categories']} / {out['end_effector']['principles']} / {out['robot']['class']}")
    jdump(rejected, DATA / "rejected.json")
    print(f"分類 {n} 件 / 事例でない {len(rejected)} 件 → {OUT.relative_to(DATA.parent)}")
    log.save()


if __name__ == "__main__":
    main()
