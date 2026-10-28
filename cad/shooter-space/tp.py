"""TP規格コンテナの3Dモデル（外寸・内寸は掲載値、細部は簡略）。"""
import cadquery as cq
from params import TP, TP_FOOT, TP_RIM


def tp_container(name: str, empty: bool = False) -> cq.Workplane:
    t = TP[name]
    L, W, H, iL, iW, iH = t["L"], t["W"], t["H"], t["iL"], t["iW"], t["iH"]
    # 胴：上縁の下から底まで、外側に 3mm ずつの抜き勾配
    body_h = H - TP_RIM - TP_FOOT
    body = (cq.Workplane("XY").workplane(offset=TP_FOOT).rect(L - 12, W - 12)
            .workplane(offset=body_h).rect(L - 6, W - 6).loft())
    rim = cq.Workplane("XY").workplane(offset=H - TP_RIM).rect(L, W).extrude(TP_RIM)
    # 底の嵌合部：下の箱の内寸に入る大きさ
    foot = cq.Workplane("XY").rect(iL - 6, iW - 6).extrude(TP_FOOT)
    box = body.union(rim).union(foot)
    # 内側の空洞（上から内寸の深さ、底へ向けて細くなる）
    cav = (cq.Workplane("XY").workplane(offset=H - iH).rect(iL - 8, iW - 8)
           .workplane(offset=iH + 1).rect(iL, iW).loft())
    box = box.cut(cav)
    # 短辺の取っ手穴
    for s in (-1, 1):
        hole = (cq.Workplane("YZ").workplane(offset=s * L / 2 - (12 if s > 0 else -12))
                .center(0, H - 40).slot2D(110, 26).extrude(24 * s, both=True))
        box = box.cut(hole)
    return box
