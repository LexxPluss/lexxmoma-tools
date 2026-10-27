# -*- coding: utf-8 -*-
"""事例の画像を取得・確認・縮小する(4-3 / 4-4 の方針)。

- 候補(classify の image_candidates)を og:image → 本文の画像 の順に試し、最大 3 枚まで採用
- 元画像は raw/images/ にだけ置く(gitignore)。公開側に置くのは縮小版(一覧 240px / 詳細 400px、WebP、EXIF 除去)だけ
- 確認: 画像として開ける・長辺 200px 以上・極端な縦横比でない・単色でない(ロゴ・プレースホルダ)・同じ事例内で phash が近いものは 1 枚に
- robots.txt・noimageindex・manual/image_policy.json(link_only)に従う。link_only の事例は画像を置かず、出典リンクだけにする
使い方: python images.py [--ids ...] [--workers 8] [--force]
"""
import argparse
import concurrent.futures as cf
import hashlib
import io
from pathlib import Path
import threading

from PIL import Image, ImageOps, ImageStat

from common import DATA, RAW, RunLog, fetch, jdump, jload, load_image_policy, image_policy_for, today, domain_of, RobotsDisallowed

Image.MAX_IMAGE_PIXELS = 60_000_000
RAW_IMG = RAW / "images"
IDX = RAW_IMG / "index.json"
THUMB = DATA / "img" / "thumb"
DETAIL = DATA / "img" / "detail"
THUMB_PX, DETAIL_PX = 240, 400
MAX_PER_CASE, MAX_TRY = 3, 7
try:
    from imgjudge import BAD as BAD_LABELS
except Exception:   # open_clip が無い環境
    BAD_LABELS = []
MODELS = Path(__file__).resolve().parent / "models"
MIN_CLIP = 0.60   # 画像の中身判定(imgjudge): 「ハンドがワークを扱っている写真」らしさがこれ未満なら使わない(ループ 8: 0.52 → 0.60(文を足して再判定した後の点数で)。0.52〜0.66 の帯は 81 枚中 73 枚が人物・縦長の帯・画面だった)
_idx_lock = threading.Lock()


def phash(img, size=8):
    """perceptual hash(DCT)。imagehash と同じ考え方。16 進 16 桁。"""
    try:
        import imagehash
        return str(imagehash.phash(img))
    except Exception:
        g = img.convert("L").resize((size, size), Image.LANCZOS)
        px = list(g.getdata())
        avg = sum(px) / len(px)
        bits = 0
        for p in px:
            bits = (bits << 1) | (1 if p > avg else 0)
        return f"{bits:016x}"


def hamming(a, b):
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def check_image(data):
    """画像の確認。戻り値 (Image, None) か (None, 理由)。"""
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception as e:
        return None, f"画像として開けない: {e}"
    w, h = im.size
    if max(w, h) < 200:
        return None, f"小さすぎる {w}x{h}"
    if w / h > 4 or h / w > 1.5:
        return None, f"縦横比が極端 {w}x{h}"   # 縦長(h/w > 1.5)はサイドバーの帯・人物の立ち姿が大半で、ハンドの写真はまず無い
    im = ImageOps.exif_transpose(im)
    rgb = im.convert("RGB")
    st = ImageStat.Stat(rgb.resize((64, 64)))
    if max(st.stddev) < 12:
        return None, "ほぼ単色(ロゴ・プレースホルダ)"
    if has_bars(rgb):
        return None, "左右(上下)に単色の帯(縦長の動画静止画など)"
    return rgb, None


def has_bars(rgb):
    """左右(または上下)だけに単色の帯がある画像(縦長の写真を横長の枠に入れたもの): 改変(切り抜き)はしない方針なので使わない。
    四辺すべてが単色なら白背景の製品写真なので残す。"""
    sm = rgb.resize((64, 64))
    whole = max(ImageStat.Stat(sm).stddev)
    if whole < 15:
        return False
    def flat(box):
        return max(ImageStat.Stat(sm.crop(box)).stddev) < 8
    lr = flat((0, 0, 10, 64)) and flat((54, 0, 64, 64))
    tb = flat((0, 0, 64, 10)) and flat((0, 54, 64, 64))
    return (lr and not tb) or (tb and not lr)


def shrink(im, px):
    out = im.copy()
    out.thumbnail((px, px), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, "WEBP", quality=72, method=6)   # EXIF は付けない(位置情報・撮影者情報を残さない)
    return buf.getvalue(), out.size


