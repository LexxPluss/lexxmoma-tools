# -*- coding: utf-8 -*-
"""適時開示 PDF(「役員の異動に関するお知らせ」等)のパース(SPEC §3.2 / §11-4)。

pdfplumber で表を取り、「氏名／新役職名／現役職名」形式の行を items にする。
出力: {"doc_date", "effective", "title", "items": [{name, new_title, cur_title, section, kind}], "careers": {name: [...]}, "raw_text"}
  kind: appointed(新任) | resigned(退任) | changed(職務の異動) | roster(別紙の体制表)
表が 1 つも読めなければ items=[] と raw_text を返し、呼び出し側が手動確認キューに入れる(§3.2)。
"""
import re
import sys

from common import display_name, nfkc, normalize_name, parse_ym, parse_ymd
from parse_officers import parse_career

_HEAD_NAME = re.compile(r"氏\s*名")
_HEAD_NEW = re.compile(r"新\s*役\s*職")
_HEAD_CUR = re.compile(r"現\s*役\s*職")
_SAME = re.compile(r"^(同\s*左|─|―|-|—|なし|―)$")


def _c(x):
    return re.sub(r"\s+", " ", nfkc(x or "").replace("\n", " ")).strip()


def _section_of(text_before):
    """表の直前の見出しから区分を決める。"""
    t = nfkc(text_before)
    heads = re.findall(r"(?:^|\n)\s*(?:[（(]\s*\d+\s*[）)]|\d+\s*[．.])?\s*([^\n]{2,30}?(?:異動|新任|退任|体制|候補)[^\n]{0,20})", t)
    return heads[-1].strip() if heads else ""


def _kind(section, new_title, cur_title):
    if "退任" in section:
        return "resigned"
    if "新任" in section or "候補" in section:
        return "appointed"
    if "体制" in section:
        return "roster"
    if "異動" in section:
        return "changed"
    if new_title and not cur_title:
        return "appointed"
    if cur_title and not new_title:
        return "resigned"
    return "changed"


def parse_pdf(path):
    import pdfplumber
    texts, items, careers = [], [], {}
    with pdfplumber.open(path) as pdf:
        for pg in pdf.pages:
            text = pg.extract_text() or ""
            texts.append(text)
            tables = pg.extract_tables() or []
            # 表ごとに、その表の直前までの本文から見出しを推定する
            cursor = 0
            for tbl in tables:
                if not tbl or not tbl[0]:
                    continue
                head = [_c(c) for c in tbl[0]]
                # 略歴の表(新任社長の略歴)
                if any("略歴" in h for h in head):
                    for row in tbl[1:]:
                        cells = [_c(c) for c in row]
                        raw = row[0] or ""
                        nm = [l for l in nfkc(raw).split("\n") if l.strip() and not re.match(r"^[ぁ-んー\s]+$", l.strip()) and "生" not in l]
                        name = display_name(nm[0]) if nm else cells[0]
                        born = parse_ym(raw)
                        careers[normalize_name(name)] = {"name": name, "born": born, "career": parse_career(row[1] if len(row) > 1 else "")}
                    continue
                ni = next((i for i, h in enumerate(head) if _HEAD_NAME.search(h)), None)
                if ni is None:
                    continue
                newi = next((i for i, h in enumerate(head) if _HEAD_NEW.search(h)), None)
                curi = next((i for i, h in enumerate(head) if _HEAD_CUR.search(h)), None)
                hm = re.compile(r"氏\s*名").search(text, cursor)
                pos = hm.start() if hm else -1
                section = _section_of(text[cursor:pos] if pos > 0 else text[cursor:])
                if pos > 0:
                    cursor = pos + 2
                for row in tbl[1:]:
                    cells = [_c(c) for c in row]
                    name = cells[ni]
                    if not name or _HEAD_NAME.search(name):
                        continue
                    new_t = cells[newi] if newi is not None and newi < len(cells) else ""
                    cur_t = cells[curi] if curi is not None and curi < len(cells) else ""
                    if _SAME.match(new_t):
                        new_t = ""
                    same = bool(_SAME.match(cur_t))
                    if same or cur_t in ("", None):
                        cur_t = ""
                    items.append({"name": display_name(name), "name_key": normalize_name(name), "new_title": new_t.replace(" ", ""),
                                  "cur_title": cur_t.replace(" ", ""), "unchanged": same, "section": section,
                                  "kind": _kind(section, new_t, cur_t)})
    full = "\n".join(texts)
    nf = nfkc(full)
    doc_date = parse_ymd(nf.split("\n")[0]) or parse_ymd(nf)
    m = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(?:\d{1,2}\s*日|上旬|中旬|下旬)?\s*開催予定の定時株主総会", nf)
    effective = f"{m.group(1)}-{int(m.group(2)):02d}" if m else None
    if not effective:
        m = re.search(r"(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)\s*付", nf)
        effective = parse_ym(m.group(1)) if m else (doc_date[:7] if doc_date else None)
    title_m = re.search(r"\n\s*([^\n]*(?:お知らせ|について)[^\n]*)\n", nf)
    return {"doc_date": doc_date, "effective": effective, "title": title_m.group(1).strip() if title_m else "",
            "items": items, "careers": careers, "raw_text": full if not items else "", "parse_ok": bool(items)}


def main():
    import json
    for p in sys.argv[1:]:
        r = parse_pdf(p)
        print(json.dumps({k: v for k, v in r.items() if k != "raw_text"}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
