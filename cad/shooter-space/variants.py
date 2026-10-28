"""比較する案。levels は下から順。"""
import params as P

VARIANTS = [
    dict(name="A_conventional", title="A 従来型：傾斜ローラー 4列×3段×奥3箱＋空箱返却",
         main=P.MAIN, cols=4, deep=3, levels=["pick", "pick", "pick", "return"]),
    dict(name="B_band_only", title="B 帯の中だけで奥行きを縮める：6列×3段×奥2箱（人手のみ）",
         main=P.MAIN, cols=6, deep=2, levels=["pick", "pick", "pick", "return"]),
    dict(name="C_vertical", title="C 縦型省スペース：4列×3段×奥2箱＋足元の予備段2段",
         main=P.MAIN, cols=4, deep=2, levels=["reserve", "reserve", "pick", "pick", "pick", "return"],
         mix={(1, 2): "TP-391.5B", (2, 3): "TP-331.5B"}),
]
