# -*- coding: utf-8 -*-
"""削除・訂正依頼への対応(SPEC §9 / §11-12)。persons.id または 会社+氏名 を指定して、
manual/suppressions.json に登録し、組み立て済みデータからも該当人物の全レコードを除く。

使い方:
  python delete_person.py --person-id E02216-P1a2b3c --reason "本人からの削除依頼 2026-10-01" [--password ...]
  python delete_person.py --company E02216 --name "山田 太郎" --reason "..."
その後(または --rebuild を付けると自動で) build.py を実行して data.enc を更新し、コミットする。手順は people/README.md。
"""
import argparse
import subprocess
import sys
from pathlib import Path

from common import DATA, MANUAL, jdump, jload, normalize_name, today
from build import delete_person


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--person-id")
    ap.add_argument("--company")
    ap.add_argument("--name")
    ap.add_argument("--reason", required=True)
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--password")
    a = ap.parse_args()
    if not a.person_id and not (a.company and a.name):
        sys.exit("--person-id か --company + --name を指定")
    sup = jload(MANUAL / "suppressions.json", {"person_ids": [], "names": [], "log": []})
    if a.person_id and a.person_id not in sup["person_ids"]:
        sup["person_ids"].append(a.person_id)
    if a.name:
        sup["names"].append({"company_id": a.company, "name": a.name})
    sup["log"].append({"date": today(), "person_id": a.person_id, "company_id": a.company, "name_hash": normalize_name(a.name)[:1] + "*" if a.name else None, "reason": a.reason})
    jdump(sup, MANUAL / "suppressions.json")
    # 組み立て済みの平文データがあれば即時に除く(公開側は build で更新)
    p = DATA / "people_all.json"
    if p.exists():
        data = jload(p)
        ids = set(sup["person_ids"])
        if a.name:
            key = normalize_name(a.name)
            ids |= {x["id"] for x in data["persons"] if x["name_key"] == key and (not a.company or x["company_id"] == a.company)}
        for pid in ids:
            delete_person(data, pid)
        jdump(data, p)
        print(f"data/people_all.json から {len(ids)} 名を除きました")
    print(f"manual/suppressions.json に登録しました: {a.person_id or a.name}")
    if a.rebuild:
        cmd = [sys.executable, str(Path(__file__).with_name("build.py"))] + (["--password", a.password] if a.password else [])
        subprocess.check_call(cmd)


if __name__ == "__main__":
    main()
