const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://example.test/',runScripts:'outside-only'}),w=dom.window;
const byId=id=>w.document.getElementById(id),tick=()=>new Promise(r=>setTimeout(r,0));
const products=[{id:'p',name:'검증 상품',option_name:'S'}];
const row={id:'review-one',sale_id:'ship-one',product_id:'p',channel:'QA',sale_date:'2026-11-03',quantity:5,original_quantity:5,status:'open',created_at:'2026-11-03T01:00:00Z',created_by:{name:'검증'}};
let data={inventory_pending_reviews:{'review-one':structuredClone(row),'review-old':{...row,id:'review-old',status:'completed',completed_by:{name:'검증'},completed_at:'2026-11-03T02:00:00Z'}},work_logs:[]};
const calls=[],toasts=[];let handler=async()=>({data:{},error:null}),normalWork=0,legacyEdit=0,legacyDelete=0,confirmAnswer=false;
w.$=byId;w.escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));w.user={id:'qa',name:'검증'};w.toast=m=>toasts.push(m);w._appStateCache={};w._appStateCacheAt=10;w._workLogSelProdId=null;w._workLogSelLabel='';w._workLogProdList=products;w._workLogEditId='';
w.db={from:table=>{assert.equal(table,'app_state');return{select(){return this},eq(){return this},single:async()=>({data:{data:structuredClone(data)},error:null})}},rpc:async(name,args)=>{calls.push({name,args:structuredClone(args)});return handler(name,args);}};
w.CHEROPSections={queryAll:async()=>products};w.loadInvOverview=async()=>{};w.loadWorkLogList=async()=>{};w.openShipmentModal=async()=>{};w.setDiscStatus=()=>{};w.reconcileInventory=async()=>{};
w.workLogPick=id=>{w._workLogSelProdId=id;w._workLogSelLabel='검증 상품 · S';};w.addWorkLog=async()=>{normalWork++};w.openWorkLogEdit=async()=>{legacyEdit++};w.saveWorkLogEdit=async()=>{legacyEdit++};w.deleteWorkLog=async()=>{legacyDelete++};w.customConfirm=async()=>confirmAnswer;
w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'))};
const ctx=dom.getInternalVMContext();for(const file of ['workspace-inventory-transactions.js','workspace-pending-shipments.js'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
const plan=[{sale_id:'ship-one',product_id:'p',product_name:'검증 <img src=x onerror=alert(1)>',channel:'QA',quantity:15,completed_quantity:10,pending_quantity:5}];
const request=[{id:'ship-one',product_id:'p',channel:'QA',quantity:15,amount:0,sale_date:'2026-11-03'}];
(async()=>{
 const api=w.CHEROPPendingShipments;await api.load();assert.equal(byId('ship-review-panel').querySelectorAll('.ship-review-open article').length,1);assert(byId('ship-review-panel').textContent.includes('처리 이력 1건'));
 const before=calls.length;handler=async()=>({data:{needs_confirmation:true,confirmation:'first',pending_rows:plan},error:null});
 let promise=w.commitInventorySales(request);await tick();assert(w.document.querySelector('.ship-pending-confirm').open);assert.equal(byId('ship-pending-breakdown').querySelector('img'),null);assert(byId('ship-pending-breakdown').textContent.includes('10'));
 byId('ship-pending-cancel').click();assert.equal(await promise,null);assert.equal(calls.length,before+1,'cancel must not issue a commit');
 let step=0;handler=async()=>({data:++step===1?{needs_confirmation:true,confirmation:'first',pending_rows:plan}:step===2?{needs_confirmation:true,confirmation:'changed',pending_rows:[{...plan[0],completed_quantity:9,pending_quantity:6}]}:{processed:1,needs_confirmation:false},error:null});
 promise=w.commitInventorySales(request);await tick();byId('ship-pending-accept').click();await tick();assert(byId('ship-pending-message').textContent.includes('변경'));byId('ship-pending-accept').click();await promise;
 assert.equal(calls.at(-2).args.p_confirmation,'first');assert.equal(calls.at(-1).args.p_confirmation,'changed');assert.deepEqual(calls.at(-1).args.p_rows,request);assert.equal(w._appStateCache,null);
 // Esc cancels, including a modal opened after inventory changed.
 promise=api.confirm(plan,true);w.document.querySelector('dialog.ship-pending-confirm').dispatchEvent(new w.Event('cancel',{cancelable:true}));assert.equal(await promise,false);
 // A failed completion keeps the follow-up visible.
 handler=async()=>({data:null,error:{message:'수량이 변경됐습니다.'}});byId('ship-review-panel').querySelector('[data-ship-review=complete]').click();await tick();await tick();assert(byId('ship-review-panel').querySelector('.ship-review-open [data-review-id=review-one]'));
 // Link through work entry: never invoke the normal inventory-increasing work handler.
 w.workLogPick('p');await tick();await tick();assert.equal(byId('ship-work-review').value,'choose');await w.addWorkLog();assert.equal(normalWork,0);
 byId('ship-work-review').value='review-one';byId('ship-work-review').dispatchEvent(new w.Event('change'));assert.equal(byId('work-log-qty').value,'5');assert(byId('work-log-qty').readOnly);
 handler=async(name,args)=>{assert.equal(name,'complete_pending_shipment_review_v1');assert.equal(args.p_expected_quantity,5);data.inventory_pending_reviews['review-one'].status='completed';data.work_logs.push({id:'linked-work',inventory_effect:'already_shipped',shipment_review_id:'review-one',qty:5});return{data:{already_completed:false},error:null};};
 await w.addWorkLog();assert.equal(normalWork,0);assert.equal(byId('work-log-qty').value,'');assert.equal(byId('ship-review-panel').querySelectorAll('.ship-review-open article').length,0);assert(byId('ship-review-panel').textContent.includes('처리 이력 2건'));
 w._workLogEditId='linked-work';await w.openWorkLogEdit('linked-work');await w.saveWorkLogEdit();await w.deleteWorkLog();assert.equal(legacyEdit,0);assert.equal(legacyDelete,0);
 // New production remains usable but explicitly distinguishes unresolved shipped work.
 data.inventory_pending_reviews['review-two']={...row,id:'review-two'};w.workLogPick('p');await tick();await tick();byId('ship-work-review').value='new';confirmAnswer=false;await w.addWorkLog();assert.equal(normalWork,0);confirmAnswer=true;await w.addWorkLog();assert.equal(normalWork,1);
 console.log('PASS: cancel/accept/stale-consent modal, escaped product labels, unchanged retry IDs, failed completion retention, linked work without stock increment, protected history and explicit new production.');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});
