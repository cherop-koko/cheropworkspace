const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
// Self-contained synthetic records only. No real employee or company records, backups, or external fixture inputs.
const fixture={projects:[],proj_tasks:[],assets:[],ops_events:[],plan:{'2026':{items:[],memos:{},products:[]}}};
const tables={app_state:[{id:'cherop_main',data:structuredClone(fixture),updated_at:'2026-10-17T01:00:00Z'}],tasks:[],leaves:[],products:[]};
tables.products=[{id:'stock-a',name:'검증 상품 A',option_name:'소형',is_discontinued:false},{id:'stock-b',name:'검증 상품 B',option_name:'대형',is_discontinued:false}];
tables.inventory=[{id:'inv-a',product_id:'stock-a',available_stock:5,total_stock:15,produced_stock:5,pending_production:10}];
tables.channel_inventory=[];
const initial=tables.app_state[0].data;initial.ch_reservations=[{id:'rsv-a',product_id:'stock-a',qty:3,channel:'검증채널1',createdAt:'2026-10-01T00:00:00Z'},{id:'rsv-b',product_id:'stock-a',qty:4,channel:'검증채널2',createdAt:'2026-10-02T00:00:00Z'},{id:'rsv-c',product_id:'stock-b',qty:7,channel:'검증채널1',createdAt:'2026-10-03T00:00:00Z'}];
initial.prod_today=[{id:'schedule-old',product_id:'stock-a',qty:10,item:'기존 예약',date:'2020-01-01',reserved:true,memo:'기존 메모',mins:20,extra:'preserve'},{id:'schedule-future',product_id:'stock-b',qty:5,item:'예정 작업',date:'2099-12-31',reserved:true},{id:'old-waiting',product_id:'stock-a',qty:1,date:'2020-01-02',done:false}];initial.prod_time={'stock-a':{mins:2,per:1}};
initial.plan['2026'].items=[{id:'quarter-a',type:'quarter',qtr:'Q1',title:'검증 1분기 방향',desc:'보존 설명',status:'planned'},{id:'month-a',type:'roadmap',month:1,title:'검증 월 계획',status:'planned'},{id:'archived',type:'roadmap',month:1,title:'보관 계획',archived:true}];initial.plan['2026'].memos={};
const day=offset=>{const date=new Date(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);};
initial.work_logs=[{id:'log-current',product_id:'stock-a',label:'검증 작업',qty:3,date:day(0),createdAt:'2026-01-01T10:00:00Z',extra:'keep'},{id:'log-six',product_id:'stock-b',qty:2,date:day(-6)},{id:'log-seven',product_id:'stock-b',qty:1,date:day(-7)},{id:'log-old',product_id:'stock-a',qty:5,date:day(-90)}];
initial.prod_supplies=[{id:'supply-a',name:'검증 소모품',stock:20,alert:2}];initial.prod_supply_links={'stock-a':[{id:'supply-a',qty:2}]};
initial.prod_defects=[{id:'def-a',group_id:'group-a',group_index:1,product_id:'stock-a',qty:1,status:'pending',type:'production',date:day(0),memo:'검증 메모',photo_urls:['https://example.com/image.jpg']},{id:'def-b',group_id:'group-a',group_index:2,product_id:'stock-a',qty:1,status:'restored',type:'production',date:day(0)},{id:'def-old',product_id:'stock-b',qty:3,status:'disposed',type:'return',date:day(-1),channel:'검증채널1'}];initial.prod_hidden=['stock-b'];
tables.products[0].category='분류 A';tables.products[1].category='분류 B';
tables.sales_log=[{id:'sale-a',product_id:'stock-a',quantity:2,channel:'검증채널1',sale_date:day(0)},{id:'sale-b',product_id:'stock-a',quantity:1,channel:'검증채널2',sale_date:day(0)},{id:'sale-old',product_id:'stock-a',quantity:100,channel:'검증채널1',sale_date:day(-1)}];
let writes=0;
class Q{constructor(table){this.table=table;this.filters=[];this.mode='read';}select(){return this}eq(k,v){this.filters.push(x=>String(x[k])===String(v));return this}is(k,v){this.filters.push(x=>(x[k]??null)===v);return this}in(k,v){this.filters.push(x=>v.includes(x[k]));return this}like(k,v){const r=new RegExp('^'+v.replaceAll('%','.*')+'$');this.filters.push(x=>r.test(x[k]));return this}gte(k,v){this.filters.push(x=>x[k]>=v);return this}gt(k,v){this.filters.push(x=>x[k]>v);return this}order(){return this}range(a,b){this.bounds=[a,b];return this}limit(n){this.bounds=[0,n-1];return this}single(){this.one=true;return this}maybeSingle(){this.one=true;return this}insert(v){this.mode='insert';this.value=v;return this}update(v){this.mode='update';this.value=v;return this}upsert(v){this.mode='upsert';this.value=v;return this}delete(){this.mode='delete';return this}then(resolve,reject){try{let rows=tables[this.table]??=[];let found=rows.filter(x=>this.filters.every(f=>f(x)));if(this.mode==='insert'||this.mode==='upsert'){writes++;const vals=Array.isArray(this.value)?this.value:[this.value];found=vals.map(x=>structuredClone(x));for(const x of found){if(this.mode==='upsert'){const at=rows.findIndex(r=>r.id===x.id);if(at>=0){rows[at]=x;continue;}}if(x.id===undefined)x.id=rows.length+1;rows.push(x);}}if(this.mode==='update'){writes++;for(const x of found)Object.assign(x,structuredClone(this.value));}if(this.mode==='delete'){writes++;tables[this.table]=rows.filter(x=>!found.includes(x));}if(this.bounds)found=found.slice(this.bounds[0],this.bounds[1]+1);return Promise.resolve({data:structuredClone(this.one?found[0]||null:found),error:null}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject)}}}
const dom=new JSDOM(html,{url:'https://cherop-koko.github.io/cheropworkspace/#dashboard',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false});w.console=console;w.supabase={createClient:()=>({from:t=>new Q(t),storage:{from:()=>({upload:async()=>({error:null}),getPublicUrl:p=>({data:{publicUrl:'https://example.com/'+p}})})}})};w.setInterval=()=>0;w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};
const ctx=dom.getInternalVMContext();
for(const node of w.document.scripts){if(node.src){const local=node.src.split('/').at(-1).split('?')[0];if(local.startsWith('workspace-')&&local!=='workspace-start.js')vm.runInContext(fs.readFileSync(local,'utf8'),ctx,{filename:local});}else if(!node.textContent.includes('cleanupBrokenRoutineKeys();\nboot();'))vm.runInContext(node.textContent,ctx,{filename:'index-inline'});}
vm.runInContext("user={id:'qa-admin',name:'QA_ADMIN',admin:true};",ctx);
const api=w.CHEROPSections;assert(api);
const wait=()=>new Promise(r=>setTimeout(r,30));
async function route(page,sub=''){w.location.hash='#'+page+(sub?'/'+encodeURIComponent(sub):'');vm.runInContext(`renderPage(${JSON.stringify(page)},${JSON.stringify(sub)})`,ctx);await wait();}
function click(selector){const el=w.document.querySelector(selector);assert(el,selector);el.click();return el;}
async function submit(values){const form=w.document.querySelector('#pf-form');assert(form);for(const[k,v]of Object.entries(values)){const el=form.elements.namedItem(k);assert(el,k);el.value=v;}form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait();}

