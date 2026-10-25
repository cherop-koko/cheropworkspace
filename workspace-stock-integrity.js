/* PostgreSQL commits stock and records together. Retries retain their operation ID. */
(()=>{'use strict';
const pending=new Map();let busy=false,allocationSnapshot=null,editShipment=null,editWork=null;
const integer=(value,label)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw Error(label+'은 0 이상의 정수로 입력해주세요.');return n;};
const read=async q=>{const r=await q;if(r.error)throw r.error;return r.data;};
async function perform(action,payload,key=action){
 const signature=JSON.stringify(payload);let request=pending.get(key);
 if(!request||request.signature!==signature){request={signature,operation:crypto.randomUUID(),payload};pending.set(key,request);}
 const r=await db.rpc('workspace_stock_v2',{p_operation:request.operation,p_action:action,p_payload:request.payload});
 if(r.error)throw r.error;
 pending.delete(key);_appStateCache=null;_appStateCacheAt=0;window.CHEROPStockSales?.invalidate?.();return r.data;
}
async function run(fn){if(busy)return;busy=true;try{return await fn();}catch(e){toast(e.message||'저장하지 못했습니다.',7000);console.error(e);}finally{busy=false;}}
const refresh=async()=>{_appStateCache=null;await loadInvOverview();if(invCurrentTab==='channel')await loadChannelInv(invCurrentChannel);if(invCurrentTab==='shiplog')await loadShipLog();};
const openAllocation=openChAllocModal;
openChAllocModal=async function(pid){
 try{
  const [inventory,channels,state]=await Promise.all([read(db.from('inventory').select('*').eq('product_id',pid).single()),read(db.from('channel_inventory').select('*').eq('product_id',pid)),_readFullState()]);
  allocationSnapshot={inventory,channels:channels.sort((a,b)=>a.id.localeCompare(b.id)),reservations:(state.ch_reservations||[]).filter(r=>r.product_id===pid).sort((a,b)=>a.id.localeCompare(b.id))};
  _appStateCache=state;_appStateCacheAt=Date.now();_snapshotAppState(state);await openAllocation(pid);
 }catch(e){allocationSnapshot=null;toast(e.message,6000);}
};
saveChAlloc=()=>run(async()=>{
 if(!allocationSnapshot||allocationSnapshot.inventory.product_id!==_chAllocProdId)throw Error('배분 창을 다시 열어주세요.');
 const desired=Object.fromEntries(CHANNELS.map(ch=>[ch,integer($('ch-alloc-'+ch)?.value||0,ch)]));
 const r=await perform('allocate',{product_id:_chAllocProdId,desired,channels:CHANNELS,expected:allocationSnapshot});
 toast('배분 저장 · 예약 '+r.reserved+'개');closeModal('ch-alloc-modal');allocationSnapshot=null;await refresh();
});
applyChReservations=async pid=>{const result=await perform('fulfill',{product_id:pid},'fulfill:'+pid);if(result.allocated&&typeof loadProdReservations==='function')await loadProdReservations();return result;};
applyShipmentStock=async()=>{throw Error('출고 기록과 재고는 함께 저장해야 합니다. 새로고침 후 다시 시도해주세요.');};
reconcileInventory=async function(pid){
 const [i,channels]=await Promise.all([read(db.from('inventory').select('*').eq('product_id',pid).maybeSingle()),read(db.from('channel_inventory').select('stock').eq('product_id',pid))]);if(!i)return null;
 const chSum=channels.reduce((n,c)=>n+Number(c.stock||0),0),before={total:i.total_stock,produced:i.produced_stock,pending:i.pending_production,available:i.available_stock,chSum};
 return {changed:false,needsReview:before.total!==before.produced+before.pending||before.produced!==before.available+chSum,before,after:before};
};
let manualRequest=null;
saveShipment=()=>run(async()=>{
 const date=$('shipment-date').value,channel=$('shipment-channel').value;if(!date||!channel)throw Error('날짜와 채널을 선택해주세요.');
 const aggregate=new Map();for(const row of $('shipment-rows').querySelectorAll('div[id^="sr-"]')){const pid=row.querySelector('.ship-prod-id')?.value,raw=row.querySelector('.ship-qty')?.value;if(!pid&&!raw)continue;if(!pid)throw Error('상품을 선택해주세요.');const qty=integer(raw,'출고 수량');if(!qty)throw Error('출고 수량은 1 이상이어야 합니다.');aggregate.set(pid,(aggregate.get(pid)||0)+qty);}
 if(!aggregate.size)throw Error('출고 상품을 입력해주세요.');
 const signature=JSON.stringify([date,channel,[...aggregate]]);
 if(manualRequest?.signature!==signature){const id=crypto.randomUUID();manualRequest={signature,payload:{mode:'insert',rows:[...aggregate].map(([product_id,quantity],i)=>({id:'ship-'+id+'-'+i,product_id,channel,quantity,amount:0,sale_date:date}))}};}
 await perform('shipments',manualRequest.payload,'manual-shipment');manualRequest=null;closeModal('shipment-modal');toast('출고와 재고를 함께 저장했습니다.');await refresh();
});
const openShipment=openShipLogEdit;
openShipLogEdit=async function(id,...args){try{editShipment=await read(db.from('sales_log').select('*').eq('id',id).single());return openShipment(id,...args);}catch(e){toast(e.message,6000);}};
saveShipLogEdit=id=>run(async()=>{
 if(!editShipment||editShipment.id!==id)throw Error('출고 내역을 다시 열어주세요.');
 const quantity=integer($('slog-edit-amount').value,'출고 수량');if(!quantity)throw Error('수량은 1 이상이어야 합니다.');
 const row={...editShipment,quantity,channel:$('slog-edit-channel').value,sale_date:$('slog-edit-date').value,expected:editShipment};
 await perform('shipments',{rows:[row]},'edit-shipment:'+id);closeModal('sales-log-edit-modal');editShipment=null;toast('출고 내역과 재고를 함께 수정했습니다.');await refresh();
});
deleteShipLog=id=>run(async()=>{
 const expected=editShipment?.id===id?editShipment:await read(db.from('sales_log').select('*').eq('id',id).single());
 if(!await customConfirm('이 출고 내역을 삭제할까요?','출고 시 사용한 채널·가용·예약 수량으로 되돌립니다.'))return;
 await perform('delete_shipment',{id,expected},'delete-shipment:'+id);closeModal('sales-log-edit-modal');editShipment=null;toast('출고를 취소하고 원래 재고 구분으로 복원했습니다.');await refresh();
});
processUpload=()=>run(async()=>{
 const agg=window._invUploadAgg||{},maps=window._invUploadMappings||{},skip=window._invUploadSkipped||new Set();
 const unresolved=Object.keys(agg).filter(k=>!maps[k]&&!skip.has(k));
 if(unresolved.length&&!await customConfirm('매칭되지 않은 항목 '+unresolved.length+'개','매칭된 상품만 업로드할까요?','업로드'))return;
 const sales=new Map(),revenues=new Map(),mappings=[];
 for(const [key,data]of Object.entries(agg)){
  const product_id=maps[key];if(!product_id||skip.has(key))continue;
  mappings.push({id:'map-v2-'+encodeURIComponent(invUploadChannel+'|'+product_id+'|'+key),product_id,channel:invUploadChannel,channel_name:key});
  for(const row of data.rows){
   const quantity=integer(row.qty,'출고 수량'),sale_date=row.saleDate||dateStr(),amount=Number(row.orderAmt||0);
   if(!Number.isSafeInteger(amount))throw Error('주문 금액은 정수로 입력해주세요.');
   const id=row.itemNo?'sale-item-'+row.itemNo:'sale-v2-'+sale_date+'-'+invUploadChannel+'-'+product_id;
   const existing=sales.get(id);if(row.itemNo&&existing)throw Error('품목 번호가 중복됐습니다: '+row.itemNo);
   sales.set(id,{id,product_id,channel:invUploadChannel,quantity:quantity+(existing?.quantity||0),amount:amount+(existing?.amount||0),sale_date});
   const rid='csl-'+sale_date+'-'+invUploadChannel+'-'+product_id,rev=revenues.get(rid);revenues.set(rid,{id:rid,channel:invUploadChannel,date:sale_date,amount:amount+(rev?.amount||0),note:data.pname});
  }
 }
 if(!sales.size)throw Error('업로드할 상품이 없습니다.');
 for(const row of [...sales.values()])if(row.id.startsWith('sale-v2-')){
  const oldId='sale-'+row.sale_date+'-'+invUploadChannel.replace(/[^a-z0-9]/gi,'')+'-'+row.product_id;
  const old=await read(db.from('sales_log').select('id,channel,product_id').eq('id',oldId).maybeSingle());
  if(old&&old.channel===row.channel&&old.product_id===row.product_id){sales.delete(row.id);row.id=oldId;sales.set(oldId,row);}
 }
 const result=await perform('shipments',{rows:[...sales.values()],revenues:[...revenues.values()],mappings},'upload');
 toast('업로드 완료 · '+result.rows+'건 / 재고 변경 '+result.stock_changed+'건');closeModal('inv-upload-modal');await refresh();
});
let newWork=null;
addWorkLog=()=>run(async()=>{
 const qty=integer($('work-log-qty').value,'작업 수량');if(!_workLogSelProdId||qty<1)throw Error('상품과 수량을 확인해주세요.');
 const signature=JSON.stringify([_workLogSelProdId,_workLogSelLabel,qty,dateStr()]);
 if(newWork?.signature!==signature)newWork={signature,row:{id:'wlog_'+crypto.randomUUID(),date:dateStr(),product_id:_workLogSelProdId,label:_workLogSelLabel,qty,createdAt:new Date().toISOString()}};
 await perform('worklog',{row:newWork.row,expected:null},'new-work');newWork=null;$('work-log-search').value='';$('work-log-qty').value='';_workLogSelProdId=null;toast('작업 기록과 재고를 함께 저장했습니다.');await loadWorkLogList();refreshInventoryUI();
});
const openWork=openWorkLogEdit;
openWorkLogEdit=async function(id){try{const s=await _readFullState();editWork=structuredClone(s.work_logs?.find(w=>w.id===id));if(!editWork)throw Error('작업 기록이 변경됐습니다. 다시 불러와주세요.');_appStateCache=s;_appStateCacheAt=Date.now();_snapshotAppState(s);return openWork(id);}catch(e){toast(e.message,6000);}};
saveWorkLogEdit=()=>run(async()=>{if(!editWork||editWork.id!==_workLogEditId)throw Error('작업 기록을 다시 열어주세요.');const qty=integer($('work-log-edit-qty').value,'작업 수량');if(qty<1)throw Error('수량은 1 이상이어야 합니다.');await perform('worklog',{row:{...editWork,qty},expected:editWork},'edit-work');closeModal('work-log-edit-modal');editWork=null;toast('작업 기록과 재고를 함께 수정했습니다.');await loadWorkLogList();refreshInventoryUI();});
deleteWorkLog=()=>run(async()=>{if(!editWork||editWork.id!==_workLogEditId)throw Error('작업 기록을 다시 열어주세요.');if(!await customConfirm('이 작업 기록을 삭제할까요?','미배분 재고를 상품화 대기로 되돌립니다.'))return;await perform('worklog',{row:{...editWork,qty:0},expected:editWork},'delete-work');closeModal('work-log-edit-modal');editWork=null;toast('작업 기록을 삭제하고 수량을 복원했습니다.');await loadWorkLogList();refreshInventoryUI();});
async function showIssues(){
 const host=$('w24-stock-integrity');try{const d=await CHEROPStockSales.stockData(),issues=d.inventory.map(i=>{const ch=d.channels.filter(c=>c.product_id===i.product_id).reduce((n,c)=>n+Number(c.stock||0),0),reserved=(d.state.ch_reservations||[]).filter(r=>r.product_id===i.product_id).reduce((n,r)=>n+Number(r.qty||0),0);return {...i,ch,reserved,product:d.products.find(p=>p.id===i.product_id)};}).filter(i=>i.total_stock!==i.produced_stock+i.pending_production||i.produced_stock!==i.available_stock+i.ch||i.reserved>i.pending_production);
 host.innerHTML=issues.length?'<details><summary>재고 수량 확인 필요 <b>'+issues.length+'개 상품</b></summary><p>기존 수량을 보존했습니다. 채널 과배분은 배분 수정으로 정리하고, 총재고·상품화 수량은 실사 또는 원본 이력과 대조해주세요.</p><div style="overflow:auto"><table class="inv-tbl"><thead><tr><th>상품</th><th>총재고</th><th>상품화</th><th>대기</th><th>채널</th><th>예약</th><th></th></tr></thead><tbody>'+issues.map(i=>'<tr><td>'+escapeHtml(i.product?.name||i.product_id)+' '+escapeHtml(i.product?.option_name||'')+'</td><td>'+i.total_stock+'</td><td>'+i.produced_stock+'</td><td>'+i.pending_production+'</td><td>'+i.ch+'</td><td>'+i.reserved+'</td><td><button class="w11-button" data-integrity-product="'+escapeHtml(i.product_id)+'">배분 수정</button></td></tr>').join('')+'</tbody></table></div></details>':'';
 }catch(e){host.textContent='재고 점검 목록을 불러오지 못했습니다: '+e.message;}
}
const panel=document.createElement('div');panel.id='w24-stock-integrity';panel.style.cssText='font-size:12px;line-height:1.6;margin:12px 0';$('inv-tab-overview').prepend(panel);panel.addEventListener('click',e=>{const b=e.target.closest('[data-integrity-product]');if(b)openChAllocModal(b.dataset.integrityProduct);});
const overview=loadInvOverview;loadInvOverview=async function(...args){const result=await overview(...args);await showIssues();return result;};
window.CHEROPStockIntegrity={perform,showIssues};
})();
