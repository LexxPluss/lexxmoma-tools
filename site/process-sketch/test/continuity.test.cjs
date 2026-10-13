const test = require('node:test');
const assert = require('node:assert/strict');
const PS = require('../src/core.js');
function base() {
 const d=PS.newDoc();d.area={w:6000,h:4000};
 d.objs.push(PS.makeObj('walk',0,0,{pts:[{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}]}));return d;
}
test('unreachable transport cannot cross wall or advance to the next task',()=>{
 const d=base();d.objs.push(PS.makeObj('wall',3000,2000,{w:500,h:4000}),PS.makeObj('worker',1000,2000));
 const sim=new PS.Sim(d),a=sim.ag[0];a.plan=[{k:'go',to:{x:5000,y:2000}},{k:'idle',t:1}];sim.run(5);
 assert.equal(a.x,1000);assert.equal(a.cur.k,'go');assert(sim.warn.length);
 assert.deepEqual(PS.findPath(sim.g,a,{x:5000,y:2000}).pts,[]);
});
test('missing walkway and inaccessible work position are blocked',()=>{
 const d=PS.newDoc(),g=PS.buildGrid(d);
 assert.equal(PS.findPath(g,{x:1000,y:1000},{x:2000,y:1000}).ok,false);
 const o=PS.makeObj('process',3000,2000),p=PS.accessPoint(d,g,o,'in');assert.equal(p.ok,false);
});
test('break retains task, held parts and station presence but pauses work',()=>{
 const d=base();const w=PS.makeObj('worker',1000,2000);d.objs.push(w);
 const sim=new PS.Sim(d),a=sim.ag[0];sim.breakWindow={start:1,end:3};a.plan=[{k:'idle',t:10}];a.carry=3;a.atStation='machine';
 sim.step(1);const left=a.cur.t0;
 assert.equal(sim.opPresent({id:'machine',op:w.id}),false);
 sim.step(1);sim.step(1);assert.equal(a.cur.t0,left);assert.equal(a.carry,3);
 assert.equal(sim.opPresent({id:'machine',op:w.id}),true);sim.step(1);assert(a.cur.t0<left);
});
test('day uses one full continuous run and actual completed quantity',()=>{
 const d=base();d.day={hours:.5,breakMin:10,robotAvail:100};d.objs.push(PS.makeObj('worker',1000,2000));
 const src=PS.makeObj('in',1000,500,{interval:10}),sink=PS.makeObj('out',5000,500);d.objs.push(src,sink);
 d.flows=[{id:'flow',from:src.id,to:sink.id,mode:'auto'}];const r=PS.simulateDay(d);
 assert(Math.abs(r.main.simSec-1800)<1e-6);assert.equal(r.perDay,r.main.done);assert.equal(r.breakStart,600);assert.equal(r.breakEnd,1200);assert(r.perDay>0);
 const ref=new PS.Sim(JSON.parse(JSON.stringify(d)));ref.breakWindow={start:600,end:1200};
 while(ref.t<1800-1e-8)ref.step(Math.min(.2,1800-ref.t));assert.equal(ref.results().done,r.perDay);
});
test('exports recalculate and preserve comparison snapshot',()=>{
 const fs=require('node:fs');const ui=fs.readFileSync(require('node:path').join(__dirname,'../src/ui.js'),'utf8');
 const report=ui.slice(ui.indexOf('$("#btnReport").onclick'),ui.indexOf('function syncHeader'));
 assert(report.includes('const r = calcDay()'));assert(report.includes('PSX.report(snapshot, r.main'));
 assert(ui.includes('const r = calcDay(); download(fname("csv"), PSX.csv(doc, r.main))'));
});
function routineCell(){
 // 部品置き場 → 前処理台(人5秒) → 加工機(人1秒+自動10秒) → 搬出口 を1人が決めた順番で回す
 const d=base();d.day={hours:1,breakMin:0,robotAvail:100};
 const part=PS.makeObj('part',5000,1000,{item:'A',ports:{out:'W'},portAuto:{out:false}});
 const pre=PS.makeObj('process',3000,3000,{w:1000,h:600,autoT:0,manT:5,ports:{in:'N',out:'N',op:'N'},portAuto:{in:false,out:false,op:false},portShared:true});
 const mc=PS.makeObj('process',1000,1500,{w:1200,h:1200,autoT:10,manT:1,ports:{in:'E',out:'E',op:'E'},portAuto:{in:false,out:false,op:false},portShared:true});
 const out=PS.makeObj('out',5000,3200,{ports:{in:'W'},portAuto:{in:false}});
 const w=PS.makeObj('worker',3000,2000,{handle:1});
 d.objs.push(part,pre,mc,out,w);
 const F=(a,b)=>{const f={id:'f'+d.flows.length,from:a.id,to:b.id,agent:w.id,mode:'hand',batch:1};d.flows.push(f);return f;};
 const f1=F(part,pre),f2=F(pre,mc),f3=F(mc,out);pre.op=mc.op=w.id;
 w.routineOn=true;w.routine=[{k:'pick',f:f1.id,t:0.5},{k:'go',t:2},{k:'place',f:f1.id,t:1},{k:'work',st:pre.id},{k:'pick',f:f2.id,t:1},{k:'go',t:1.5},
  {k:'place',f:f2.id,t:3},{k:'pick',f:f3.id,t:1},{k:'work',st:mc.id},{k:'go',t:2},{k:'place',f:f3.id,t:1},{k:'go',t:1.5},{k:'other',t:4,every:2}];
 return {d,w,f1,f3,pre,mc};
}
test('fixed routine repeats the entered times exactly (walking legs with set seconds)',()=>{
 const {d}=routineCell();const r=PS.simulateDay(d),rt=r.main.agents[0].routine;
 assert(rt.laps>50);assert.deepEqual(r.main.warn,[]);
 // 0.5+2+1+5+1+1.5+3+1+1+2+1+1.5 + 4秒を2周に1回(=2) = 22.5
 assert(Math.abs(rt.lapAvg-22.5)<0.05,`lap ${rt.lapAvg}`);
 rt.steps.forEach(s=>{if(s.set!=null)assert(Math.abs(s.avg-s.set)<0.05,`${s.label}: ${s.avg} vs ${s.set}`);});
 assert(Math.abs(r.perDay-3600/22.5)<=2);
});
test('routine skips steps handed to another agent and waits for the parts',()=>{
 const {d,f1}=routineCell();const rb=PS.makeObj('robot',4000,1000);d.objs.push(rb);f1.agent=rb.id;
 const r=PS.simulateDay(d),w=r.main.agents.find(a=>a.type==='worker');
 assert.equal(w.routine.steps[0].avg,0);assert.equal(w.routine.steps[2].avg,0);
 assert(r.perDay>0);assert(w.ratio.idle>0);
 const fl=r.main.flows.find(f=>f.id===f1.id);assert(fl.trips>0);
});
test('routine validates references and missing duties',()=>{
 const {d,w,f3}=routineCell();w.routine=w.routine.filter(s=>s.f!==f3.id);w.routine.push({k:'work',st:'nothing'});
 const sim=new PS.Sim(JSON.parse(JSON.stringify(d)));
 assert(sim.warn.some(x=>x.includes('手順に入っていません')));assert(sim.warn.some(x=>x.includes('作業する設備が見つかりません')));
});
