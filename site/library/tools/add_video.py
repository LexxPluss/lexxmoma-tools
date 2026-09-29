"""動画を資料室用に変換する(GitHub Pages の 1ファイル100MB 上限に収める)

使い方:
    python tools/add_video.py "<元の動画.mp4>" <出力名(英数字)> [--poster 秒]

    例) python tools/add_video.py "C:/Users/.../02-Mobile Manipulator video.mp4" lexxmoma-demo --poster 232

出力:
    videos/<出力名>.mp4   … H.264/AAC・720p以下・faststart(再生開始が速い)。上限に収まるようビットレートを自動計算
    thumbs/<出力名>.jpg   … サムネイル(--poster の秒数のコマ。省略時は動画の1/3地点)
最後に materials.js へ貼る行を表示します。元の動画は変更しません。

必要なもの: pip install imageio-ffmpeg
"""
import argparse, os, re, subprocess, sys, tempfile

import imageio_ffmpeg

LIMIT_MB = 92          # 100MB 上限に対する余裕込みの目標
AUDIO_K = 96
MAX_V_K = 2500         # 短い動画でも無駄に大きくしない上限
MIN_V_K = 350          # これ未満になる長さなら画質が厳しいので警告

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FF = imageio_ffmpeg.get_ffmpeg_exe()


def probe(src):
    out = subprocess.run([FF, "-hide_banner", "-i", src], capture_output=True, text=True, encoding="utf-8", errors="replace").stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", out)
    if not m:
        sys.exit("動画の長さを読み取れませんでした: " + src)
    h, mi, s = m.groups()
    dur = int(h) * 3600 + int(mi) * 60 + float(s)
    wh = re.search(r"Video: .*?(\d{3,5})x(\d{3,5})", out)
    height = int(wh.group(2)) if wh else 720
    return dur, height


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("name", help="出力ファイル名(英数字とハイフン)")
    ap.add_argument("--poster", type=float, help="サムネイルにするコマの秒数")
    a = ap.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9-]+", a.name):
        sys.exit("出力名は英数字とハイフンのみにしてください")

    dur, height = probe(a.src)
    v_k = int(LIMIT_MB * 8 * 1024 / dur - AUDIO_K)
    v_k = min(v_k, MAX_V_K)
    if v_k < MIN_V_K:
        print(f"注意: {dur/60:.1f}分と長いため映像ビットレートが {v_k}kbps になります。画質が気になる場合は動画を分割してください。")
    vf = ["-vf", "scale=-2:720"] if height > 720 else []

    out = os.path.join(HERE, "videos", a.name + ".mp4")
    poster = os.path.join(HERE, "thumbs", a.name + ".jpg")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    os.makedirs(os.path.dirname(poster), exist_ok=True)
    log = os.path.join(tempfile.gettempdir(), "lib_ffpass_" + a.name)
    common = [FF, "-y", "-hide_banner", "-loglevel", "error", "-i", a.src, *vf, "-c:v", "libx264", "-preset", "slow", "-b:v", f"{v_k}k"]
    print(f"変換中… 長さ {int(dur//60)}:{int(dur%60):02d} / 映像 {v_k}kbps(2パス)")
    subprocess.run(common + ["-pass", "1", "-passlogfile", log, "-an", "-f", "mp4", os.devnull], check=True)
    subprocess.run(common + ["-maxrate", f"{int(v_k*1.5)}k", "-bufsize", f"{v_k*3}k", "-pass", "2", "-passlogfile", log,
                             "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", f"{AUDIO_K}k", "-movflags", "+faststart", out], check=True)
    t = a.poster if a.poster is not None else dur / 3
    subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error", "-ss", str(t), "-i", a.src, *vf, "-frames:v", "1", "-q:v", "4", poster], check=True)

    mb = os.path.getsize(out) / 1024 / 1024
    print(f"完了: videos/{a.name}.mp4 ({mb:.1f}MB)" + ("  ※100MBを超えています" if mb >= 100 else ""))
    print("\nmaterials.js に追加する例:")
    print(f'''  {{
    id: "{a.name}", cat: "video", type: "video",
    title: "", desc: "",
    src: "videos/{a.name}.mp4", thumb: "thumbs/{a.name}.jpg", meta: "{int(dur//60)}:{int(dur%60):02d}", updated: "",
  }},''')


if __name__ == "__main__":
    main()
