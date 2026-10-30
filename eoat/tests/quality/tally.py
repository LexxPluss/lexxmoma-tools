import json,sys,collections
rows=[r for f in sys.argv[1:] for r in json.load(open(f))]
F=["is_case","categories","tasks","principles","materials","robot_maker","robot_model","robot_class","mass_kg"]
out={}
for f in F:
    c=collections.Counter(r.get(f) for r in rows)
    out[f]={"wrong":c["wrong"],"missing":c["missing"],"ok":c["ok"],"na":c["na"],"err_rate":round((c["wrong"]+c["missing"])/len(rows),3)}
im=collections.Counter(v for r in rows for v in (r.get("images") or {}).values())
out["images"]={"bad":im["bad"],"total":sum(im.values()),"bad_rate":round(im["bad"]/max(1,sum(im.values())),3)}
print(len(rows),"cases"); 
for k,v in out.items(): print(k,v)
