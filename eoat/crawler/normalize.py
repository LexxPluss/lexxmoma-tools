# -*- coding: utf-8 -*-
"""正規化: 重量・単位・表記ゆれ・語の一致。分類(classify.py)と UI の自由入力の分解(ui.test.cjs で同じ規則を確かめる)で使う。"""
import re

from common import nfkc

# 重量の表記: 10 kg / 25kg / 20 lb / 500 g / 10キロ / 12.5 kgs / 20-kg
_W = re.compile(r"(?<![0-9.])(\d{1,4}(?:[.,]\d{1,2})?)\s*-?\s*(kgs?|kilograms?|キロ(?:グラム)?|kg|lbs?|pounds?|ポンド|g|grams?|グラム|t|tons?|トン)(?![a-z])", re.I)
_UNIT = {"kg": 1.0, "kgs": 1.0, "kilogram": 1.0, "kilograms": 1.0, "キロ": 1.0, "キログラム": 1.0,
         "lb": 0.4536, "lbs": 0.4536, "pound": 0.4536, "pounds": 0.4536, "ポンド": 0.4536,
         "g": 0.001, "gram": 0.001, "grams": 0.001, "グラム": 0.001, "t": 1000.0, "ton": 1000.0, "tons": 1000.0, "トン": 1000.0}


def weights_kg(text):
    """本文中の重量表記をすべて kg にして返す(出現順)。例: "25 kg sacks and 500 g bags" → [25.0, 0.5]"""
    out = []
    for m in _W.finditer(nfkc(text)):
        v = float(m.group(1).replace(",", "."))
        u = m.group(2).lower()
        f = _UNIT.get(u)
        if f is None:
            continue
        kg = round(v * f, 3)
        if 0 < kg < 5000:
            out.append(kg)
    return out


def payload_class(kg):
    """可搬重量帯(3-2 スキーマ)。"""
    if kg is None:
        return "不明"
    if kg <= 5:
        return "≤5kg"
    if kg <= 20:
        return "5–20kg"
    if kg <= 100:
        return "20–100kg"
    return ">100kg"


_PAYLOAD_CTX = re.compile(r"(重さ|重量|weigh(?:s|ing|t)?|up to|最大|までの|lift(?:s|ing)?|carr(?:y|ies|ying)|handle[sd]?|heavy)", re.I)
# ロボット・ハンドの仕様の数値(可搬・本体重量・把持力・リーチ)はワークの重さではない(ループ 9: LLM レビューで規則の重さの大半が可搬重量だった)
_NOT_WORKPIECE = re.compile(r"(payload|可搬|搬送重量|最大重量|本体重量|robot weight|把持力|grip(?:ping)? force|rated load|荷重|reach|リーチ|可搬質量|가반하중|负载|负荷)", re.I)


def workpiece_mass(text):
    """ワークの重さらしい重量(重さの文脈にあり、ロボットの可搬の文脈にない数値)を min/max で返す。無ければ None。"""
    t = nfkc(text)
    vals = []
    for m in _W.finditer(t):
        ctx = t[max(0, m.start() - 60): m.end() + 30]
        near = t[max(0, m.start() - 14): m.end() + 10]
        if _PAYLOAD_CTX.search(ctx) and not _NOT_WORKPIECE.search(near):
            v = float(m.group(1).replace(",", ".")) * _UNIT.get(m.group(2).lower(), 0)
            if 0 < v < 5000:
                vals.append(round(v, 3))
    if not vals:
        return None
    return {"min": min(vals), "max": max(vals)}


def norm_text(s):
    """一致用: NFKC → 小文字 → 連続空白を 1 つに。"""
    return re.sub(r"\s+", " ", nfkc(s).lower()).strip()


def is_ascii_term(term):
    return all(ord(c) < 128 for c in term)


def term_regex(term):
    """語の正規表現: 英数字の語は単語境界、日本語は部分一致。"""
    t = re.escape(norm_text(term))
    if is_ascii_term(term):
        return re.compile(r"(?<![a-z0-9])" + t + r"(?![a-z0-9])")
    return re.compile(t)


def count_terms(text_norm, terms):
    """語ごとの出現回数 {語: 回数}(0 回は入れない)。"""
    out = {}
    for t in terms:
        if not t:
            continue
        n = len(term_regex(t).findall(text_norm))
        if n:
            out[t] = n
    return out
