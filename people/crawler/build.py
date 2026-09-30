# -*- coding: utf-8 -*-
"""ビルド: raw/ と manual/ から persons / tenures / org_units / events / signals / sources を組み立て、
1 ファイルに結合して暗号化し、site/members/people-db/data.enc.json(.js) に書き出す(SPEC §4 build / §5 / §10)。

入力(会社ごと raw/<company_id>/):
  yuho_<docID>_officers.json  … crawl_edinet.py(有報「役員の状況」の表)
  tdnet_<date>_<id>.json|.pdf … crawl_tdnet.py(役員異動の開示。json が無ければ PDF をその場で読む)
  site_executives_<date>.json|.html, site_events_<date>.json, org_chart_<date>.json … crawl_sites.py
  sources.json                … 出典レコード。出典の無い値は保存しない(§0-5)
manual/: YYYY-MM-DD_<会社>.json(手動投入), reviews.json(レビュー), suppressions.json(削除依頼), sales_notes.json, ir_urls.json
出力: data/*.json(平文・社内確認用、.gitignore)、site/members/people-db/data.enc.json と data.enc.js(暗号化)
暗号化は工場マップと同じ: パスワード → PBKDF2-SHA256(310,000 回) → AES-256-GCM。パスワードは --password か環境変数 PEOPLE_PW / FACTORY_PW。

使い方:
  python build.py --password <共通パスワード>
  python build.py --plain-only                       # 平文だけ(暗号化ファイルは更新しない)
  python build.py --raw-dir ../tests/fixtures --plain-only   # フィクスチャで組み立てる(テスト)
"""
import argparse
import base64
import glob
import os
import re
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

from common import (DATA, FIXTURES, LOGS, MANUAL, RAW, SITE_OUT, RunLog, display_name, jdump, jload, months_between, nfkc, normalize_name,
                    parse_ym, stable_id, today as _today, ym)
from normalize import is_officer_rank, parse_title, rank_core, rank_level, unit_id, units_key
from parse_officers import _own_prefix_re, parse_career, parse_officers_json

OFFICER_LEVEL = 50   # 執行役員以上を「役員層」として events を出す


