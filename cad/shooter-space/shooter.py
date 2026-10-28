"""シューターの生成。段（下から順）× 列ごとに間口の種類を決め、隙間のルールとMoMaの届く範囲を満たす最小の高さで積む。

間口の種類:
  pick    取り出し（人）。ライン側へ下る勾配。通路側からMoMaが入れる
  return  空箱返却。人がライン側から置き、通路側へ下る勾配でMoMaの前へ流れる
  returnf 平らな空箱返却。人が置いて奥へ押す（勾配の分の高さを使わない）
  reserve 予備在庫（MoMa専用・押し込み式）。通路側へ下る勾配。新しい箱で手前の箱を奥へ押し込み、
          手前を取ると奥の箱が転がって出てくる。ライン側は閉じる
"""
import math
import cadquery as cq
import params as P
from parts import Bom, pipe, joint, rail, stopper
from tp import tp_container

SLOPE_OF = {"pick": P.SLOPE, "return": -P.SLOPE, "returnf": 0.0, "reserve": -P.SLOPE}


def lane_pitch(w):
    return w + 2 * P.SIDE_CLEAR + P.PIPE_D


def capacity(lane_len, L, rear_min=20.0):
    return int((lane_len - P.STOP_OFF - rear_min + P.BOX_GAP) // (L + P.BOX_GAP))


def lane_len_of(deep):
    t = P.TP[P.MAIN]
    return P.STOP_OFF + deep * t["L"] + (deep - 1) * P.BOX_GAP + P.REAR_CLEAR


def next_zf(prev, kinds, D, H):
    """直前の段 prev（dict: zf, kinds）の上に、間口の種類 kinds の段を置くときの最小のライン側の置き面。"""
    need = -1e9
    for k_lo, k_up in zip(prev["kinds"], kinds):
        gf, gb = P.GAP[k_lo]
        s_lo, s_up = SLOPE_OF[k_lo], SLOPE_OF[k_up]
        need = max(need, prev["zf"] + H + gf + P.STRUCT_BELOW,
                   prev["zf"] + s_lo * D + H + gb + P.STRUCT_BELOW - s_up * D)
    return need


def stack(rows, D, z0=None):
    """rows: 下から順の kinds のリスト。z0 があれば最下段のライン側の置き面に使う。各段を最小の高さで積む。"""
    H = P.TP[P.MAIN]["H"]
    out = []
    for kinds in rows:
        if not out:
            zf = z0 if z0 is not None else P.FLOOR_MIN
        else:
            zf = next_zf(out[-1], kinds, D, H)
        if "pick" in kinds or any(k.startswith("return") for k in kinds):
            zf = max(zf, P.PICK_MIN)
        out.append(dict(kinds=list(kinds), zf=zf))
    return out


def lv_z(l, k, y):
    return l["zf"] + SLOPE_OF[k] * y


_RANGE = {}


def moma_range():
    """reach.py で計算した、MoMaが箱を水平に出し入れできる箱の中心の高さの範囲（仕様の下限も守る）。"""
    if "r" not in _RANGE:
        import reach
        (lo, hi), table = reach.usable_range()
        _RANGE["r"] = (max(P.MOMA_CENTER_MIN, lo), hi, table)
    return _RANGE["r"]


def design(cols, deep, ret_mode="top", n_ret=None, low=None, high=None, mix=None, title="", name=""):
    """段の構成を自動で決める。
    ret_mode: column = 1列を空箱返却にあてる（人の開口の中で返す） / top = 取り出し段の上に返却段（従来の形）
    low/high: 予備段の段数（None ならMoMaの届く範囲・棚の高さ上限いっぱいまで）
    """
    H = P.TP[P.MAIN]["H"]
    D = lane_len_of(deep)
    c_min, c_max, _ = moma_range()
    # 取り出し域の段数：置き面700以上・箱の上端1500以下で入るだけ
    band = []
    z = P.PICK_MIN
    while z + H <= P.PICK_TOP_MAX:
        band.append(z)
        z = z + H + P.GAP["pick"][0] + P.STRUCT_BELOW
    nb = len(band)
    rows_band = []
    for i in range(nb):
        if ret_mode == "column":   # 端の1列の2段目から上を返却に。最下段は取り出し（返却は通路側へ下るので、下に予備段があると高さを食う）
            rows_band.append(["pick"] * (cols - 1) + (["pick"] if i == 0 else ["returnf"]))
        else:
            rows_band.append(["pick"] * cols)
    if ret_mode == "top":
        rows_band.append(["return"] * cols)
    # 下の予備段：最下段の通路側の箱の中心が MOMA_CENTER_MIN 以上。取り出し1段目が700に収まる最大の段数
    zb0 = max(P.FLOOR_MIN, c_min - H / 2)
    zf0 = zb0 - SLOPE_OF["reserve"] * D
    best_low = 0
    for n in range(0, 8):
        rows = [["reserve"] * cols] * n + rows_band
        lv = stack(rows, D, z0=zf0 if n else None)
        if n and lv[n]["zf"] > P.PICK_MIN + 0.01:
            break
        best_low = n
    n_low = best_low if low is None else low
    rows = [["reserve"] * cols] * n_low + rows_band
    lv = stack(rows, D, z0=zf0 if n_low else None)
    # 上の予備段：通路側の箱の中心がMoMaの届く範囲、棚の上端が高さ上限に収まるだけ
    n_high = 0
    while high is None or n_high < high:
        trial = stack(rows + [["reserve"] * cols] * (n_high + 1), D, z0=zf0 if n_low else None)
        top = trial[-1]
        zb = top["zf"] + SLOPE_OF["reserve"] * D
        top_box = max(max(lv_z(l, k, 0), lv_z(l, k, D)) for l in trial for k in l["kinds"]) + H
        if zb + H / 2 + P.HOOK_LIFT > c_max or top_box + 60 > P.RACK_MAX_H:   # 持ち上げた分も届くこと
            break
        n_high += 1
        if high is not None and n_high >= high:
            break
    rows = rows + [["reserve"] * cols] * n_high
    lv = stack(rows, D, z0=zf0 if n_low else None)
    return dict(name=name or f"c{cols}_d{deep}_{ret_mode}", title=title, cols=cols, deep=deep, D=D, levels=lv,
                ret_mode=ret_mode, n_low=n_low, n_high=n_high, n_band=nb, mix=mix or {})


def evaluate(d):
    """寸法・収納数・人とMoMaの条件をまとめる（3Dは作らない）。"""
    t = P.TP[P.MAIN]; H = t["H"]; D = d["D"]; cols = d["cols"]
    pitch = lane_pitch(t["W"])
    width = cols * pitch + P.PIPE_D
    has_closed = any("reserve" in l["kinds"] for l in d["levels"])
    depth = D + (5 if has_closed else 0)
    top_box = max(max(lv_z(l, k, 0), lv_z(l, k, D)) for l in d["levels"] for k in l["kinds"]) + H
    height = top_box + 60
    lanes = []
    for li, l in enumerate(d["levels"]):
        for c, k in enumerate(l["kinds"]):
            tn = d["mix"].get((c, li), P.MAIN) if k == "pick" else P.MAIN
            lanes.append(dict(level=li, col=c, kind=k, type=tn, cap=capacity(D, P.TP[tn]["L"])))
    pick = [x for x in lanes if x["kind"] == "pick"]
    res = [x for x in lanes if x["kind"] == "reserve"]
    ret = [x for x in lanes if x["kind"].startswith("return")]
    cap = sum(x["cap"] for x in pick + res)
    ret_line = max([d["levels"][x["level"]]["zf"] for x in ret], default=0)
    zbs = [lv_z(d["levels"][x["level"]], x["kind"], D) + H / 2 for x in lanes if not x["kind"].startswith("return")]
    pick_top = max(d["levels"][x["level"]]["zf"] for x in pick) + H if pick else 0
    box_vol = t["L"] * t["W"] * t["H"] / 1e9
    area = width * depth / 1e6
    return dict(width=width, depth=depth, height=height, pitch=pitch, lanes=lanes, sku=len(pick), capacity=cap,
                pick_top=pick_top, pick_boxes=sum(x["cap"] for x in pick), reserve_boxes=sum(x["cap"] for x in res), ret_lanes=len(ret),
                ret_line=ret_line, moma_center=(min(zbs), max(zbs)), area_m2=area,
                area_aisle_m2=width * (depth + P.AISLE_W) / 1e6, per_m2=cap / area,
                vol_eff=cap * box_vol / (width * depth * height / 1e9))


def build(d, fill="full"):
    """3Dを組み立てる。fill: full = すべての間口を満たす / 整数 = その箱数だけ（取り出し段→予備段の順）"""
    e = evaluate(d)
    t = P.TP[P.MAIN]; W, L, Hb = t["W"], t["L"], t["H"]
    pitch, cols, D = e["pitch"], d["cols"], d["D"]
    lv = d["levels"]
    bom = Bom()
    frame, rails, stops, boxes, panels = [], [], [], [], []
    xs = [i * pitch for i in range(cols + 1)]
    xc = lambda c: (c + 0.5) * pitch
    post_y = [P.PIPE_D / 2, D - P.PIPE_D / 2] + ([D / 2] if D > 1300 else [])
    Htop = e["height"]
    for x in xs:
        for y in post_y:
            frame.append(pipe((x, y, 0), (x, y, Htop), bom))
    for z in (40, Htop - P.PIPE_D / 2):
        for y in (post_y[0], post_y[1]):
            frame.append(pipe((xs[0], y, z), (xs[-1], y, z), bom))
        for x in (xs[0], xs[-1]):
            frame.append(pipe((x, post_y[0], z), (x, post_y[1], z), bom))
    bom.joints += len(xs) * len(post_y) * 2
    left = None if fill == "full" else int(fill)
    for m in e["lanes"]:
        l = lv[m["level"]]; k = m["kind"]; c = m["col"]; tt = P.TP[m["type"]]
        z0, z1 = lv_z(l, k, 0), lv_z(l, k, D)
        for y, zz in ((post_y[0], z0), (post_y[1], z1)):      # 間口ごとの受けパイプ（勾配の向きが列で違うため）
            zc = zz - P.RAIL_H - P.PIPE_D / 2
            frame.append(pipe((xs[c], y, zc), (xs[c + 1], y, zc), bom)); bom.joints += 2
        for x in (xs[c], xs[c + 1]):
            frame.append(pipe((x, 0, z0 + P.GUIDE_H), (x, D, z1 + P.GUIDE_H), bom))
        for s in (-1, 1):
            rails.append(rail(xc(c) + s * (tt["W"] / 2 - P.RAIL_INSET), 0, D, z0, z1, bom))
        wst = pitch - P.PIPE_D - 4
        if k == "pick":
            stops.append(stopper(xc(c), wst, 0, z0, bom))
        else:                                                   # 返却・予備は通路側が出口
            stops.append(stopper(xc(c), wst, D - 3, z1, bom, h=P.EXIT_STOP_H))
            if k == "reserve":
                stops.append(stopper(xc(c), wst, 0, z0, bom))
        if k.startswith("return"):
            m["n"] = 0; continue
        n = m["cap"] if left is None else min(m["cap"], left)
        if left is not None and k == "reserve" and any(x["kind"] == "pick" and "n" not in x for x in e["lanes"]):
            n = 0
        m["n"] = n
        if left is not None: left -= n
        ang = math.degrees(math.atan(SLOPE_OF[k]))
        for i in range(n):
            y0 = P.STOP_OFF + i * (tt["L"] + P.BOX_GAP) if k == "pick" else D - 20 - (i + 1) * tt["L"] - i * P.BOX_GAP
            b = tp_container(m["type"]).rotate((0, 0, 0), (0, 0, 1), 90)
            b = b.translate((0, tt["L"] / 2, 0)).rotate((0, 0, 0), (1, 0, 0), ang).translate((xc(c), y0, lv_z(l, k, y0)))
            boxes.append((m["type"], b))
    # ライン側の閉じ板：予備段の範囲
    for li, l in enumerate(lv):
        if all(k == "reserve" for k in l["kinds"]):
            z_lo = l["zf"] - P.STRUCT_BELOW - 5
            z_hi = (lv[li + 1]["zf"] - P.STRUCT_BELOW - 5) if li + 1 < len(lv) else Htop
            if li + 1 < len(lv) and not all(k == "reserve" for k in lv[li + 1]["kinds"]):
                z_hi = l["zf"] + Hb + 20
            panels.append(cq.Workplane("XY").box(xs[-1] - xs[0], 5, max(10, z_hi - max(60, z_lo)), centered=(False, False, False)).translate((0, -5, max(60, z_lo))))
    meta = dict(e, name=d["name"], title=d["title"], cols=cols, deep=d["deep"], lane_len=D, levels=lv, bom=bom,
                boxes=sum(m.get("n", 0) for m in e["lanes"]), ret_mode=d["ret_mode"], n_low=d["n_low"], n_high=d["n_high"])
    return dict(frame=frame, rails=rails, stops=stops, boxes=boxes, panels=panels, meta=meta)
