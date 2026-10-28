"""比較する案。shooter.design() で段の構成を決める。"""
from shooter import design

VARIANTS = [
    design(4, 3, "top", low=0, high=0, name="A_conventional",
           title="A 従来型：傾斜ローラー 4列×3段×奥3箱＋最上段に空箱返却"),
    design(5, 2, "column", name="D_tall",
           title="D 縦型・高さ活用：5列×奥2箱、足元2段＋人の3段＋頭上3段（MoMa専用の予備は押し込み式）",
           mix={(1, 2): "TP-391.5B", (2, 3): "TP-331.5B"}),
]
