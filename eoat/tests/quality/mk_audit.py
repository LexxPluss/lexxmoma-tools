# 使い方: python mk_audit.py <seed> <n> <out_prefix> [exclude_ids.json]
import json,random,sys,yaml
from PIL import Image,ImageDraw,ImageFont
E="/home/user/lexxmoma-tools/eoat"
seed,n,pre=int(sys.argv[1]),int(sys.argv[2]),sys.argv[3]
excl=set(json.load(open(sys.argv[4]))) if len(sys.argv)>4 else set()
L={}
for f,key in (("categories","groups"),("principles","groups")):
    for g in yaml.safe_load(open(f"{E}/taxonomy/{f}.yaml"))[key]:
        for it in g["items"]: L[it["key"]]=g["label"]+">"+it["label"]
for t in yaml.safe_load(open(f"{E}/taxonomy/tasks.yaml"))["tasks"]: L[t["key"]]=t["label"]
for m in yaml.safe_load(open(f"{E}/taxonomy/materials.yaml"))["materials"]: L["m:"+m["key"]]=m["label"]
cs=[r for r in json.load(open(f"{E}/data/cases.json"))["cases"] if r["id"] not in excl]
random.seed(seed); pick=random.sample(cs,n)
font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",26)
pk=[]
for i in range(0,n,10):
    W=Image.new("RGB",(3*400,10*300),"white"); d=ImageDraw.Draw(W)
    for j,r in enumerate(pick[i:i+10]):
        for k,im in enumerate(r["images"][:3]):
            I=Image.open(f"{E}/data/img/detail/{im['id']}.webp").convert("RGB"); I.thumbnail((390,290)); W.paste(I,(k*400,j*300))
            d.rectangle([k*400,j*300,k*400+70,j*300+32],fill="yellow"); d.text((k*400+4,j*300+2),f"{i+j+1}-{k+1}",fill="black",font=font)
    W.save(f"{pre}_img_{i//10+1}.jpg",quality=82)
for i,r in enumerate(pick):
    ex=json.load(open(f"{E}/data/extracted/{r['id']}.json"))
    fs=(r.get("fieldSources") or {}).get("end_effector.principles") or {}
    pk.append({"no":i+1,"id":r["id"],"url":r["sources"][0]["url"],"title":ex.get("title"),"text":ex.get("text","")[:6000],
      "current":{"categories":[L.get(c,c) for c in r["workpiece"]["categories"]],"workpiece_name":r["workpiece"].get("name"),
        "tasks":[L.get(t,t) for t in r["tasks"]],"principles":[L.get(p,p) for p in r["end_effector"]["principles"]],"principles_basis":fs.get("method"),
        "materials":[L.get("m:"+m,m) for m in r["workpiece"]["materials"]],"robot_maker":r["robot"].get("maker"),"robot_model":r["robot"].get("model"),
        "robot_class":r["robot"].get("class"),"is_mobile":r["robot"].get("is_mobile_manipulator"),"mass_kg":r["workpiece"].get("mass_kg"),"payload_class":r["payload_class"]},
      "images":[f"{i+1}-{k+1}" for k in range(len(r["images"][:3]))]})
json.dump(pk,open(f"{pre}.json","w"),ensure_ascii=False,indent=1)
json.dump([r["id"] for r in pick],open(f"{pre}_ids.json","w"))
print(len(pk),"cases,",(n+9)//10,"image sheets")
