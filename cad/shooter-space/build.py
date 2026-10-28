"""全案を作って書き出す: STEP（FreeCADで開ける）・陰影画像・寸法図・部材表・まとめ（report.md）。

    python3 build.py            # out/ に出力
"""
import csv, json, math, os, sys, time
import cadquery as cq
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, Rectangle
import params as P
from shooter import build
from tp import tp_container
from variants import VARIANTS

OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)
plt.rcParams["font.family"] = ["IPAGothic", "IPAPGothic", "sans-serif"]
COL = {"frame": (0.92, 0.90, 0.83), "rail": (0.70, 0.73, 0.76), "stop": (0.25, 0.28, 0.31), "panel": (0.75, 0.85, 0.95),
       "TP-341.5B": (0.18, 0.43, 0.70), "TP-331.5B": (0.24, 0.60, 0.37), "TP-391.5B": (0.90, 0.56, 0.15)}


def compound(wps):
    vals = []
    for w in wps:
        vals += [o for o in w.vals() if isinstance(o, cq.Shape)]
    return cq.Compound.makeCompound(vals)


def export_variant(r):
    m = r["meta"]
    asm = cq.Assembly(name=m["name"])
    asm.add(compound(r["frame"]), name="frame_pipe", color=cq.Color(*COL["frame"]))
    asm.add(compound(r["rails"]), name="roller_rail", color=cq.Color(*COL["rail"]))
    asm.add(compound(r["stops"]), name="stopper", color=cq.Color(*COL["stop"]))
    by = {}
    for t, b in r["boxes"]:
        by.setdefault(t, []).append(b)
    for t, bs in by.items():
        asm.add(compound(bs), name=t.replace(".", "_"), color=cq.Color(*COL[t]))
    if r["panels"]:
        asm.add(compound(r["panels"]), name="line_side_panel", color=cq.Color(*COL["panel"], 0.4))
    asm.save(os.path.join(OUT, f"{m['name']}.step"))
    # 描画用 STL（部位ごと）
    stl = {}
    for key, wps in (("frame", r["frame"]), ("rail", r["rails"]), ("stop", r["stops"]), ("panel", r["panels"])):
        if wps:
            f = os.path.join(OUT, f".{m['name']}_{key}.stl"); cq.exporters.export(cq.Workplane().add(compound(wps)), f, tolerance=1.5, angularTolerance=0.4); stl[key] = f
    for t, bs in by.items():
        f = os.path.join(OUT, f".{m['name']}_{t}.stl"); cq.exporters.export(cq.Workplane().add(compound(bs)), f, tolerance=1.0, angularTolerance=0.3); stl[t] = f
    return stl