class CompanyBuild:
    def __init__(self, company, cdir, manual, today):
        self.c = company
        self.cid = company["id"]
        self.cdir = Path(cdir)
        self.manual = manual
        self.today = today
        self.sources = {s["id"]: s for s in jload(self.cdir / "sources.json", [])}
        self.persons = {}     # name_key → person
        self.tenures = []
        self.events = []
        self.units = {}       # unit_id → org_unit
        self.warnings = []
        self.org_charts = []
        self.manual_queue = jload(self.cdir / "manual_queue.json", [])

    # ------------------------------------------------------------ 人物
    def person(self, name, born=None, create=True):
        key = normalize_name(name)
        p = self.persons.get(key)
        if p is not None and " " in display_name(name) and " " not in p["name"]:
            p["name"] = display_name(name)   # 「時田 孝志」のように姓名の切れ目が分かる表記を優先
        if p is None and create:
            p = {"id": stable_id(self.cid, "P", key), "company_id": self.cid, "name": display_name(name), "name_key": key, "name_kana": None,
                 "born": born, "joined": None, "is_outside": False, "term_years": None, "career": [], "current_titles": [],
                 "sales_note": "", "external_links": [], "source_ids": []}
            self.persons[key] = p
        if p is not None and born and not p.get("born"):
            p["born"] = born
        return p

    def _src(self, sid):
        if sid and sid not in self.sources:
            self.warnings.append(f"出典 {sid} が sources.json に無い")
        return sid

    # ------------------------------------------------------------ 在任レコード
    def _match(self, t, parsed):
        """観測した役職が既存 tenure と同じか。サイトの役員一覧は本部名が無いので、ユニット無しなら役位だけで比べる。"""
        if parsed["units"]:
            # 子会社名は略称(NAPM 等)で揺れるので、子会社以外のユニットが一致し子会社の数が同じなら同じ役職とみなす
            a = [u for u in parsed["units"] if u["kind"] not in ("子会社", "他社")]
            b = [u for u in t["units_detail"] if u["kind"] not in ("子会社", "他社")]
            if units_key(a) != units_key(b) or (len(parsed["units"]) - len(a)) != (len(t["units_detail"]) - len(b)):
                return False
        ra, rb = parsed.get("rank") or "", t.get("rank") or ""
        if not parsed["units"] and not ra:
            return False
        if ra == rb:
            return True
        if ra and rb and (ra in rb or rb in ra) and rank_level(ra) == rank_level(rb):
            return True
        return not ra and bool(parsed["units"]) and not rb

    def own_tenures(self, p, scope="own"):
        return [t for t in self.tenures if t["person_id"] == p["id"] and t["scope"] == scope]

    def active_at(self, p, at, scope="own"):
        """日付 at にその人が就いていた在任。from/to は YYYY-MM だが、日付まで分かるもの(from_exact/to_exact)は日で比べる。"""
        m = ym(at)
        full = at if len(at) == 10 else None
        out = []
        for t in self.own_tenures(p, scope):
            if (t["from"] or "0000") > m or (full and t.get("from_exact") and t["from_exact"] > full):
                continue
            if t["to"] is None or t["to"] > m or (t["to"] == m and (not full or not t.get("to_exact") or t["to_exact"] > full)):
                out.append(t)
        return out

    def add_tenure(self, p, title_raw, frm, status, sid, scope="own", from_is_asof=False, subsidiary=None, parsed=None, retrieved=None):
        parsed = parsed or parse_title(title_raw, own_company=(scope == "own"))
        t = {"id": stable_id(self.cid, "T", p["id"], scope, ym(frm), parsed["title_norm"]), "person_id": p["id"], "person_name": p["name"],
             "company_id": self.cid, "from": ym(frm), "from_exact": frm if len(frm or "") == 10 else None, "to": None, "to_exact": None,
             "title_raw": parsed["title_norm"] if scope == "own" else title_raw,
             "rank": parsed.get("rank"), "unit_ids": [], "unit_names": [u["name"] for u in parsed["units"]], "units_detail": parsed["units"],
             "is_concurrent": parsed["is_concurrent"], "is_outside": parsed.get("is_outside", False), "scope": scope, "subsidiary": parsed.get("subsidiary"),
             "status": status, "end_status": None, "source_id": self._src(sid), "source_ids": [sid] if sid else [],
             "retrieved_at": retrieved or self.today, "inferred_end": False, "from_is_asof": from_is_asof}
        if scope == "own":
            for u in parsed["units"]:
                uid = unit_id(self.cid, u["name"])
                t["unit_ids"].append(uid)
                if uid not in self.units:
                    self.units[uid] = {"id": uid, "company_id": self.cid, "name": u["name"], "kind": u["kind"], "former_names": [], "parent_id": None,
                                       "head_person_id": None, "head_since": None, "factory_map_id": None, "renamed_to": None, "source_ids": []}
                if sid and sid not in self.units[uid]["source_ids"]:
                    self.units[uid]["source_ids"].append(sid)
        # 重複(同じ人・同じ役職・同じ開始月)は 1 件にまとめる
        for e in self.tenures:
            if e["id"] == t["id"]:
                self._merge_src(e, sid)
                if status == "confirmed" and e["status"] == "planned":
                    e["status"] = "confirmed"
                if t["from_exact"] and not e.get("from_exact"):
                    e["from_exact"] = t["from_exact"]
                if not from_is_asof:
                    e["from_is_asof"] = False
                return e
        self.tenures.append(t)
        if sid and sid not in p["source_ids"]:
            p["source_ids"].append(sid)
        return t

    @staticmethod
    def _merge_src(t, sid):
        if sid and sid not in t["source_ids"]:
            t["source_ids"].append(sid)

    def close(self, t, at, status="confirmed", inferred=True):
        m = ym(at)
        if t["to"] is None or (status == "confirmed" and t.get("end_status") == "planned" and t["to"] == m):
            if t["from"] and m < t["from"]:
                return
            t["to"], t["to_exact"] = m, (at if len(at) == 10 else None)
            t["end_status"] = status
            t["inferred_end"] = inferred
            if t["status"] == "planned" and status == "confirmed":
                t["status"] = "inferred"   # 予定のまま直接は確認されずに次の役職が確認された

    def career_line(self, p, frm, text, current, sid, status="confirmed"):
        """有報の略歴 1 行 → 在任レコード(当社行は直前の当社行を閉じる。子会社行は並行)。"""
        p["career"].append({"date": frm, "text": text, "current": current, "source_id": sid, "status": status})
        if not frm:
            return None
        own = text.startswith("当社")
        body = text[2:] if own else text
        if own and re.search(r"入社$", body):
            p["joined"] = p["joined"] or frm
            return None
        if re.search(r"(退任|退社|退職|辞任)$", body):
            for t in self.active_at(p, frm):
                self.close(t, frm, inferred=False)
            return None
        if own:
            parsed = parse_title(body, True)
            if not parsed["units"] and not parsed["rank"]:
                return None
            for t in self.active_at(p, frm):
                if t["from"] != ym(frm):
                    self.close(t, frm)
            return self.add_tenure(p, body, frm, status, sid, parsed=parsed)
        parsed = parse_title(body, False)
        if parsed.get("subsidiary") and not parsed.get("external"):
            t = self.add_tenure(p, body, frm, status, sid, scope="subsidiary", parsed=parsed)
            return t
        return None   # 他社の略歴は career にだけ残す

    def observe(self, p, title_raw, at, status, sid, from_hint=None, scope="own"):
        """ある日付に「この役職だった」という観測(有報の役職名・開示・会社サイト)。既存の在任と照合し、無ければ新設する。"""
        if not title_raw:
            return None
        parsed = parse_title(title_raw, own_company=(scope == "own"))
        if not parsed["rank"] and not parsed["units"]:
            return None
        for t in self.active_at(p, at, scope):
            if self._match(t, parsed):
                self._merge_src(t, sid)
                if status == "confirmed":
                    t["status"] = "confirmed"
                if from_hint and t["from_is_asof"] and ym(from_hint) < t["from"]:
                    t["from"] = ym(from_hint)
                    t["from_is_asof"] = False
                return t
        later = sorted([t for t in self.own_tenures(p, scope) if t["from"] and t["from"] > ym(at) and self._match(t, parsed)], key=lambda t: t["from"])
        if later:
            t = later[0]
            if t["from_is_asof"] and status == "confirmed":
                # 「この日には既にその役職だった」観測 → as-of の開始日を前倒しする
                for a in self.active_at(p, at, scope):
                    if a is not t:
                        self.close(a, at, status=status)
                t["from"], t["from_exact"], t["from_is_asof"] = ym(at), (at if len(at) == 10 else None), True
                self._merge_src(t, sid)
                return t
            if status == "planned" or months_between(ym(at), t["from"]) <= 3:
                # 開示の「現役職名」は翌月以降の正式な開始日を持つ在任と同じもの
                self._merge_src(t, sid)
                return t
        for t in self.active_at(p, at, scope):
            self.close(t, at, status=status)
        return self.add_tenure(p, title_raw, from_hint or at, status, sid, scope=scope,
                               from_is_asof=(from_hint is None and status != "planned"), parsed=parsed)

    # ------------------------------------------------------------ 取り込み
    def ingest_yuho(self):
        for f in sorted(self.cdir.glob("yuho_*_officers.json")):
            doc = jload(f)
            r = parse_officers_json(doc, [self.c.get("short_name"), self.c.get("name")])
            sid = next((s["id"] for s in self.sources.values() if s.get("kind") == "yuho" and doc.get("doc_id") and doc["doc_id"] in (s.get("url") or "") + (s.get("title") or "")), None)
            if not sid:
                self.warnings.append(f"{f.name}: 出典レコードが無いので取り込まない")
                continue
            as_of = r["as_of"] or self.sources[sid].get("date") or self.today
            agm = r["agm_date"]
            self.warnings += [f"{f.name}: {w}" for w in r["warnings"]]
            # 略歴(a・b とも。b だけの人は b から)
            seen = set()
            for table, lst in (("a", r["officers"]), ("b", r["planned"]["officers"])):
                for o in lst:
                    p = self.person(o["name"], o["born"])
                    p["is_outside"] = p["is_outside"] or o["is_outside"]
                    if o.get("term_years") and (table == "b" or not p.get("term_years")):
                        p["term_years"] = o["term_years"]
                    if p["name_key"] in seen:
                        continue
                    seen.add(p["name_key"])
                    for line in o["career"]:
                        st = "planned" if (table == "b" and agm and line["date"] and line["date"] >= ym(as_of) and line["current"]) else "confirmed"
                        self.career_line(p, line["date"], line["text"], line["current"], sid, st)
            # 役職名(提出日現在)と執行役員。同じ人が同じ表に 2 回出る(取締役と執行役など)ときは兼務として 1 つにまとめる
            def merged(lst):
                out = {}
                for o in lst:
                    k = normalize_name(o["name"])
                    if k in out:
                        if o["title_raw"] and o["title_raw"] not in out[k]["title_raw"]:
                            out[k]["title_raw"] = out[k]["title_raw"] + "兼" + o["title_raw"]
                    else:
                        out[k] = dict(o)
                return list(out.values())
            a_keys = set()
            for o in merged(r["officers"]):
                p = self.person(o["name"], o["born"])
                a_keys.add(p["name_key"])
                self.observe(p, o["title_raw"], as_of, "confirmed", sid)
            for e in r["executives"]:
                p = self.person(e["name"])
                a_keys.add(p["name_key"])
                self.observe(p, e["title_raw"], as_of, "confirmed", sid)
            # 株主総会後の予定(b)
            if agm:
                b_keys = set()
                for o in merged(r["planned"]["officers"]):
                    p = self.person(o["name"], o["born"])
                    b_keys.add(p["name_key"])
                    self.observe(p, o["title_raw"], agm, "planned", sid)
                for e in r["planned"]["executives"]:
                    p = self.person(e["name"])
                    b_keys.add(p["name_key"])
                    self.observe(p, e["title_raw"], agm, "planned", sid)
                for k in a_keys - b_keys:   # 総会で退任予定
                    for t in self.active_at(self.persons[k], agm):
                        self.close(t, agm, status="planned", inferred=False)

    def ingest_tdnet(self):
        pdfs = {f.stem: f for f in self.cdir.glob("tdnet_*.pdf")}
        jsons = {f.stem: f for f in self.cdir.glob("tdnet_*.json")}
        docs = []
        for stem in sorted(set(pdfs) | set(jsons)):
            if stem in jsons:
                r = jload(jsons[stem])
            else:
                from parse_disclosure import parse_pdf
                r = parse_pdf(pdfs[stem])
                r["source_id"] = next((s["id"] for s in self.sources.values() if s.get("raw_path", "") and stem in s["raw_path"]), None)
            if not r.get("parse_ok"):
                self.manual_queue.append({"file": stem, "reason": "新旧役職の表を読めない", "raw_text": (r.get("raw_text") or "")[:20000]})
                continue
            docs.append(r)
        for r in sorted(docs, key=lambda r: r.get("doc_date") or ""):
            sid = r.get("source_id")
            if not sid:
                self.warnings.append(f"tdnet {r.get('title')}: 出典レコードが無いので取り込まない")
                continue
            d0, eff = r.get("doc_date") or self.today, r.get("effective") or ym(r.get("doc_date") or self.today)
            for name, cr in (r.get("careers") or {}).items():
                p = self.person(cr["name"], cr.get("born"))
                for line in cr["career"]:
                    self.career_line(p, line["date"], line["text"], line["current"], sid)
            for it in r["items"]:
                p = self.person(it["name"])
                if it.get("cur_title") and it["kind"] != "roster":
                    self.observe(p, it["cur_title"], d0, "confirmed", sid)
                elif it.get("cur_title"):
                    self.observe(p, it["cur_title"], d0, "confirmed", sid)
                if it["kind"] == "resigned":
                    for t in self.active_at(p, eff):
                        self.close(t, eff, status="planned", inferred=False)
                    if it.get("new_title"):
                        self.observe(p, it["new_title"], eff, "planned", sid)
                elif it.get("unchanged"):
                    self.observe(p, it["new_title"], d0, "confirmed", sid)
                elif it.get("new_title"):
                    self.observe(p, it["new_title"], eff, "planned", sid)

    def ingest_sites(self):
        snaps = sorted(self.cdir.glob("site_executives_*.json"))
        for f in snaps:
            s = jload(f)
            if not s.get("parse_ok") or not s.get("entries"):
                continue
            sid, d = s.get("source_id"), s["date"]
            if not sid:
                self.warnings.append(f"{f.name}: 出典レコードが無い")
                continue
            present = set()
            yuho_sids = {k for k, v in self.sources.items() if v.get("kind") == "yuho"}
            # 出典どうしの突き合わせ: 有報の役員が居るのに、サイトの一覧とほとんど重ならない(3 割未満)なら、
            # 役員一覧ではない別のページ(トップメッセージ・グループ会社の一覧など)とみなして取り込まない
            yuho_keys = {k for k, p in self.persons.items() if set(p.get("source_ids") or []) & yuho_sids and p.get("born")}
            site_keys = {normalize_name(e["name"]) for e in s["entries"]}
            if len(yuho_keys) >= 4 and len(yuho_keys & site_keys) / len(yuho_keys) < 0.3:
                self.warnings.append(f"{f.name}: 有報の役員と {len(yuho_keys & site_keys)}/{len(yuho_keys)} 名しか重ならないので、役員一覧ではないページとみなして取り込まない")
                continue
            for e in s["entries"]:
                p = self.person(e["name"])
                present.add(p["name_key"])
                if e.get("is_outside"):
                    p["is_outside"] = True
                if e.get("born") and not p.get("born"):
                    p["born"] = e["born"]
                # 会社サイトの略歴(一覧ページ内、または各人の紹介ページ)。有報の略歴がある人は有報を優先する
                if e.get("career_raw") and not any(c.get("source_id") in yuho_sids for c in p["career"]):
                    csid = e.get("profile_source_id") if e.get("profile_source_id") in self.sources else sid
                    for line in parse_career("\n".join(e["career_raw"]), own_re=_own_prefix_re([self.c.get("short_name"), self.c.get("name")])):
                        self.career_line(p, line["date"], line["text"], line["current"], csid)
                    if csid not in p["source_ids"]:
                        p["source_ids"].append(csid)
                self.observe(p, e["title"], d, "confirmed", sid)
            # 一覧に居ない人の当社在任を閉じる(予定で閉じていたものは確定に)。
            # ただしサイトの一覧が網羅的なときだけ: 一覧に載っている層(取締役・監査役 / 執行役員)ごとに、
            # その日に在任中の人の 7 割以上が一覧に居るなら「居ない = 退任」とみなす。取締役だけのページで執行役員を閉じない
            layers = {"board": lambda r: is_officer_rank(r), "exec": lambda r: "執行役" in (r or "") and not is_officer_rank(r)}
            listed_layers = set()
            for name, test in layers.items():
                active = {k for k, p in self.persons.items() if any(test(t.get("rank")) for t in self.active_at(p, d))}
                if any(test(parse_title(e["title"])["rank"]) for e in s["entries"]) and active and len(active & present) / len(active) >= 0.7:
                    listed_layers.add(name)
            for k, p in self.persons.items():
                if k in present:
                    continue
                for t in self.own_tenures(p):
                    if rank_level(t.get("rank")) < OFFICER_LEVEL:
                        continue   # 部長級などサイトの一覧に載らない層は閉じない
                    if not any(layers[n](t.get("rank")) for n in listed_layers):
                        continue
                    if t["to"] is None and t["from"] and t["from"] < ym(d):
                        self.close(t, d)
                    elif t.get("end_status") == "planned" and t["to"] and t["to"] <= ym(d):
                        t["end_status"] = "confirmed"
        for f in sorted(self.cdir.glob("site_events_*.json")):
            ev = jload(f)
            for e in ev.get("events", []):
                p = self.person(e["name"])
                self.events.append({"id": stable_id(self.cid, "EV", "site", ev["date"], e["type"], p["id"]), "company_id": self.cid, "date": ev["date"],
                                    "type": e["type"], "person_id": p["id"], "unit_id": None, "before": e.get("before"), "after": e.get("after"),
                                    "status": "confirmed", "source_id": ev.get("source_id"), "detected_at": ev["date"], "origin": "site_diff",
                                    "note": f"会社サイトの役員一覧の差分({ev.get('prev')}→{ev['date']})"})
        for f in sorted(self.cdir.glob("org_chart_*.json")):
            oc = jload(f)
            self.org_charts.append(oc)
            for name in oc.get("text_units") or []:
                uid = unit_id(self.cid, name)
                if uid not in self.units:
                    from normalize import unit_kind
                    self.units[uid] = {"id": uid, "company_id": self.cid, "name": name, "kind": unit_kind(name), "former_names": [], "parent_id": None,
                                       "head_person_id": None, "head_since": None, "factory_map_id": None, "renamed_to": None, "source_ids": [oc.get("source_id")]}

    def ingest_manual(self):
        """営業メモ(manual/sales_notes.json)を人物に付ける。手動投入の機能は 2026-09-30 に廃止。"""
        notes = self.manual.get("sales_notes", {})
        for p in self.persons.values():
            if p["id"] in notes:
                p["sales_note"] = notes[p["id"]]

    # ------------------------------------------------------------ 仕上げ
    def finalize(self):
        # 終了の補完: 次の当社在任の from で閉じる(inferred_end)。子会社在任は次の当社異動で閉じる
        for p in self.persons.values():
            own = sorted(self.own_tenures(p), key=lambda t: t["from"] or "")
            for i, t in enumerate(own[:-1]):
                nxt = own[i + 1]
                if t["to"] is None and nxt["from"] and nxt["from"] > (t["from"] or ""):
                    t["to"], t["inferred_end"], t["end_status"] = nxt["from"], True, nxt["status"]
                if t.get("end_status") == "planned" and nxt["status"] == "confirmed" and t["to"] == nxt["from"]:
                    t["end_status"] = "confirmed"
            for t in self.tenures:
                if t["person_id"] == p["id"]:
                    t["person_name"] = p["name"]
            for s in self.own_tenures(p, "subsidiary"):
                cur = any(c.get("current") and c["text"] == s["title_raw"] for c in p["career"])
                if s["to"] is None and not cur:
                    later = [t["from"] for t in own if t["from"] and s["from"] and t["from"] > s["from"]]
                    if later:
                        s["to"], s["inferred_end"] = later[0], True
        self.tenures = [t for t in self.tenures if not (t["from_is_asof"] and t["to"] == t["from"] and t["scope"] == "own"
                                                       and not (t.get("from_exact") and t.get("to_exact") and t["from_exact"] < t["to_exact"]))]
        self._detect_renames()
        self._events_from_tenures()
        self._merge_site_events()
        self._units_heads()
        self._current_titles()
        self._link_factories()

    def _detect_renames(self):
        """一人の連続する当社在任で、同じ種別のユニットが 1 つ消えて 1 つ現れ、消えた方がその後どこにも出ないなら改称とみなす。"""
        all_after = {}
        for t in self.tenures:
            if t["scope"] != "own":
                continue
            for u in t["unit_ids"]:
                all_after.setdefault(u, []).append(t["from"] or "")
        for p in self.persons.values():
            own = sorted(self.own_tenures(p), key=lambda t: t["from"] or "")
            for a, b in zip(own, own[1:]):
                ua = {u["name"]: u for u in a["units_detail"]}
                ub = {u["name"]: u for u in b["units_detail"]}
                removed = [ua[n] for n in ua if n not in ub and ua[n]["is_head"] and ua[n]["kind"] not in ("子会社", "他社")]
                added = [ub[n] for n in ub if n not in ua and ub[n]["is_head"] and ub[n]["kind"] not in ("子会社", "他社")]
                pairs = []
                for kind in set(u["kind"] for u in removed):
                    r = [u for u in removed if u["kind"] == kind]
                    ad = [u for u in added if u["kind"] == kind]
                    if len(r) == 1 and len(ad) == 1:
                        old_id, new_id = unit_id(self.cid, r[0]["name"]), unit_id(self.cid, ad[0]["name"])
                        if any(f >= (b["from"] or "") for f in all_after.get(old_id, []) if f):
                            continue
                        if any(f < (b["from"] or "") for f in all_after.get(new_id, []) if f):
                            continue
                        pairs.append((r[0], ad[0], old_id, new_id))
                aliases = self.manual.get("unit_aliases", {}).get(self.cid) or self.manual.get("unit_aliases", {}).get(self.c["short_name"]) or {}
                if len(pairs) < 2:   # 1 種類だけの入れ替えは配置換えの可能性が高い → manual/unit_aliases.json で明示されたものだけ
                    pairs = [pr for pr in pairs if aliases.get(pr[0]["name"]) == pr[1]["name"]]
                for r0, a0, old_id, new_id in pairs:
                    if True:
                        r, ad = [r0], [a0]
                        nu = self.units[new_id]
                        if not any(fn["name"] == r[0]["name"] for fn in nu["former_names"]):
                            nu["former_names"].append({"name": r[0]["name"], "until": b["from"], "source_id": b["source_id"]})
                        self.units[old_id]["renamed_to"] = new_id
                        self.events.append({"id": stable_id(self.cid, "EV", "rename", old_id, new_id), "company_id": self.cid, "date": b["from"],
                                            "type": "unit_renamed", "person_id": p["id"], "unit_id": new_id, "before": r[0]["name"], "after": ad[0]["name"],
                                            "status": b["status"], "source_id": b["source_id"], "tenure_id": b["id"], "detected_at": b["retrieved_at"], "origin": "tenure"})

    def _events_from_tenures(self):
        for p in self.persons.values():
            own = sorted(self.own_tenures(p), key=lambda t: t["from"] or "")
            prev = None
            for t in own:
                lvl = rank_level(t.get("rank"))
                plvl = rank_level(prev.get("rank")) if prev else 0
                base = {"company_id": self.cid, "person_id": p["id"], "unit_id": t["unit_ids"][0] if t["unit_ids"] else None, "status": t["status"],
                        "source_id": t["source_id"], "tenure_id": t["id"], "detected_at": t["retrieved_at"], "origin": "tenure", "rank": t.get("rank")}
                changed = prev is not None and (rank_core(prev.get("rank")) != rank_core(t.get("rank")) or units_key(prev["units_detail"]) != units_key(t["units_detail"]))
                base["date_is_asof"] = bool(t["from_is_asof"])
                if lvl >= OFFICER_LEVEL and plvl < OFFICER_LEVEL and (prev is not None or not t["from_is_asof"]):
                    self.events.append({"id": stable_id(self.cid, "EV", "appointed", t["id"]), "date": t["from"], "type": "appointed",
                                        "before": prev["title_raw"] if prev else None, "after": t["title_raw"], **base})
                elif lvl >= OFFICER_LEVEL and changed:
                    self.events.append({"id": stable_id(self.cid, "EV", "title_changed", t["id"]), "date": t["from"], "type": "title_changed",
                                        "before": prev["title_raw"], "after": t["title_raw"], **base})
                if "代表取締役社長" in (t.get("rank") or "") and (prev is not None or not t["from_is_asof"]) and (prev is None or "代表取締役社長" not in (prev.get("rank") or "")):
                    self.events.append({"id": stable_id(self.cid, "EV", "new_ceo", t["id"]), "date": t["from"], "type": "new_ceo",
                                        "before": prev["title_raw"] if prev else None, "after": t["title_raw"], **base})
                if prev is not None and prev["units_detail"] and t["units_detail"]:
                    pn, tn = {u["name"] for u in prev["units_detail"] if u["is_head"]}, {u["name"] for u in t["units_detail"] if u["is_head"]}
                    dropped = pn - tn
                    if dropped and tn and tn <= pn and not self.units[unit_id(self.cid, list(dropped)[0])].get("renamed_to"):
                        remain = next((u["name"] for u in t["units_detail"]), None)
                        self.events.append({"id": stable_id(self.cid, "EV", "concurrent_released", t["id"]), "date": t["from"], "type": "concurrent_released",
                                            "before": "・".join(sorted(dropped)), "after": remain, **base, "unit_id": unit_id(self.cid, list(dropped)[0])})
                prev = t
            # 退任: 最後の当社在任が閉じていて後続が無い
            if own and own[-1]["to"] and rank_level(own[-1].get("rank")) >= OFFICER_LEVEL:
                t = own[-1]
                self.events.append({"id": stable_id(self.cid, "EV", "resigned", t["id"]), "date": t["to"], "type": "resigned", "company_id": self.cid,
                                    "person_id": p["id"], "unit_id": None, "before": t["title_raw"], "after": None,
                                    "status": "planned" if t.get("end_status") == "planned" else "confirmed", "source_id": t["source_id"], "tenure_id": t["id"],
                                    "detected_at": t["retrieved_at"], "origin": "tenure", "rank": t.get("rank")})

    def _merge_site_events(self):
        """サイト差分のイベントは、同じ人・同じ種類の在任由来イベントが半年以内にあればその裏付け(出典)として付け、無ければそのまま残す。"""
        keep = []
        for e in self.events:
            if e.get("origin") != "site_diff":
                keep.append(e)
                continue
            twin = next((x for x in self.events if x.get("origin") != "site_diff" and x["type"] == e["type"] and x["person_id"] == e["person_id"]
                         and x["date"] and abs(months_between(ym(x["date"]), ym(e["date"]))) <= 6), None)
            if twin:
                twin.setdefault("confirmed_by", []).append(e["source_id"])
                if twin["status"] == "planned":
                    twin["status"] = "confirmed"
            else:
                keep.append(e)
        self.events = keep

    def _units_heads(self):
        for u in self.units.values():
            heads = [(t["from"] or "", t) for t in self.tenures if t["scope"] == "own" and u["id"] in t["unit_ids"] and t["to"] is None
                     and any(d.get("is_head") and d["name"] == u["name"] for d in t["units_detail"])]
            heads = [h for h in heads if h[1]["status"] == "confirmed"] or heads
            if heads:
                f, t = sorted(heads, key=lambda h: h[0])[-1]
                u["head_person_id"], u["head_since"], u["head_status"] = t["person_id"], t["from"], t["status"]
            u["needs_manual"] = any(oc.get("needs_manual") for oc in self.org_charts)

    def _current_titles(self):
        for p in self.persons.values():
            cur = [t for t in self.own_tenures(p) if t["to"] is None]
            conf = [t for t in cur if t["status"] == "confirmed"]
            p["current_titles"] = [t["title_raw"] for t in (conf or cur)]
            if not conf and cur:
                p["current_titles"] = [t + "(予定)" for t in p["current_titles"]]
            p["subsidiary_titles"] = [t["title_raw"] for t in self.own_tenures(p, "subsidiary") if t["to"] is None]
            # 同じ略歴行が複数の出典に載る(有報と開示)→ 1 行にまとめ、出典を足す
            seen, uniq = {}, []
            for c in sorted(p["career"], key=lambda c: c["date"] or ""):
                k = (c["date"], re.sub(r"\s+", "", c["text"]))
                if k in seen:
                    seen[k].setdefault("source_ids", [seen[k]["source_id"]])
                    if c["source_id"] not in seen[k]["source_ids"]:
                        seen[k]["source_ids"].append(c["source_id"])
                    continue
                seen[k] = c
                uniq.append(c)
            p["career"] = uniq

    def _link_factories(self):
        facs = self.manual.get("factories", {}).get(self.c["factory_map_ids"][0] if self.c.get("factory_map_ids") else "", [])
        for u in self.units.values():
            if u["kind"] != "工場":
                continue
            key = nfkc(u["name"]).replace("工場", "")
            for f in facs:
                if key and key in nfkc(f["name"]):
                    u["factory_map_id"] = f["id"]
                    break

    def apply_suppressions(self, sup):
        """削除依頼(§9): persons.id または (会社, 氏名) 指定で、人物と関連する全レコードを除く。"""
        ids = set(sup.get("person_ids") or [])
        for n in sup.get("names") or []:
            if n.get("company_id") in (self.cid, self.c["short_name"]):
                p = self.persons.get(normalize_name(n["name"]))
                if p:
                    ids.add(p["id"])
        if not ids:
            return 0
        self.persons = {k: p for k, p in self.persons.items() if p["id"] not in ids}
        self.tenures = [t for t in self.tenures if t["person_id"] not in ids]
        self.events = [e for e in self.events if e.get("person_id") not in ids]
        for u in self.units.values():
            if u.get("head_person_id") in ids:
                u["head_person_id"], u["head_since"] = None, None
        return len(ids)


