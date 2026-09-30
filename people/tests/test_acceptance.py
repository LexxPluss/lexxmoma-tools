# -*- coding: utf-8 -*-
"""受入基準(SPEC §11)のテスト。日本プラストのフィクスチャ(tests/fixtures/nihon_plast)で組み立てて確認する。

実行: python -m unittest discover -s people/tests -v   (リポジトリ直下から)
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "crawler"))
os.environ["PEOPLE_TODAY"] = "2026-09-30"

from common import RunLog, jload  # noqa: E402
from registry import build_registry, load_edinet_codes  # noqa: E402
import build as B  # noqa: E402
from signals import check_vocabulary, load_rules  # noqa: E402

FIX = HERE / "fixtures"
NP = FIX / "nihon_plast"
_cache = {}


def built():
    """フィクスチャからの組み立て結果(テスト間で共有)。"""
    if "data" not in _cache:
        factory = jload(FIX / "companies_sample.json")
        rows = load_edinet_codes(str(FIX / "edinetcode_sample.csv"))
        companies, todo = build_registry(factory, rows, {})
        rules, vocab = load_rules()
        manual = B.load_manual()
        log = RunLog("test")
        out = B.build(str(FIX), companies, manual, rules, vocab, "2026-09-30", log)
        out["companies"] = companies
        out["registry_todo"] = todo
        out["log"] = log
        _cache["data"] = out
    return _cache["data"]


def by_name(data):
    return {p["name"].replace(" ", ""): p for p in data["persons"]}


class TestRegistry(unittest.TestCase):
    def test_01_listing_status_and_edinet(self):
        d = built()
        st = {c["short_name"]: c for c in d["companies"]}
        self.assertEqual(st["日本プラスト"]["listing_status"], "listed")
        self.assertEqual(st["日本プラスト"]["edinet_code"], "E02216")
        self.assertEqual(st["日本プラスト"]["securities_code"], "7291")
        self.assertEqual(st["トヨタ車体"]["listing_status"], "listed_parent")
        self.assertEqual(st["トヨタ車体"]["parent_company_id"], st["トヨタ自動車"]["id"])
        listed = [c for c in d["companies"] if c["listing_status"] == "listed"]
        rate = sum(1 for c in listed if c["edinet_code"]) / len(listed)
        self.assertGreaterEqual(rate, 0.9)
        self.assertEqual(st["日本プラスト"]["priority"], 1)   # 上場
        self.assertNotIn("pipeline_flag", st["日本プラスト"])
        self.assertNotIn("owner", st["日本プラスト"])


class TestOfficers(unittest.TestCase):
    def test_02_fixture_matches_mvp(self):
        d = built()
        exp = jload(NP / "expected" / "nihon_plast.json")
        names = by_name(d)
        for n in exp["persons_2026_06"]:
            self.assertIn(n.replace(" ", ""), names, n)
        self.assertEqual(len(exp["persons_2026_06"]), 15)   # 役員 10 + 執行役員 5
        for n, titles in exp["current_titles"].items():
            p = names[n.replace(" ", "")]
            self.assertEqual(p["current_titles"], titles, n)
        for n, born in exp["born"].items():
            self.assertEqual(names[n]["born"], born)
            self.assertEqual(len(born), 7)   # 生年月まで(日は保存しない §9)
        p = names["時田孝志"]
        own = sorted([t for t in d["tenures"] if t["person_id"] == p["id"] and t["scope"] == "own"], key=lambda t: t["from"])
        self.assertEqual(own[0]["from"], "2016-06")
        self.assertEqual(own[-1]["title_raw"], "代表取締役社長")
        self.assertEqual(p["joined"], "1990-08")

    def test_03_planned_saved_separately(self):
        d = built()
        names = by_name(d)
        # 有報(2026-06-23 提出)の b 表(総会後予定)由来: 鈴木良仁の取締役就任は 2026-06 開始の別レコード
        p = names["鈴木良仁"]
        ts = sorted([t for t in d["tenures"] if t["person_id"] == p["id"] and t["scope"] == "own"], key=lambda t: t["from"])
        self.assertEqual([t["title_raw"] for t in ts][-2:], ["調達部長", "取締役調達本部長兼調達部長"])
        self.assertEqual(ts[-1]["from"], "2026-06")
        # 予定として保存され、会社サイト(2026-09-30)で確定に昇格している
        self.assertEqual(ts[-1]["status"], "confirmed")
        self.assertTrue(any(s["kind"] == "website" for s in d["sources"] if s["id"] in ts[-1]["source_ids"]))
        # 相談役(2024-06 予定)はサイトに載らないので予定のまま
        q = names["永野博久"]
        self.assertIn("相談役(予定)", q["current_titles"])
        self.assertTrue(any(t["status"] == "planned" for t in d["tenures"]))


class TestDisclosure(unittest.TestCase):
    def test_04_tdnet_pdf_parsed_as_planned(self):
        from parse_disclosure import parse_pdf
        r = parse_pdf(NP / "tdnet_2024-03-28.pdf")
        self.assertTrue(r["parse_ok"])
        self.assertEqual(r["doc_date"], "2024-03-28")
        self.assertEqual(r["effective"], "2024-06")
        items = {(i["name_key"], i["kind"]): i for i in r["items"]}
        self.assertEqual(items[("時田孝志", "appointed")]["new_title"], "代表取締役社長")
        self.assertEqual(items[("時田孝志", "appointed")]["cur_title"], "取締役開発本部長")
        self.assertEqual(items[("清弘正敏", "appointed")]["cur_title"], "工機技術部長")
        self.assertIn(("永野博久", "resigned"), items)
        d = built()
        names = by_name(d)
        p = names["清弘正敏"]
        ts = [t for t in d["tenures"] if t["person_id"] == p["id"] and t["title_raw"] == "執行役員生産本部長兼工機技術部長"]
        self.assertEqual(ts[0]["from"], "2024-06")
        self.assertIn(ts[0]["status"], ("planned", "inferred"))   # 開示時点は予定。その後直接確認されないまま次の役職が確認された


class TestSiteDiff(unittest.TestCase):
    def test_05_site_snapshot_diff(self):
        from crawl_sites import diff_snapshots, parse_executives
        cur = parse_executives((NP / "site_executives_2026-09-30.html").read_text(encoding="utf-8"))
        self.assertEqual(len(cur), 16)
        prev = jload(NP / "site_executives_2026-06-23.json")["entries"]
        ev = diff_snapshots(prev, cur)
        kinds = sorted((e["type"], e["name_key"]) for e in ev)
        self.assertEqual(kinds, [("appointed", "川島高博"), ("appointed", "橋本あかね"), ("appointed", "鈴木良仁"), ("resigned", "伊東弘美"), ("resigned", "長谷川淳治")])
        d = built()
        names = by_name(d)
        for n, typ in (("鈴木良仁", "appointed"), ("長谷川淳治", "resigned")):
            es = [e for e in d["events"] if e["person_id"] == names[n]["id"] and e["type"] == typ]
            self.assertTrue(es, n)
            self.assertEqual(es[0]["status"], "confirmed")
            self.assertTrue(es[0].get("confirmed_by"), "サイト差分が裏付けとして付く")


class TestOrgUnits(unittest.TestCase):
    def test_06_rename_and_r2(self):
        d = built()
        units = {u["name"]: u for u in d["org_units"]}
        self.assertEqual([f["name"] for f in units["調達本部"]["former_names"]], ["購買本部"])
        self.assertEqual([f["name"] for f in units["デジタル戦略統括室"]["former_names"]], ["IB戦略室"])
        self.assertEqual(units["購買本部"]["renamed_to"], units["調達本部"]["id"])
        r2 = [s for s in d["signals"] if s["rule"] == "R2-unit-split-dx"]
        self.assertTrue(any("分離" in s["title"] for s in r2))
        self.assertTrue(all(s["is_speculative"] for s in r2))
        self.assertEqual(units["富士工場"]["factory_map_id"], "f-59c030eeb9")   # 工場マップへのリンク

    def test_06b_all_six_rules_fire(self):
        d = built()
        rules = sorted(set(s["rule"] for s in d["signals"]))
        self.assertEqual(rules, ["R1-seigi-promotion", "R2-unit-split-dx", "R3-cost-concurrent", "R4-new-officer-background", "R5-new-ceo", "R6-term-age"])
        r5 = [s for s in d["signals"] if s["rule"] == "R5-new-ceo"]
        self.assertEqual(len(r5), 1)
        self.assertIn("時田", r5[0]["title"])
        self.assertIn("開発", r5[0]["title"])


class TestSources(unittest.TestCase):
    def test_07_everything_has_source(self):
        d = built()
        src = {s["id"]: s for s in d["sources"]}
        for t in d["tenures"]:
            self.assertIn(t["source_id"], src)
            self.assertTrue(src[t["source_id"]]["url"])
        for e in d["events"]:
            self.assertIn(e["source_id"], src)
        for s in d["signals"]:
            self.assertTrue(s["source_ids"])
            for sid in s["source_ids"]:
                self.assertIn(sid, src)
        for s in src.values():
            self.assertTrue(s.get("retrieved_at"))

    def test_08_signals_have_speculative_flag_and_question(self):
        d = built()
        for s in d["signals"]:
            self.assertIn("is_speculative", s)
            self.assertTrue(s["verify_question"])
            self.assertTrue(s["interpretation"])
            self.assertIsNone(s["reviewed_by"])   # 生成直後はレビュー待ち


class TestDeletion(unittest.TestCase):
    def test_12_delete_person(self):
        d = built()
        data = json.loads(json.dumps({k: d[k] for k in ("persons", "tenures", "events", "signals", "org_units")}))
        pid = by_name(d)["渡辺和洋"]["id"]
        B.delete_person(data, pid)
        self.assertFalse([p for p in data["persons"] if p["id"] == pid])
        self.assertFalse([t for t in data["tenures"] if t["person_id"] == pid])
        self.assertFalse([e for e in data["events"] if e.get("person_id") == pid])
        self.assertFalse([s for s in data["signals"] if s.get("person_id") == pid])
        self.assertFalse([u for u in data["org_units"] if u.get("head_person_id") == pid])


class TestQualityGuards(unittest.TestCase):
    def test_yuho_owner_check(self):
        """有報のページ上部の「会社名(E00000)」で持ち主を確かめる(別会社の有報の取り違え防止)。"""
        from check_yuho_owner import owner_code
        doc = jload(NP / "yuho_S100YHRY_officers.json")
        code, name = owner_code(doc)
        self.assertEqual(code, "E02216")
        self.assertIn("日本プラスト", name)

    def test_name_notes_and_gender_header(self):
        from common import normalize_name, display_name
        self.assertEqual(normalize_name("杉 光\n注４"), "杉光")
        self.assertEqual(display_name("別府 理佳子\n注４、注５"), "別府 理佳子")
        self.assertEqual(normalize_name("小林 瑛二(コバヤシ エイジ)"), "小林瑛二")
        from parse_officers import _GENDER
        self.assertTrue(_GENDER.search("男性11名、女性5名(役員のうち女性の比率31%)"))

    def test_site_name_filter(self):
        from crawl_sites import is_person_name
        for bad in ("閉じる", "弁護士登録", "千葉工場長", "同社特別顧問(現在に至る)", "ホーム"):
            self.assertFalse(is_person_name(bad), bad)
        for ok in ("林 高史（社外）", "George Olcott", "筒井 岳彦(写真右)"):
            self.assertTrue(is_person_name(ok), ok)


class TestCrawlerPoliteness(unittest.TestCase):
    def test_13_user_agent_and_interval(self):
        import common
        self.assertIn("contact:", common.USER_AGENT)
        self.assertIn("LexxPluss", common.USER_AGENT)
        self.assertGreaterEqual(common.MIN_INTERVAL, 2.0)


class TestVocabulary(unittest.TestCase):
    def test_15_no_forbidden_words(self):
        d = built()
        rules, vocab = load_rules()
        texts = [x for s in d["signals"] for x in (s["title"], s["interpretation"], s["verify_question"])]
        self.assertEqual(check_vocabulary(texts, vocab), [])
        ui = (HERE.parent.parent / "site" / "members" / "people-db")
        for f in ("index.html", "app.js"):
            if (ui / f).exists():
                self.assertEqual(check_vocabulary([(ui / f).read_text(encoding="utf-8")], vocab), [], f)
        for f in (HERE.parent / "crawler" / "rules").glob("*.yaml"):
            txt = f.read_text(encoding="utf-8")
            body = "\n".join(l for l in txt.splitlines() if "forbidden" not in l and not l.strip().startswith("#"))
            self.assertEqual(check_vocabulary([body], vocab), [], f.name)


class TestEncryption(unittest.TestCase):
    def test_10_encrypted_output_has_no_names(self):
        d = built()
        with tempfile.TemporaryDirectory() as td:
            out = B.encrypt({"persons": d["persons"][:3]}, "test-password", Path(td) / "data.enc.json")
            raw = out.read_text(encoding="utf-8")
            for p in d["persons"][:3]:
                self.assertNotIn(p["name"], raw)
            enc = json.loads(raw)
            self.assertEqual(enc["kdf"], "PBKDF2-SHA256")
            self.assertEqual(enc["iter"], 310000)


if __name__ == "__main__":
    unittest.main()
