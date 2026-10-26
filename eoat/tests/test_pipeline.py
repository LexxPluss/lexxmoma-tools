# -*- coding: utf-8 -*-
"""エンドエフェクタ事例DB の受入テスト: python -m unittest discover -s eoat/tests
正規化(重量・単位・表記ゆれ)、ロボット型式 → 区分、同義語、重複判定、画像処理(縮小・EXIF 除去・phash・パックの位置)、
暗号化 → 復号の往復、スキーマ検証。ネットワークは使わない。"""
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "crawler"))

import normalize  # noqa: E402
from classify import Taxonomy, classify_one  # noqa: E402
from dedupe import dedupe  # noqa: E402


def rec(**kw):
    base = {"id": "t1", "url": "https://example.com/case/1", "final_url": "https://example.com/case/1", "retrieved_at": "2026-10-26", "sources": ["ur"],
            "source_type": "maker_robot", "case_type": "sier_case", "region": "欧州", "country": "デンマーク", "lang": "en", "publisher": "UR",
            "title": "", "page_title": "", "description": "", "headings": [], "text": "", "images": [], "videos": [], "year": 2024, "robots_flags": []}
    base.update(kw)
    return base


class TestNormalize(unittest.TestCase):
    def test_weights(self):
        self.assertEqual(normalize.weights_kg("25 kg sacks and 500 g bags, 20 lb boxes"), [25.0, 0.5, 9.072])
        self.assertEqual(normalize.weights_kg("最大10キロのワーク"), [10.0])
        self.assertEqual(normalize.weights_kg("12.5kg"), [12.5])
        self.assertEqual(normalize.weights_kg("2026年10月"), [])

    def test_payload_class(self):
        self.assertEqual(normalize.payload_class(5), "≤5kg")
        self.assertEqual(normalize.payload_class(20), "5–20kg")
        self.assertEqual(normalize.payload_class(20.1), "20–100kg")
        self.assertEqual(normalize.payload_class(150), ">100kg")
        self.assertEqual(normalize.payload_class(None), "不明")

    def test_workpiece_mass_needs_context(self):
        self.assertEqual(normalize.workpiece_mass("The boxes weigh up to 12 kg each."), {"min": 12.0, "max": 12.0})
        self.assertIsNone(normalize.workpiece_mass("Founded in 1990, 12 kg of coffee per day"))   # 文脈語が無い

    def test_terms(self):
        t = normalize.norm_text("Ｄepalletizing  Cardboard BOXES")
        self.assertEqual(t, "depalletizing cardboard boxes")
        self.assertEqual(normalize.count_terms(t, ["box", "boxes", "cardboard", "card"]), {"boxes": 1, "cardboard": 1})   # 単語境界: card は一致しない
        self.assertEqual(normalize.count_terms(normalize.norm_text("段ボールのデパレ"), ["段ボール", "デパレ", "パレ"]), {"段ボール": 1, "デパレ": 1, "パレ": 1})


