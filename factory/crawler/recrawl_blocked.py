# -*- coding: utf-8 -*-
"""抽出で site_blocked になった会社の公式サイトを取り直す(一時的な 503 や TLS の失敗、JS 描画の見落としのやり直し)。
index.json を消して sites.py をその会社だけ走らせる。再抽出は extract_batches.py --redo site_blocked。
  python recrawl_blocked.py tw|kr
"""
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATA, RAW, jload

cc = sys.argv[1]
ids = []
for p in sorted((DATA / cc / "extracted").glob("*.json")):
    d = jload(p)
    if d.get("status") == "site_blocked":
        idx = RAW / cc / "sites" / p.stem / "index.json"
        if idx.exists():
            idx.unlink()
        ids.append(p.stem)
print("取り直し", len(ids), "社")
if ids:
    subprocess.run([sys.executable, "sites.py", cc, "--workers", "6", "--only", ",".join(ids)], check=False)
