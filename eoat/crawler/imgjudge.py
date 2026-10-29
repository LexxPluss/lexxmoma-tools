# -*- coding: utf-8 -*-
"""画像の中身の判定(4-4「内容の確認」): CLIP(ViT-B/32, ゼロショット)で「ロボットのハンドがワークを扱っている写真」らしさを点数にする。

- 良い例と悪い例(人物・建物・画面・図・ロゴ・車・AMR だけ・風景・文字。ループ 8 で「人とロボットが一緒」「工場の全景」「工作機械だけ」を追加)の文を用意し、softmax の確率を合計する
- 戻り値 (score, label): score = 良い例の確率の合計(0〜1)、label = 最も近い文の種類
- モデルは最初の呼び出しで読み込む(CPU で 1 枚 0.1〜0.2 秒)。open_clip が無ければ (None, None) を返し、呼び出し側は規則だけで判断する
"""
import threading

_lock = threading.Lock()
_state = {"model": None, "pre": None, "tok": None, "text": None, "labels": None, "failed": False}

GOOD = [
    "a photo of a robot gripper picking up an object",
    "an industrial robot arm with a gripper handling a workpiece",
    "a collaborative robot arm with a vacuum gripper lifting a box",
    "a close-up of a robotic gripper or suction cup holding a part",
    "a robot end effector tool for gripping",
    "a robot gripper product photo on a plain background",
    "a robot palletizing boxes with a gripper",
    "a robot picking items from a bin with a gripper",
    "a robot arm lifting a sack or bag with a bag gripper",
    "a suction gripper lifting a glass sheet, panel or tray",
    "a robot hand grasping a bottle, tube or small part",
    "a soft robotic gripper holding food",
]
BAD = [
    "a portrait photo of a person",
    "people standing and talking in an office or factory",
    "a person looking at a tablet or computer screen",
    "the exterior of a building",
    "a screenshot of a software user interface",
    "a diagram, flowchart or technical drawing",
    "a company logo",
    "a car or vehicle",
    "a mobile robot or forklift driving in a warehouse without a robot arm",
    "a landscape or street scene",
    "a sign with text",
    "a factory production line overview photo with no robot gripper visible",
    "food or products on a table with no robot",
    "a person standing next to a robot arm and talking or posing",
    "a worker operating a machine or holding a part by hand",
    "a group of people posing for a photo in a factory",
    "a trade show booth with visitors",
    "a wide view of a factory floor with machines and no gripper visible",
    "a cartoon mascot or illustration",
    "a photo of a machine tool or CNC machine with its door closed",
    # ループ 10c の抜き取りで残っていた誤り(メーカーの事例ページの代表画像が設備・看板になりやすい)
    "a conveyor belt system with no robot arm",
    "the outside of an enclosed industrial machine or cabinet",
    "a banner or poster with large text",
    "a stack of products, cans or boxes with no robot",
    "a camera or sensor product photo",
]


def _load():
    with _lock:
        if _state["model"] is not None or _state["failed"]:
            return
        try:
            import open_clip
            import torch
            model, _, pre = open_clip.create_model_and_transforms("ViT-B-32", pretrained="openai")
            model.eval()
            tok = open_clip.get_tokenizer("ViT-B-32")
            with torch.no_grad():
                t = model.encode_text(tok(GOOD + BAD))
                t = t / t.norm(dim=-1, keepdim=True)
            _state.update(model=model, pre=pre, tok=tok, text=t, labels=GOOD + BAD)
        except Exception as e:   # open_clip が無い・モデルが落とせない
            print(f"  (画像の中身判定は使えません: {str(e)[:80]})")
            _state["failed"] = True


def judge(path):
    """(良い例の確率の合計, 最も近い文) を返す。使えないときは (None, None)。"""
    _load()
    if _state["failed"]:
        return None, None
    import torch
    from PIL import Image
    try:
        im = Image.open(path).convert("RGB")
    except Exception:
        return 0.0, "unreadable"
    with torch.no_grad():
        x = _state["pre"](im).unsqueeze(0)
        f = _state["model"].encode_image(x)
        f = f / f.norm(dim=-1, keepdim=True)
        probs = (100.0 * f @ _state["text"].T).softmax(dim=-1)[0]
    good = float(probs[: len(GOOD)].sum())
    label = _state["labels"][int(probs.argmax())]
    return round(good, 3), label


def available():
    _load()
    return not _state["failed"]
