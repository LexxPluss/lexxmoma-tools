"""段の並び（下から順）を渡すと、隙間のルールを満たす最小の高さで段を積み、骨組み・レール・箱を配置する。"""
import math
import cadquery as cq
import params as P
from parts import Bom, pipe, joint, rail, stopper
from tp import tp_container


def lane_pitch(w):
    return w + 2 * P.SIDE_CLEAR + P.PIPE_D


def capacity(lane_len, L, rear_min=20.0):
    return int((lane_len - P.STOP_OFF - rear_min + P.BOX_GAP) // (L + P.BOX_GAP))


def solve_levels(kinds, D):
    """各段の置き面の高さ z(y) = zf + s*y を決める。s: 取り出し +勾配、返却 -勾配、予備 0。"""
    slope = {"pick": P.SLOPE, "return": -P.SLOPE, "reserve": 0.0}
    H = P.TP[P.MAIN]["H"]
    out = []
    for k in kinds:
        s = slope[k]
        if not out:
            zf = P.FLOOR_MIN if k != "pick" else P.PICK_MIN
        else:
            lo = out[-1]
            gf, gb = P.GAP[lo["kind"]]
            need_f = lo["zf"] + H + gf + P.STRUCT_BELOW                          # ライン側 y=0
            need_b = lo["zf"] + lo["s"] * D + H + gb + P.STRUCT_BELOW - s * D    # 通路側 y=D
            zf = max(need_f, need_b)
            if k == "pick":
                zf = max(zf, P.PICK_MIN)
        out.append(dict(kind=k, s=s, zf=round(zf, 1), zb=round(zf + s * D, 1)))
    return out


def build(v):
    """v: 案の定義（variants.py）。戻り値: dict(parts=[(name, color, Workplane)], meta=...)"""
    main = P.TP[v["main"]]
    W, L, Hb = main["W"], main["L"], main["H"]
    pitch = lane_pitch(W)
    cols = v["cols"]
    lane_len = P.STOP_OFF + v["deep"] * L + (v["deep"] - 1) * P.BOX_GAP + P.REAR_CLEAR
    D = lane_len
    lv = solve_levels(v["levels"], D)
    bom = Bom()
    frame, rails, stops, boxes, empties, panels = [], [], [], [], [], []
    xs = [i * pitch for i in range(cols + 1)]
    xc = lambda c: (c + 0.5) * pitch
    post_y = [P.PIPE_D / 2, D - P.PIPE_D / 2] + ([D / 2] if D > 1300 else [])
    top_box = max(l["zf"] if l["s"] <= 0 else l["zb"] for l in lv) + Hb
    Htop = top_box + 60
    # 支柱
    for x in xs:
        for y in post_y:
            frame.append(pipe((x, y, 0), (x, y, Htop), bom))
    # 天井と床の枠
    for z in (40, Htop - P.PIPE_D / 2):
        for y in (post_y[0], post_y[1]):
            frame.append(pipe((xs[0], y, z), (xs[-1], y, z), bom))
        for x in (xs[0], xs[-1]):
            frame.append(pipe((x, post_y[0], z), (x, post_y[1], z), bom))
    bom.joints += len(xs) * len(post_y) * 2
    z_at = lambda l, y: l["zf"] + l["s"] * y
    sku = 0
    fill_left = P.N_BOX
    lanes_meta = []
    for li, l in enumerate(lv):
        for y in post_y:   # 受けパイプ（X方向）
            zc = z_at(l, y) - P.RAIL_H - P.PIPE_D / 2
            frame.append(pipe((xs[0], y, zc), (xs[-1], y, zc), bom))
            bom.joints += len(xs)
        for x in xs:       # 間口のガイドパイプ（Y方向）
            frame.append(pipe((x, 0, z_at(l, 0) + P.GUIDE_H), (x, D, z_at(l, D) + P.GUIDE_H), bom))
            bom.joints += 2
        for c in range(cols):
            t = v.get("mix", {}).get((c, li), v["main"]) if l["kind"] != "return" else v["main"]
            tt = P.TP[t]
            for s in (-1, 1):
                rails.append(rail(xc(c) + s * (tt["W"] / 2 - P.RAIL_INSET), 0, D, z_at(l, 0), z_at(l, D), bom))
            if l["kind"] == "return":
                stops.append(stopper(xc(c), pitch - P.PIPE_D - 4, D - 3, z_at(l, D), bom))
                lanes_meta.append(dict(level=li, col=c, kind="return", type=t, n=0, cap=capacity(lane_len, tt["L"])))
                continue
            stops.append(stopper(xc(c), pitch - P.PIPE_D - 4, 0, z_at(l, 0), bom))
            cap = capacity(lane_len, tt["L"])
            n = cap if l["kind"] == "pick" else 0
            lanes_meta.append(dict(level=li, col=c, kind=l["kind"], type=t, n=n, cap=cap, sku=(sku if l["kind"] == "pick" else None)))
            if l["kind"] == "pick":
                sku += 1
    # 予備段の箱：残りの数を、取り出し段と同じ品番の予備として下の段から詰める
    picks = sum(m["n"] for m in lanes_meta)
    rest = max(0, P.N_BOX - picks)
    for m in lanes_meta:
        if m["kind"] == "reserve" and rest > 0:
            m["n"] = min(m["cap"], rest)
            rest -= m["n"]
    # 箱を置く
    ang = lambda l: math.degrees(math.atan(l["s"]))
    for m in lanes_meta:
        l = lv[m["level"]]
        tt = P.TP[m["type"]]
        for i in range(m["n"]):
            if m["kind"] == "reserve":     # 通路側から詰める
                y0 = D - 20 - (i + 1) * tt["L"] - i * P.BOX_GAP
            else:
                y0 = P.STOP_OFF + i * (tt["L"] + P.BOX_GAP)
            b = tp_container(m["type"]).rotate((0, 0, 0), (0, 0, 1), 90)   # 長手を奥行き方向へ
            b = b.translate((0, tt["L"] / 2, 0)).rotate((0, 0, 0), (1, 0, 0), ang(l)).translate((xc(m["col"]), y0, z_at(l, y0)))
            boxes.append((m["type"], b))
    # ライン側の閉じ板（帯の外。予備段があるときだけ）
    if any(l["kind"] == "reserve" for l in lv):
        pk = [l for l in lv if l["kind"] == "pick"]
        z_lo = pk[0]["zf"] - P.STRUCT_BELOW - 10
        panels.append(cq.Workplane("XY").box(xs[-1] - xs[0], 5, z_lo - 60, centered=(False, False, False)).translate((0, -5, 60)))
    width = xs[-1] - xs[0] + P.PIPE_D
    depth = D + (5 if panels else 0)          # 閉じ板（厚さ5mm）はライン側の面の外に付く
    meta = dict(name=v["name"], title=v["title"], cols=cols, deep=v["deep"], width=width, depth=depth, lane_len=D,
                height=Htop, levels=lv, lanes=lanes_meta, pitch=pitch,
                boxes=sum(m["n"] for m in lanes_meta), capacity=sum(m["cap"] for m in lanes_meta if m["kind"] != "return"),
                sku=sku, bom=bom, area_m2=width * depth / 1e6, area_aisle_m2=width * (depth + P.AISLE_W) / 1e6)
    return dict(frame=frame, rails=rails, stops=stops, boxes=boxes, panels=panels, meta=meta)
