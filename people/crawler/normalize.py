# -*- coding: utf-8 -*-
"""役職文字列の分解と組織ユニットの抽出(SPEC §4 normalize / §5.3 / §5.4)。

title_raw 例: 「取締役開発本部長兼原価管理部長」
  → rank「取締役」, units [開発本部(本部長・責任者), 原価管理部(部長・責任者)], is_concurrent True
「常務執行役員 営業本部長 兼 第二営業部長」「監査役(常勤)」「取締役(社外)」「ニートン・オート・プロダクツ取締役社長」(子会社) も扱う。
"""
import re

from common import nfkc, stable_id

# 役位(長いものから照合する)
RANKS = [
    "代表取締役会長兼社長", "代表取締役社長兼CEO", "代表取締役会長", "代表取締役社長", "代表取締役副社長", "代表取締役副会長", "代表取締役専務", "代表取締役常務", "代表取締役",
    "取締役会長", "取締役副会長", "取締役社長", "取締役副社長", "取締役専務執行役員", "取締役常務執行役員", "取締役執行役員",
    "専務取締役", "常務取締役", "取締役相談役", "取締役",
    "常勤監査役", "非常勤監査役", "監査役",
    "専務執行役員", "常務執行役員", "上席執行役員", "上級執行役員", "執行役員",
    "名誉会長", "相談役", "顧問", "会長", "社長", "副社長",
]
RANK_LEVEL = {  # 大きいほど上位。R1「本部長以上」、R4「取締役以上」の判定に使う
    "代表取締役": 90, "取締役": 70, "監査役": 60, "執行役員": 50, "相談役": 40, "顧問": 40, "会長": 80, "社長": 85, "副社長": 75, "名誉会長": 40,
}
OFFICER_RANKS = ("代表取締役", "取締役", "監査役")   # 「役員」= 取締役・監査役
_RANK_RE = re.compile("^(" + "|".join(re.escape(r) for r in RANKS) + ")")

# 子会社・他社の役職(社名の後ろに付く)
SUB_ROLE_RE = re.compile(r"(代表取締役社長|取締役会長|取締役社長|取締役副社長|代表取締役|常勤監査役|取締役|監査役|董事長|董事|総経理|副総経理|社長|副社長|会長|President|CEO)$")
EXTERNAL_RE = re.compile(r"株式会社|\(株\)|㈱|銀行|事務所|法人|大学|省|庁|同社|同行|合同会社|有限会社(?!公司)")
# 責任者(〜長)。ユニット名は接尾辞(本部・部・室・工場…)ごと保持する
HEAD_RE = re.compile(r"^(.+?)(本部|事業本部|事業部門|事業部|統括部|部門|部|室|工場|製作所|センター|研究所|事業所|所|局|課|グループ|カンパニー|支社|支店)(長)$")
SUB_ROLE_IN_UNIT_RE = re.compile(r"^(.+?(?:本部|事業部|部|室|工場|センター|課))(付部長|担当部長|副本部長|副部長|副工場長|部長代理|課長代理|次長|課長|係長|主任|主査|付)$")
# 担当役員(「国際アグロ事業部担当」「生産技術統括」「王子エンジニアリング管掌」): その領域の責任者として扱う
OVERSEE_RE = re.compile(r"^(.+?)(担当|管掌|分掌|統括|所管)$")
UNIT_KIND_RE = [("本部", re.compile(r"(本部|部門|カンパニー)$")), ("工場", re.compile(r"(工場|製作所|事業所)$")), ("室", re.compile(r"室$")), ("部", re.compile(r"(部|事業部|統括部|センター|研究所|課)$")),
                ("統括", re.compile(r"(統括|担当)$"))]
_PAREN = re.compile(r"[（(〈【]([^）)〉】]*)[）)〉】]")
_PAREN_ROLE = re.compile(r"^(現任|現在|新任|再任|重任|予定|社外|常勤|非常勤|社外取締役|社外監査役|独立役員|独立)$")


def rank_level(rank):
    if not rank:
        return 0
    for k, v in sorted(RANK_LEVEL.items(), key=lambda kv: -len(kv[0])):
        if k in rank:
            return v
    return 0


def rank_core(rank):
    """常勤・非常勤・社外を除いた役位(比較用)。"""
    return re.sub(r"^(非常勤|常勤|社外)+", "", rank or "")


def is_officer_rank(rank):
    return any(k in (rank or "") for k in OFFICER_RANKS)


