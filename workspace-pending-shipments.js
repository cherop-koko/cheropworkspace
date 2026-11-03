/* Pending-stock shipments: consent, persistent follow-up, and work-log linkage. */
(() => {
'use strict';
const esc=v=>escapeHtml(String(v??'')),fmt=v=>Number(v||0).toLocaleString();
const state={reviews:[],products:new Map(),busy:false,allHistory:false};let ticket=0,workTicket=0;
const actor=()=>typeof user==='object'&&user?{id:user.id,name:user.name}:{};
const label=r=>{const p=state.products.get(r.product_id);return p?p.name+(p.option_name?' · '+p.option_name:''):r.product_id;};
const invalidate=()=>{_appStateCache=null;_appStateCacheAt=0;};
const tab=$('inv-tab-overview'),layout=document.createElement('div'),main=document.createElement('div'),aside=document.createElement('aside');
layout.className='ship-review-layout';main.className='ship-review-main';aside.id='ship-review-panel';aside.className='ship-review-panel';aside.setAttribute('aria-label','상품화 확인 필요');
while(tab.firstChild)main.appendChild(tab.firstChild);layout.append(main,aside);tab.append(layout);
const button=(text,action,id='')=>`<button type="button" class="w11-button" data-ship-review="${action}" data-id="${esc(id)}" ${state.busy?'disabled':''}>${text}</button>`;
function card(r,history=false){return `<article data-review-id="${esc(r.id)}"><strong>${esc(label(r))}</strong><p>${esc(r.sale_date||'날짜 미등록')} · ${esc(r.channel)}<br>대기에서 차감 <b>${fmt(history?r.original_quantity:r.quantity)}개</b>${history&&r.original_quantity!==r.quantity?` · 현재 ${fmt(r.quantity)}개`:''}</p><small>등록 ${esc(r.created_by?.name||'미기록')}</small>${history?`<p>${r.status==='completed'?'처리완료':'출고 취소'}${r.completed_by?.name?' · '+esc(r.completed_by.name):''}${r.completed_at?' · '+esc(new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(r.completed_at))):''}</p>`:button('처리완료','complete',r.id)}</article>`;}
function paint(){
 const open=state.reviews.filter(r=>r.status==='open'&&Number(r.quantity)>0),history=state.reviews.filter(r=>r.status!=='open');
 layout.classList.toggle('has-reviews',open.length>0||history.length>0);
 const expanded=aside.querySelector('details')?.open;
 aside.innerHTML=`<div class="ship-review-heading"><h2>상품화 확인 필요 <span>${open.length}</span></h2>${button('새로고침','refresh')}</div><p class="ship-review-note">대기재고에서 먼저 출고한 내역입니다.<br>처리완료는 재고를 다시 변경하지 않습니다.</p><div class="ship-review-open">${open.map(r=>card(r)).join('')||'<p class="ship-review-empty">확인할 내역이 없습니다.</p>'}</div><details ${expanded?'open':''}><summary>처리 이력 ${history.length}건</summary>${history.slice(0,state.allHistory?undefined:50).map(r=>card(r,true)).join('')||'<p class="ship-review-empty">처리 이력이 없습니다.</p>'}${history.length>50&&!state.allHistory?button('이력 모두 보기','history'):''}</details>`;
}
async function readState(){
 const [{data,error},products]=await Promise.all([db.from('app_state').select('data').eq('id','cherop_main').single(),CHEROPSections.queryAll('products')]);
 if(error)throw Error(error.message);return{data:data?.data||{},products};
}
async function load(){const current=++ticket;try{const {data,products}=await readState();if(current!==ticket)return;state.reviews=Object.values(data.inventory_pending_reviews||{}).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));state.products=new Map(products.map(p=>[p.id,p]));paint();return true;}catch(error){if(current===ticket)aside.innerHTML=`<h2>상품화 확인 필요</h2><p role="alert">${esc(error.message||'불러오지 못했습니다.')}</p>${button('다시 불러오기','refresh')}`;return false;}}
const originalOverview=loadInvOverview;
loadInvOverview=async function(...args){await Promise.all([originalOverview(...args),load()]);};
async function complete(id,quantity){
 const {data,error}=await db.rpc('complete_pending_shipment_review_v1',{p_review_id:id,p_expected_quantity:quantity,p_actor:actor()});
 if(error)throw Error(error.message);invalidate();await load();
 if(typeof loadWorkLogList==='function'&&$('page-production')?.classList.contains('on'))await loadWorkLogList();
 toast('처리완료 · 확인 이력을 남겼습니다. 재고는 다시 차감하지 않습니다.',5000);return data;
}
aside.addEventListener('click',async e=>{const b=e.target.closest('[data-ship-review]');if(!b||state.busy)return;
 if(b.dataset.shipReview==='refresh')return load();if(b.dataset.shipReview==='history'){state.allHistory=true;paint();return;}
 const r=state.reviews.find(x=>x.id===b.dataset.id);if(!r)return;state.busy=true;b.disabled=true;
 try{await complete(r.id,Number(r.quantity));}catch(error){toast(error.message||'저장하지 못했습니다.');await load();}finally{state.busy=false;paint();}
});