class TestClassify(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tx = Taxonomy()

    def test_japanese_case(self):
        r = rec(title="段ボールのデパレタイズを協働ロボットで自動化", description="真空吸着ハンドで 10 kg の段ボール箱をパレットから降ろす",
                text="協働ロボット UR10e に真空吸着ハンドを付け、重さ 10 kg までの段ボール箱をパレットから降ろす。食品工場の出荷ライン。")
        out, why = classify_one(r, self.tx)
        self.assertIsNone(why)
        self.assertIn("carton", out["workpiece"]["categories"])
        self.assertEqual(out["end_effector"]["principles"][0], "single_pad")
        self.assertIn("depalletizing", out["tasks"])
        self.assertEqual(out["robot"]["maker"], "Universal Robots")
        self.assertEqual(out["robot"]["model"], "UR10e")
        self.assertEqual(out["robot"]["class"], "協働")
        self.assertEqual(out["payload_class"], "5–20kg")
        self.assertIn("paper", out["workpiece"]["materials"])
        self.assertIn("workpiece.categories", out["fieldSources"])

    def test_robot_model_to_class(self):
        for text, maker, cls, mobile in [("FANUC CRX-10iA/L で", "FANUC", "協働", False), ("MOTOMAN GP25 を", "安川電機", "産業用", False),
                                         ("KUKA KMR iiwa を使った", "KUKA", "協働", True), ("duAro2 で", "川崎重工", "協働", False)]:
            r = rec(title="段ボールの吸着ハンドリング", text=text + " 段ボールを吸着パッドで取る。")
            out, _ = classify_one(r, self.tx)
            self.assertEqual((out["robot"]["maker"], out["robot"]["class"], out["robot"]["is_mobile_manipulator"]), (maker, cls, mobile), text)

    def test_unknown_robot_stays_unknown(self):
        r = rec(title="段ボールを吸着で取り出す事例", text="段ボールを吸着ハンドで取り出す。詳細は省略。")
        out, _ = classify_one(r, self.tx)
        self.assertIsNone(out["robot"]["class"])
        self.assertEqual(out["payload_class"], "不明")

    def test_mobile_manipulator_and_custom(self):
        r = rec(title="移動マニピュレータによる通い箱の工程間搬送", text="AMR にアームを載せた移動マニピュレータが、通い箱を棚から取って工作機械へ運ぶ。ハンドは自社製のカスタム 2指平行ハンド。")
        out, _ = classify_one(r, self.tx)
        self.assertTrue(out["robot"]["is_mobile_manipulator"])
        self.assertTrue(out["end_effector"]["is_custom"])
        self.assertEqual(out["case_type"], "user_custom")
        self.assertIn("tote", out["workpiece"]["categories"])
        self.assertIn("transport", out["tasks"])

    def test_rejects_non_case(self):
        r = rec(title="会社概要", text="当社は 1980 年創業の商社です。採用情報はこちら。")
        out, why = classify_one(r, self.tx)
        self.assertIsNone(out)
        self.assertTrue(why)


class TestDedupe(unittest.TestCase):
    def mk(self, i, url, ph="0000000000000000", maker=None, model=None):
        return {"id": f"c{i}", "case_type": "sier_case", "workpiece": {"categories": ["carton"]}, "tasks": ["palletizing"],
                "end_effector": {"maker": maker, "model": model}, "robot": {"model": None},
                "images": [{"id": f"i{i}", "phash": ph}], "sources": [{"url": url}]}

    def test_same_url_and_same_image(self):
        a = self.mk(1, "https://www.example.com/a/")
        b = self.mk(2, "https://example.com/a")           # www と末尾 / の違いだけ
        c = self.mk(3, "https://example.com/c", ph="0000000000000001")   # 画像がほぼ同じ
        d = self.mk(4, "https://example.com/d", ph="ffffffffffffffff")
        kept, merged, reasons = dedupe([a, b, c, d])
        self.assertEqual(merged, 2)
        self.assertEqual([k["id"] for k in kept], ["c1", "c4"])
        self.assertEqual(len(kept[0]["sources"]), 2)   # 束ねた側の出典が残る

    def test_same_product_work_task(self):
        a = self.mk(1, "https://x.com/1", ph="0000000000000000", maker="OnRobot", model="VG10")
        b = self.mk(2, "https://y.com/2", ph="ffffffffffffffff", maker="OnRobot", model="VG10")
        kept, merged, _ = dedupe([a, b])
        self.assertEqual(merged, 1)


class TestImagesAndBuild(unittest.TestCase):
    def test_shrink_strips_exif_and_limits_size(self):
        from PIL import Image
        import images
        im = Image.new("RGB", (1200, 800))
        px = im.load()
        for x in range(1200):
            for y in range(800):
                px[x, y] = ((x * 255) // 1200, (y * 255) // 800, ((x + y) * 3) % 255)   # 勾配(単色ではない)
        exif = Image.Exif(); exif[0x010F] = "Camera"
        buf = io.BytesIO(); im.save(buf, "JPEG", exif=exif.tobytes())
        ok, why = images.check_image(buf.getvalue())
        self.assertIsNotNone(ok, why)
        tb, (w, h) = images.shrink(ok, 240)
        self.assertEqual((w, h), (240, 160))
        out = Image.open(io.BytesIO(tb))
        self.assertEqual(out.format, "WEBP")
        self.assertFalse(out.getexif())
        db, (w2, h2) = images.shrink(ok, 400)
        self.assertEqual(max(w2, h2), 400)
        self.assertEqual(len(images.phash(ok)), 16)
        self.assertEqual(images.hamming("00000000000000ff", "00000000000000f0"), 4)

    def test_check_image_rejects_small_and_flat(self):
        from PIL import Image
        import images
        small = io.BytesIO(); Image.new("RGB", (120, 90), (0, 0, 0)).save(small, "PNG")
        self.assertIsNone(images.check_image(small.getvalue())[0])
        flat = io.BytesIO(); Image.new("RGB", (600, 400), (200, 200, 200)).save(flat, "PNG")
        self.assertIsNone(images.check_image(flat.getvalue())[0])
        self.assertIsNone(images.check_image(b"not an image")[0])

    def test_encrypt_roundtrip_and_pack_offsets(self):
        import build
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        key = build.derive_key("pw", b"\x01" * 16)
        blobs = [build.seal(key, b"img%d" % i * 50) for i in range(3)]
        pack = b"".join(blobs)
        off = 0
        for i, b in enumerate(blobs):
            rec = pack[off: off + len(b)]
            self.assertEqual(AESGCM(key).decrypt(rec[:12], rec[12:], None), b"img%d" % i * 50)
            off += len(b)
        with self.assertRaises(Exception):
            AESGCM(build.derive_key("other", b"\x01" * 16)).decrypt(blobs[0][:12], blobs[0][12:], None)

    def test_validate_requires_fields(self):
        import build
        L = build.Labels()
        good = {"workpiece": {"categories": ["carton"]}, "end_effector": {"principles": ["single_pad"]}, "robot": {"class": "協働"},
                "images": [{"id": "x", "source_page_url": "https://e.com", "credit": "e", "retrieved_at": "2026-10-26", "policy": "stored"}], "sources": [{"url": "https://e.com"}]}
        self.assertEqual(build.validate(good, L), [])
        bad = json.loads(json.dumps(good)); bad["images"] = []; bad["robot"]["class"] = "humanoid"; bad["workpiece"]["categories"] = ["nope"]
        errs = build.validate(bad, L)
        self.assertTrue(any("images" in e for e in errs))
        self.assertTrue(any("robot.class" in e for e in errs))
        self.assertTrue(any("未知のカテゴリ" in e for e in errs))

    def test_compose_text_is_own_words(self):
        import build
        L = build.Labels()
        r = {"workpiece": {"categories": ["carton", "pallet"], "mass_kg": {"min": 8, "max": 12}}, "end_effector": {"principles": ["single_pad"], "is_custom": False},
             "tasks": ["depalletizing"], "robot": {"maker": "Universal Robots", "model": "UR20", "class": "協働", "payload_kg": 20, "is_mobile_manipulator": False},
             "industry": ["物流・倉庫"], "case_type": "sier_case"}
        title, summary = build.compose_text(r, L)
        self.assertEqual(title, "段ボール・パレットのデパレタイズ(単パッド)")
        self.assertLessEqual(len(summary), 120)
        self.assertIn("UR20", summary)
        for w in ("置き換え", "削減人数"):
            self.assertNotIn(w, summary)


if __name__ == "__main__":
    unittest.main()
