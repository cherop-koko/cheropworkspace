const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
// Only generated fixtures are used; no production fixture input.
const fixture=require('./sections-fixture.cjs');
const tables={app_state:[{id:'cherop_main',data:structuredClone(fixture),updated_at:'2026-10-17T01:00:00Z'}],tasks:[],leaves:[{id:'leave-test',status:'approved',member:'테스트직원',type:'half_am',start_date:'2026-10-17',end_date:'2026-10-17'}],products:[]};
tables.app_state[0].data.routines={'테스트대표':[{id:'r-existing',label:'기존 반복 업무'}]};tables.app_state[0].data.routine_done={'2020-01-01':{'테스트대표':['r-existing']}};tables.app_state[0].data.memos=[{id:'memo-existing',author:'테스트대표',title:'기존 메모',content:'보존할 본문',date:'2026-10-01'}];let writes=0;let failWrite=null;
class Q{constructor(table){this.table=table;this.filters=[];this.mode='read';}select(){return this}eq(k,v){this.filters.push(x=>String(x[k])===String(v));return this}is(k,v){this.filters.push(x=>(x[k]??null)===v);return this}in(k,v){this.filters.push(x=>v.includes(x[k]));return this}like(k,v){const r=new RegExp('^'+v.replaceAll('%','.*')+'$');this.filters.push(x=>r.test(x[k]));return this}order(){return this}range(a,b){this.bounds=[a,b];return this}limit(n){this.bounds=[0,n-1];return this}single(){this.one=true;return this}maybeSingle(){this.one=true;return this}insert(v){this.mode='insert';this.value=v;return this}update(v){this.mode='update';this.value=v;return this}upsert(v){this.mode='upsert';this.value=v;return this}delete(){this.mode='delete';return this}then(resolve,reject){try{if(this.mode!=='read'&&failWrite?.(this))return Promise.resolve({data:null,error:{message:'검증용 저장 실패'}}).then(resolve,reject);let rows=tables[this.table]??=[];let found=rows.filter(x=>this.filters.every(f=>f(x)));if(this.mode==='insert'||this.mode==='upsert'){writes++;const vals=Array.isArray(this.value)?this.value:[this.value];found=vals.map(x=>structuredClone(x));for(const x of found){if(this.mode==='upsert'){const at=rows.findIndex(r=>r.id===x.id);if(at>=0){rows[at]=x;continue;}}if(x.id===undefined)x.id=rows.length+1;rows.push(x);}}if(this.mode==='update'){writes++;for(const x of found)Object.assign(x,structuredClone(this.value));}if(this.mode==='delete'){writes++;tables[this.table]=rows.filter(x=>!found.includes(x));}if(this.bounds)found=found.slice(this.bounds[0],this.bounds[1]+1);return Promise.resolve({data:JSON.parse(JSON.stringify(this.one?found[0]||null:found),(k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v),error:null}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject)}}}
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

const chosen=()=>[...w.document.querySelectorAll('[data-w6-select]')].filter(e=>e.checked);
const state=()=>structuredClone({main:main(),tasks:tables.tasks});
async function change(selector,value){const el=typeof selector==='string'?w.document.querySelector(selector):selector;assert(el,selector);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));await wait();return el;}
async function selectTask(k){return change([...w.document.querySelectorAll('[data-w6-select]')].find(e=>e.dataset.w6Select===k),true);}
async function applyStatus(value){await change('[data-w6-bulk-status]',value);click('[data-w6=bulk-status]');await wait();await wait();}
const history=()=>tables.app_state.filter(x=>x.id.startsWith('cherop_task_history_'));
async function reset(){
 const s=main();s.proj_tasks=[
 {id:'a',proj_id:'p0',title:'선택 프로젝트 A',assignee:'테스트대표',status:'todo',memo:'- [ ] 체크 보존'},
 {id:'b',proj_id:'p0',title:'선택 프로젝트 B',assignee:'테스트대표',status:'ing',note:'자료 보존'},
 {id:'c',proj_id:'p1',title:'다른 직원 업무',assignee:'테스트직원',status:'todo'},
 {id:'d',proj_id:'p0',title:'기존 완료 업무',assignee:'테스트대표',status:'done'}];
 tables.tasks=[{id:101,title:'선택 일반 A',assignee:'테스트대표',status:'todo',memo:null,note:'[memo:linked]',due_date:null,is_starred:false},
 {id:102,title:'선택 일반 B',assignee:'테스트대표',status:'ing',memo:'메모 보존',note:null,due_date:null,is_starred:true}];
 s.task_meta={'task:101':{proj_id:'p0'},'task:102':{proj_id:null},'task:999':{reference:'다른 데이터'}};
 s.memos=[{id:'linked',title:'원본 메모',content:'삭제 금지 원문',taskId:101,taskSource:'task',author:'테스트대표'},{id:'other',taskId:'c',taskSource:'project',content:'다른 메모'}];
 s.today_tasks={'테스트대표':['t-101','pt-a','t-102'],'테스트직원':['pt-c']};
 api.states.ps.filter='active';api.states.ps.query='';api.states.ps.project='all';
 vm.runInContext('_appStateCache=null',ctx);await route('tasks','notes');await route('tasks');
}
(async()=>{
 await reset();let before=state(),n=writes;
 assert.equal(w.document.querySelectorAll('[data-w6-select]').length,4);
 await selectTask('project:a');assert.equal(writes,n);assert.deepEqual(state(),before);assert(w.document.querySelector('[data-w6-select-all]').indeterminate);
 assert.equal(main().proj_tasks.find(t=>t.id==='a').status,'todo','checkbox must not complete task');
 await change('[data-w6-select-all]',true);assert.equal(chosen().length,4);assert(w.document.querySelector('[data-w6-select-all]').checked);
 await applyStatus('review');assert.equal(main().proj_tasks.find(t=>t.id==='c').status,'todo','hidden assignee unchanged');assert.equal(main().proj_tasks.find(t=>t.id==='d').status,'done','hidden completed unchanged');assert(tables.tasks.every(t=>t.status==='review'));assert.equal(main().proj_tasks.find(t=>t.id==='a').memo,'- [ ] 체크 보존');assert.equal(chosen().length,0);assert.equal(history().at(-1).data.entries.length,4);assert.equal(main().projects[0].progress,25);
 // All supported states save through the same control, including moving to/from 완료.
 for(const status of ['hold','ing','todo','done']){await selectTask('project:a');await applyStatus(status);assert.equal(main().proj_tasks.find(t=>t.id==='a').status,status);}
 click('[data-w6=filter][data-id=done]');await wait();assert.equal(w.document.querySelectorAll('[data-w6-select]').length,2);assert.equal(chosen().length,0,'completed tasks start unselected');await selectTask('project:a');await applyStatus('todo');assert.equal(main().proj_tasks.find(t=>t.id==='a').status,'todo');
 // Changing filters clears selection; select-all respects a narrowed search.
 await reset();await selectTask('project:a');await change('[data-w6-filter=owner]','all');assert.equal(chosen().length,0);
 const search=w.document.querySelector('[data-w6-search]');search.elements.query.value='프로젝트 A';search.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait();await change('[data-w6-select-all]',true);assert.equal(chosen().length,1);await applyStatus('hold');assert.equal(main().proj_tasks.find(t=>t.id==='a').status,'hold');assert.equal(main().proj_tasks.find(t=>t.id==='b').status,'ing');
 // Project detail task lists get identical select-all and status actions.
 await reset();await route('project','p0');click('[data-w6=project-tab][data-id="업무"]');await wait();await change('[data-w6-select-all]',true);assert.equal(chosen().length,4);await applyStatus('done');assert.equal(main().projects[0].progress,100);assert.equal(main().proj_tasks.find(t=>t.id==='c').status,'todo');assert.equal(tables.tasks.find(t=>t.id===102).status,'ing');
 // Delete confirmation can cancel; confirmed deletion preserves unrelated records and links.
 await reset();before=state();await selectTask('project:a');await selectTask('task:101');n=writes;click('[data-w6=bulk-delete]');await wait();assert.equal(w.document.querySelectorAll('.tp-delete-summary li').length,2);assert.equal(writes,n);w.document.querySelector('#w5-dialog [data-w5-close]').click();assert.deepEqual(state(),before);
 click('[data-w6=bulk-delete]');await wait();await save({});assert(!main().proj_tasks.some(t=>t.id==='a'));assert(!tables.tasks.some(t=>t.id===101));assert.equal(main().projects.length,before.main.projects.length);assert.equal(main().memos[0].content,'삭제 금지 원문');assert(!main().memos[0].taskId);assert.deepEqual(main().memos[1],before.main.memos[1]);assert.deepEqual(main().today_tasks,{'테스트대표':['t-102'],'테스트직원':['pt-c']});assert(!main().task_meta['task:101']);assert.deepEqual(main().task_meta['task:999'],before.main.task_meta['task:999']);assert.deepEqual(main().proj_tasks.filter(t=>t.id!=='a'),before.main.proj_tasks.filter(t=>t.id!=='a'));assert.equal(history().at(-1).data.action,'delete');assert.equal(history().at(-1).data.entries.length,2);assert.equal(history().at(-1).data.memos[0].content,'삭제 금지 원문');
 for(const k of ['plan','notices','ops_events','assets','tpl_popup'])assert.deepEqual(main()[k],before.main[k],k+' preserved');
 // Conflict preflight stops the whole operation before backups or writes.
 await reset();await selectTask('project:a');await selectTask('task:101');main().proj_tasks.find(t=>t.id==='a').note='동료 수정';n=writes;await applyStatus('done');assert.equal(writes,n);assert.equal(tables.tasks[0].status,'todo');assert.equal(main().proj_tasks.find(t=>t.id==='a').note,'동료 수정');
 // No action without verified backup.
 await reset();await selectTask('project:a');before=state();failWrite=q=>q.table==='app_state'&&q.mode==='insert';await applyStatus('done');failWrite=null;assert.deepEqual(state(),before);
 // A failed personal row is kept selected; successful rows are not repeated.
 await reset();await selectTask('task:101');await selectTask('task:102');failWrite=q=>q.table==='tasks'&&q.mode==='update'&&q.filters.every(f=>f(tables.tasks.find(t=>t.id===102)));await applyStatus('review');failWrite=null;assert.equal(tables.tasks.find(t=>t.id===101).status,'review');assert.equal(tables.tasks.find(t=>t.id===102).status,'ing');assert.deepEqual(chosen().map(e=>e.dataset.w6Select),['task:102']);
 console.log('PASS: selection never changes status; filtered select-all, all five bulk states, project detail, verified JSONB backups, confirmed mixed-store deletion, project/memo/reference preservation, conflict/backup failure protection, partial-save selection.');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