const dialog=document.createElement('dialog');dialog.className='ship-pending-confirm';dialog.setAttribute('aria-labelledby','ship-pending-title');
dialog.innerHTML='<form method="dialog"><h2 id="ship-pending-title">대기재고 차감 확인</h2><p id="ship-pending-message"></p><div id="ship-pending-breakdown"></div><p class="ship-review-note">총재고도 출고 수량만큼 줄어듭니다. 대기에서 차감한 수량은 상품화 확인 필요 목록에 남습니다.</p><div class="ship-pending-actions"><button type="button" id="ship-pending-cancel" autofocus>취소</button><button type="button" id="ship-pending-accept">확인 후 출고 등록</button></div></form>';
document.body.append(dialog);let resolveConsent=null;
function settle(accepted){if(!resolveConsent)return;const resolve=resolveConsent;resolveConsent=null;dialog.close();resolve(accepted);}
dialog.addEventListener('cancel',e=>{e.preventDefault();settle(false);});dialog.addEventListener('close',()=>{if(resolveConsent)settle(false);});
$('ship-pending-cancel').onclick=()=>settle(false);$('ship-pending-accept').onclick=()=>settle(true);
function confirmPending(rows,changed=false){
 if(resolveConsent)throw Error('다른 출고 확인이 진행 중입니다.');
 $('ship-pending-message').textContent=changed?'입력 중 재고가 변경됐습니다. 바뀐 차감 수량을 확인해주세요.':'완료 재고를 먼저 사용하고, 부족분을 대기재고에서 차감합니다.';
 $('ship-pending-breakdown').innerHTML=`<table><thead><tr><th>상품 · 채널</th><th>출고</th><th>완료</th><th>대기</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.product_name||r.product_id)}<small>${esc(r.channel)}</small></td><td>${fmt(r.quantity)}</td><td>${fmt(r.completed_quantity)}</td><td><strong>${fmt(r.pending_quantity)}</strong></td></tr>`).join('')}</tbody></table>`;
 return new Promise(resolve=>{resolveConsent=resolve;dialog.showModal();});
}

// A linked confirmation is a work record with no inventory effect.
const workField=document.createElement('label');workField.className='w8-field ship-work-link';workField.innerHTML='<span>작업 구분</span><select id="ship-work-review"><option value="new">신규 상품화 · 재고 반영</option></select><small id="ship-work-hint">선출고 건은 연결해서 처리하면 재고가 다시 늘어나지 않습니다.</small>';
$('w8-work-form').querySelector('.modal-body').append(workField);
function workRows(pid){return state.reviews.filter(r=>r.product_id===pid&&r.status==='open'&&Number(r.quantity)>0);}
async function syncWork(pid){const current=++workTicket;await load();if(current!==workTicket||pid!==_workLogSelProdId)return;
 const rows=workRows(pid),select=$('ship-work-review');
 select.innerHTML=(rows.length?'<option value="choose">신규 작업 또는 선출고 건을 선택해주세요</option>':'')+'<option value="new">신규 상품화 · 재고 반영</option>'+rows.map(r=>`<option value="${esc(r.id)}">선출고 확인 · ${esc(r.sale_date)} · ${esc(r.channel)} · ${fmt(r.quantity)}개</option>`).join('');
 select.value=rows.length?'choose':'new';$('work-log-qty').readOnly=false;
 $('ship-work-hint').textContent=rows.length?'선출고 건은 이미 재고에서 차감했습니다. 해당 출고를 선택해 확인만 완료해주세요.':'선출고 건은 연결해서 처리하면 재고가 다시 늘어나지 않습니다.';
}
const originalPick=workLogPick;workLogPick=function(id){originalPick(id);void syncWork(id);};
$('work-log-search').addEventListener('input',()=>{++workTicket;$('ship-work-review').innerHTML='<option value="new">신규 상품화 · 재고 반영</option>';$('work-log-qty').readOnly=false;});
$('ship-work-review').addEventListener('change',e=>{const r=state.reviews.find(r=>r.id===e.target.value);$('work-log-qty').readOnly=!!r;if(r)$('work-log-qty').value=r.quantity;$('w8-work-form').querySelector('.w8-note').textContent=r?'이미 출고한 수량의 상품화 확인만 기록합니다. 재고는 다시 변경하지 않습니다.':'상품화 완료된 수량을 입력합니다. 저장하면 기존 재고 처리와 채널 예약 배분이 실행됩니다.';});
const originalAddWork=addWorkLog;
addWorkLog=async function(){
 let pid=_workLogSelProdId;if(!pid){const search=$('work-log-search').value.trim(),p=_workLogProdList.find(p=>(p.name+(p.option_name?' · '+p.option_name:''))===search);pid=p?.id;}
 if(!pid)return originalAddWork();
 const chosen=$('ship-work-review').value;if(!await load())throw Error('선출고 확인 내역을 불러오지 못했습니다. 다시 시도해주세요.');const open=workRows(pid);
 if(chosen==='choose'){toast('신규 상품화인지 선출고 확인인지 선택해주세요.');return;}
 if(chosen!=='new'){
   const r=open.find(r=>r.id===chosen);if(!r){toast('출고 내역이 변경됐습니다. 다시 선택해주세요.');await syncWork(pid);return;}
   await complete(r.id,Number(r.quantity));$('work-log-qty').value='';$('work-log-qty').readOnly=false;$('work-log-search').value='';_workLogSelProdId=null;_workLogSelLabel='';await loadWorkLogList();return;
 }
 if(open.length&&!await customConfirm('신규 상품화로 등록할까요?',`같은 상품의 선출고 확인 ${open.reduce((n,r)=>n+Number(r.quantity),0)}개가 남아 있습니다. 이미 출고한 건이면 작업 구분에서 해당 출고를 선택해주세요.`,'신규 작업 등록'))return;
 return originalAddWork();
};
async function protectedWork(id){const {data,error}=await db.from('app_state').select('data').eq('id','cherop_main').single();if(error)throw error;return(data?.data?.work_logs||[]).some(r=>r.id===id&&r.inventory_effect==='already_shipped');}
const protectedMessage=()=>toast('선출고 확인 이력입니다. 수량 수정·취소는 연결된 출고 내역에서 처리해주세요.',5000);
const originalOpenEdit=openWorkLogEdit;openWorkLogEdit=async function(id){if(await protectedWork(id))return protectedMessage();return originalOpenEdit(id);};
const originalSaveEdit=saveWorkLogEdit;saveWorkLogEdit=async function(){if(await protectedWork(_workLogEditId))return protectedMessage();return originalSaveEdit();};
const originalDeleteWork=deleteWorkLog;deleteWorkLog=async function(){if(await protectedWork(_workLogEditId))return protectedMessage();return originalDeleteWork();};
window.CHEROPPendingShipments={state,load,paint,complete,confirm:confirmPending,syncWork};paint();
})();
