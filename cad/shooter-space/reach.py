"""MoMa のアームで、TP 箱を水平に持って棚の通路側の面に出し入れできる高さを計算する。

側面（肩J2を通り棚に直角な鉛直面）の2次元で考える。r = 肩からの水平距離（棚の方向が正）、h = 床からの高さ。
フック式ハンドは箱の短辺の取っ手穴に爪を掛け、端面で持つ。手先は水平で、手首(J5)は箱の端面から
(J5→フランジ＋ハンドの長さ) だけ手前（通路側）にある。

条件:
  1. 肩→手首の距離が腕の長さ×REACH_RATIO 以下（肘の解は上下2つのどちらか）
  2. 上腕・前腕・手首・ハンドが、車体＋進入禁止域、床、棚の面にぶつからない
  3. 手首の負荷モーメント（箱＋ハンド）が許容内
停止位置（棚の面から肩までの距離 F）は高さごとに変えてよい（MoMa が前後に寄る）。
"""
import math
import params as P


def seg_rect_dist(p, q, rect):
    """線分 pq と長方形 rect=(r0,r1,h0,h1) の最短距離（交われば 0）。"""
    r0, r1, h0, h1 = rect
    def inside(a): return r0 <= a[0] <= r1 and h0 <= a[1] <= h1
    if inside(p) or inside(q): return 0.0
    best = 1e9
    for t in [i / 40 for i in range(41)]:
        x = (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)
        if inside(x): return 0.0
        dx = max(r0 - x[0], 0, x[0] - r1); dy = max(h0 - x[1], 0, x[1] - h1)
        best = min(best, math.hypot(dx, dy))
    return best


def ik_elbows(j2, w):
    L1, L2 = P.ARM_L1, P.ARM_L2
    dx, dy = w[0] - j2[0], w[1] - j2[1]; d = math.hypot(dx, dy)
    if d > (L1 + L2) * P.REACH_RATIO or d < abs(L1 - L2) + 1: return []
    a = math.atan2(dy, dx); b = math.acos(max(-1, min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))))
    return [(j2[0] + L1 * math.cos(a + s * b), j2[1] + L1 * math.sin(a + s * b)) for s in (1, -1)]


def feasible(z, F, box_L, box_kg=None):
    """箱の中心の高さ z（mm）、棚の面から肩までの距離 F で出し入れできるか。理由も返す。"""
    box_kg = P.TP_FULL_KG if box_kg is None else box_kg
    j2 = (0.0, float(P.MOMA_J2_H))
    tool = P.ARM_J5_FLANGE + P.HOOK_LEN
    tcp = (F + P.BOX_END_IN, z)                 # 箱の端面の中心
    w = (tcp[0] - tool, z)                      # 手首 J5
    m = box_kg * 9.81 * (tool + box_L / 2) / 1000 + P.HOOK_KG * 9.81 * (P.ARM_J5_FLANGE + P.HOOK_LEN / 2) / 1000
    if m > P.J5_MOMENT: return False, "手首の負荷"
    els = ik_elbows(j2, w)
    if not els: return False, "腕が届かない"
    body = (-(P.BODY_HALF + P.KEEP_OUT), P.BODY_HALF + P.KEEP_OUT, -1e4, P.BODY_H + P.KEEP_OUT)
    floor = (-1e5, 1e5, -1e5, P.FLOOR_CLEAR)
    rack = (F - P.RACK_CLEAR, 1e5, -1e5, 1e5)
    why = "車体に当たる"
    for e in els:
        segs = [(j2, e, P.LINK_R[0]), (e, w, P.LINK_R[1]), (w, (tcp[0] - 5, z), P.HOOK_HALF_H)]
        ok = True
        for a, b, rad in segs:
            if seg_rect_dist(a, b, body) < rad: ok = False; why = "車体に当たる"; break
            if seg_rect_dist(a, b, floor) < rad: ok = False; why = "床に当たる"; break
            if seg_rect_dist(a, b, rack) < rad and not (b == (tcp[0] - 5, z)): ok = False; why = "棚に当たる"; break
        if ok: return True, ""
    return False, why


def usable_range(box_L=None, F_list=None, step=5):
    """使える箱の中心の高さの範囲と、高さごとに使える停止距離。"""
    box_L = box_L or P.TP[P.MAIN]["L"]
    F_min = P.CLEARANCE_MIN + P.BODY_HALF
    F_list = F_list or list(range(int(F_min), int(P.STANDOFF_MAX) + 1, 25))
    table = []
    for z in range(0, 2600, step):
        okF = [F for F in F_list if feasible(z, F, box_L)[0]]
        table.append((z, okF))
    zs = [z for z, f in table if f]
    return (min(zs), max(zs)) if zs else (None, None), table


if __name__ == "__main__":
    (lo, hi), table = usable_range()
    print(f"使える箱の中心の高さ: {lo}〜{hi} mm（{P.MAIN}・部品入り{P.TP_FULL_KG}kg）")
    for z, f in table[::20]:
        print(f"{z:5d}mm  " + (f"F {f[0]}〜{f[-1]}" if f else "不可  " + feasible(z, P.CLEARANCE_MIN + P.BODY_HALF, P.TP[P.MAIN]['L'])[1]))