def delete_person(data, person_id):
    """組み立て済みデータ(build の出力)から persons.id 指定で全関連レコードを除く(受入基準 12)。"""
    data["persons"] = [p for p in data["persons"] if p["id"] != person_id]
    data["tenures"] = [t for t in data["tenures"] if t["person_id"] != person_id]
    data["events"] = [e for e in data["events"] if e.get("person_id") != person_id]
    data["signals"] = [s for s in data["signals"] if s.get("person_id") != person_id]
    for u in data["org_units"]:
        if u.get("head_person_id") == person_id:
            u["head_person_id"], u["head_since"] = None, None
    return data


# ---------------------------------------------------------------- 全体
def load_manual():
    m = {"reviews": jload(MANUAL / "reviews.json", {}), "suppressions": jload(MANUAL / "suppressions.json", {}),
         "sales_notes": jload(MANUAL / "sales_notes.json", {}), "unit_aliases": jload(MANUAL / "unit_aliases.json", {}), "factories": {}}
    fm = None
    from common import FACTORY_PLAIN
    if FACTORY_PLAIN.exists():
        fm = jload(FACTORY_PLAIN)
    elif (FIXTURES / "companies_sample.json").exists():
        fm = jload(FIXTURES / "companies_sample.json")
    if fm:
        for f in fm.get("factories", []):
            m["factories"].setdefault(f.get("oid") or f["cid"], []).append({"id": f["id"], "name": f["name"]})
    return m