const main=()=>tables.app_state[0].data;
(async()=>{
 const before=structuredClone(tables);
 await route('production','today');
 assert.equal(w.document.querySelectorAll('[data-work-log-id]').length,2,'7 days includes today and six earlier dates');
 await w.workLogSetPeriod(14);assert.equal(w.document.querySelectorAll('[data-work-log-id]').length,3);assert.equal(w.document.querySelectorAll('.w8-ship-table tbody tr').length,2,'today shipping retains separate channels');
 await route('production','recommend');assert.equal(w.document.querySelectorAll('[data-recommend-id]').length,1);
 click('[data-w8="rec-hidden"]');assert.equal(w.document.querySelector('[data-recommend-id]').dataset.recommendId,'stock-b');click('[data-w8="rec-hidden"]');
 const search=w.document.getElementById('w8-rec-search');search.value='missing';search.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(w.document.querySelectorAll('[data-recommend-id]').length,0);search.value='';search.dispatchEvent(new w.Event('input',{bubbles:true}));
 await route('production','supply');assert.equal(w.document.querySelectorAll('[data-supply-id]').length,1);assert(w.document.querySelector('.w8-legacy-links').textContent.includes('자동 차감'));
 await route('production','defect');assert.equal(w.document.querySelectorAll('[data-defect-group]').length,2);assert.equal(w.document.querySelectorAll('[data-defect-id]').length,3);assert(!w.document.querySelector('.w8-defect-details').open);assert(w.document.getElementById('prod-defect-filter').textContent.includes('전체 5'));
 click('[data-w8="defect-filter"][data-id="pending"]');assert.equal(w.document.querySelectorAll('[data-defect-id]').length,1);assert.equal(w.document.querySelector('[data-defect-id]').dataset.defectId,'def-a');
 click('[data-w8="return-new"]');assert.equal(vm.runInContext('defectType',ctx),'return');assert(w.document.getElementById('prod-defect-modal').classList.contains('w8-modal'));assert(!w.document.querySelector('.w8-optional').open);w.closeModal('prod-defect-modal');
 assert.equal(writes,0);assert.deepEqual(tables,before,'all new views, filters and opening forms are read-only');
 let handled;w.resolveDefect=async(id,status)=>{handled={id,status};};click('[data-w8="defect-restore"]');await wait();assert.deepEqual(handled,{id:'def-a',status:'restored'});
 await route('production','today');w.CHEROPProductionDesign.openWork('stock-a');assert.equal(w.document.getElementById('work-log-search').value,'검증 상품 A · 소형');
 w.document.getElementById('work-log-qty').value='2';await w.addWorkLog();await wait();
 assert.equal(main().work_logs.length,5);assert.equal(main().work_logs.at(-1).qty,2);assert.deepEqual(main().work_logs.slice(0,4),before.app_state[0].data.work_logs);
 assert.equal(tables.inventory[0].pending_production,8);assert.equal(tables.inventory[0].produced_stock,7);assert.equal(tables.channel_inventory.reduce((n,r)=>n+r.stock,0),7);assert.equal(main().ch_reservations.length,1);assert.equal(main().prod_supplies[0].stock,16,'existing supply adjustment is visible and preserved');
 assert.deepEqual(main().prod_today,before.app_state[0].data.prod_today);assert.deepEqual(main().prod_defects,before.app_state[0].data.prod_defects);
 console.log('PASS: production views are read-only; date ranges, channel shipping, hidden recommendations, grouped legacy defects, compact forms, original record IDs, existing work/stock/reservation/supply processing preserved.');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
