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