def recent_failures(days=14):
    out = []
    for i in range(days):
        d = (date.today() - timedelta(days=i)).isoformat()
        log = jload(LOGS / f"{d}.json")
        if not log:
            continue
        for run in log.get("runs", []):
            for f in run.get("failures", []):
                out.append({"date": d, "step": run["step"], **f})
    return out


def encrypt(data, pw, out_json):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    import json
    import zlib
    salt, iv, it = os.urandom(16), os.urandom(12), 310000
    k = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=it).derive(pw.encode("utf-8"))
    # 数百社分で平文 JSON が数十 MB になるので、暗号化の前に deflate で縮める(ブラウザは DecompressionStream で戻す)
    plain = zlib.compress(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 9)
    ct = AESGCM(k).encrypt(iv, plain, None)
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    enc = json.dumps({"v": 2, "kdf": "PBKDF2-SHA256", "iter": it, "salt": b64(salt), "iv": b64(iv), "z": "deflate", "ct": b64(ct)})
    out_json = Path(out_json)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(enc, encoding="utf-8")
    out_json.with_name("data.enc.js").write_text("window.PEOPLE_ENC=" + enc + ";\n", encoding="utf-8")
    return out_json


def build(raw_dir, companies, manual, rules, vocab, today, log):
    from signals import check_vocabulary, generate
    by_id = {c["id"]: c for c in companies}
    by_short = {c["short_name"]: c for c in companies}
    persons, tenures, units, events, signals, sources, quality = [], [], [], [], [], [], {}
    cdirs = [p for p in sorted(Path(raw_dir).iterdir()) if p.is_dir() and (p / "sources.json").exists()]
    for cdir in cdirs:
        srcs = jload(cdir / "sources.json", [])
        cid = srcs[0]["company_id"] if srcs else cdir.name
        c = by_id.get(cid) or by_short.get(cid)
        if not c:
            log.fail(cid, f"{cdir.name}: 企業マスタに無い")
            continue
        b = CompanyBuild(c, cdir, manual, today)
        try:
            b.ingest_yuho()
            b.ingest_tdnet()
            b.ingest_sites()
            b.ingest_manual()
            b.finalize()
            b.apply_suppressions(manual.get("suppressions", {}))
        except Exception as e:
            import traceback
            traceback.print_exc()
            log.fail(cid, f"組み立て失敗: {e}")
            continue
        ps, ts, us, es = list(b.persons.values()), b.tenures, list(b.units.values()), b.events
        sg = generate(c, ps, ts, es, us, rules, today)
        for s in sg:
            rv = manual.get("reviews", {}).get(s["id"])
            if rv:
                s["review_status"], s["reviewed_by"], s["review_comment"] = rv.get("status"), rv.get("reviewed_by"), rv.get("comment")
        bad = check_vocabulary([x for s in sg for x in (s["title"], s["interpretation"], s["verify_question"])], vocab)
        for w, t in bad:
            log.fail(cid, f"語彙チェック: 「{w}」を含む: {t[:60]}")
        # 出典の無い値は保存しない(§0-5)
        ts = [t for t in ts if t.get("source_id")]
        es = [e for e in es if e.get("source_id")]
        persons += ps
        tenures += ts
        units += us
        events += es
        signals += sg
        sources += list(b.sources.values())
        last = max([s.get("retrieved_at") or "" for s in b.sources.values()] or [""])
        quality[cid] = {"company_id": cid, "last_retrieved": last or None, "sources": len(b.sources), "persons": len(ps), "tenures": len(ts),
                        "events": len(es), "signals": len(sg), "warnings": b.warnings, "manual_queue": len(b.manual_queue),
                        "org_chart_needs_manual": any(oc.get("needs_manual") for oc in b.org_charts),
                        "org_chart_images": [u for oc in b.org_charts for u in (oc.get("image_urls") or [])]}
        log.ok(cid, f"人物 {len(ps)} / 在任 {len(ts)} / イベント {len(es)} / シグナル {len(sg)}")
        c["last_event"] = max([e["date"] for e in es if e.get("date")] or [None])
        c["person_count"] = len(ps)
        c["officer_count"] = sum(1 for p in ps if any(is_officer_rank(t.get("rank")) for t in ts if t["person_id"] == p["id"] and t["to"] is None))
    return {"persons": persons, "tenures": tenures, "org_units": units, "events": events, "signals": signals, "sources": sources, "quality": quality}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--password")
    ap.add_argument("--plain-only", action="store_true")
    ap.add_argument("--raw-dir", default=str(RAW))
    ap.add_argument("--companies", default=str(DATA / "companies.json"))
    ap.add_argument("--out", default=str(DATA))
    ap.add_argument("--today")
    a = ap.parse_args()
    today = a.today or _today()
    if a.today:
        os.environ["PEOPLE_TODAY"] = a.today
    pw = a.password or os.environ.get("PEOPLE_PW") or os.environ.get("FACTORY_PW")
    if not pw and not a.plain_only:
        import getpass
        pw = getpass.getpass("共通パスワード(表示されません): ")
        if not pw:
            sys.exit("パスワードが空です(平文だけなら --plain-only)")
    reg = jload(a.companies)
    if not reg:
        sys.exit(f"{a.companies} が無い。先に registry.py")
    from signals import load_rules
    rules, vocab = load_rules()
    manual = load_manual()
    log = RunLog("build")
    out = build(a.raw_dir, reg["companies"], manual, rules, vocab, today, log)
    todo = jload(Path(a.companies).with_name("registry_todo.json"), [])
    data = {"builtAt": today, "notice": "社内限定。公開情報(有価証券報告書・適時開示・会社サイト)のみ。面談・名刺で得た情報は Notion 案件ページへ。",
            "companies": reg["companies"], "registry_summary": reg.get("summary"), "registry_todo": todo, **out,
            "failures": recent_failures(), "rules": [{"id": r["id"], "name": r.get("name"), "is_speculative": r.get("is_speculative")} for r in rules]}
    for k in ("persons", "tenures", "org_units", "events", "signals", "sources"):
        jdump(data[k], Path(a.out) / f"{k}.json")
    jdump(data, Path(a.out) / "people_all.json")
    # 品質監査(audit.py)を同じデータで回し、会社ごとのスコアと全体の指標を UI の「データ品質」に載せる
    try:
        import audit as AU
        rows = AU.audit(data)
        for r in rows.values():
            r["score"] = AU.score(r)
        summ = AU.summarize(rows)
        summ["persons_with_career"] = AU.career_coverage(data)
        hist = jload(Path(a.out) / "audit_history.json", [])
        if not hist or hist[-1] != summ:
            hist.append(summ)
        jdump({"summary": summ, "companies": rows}, Path(a.out) / "audit.json")
        jdump(hist[-50:], Path(a.out) / "audit_history.json")
        data["audit"] = {"summary": summ, "history": hist[-20:], "companies": {k: {kk: v[kk] for kk in (
            "score", "officers_expected", "officers_parsed", "officers_ok", "exec_expected", "exec_parsed", "exec_ok", "current_rate", "site_persons", "site_yuho_overlap", "site_careers", "bad_name_count")}
            for k, v in rows.items()}}
        print("audit", summ)
    except Exception as e:
        print("audit 失敗:", e)
    print(f"人物 {len(data['persons'])} / 在任 {len(data['tenures'])} / ユニット {len(data['org_units'])} / イベント {len(data['events'])} / シグナル {len(data['signals'])} / 出典 {len(data['sources'])}")
    if a.plain_only:
        print("--plain-only: 暗号化ファイル(site/members/people-db/data.enc.*)は更新していません")
    else:
        p = encrypt(data, pw, SITE_OUT / "data.enc.json")
        print(f"→ {p} ({p.stat().st_size / 1024:.0f} KB)")
    log.save()


if __name__ == "__main__":
    main()
