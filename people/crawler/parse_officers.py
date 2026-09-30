# -*- coding: utf-8 -*-
"""有価証券報告書「役員の状況」のパース(SPEC §3.1 / §11-2,3)。

入力: crawl_edinet.py が保存した officers JSON
      {"doc_id", "url", "edinet_code", "pages": [{"page", "text", "tables": [[cells...]]}]}
      (pdfplumber の extract_text / extract_tables の結果)
出力: {"as_of": 提出日, "agm_date": 総会日, "officers": [...], "executives": [...],
       "planned": {"officers": [...], "executives": [...]}}
  officer = {name, name_raw, born (YYYY-MM), title_raw, is_outside, term_years, career:[{date, text, own, current}], table: "a"|"b"}
「提出日現在(a)」と「株主総会後の予定(b)」の 2 表があれば両方返す。b は status=planned で保存する(§3.1)。

表の列はヘッダ行(役職名/地位・氏名・生年月日・略歴・任期・所有株式数)から決める。会社によって
略歴が「年月」と「内容」の 2 列に分かれる(トヨタ等)ので、その場合は行ごとに結合する。
出席状況などの別の表(ヘッダに生年月日・略歴が無い)は読まない。
"""
import re
import sys

from common import display_name, era_to_ad, jload, nfkc, normalize_name, parse_ym, parse_ymd

_CAREER_LINE = re.compile(r"^(\d{4}\s*年\s*\d{1,2}\s*月)\s*(.*)$")
_EXEC_LINE = re.compile(r"^(専務執行役員|常務執行役員|上席執行役員|上級執行役員|執行役員)\s+(.+?)\s+([^\s]{1,4}\s?[^\s]{1,4})$")
_NOTE_LINE = re.compile(r"^(?:[（(]注[）)])?\s*(\d+)[．.]\s*(.*)$")
_TERM_RE = re.compile(r"(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日開催.*?から\s*(\d+)\s*年間")
_NAME_OK = re.compile(r"^[一-龥々〆ヶぁ-んァ-ヶーA-Za-zÀ-ž・.\-\s-]{2,24}$")   # 外字(私用領域)・英字名の「M.」も可
_NAME_BAD = re.compile(r"(取締役|監査役|執行役|委員|氏名|生年月日|男性|女性|合計|計$|略歴|役職|法人|名称|事務所|長$|担当|本部|部$|室$)")
_EXT_RE = re.compile(r"^(株式会社|㈱|\(株\)|有限会社|[^\s]{1,30}?(株式会社|㈱|\(株\)|銀行|信託|証券|生命|保険|省|庁|大学|研究所|事務所|法人|公社|機構|協会|Inc|Ltd|Co\.|Corporation|Corp|GmbH|S\.A\.|AG|LLC)|弁護士|公認会計士|税理士)")
_SUB_TAIL = re.compile(r"(取締役社長|代表取締役|社長|President|CEO|会長|董事長|総経理|Managing Director)$")
_GENDER = re.compile(r"男性\s*\d+\s*名\s*[、,，]?\s*女性\s*\d+\s*名")
_CURRENT = re.compile(r"[（(]\s*現\s*任\s*[）)]|（現任$|\(現任$|[（(]?現在に至る[）)]?")


def _cell(c):
    return nfkc(c or "").replace("\n", "").strip()


def _header_map(row):
    """ヘッダ行 → 列番号の対応。役員の表でなければ None。"""
    h = [re.sub(r"\s+", "", _cell(c)) for c in row]
    m = {}
    for i, c in enumerate(h):
        if re.search(r"役職名|役名|地位|役位|役職", c) and "title" not in m:
            m["title"] = i
        elif re.search(r"氏名", c) and "name" not in m:
            m["name"] = i
        elif re.search(r"生年月", c) and "born" not in m:
            m["born"] = i
        elif re.search(r"略歴", c) and "career" not in m:
            m["career"] = i
            if i + 1 < len(h) and h[i + 1] == "":
                m["career_text"] = i + 1   # 年月と内容が別列
        elif re.search(r"任期", c) and "term" not in m:
            m["term"] = i
    if "name" in m and "career" in m:
        return m
    return None


