"""列数・奥行きの箱数・空箱返却の置き方を総当たりして、条件を満たす中で床面積が最小の案を探す。

条件: 品番数 N_SKU 以上、収納 N_BOX 以上、取り出し段は奥2箱以上（使い切ったときすぐ次の箱がある）、
      空箱を置く高さ（ライン側）RET_MAX 以下、MoMaの届く範囲・棚の高さ上限。
"""
import csv, os
import params as P
from shooter import design, evaluate

OUT = os.path.join(os.path.dirname(__file__), "out")


def search():
    rows = []
    for ret_mode in ("column", "top"):
        for deep in (2, 3):
            for cols in range(3, 9):
                d = design(cols, deep, ret_mode)
                e = evaluate(d)
                ok_sku = e["sku"] >= P.N_SKU
                ok_cap = e["capacity"] >= P.N_BOX
                ok_ret = e["ret_line"] <= P.RET_MAX
                ok_top = e["pick_top"] <= P.PICK_TOP_MAX + 0.5
                ok_moma = e["moma_center"][1] <= P.moma_center_max() + 0.5
                rows.append(dict(name=d["name"], cols=cols, deep=deep, ret_mode=ret_mode, n_low=d["n_low"], n_band=d["n_band"], n_high=d["n_high"],
                                 width=round(e["width"]), depth=round(e["depth"]), height=round(e["height"]), area_m2=round(e["area_m2"], 3),
                                 sku=e["sku"], capacity=e["capacity"], per_m2=round(e["per_m2"], 1), vol_eff=round(e["vol_eff"] * 100, 1),
                                 ret_line=round(e["ret_line"]), ok=ok_sku and ok_cap and ok_ret and ok_top and ok_moma,
                                 why="・".join(x for x, f in (("品番不足", not ok_sku), ("箱数不足", not ok_cap), ("返却が高い", not ok_ret), ("取り出しの箱が高い", not ok_top), ("MoMaが届かない", not ok_moma)) if f)))
    ok = [r for r in rows if r["ok"]]
    ok.sort(key=lambda r: (r["area_m2"], -r["capacity"]))
    return rows, ok


if __name__ == "__main__":
    rows, ok = search()
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "optimize.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    print(f"MoMaが箱の中心を上げられる最大 {P.moma_center_max():.0f}mm")
    for r in sorted(rows, key=lambda r: (not r["ok"], r["area_m2"])):
        print(("OK " if r["ok"] else "-- ") + f'{r["name"]:16} 床{r["area_m2"]:.2f}m² {r["width"]}x{r["depth"]}x{r["height"]} 段 下{r["n_low"]}+人{r["n_band"]}+上{r["n_high"]} 品番{r["sku"]} 箱{r["capacity"]} {r["per_m2"]}箱/m² 体積効率{r["vol_eff"]}% 返却{r["ret_line"]} {r["why"]}')
