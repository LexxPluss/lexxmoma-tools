"""比較する案。shooter.design() で段の構成を決める。"""
from shooter import design

VARIANTS = [
    design(4, 3, "top", low=0, high=0, name="A_conventional",
           title="A 従来型：傾斜ローラー 4列×3段×奥3箱＋最上段に空箱返却"),
    design(4, 2, "top", name="E_tall",
           title="E 本案：4列×奥2箱、足元の予備2段＋人の3段＋空箱返却＋頭上の予備2段（予備は押し込み式・MoMa専用）",
           mix={(1, 2): "TP-391.5B", (2, 3): "TP-331.5B"}),
]