def render(stl, path, view, size=(1400, 1000), extra=None):
    import vtk
    r = vtk.vtkRenderer(); r.SetBackground(1, 1, 1)
    w = vtk.vtkRenderWindow(); w.SetOffScreenRendering(1); w.AddRenderer(r); w.SetSize(*size); w.SetMultiSamples(8)
    for key, f in stl.items():
        rd = vtk.vtkSTLReader(); rd.SetFileName(f)
        nm = vtk.vtkPolyDataNormals(); nm.SetInputConnection(rd.GetOutputPort()); nm.SetFeatureAngle(35)
        mp = vtk.vtkPolyDataMapper(); mp.SetInputConnection(nm.GetOutputPort())
        a = vtk.vtkActor(); a.SetMapper(mp); a.GetProperty().SetColor(*COL[key]); a.GetProperty().SetSpecular(0.1); a.GetProperty().SetAmbient(0.25); a.GetProperty().SetDiffuse(0.8)
        if key == "panel": a.GetProperty().SetOpacity(0.25)
        r.AddActor(a)
    for poly, color, op in (extra or []):
        mp = vtk.vtkPolyDataMapper(); mp.SetInputData(poly)
        a = vtk.vtkActor(); a.SetMapper(mp); a.GetProperty().SetColor(*color); a.GetProperty().SetOpacity(op); a.GetProperty().LightingOff(); r.AddActor(a)
    cam = r.GetActiveCamera()
    b = r.ComputeVisiblePropBounds(); cx, cy, cz = (b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2
    cam.SetFocalPoint(cx, cy, cz); cam.SetViewUp(0, 0, 1)
    d = 1
    cam.SetPosition(*{"aisle": (cx + 2600 * d, cy + 3800 * d, cz + 1700), "line": (cx + 2400, cy - 3900, cz + 1500),
                      "side": (cx + 4500, cy, cz + 300)}[view])
    r.ResetCamera(); cam.Zoom(1.25)
    lk = vtk.vtkLightKit(); lk.SetKeyLightIntensity(0.95); lk.AddLightsToRenderer(r)
    w.Render()
    f = vtk.vtkWindowToImageFilter(); f.SetInput(w); f.Update()
    pw = vtk.vtkPNGWriter(); pw.SetFileName(path); pw.SetInputConnection(f.GetOutputPort()); pw.Write()


def floor_zones(m):
    """床の区分（ライン側の作業域＝緑、通路＝青）を薄い板で描く。"""
    import vtk
    out = []
    for y0, y1, c in ((-1500, 0, (0.24, 0.70, 0.44)), (m["depth"], m["depth"] + P.AISLE_W, (0.0, 0.41, 0.72))):
        p = vtk.vtkPlaneSource(); p.SetOrigin(-200, y0, 1); p.SetPoint1(m["width"] + 200, y0, 1); p.SetPoint2(-200, y1, 1); p.Update()
        out.append((p.GetOutput(), c, 0.15))
    return out


# ---------- 2D 寸法図（matplotlib） ----------
def dim(ax, p0, p1, text, off=(0, 0), color="#34495e", fs=8, rot=None):
    ax.annotate("", xy=p1, xytext=p0, arrowprops=dict(arrowstyle="<->", color=color, lw=0.8, shrinkA=0, shrinkB=0))
    mx, my = (p0[0] + p1[0]) / 2 + off[0], (p0[1] + p1[1]) / 2 + off[1]
    if rot is None: rot = 90 if abs(p1[0] - p0[0]) < abs(p1[1] - p0[1]) else 0
    ax.text(mx, my, text, ha="center", va="center", fontsize=fs, color=color, rotation=rot,
            bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.9))


KIND_NAME = {"pick": "取り出し", "return": "空箱返却", "returnf": "空箱返却（平ら）", "reserve": "予備在庫（MoMa）"}


