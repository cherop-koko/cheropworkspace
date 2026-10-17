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
let writes=0;const rpcCalls=[];let rpcHandler=async()=>({data:{},error:null});
class Q{constructor(table){this.table=table;this.filters=[];this.mode='read';}select(){return this}eq(k,v){this.filters.push(x=>String(x[k])===String(v));return this}is(k,v){this.filters.push(x=>(x[k]??null)===v);return this}in(k,v){this.filters.push(x=>v.includes(x[k]));return this}like(k,v){const r=new RegExp('^'+v.replaceAll('%','.*')+'$');this.filters.push(x=>r.test(x[k]));return this}gte(k,v){this.filters.push(x=>x[k]>=v);return this}gt(k,v){this.filters.push(x=>x[k]>v);return this}lte(k,v){this.filters.push(x=>x[k]<=v);return this}or(v){if(v==='disc_status.is.null,disc_status.neq.planned')this.filters.push(x=>x.disc_status!=='planned');return this}order(k,o={}){(this.orders??=[]).push([k,o.ascending!==false]);return this}range(a,b){this.bounds=[a,b];return this}limit(n){this.bounds=[0,n-1];return this}single(){this.one=true;return this}maybeSingle(){this.one=true;return this}insert(v){this.mode='insert';this.value=v;return this}update(v){this.mode='update';this.value=v;return this}upsert(v){this.mode='upsert';this.value=v;return this}delete(){this.mode='delete';return this}then(resolve,reject){try{let rows=tables[this.table]??=[];let found=rows.filter(x=>this.filters.every(f=>f(x)));if(this.mode==='insert'||this.mode==='upsert'){writes++;const vals=Array.isArray(this.value)?this.value:[this.value];found=vals.map(x=>structuredClone(x));for(const x of found){if(this.mode==='upsert'){const at=rows.findIndex(r=>r.id===x.id);if(at>=0){rows[at]=x;continue;}}if(x.id===undefined)x.id=rows.length+1;rows.push(x);}}if(this.mode==='update'){writes++;for(const x of found)Object.assign(x,structuredClone(this.value));}if(this.mode==='delete'){writes++;tables[this.table]=rows.filter(x=>!found.includes(x));}if(this.orders)found.sort((a,b)=>{for(const[k,asc]of this.orders){const c=String(a[k]??'').localeCompare(String(b[k]??''));if(c)return asc?c:-c;}return 0;});if(!this.bounds&&!this.one)found=found.slice(0,1000);if(this.bounds)found=found.slice(this.bounds[0],this.bounds[1]+1);return Promise.resolve({data:structuredClone(this.one?found[0]||null:found),error:null}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject)}}}
// More than the API default limit, multiple channels and historical rows.
tables.sales_log=Array.from({length:1207},(_,i)=>({id:'shipment-'+String(i).padStart(4,'0'),product_id:'stock-a',quantity:2,amount:0,channel:i%2?'채널 B':'채널 A',sale_date:'2026-10-01'}));
tables.channel_inventory=Array.from({length:1201},(_,i)=>({id:'channel-'+String(i).padStart(4,'0'),product_id:'stock-a',channel:'보관채널 '+i,stock:1}));
tables.channel_sales_log=[{id:'rev-a',date:'2026-10-01',channel:'채널 A',amount:1000,note:'보존 메모'},{id:'rev-b',date:'2026-10-02',channel:'채널 B',amount:2000}];
tables.stock_receipts=Array.from({length:58},(_,i)=>({id:'receipt-'+i,product_id:'stock-a',status:'completed',receipt_date:'2026-09-01',scheduled_date:'2026-09-01',quantity:1}));
tables.products.push({id:'planned-zero',name:'단종 예정 보존',is_discontinued:false,disc_status:'planned'});
const dom=new JSDOM(html,{url:'https://cherop-koko.github.io/cheropworkspace/#dashboard',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false});w.console=console;w.supabase={createClient:()=>({from:t=>new Q(t),rpc:async(name,args)=>{rpcCalls.push({name,args:structuredClone(args)});return rpcHandler();},storage:{from:()=>({upload:async()=>({error:null}),getPublicUrl:p=>({data:{publicUrl:'https://example.com/'+p}})})}})};w.setInterval=()=>0;w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};
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
 await route('inventory','overview');await w.loadInvList();
 assert.equal((await w.CHEROPStockSales.readClient.from('channel_inventory').select('*')).data.length,1201);
 assert(w.document.getElementById('inv-product-table').textContent.includes('보관채널 1200'));
 await route('inventory','receipt');await w.loadReceiptSchedule();assert.equal(w.document.querySelectorAll('[data-receipt-id]').length,58);
 await route('inventory','shiplog');vm.runInContext("_shipLogMonth='2026-10'",ctx);await w.loadShipLog();assert.equal(w.document.querySelectorAll('[data-shipment-id]').length,1207);
 await route('inventory','channel');await w.loadChannelInv();await route('inventory','alert');await w.loadOrderAlerts();
 await route('sales','overview');vm.runInContext("_salesYear=2026;_salesMonth=10;_salesRange='month'",ctx);await w.loadSalesData();assert.equal(w.CHEROPStockSales.view.sales.length,1207);assert.equal(w.CHEROPStockSales.view.revenues.length,2);
 const channel=w.document.getElementById('w11-sales-channel');channel.value='채널 A';channel.dispatchEvent(new w.Event('change'));await wait();
 assert.equal(w.CHEROPStockSales.view.sales.length,604);assert.equal(w.CHEROPStockSales.view.revenues.length,1);assert.equal(w.CHEROPStockSales.view.buckets.reduce((n,r)=>n+r.amount,0),1000);assert(w.document.getElementById('sales-metrics').textContent.includes('1,208개'));
 click('[data-stock="rank"][data-id="amount"]');assert(w.document.getElementById('sales-top10').textContent.includes('입력되지 않아'));
 await route('sales','records');assert.equal(w.document.querySelectorAll('[data-revenue-id]').length,1);click('[data-stock="edit-revenue"]');assert.equal(w.document.getElementById('slog-edit-note').value,'보존 메모');w.closeModal('sales-log-edit-modal');
 await route('inventory','shiplog');click('[data-stock=ship]');await wait();assert(w.document.getElementById('shipment-modal').classList.contains('on'));w.closeModal('shipment-modal');
 w.openInvModal('receipt');assert(w.document.getElementById('inv-receipt-modal').classList.contains('on'));w.closeModal('inv-receipt-modal');
 let exported;w.XLSX={utils:{json_to_sheet:r=>(exported=r),book_new:()=>({}),book_append_sheet:()=>{}},writeFile:()=>{}};await w.exportInvExcel();assert.equal(exported.length,tables.products.length);
 assert.equal(writes,0,'page views and controls never write records');assert.deepEqual(tables,before,'all record IDs, values, notes, dates and states retained');
 console.log('PASS: API pagination 1,207 shipments / 1,201 allocations; all 58 receipts; channel-consistent totals, graph and records; missing item revenue explicit; read-only navigation preserves all fields.');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
