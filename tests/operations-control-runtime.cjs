const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
// Only generated fixtures are used; no production fixture input.
const fixture=require('./sections-fixture.cjs');
const tables={app_state:[{id:'cherop_main',data:structuredClone(fixture),updated_at:'2026-10-17T01:00:00Z'}],tasks:[],leaves:[{id:'leave-test',status:'approved',member:'테스트직원',type:'half_am',start_date:'2026-10-17',end_date:'2026-10-17'}],products:[]};
tables.app_state[0].data.routines={'테스트대표':[{id:'r-existing',label:'기존 반복 업무'}]};tables.app_state[0].data.routine_done={'2020-01-01':{'테스트대표':['r-existing']}};tables.app_state[0].data.memos=[{id:'memo-existing',author:'테스트대표',title:'기존 메모',content:'보존할 본문',date:'2026-10-01'}];let writes=0;
class Q{constructor(table){this.table=table;this.filters=[];this.mode='read';}select(){return this}eq(k,v){this.filters.push(x=>String(x[k])===String(v));return this}is(k,v){this.filters.push(x=>(x[k]??null)===v);return this}in(k,v){this.filters.push(x=>v.includes(x[k]));return this}like(k,v){const r=new RegExp('^'+v.replaceAll('%','.*')+'$');this.filters.push(x=>r.test(x[k]));return this}order(){return this}range(a,b){this.bounds=[a,b];return this}limit(n){this.bounds=[0,n-1];return this}single(){this.one=true;return this}maybeSingle(){this.one=true;return this}insert(v){this.mode='insert';this.value=v;return this}update(v){this.mode='update';this.value=v;return this}upsert(v){this.mode='upsert';this.value=v;return this}delete(){this.mode='delete';return this}then(resolve,reject){try{let rows=tables[this.table]??=[];let found=rows.filter(x=>this.filters.every(f=>f(x)));if(this.mode==='insert'||this.mode==='upsert'){writes++;const vals=Array.isArray(this.value)?this.value:[this.value];found=vals.map(x=>structuredClone(x));for(const x of found){if(this.mode==='upsert'){const at=rows.findIndex(r=>r.id===x.id);if(at>=0){rows[at]=x;continue;}}if(x.id===undefined)x.id=rows.length+1;rows.push(x);}}if(this.mode==='update'){writes++;for(const x of found)Object.assign(x,structuredClone(this.value));}if(this.mode==='delete'){writes++;tables[this.table]=rows.filter(x=>!found.includes(x));}if(this.bounds)found=found.slice(this.bounds[0],this.bounds[1]+1);return Promise.resolve({data:structuredClone(this.one?found[0]||null:found),error:null}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject)}}}
const dom=new JSDOM(html,{url:'https://cherop-koko.github.io/cheropworkspace/#dashboard',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false});w.console=console;w.supabase={createClient:()=>({from:t=>new Q(t),storage:{from:()=>({upload:async()=>({error:null}),getPublicUrl:p=>({data:{publicUrl:'https://example.com/'+p}})})}})};w.setInterval=()=>0;w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};
const ctx=dom.getInternalVMContext();
for(const node of w.document.scripts){if(node.src){const local=node.src.split('/').at(-1).split('?')[0];if(local.startsWith('workspace-')&&local!=='workspace-start.js')vm.runInContext(fs.readFileSync(local,'utf8'),ctx,{filename:local});}else if(!node.textContent.includes('cleanupBrokenRoutineKeys();\nboot();'))vm.runInContext(node.textContent,ctx,{filename:'index-inline'});}
vm.runInContext("MEMBERS[0].name='테스트대표';MEMBERS[1].name='테스트직원';MEMBERS[2].name='테스트담당자';user=MEMBERS[0];",ctx);
const api=w.CHEROPSections;assert(api);
const wait=()=>new Promise(r=>setTimeout(r,30));
async function route(page,sub=''){w.location.hash='#'+page+(sub?'/'+encodeURIComponent(sub):'');vm.runInContext(`renderPage(${JSON.stringify(page)},${JSON.stringify(sub)})`,ctx);await wait();}
function click(selector){const el=w.document.querySelector(selector);assert(el,selector);el.click();return el;}
async function submit(values){const form=w.document.querySelector('#pf-form');assert(form);for(const[k,v]of Object.entries(values)){const el=form.elements.namedItem(k);assert(el,k);el.value=v;}form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait();}
async function save(values){const form=w.document.querySelector('#w5-dialog form');assert(form);for(const[k,v]of Object.entries(values)){const el=form.elements.namedItem(k);assert(el,k);if(el.type==='checkbox')el.checked=v;else el.value=v;}form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait();await wait();const error=w.document.querySelector('#w5-dialog [role=alert]')?.textContent;assert(!error,error);}
const main=()=>tables.app_state.find(x=>x.id==='cherop_main').data;
(async()=>{
 const target=main().proj_tasks[0];
 target.assignee='테스트직원';target.status='ing';
 main().task_meta??={};
 main().task_meta['project:'+target.id]={preserve:'keep',ai_control:{role:'시스템·데이터',next_action:'<img src=x onerror=alert(1)> 검증',evidence:'',dependency_ids:['task:900','task:missing'],last_reviewed_at:'2026-10-29T01:00:00Z'}};
 tables.tasks.push({id:900,title:'선행 작업',status:'done',assignee:'테스트담당자'});
 main().task_meta['task:900']={legacy:'preserve',ai_control:{role:'재무·성과',evidence:'확인 기록',dependency_ids:[]}};
 const before=structuredClone(tables);
 await route('tasks','operations');
 assert.equal(w.document.querySelector('[data-w6=tab][aria-pressed=true]').dataset.id,'operations');
 assert(w.document.querySelector('.oc-view'));
 assert(w.document.querySelector('.oc-view').textContent.includes('조회')||w.document.querySelector('.oc-readonly'));
 assert(w.document.querySelector('.oc-table').textContent.includes('테스트직원'),'all team tasks visible despite prior me filter');
 assert(w.document.querySelector('.oc-table').textContent.includes('참조 확인 필요: task:missing'));
 assert(!w.document.querySelector('.oc-table img'),'metadata is escaped');
 const role=w.document.querySelector('[data-w6-filter=opsRole]');assert.equal(role.options.length,9);role.value='시스템·데이터';role.dispatchEvent(new w.Event('change',{bubbles:true}));await wait();
 assert.equal(w.document.querySelectorAll('.oc-table tbody tr').length,1);
 assert(w.document.querySelector('.oc-table').textContent.includes('검증'));
 const mode=w.document.querySelector('[data-w6-filter=opsMode]');mode.value='blocked';mode.dispatchEvent(new w.Event('change',{bubbles:true}));await wait();assert.equal(w.document.querySelectorAll('.oc-table tbody tr').length,1);
 const count=w.document.querySelector('.oc-summary').textContent;assert(count.includes('선행 업무 대기'));
 const form=w.document.querySelector('[data-w6-search]');form.elements.query.value='no matching task';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait();assert(w.document.querySelector('.oc-empty'));
 assert.equal(writes,0,'navigation/filter/search do not write');assert.deepEqual(tables,before,'source records and metadata remain identical');
 api.states.ps.query='';await route('tasks','operations');click('.oc-title');await wait();assert(w.document.querySelector('#w5-dialog form'),'source task opens existing editor');assert.equal(writes,0,'opening original editor does not write');
 console.log('PASS: AI control route, team-wide view, seven role filters, dependency checks, metadata escaping, search, zero writes, unchanged source records and existing editor links.');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