def side_section(m, ax, col):
    from shooter import lv_z
    D, Hb = m["lane_len"], P.TP[P.MAIN]["H"]
    ax.add_patch(Rectangle((-1500, P.PICK_MIN), 1500, P.PICK_TOP_MAX - P.PICK_MIN, color="#3EB370", alpha=0.12))
    ax.text(-750, P.PICK_TOP_MAX + 40, f"人の取り出し域 {P.PICK_MIN}〜{P.PICK_TOP_MAX}", ha="center", fontsize=8, color="#23864f")
    cmax = P.moma_center_max()
    ax.plot([D, D + P.AISLE_W], [cmax, cmax], color="#0068B7", lw=0.8, ls="--"); ax.text(D + P.AISLE_W / 2, cmax + 30, f"MoMaが箱の中心を上げられる上限 {cmax:.0f}", ha="center", fontsize=7.5, color="#0068B7")
    ax.plot([D, D + P.AISLE_W], [P.MOMA_CENTER_MIN] * 2, color="#0068B7", lw=0.8, ls="--"); ax.text(D + P.AISLE_W / 2, P.MOMA_CENTER_MIN + 30, f"下限 {P.MOMA_CENTER_MIN}", ha="center", fontsize=7.5, color="#0068B7")
    ax.add_patch(Rectangle((D, 0), P.AISLE_W, 40, color="#0068B7", alpha=0.15)); ax.text(D + P.AISLE_W / 2, 80, f"通路 {P.AISLE_W}", ha="center", fontsize=8, color="#0068B7")
    ax.add_patch(Rectangle((-1500, 0), 1500, 40, color="#3EB370", alpha=0.25)); ax.text(-750, 80, "ライン側", ha="center", fontsize=8, color="#23864f")
    ax.plot([-1600, D + P.AISLE_W + 100], [0, 0], color="#555", lw=1)
    for y in (P.PIPE_D / 2, D - P.PIPE_D / 2):
        ax.add_patch(Rectangle((y - P.PIPE_D / 2, 0), P.PIPE_D, m["height"], color="#c8c2ad"))
    for x in [x for x in m["lanes"] if x["col"] == col]:
        l = m["levels"][x["level"]]; k = x["kind"]; tt = P.TP[x["type"]]
        z = lambda y: lv_z(l, k, y)
        ax.plot([0, D], [z(0), z(D)], color="#7f8c8d", lw=2.2, solid_capstyle="butt")
        a = math.atan((z(D) - z(0)) / D)
        for i in range(x.get("n", 0)):
            y0 = P.STOP_OFF + i * (tt["L"] + P.BOX_GAP) if k == "pick" else D - 20 - (i + 1) * tt["L"] - i * P.BOX_GAP
            c = [(y0, z(y0)), (y0 + tt["L"] * math.cos(a), z(y0) + tt["L"] * math.sin(a))]
            c += [(c[1][0] - Hb * math.sin(a), c[1][1] + Hb * math.cos(a)), (y0 - Hb * math.sin(a), z(y0) + Hb * math.cos(a))]
            fc = [v for kk, v in COL.items() if kk == x["type"]][0]
            ax.add_patch(Polygon(c, closed=True, fc=fc, ec="#1d3c5a", lw=0.6, alpha=0.85 if k == "pick" else 0.6))
        if k.startswith("return"):
            y0 = D - 20 - tt["L"]; c = [(y0, z(y0)), (D - 20, z(D - 20)), (D - 20, z(D - 20) + Hb), (y0, z(y0) + Hb)]
            ax.add_patch(Polygon(c, closed=True, fc="#e3e8ec", ec="#8a99a5", lw=0.6, ls="--"))
        ax.text(-60, z(0) + Hb / 2, f"{KIND_NAME[k]}\n{z(0):.0f}", ha="right", va="center", fontsize=7.2, color="#2c3e50")
        ax.text(D + 60, z(D) + Hb / 2, f"{z(D):.0f}", ha="left", va="center", fontsize=7.2, color="#2c3e50")
        if k == "reserve":
            ax.add_patch(Rectangle((-8, z(0) - P.STRUCT_BELOW), 5, Hb + P.STRUCT_BELOW + 15, color="#5AA0DC", alpha=0.5))
    dim(ax, (0, -160), (D, -160), f"奥行き {D:.0f}")
    dim(ax, (D + 330, 0), (D + 330, m["height"]), f"高さ {m['height']:.0f}")
    ax.set_xlim(-1600, D + P.AISLE_W + 100); ax.set_ylim(-260, max(2000, m["height"] + 150)); ax.set_aspect("equal"); ax.axis("off")