def clean_title(title_raw):
    """空白・「(現任)」・「当社」を除き、「監査役(常勤)」→「常勤監査役」、「取締役(社外)」→「取締役」にした比較・表示用の役職文字列。
    戻り値: (文字列, is_outside)。"""
    s = nfkc(title_raw)
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"^当社", "", s)
    outside, fulltime = "社外" in s, False
    def _p(m):
        nonlocal fulltime
        inner = m.group(1).strip()
        if _PAREN_ROLE.match(inner):
            if inner == "常勤":
                fulltime = True
            return ""
        return m.group(0)
    # 「取締役社長(代表取締役)」→「代表取締役社長」(役位だけの括弧は役位に畳み込む)
    rep_m = re.search(r"[（(]?(代表取締役|代表執行役)[）)]?", s[2:]) if not s.startswith("代表") else None
    if rep_m and re.match(r"^(取締役)?(社長|会長|副社長|副会長|専務|常務)?$", s[:rep_m.start() + 2].replace("(", "").replace("（", "")):
        s = s[:rep_m.start() + 2] + s[rep_m.end() + 2:]
        s = s.replace("(", "").replace("（", "").replace(")", "").replace("）", "") if not re.search(r"[（(].*[）)]", s) else s
        m2 = re.match(r"^(取締役)?(社長|会長|副社長|副会長)", s)
        s = ("代表取締役" + s[len(m2.group(1) or ""):]) if m2 else ("代表" + s if s.startswith("取締役") else s)
    s = re.sub(r"[（(](" + "|".join(re.escape(r) for r in RANKS) + r")[）)]", "", s)
    s = _PAREN.sub(_p, s)
    s = s.replace("社外", "")
    if fulltime and s.startswith("監査役"):
        s = "常勤" + s
    return s, outside


def split_concurrent(s):
    """兼務の区切り: 「兼」「、」「・」(役位の後ろの担当の並び)。括弧の中は区切らない。"""
    out, depth, cur = [], 0, ""
    for ch in s:
        depth += ch in "(（〈【"
        depth -= ch in ")）〉】"
        if depth <= 0 and ch in "兼、,":
            if cur:
                out.append(cur)
            cur = ""
            depth = 0
        else:
            cur += ch
    if cur:
        out.append(cur)
    return out


def unit_kind(name):
    for kind, rx in UNIT_KIND_RE:
        if rx.search(name):
            return kind
    return "その他"


def _unit_from_part(p):
    """役位を除いた 1 区分 → unit dict(無ければ None)。"""
    m = SUB_ROLE_IN_UNIT_RE.match(p)
    if m:
        return {"name": m.group(1), "kind": unit_kind(m.group(1)), "role": m.group(2), "is_head": False}
    m = HEAD_RE.match(p)
    if m:
        name = m.group(1) + m.group(2)
        return {"name": name, "kind": unit_kind(name), "role": m.group(2) + "長", "is_head": True}
    m = OVERSEE_RE.match(p)
    if m and len(m.group(1)) >= 2 and not SUB_ROLE_RE.search(m.group(1)):
        name = m.group(1)
        kind = unit_kind(name)
        return {"name": name if kind != "その他" else p, "kind": kind if kind != "その他" else "統括", "role": m.group(2), "is_head": True}
    m = re.match(r"^(.+?)(統括|担当)$", p)
    if m and not SUB_ROLE_RE.search(p):
        return {"name": p, "kind": "統括", "role": m.group(2), "is_head": True}
    sm = SUB_ROLE_RE.search(p)
    if sm and sm.start() > 0:
        company = p[:sm.start()]
        kind = "他社" if EXTERNAL_RE.search(company) else "子会社"
        return {"name": company, "kind": kind, "role": sm.group(1), "is_head": bool(re.search(r"(社長|董事長|総経理|会長|President|CEO)", sm.group(1)))}
    return {"name": p, "kind": unit_kind(p), "role": "", "is_head": False}


def parse_title(title_raw, own_company=True):
    """役職文字列 → dict(rank, units[{name, kind, role, is_head}], is_concurrent, is_outside, subsidiary, title_norm)。

    own_company=False のときは「〇〇取締役社長」のような子会社・他社の役職として解釈する。
    """
    s, is_outside = clean_title(title_raw)
    out = {"rank": None, "units": [], "is_concurrent": False, "is_outside": is_outside, "subsidiary": None, "title_norm": s}
    if not own_company:
        u = _unit_from_part(s)
        if u["kind"] in ("子会社", "他社"):
            out["subsidiary"] = u["name"] if u["kind"] == "子会社" else None
            out["external"] = u["kind"] == "他社"
            out["rank"] = u["role"]
            out["units"] = [u]
        else:
            out["units"] = [{"name": s, "kind": "他社", "role": "", "is_head": False}]
            out["external"] = True
        return out
    parts = split_concurrent(s)
    out["is_concurrent"] = len(parts) > 1
    for i, p in enumerate(parts):
        m = _RANK_RE.match(p)
        if m:
            if i == 0:
                out["rank"] = m.group(1)
            p = p[m.end():]
        if not p:
            continue
        u = _unit_from_part(p)
        if u:
            out["units"].append(u)
    # 「生産技術、生産安全基盤センター、物流統括」: 末尾の担当・統括は、並んだ前の項目にもかかる
    us = out["units"]
    if len(us) >= 2 and us[-1]["role"] in ("担当", "管掌", "分掌", "統括", "所管"):
        for x in us[:-1]:
            if not x["is_head"] and not x["role"]:
                x["is_head"], x["role"] = True, us[-1]["role"]
                if x["kind"] == "その他":
                    x["kind"] = "統括"
    return out


def unit_id(company_id, name):
    return stable_id(company_id, "U", nfkc(name).replace(" ", ""))


def units_key(units):
    return tuple(sorted(u["name"] for u in units))