def fetch_image(url, idx):
    """元画像を取得して raw/images/ に置く。index.json に結果を記録(同じ URL は再取得しない)。"""
    key = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    with _idx_lock:
        if key in idx:
            return key, idx[key]
    rec = {"url": url, "retrieved_at": today()}
    try:
        data, ct, final, headers = fetch(url, binary=True, timeout=40)
        xr = (headers.get("x-robots-tag") or "").lower()
        if "noimageindex" in xr or "noai" in xr:
            rec.update(ok=False, why=f"X-Robots-Tag: {xr}")
        elif not ct.startswith("image/") and not url.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
            rec.update(ok=False, why=f"画像でない: {ct}")
        elif len(data) < 4000:
            rec.update(ok=False, why=f"小さすぎる {len(data)}B")
        else:
            im, why = check_image(data)
            if im is None:
                rec.update(ok=False, why=why)
            else:
                ext = ".png" if "png" in ct else ".jpg"
                RAW_IMG.mkdir(parents=True, exist_ok=True)
                (RAW_IMG / f"{key}{ext}").write_bytes(data)
                rec.update(ok=True, file=f"{key}{ext}", w=im.size[0], h=im.size[1], bytes=len(data), phash=phash(im), sha256=hashlib.sha256(data).hexdigest())
    except RobotsDisallowed:
        rec.update(ok=False, why="robots.txt で禁止")
    except Exception as e:
        rec.update(ok=False, why=str(e)[:200])
    with _idx_lock:
        idx[key] = rec
    return key, rec


def face_fraction(path):
    """顔が主役の画像を避ける(4-3): 検出した顔の面積の合計 / 画像面積。OpenCV が無ければ 0。"""
    try:
        import cv2
        img = cv2.imread(str(path))
        if img is None:
            return 0.0
        h, w = img.shape[:2]
        scale = 480 / max(h, w)
        if scale < 1:
            img = cv2.resize(img, (int(w * scale), int(h * scale)))
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        # 分類器の XML は crawler/models/ に置く(opencv 5 の wheel には同梱されない。ループ 8 まで検出が黙って 0 だった)
        area = 0
        for name, min_px in (("haarcascade_frontalface_default.xml", 24), ("haarcascade_profileface.xml", 24)):   # upperbody は誤検出が多く使わない
            f = MODELS / name
            if not f.exists():
                continue
            cc = cv2.CascadeClassifier(str(f))
            for (_, _, fw, fh) in cc.detectMultiScale(gray, 1.1, 5, minSize=(min_px, min_px)):
                area += fw * fh
        return area / (img.shape[0] * img.shape[1])
    except Exception:
        return 0.0


def alt_score(cand, rec):
    """候補の順序: 本文中でハンド・ロボット・ワークの語が alt に付いた画像 → og 画像 → 本文の出現順。"""
    s = 0
    if cand.get("og"):
        s += 20
    alt = (cand.get("alt") or "").lower() + " " + (cand.get("caption") or "").lower()
    for t in ("gripper", "robot", "cobot", "ハンド", "ロボット", "グリッパ", "吸着", "pick", "palletiz", "picking", "vacuum", "suction", "solution", "application", "cell", "tending", "arm"):
        if t in alt:
            s += 40
            break
    for bad in ("portrait", "headshot", "ceo", "founder", "team", "office", "building", "map", "chart", "graph", "diagram", "screenshot", "logo"):
        if bad in alt:
            s -= 50
    w, h = cand.get("w") or 0, cand.get("h") or 0
    if w and h and (w < 300 or h < 200):
        s -= 30
    s -= (cand.get("order") or 0) * 0.5
    return -s