def _own_prefix_re(own_names):
    alts = []
    for n in own_names or []:
        n = nfkc(n).strip()
        if not n:
            continue
        core = re.sub(r"株式会社|\(株\)|㈱|ホールディングス", "", n).strip()
        for v in {n, core, "株式会社" + core, core + "株式会社", core + "㈱", "㈱" + core, core + "(株)"}:
            if len(v) >= 2:
                alts.append(re.escape(v))
    alts.sort(key=len, reverse=True)
    # 社名の直後が役職・部署・入社などのときだけ「当社」とみなす(「資生堂ジャパン株式会社」のような子会社名は除く)
    look = r"(?=\s|$|入社|入行|取締役|執行役|監査役|社長|副社長|常務|専務|代表|会長|CEO|COO|CFO|[一-龥0-9A-Z]{1,8}(?:本部|部|室|工場|センター|課|統括|担当|グループ|事業)(?![^\s]*(?:公司|株式会社|Co|Inc|Ltd)))"
    return re.compile("^(当社|" + "|".join(a + look for a in alts) + ")") if alts else re.compile("^当社")


def _align_by_position(date_lines, text_lines):
    """年月列と内容列の行を縦位置で対応づける: 内容の各行を、その行より上(同じ高さを含む)で最も近い年月に付ける。"""
    dates = [(t, nfkc(x).strip()) for t, x in date_lines if _CAREER_LINE.match(nfkc(x).strip())]
    if not dates:
        return []
    out = [[d, ""] for _, d in dates]
    tops = [t for t, _ in dates]
    for t, x in text_lines:
        k = 0
        for j, dt in enumerate(tops):
            if dt <= t + 2.5:
                k = j
        out[k][1] += nfkc(x).strip()
    return [d + " " + x for d, x in out]


def parse_career(cell, text_cell=None, own_re=None, cell_lines=None, text_lines=None):
    """略歴セル → [{date, text, own, current}]。年月で始まらない行は前の行の続き。
    text_cell があれば(年月列と内容列が別)行ごとに結合する。行の縦位置(cell_lines/text_lines)があれば位置で対応づける。"""
    own_re = own_re or re.compile("^当社")
    lines = [era_to_ad(l).strip() for l in (cell or "").split("\n")]
    if cell_lines and text_lines:
        lines = _align_by_position([[t, era_to_ad(x)] for t, x in cell_lines], text_lines)
        text_cell = None
    if text_cell is not None:
        dates = [l for l in lines if l]
        texts = [nfkc(l).strip() for l in (text_cell or "").split("\n")]
        lines, ti = [], 0
        for d in dates:
            m = _CAREER_LINE.match(d)
            if m and ti < len(texts):
                lines.append(d + " " + texts[ti])
                ti += 1
            elif m:
                lines.append(d)
        # 内容側の行が多い(1 項目が複数行)場合はまとめて最後に付ける
        if ti < len(texts) and lines:
            lines[-1] += "".join(texts[ti:])
    items = []
    for l in lines:
        if not l:
            continue
        m = _CAREER_LINE.match(l)
        if m:
            items.append({"date": parse_ym(m.group(1)), "text": m.group(2).strip()})
        elif items:
            items[-1]["text"] += l
    prev_own = False
    for it in items:
        t = it["text"]
        it["current"] = bool(_CURRENT.search(t)) or t.endswith("現任）") or t.endswith("(現任)")
        t = _CURRENT.sub("", t).strip()
        m = own_re.match(t)
        if m:
            t = "当社" + t[m.end():].lstrip(" 　")
            it["own"] = True
        elif t.startswith("同社") and prev_own:
            t = "当社" + t[2:]
            it["own"] = True
        elif re.match(r"^同(?!社|行|所|事務所|大学|省|庁)", t) and prev_own:
            t = "当社" + t[1:]   # 「同取締役執行役員」(ミクニ等): 同 = 直前と同じ会社
            it["own"] = True
        else:
            it["own"] = False
        prev_own = it["own"]
        it["text"] = t
    # 社名を書かない略歴(東レ等:「入社」「エンジニアリング部門長」)は、「入社」から当社の文脈とみなし、
    # 他社名が出るまでの行を当社として扱う。子会社・海外法人の役職(「〇〇社長」)は当社にしない
    if items and not any(it["own"] for it in items):
        ctx = None
        for it in items:
            t = it["text"]
            if re.match(r"^(入社|入行|入所)", t):
                ctx = "own"
            elif _EXT_RE.match(t):
                ctx = "ext"
                continue
            elif re.match(r"^(同社|同行)", t):
                continue
            if ctx == "own":
                sub = _SUB_TAIL.search(t)
                if sub and not re.search(r"(本部|部門|部|室|工場|センター|事業|統括|担当)", t[:sub.start()]) and sub.start() > 0 and not re.match(r"^(取締役|代表|常務|専務|執行役員|社長|副社長|会長)", t):
                    continue   # 子会社のトップなど: 当社の在任にしない
                it["own"] = True
                it["text"] = "当社" + t
    return items