def front_view(m, ax):
    from shooter import lv_z
    Hb, pitch = P.TP[P.MAIN]["H"], m["pitch"]
    ax.plot([-100, m["width"] + 100], [0, 0], color="#555", lw=1)
    ax.add_patch(Rectangle((-80, P.PICK_MIN), m["width"] + 160, P.PICK_TOP_MAX - P.PICK_MIN, color="#3EB370", alpha=0.10))
    for c in range(m["cols"] + 1):
        ax.add_patch(Rectangle((c * pitch - P.PIPE_D / 2, 0), P.PIPE_D, m["height"], color="#c8c2ad"))
    for x in m["lanes"]:
        l = m["levels"][x["level"]]; tt = P.TP[x["type"]]; xc = (x["col"] + 0.5) * pitch; z0 = lv_z(l, x["kind"], 0)
        ax.plot([x["col"] * pitch, (x["col"] + 1) * pitch], [z0, z0], color="#7f8c8d", lw=2)
        if x["kind"].startswith("return"):
            ax.add_patch(Rectangle((xc - tt["W"] / 2, z0), tt["W"], Hb, fc=(0.85, 0.88, 0.9), ec="#8a99a5", lw=0.6, ls="--"))
            ax.text(xc, z0 + Hb / 2, "空箱返却", ha="center", va="center", fontsize=6.5, color="#555")
        elif x.get("n", 0) > 0:
            ax.add_patch(Rectangle((xc - tt["W"] / 2, z0), tt["W"], Hb, fc=COL[x["type"]], ec="#1d3c5a", lw=0.6, alpha=0.9 if x["kind"] == "pick" else 0.45))
            ax.text(xc, z0 + Hb / 2, x["type"].replace("TP-", "") + f"×{x['n']}", ha="center", va="center", fontsize=6.5, color="white")
        if x["kind"] == "reserve":
            ax.add_patch(Rectangle((x["col"] * pitch, z0 - P.STRUCT_BELOW), pitch, Hb + P.STRUCT_BELOW + 15, fc="#bcd3ea", alpha=0.3, ec="none", hatch="//"))
    ax.text(m["width"] / 2, -70, "斜線：ライン側は閉じ板（予備在庫はMoMaが通路側から）", ha="center", fontsize=7.5, color="#195d96")
    dim(ax, (-P.PIPE_D / 2, m["height"] + 120), (m["width"] - P.PIPE_D / 2, m["height"] + 120), f"幅 {m['width']:.0f}")
    dim(ax, (0, m["height"] + 40), (pitch, m["height"] + 40), f"間口ピッチ {pitch:.0f}", fs=7)
    ax.set_xlim(-200, max(2400, m["width"] + 200)); ax.set_ylim(-140, max(2150, m["height"] + 220)); ax.set_aspect("equal"); ax.axis("off")


def drawing(m, path):
    cols = sorted({x["col"] for x in m["lanes"] if x["kind"].startswith("return")}) or []
    secs = [0] + ([cols[0]] if cols and cols[0] != 0 else [])
    fig, axs = plt.subplots(1, len(secs) + 1, figsize=(8 * len(secs) + 8, 8.2), gridspec_kw=dict(width_ratios=[1.25] * len(secs) + [1]))
    for ax, c in zip(axs, secs):
        side_section(m, ax, c); ax.set_title(f"側面（列{c + 1}の断面・ライン側が左）" + ("：空箱返却の列" if c in cols else ""), fontsize=10)
    front_view(m, axs[-1]); axs[-1].set_title("ライン側から見た正面", fontsize=10)
    fig.suptitle(f"{m['title']}\n外形 {m['width']:.0f}×{m['depth']:.0f}×{m['height']:.0f}mm／床 {m['area_m2']:.2f}m²／{m['capacity']}箱・{m['sku']}品番／{m['per_m2']:.1f}箱/m²／体積効率 {m['vol_eff']*100:.0f}%", fontsize=11.5)
    fig.text(0.01, 0.01, "単位 mm。数字は置き面の高さ（左＝ライン側、右＝通路側）。TP外寸・パイプ径は掲載値、レール・隙間・勾配・MoMaの値は仮値（params.py）。", fontsize=8, color="#555")
    fig.tight_layout(rect=(0, 0.03, 1, 0.93)); fig.savefig(path, dpi=120); plt.close(fig)


