"""骨組みの部品（パイプ・ジョイント・ローラーレール・ストッパー）。BOMも数える。"""
import math
from collections import Counter
import cadquery as cq
from params import PIPE_D, JOINT, RAIL_W, RAIL_H, ROLLER_D, ROLLER_PITCH


class Bom:
    def __init__(self):
        self.pipes = Counter()     # 長さ(mm, 10mm単位に丸め) -> 本数
        self.joints = 0
        self.rail_mm = 0.0
        self.rails = 0
        self.rollers = 0
        self.stoppers = 0

    def rows(self):
        out = [("イレクターパイプ Φ28", f"{L}mm", n) for L, n in sorted(self.pipes.items(), reverse=True)]
        out += [("ジョイント（簡略）", "-", self.joints), ("ローラーレール", f"計 {self.rail_mm/1000:.2f}m（{self.rails}本）", self.rails),
                ("ローラー", f"Φ{ROLLER_D:.0f}・{ROLLER_PITCH:.0f}mm間隔", self.rollers), ("前端ストッパー", "-", self.stoppers)]
        return out

    @property
    def pipe_m(self):
        return sum(L * n for L, n in self.pipes.items()) / 1000


def pipe(p0, p1, bom: Bom) -> cq.Workplane:
    v = cq.Vector(*p1) - cq.Vector(*p0)
    L = v.Length
    bom.pipes[int(round(L / 10) * 10)] += 1
    s = cq.Solid.makeCylinder(PIPE_D / 2, L, cq.Vector(*p0), v.normalized())
    return cq.Workplane("XY").add(s)


def joint(p, bom: Bom) -> cq.Workplane:
    bom.joints += 1
    return cq.Workplane("XY").box(JOINT, JOINT, JOINT).translate(p)


def rail(x, y0, y1, z0, z1, bom: Bom) -> cq.Workplane:
    """ローラーレール。上面（ローラーの頂点）が (y0,z0)→(y1,z1) を結ぶ線になる。"""
    L = math.hypot(y1 - y0, z1 - z0)
    ang = math.degrees(math.atan2(z1 - z0, y1 - y0))
    bom.rail_mm += L
    bom.rails += 1
    ch = cq.Workplane("XY").box(RAIL_W, L, RAIL_H - 4, centered=(True, False, False)).translate((0, 0, -RAIL_H))
    ch = ch.cut(cq.Workplane("XY").box(RAIL_W - 6, L, RAIL_H, centered=(True, False, False)).translate((0, 0, -RAIL_H + 3)))
    n = int(L // ROLLER_PITCH)
    rl = cq.Workplane("XY")
    for i in range(n):
        yy = (i + 0.5) * L / n
        rl = rl.add(cq.Solid.makeCylinder(ROLLER_D / 2, RAIL_W - 10, cq.Vector(-(RAIL_W - 10) / 2, yy, -ROLLER_D / 2), cq.Vector(1, 0, 0)))
    bom.rollers += n
    asm = ch.add(rl.vals())
    return asm.rotate((0, 0, 0), (1, 0, 0), ang).translate((x, y0, z0))


def stopper(xc, width, y, z, bom: Bom, h=35.0) -> cq.Workplane:
    bom.stoppers += 1
    return cq.Workplane("XY").box(width, 3, h, centered=(True, False, False)).translate((xc, y, z))
