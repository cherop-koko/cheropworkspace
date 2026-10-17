/* Reservation views use the existing records; stock allocation remains in the original core. */
(() => {
'use strict';
const api=window.CHEROPSections,esc=v=>escapeHtml(String(v??'')),num=v=>Number(v)||0;
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dateLabel=value=>{const d=new Date(value);return value&&!Number.isNaN(d.getTime())?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(d):'미등록';};
const tabNames={today:'오늘 작업',reservations:'예약 작업',supply:'소모품',calendar:'생산 캘린더',recommend:'상품화 추천',defect:'불량 관리'};
const state={channel:'',query:'',ticket:0,rows:[],scheduled:[],products:new Map()};
let editSnapshot=null,saving=false;
function matching(rows){const query=state.query.trim().toLowerCase();return rows.filter(r=>(!state.channel||r.channel===state.channel)&&(!query||(state.products.get(r.product_id)||r.product_id||'').toLowerCase().includes(query)));}
function paintReservations(){
 const shown=matching(state.rows),qty=shown.reduce((sum,r)=>sum+num(r.qty),0);
 $('prod-reservation-summary').textContent=`${shown.length.toLocaleString()}건 · ${qty.toLocaleString()}개${shown.length!==state.rows.length?' / 전체 '+state.rows.length+'건':''}`;
 $('prod-rsv-list').innerHTML=shown.length?`<div class="w7-rsv-head"><span>상품·옵션</span><span>채널</span><span>예약 수량</span><span>등록일</span></div>`+shown.map(r=>`<div class="w7-rsv-row" data-reservation-id="${esc(r.id)}"><strong>${esc(state.products.get(r.product_id)||r.product_id||'상품 정보 없음')}</strong><span class="w7-rsv-channel">${esc(r.channel||'미지정')}</span><span class="w7-rsv-qty">${num(r.qty).toLocaleString()}개</span><time>${esc(dateLabel(r.createdAt))}</time></div>`).join(''):'<p class="w7-empty">해당 조건의 채널 배분 예약이 없습니다.</p>';
}
function paintScheduled(){
 const groups=new Map();for(const r of state.scheduled){const key=r.date||'날짜 미등록';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 $('prod-reserve-list').innerHTML=[...groups].map(([date,rows])=>`<section class="w7-reserve-day"><h3>${esc(date)} ${/^\d{4}-\d{2}-\d{2}$/.test(date)?`<small>${date<today()?'예정일 지남':date===today()?'오늘':'예정'}</small>`:''}</h3>${rows.map(r=>`<div class="w7-schedule-row" data-schedule-id="${esc(r.id)}"><div><strong>${esc(r.item||state.products.get(r.product_id)||r.product_id||'상품 정보 없음')}</strong>${r.memo?`<p>${esc(r.memo)}</p>`:''}<small>${r.done?'완료 표시 · ':r.reserved?'작업 예약 · ':'기존 작업 대기 · '}${num(r.mins)?'예상 '+num(r.mins)+'분':''}</small></div><span>${num(r.qty).toLocaleString()}개</span><button type="button" class="w2-button" data-production-edit="${esc(r.id)}">수정</button></div>`).join('')}</section>`).join('')||'<p class="w7-empty">등록된 작업 예약이 없습니다.</p>';
}
async function loadReservations(){
 const ticket=++state.ticket;
 try{
  const s=await getAppState(),rows=(s.ch_reservations||[]).slice().sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))),scheduled=(s.prod_today||[]).slice().sort((a,b)=>String(a.date||'9999').localeCompare(String(b.date||'9999')));
  const ids=[...new Set([...rows,...scheduled].map(r=>r.product_id).filter(Boolean))],products=[];
  // Small batches avoid URL-length and API row limits as reservations grow.
  for(let i=0;i<ids.length;i+=100){const r=await db.from('products').select('id,name,option_name').in('id',ids.slice(i,i+100));if(r.error)throw r.error;products.push(...(r.data||[]));}
  if(ticket!==state.ticket)return;
  state.rows=rows;state.scheduled=scheduled;state.products=new Map(products.map(p=>[p.id,p.option_name?p.name+' · '+p.option_name:p.name]));
  const channels=[...new Set(rows.map(r=>r.channel).filter(Boolean))].sort();if(state.channel&&!channels.includes(state.channel))state.channel='';
  $('prod-reservation-channel').innerHTML='<option value="">전체 채널</option>'+channels.map(ch=>`<option value="${esc(ch)}" ${ch===state.channel?'selected':''}>${esc(ch)}</option>`).join('');
  $('prod-reservation-search').value=state.query;$('prod-reservation-count').textContent=String(rows.length+scheduled.length);
  paintReservations();paintScheduled();
 }catch(error){if(ticket!==state.ticket)return;$('prod-reserve-list').innerHTML='<p class="w7-empty">예약을 다시 불러온 뒤 확인해주세요.</p>';$('prod-reservation-count').textContent='';$('prod-reservation-summary').textContent='';$('prod-rsv-list').innerHTML=`<p class="w7-empty" role="alert">예약을 불러오지 못했습니다. ${esc(error.message)}</p><button class="w2-button" type="button" data-production-retry>다시 불러오기</button>`;toast('예약을 불러오지 못했습니다.');}
}
loadProdReservations=loadReservations;
loadProdReserveList=loadReservations;
async function showTab(tab){
 prodTab=Object.hasOwn(tabNames,tab)?tab:'today';
 document.querySelectorAll('#prod-tabs [data-prod-tab]').forEach(el=>{const selected=el.dataset.prodTab===prodTab;el.classList.toggle('on',selected);el.setAttribute('aria-current',selected?'page':'false');});
 Object.keys(tabNames).forEach(key=>{const el=$('prod-tab-'+key);if(el)el.style.display=key===prodTab?'':'none';});
 const label=$('prod-date-sub');if(label)label.textContent=today().replaceAll('-','.');
 const crumb=$('tb-crumb');if(crumb)crumb.textContent='상품화 관리 / '+tabNames[prodTab];
 if(prodTab==='today')await Promise.all([loadProdShipCard(),loadWorkLogList(),loadReservations()]);
 else if(prodTab==='reservations')await loadReservations();
 else if(prodTab==='supply')await loadProdSupplyList();
 else if(prodTab==='calendar')await loadProdCal();
 else if(prodTab==='recommend')await loadProdRecFull();
 else if(prodTab==='defect')await loadProdDefect();
}
prodSetTab=function(tab){if(parseHash().page!=='production'||parseHash().sub!==tab){nav('production',tab);return;}return showTab(tab);};
initProductionPage=function(){return showTab(parseHash().sub||'today');};
const openOriginal=openProdReserveModal;
openProdReserveModal=async function(id=null){const s=await getAppState();editSnapshot=id?structuredClone((s.prod_today||[]).find(r=>r.id===id)):null;if(id&&!editSnapshot){toast('예약이 변경됐습니다. 다시 불러와주세요.');return;}await openOriginal(id);};
// Keep the existing editor and record shape; guard only the record being edited.
saveProdReserve=async function(){
 if(saving)return;const id=window._prodReserveEditId,before=editSnapshot,date=$('prod-reserve-date').value,product_id=$('prod-reserve-prod-id').value,qty=Number($('prod-reserve-qty').value),mins=Number($('prod-reserve-min').value)||0,per=Number($('prod-reserve-per').value)||1,memo=$('prod-reserve-memo').value.trim(),item=$('prod-reserve-prod-search').value.trim();
 if(!date||!product_id||!Number.isInteger(qty)||qty<1||mins<0||per<1){toast('날짜, 상품, 수량과 작업시간을 확인해주세요.');return;}
 saving=true;try{await api.mutateMain(s=>{s.prod_today??=[];const patch={date,product_id,qty,mins:mins?Math.round(qty*mins/per):before&&num(before.qty)===qty&&before.product_id===product_id?num(before.mins):0,memo,item};if(id){const row=s.prod_today.find(r=>r.id===id);if(!row||JSON.stringify(row)!==JSON.stringify(before))throw Error('예약이 다른 화면에서 변경됐습니다. 다시 열어주세요.');Object.assign(row,patch);}else s.prod_today.push({id:'pt-'+crypto.randomUUID(),reserved:true,...patch});if(mins){s.prod_time??={};s.prod_time[product_id]={mins,per};}});closeModal('prod-reserve-modal');editSnapshot=null;toast('작업 예약을 저장했습니다.');await loadReservations();}catch(error){toast(error.message||'예약을 저장하지 못했습니다.');}finally{saving=false;}
};
$('prod-reservation-filter').addEventListener('submit',e=>{e.preventDefault();state.query=$('prod-reservation-search').value;paintReservations();});
$('prod-reservation-search').addEventListener('input',e=>{state.query=e.target.value;paintReservations();});
$('prod-reservation-channel').addEventListener('change',e=>{state.channel=e.target.value;paintReservations();});
document.addEventListener('click',e=>{const edit=e.target.closest('[data-production-edit]');if(edit)openProdReserveModal(edit.dataset.productionEdit);if(e.target.closest('[data-production-retry]'))loadReservations();});
window.CHEROPProduction={state,loadReservations,showTab,matching};
})();