def footprint(metas, path):
    fig, ax = plt.subplots(figsize=(11, 6.2))
    colors = ["#8a99a5", "#d08a2c", "#0068B7"]; x0 = 0
    for m, c in zip(metas, colors):
        ax.add_patch(Rectangle((x0, 0), m["width"], m["depth"], fc=c, alpha=0.25, ec=c, lw=1.5))
        ax.add_patch(Rectangle((x0, m["depth"]), m["width"], P.AISLE_W, fc=c, alpha=0.07, ec=c, lw=0.8, ls="--"))
        ax.text(x0 + m["width"] / 2, m["depth"] / 2, f"{m['title'].split('：')[0]}\n{m['width']:.0f}×{m['depth']:.0f}\n{m['area_m2']:.2f}m²・{m['capacity']}箱\n{m['per_m2']:.1f}箱/m²", ha="center", va="center", fontsize=9)
        ax.text(x0 + m["width"] / 2, m["depth"] + P.AISLE_W / 2, f"通路込み {m['area_aisle_m2']:.2f}m²", ha="center", va="center", fontsize=8, color="#555")
        x0 += m["width"] + 400
    ax.plot([-200, x0], [0, 0], color="#3EB370", lw=2); ax.text(-150, -120, "ライン側の面", fontsize=8, color="#23864f")
    ax.set_xlim(-300, x0); ax.set_ylim(-300, 3400); ax.set_aspect("equal"); ax.axis("off")
    ax.set_title(f"真上から見た床面積（{P.MAIN}・単位mm）", fontsize=11)
    fig.tight_layout(); fig.savefig(path, dpi=130); plt.close(fig)


def main():
    t0 = time.time(); metas = []
    # TPコンテナ単体
    tps = {}
    for i, name in enumerate(P.TP):
        b = tp_container(name); cq.exporters.export(b, os.path.join(OUT, f"{name}.step"))
        f = os.path.join(OUT, f".{name}.stl"); cq.exporters.export(b.translate((i * 0 + sum(P.TP[n]["L"] + 150 for n in list(P.TP)[:i]), 0, 0)), f, tolerance=0.5); tps[name] = f
    render(tps, os.path.join(OUT, "tp_containers.png"), "aisle", size=(1400, 700))
    for v in VARIANTS:
        r = build(v); m = r["meta"]; metas.append(m)
        stl = export_variant(r)
        for view in ("aisle", "line"):
            render(stl, os.path.join(OUT, f"{m['name']}_{view}.png"), view, extra=floor_zones(m))
        drawing(m, os.path.join(OUT, f"{m['name']}_drawing.png"))
        with open(os.path.join(OUT, f"{m['name']}_bom.csv"), "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f); w.writerow(["部材", "寸法", "数量"]); w.writerows(m["bom"].rows())
        print(m["name"], f"{time.time() - t0:.0f}s", flush=True)
    footprint(metas, os.path.join(OUT, "footprint_compare.png"))
    summary = [dict(name=m["name"], title=m["title"], width=round(m["width"]), depth=round(m["depth"]), height=round(m["height"]),
                    area_m2=round(m["area_m2"], 3), area_aisle_m2=round(m["area_aisle_m2"], 3), boxes=m["boxes"], capacity=m["capacity"],
                    sku=m["sku"], per_m2=round(m["per_m2"], 1), vol_eff=round(m["vol_eff"] * 100, 1), ret_line=round(m["ret_line"]),
                    pick_top=round(m["pick_top"]), moma_center=[round(v) for v in m["moma_center"]],
                    levels=[dict(kinds=l["kinds"], zf=round(l["zf"], 1)) for l in m["levels"]],
                    pipe_m=round(m["bom"].pipe_m, 1), joints=m["bom"].joints, rail_m=round(m["bom"].rail_mm / 1000, 1)) for m in metas]
    json.dump(summary, open(os.path.join(OUT, "summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for f in os.listdir(OUT):
        if f.startswith(".") and f.endswith(".stl"): os.remove(os.path.join(OUT, f))
    import zipfile   # 組立の STEP は大きいので zip にもまとめる（リポジトリには zip だけを入れる）
    with zipfile.ZipFile(os.path.join(OUT, "shooter_variants_step.zip"), "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for m in metas:
            z.write(os.path.join(OUT, f"{m['name']}.step"), f"{m['name']}.step")
    print("done", f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
