# -*- coding: utf-8 -*-
"""削除依頼(4-3): 事例・画像・ドメイン単位で manual/suppressions.json に登録し、次のビルドから除く。
使い方:
  python delete_case.py --case <id> --reason "依頼日・経路"
  python delete_case.py --image <画像id> --reason "…"
  python delete_case.py --domain example.com --reason "…"     # そのサイトの事例をすべて
登録後に build.py を実行して暗号化データを更新する(7 営業日以内)。log には依頼者の氏名を残さない。"""
import argparse

from common import MANUAL, jdump, jload, today


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--case")
    ap.add_argument("--image")
    ap.add_argument("--domain")
    ap.add_argument("--reason", required=True)
    a = ap.parse_args()
    p = MANUAL / "suppressions.json"
    sup = jload(p, {"cases": [], "images": [], "domains": [], "log": []})
    if a.case:
        sup["cases"].append({"id": a.case, "reason": a.reason, "date": today()})
    if a.image:
        sup["images"].append({"id": a.image, "reason": a.reason, "date": today()})
    if a.domain:
        sup["domains"].append(a.domain)
    sup["log"].append({"date": today(), "what": a.case or a.image or a.domain, "reason": a.reason})
    jdump(sup, p)
    print(f"登録しました → {p}。build.py を実行して反映してください")


if __name__ == "__main__":
    main()