def process_case(rec, idx, policy, log, force=False, generic=None):
    generic = generic or set()
    if rec.get("images") and not force:
        return rec, "skip"
    page_url = rec["sources"][0]["url"]
    pol = image_policy_for(page_url, policy)
    rec["images"] = []
    if pol == "link_only":
        rec["image_policy"] = "link_only"
        return rec, "link_only"
    rec["image_policy"] = "stored"
    cands = sorted(rec.get("image_candidates", []), key=lambda c: alt_score(c, rec))
    kept = []
    tried = 0
    for c in cands:
        if len(kept) >= MAX_PER_CASE or tried >= MAX_TRY:
            break
        tried += 1
        key, r = fetch_image(c["url"], idx)
        if not r.get("ok"):
            continue
        if "bars" not in r:   # 取得済みの画像にも帯の判定を掛ける(結果は index.json に残す)
            try:
                r["bars"] = has_bars(ImageOps.exif_transpose(Image.open(RAW_IMG / r["file"])).convert("RGB"))
            except Exception:
                r["bars"] = False
        if r["bars"]:
            continue
        if any(hamming(r["phash"], k["phash"]) <= 6 for k in kept):
            continue
        if any(hamming(r["phash"], g) <= 4 for g in generic):
            continue   # 取得元の多くのページに出る共通画像(バナー・ロゴ)
        if face_fraction(RAW_IMG / r["file"]) > 0.04:
            continue   # 顔が主役の画像(インタビュー写真)は使わない
        if "clip" not in r:   # 中身の判定(結果は index.json に残す)
            import imgjudge
            sc, lb = imgjudge.judge(RAW_IMG / r["file"])
            with _idx_lock:
                r["clip"] = sc
                r["clip_label"] = lb
        if r.get("clip") is not None and r["clip"] < MIN_CLIP:
            continue   # 人物・建物・画面・図・車・AMR だけ などの写真
        if r.get("clip_label") and r["clip_label"] in BAD_LABELS:
            continue   # 点数が足りても、最も近い文が悪い例(工場の全景・AMR だけ・人物)なら使わない(ループ 8)
        im = Image.open(RAW_IMG / r["file"])
        im = ImageOps.exif_transpose(im).convert("RGB")
        tb, (tw, th) = shrink(im, THUMB_PX)
        db, (dw, dh) = shrink(im, DETAIL_PX)
        img_id = hashlib.sha256(tb).hexdigest()[:16]
        THUMB.mkdir(parents=True, exist_ok=True)
        DETAIL.mkdir(parents=True, exist_ok=True)
        (THUMB / f"{img_id}.webp").write_bytes(tb)
        (DETAIL / f"{img_id}.webp").write_bytes(db)
        kept.append({
            "id": img_id, "thumb": {"w": tw, "h": th, "bytes": len(tb)}, "detail": {"w": dw, "h": dh, "bytes": len(db)},
            "phash": r["phash"], "source_image_url": c["url"], "source_page_url": page_url,
            "credit": (rec["sources"][0].get("publisher") or domain_of(page_url)) + f"({domain_of(page_url)})",
            "license_note": "著作権法47条の5(所在検索)に基づく縮小版。元の画像・ページは出典リンク先", "hand_bbox": None,
            "kind": "photo", "alt_ja": c.get("alt") or None, "retrieved_at": r["retrieved_at"], "policy": "stored",
            "orig": {"w": r["w"], "h": r["h"]}, "relevance": r.get("clip"),
        })
    # 代表画像 = 「ハンドがワークを扱っている」らしさが最も高いもの
    kept.sort(key=lambda k: -(k.get("relevance") or 0))
    rec["images"] = kept
    if kept:
        log.ok(page_url, f"画像 {len(kept)} 枚(試行 {tried})")
        return rec, "ok"
    log.fail(page_url, f"使える画像が無い(候補 {len(cands)}, 試行 {tried})")
    return rec, "none"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", nargs="*")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    idx = jload(IDX, {})
    policy = load_image_policy()
    log = RunLog("images")
    import imgjudge
    if imgjudge.available():
        print("画像の中身判定: CLIP ViT-B/32 を使う")
    paths = sorted((DATA / "classified").glob("*.json"))
    recs = [jload(p) for p in paths]
    recs = [r for r in recs if not a.ids or r["id"] in a.ids]
    counts = {}
    # 同じドメインが続くと 2 秒待ちが直列になるので、取得元をまぜる
    recs.sort(key=lambda r: (hash(r["id"]) % 97))
    # 取得元ごとの「共通画像」: まず全候補の URL 単位で、同じ取得元の 3 ページ以上に出る画像 URL を集める(ダウンロード前に除ける)
    url_df = {}
    for r in recs:
        src = (r.get("sources") or [{}])[0].get("publisher")
        for c in dict.fromkeys(c["url"] for c in r.get("image_candidates", [])):
            url_df[(src, c)] = url_df.get((src, c), 0) + 1
    common_urls = {u for (s, u), n in url_df.items() if n >= 3}
    for r in recs:
        r["image_candidates"] = [c for c in r.get("image_candidates", []) if c["url"] not in common_urls]
    # 取得済みの画像のうち、同じ phash が 3 ページ以上に出るもの(URL が違っても同じバナー)
    ph_df = {}
    for v in idx.values():
        if v.get("ok"):
            ph_df[v["phash"]] = ph_df.get(v["phash"], 0) + 1
    generic = {p for p, n in ph_df.items() if n >= 3}
    with cf.ThreadPoolExecutor(a.workers) as ex:
        for rec, st in ex.map(lambda r: process_case(r, idx, policy, log, a.force, generic), recs):
            counts[st] = counts.get(st, 0) + 1
            if st != "skip":
                jdump(rec, DATA / "classified" / f"{rec['id']}.json")
    jdump(idx, IDX)
    print(counts)
    log.save()


if __name__ == "__main__":
    main()
