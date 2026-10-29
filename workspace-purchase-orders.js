/* Purchase records beside incoming stock. This screen performs reads only. */
(() => {
'use strict';
const api=window.CHEROPSections;
const root=document.getElementById('inv-tab-purchase');
if(!root||!api)return;
const esc=v=>escapeHtml(String(v??''));
const validDate=v=>{
 const s=String(v||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return '';
 const t=new Date(s+'T00:00:00Z');
 return !Number.isNaN(t.getTime())&&t.toISOString().slice(0,10)===s?s:'';
};
const firstDate=(...values)=>values.map(validDate).find(Boolean)||'';
const plusSeven=value=>{const s=validDate(value);if(!s)return '';const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+7);return d.toISOString().slice(0,10);};
const today=()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-');};
const short=v=>validDate(v)?v.slice(5).replace('-','.'):'';
const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v).toLocaleString('ko-KR'):'—';
let snapshot={rows:[],state:{},products:[]},ticket=0;

function normalize(order,receipt={},asOf=today()){
 const l=order.logistics||{};
 const received=firstDate(l.domestic_received_on,receipt.status==='completed'?receipt.receipt_date:'');
 const complete=Boolean(received)||order.status==='received'||receipt.status==='completed';
 const cancelled=order.status==='cancelled';
 const held=!complete&&Boolean(l.kc_hold===true||l.hold_reason||/kc_wait|on_hold|customs_hold/.test(l.logistics_status||''));
 const dispatchActual=firstDate(l.factory_dispatch_actual_on,l.factory_dispatched_on);
 const dispatchPlanned=firstDate(l.factory_dispatch_planned_on);
 const productionActual=firstDate(l.production_completed_on,l.production_complete_actual_on);
 const productionPlanned=firstDate(l.production_completion_planned_on,l.production_complete_planned_on);
 let eta='',etaBasis='';
 if(!complete&&!cancelled&&!held){
  if(dispatchActual){eta=plusSeven(dispatchActual);etaBasis='출고일 + 7일';}
  else if(validDate(l.domestic_eta)){eta=l.domestic_eta;etaBasis=l.domestic_eta_is_estimate?'예상':'입고 예정';}
  else if(dispatchPlanned){eta=plusSeven(dispatchPlanned);etaBasis='출고 예정 + 7일';}
  else if(validDate(order.arrivalDate)){eta=order.arrivalDate;etaBasis='기존 예정';}
 }
 const needsCheck=Boolean(eta&&eta<asOf&&!complete&&!cancelled);
 let status='발주 완료',tone='';
 if(cancelled){status='취소';}
 else if(complete){status=received?'입고 완료':'완료 · 날짜 미확인';tone='done';}
 else if(held){status='KC·보류 대기';tone='hold';}
 else if(l.logistics_status==='yiwu_not_arrived'){status='이우 미도착';tone=needsCheck?'check':'';}
 else if(l.yiwu_arrival_confirmed){status='이우 도착';}
 else if(dispatchActual){status='공장 출고';}
 else if(order.status==='pending'||order.status==='draft'){status='발주 대기';}
 else if(needsCheck){status='입고 확인 필요';tone='check';}
 return {order,l,received,complete,cancelled,held,dispatchActual,dispatchPlanned,productionActual,productionPlanned,eta,etaBasis,needsCheck,status,tone,orderDate:validDate(order.orderDate)};
}
function imageFor(order,product){
 const state=snapshot.state,link=state.inventory_images?.[order.product_id];
 const lineup=link?.lineupId?Object.values(state.plan||{}).flatMap(y=>y.products||[]).find(p=>p.id===link.lineupId):null;
 const src=link?.variantImage||lineup?.imgs?.front||lineup?.imgUrl||link?.image||product?.image_url||product?.img_url||'';
 return /^(https?:\/\/|data:image\/(png|jpe?g|webp|gif);base64,)/i.test(src)?src:'';
}
function productCell(r){
 const o=r.order,p=snapshot.products.find(p=>p.id===o.product_id);
 const name=p?.name||o.item||'상품명 미입력';
 const size=r.l.source_size||o.size||p?.option_name||'';
 const src=imageFor(o,p);
 return `<button type="button" class="po-product" data-po-detail="${esc(o.id)}" aria-expanded="false"><span class="po-thumb">${src?`<img src="${esc(src)}" alt="" loading="lazy" decoding="async">`:'<span>사진<br>미연결</span>'}</span><span>${esc(name)}${size?`<small>${esc(size)}</small>`:''}</span></button>`;
}
function dateCell(actual,planned){if(actual)return `<span>${esc(short(actual))}</span><small>완료</small>`;if(planned)return `<span>${esc(short(planned))}</span><small>예정</small>`;return '<span class="po-muted">—</span>';}
function etaCell(r){if(r.held)return '<span class="po-muted">보류</span>';if(r.cancelled)return '<span class="po-muted">—</span>';if(!r.eta)return '<span class="po-muted">미확정</span>';return `${r.needsCheck?'<span class="po-check">재확인</span><small>':'<strong>'}${esc(short(r.eta))}${r.needsCheck?' · '+esc(r.etaBasis)+'</small>':'</strong><small>'+esc(r.etaBasis)+'</small>'}`;}
function table(rows,done=false){
 if(!rows.length)return '<p class="po-empty">해당 발주 기록이 없습니다.</p>';
 const heads=done?['상품','발주 수량','발주일','실제 입고일','상태']:['상품','수량','발주일','제작 완료','공장 출고','예상 입고','상태'];
 const widths=done?[40,12,15,18,15]:[29,8,10,12,12,14,15];
 return `<table class="po-table"><colgroup>${widths.map(w=>`<col style="width:${w}%">`).join('')}</colgroup><thead><tr>${heads.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>{
  const cells=done?[productCell(r),number(r.order.qty),short(r.orderDate)||'—',r.received?`${short(r.received)}<small>${esc(r.received.slice(0,4))}년</small>`:'날짜 미확인',`<span class="po-badge ${r.tone}">${esc(r.status)}</span>`]:[productCell(r),number(r.order.qty),short(r.orderDate)||'—',dateCell(r.productionActual,r.productionPlanned),dateCell(r.dispatchActual,r.dispatchPlanned),etaCell(r),`<span class="po-badge ${r.tone}">${esc(r.status)}</span>`];
  return `<tr>${cells.map((c,i)=>`<td data-label="${heads[i]}">${c}</td>`).join('')}</tr>`;
 }).join('')}</tbody></table>`;
}
function render(){
 const rows=snapshot.rows;
 const active=rows.filter(r=>!r.complete&&!r.cancelled).sort((a,b)=>Number(b.needsCheck)-Number(a.needsCheck)||(a.eta||'9999').localeCompare(b.eta||'9999')||(b.orderDate||'').localeCompare(a.orderDate||''));
 const done=rows.filter(r=>r.complete&&!r.cancelled).sort((a,b)=>(b.received||b.orderDate||'').localeCompare(a.received||a.orderDate||''));
 const cancelled=rows.filter(r=>r.cancelled);
 root.innerHTML=`<div class="po-heading"><h2>진행 중인 발주 <span>${active.length}건</span></h2><span>${esc(today().replaceAll('-','.'))} 기준 · 수량: 개</span></div>${table(active)}<div class="po-note">— 미입력·미확인 · 예상 입고는 공장 출고 후 7일 · KC 등 보류 건은 별도 확인</div><details class="po-completed"><summary>입고 완료 이력 <span>${done.length}건</span></summary>${table(done,true)}</details>${cancelled.length?`<details class="po-completed"><summary>취소 이력 <span>${cancelled.length}건</span></summary>${table(cancelled,true)}</details>`:''}`;
}
async function load(){
 const seq=++ticket;root.setAttribute('aria-busy','true');
 if(!snapshot.rows.length)root.innerHTML='<p class="po-empty">발주 기록을 불러오는 중입니다.</p>';
 try{
  const [state,products,receipts]=await Promise.all([getAppState(),api.queryAll('products'),api.queryAll('stock_receipts')]);
  if(seq!==ticket)return;
  const receiptMap=new Map(receipts.map(r=>[r.id,r]));
  snapshot={state,products,rows:(state.ops_orders||[]).map(o=>normalize(o,receiptMap.get(o.receipt_id)))};
  render();
 }catch(error){if(seq===ticket)root.innerHTML=`<p class="po-empty">발주 기록을 불러오지 못했습니다. <button type="button" class="f-btn" data-po-retry>다시 시도</button></p>`;console.error('Purchase records:',error);}
 finally{if(seq===ticket)root.setAttribute('aria-busy','false');}
}
function detail(r){
 const l=r.l,o=r.order;
 const dates=[['발주일',r.orderDate],['제작 완료 예정',r.productionPlanned],['실제 제작 완료',r.productionActual],['공장 출고 예정',r.dispatchPlanned],['실제 공장 출고',r.dispatchActual],['예상 입고일',r.held?'보류':r.eta],['실제 입고일',r.received]];
 const notes=[];
 if(l.factory_dispatch_source_text)notes.push('발주서 출고 표기: '+l.factory_dispatch_source_text);
 if(l.kc_expected_on)notes.push('KC 완료 예정: '+l.kc_expected_on);
 if(l.departure_target_on)notes.push('출항 목표: '+l.departure_target_on+(l.departure_is_confirmed?' (확정)':' (미확정)'));
 if(r.held)notes.push('보류 해제 및 실제 출고 확인 후 입고일 재산정');
 if(r.needsCheck)notes.push('예정일이 지났으며 실제 입고 여부 확인 필요');
 if(r.complete)notes.push(l.received_quantity_confirmed!=null?'확인된 입고 수량: '+number(l.received_quantity_confirmed)+'개':'표의 수량은 발주 수량이며 실제 검수 수량은 별도 확인');
 return `<div class="po-detail-body"><div class="po-detail-head"><strong>${esc(o.item||'발주 상세')}</strong><button type="button" data-po-close>닫기</button></div><dl>${dates.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value||'미입력·미확인')}</dd></div>`).join('')}</dl>${notes.length?`<p>${notes.map(esc).join('<br>')}</p>`:''}${l.source_file?`<small>발주서: ${esc(l.source_file)}${l.source_row?' · '+esc(l.source_row)+'행':''}</small>`:''}</div>`;
}
root.addEventListener('click',e=>{
 if(e.target.closest('[data-po-retry]')){load();return;}
 const close=e.target.closest('[data-po-close]'),b=e.target.closest('[data-po-detail]');
 if(!b&&!close)return;
 const wasOpen=b?.getAttribute('aria-expanded')==='true';
 root.querySelectorAll('.po-detail-row').forEach(el=>el.remove());
 root.querySelectorAll('[data-po-detail]').forEach(el=>el.setAttribute('aria-expanded','false'));
 if(close||wasOpen)return;
 const r=snapshot.rows.find(r=>String(r.order.id)===b.dataset.poDetail);if(!r)return;
 b.setAttribute('aria-expanded','true');const tr=b.closest('tr'),extra=document.createElement('tr');extra.className='po-detail-row';extra.innerHTML=`<td colspan="${tr.children.length}">${detail(r)}</td>`;tr.insertAdjacentElement('afterend',extra);
});
root.addEventListener('error',e=>{if(e.target.tagName==='IMG'){const parent=e.target.parentElement;e.target.remove();parent.innerHTML='<span>사진<br>미연결</span>';}},true);

const originalTab=invSetTab;
invSetTab=function(tab,el){
 root.style.display=tab==='purchase'?'':'none';
 const target=el||[...document.querySelectorAll('#inv-tabs .page-tab')].find(el=>(el.getAttribute('onclick')||'').includes("invSetTab('"+tab+"'"));
 const result=originalTab(tab,target);
 if(tab==='purchase')load();
 return result;
};
const originalInit=initInventory;
initInventory=function(...args){root.style.display='none';return originalInit.apply(this,args);};
const originalRender=renderPage;
renderPage=async function(page,sub){const result=await originalRender(page,sub);if(page==='inventory'&&sub==='purchase')invSetTab('purchase');return result;};
window.CHEROPPurchaseOrders={normalize,plusSeven,load};
})();
