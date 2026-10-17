/* Approved flat production views. Inventory writes remain in the existing core. */
(() => {
'use strict';
const api=window.CHEROPSections,esc=v=>escapeHtml(String(v??'')),num=v=>Number(v)||0,fmt=v=>num(v).toLocaleString();
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const name=p=>p?(p.option_name?p.name+' · '+p.option_name:p.name):'상품 정보 없음';
const btn=(text,action,id='',extra='')=>`<button type="button" class="w8-button" data-w8="${action}" data-id="${esc(id)}" ${extra}>${esc(text)}</button>`;
const empty=text=>`<p class="w8-empty">${esc(text)}</p>`;
const table=(headers,rows,kind='')=>`<div class="w8-scroll"><table class="w8-table ${kind}"><thead><tr>${headers.map(t=>`<th>${esc(t)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
const tickets={},next=k=>tickets[k]=(tickets[k]||0)+1;
const state={products:[],recommend:[],query:'',status:'active',hidden:[],defects:[]};
function errorView(id,error,retry){$(id).innerHTML=`<p role="alert" class="w8-empty">불러오지 못했습니다. ${esc(error.message||'다시 시도해주세요.')}</p>${btn('다시 불러오기',retry)}`;}
async function productData(){return api.queryAll('products');}
function productMap(rows){return new Map(rows.map(p=>[p.id,p]));}

loadWorkLogList=async function(){
 const ticket=next('work');try{
  const [s,products]=await Promise.all([getAppState(),productData()]);if(ticket!==tickets.work)return;
  state.products=products;const map=productMap(products);_workLogProdList=products.filter(p=>!p.is_discontinued&&!(s.prod_hidden||[]).includes(p.id)).sort((a,b)=>name(a).localeCompare(name(b),'ko'));
  const end=today(),start=new Date(end+'T12:00:00Z');start.setUTCDate(start.getUTCDate()-(_workLogPeriodDays-1));const cutoff=start.toISOString().slice(0,10);
  const all=(s.work_logs||[]).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  const logs=all.filter(r=>r.date>=cutoff&&r.date<=end),seen=new Set(),recent=[];
  for(const row of all){if(seen.has(row.product_id)||!_workLogProdList.some(p=>p.id===row.product_id))continue;seen.add(row.product_id);recent.push(row.product_id);if(recent.length===4)break;}
  $('work-log-recent-row').style.display=recent.length?'flex':'none';$('work-log-recent-chips').innerHTML=recent.map(id=>btn(name(map.get(id)),'work-pick',id)).join('');
  $('w8-work-range').textContent=`${cutoff} – ${end} · ${logs.length}건 · ${fmt(logs.reduce((n,r)=>n+num(r.qty),0))}개`;
  [7,14,30].forEach(days=>{const el=$('work-log-period-'+days);el.classList.toggle('on',days===_workLogPeriodDays);el.setAttribute('aria-pressed',String(days===_workLogPeriodDays));});
  $('work-log-timeline').innerHTML=logs.length?CHEROPWorkQC.renderDays(logs,map):empty('선택한 기간에 등록된 작업 기록이 없습니다.');
 }catch(error){if(ticket===tickets.work)errorView('work-log-timeline',error,'work-retry');}
};
workLogSetPeriod=function(days){if(![7,14,30].includes(Number(days)))return;_workLogPeriodDays=Number(days);return loadWorkLogList();};
workLogSearch=function(query){
 const q=query.trim().toLowerCase(),rows=_workLogProdList.filter(p=>!q||name(p).toLowerCase().includes(q)).slice(0,50);
 $('work-log-dd').innerHTML=rows.length?rows.map(p=>`<button type="button" data-w8="work-select" data-id="${esc(p.id)}">${esc(name(p))}${p.category?`<small>${esc(p.category)}</small>`:''}</button>`).join(''):empty('검색 결과가 없습니다.');$('work-log-dd').style.display='block';
};
function openWork(productId){
 const modal=$('w8-work-modal');modal.classList.add('on');$('work-log-dd').style.display='none';
 if(productId){workLogPick(productId);$('work-log-search').value=_workLogSelLabel;}else{_workLogSelProdId=null;_workLogSelLabel='';$('work-log-search').value='';}
 $('work-log-qty').value='';setTimeout(()=>$(productId?'work-log-qty':'work-log-search').focus(),30);
}
workLogPickChip=openWork;
function closeWork(){closeModal('w8-work-modal');$('work-log-dd').style.display='none';document.querySelector('[data-w8="work-new"]')?.focus();}
$('work-log-search').addEventListener('input',e=>{_workLogSelProdId=null;_workLogSelLabel='';workLogSearch(e.target.value);});
$('work-log-search').addEventListener('focus',e=>workLogSearch(e.target.value));
$('w8-work-modal').addEventListener('click',e=>{if(e.target===$('w8-work-modal'))closeWork();});
$('w8-work-form').addEventListener('submit',async e=>{e.preventDefault();const save=$('w8-work-save');if(save.disabled)return;save.disabled=true;try{await addWorkLog();if(!$('work-log-qty').value)closeWork();}catch(error){toast(error.message||'작업을 저장하지 못했습니다.');}finally{save.disabled=false;}});

loadProdShipCard=async function(){
 const ticket=next('ship');try{
  const [ships,products,inventory]=await Promise.all([api.queryAll('sales_log',q=>q.eq('sale_date',today()).gt('quantity',0)),productData(),api.queryAll('inventory')]);if(ticket!==tickets.ship)return;
  const map=productMap(products),inv=new Map(inventory.map(r=>[r.product_id,r])),cats=[...new Set(ships.map(r=>map.get(r.product_id)?.category).filter(Boolean))];
  if(_prodShipCat&&!cats.includes(_prodShipCat))_prodShipCat='';
  $('prod-ship-cat-pills').innerHTML=['',...cats].map(c=>btn(c||'전체','ship-category',c,`aria-pressed="${c===_prodShipCat}"`)).join('');
  const grouped=new Map();for(const r of ships){if(_prodShipCat&&map.get(r.product_id)?.category!==_prodShipCat)continue;const key=JSON.stringify([r.product_id,r.channel]);if(!grouped.has(key))grouped.set(key,{...r,quantity:0});grouped.get(key).quantity+=num(r.quantity);}
  const rows=[...grouped.values()];$('prod-ship-date-lbl').textContent=`${today()} · ${fmt(rows.reduce((n,r)=>n+r.quantity,0))}개`;
  $('prod-ship-list').innerHTML=rows.length?table(['상품·옵션','채널','출고 수량','완료 / 대기'],rows.map(r=>`<tr><td data-label="상품"><strong>${esc(name(map.get(r.product_id)))}</strong></td><td data-label="채널">${esc(r.channel||'미지정')}</td><td data-label="출고">${fmt(r.quantity)}개</td><td data-label="완료 / 대기">${fmt(inv.get(r.product_id)?.produced_stock)} / ${fmt(inv.get(r.product_id)?.pending_production)}</td></tr>`).join(''),'w8-ship-table'):empty('오늘 등록된 출고 내역이 없습니다.');
 }catch(error){if(ticket===tickets.ship)errorView('prod-ship-list',error,'ship-retry');}
};

function paintRecommendations(){
 let rows=state.recommend.filter(r=>(prodRecCat==='전체'||r.p.category===prodRecCat)&&(!state.query||name(r.p).toLowerCase().includes(state.query))&&(state.status==='all'||state.status===(r.p.is_discontinued?'disc':r.p.disc_status==='planned'?'planned':'active'))).filter(r=>_prodRecShowHidden?state.hidden.includes(r.p.id):!state.hidden.includes(r.p.id));
 rows.sort(prodRecSort==='progress'?(a,b)=>a.pct-b.pct:(a,b)=>(a.days??Infinity)-(b.days??Infinity));
 $('w8-rec-count').textContent=rows.length+'개';$('prod-rec-hidden-toggle').textContent=_prodRecShowHidden?'추천 목록으로':'숨긴 상품 '+state.hidden.length; $('prod-rec-hidden-toggle').setAttribute('aria-pressed',String(_prodRecShowHidden));
 $('w8-rec-results').innerHTML=rows.length?table(['상품·옵션','총재고','완료','대기','진행률','소진 예상','관리'],rows.map(r=>`<tr data-recommend-id="${esc(r.p.id)}"><td><strong>${esc(name(r.p))}</strong><small>${esc(r.p.category||'분류 없음')}</small></td><td data-label="총재고">${fmt(r.total)}</td><td data-label="완료">${fmt(r.produced)}</td><td data-label="대기">${fmt(r.pending)}</td><td data-label="진행률">${r.pct}%</td><td data-label="소진 예상" class="${r.days!==null&&r.days<=7?'w8-attention':''}">${r.days===null?'—':fmt(r.days)+'일'}</td><td><div class="w8-actions">${_prodRecShowHidden?btn('복원','rec-restore',r.p.id):btn('작업 담기','rec-add',r.p.id,r.p.is_discontinued?'disabled title="단종 상품"':'')+btn('숨김','rec-hide',r.p.id)}</div></td></tr>`).join(''),'w8-rec-table'):empty('선택한 조건에 해당하는 상품이 없습니다.');
}
loadProdRecFull=async function(){
 const ticket=next('rec');try{
  const [s,products,inventory,sales]=await Promise.all([getAppState(),productData(),api.queryAll('inventory'),api.queryAll('sales_log',q=>q.gte('sale_date',dateStr(new Date(Date.now()-28*86400000))))]);if(ticket!==tickets.rec)return;
  const invMap=new Map(inventory.map(r=>[r.product_id,r]));state.hidden=s.prod_hidden||[];
  state.recommend=products.map(p=>{const inv=invMap.get(p.id)||{},total=num(inv.total_stock),produced=num(inv.produced_stock);return{p,total,produced,pending:num(inv.pending_production),pct:total?Math.round(produced/total*100):0,days:daysUntilSoldOut(inv,calcVelocity(sales,p.id))};});
  const cats=[...new Set([...(s.inv_categories||[]),...products.map(p=>p.category).filter(Boolean)])];if(prodRecCat!=='전체'&&!cats.includes(prodRecCat))prodRecCat='전체';
  $('w8-rec-category').innerHTML=['전체',...cats].map(c=>`<option value="${esc(c)}" ${prodRecCat===c?'selected':''}>${esc(c==='전체'?'전체 카테고리':c)}</option>`).join('');$('w8-rec-sort').value=prodRecSort;paintRecommendations();
 }catch(error){if(ticket===tickets.rec)errorView('w8-rec-results',error,'rec-retry');}
};
for(const[id,key]of [['w8-rec-search','query'],['w8-rec-status','status']])$(id).addEventListener(id.endsWith('search')?'input':'change',e=>{state[key]=e.target.value.trim().toLowerCase();paintRecommendations();});
$('w8-rec-category').addEventListener('change',e=>{prodRecCat=e.target.value;paintRecommendations();});$('w8-rec-sort').addEventListener('change',e=>{prodRecSort=e.target.value;paintRecommendations();});

loadProdSupplyList=async function(){
 const ticket=next('supply');try{const s=await getAppState();if(ticket!==tickets.supply)return;
  $('prod-supply-list').innerHTML=(s.prod_supplies||[]).map(r=>`<article class="w8-row" data-supply-id="${esc(r.id)}"><div><strong>${esc(r.name)}</strong><small>부족 기준 ${fmt(r.alert)}개${Object.values(s.prod_supply_links||{}).some(arr=>arr.some(l=>l.id===r.id))?' · 자동 차감 연결 있음':''}</small></div><span class="${r.alert&&num(r.stock)<=num(r.alert)?'w8-attention':''}">${fmt(r.stock)}개</span><div class="w8-actions">${btn('입고','supply-stock',r.id)}${btn('편집','supply-edit',r.id)}</div></article>`).join('')||empty('등록된 소모품이 없습니다.');
  if(document.querySelector('.w8-legacy-links[open]'))await loadSupplyLinkCard();
 }catch(error){if(ticket===tickets.supply)errorView('prod-supply-list',error,'supply-retry');}
};
document.querySelector('.w8-legacy-links')?.addEventListener('toggle',e=>{if(e.target.open)loadSupplyLinkCard();});

const statusLabels={pending:'보류',restored:'복원 완료',disposed:'폐기'};
const photos=row=>[...new Set((row.photo_urls||[]).filter(u=>typeof u==='string'&&/^https?:\/\//.test(u)))];
function paintDefects(products){
 const map=productMap(products),all=state.defects;
 $('prod-defect-filter').innerHTML=[['all','전체'],...Object.entries(statusLabels)].map(([key,label])=>btn(label+' '+fmt(all.filter(r=>key==='all'||r.status===key).reduce((n,r)=>n+(num(r.qty)||1),0)),'defect-filter',key,`aria-pressed="${defectFilter===key}"`)).join('');
 const groups=new Map();for(const r of all.filter(r=>defectFilter==='all'||r.status===defectFilter)){const key=r.group_id||r.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 const sorted=[...groups].sort((a,b)=>String(b[1][0].date||'').localeCompare(String(a[1][0].date||''))||String(b[0]).localeCompare(String(a[0])));
 $('w8-defect-results').innerHTML=sorted.map(([key,rows])=>{
  const h=rows[0],counts=Object.entries(statusLabels).map(([status,label])=>{const n=rows.filter(r=>r.status===status).reduce((n,r)=>n+(num(r.qty)||1),0);return n?label+' '+fmt(n):'';}).filter(Boolean).join(' · '),urls=[...new Set(rows.flatMap(photos))];
  return `<article class="w8-defect-group" data-defect-group="${esc(key)}"><div class="w8-row"><div><strong>${esc(name(map.get(h.product_id)))}</strong><small>${esc(h.date||'날짜 미등록')} · ${h.type==='return'?'반품 불량':'생산 불량'}${h.channel?' · '+esc(h.channel):''}</small><p>${esc(h.memo||'메모 없음')}</p></div><div class="w8-defect-count"><strong>${fmt(rows.reduce((n,r)=>n+(num(r.qty)||1),0))}개</strong><small>${esc(counts)}</small></div></div><details class="w8-defect-details"><summary>처리·상세 <span>${rows.length}건${urls.length?' · 사진 '+urls.length+'장':''}</span></summary><div class="w8-detail-body">${h.group_id?`<div class="w8-actions">${btn('접수 수정','defect-edit',h.group_id)}</div>`:''}${rows.map((r,i)=>`<div class="w8-defect-unit" data-defect-id="${esc(r.id)}"><div><strong>${esc(r.group_index||i+1)} · ${fmt(num(r.qty)||1)}개</strong><small>${esc(statusLabels[r.status]||r.status||'상태 미등록')}${r.resolvedDate?' · '+esc(r.resolvedDate):''}</small>${r.memo?`<p>${esc(r.memo)}</p>`:''}${photos(r).length?`<div class="w8-photos">${photos(r).map((url,i)=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">사진 ${i+1} 보기</a>`).join('')}</div>`:''}</div><div class="w8-actions">${r.status==='pending'?btn('복원','defect-restore',r.id)+btn('폐기','defect-dispose',r.id):btn('기록 삭제','defect-delete',r.id)}</div></div>`).join('')}</div></details></article>`;
 }).join('')||empty('선택한 상태의 불량 기록이 없습니다.');
}
loadProdDefect=async function(){
 const ticket=next('defect');try{const[s,products]=await Promise.all([getAppState(),productData()]);if(ticket!==tickets.defect)return;state.defects=s.prod_defects||[];state.defectProducts=products;paintDefects(products);}catch(error){if(ticket===tickets.defect)errorView('w8-defect-results',error,'defect-retry');}
};

// Apply the same compact fields to all linked legacy dialogs, retaining their IDs and save handlers.
for(const id of ['prod-reserve-modal','prod-schedule-modal','prod-supply-modal','prod-link-modal','work-log-edit-modal','prod-defect-modal','defect-group-edit-modal','inv-cat-modal']){
 const modal=$(id);if(!modal)continue;modal.classList.add('w8-modal');const box=modal.querySelector('.modal,.modal-box');box?.setAttribute('role','dialog');box?.setAttribute('aria-modal','true');const title=modal.querySelector('.modal-kind');if(title){title.id||=id+'-title';box?.setAttribute('aria-labelledby',title.id);}
 modal.querySelectorAll('.mbtn').forEach(el=>{el.setAttribute('role','button');el.tabIndex=0;el.setAttribute('aria-label',el.getAttribute('onclick')?.includes('closeModal')?'닫기':'삭제');el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}});});
 modal.querySelectorAll('.f-btn').forEach(el=>{el.textContent=el.textContent.replace(/🗑|✏️|📎/gu,'').trim();});
}
const defectModal=$('prod-defect-modal'),optional=document.createElement('details');optional.className='w8-optional';optional.innerHTML='<summary>메모·사진 추가 <span>선택</span></summary>';
const memoRow=$('defect-memo').closest('.prop-row'),photoRow=$('defect-photo-input').closest('.prop-row');memoRow.before(optional);optional.append(memoRow,photoRow);
const originalDefectOpen=openDefectModal;openDefectModal=function(){originalDefectOpen();optional.open=false;};
const title=document.querySelector('#prod-schedule-modal .modal-kind');if(title)title.textContent='작업 예약 추가';
$('prod-supply-del-btn').textContent='삭제';
const actionMap={
 'work-new':()=>openWork(),'work-close':closeWork,'work-pick':id=>openWork(id),'work-select':id=>{workLogPick(id);$('work-log-search').value=_workLogSelLabel;$('work-log-dd').style.display='none';$('work-log-qty').focus();},'work-edit':id=>openWorkLogEdit(id),'work-retry':loadWorkLogList,
 'ship-category':id=>{_prodShipCat=id;return loadProdShipCard();},'ship-retry':loadProdShipCard,
 'category-manage':()=>openCatManageModal(),'rec-hidden':()=>{_prodRecShowHidden=!_prodRecShowHidden;paintRecommendations();},'rec-add':id=>addProdToToday(id),'rec-hide':id=>hideProdItem(id),'rec-restore':id=>unhideProdItem(id),'rec-retry':loadProdRecFull,
 'supply-stock':id=>addSupplyStock(id),'supply-edit':id=>openProdModal('supply-edit',id),'supply-retry':loadProdSupplyList,
 'defect-new':()=>openDefectModal(),'return-new':()=>{openDefectModal();setDefectType('return',$('defect-type-return'));},'defect-filter':id=>{defectFilter=id;paintDefects(state.defectProducts||[]);},'defect-edit':id=>openDefectGroupEdit(id),'defect-restore':id=>resolveDefect(id,'restored'),'defect-dispose':id=>resolveDefect(id,'disposed'),'defect-delete':id=>deleteDefect(id),'defect-retry':loadProdDefect
};
document.addEventListener('click',async e=>{const period=e.target.closest('[data-w8-period]');if(period)return workLogSetPeriod(Number(period.dataset.w8Period));const el=e.target.closest('[data-w8]');if(!el||el.disabled)return;const action=actionMap[el.dataset.w8];if(!action)return;el.disabled=true;try{await action(el.dataset.id);}catch(error){toast(error.message||'처리하지 못했습니다. 다시 시도해주세요.');}finally{el.disabled=false;}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('w8-work-modal').classList.contains('on'))closeWork();});
window.CHEROPProductionDesign={state,paintRecommendations,paintDefects,openWork};
})();
