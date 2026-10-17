const fs=require('fs'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="page-dashboard" class="on"><div id="ws-attendance"></div></div>',{runScripts:'outside-only',url:'https://example.test/#dashboard'});
const w=dom.window,logs=[],saved=[{id:'prior',member:'다른 직원',date:'2026-10-17',clock_in:'10:01',clock_out:'18:03'}];
const prior=structuredClone(saved);let writes=0,failUpdate=false,failRead=false;
w.user={name:'검증 직원'};w.escapeHtml=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;');w.toast=x=>logs.push(x);w.loadDashboard=async()=>{};w.setInterval=()=>0;w.console={error(){}};
w.Date=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-17T15:30:00Z']));}};
class Q{
 constructor(){this.filters=[];this.mode='read';}
 select(){return this;}eq(k,v){this.filters.push(x=>x[k]===v);return this;}is(k,v){this.filters.push(x=>(x[k]??null)===v);return this;}maybeSingle(){this.single=true;return this;}
 insert(x){this.mode='insert';this.value=x;return this;}update(x){this.mode='update';this.value=x;return this;}
 then(resolve,reject){return Promise.resolve().then(()=>{
  if(this.mode==='read'&&failRead)return {data:null,error:{message:'read failed'}};
  if(this.mode==='update'&&failUpdate){failUpdate=false;return {data:null,error:{message:'network failed'}};}
  let found=saved.filter(x=>this.filters.every(f=>f(x)));
  if(this.mode==='insert'){if(saved.some(x=>x.id===this.value.id))return {data:null,error:{code:'23505'}};const x={clock_in:null,clock_out:null,...this.value};saved.push(x);found=[x];writes++;}
  if(this.mode==='update'){found.forEach(x=>Object.assign(x,this.value));writes++;}
  return {data:structuredClone(this.single?found[0]||null:found),error:null};
 }).then(resolve,reject);}
}
w.db={from:name=>{assert.equal(name,'attendances');return new Q();}};
w.eval(fs.readFileSync('workspace-attendance.js','utf8'));
const api=w.CHEROPAttendance,button=type=>w.document.querySelector('[data-ws-clock="'+type+'"]');
(async()=>{
 await w.loadDashboard();assert.equal(writes,0);assert(!button('in').disabled);assert(button('out').disabled);
 await api.record('out');assert.equal(writes,0);await api.load();
 await Promise.all([api.record('in'),api.record('in')]);assert.equal(writes,1);
 const row=saved.find(x=>x.member==='검증 직원');assert.equal(row.date,'2026-10-18');assert.equal(row.clock_in,'00:30');assert.equal(row.clock_out,null);
 assert(button('in').disabled);assert(!button('out').disabled);assert(button('in').textContent.includes('00:30'));
 await api.record('in');assert.equal(writes,1,'existing time must not be overwritten');
 failUpdate=true;await api.record('out');assert.equal(row.clock_out,null);assert(w.document.getElementById('ws-attendance').textContent.includes('저장 실패'));assert(!button('out').textContent.includes('00:30'));
 await api.load();await api.record('out');assert.equal(writes,2);assert.equal(row.clock_out,'00:30');assert(button('out').disabled);
 await api.record('out');assert.equal(writes,2);assert.deepEqual(saved.filter(x=>x.id==='prior'),prior);
 failRead=true;await api.load();assert(button('in').disabled);assert(button('retry'));failRead=false;await api.load();assert(button('out').disabled);
 console.log('PASS: attendance uses existing rows, no startup writes, Seoul date/time, clock-in before clock-out, duplicate-click protection, preserved timestamps, read/write failures and retained history.');
 dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