def parse_officers_json(doc, own_names=None):
    own_re = _own_prefix_re(own_names)
    pages = doc["pages"]
    as_of = None
    agm = None
    planned_from_page = None
    seen_table = False
    gender_heads = []
    for pg in pages:
        t = nfkc(pg["text"])
        if as_of is None:
            m = re.search(r"(\d{4}年\d{1,2}月\d{1,2}日)\s*[（(]有価証券報告書提出日[）)]\s*現在", t)
            if not m:
                m = re.search(r"(\d{4}年\d{1,2}月\d{1,2}日)\s*現在の(?:当社の)?役員の状況", t)
            if m:
                as_of = parse_ymd(m.group(1))
        # 株主総会後の予定表(b)の始まり: 2 つ目の「男性N名 女性M名」見出し(書き方の揺れに強い構造上の目印)
        for gm in _GENDER.finditer(t):
            gender_heads.append((pg["page"], gm.start()))
        if agm is None and seen_table:
            m = re.search(r"(\d{4}年\d{1,2}月\d{1,2}日)開催予定の[^\n]{0,20}株主総会[^\n]{0,80}(?:議案|承認|選任|決議)", t)
            if m:
                agm = parse_ymd(m.group(1))
        if any(_header_map(tb[0]) for tb in (pg.get("tables") or []) if tb):
            seen_table = True
    split_pos = None
    if len(gender_heads) >= 2:
        planned_from_page, split_pos = gender_heads[1]
        if agm is None:
            # 総会日が読めない: 提出日の翌月を予定日とする(予定表であることは確か)
            agm = as_of
    result = {"doc_id": doc.get("doc_id"), "url": doc.get("url"), "edinet_code": doc.get("edinet_code"), "as_of": as_of, "agm_date": agm,
              "officers": [], "executives": [], "planned": {"officers": [], "executives": []}, "notes": {"a": {}, "b": {}}, "warnings": []}
    colmap = None
    for pg in pages:
        page_text = nfkc(pg["text"])
        table = "b" if planned_from_page and pg["page"] >= planned_from_page else "a"   # 注記・執行役員の行(ページ単位)
        page_table = table
        tls = pg.get("tables_lines") or []
        for ti, tbl in enumerate(pg.get("tables") or []):
            if not tbl:
                continue
            table = "b" if planned_from_page and pg["page"] > planned_from_page else "a"
            if planned_from_page and pg["page"] == planned_from_page:
                # 切り替わるページ: 表の最初の氏名が 2 つ目の見出しより後ろにあれば b
                first = next((_cell(r[1]) for r in tbl[1:] if len(r) > 1 and _cell(r[1])), "")
                key = re.sub(r"\s+", "", first)[:3]
                pos = re.sub(r"\s+", "", page_text).find(key) if key else -1
                head_pos = len(re.sub(r"\s+", "", page_text[:split_pos]))
                table = "b" if pos >= head_pos else "a"
            lst = result["officers"] if table == "a" else result["planned"]["officers"]
            tl = tls[ti] if ti < len(tls) else None
            hm = _header_map(tbl[0])
            rows = tbl[1:] if hm else tbl
            if hm:
                colmap = hm
            elif not colmap or len(tbl[0]) < max(colmap.values()) + 1 or not any("年" in _cell(c) for c in tbl[0]):
                continue   # 役員の表ではない(出席状況など)
            cm = colmap
            if "title" not in cm:
                continue   # 役職の列が無い表 = 補欠監査役・補欠取締役の略歴(役員ではない)
            for ri, row in enumerate(rows):
                if len(row) <= max(cm.values()):
                    continue
                lrow = None
                if tl:
                    k = ri + (1 if hm else 0)
                    lrow = tl[k] if k < len(tl) else None
                cl = lrow[cm["career"]] if lrow and "career_text" in cm and cm["career"] < len(lrow) else None
                xl = lrow[cm["career_text"]] if lrow and "career_text" in cm and cm["career_text"] < len(lrow) else None
                title, name = _cell(row[cm.get("title", 0)]) if "title" in cm else "", _cell(row[cm["name"]])
                if title in ("計", "合計") or name in ("計", "合計"):
                    continue
                career_cell = row[cm["career"]]
                text_cell = row[cm["career_text"]] if "career_text" in cm else None
                if not name:
                    # 氏名が空: 前の人の続き(ページまたぎ)
                    if lst and career_cell:
                        lst[-1]["career"] += parse_career(career_cell, text_cell, own_re, cl, xl)
                    continue
                # 氏名欄に生年月日が入る書式(住友理工等:「清水 和志(1961年6月29日生)」)
                born_in_name = parse_ym(name) if re.search(r"\d{4}\s*年", name) else None
                if born_in_name:
                    name = re.sub(r"[（(]?\s*\d{4}\s*年[^）)]*生?\s*[）)]?", "", name).strip()
                name = re.sub(r"^[＊*※◎○●◇◆†‡]+\s*", "", name)   # 「＊今吉 琢也」: 執行役員兼務などの印
                nm = normalize_name(name)
                if not _NAME_OK.match(nm) or _NAME_BAD.search(nm) or re.search(r"\d", nm):
                    if career_cell and lst:
                        lst[-1]["career"] += parse_career(career_cell, text_cell, own_re, cl, xl)
                    else:
                        result["warnings"].append(f"氏名として読めない行を飛ばした: {name[:20]} ({table})")
                    continue
                born = parse_ym(_cell(row[cm["born"]])) if "born" in cm else born_in_name
                officer = {
                    "name": display_name(name), "name_key": nm, "name_raw": row[cm["name"]],
                    "born": born, "title_raw": title, "is_outside": "社外" in title or "社外" in name,
                    "term_note": _cell(row[cm["term"]]) if "term" in cm else "", "term_years": None,
                    "career": parse_career(career_cell, text_cell, own_re, cl, xl), "table": table,
                }
                if not officer["career"]:
                    result["warnings"].append(f"略歴を読めない: {officer['name']} ({table})")
                lst.append(officer)
        # 注記と執行役員(表の外の本文)
        table = page_table
        notes = result["notes"][table]
        for line in nfkc(pg["text"]).split("\n"):
            line = line.strip()
            m = _EXEC_LINE.match(line)
            if m:
                rank, a2, a3 = m.group(1), m.group(2), m.group(3)
                def _ok(x):
                    k = normalize_name(x)
                    return bool(_NAME_OK.match(k)) and not _NAME_BAD.search(k) and 2 <= len(k) <= 8
                unit, name = (a2, a3) if _ok(a3) and not _ok(a2) else (a3, a2) if _ok(a2) and not _ok(a3) else (None, None)
                if unit and (len(unit) > 40 or re.search(r"(、同|の他|名の|名で|構成|であります|です)", unit)):
                    unit, name = None, None   # 文章(「…佐々木啓吾、同山口登造の4名の他に…」)を役職と取り違えない
                if name:
                    (result["executives"] if table == "a" else result["planned"]["executives"]).append(
                        {"rank": rank, "title_raw": rank + unit, "unit_title": unit, "name": display_name(name),
                         "name_key": normalize_name(name), "table": table})
                continue
            m = _NOTE_LINE.match(line)
            if m and ("株主総会" in m.group(2) or "社外" in m.group(2) or "執行役員" in m.group(2)):
                notes[m.group(1)] = m.group(2)
    # 注記から任期(年)と社外区分を付ける
    for table, lst in (("a", result["officers"]), ("b", result["planned"]["officers"])):
        notes = result["notes"][table]
        outside_names = set()
        for txt in notes.values():
            if "社外取締役であります" in txt or "社外監査役であります" in txt:
                for o in lst:
                    if o["name_key"] in normalize_name(txt):
                        outside_names.add(o["name_key"])
        for o in lst:
            if o["name_key"] in outside_names:
                o["is_outside"] = True
            nm = re.search(r"[（(]注[）)]\s*(\d+)|[（(]注\s*(\d+)[）)]", o["term_note"])
            key = (nm.group(1) or nm.group(2)) if nm else None
            if key and key in notes:
                tm = _TERM_RE.search(notes[key])
                if tm:
                    o["term_years"] = int(tm.group(4))
                    o["term_from"] = f"{tm.group(1)}-{int(tm.group(2)):02d}-{int(tm.group(3)):02d}"
    return result


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: parse_officers.py <officers.json> [会社名...]")
    import json
    r = parse_officers_json(jload(sys.argv[1]), sys.argv[2:])
    print(json.dumps({k: v for k, v in r.items() if k != "notes"}, ensure_ascii=False, indent=1)[:6000])


if __name__ == "__main__":
    main()
