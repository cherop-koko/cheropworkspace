/* Approved inventory/sales views; original write handlers and record IDs are retained. */
(()=>{'use strict';
const api=CHEROPSections,esc=v=>escapeHtml(String(v??'')),num=v=>Number(v)||0,fmt=v=>num(v).toLocaleString(),label=p=>p?(p.option_name?p.name+' · '+p.option_name:p.name):'상품 정보 없음';
// Paginate every read in the adapted legacy loaders. Explicit pagers keep their own ranges.
const readClient={from(table){let q=db.from(table),explicit=false,single=false;const proxy=new Proxy({}, {get(_,key){if(key==='then')return(resolve,reject)=>(async()=>{q=q.order('id',{ascending:true});if(explicit||single){const r=await q;if(r.error)throw r.error;return r;}let data=[];for(let offset=0;;offset+=500){const r=await q.range(offset,offset+499);if(r.error)throw r.error;data.push(...(r.data||[]));if((r.data||[]).length<500)return{data,error:null};}})().then(resolve,reject);return(...args)=>{if(['insert','update','upsert','delete'].includes(key))throw Error('조회 화면에서 데이터 변경을 차단했습니다.');if(key==='range'||key==='limit')explicit=true;if(key==='single'||key==='maybeSingle')single=true;q=q[key](...args);return proxy;};}});return proxy;}};
let stockSnapshot=null,stockSnapshotAt=0,stockRequest=null,inventoryTicket=0,channelTicket=0;
async function stockData(cached=false){if(cached&&stockSnapshot&&Date.now()-stockSnapshotAt<30000)return stockSnapshot;if(!stockRequest)stockRequest=Promise.all([api.queryAll('products'),api.queryAll('inventory'),api.queryAll('channel_inventory'),api.queryAll('sales_log',q=>q.gte('sale_date',dateStr(new Date(Date.now()-28*86400000)))),getAppState()]).then(([products,inventory,channels,sales,state])=>(imageState=state,stockSnapshotAt=Date.now(),stockSnapshot={products,inventory,channels,sales,state})).finally(()=>{stockRequest=null;});return stockRequest;}
const matches=(p,q)=>{const text=[p.name,p.option_name,p.sku,p.category].filter(Boolean).join(' ').normalize('NFKC').toLowerCase();return q.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean).every(term=>text.includes(term)||text.replace(/\s/g,'').includes(term));};
const view={salesTab:'overview',channel:'',ticket:0,products:[],sales:[],revenues:[],inventory:[],reservations:[]};
const table=(heads,rows)=>`<div class="w11-scroll"><table class="inv-tbl"><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const button=(t,a,id='')=>`<button type="button" class="w11-button" data-stock="${a}" data-id="${esc(id)}">${t}</button>`;
const empty=t=>`<p class="w11-empty">${esc(t)}</p>`;
// Read-only thumbnail matching. Never guess using partial names or change product records.
let imageState=null,imageSource=null,imageIndex=new Map();
const imageKey=v=>String(v||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
const imageAliases={'오리지널 몽모':'몽모','오리지널 모리':'모리','오리지널 코코':'코코','오리지널 몽모리':'몽모리','다람쥐 몽모':'몽람이','고슴도치 몽모':'몽슴도치','오리지널 몽모 벨트커버':'오리지널 몽모 안전벨트 커버','오리지널 모리 벨트커버':'오리지널 모리 안전벨트 커버'};
function productImage(p){
 const s=imageState||stockSnapshot?.state;
 if(s!==imageSource){imageSource=s;imageIndex=new Map();for(const year of Object.values(s?.plan||{}))for(const item of year.products||[]){const src=item.imgs?.front||item.imgUrl||item.storeImage;if(!src)continue;for(const name of [item.name,item.storeName]){if(!name)continue;for(const key of new Set([imageKey(name),imageKey(name.replace(/\([^)]*\)/g,''))])){const matches=imageIndex.get(key)||[];matches.push({id:item.id,src});imageIndex.set(key,matches);}}}}
 const direct=p?.img_url||p?.image_url||p?.imgs?.front;
 if(direct)return direct;
 const choices=imageIndex.get(imageKey(imageAliases[p?.name]||p?.name))||[];
 const unique=[...new Map(choices.map(x=>[x.id,x])).values()];return unique.length===1?unique[0].src:'';
}
function productCell(p){const src=productImage(p),safe=/^(https?:\/\/|data:image\/(png|jpe?g|webp|gif);base64,)/i.test(src)?src:'';return `<span class="w13-product"><span class="w13-thumb${safe?'':' is-empty'}" title="${safe?'상품 대표이미지 · 옵션은 상품명 아래 확인':'연결된 이미지 없음'}">${safe?`<img src="${esc(safe)}" alt="" loading="lazy" decoding="async" draggable="false" onerror="this.parentElement.classList.add('is-empty');this.remove()">`:''}<span>이미지<br>없음</span></span><span class="w13-product-text"><span>${esc(p?.name||'상품 정보 없음')}</span>${p?.option_name?`<small>${esc(p.option_name)}</small>`:''}</span></span>`;}

loadInvOverviewBanner=async function() {
 const db=readClient;

  try {
    const prods    = (await db.from('products').select('*').eq('is_discontinued',false)).data||[];
    const invRows  = (await db.from('inventory').select('*')).data||[];
    const salesRows= await dbFetchAll(() => db.from('sales_log').select('*').gte('sale_date', dateStr(new Date(Date.now()-28*86400000))));
    // 단종예정 + 이미 발주 등록된 상품 제외 (발주 알림 탭과 동일 기준)
    const sBan = await getAppState();
    const orderedPidsBan = new Set((sBan.ops_orders||[])
      .filter(o => o.status !== 'received' && o.status !== 'cancelled' && o.product_id)
      .map(o => o.product_id));
    const hiddenAlertSet = new Set(sBan.inv_alert_hidden || []);
    let alertCount = 0;
    for(const p of prods){
      if (p.disc_status === 'planned' || orderedPidsBan.has(p.id) || hiddenAlertSet.has(p.id)) continue;
      const inv = invRows.find(x=>x.product_id===p.id)||{};
      const velAll = calcVelocity(salesRows, p.id);
      const d = daysUntilReorder(inv, velAll);
      if(d !== null && d <= REORDER_TH.warn) alertCount++;
    }
    const badge = $('inv-alert-badge');
    if(badge){ badge.textContent=alertCount; badge.style.display=alertCount>0?'inline-flex':'none'; }
    const banner = $('inv-overview-banner');
    if(alertCount>0){
      banner.innerHTML=`<div style="display:flex;align-items:center;gap:10px;padding:11px 16px;background:#FEF8EC;border:0.5px solid var(--amber);border-radius:10px;">
        <span style="font-size:14px;">⚠️</span>
        <div style="font-size:13px;flex:1;color:#7A5020;"><strong>발주 필요 ${alertCount}건</strong> — D+45 이내 품절 예상 상품이 있어요</div>
        <div class="inv-pill" style="font-size:11px;" onclick="invSetTab('alert',document.querySelector('#inv-tabs .page-tab:last-child'))">재고 알림 보기</div>
      </div>`;
    } else { banner.innerHTML=''; }
  } catch(e){ console.error(e); }
};

loadInvCatPills=async function() {
 const db=readClient;

  try {
    const s = await getAppState();
    const cats = s.inv_categories || [];
    const all = ['전체', ...cats];
    // 카테고리 색상 맵 (inv_categories 순서 기반 고정 색상)
    $('inv-cat-pills').innerHTML = all.map((c,i)=>{
      const col = '#1C1E26'; // 전체 블랙 통일
      const isOn = invCurrentCat===c;
      const getLuma = hex => { try{const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return(r*299+g*587+b*114)/1000;}catch(e){return 128;} };
      const textCol = getLuma(col)>128?'#1C1E26':'#fff';
      const style = isOn
        ? `background:${col};color:${textCol};border:1.5px solid ${col};`
        : `background:#fff;color:var(--text);border:1.5px solid ${col};`;
      return `<div data-cat-color="${col}" data-cat-on="${isOn}" data-cat-name="${c}" ${c!=='전체'?'data-draggable="1"':''}
        style="padding:5px 14px;font-size:12px;font-weight:500;border-radius:20px;cursor:${c!=='전체'?'grab':'pointer'};${style}transition:all .15s;"
        onclick="invSetCat('${c}',this)"
        onmouseenter="if(this.dataset.catOn!=='true'){this.style.background=this.dataset.catColor+'33';}"
        onmouseleave="if(this.dataset.catOn!=='true'){this.style.background='#fff';}">
        ${c}
      </div>`;
    }).join('');
  setTimeout(initInvCatDrag, 50);
  } catch(e){ console.error('loadInvCatPills error:', e); }
};

loadInvList=async function(options={}) {
 const ticket=++inventoryTicket;
 const db=readClient;

  try {
    const searchQ = ($('inv-search')?.value||'').trim().toLowerCase();
    const snap=await stockData(options.cached);if(ticket!==inventoryTicket)return;
    const allProds=snap.products.filter(p=>invCurrentFilter==='everything'||(invCurrentFilter==='disc'?p.is_discontinued:invCurrentFilter==='planned'?!p.is_discontinued&&p.disc_status==='planned':!p.is_discontinued&&p.disc_status!=='planned')).sort((a,b)=>(a.sort_order??999999)-(b.sort_order??999999)||String(a.name).localeCompare(String(b.name)));
    let prods=allProds.filter(p=>(invCurrentCat==='전체'||p.category===invCurrentCat)&&matches(p,searchQ));
    const invRows=snap.inventory,chInvRows=snap.channels,salesRows=snap.sales,sState=snap.state;
    const reservations = sState.ch_reservations || [];

    inventorySummary(invRows, reservations, sState, prods);
    $('w12-search-count').textContent=prods.length+'개 상품';
    if(!prods.length){
      $('inv-product-table').innerHTML='<div style="padding:20px;font-size:13px;color:var(--faint);text-align:center;">상품이 없어요</div>';
      return;
    }
    // 전체 보기: 카테고리 순서(inv_categories 기준)로 그룹 정렬
    const catOrder = sState.inv_categories || [];
    if (invCurrentCat === '전체') {
      const catIdx = c => { const i = catOrder.indexOf(c); return i < 0 ? 999 : i; };
      prods = [...prods].sort((a,b) => {
        const ca = catIdx(a.category||''), cb = catIdx(b.category||'');
        if (ca !== cb) return ca - cb;
        return 0; // 같은 카테고리 내에서는 기존 sort_order 순서 유지 (stable sort)
      });
    }
    // 검색 중이 아니면 드래그 허용 (카테고리 필터와 무관)
    const isDraggable = !searchQ;
    $('inv-product-table').innerHTML=`<table class="inv-tbl"><thead><tr>
      <th style="width:20px;"></th><th>상품명 · 옵션</th><th>카테고리</th><th>총재고</th><th>상품화 완료</th><th>상품화 대기</th><th>가용</th><th class="w12-optional-channel">채널별 실배분·예약</th><th>예약</th><th>불량 보류</th><th>품절예상</th><th>상태</th><th></th>
    </tr></thead><tbody>${prods.map((p,pi)=>{
      const inv=invRows.find(x=>x.product_id===p.id)||{total_stock:0,produced_stock:0,pending_production:0,available_stock:0};
      const chChips=[...new Set([...CHANNELS,...chInvRows.map(r=>r.channel),...reservations.map(r=>r.channel)])].map(ch=>{
        const ci=chInvRows.find(x=>x.product_id===p.id&&x.channel===ch)||{stock:0};
        const rsv=reservations.filter(r=>r.product_id===p.id&&r.channel===ch).reduce((s,r)=>s+(r.qty||0),0);
        if(!ci.stock && !rsv) return '';
        const vel=calcVelocity(salesRows,p.id,ch);
        const days=vel>0?Math.ceil(ci.stock/vel):null;
        const isAlert=days!==null&&days<=3;
        const lbl={'자사몰':'자사몰','카카오선물하기':'카카오','스마트스토어':'스마트'}[ch]||ch;
        const rsvTag=rsv?` <span style="opacity:.75;">(예약 ${rsv})</span>`:'';
        return `<span style="display:inline-flex;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:500;background:${isAlert?'#FAECEB':rsv?'#FAEEDA':'var(--surface2)'};color:${isAlert?'var(--red)':rsv?'#854F0B':'var(--muted)'};">${lbl} ${ci.stock||0}${days?` D+${days}`:''}${rsvTag}</span>`;
      }).filter(Boolean).join(' ');
      // 전체 보기: 카테고리 그룹 헤더 행
      let groupHeader = '';
      if (invCurrentCat === '전체') {
        const prevCat = pi > 0 ? (prods[pi-1].category||'') : null;
        const curCat  = p.category || '';
        if (prevCat === null || prevCat !== curCat) {
          groupHeader = `<tr class="inv-cat-header" data-nodrag="1"><td colspan="13" style="background:var(--surface2);padding:6px 16px;font-size:11px;font-weight:600;color:var(--muted);letter-spacing:.03em;">${curCat || '미분류'}</td></tr>`;
        }
      }
      const velAll=calcVelocity(salesRows, p.id);
      const daysAll = daysUntilSoldOut(inv, velAll);    // 표의 D+ = 지금 재고로 며칠
      const daysOrd = daysUntilReorder(inv, velAll);    // 배지 = 발주해야 하나 (대기분 포함)
      const isPlanned = p.disc_status === 'planned';
      const badge=p.is_discontinued?`<span class="sbadge" style="background:var(--surface2);color:var(--faint);">단종</span>`
        :isPlanned?`<span class="sbadge" style="background:#FFF3CD;color:#856404;">단종 예정${p.disc_date?' (~'+p.disc_date.slice(5).replace('-','/')+')':''}</span>`
        :daysOrd!==null&&daysOrd<=REORDER_TH.urgent?`<span class="sbadge" style="background:var(--red-bg);color:var(--red);">발주필요</span>`
        :daysOrd!==null&&daysOrd<=REORDER_TH.warn?`<span class="sbadge" style="background:var(--amber-bg);color:var(--amber);">주의</span>`
        :`<span class="sbadge sbadge-ing">정상</span>`;
      const opt=p.option_name?`<div class="inv-faint" style="font-size:11px;">${p.option_name}</div>`:'';
      const handle=isDraggable
        ?`<td style="cursor:grab;color:var(--faint);font-size:13px;text-align:center;user-select:none;" class="inv-drag-handle">⠿</td>`
        :`<td></td>`;
      return `${groupHeader}<tr data-pid="${p.id}" data-cat="${escapeHtml(p.category||'')}" ${isDraggable?'draggable="true"':''} style="${p.is_discontinued?'opacity:.45;':isPlanned?'opacity:.7;':''}${isDraggable?'cursor:grab;':''}">
        ${handle}
        <td>${productCell(p)}</td>
        <td style="font-size:11px;min-width:90px;" onclick="event.stopPropagation()">
          <select class="inv-cat-inline-sel" data-pid="${p.id}" onchange="saveInlineCat(this)" onfocus="populateInlineCat(this)" style="background:transparent;border:none;outline:none;font-size:11px;color:${p.category?'var(--text)':'var(--faint)'};cursor:pointer;width:100%;font-family:var(--font);">
            <option value="${p.category||''}">${p.category||'—'}</option>
          </select>
        </td>
        <td class="inv-num" style="padding:0;"><input class="inv-inline-num" type="number" value="${inv.total_stock||0}" data-pid="${p.id}" data-field="total_stock" data-prev="${inv.total_stock||0}" onfocus="this.select()" onblur="saveInlineStock(this)" onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape'){this.value=this.dataset.prev;this.blur();}"></td>
        <td class="inv-num inv-green" style="padding:0;"><input class="inv-inline-num inv-green" type="number" value="${inv.produced_stock||0}" data-pid="${p.id}" data-field="produced_stock" data-prev="${inv.produced_stock||0}" onfocus="this.select()" onblur="saveInlineStock(this)" onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape'){this.value=this.dataset.prev;this.blur();}"></td>
        <td class="inv-num inv-amber">${inv.pending_production||0}</td>
        <td class="inv-num">${inv.available_stock||0}</td>
        <td class="w12-optional-channel" onclick="openChAllocModal('${p.id}')" style="cursor:pointer;" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
          ${chChips||'<span class="inv-faint" style="font-size:11px;">미배분 →</span>'}
        </td>
        <td class="inv-num">${fmt(reservations.filter(r=>r.product_id===p.id).reduce((n,r)=>n+num(r.qty),0))}</td><td class="inv-num">${fmt((sState.prod_defects||[]).filter(r=>r.product_id===p.id&&r.status==='pending').reduce((n,r)=>n+(num(r.qty)||1),0))}</td>
        <td class="${daysAll&&daysAll<=PRODUCE_TH.urgent?'inv-red':daysAll&&daysAll<=PRODUCE_TH.warn?'inv-amber':''} inv-num" title="지금 팔 수 있는 재고 기준 소진 예상일">${daysAll?`D+${daysAll}`:'—'}</td>
        <td>${badge}</td>
        <td><div class="card-link" onclick="openEditProduct('${p.id}')" title="수정">···</div></td>
      </tr>`;
    }).join('')}</tbody></table>`;
    if(isDraggable) initInvDrag();
  } catch(e){ $('inv-product-table').innerHTML=`<div style="padding:14px 16px;color:var(--red);">오류: ${e.message}</div>`; }
};

loadChannelInv=async function(ch,options={}) {
 const ticket=++channelTicket;
 const db=readClient;ch=ch||invCurrentChannel||'자사몰';

  try {
    const searchQ = ($('inv-ch-search')?.value||'').trim().toLowerCase();
    const snap=await stockData(options.cached);if(ticket!==channelTicket)return;
    const allProds=snap.products,allChInv=snap.channels,allInvRows=snap.inventory,allSales=snap.sales;
    const cats=['전체',...new Set([...(snap.state.inv_categories||[]),...allProds.map(p=>p.category).filter(Boolean)])];
    $('w11-channel-category').innerHTML=cats.map(c=>`<option ${c===invChCurrentCat?'selected':''}>${esc(c)}</option>`).join('');
    const channels=[...new Set([...CHANNELS,...allChInv.map(r=>r.channel)])];
    $('w12-channel-buttons').innerHTML=channels.map(c=>`<button type="button" data-stock="channel-filter" data-id="${esc(c)}" aria-pressed="${c===ch}">${esc(c)}</button>`).join('');
    $('w12-category-buttons').innerHTML=cats.map(c=>`<button type="button" data-stock="channel-category" data-id="${esc(c)}" aria-pressed="${c===invChCurrentCat}">${esc(c)}</button>`).join('');
    const allocNeeded=allProds.filter(p=>!p.is_discontinued&&p.disc_status!=='planned'&&(invChCurrentCat==='전체'||p.category===invChCurrentCat)).map(p=>{const ci=allChInv.find(r=>r.product_id===p.id&&r.channel===ch)||{},inv=allInvRows.find(r=>r.product_id===p.id)||{},v=calcVelocity(allSales,p.id,ch);return{p,ci,inv,days:v>0?Math.ceil(num(ci.stock)/v):null};}).filter(r=>r.days!==null&&r.days<=3&&num(r.inv.available_stock)>0);
    const fold=$('w12-allocation-alert');fold.querySelector('summary').innerHTML=`<span>채널 배분 필요 <b>${allocNeeded.length}</b></span><small>${esc(ch)} · ${esc(invChCurrentCat)} <i></i></small>`;
    $('inv-ch-alloc-list').innerHTML=allocNeeded.length?table(['상품·옵션','현재 채널재고','가용','소진 예상',''],allocNeeded.map(({p,ci,inv,days})=>`<tr><td>${productCell(p)}</td><td>${fmt(ci.stock)}</td><td>${fmt(inv.available_stock)}</td><td>${days}일</td><td>${button('배분·예약','allocate',p.id)}</td></tr>`)):empty('선택한 채널·카테고리에 배분 필요 항목이 없습니다.');
    // 필터
    const st=snap.state;const rsv=st.ch_reservations||[];
    let prods = allProds.filter(p=>$('w11-channel-status').value==='all'||($('w11-channel-status').value==='disc'?p.is_discontinued:!p.is_discontinued));
    if(invChCurrentCat !== '전체') prods = prods.filter(p=>p.category===invChCurrentCat);
    if(searchQ) prods=prods.filter(p=>matches(p,searchQ));
    const chInvRows = allChInv.filter(r=>r.channel===ch);
    const salesRows = allSales.filter(r=>r.channel===ch);
    const pids=new Set(prods.map(p=>p.id));const total = chInvRows.filter(r=>pids.has(r.product_id)).reduce((s,r)=>s+(r.stock||0),0);
    $('inv-ch-title').textContent=`${ch} 재고`; $('inv-ch-sub').textContent=`${prods.length}종 · 실배분 ${fmt(total)}개`;
    if(!prods.length){ $('inv-channel-table').innerHTML='<div style="padding:14px 16px;font-size:13px;color:var(--faint);">상품이 없어요</div>'; return; }
    $('inv-channel-table').innerHTML=`<table class="inv-tbl"><thead><tr>
      <th>상품명 · 옵션</th><th>카테고리</th><th>완료 실배분</th><th>예약</th><th>가용</th><th>상품화 대기</th><th>주간 출고</th><th>품절예상</th><th>상태</th><th></th>
    </tr></thead><tbody>${prods.map(p=>{
      const ci=chInvRows.find(x=>x.product_id===p.id)||{stock:0};
      const vel=calcVelocity(salesRows,p.id,ch);
      const weekSales=Math.round(vel*7);
      const days=vel>0?Math.ceil(ci.stock/vel):null;
      const isAlert=days!==null&&days<=3;
      const badge=ci.stock===0?`<span class="sbadge" style="background:var(--surface2);color:var(--faint);">미배분</span>`
        :isAlert?`<span class="sbadge" style="background:var(--red-bg);color:var(--red);">배분필요</span>`
        :days&&days<=14?`<span class="sbadge" style="background:var(--amber-bg);color:var(--amber);">주의</span>`
        :`<span class="sbadge sbadge-ing">정상</span>`;
      const opt=p.option_name?`<div class="inv-faint" style="font-size:11px;">${p.option_name}</div>`:'';
      return `<tr data-channel-product="${esc(p.id)}">
        <td>${productCell(p)}</td>
        <td class="inv-faint" style="font-size:11px;">${p.category||'—'}</td>
        <td class="inv-num ${isAlert?'inv-red':''}">${ci.stock}</td>
        <td class="inv-num">${fmt(rsv.filter(r=>r.product_id===p.id&&r.channel===ch).reduce((n,r)=>n+num(r.qty),0))}</td>
        <td class="inv-num">${fmt((allInvRows.find(r=>r.product_id===p.id)||{}).available_stock)}</td><td class="inv-num">${fmt((allInvRows.find(r=>r.product_id===p.id)||{}).pending_production)}</td>
        <td class="inv-num inv-faint">${weekSales>0?weekSales+'개':'—'}</td>
        <td class="inv-num ${isAlert?'inv-red':days&&days<=14?'inv-amber':''}">${days?`D+${days}`:'—'}</td>
        <td>${badge}</td><td>${button('배분·예약','allocate',p.id)}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
  } catch(e){ console.error(e); }
};

loadReceiptSchedule=async function() {
 const db=readClient;

  try {
    const [prods, receipts] = await Promise.all([
      db.from('products').select('id,name,option_name').then(r=>r.data||[]),
      db.from('stock_receipts').select('*').order('scheduled_date',{ascending:true}).then(r=>r.data||[]),
    ]);
    const pMap={}; prods.forEach(p=>pMap[p.id]=p);
    const scheduled=receipts.filter(r=>r.status==='scheduled');
    const done=receipts.filter(r=>r.status==='completed').sort((a,b)=>String(b.receipt_date||b.scheduled_date||'').localeCompare(String(a.receipt_date||a.scheduled_date||'')));

    // 소모품 입고는 product_id가 없어서 예전에는 전부 '(삭제됨)'으로 표시돼 읽을 수 없었음
    const stSup = await getAppState(); imageState=stSup;
    const supMap = {}; (stSup.prod_supplies||[]).forEach(x => supMap[x.id] = x);

    const renderRow=(r,showComplete)=>{
      let label;
      if (r.item_type === 'supply' || (!r.product_id && r.supply_id)) {
        const sup = supMap[r.supply_id];
        label = (sup ? sup.name : '소모품') + ' <span style="font-size:10px;color:var(--light);">· 소모품</span>';
      } else {
        const p=pMap[r.product_id]||{name:'(삭제됨)'};
        label=productCell(p);
      }
      const stBadge=r.status==='completed'
        ?`<span class="sbadge sbadge-ing">완료</span>`
        :r.status==='scheduled'
          ?`<span class="sbadge" style="background:var(--amber-bg);color:var(--amber);">대기</span>`
          :`<span class="sbadge sbadge-todo">예정</span>`;
      const completeBtn=showComplete&&r.status!=='completed'
        ?`<button class="f-btn f-btn-cancel" style="font-size:11px;padding:4px 10px;" onclick="completeReceipt('${r.id}')">입고완료</button>`:'';
      const editBtn = `<button class="f-btn" style="font-size:11px;padding:4px 10px;" onclick="openReceiptEdit('${r.id}')">수정</button>`;
      const delBtn  = `<button class="f-btn" style="font-size:11px;padding:4px 10px;color:var(--red);" onclick="deleteReceipt('${r.id}')">삭제</button>`;
      return `<tr data-receipt-id="${esc(r.id)}">
        <td class="inv-num">${(r.receipt_date||r.scheduled_date||'')}</td>
        <td style="font-weight:500;">${label}</td>
        <td class="inv-num">${r.quantity}개</td>
        <td class="inv-faint">${r.assigned_to||'—'}</td>
        <td class="inv-faint" style="font-size:11px;">${r.note||''}</td>
        <td>${stBadge}</td>
        <td style="display:flex;gap:4px;">${completeBtn}${editBtn}${delBtn}</td>
      </tr>`;
    };

    $('inv-receipt-scheduled').innerHTML=scheduled.length
      ?`<table class="inv-tbl"><thead><tr><th>예정일</th><th>상품</th><th>수량</th><th>담당</th><th>메모</th><th>상태</th><th></th></tr></thead><tbody>${scheduled.map(r=>renderRow(r,true)).join('')}</tbody></table>`
      :'<div style="padding:14px 16px;font-size:13px;color:var(--faint);">예정된 입고가 없어요</div>';

    $('inv-receipt-done').innerHTML=done.length
      ?`<table class="inv-tbl"><thead><tr><th>완료일</th><th>상품</th><th>수량</th><th>담당</th><th>메모</th><th>상태</th><th></th></tr></thead><tbody>${done.map(r=>renderRow(r,false)).join('')}</tbody></table>`
      :'<div style="padding:14px 16px;font-size:13px;color:var(--faint);">입고 이력이 없어요</div>';

  } catch(e){ console.error(e); }
};

loadOrderAlerts=async function() {
 const db=readClient;

  try {
    // 단종 제외 + 단종예정 제외
    const prodsAll = (await db.from('products').select('*').eq('is_discontinued',false)).data||[];
    const prods    = prodsAll.filter(p => p.disc_status !== 'planned');
    const invRows  = (await db.from('inventory').select('*')).data||[];
    const chInvRows= (await db.from('channel_inventory').select('*')).data||[];
    const salesRows= await dbFetchAll(() => db.from('sales_log').select('*').gte('sale_date', dateStr(new Date(Date.now()-28*86400000))));
    // 이미 발주 등록된 상품 (미완료 발주 존재) → 발주 필요에서 제외
    const sOrd = await getAppState();
    const orderedPids = new Set((sOrd.ops_orders||[])
      .filter(o => o.kind !== 'material' && o.status !== 'received' && o.status !== 'cancelled' && o.product_id)
      .map(o => o.product_id));

    const allocAlerts = []; // 채널 배분 필요 (D+3 이내 + 가용재고 있음)
    const orderAlerts = []; // 발주 필요 (전체 D+45 이내)

    for(const p of prods){
      const label = p.option_name ? `${p.name} · ${p.option_name}` : p.name;
      const inv   = invRows.find(x=>x.product_id===p.id)||{};

      // 채널별 D+3 이내 + 가용재고 있으면 배분 알림
      for(const ch of CHANNELS){
        const ci  = chInvRows.find(x=>x.product_id===p.id&&x.channel===ch)||{stock:0};
        const vel = calcVelocity(salesRows,p.id,ch);
        const days= vel>0 ? Math.ceil(ci.stock/vel) : null;
        const hasAvail = (inv.available_stock||0) > 0;
        if(days!==null && days<=3 && hasAvail){
          allocAlerts.push({label,ch,days,avail:inv.available_stock||0,productId:p.id});
        }
      }

      // 발주 필요 — 상품화 대기분까지 포함해서 판단 (이미 발주 등록된 상품은 제외)
      const velAll = calcVelocity(salesRows, p.id);
      const days   = daysUntilReorder(inv, velAll);
      if(days !== null && days <= REORDER_TH.warn && !orderedPids.has(p.id)){
        orderAlerts.push({label,days,urgency:days<=REORDER_TH.urgent?'danger':'warn',productId:p.id});
      }
    }

    // 발주 필요 섹션
    const alertEl = $('inv-alert-list');
    if(alertEl){
      const appS = await getAppState(); imageState=appS;
      const hidden = new Set(appS.inv_alert_hidden || []);
      const visible = orderAlerts.filter(a => !hidden.has(a.productId));
      const hiddenList = orderAlerts.filter(a =>  hidden.has(a.productId));

      const renderAlertRow = (a, isHidden=false) => `<tr ${isHidden?'style="opacity:.55;"':''}>
        <td style="font-weight:500;">${productCell(prods.find(p=>p.id===a.productId)||{name:a.label})}</td>
        <td class="inv-num ${a.urgency==='danger'?'inv-red':'inv-amber'}">D+${a.days}</td>
        <td>${a.urgency==='danger'
          ?'<span class="sbadge" style="background:var(--red-bg);color:var(--red);">즉시</span>'
          :'<span class="sbadge" style="background:var(--amber-bg);color:var(--amber);">주의</span>'}</td>
        <td style="display:flex;gap:4px;justify-content:flex-end;">
          ${isHidden
            ? `<button class="f-btn f-btn-cancel" style="font-size:11px;padding:4px 10px;" onclick="invAlertUnhide('${a.productId}')">다시 알림</button>`
            : `<button class="f-btn f-btn-cancel" style="font-size:11px;padding:4px 10px;" onclick="openOpsOrderModal('','${a.productId}')">발주 등록</button>
               <button class="f-btn f-btn-cancel" style="font-size:11px;padding:4px 10px;color:var(--light);" onclick="invAlertHide('${a.productId}')" title="알림 숨김">숨김</button>`}
        </td>
      </tr>`;

      let html = '';
      if(!visible.length){
        html = '<div style="padding:14px 20px;font-size:13px;color:var(--faint);">발주 필요 항목이 없어요 ✓</div>';
      } else {
        html = `<table class="inv-tbl">
          <thead><tr><th>상품</th><th>품절예상</th><th>긴급도</th><th></th></tr></thead>
          <tbody>${visible.map(a=>renderAlertRow(a,false)).join('')}</tbody>
        </table>`;
      }
      // 숨김 항목 토글
      if(hiddenList.length){
        html += `<div style="margin-top:10px;padding:10px 20px;border-top:0.5px dashed var(--border);">
          <div onclick="invAlertToggleHidden()" style="font-size:12px;color:var(--light);cursor:pointer;">
            ${_invAlertHiddenExpanded?'▴ 숨긴 항목 접기':`▾ 숨긴 항목 ${hiddenList.length}개 보기`}
          </div>
          ${_invAlertHiddenExpanded ? `<table class="inv-tbl" style="margin-top:8px;"><tbody>${hiddenList.map(a=>renderAlertRow(a,true)).join('')}</tbody></table>` : ''}
        </div>`;
      }
      alertEl.innerHTML = html;
    }

    // 탭 뱃지 — 숨김 항목 제외
    const appS2 = await getAppState();
    const hiddenSet = new Set(appS2.inv_alert_hidden || []);
    const visAlerts = orderAlerts.filter(a => !hiddenSet.has(a.productId));
    const total = visAlerts.length;
    const badge = $('inv-alert-badge');
    if(badge){ badge.textContent=total; badge.style.display=total>0?'inline-flex':'none'; }
  } catch(e){ console.error(e); }
};

loadShipLog=async function() {
 const db=readClient;

  const el = $('ship-log-list'); if (!el) return;
  const lbl = $('ship-log-month-label');
  const [y, m] = _shipLogMonth.split('-').map(Number);
  if (lbl) lbl.textContent = `${y}년 ${m}월`;

  const lastD    = new Date(y, m, 0).getDate();
  const fromDate = `${_shipLogMonth}-01`;
  const toDate   = `${_shipLogMonth}-${String(lastD).padStart(2,'0')}`;
  const ch       = $('ship-log-ch-filter')?.value || '';

  el.innerHTML = '<div style="padding:20px 0;text-align:center;font-size:13px;color:var(--faint);">불러오는 중...</div>';

  let query = db.from('sales_log').select('*').gte('sale_date', fromDate).lte('sale_date', toDate).order('sale_date', {ascending:false});
  if (ch) query = query.eq('channel', ch);
  const { data: shipRows } = await query;
  const rows = shipRows || [];view.ships=rows;syncShipControls();

  if (!rows.length) {
    el.innerHTML = '<div style="padding:20px 0;text-align:center;font-size:13px;color:var(--faint);">출고 내역이 없어요</div>';
    if ($('ship-log-total')) $('ship-log-total').textContent = '';
    return;
  }

  // 상품명 조회
  const pids  = [...new Set(rows.map(r => r.product_id).filter(Boolean))];
  const { data: prods } = await db.from('products').select('id,name,option_name').in('id', pids);
  const prodMap = Object.fromEntries((prods||[]).map(p => [p.id, p]));
  imageState=await getAppState();

  const totalQty = rows.reduce((s,r) => s+(r.quantity||0), 0);
  if ($('ship-log-total')) $('ship-log-total').textContent = `총 ${totalQty.toLocaleString()}개`;

  // 날짜별 그룹
  const byDate = {};
  rows.forEach(r => {
    const d = r.sale_date;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
  });

  el.innerHTML = Object.entries(byDate).map(([date, items]) => {
    const dayQty = items.reduce((s,r) => s+(r.quantity||0), 0);
    return `
      <div style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:0.5px solid var(--surface2);">
          <div style="font-size:12px;font-weight:500;color:var(--text);">${date}</div>
          <div style="font-size:11px;color:var(--light);">총 ${dayQty}개</div>
        </div>
        ${items.map(r => {
          const p   = prodMap[r.product_id] || {name:'(알수없음)'};
          const lbl = p.option_name ? `${p.name} · ${p.option_name}` : p.name;
          return `<div data-shipment-id="${esc(r.id)}" style="display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:0.5px solid var(--surface2);">
            <div class="w13-shipment-product" style="flex:1;min-width:0;">${productCell(p)}</div>
            <div style="font-size:11px;color:var(--light);">${r.channel||''}</div>
            <div style="font-size:12px;font-weight:500;width:40px;text-align:right;">${r.quantity}개</div>
            <button onclick="openShipLogEdit('${r.id}','${date}','${r.channel||''}',${r.quantity},'${lbl}')"
              class="f-btn" style="font-size:11px;padding:3px 10px;">수정</button>
          </div>`;
        }).join('')}
      </div>`;
  }).join('');
};
exportInvExcel=async function() {
 const db=readClient;
  try {
    const XLSX = window.XLSX;
    if (!XLSX) { toast('엑셀 라이브러리 로딩 중... 잠시 후 다시 시도해주세요'); return; }
    const prods   = (await db.from('products').select('*').order('name')).data || [];
    const invRows = (await db.from('inventory').select('*')).data || [];
    const chInv   = (await db.from('channel_inventory').select('*')).data || [];
    const rows = prods.map(p => {
      const inv = invRows.find(x => x.product_id === p.id) || {};
      const own   = chInv.find(x => x.product_id === p.id && x.channel === '자사몰')         || {};
      const kakao = chInv.find(x => x.product_id === p.id && x.channel === '카카오선물하기') || {};
      const smart = chInv.find(x => x.product_id === p.id && x.channel === '스마트스토어')   || {};
      return {
        '상품명':          p.name || '',
        '사이즈':          p.option_name || '',
        '카테고리':        p.category || '',
        '원재고':          inv.total_stock || 0,
        '자사몰재고':       own.stock || 0,
        '카카오재고':       kakao.stock || 0,
        '스마트스토어재고': smart.stock || 0,
        '상품화완료재고':   inv.produced_stock || 0,
        '가용재고':         inv.available_stock || 0,
        '상품화대기재고':   inv.pending_production || 0,
        '판매가':           p.price || 0,
        '상태':             p.is_discontinued ? '판매 종료' : '판매 중',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '재고현황');
    XLSX.writeFile(wb, `체로프_재고현황_${dateStr()}.xlsx`);
    toast('재고 파일이 다운로드됐어요 ✓');
  } catch(e) { toast('내보내기 실패: ' + e.message); console.error(e); }
};

runInventoryAudit=async function() {
 const db=readClient;
  toast('재고를 점검하고 있어요…');
  try {
    const [prodRes, invRes, chRes] = await Promise.all([
      db.from('products').select('id,name,option_name'),
      db.from('inventory').select('*'),
      db.from('channel_inventory').select('product_id,channel,stock'),
    ]);
    const prods = prodRes.data || [], invs = invRes.data || [], chs = chRes.data || [];
    const pMap = {}; prods.forEach(p => pMap[p.id] = p);
    const chSumMap = {};
    chs.forEach(c => { chSumMap[c.product_id] = (chSumMap[c.product_id] || 0) + (c.stock || 0); });

    const issues = [];
    for (const inv of invs) {
      const produced = Math.max(0, inv.produced_stock || 0);
      const chSum    = chSumMap[inv.product_id] || 0;
      let   total    = Math.max(0, inv.total_stock || 0);
      const totalRaised = produced > total;
      if (totalRaised) total = produced;
      const available = Math.max(0, produced - chSum);
      const pending   = Math.max(0, total - produced);
      const curAvail  = inv.available_stock || 0;
      const curPend   = inv.pending_production || 0;
      const curTotal  = inv.total_stock || 0;
      if (available === curAvail && pending === curPend && total === curTotal) continue;
      const p = pMap[inv.product_id];
      issues.push({
        productId: inv.product_id,
        label: p ? (p.option_name ? `${p.name} · ${p.option_name}` : p.name) : '(삭제된 상품)',
        curTotal, curAvail, curPend, total, available, pending, produced, chSum, totalRaised,
      });
    }

    if (!issues.length) {
      await customConfirm('재고 점검 완료', '어긋난 항목이 없어요. 모든 상품의 재고 계산이 맞습니다 ✓', '확인');
      return;
    }

    const lines = issues.slice(0, 8).map(x => {
      const parts = [];
      if (x.curAvail !== x.available) parts.push(`가용 ${x.curAvail}→${x.available}`);
      if (x.curPend  !== x.pending)   parts.push(`대기 ${x.curPend}→${x.pending}`);
      if (x.curTotal !== x.total)     parts.push(`총재고 ${x.curTotal}→${x.total}`);
      return `· ${x.label}: ${parts.join(', ')}`;
    }).join('\n');

    const ok = await customConfirm(
      `${issues.length}개 상품의 재고 계산이 어긋나 있어요`,
      `${lines}${issues.length > 8 ? `\n· 외 ${issues.length - 8}개` : ''}\n\n` +
      `상품화 완료 수량과 채널 배분 수량은 그대로 두고, ` +
      `거기서 계산되는 가용재고·상품화 대기만 다시 맞춥니다. 진행할까요?`,
      '바로잡기');
    if (!ok) return;

    let fixed = 0;
    for (const x of issues) {
      const r = await reconcileInventory(x.productId);
      if (r?.changed) fixed++;
    }
    toast(`${fixed}개 상품의 재고를 바로잡았어요 ✓`);
    loadInvOverview();
  } catch(e) {
    console.error('runInventoryAudit', e);
    toast('점검 실패: ' + e.message);
  }
};

const inventoryPage=$('page-inventory'),salesPage=$('page-sales');
function metrics(items){return `<div class="w11-metrics">${items.map(([title,value,note])=>`<div><span>${title}</span><strong>${value}</strong><small>${note||''}</small></div>`).join('')}</div>`;}
function inventorySummary(rows,reservations,s,products){const ids=new Set(products.filter(p=>invCurrentCat==='전체'||p.category===invCurrentCat).map(p=>p.id));const filtered=rows.filter(r=>ids.has(r.product_id));$('w11-stock-metrics').innerHTML=metrics([['현재 총재고',fmt(filtered.reduce((n,r)=>n+num(r.total_stock),0)),'입고 누계 아님 · 기존 재고 원장'],['상품화 완료',fmt(filtered.reduce((n,r)=>n+num(r.produced_stock),0)),'가용·채널 배분 포함'],['상품화 대기',fmt(filtered.reduce((n,r)=>n+num(r.pending_production),0)),'미상품화 재고 · 예약은 별도 표시'],['예약',fmt(reservations.filter(r=>ids.has(r.product_id)).reduce((n,r)=>n+num(r.qty),0)),'상품화 완료 후 자동 배분']]);const sel=$('w11-category');sel.innerHTML=[...new Set(['전체',...(s.inv_categories||[]),...(stockSnapshot?.products||products).map(p=>p.category).filter(Boolean)])].map(c=>`<option ${c===invCurrentCat?'selected':''}>${esc(c)}</option>`).join('');}
$('inv-tab-overview').insertAdjacentHTML('afterbegin','<div id="w11-stock-metrics"></div>');
const invFilter=document.createElement('div');invFilter.className='w11-filters';invFilter.innerHTML='<label class="w11-search">상품 검색</label><label>카테고리<select id="w11-category"><option>전체</option></select></label><label>상품 상태<select id="w11-status"><option value="all">활성</option><option value="everything">전체 상태</option><option value="planned">단종 예정</option><option value="disc">단종</option></select></label>'+button('카테고리 관리','categories');invFilter.querySelector('.w11-search').append($('inv-search'));$('inv-tab-overview').insertBefore(invFilter,$('inv-overview-banner'));
$('w11-category').onchange=e=>{invCurrentCat=e.target.value;loadInvList({cached:true});};$('w11-status').onchange=e=>{invCurrentFilter=e.target.value;loadInvList({cached:true});};
$('inv-channel-tabs').insertAdjacentHTML('afterend','<select id="w11-channel" aria-label="재고 채널"></select><select id="w11-channel-status" aria-label="채널 상품 상태"><option value="active">활성 상품</option><option value="all">전체 상품</option><option value="disc">단종 상품</option></select>');$('w11-channel').onchange=e=>{invCurrentChannel=e.target.value;loadChannelInv(invCurrentChannel);};$('w11-channel-status').onchange=()=>loadChannelInv(invCurrentChannel);$('inv-ch-cat-pills').innerHTML='<select id="w11-channel-category" aria-label="채널 상품 카테고리"><option>전체</option></select>';$('w11-channel-category').onchange=e=>{invChCurrentCat=e.target.value;loadChannelInv(invCurrentChannel);};
const channelControls=$('inv-channel-tabs').parentElement;channelControls.classList.add('w12-channel-controls');
channelControls.insertAdjacentHTML('beforebegin','<div class="w12-filter-label">채널</div><div id="w12-channel-buttons" class="w12-filter-buttons" aria-label="채널 선택"></div><div class="w12-filter-label">카테고리</div><div id="w12-category-buttons" class="w12-filter-buttons" aria-label="카테고리 선택"></div>');
const allocList=$('inv-ch-alloc-list'),oldCard=allocList.closest('.card');const fold=document.createElement('details');fold.id='w12-allocation-alert';fold.className='w12-fold';fold.innerHTML='<summary>채널 배분 필요</summary>';fold.append(allocList);channelControls.after(fold);oldCard.remove();$('inv-ch-alloc-banner').hidden=true;
$('inv-product-table').previousElementSibling.insertAdjacentHTML('beforeend','<div class="w12-overview-actions"><span id="w12-search-count"></span>'+button('채널별 재고 함께 보기','toggle-channels')+'</div>');
for(const id of ['inv-search','inv-ch-search']){const input=$(id);input.removeAttribute('oninput');input.placeholder='상품명 · 옵션 · SKU 검색';input.setAttribute('aria-label',input.placeholder);const box=document.createElement('span');box.className='w12-searchbox';input.before(box);box.append(input);box.insertAdjacentHTML('beforeend',`<button type="button" data-stock="clear-search" data-id="${id}" aria-label="검색 지우기">×</button>`);let timer;const search=()=>id==='inv-search'?loadInvList({cached:true}):loadChannelInv(invCurrentChannel,{cached:true});input.oninput=()=>{clearTimeout(timer);timer=setTimeout(search,120);};input.onkeydown=e=>{if(e.key==='Escape'){input.value='';search();}if(e.key==='Enter'){clearTimeout(timer);search();}};}
const shipHead=$('ship-log-list').previousElementSibling;shipHead.innerHTML='<div class="w11-filters"><label>조회 월<input type="month" id="w11-ship-month"></label><label>채널<select id="ship-log-ch-filter"><option value="">전체 채널</option></select></label><span id="ship-log-total"></span>'+button('출고 등록','ship')+'</div><span id="ship-log-month-label" hidden></span>';
$('w11-ship-month').onchange=e=>{if(/^\d{4}-\d{2}$/.test(e.target.value)){_shipLogMonth=e.target.value;loadShipLog();}};$('ship-log-ch-filter').onchange=loadShipLog;
function syncShipControls(){$('w11-ship-month').value=_shipLogMonth;}
const originalInitInventory=initInventory;initInventory=async function(){setupChannels().catch(console.error);return originalInitInventory();};
let channelSetup;
async function setupChannels(){if(!channelSetup)channelSetup=Promise.all(['channel_inventory','channel_sales_log','sales_log'].map(t=>readClient.from(t).select('id,channel'))).catch(e=>{channelSetup=null;throw e;});const results=await channelSetup;const [ch,revenues,ships]=results.map(r=>r.data);const names=[...new Set([...CHANNELS,...ch.map(r=>r.channel),...revenues.map(r=>r.channel),...ships.map(r=>r.channel)].filter(Boolean))];for(const[id,all]of [['w11-channel',false],['ship-log-ch-filter',true],['w11-sales-channel',true]]){const el=$(id),value=el.value;el.innerHTML=(all?'<option value="">전체 채널</option>':'')+names.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');el.value=names.includes(value)?value:all?'':invCurrentChannel;}view.channelNames=names;}
const salesTabs=[['overview','매출·판매 전략'],['ranking','판매 TOP 10'],['records','주문 매출 내역']];
salesPage.innerHTML=`<div class="page-header"><div class="page-header-top"><div><div class="page-header-title">판매분석</div><p class="w11-note">주문 매출·출고 원장 기준</p></div>${button('+ 주문 매출 입력','revenue')}</div><nav class="w11-tabs">${salesTabs.map(([id,t])=>button(t,'sales-tab',id)).join('')}</nav></div><div class="w11-filters"><label>조회 연도<select id="w11-sales-year"></select></label><label>조회 월<select id="w11-sales-month">${Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}월</option>`).join('')}</select></label><label>채널<select id="w11-sales-channel"><option value="">전체 채널</option></select></label></div><div class="w11-ranges">${[['month','선택 월'],['6m','최근 6개월'],['year','연간']].map(([k,t])=>button(t,'range',k)).join('')}</div><p id="w11-period" class="w11-note"></p><div id="w11-sales-error" role="alert"></div><section data-sales-section="overview"><div id="sales-metrics"></div><section class="w11-section"><h2>월별 일매출</h2><div id="sales-trend-wrap"></div></section><section class="w11-section"><h2>채널별 성과</h2><p class="w11-note">선택 기간·채널의 주문 매출 기준 · 증감은 위 비교 기간 대비</p><div id="sales-channel-list"></div></section><section class="w11-section"><h2>상품별 판매 흐름</h2><div id="w12-strategy"></div></section><section class="w11-section"><h2>카테고리별 판매 구성</h2><p class="w11-note">상품별 출고 수량 기준 · 금액 비중이 아닙니다.</p><div id="w12-category-analysis"></div></section><section class="w11-section"><h2>요일별 입력 매출 평균</h2><div id="w12-weekdays"></div></section></section><section data-sales-section="ranking" hidden><div class="w11-heading"><h2>판매 TOP 10</h2><div id="sales-top10-mode-pills">${button('수량','rank','qty')}${button('금액','rank','amount')}</div></div><p class="w11-note">선택 기간·채널의 상품별 출고 기록 기준</p><div id="sales-top10"></div></section><section data-sales-section="records" hidden><div class="w11-heading"><h2>주문 매출 내역</h2><span id="sales-log-inline-total"></span></div><p class="w11-note">주문 매출과 경영·정산의 실입금은 별도 기준입니다. 기존 수정·삭제 기능을 유지하며, 주문 금액을 실입금 원장에 자동 합산하지 않습니다.</p><div id="sales-log-inline"></div></section>`;
const nowDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),pad=n=>String(n).padStart(2,'0'),iso=d=>d.toISOString().slice(0,10),addDay=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return iso(x);};
salesDateRange=()=>period();
function syncSalesControls(){const y=$('w11-sales-year');const years=[...new Set([_salesYear,...Array.from({length:10},(_,i)=>Number(nowDay().slice(0,4))-7+i),...(view.revenues||[]).map(r=>Number(r.date.slice(0,4)))])].sort((a,b)=>a-b);y.innerHTML=years.map(n=>`<option value="${n}" ${n===_salesYear?'selected':''}>${n}년</option>`).join('');$('w11-sales-month').value=_salesMonth;$('w11-sales-channel').value=view.channel;document.querySelectorAll('[data-stock="range"]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.id===_salesRange));showSalesTab(view.salesTab);}
function showSalesTab(tab){view.salesTab=salesTabs.some(([k])=>k===tab)?tab:'overview';document.querySelectorAll('[data-sales-section]').forEach(el=>el.hidden=el.dataset.salesSection!==view.salesTab);document.querySelectorAll('[data-stock="sales-tab"]').forEach(el=>el.setAttribute('aria-pressed',el.dataset.id===view.salesTab));}
_initSalesMonthUI=function(){const date=nowDay();_salesYear=Number(date.slice(0,4));_salesMonth=Number(date.slice(5,7));_salesRange='month';_sales6m=false;};
let salesInitialized=false;initSalesPage=async function(){if(!salesInitialized){_initSalesMonthUI();salesInitialized=true;}syncSalesControls();setupChannels().catch(console.error);await loadSalesData();};
for(const id of ['w11-sales-year','w11-sales-month','w11-sales-channel'])$(id).onchange=e=>{if(id.endsWith('year'))_salesYear=Number(e.target.value);else if(id.endsWith('month'))_salesMonth=Number(e.target.value);else view.channel=e.target.value;loadSalesData();};
function monthPeriod(year,month){const from=`${year}-${pad(month)}-01`,to=iso(new Date(Date.UTC(year,month,0)));return{from,to};}
function period(){const m=monthPeriod(_salesYear,_salesMonth),today=nowDay();let from=m.from,to=m.to,prevFrom,prevTo;if(_salesRange==='year'){from=_salesYear+'-01-01';to=_salesYear+'-12-31';}else if(_salesRange==='6m')from=iso(new Date(Date.UTC(_salesYear,_salesMonth-6,1)));if(from<=today&&to>=today)to=today;const days=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;if(_salesRange==='month'){const pm=new Date(Date.UTC(_salesYear,_salesMonth-2,1)),prev=monthPeriod(pm.getUTCFullYear(),pm.getUTCMonth()+1);prevFrom=prev.from;prevTo=to<m.to?prev.from.slice(0,8)+pad(Math.min(Number(to.slice(8)),Number(prev.to.slice(8)))):prev.to;}else if(_salesRange==='year'){prevFrom=(_salesYear-1)+'-01-01';prevTo=(_salesYear-1)+to.slice(4);if(prevTo.endsWith('02-29')&&new Date(Date.UTC(_salesYear-1,2,0)).getUTCDate()===28)prevTo=(_salesYear-1)+'-02-28';}else{const shift=d=>{const[y,mo,day]=d.split('-').map(Number),first=new Date(Date.UTC(y,mo-7,1)),last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();return iso(new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(day,last))));};prevFrom=shift(from);prevTo=shift(to);}return{from,to,prevFrom,prevTo,label:from+' — '+to};}
loadSalesData=async function(){const ticket=++view.ticket;syncSalesControls();const p=period(),channel=view.channel,m=monthPeriod(_salesYear,_salesMonth),pmDate=new Date(Date.UTC(_salesYear,_salesMonth-2,1)),pm=monthPeriod(pmDate.getUTCFullYear(),pmDate.getUTCMonth()+1);$('w11-period').textContent=p.label+' · '+(channel||'전체 채널')+' / 비교 '+p.prevFrom+' — '+p.prevTo;$('w11-sales-error').textContent='';salesPage.setAttribute('aria-busy','true');try{const range=(name,date,from,to)=>api.queryAll(name,q=>{q=q.gte(date,from).lte(date,to);return channel?q.eq('channel',channel):q;});const [ships,revenues,prevShips,prevRevenue,products,monthly,previousMonth]=await Promise.all([range('sales_log','sale_date',p.from,p.to),range('channel_sales_log','date',p.from,p.to),range('sales_log','sale_date',p.prevFrom,p.prevTo),range('channel_sales_log','date',p.prevFrom,p.prevTo),api.queryAll('products'),range('channel_sales_log','date',m.from,m.to),range('channel_sales_log','date',pm.from,pm.to)]);if(ticket!==view.ticket)return;Object.assign(view,{sales:ships,revenues,prevShips,prevRevenue,products,monthly,previousMonth,month:m,previousMonthPeriod:pm,comparison:p});window._salesTop10Rows=ships;
const amount=sumRows(revenues,'amount'),qty=sumRows(ships,'quantity'),days=new Set(revenues.map(r=>r.date)).size,totalDays=Math.round((Date.parse(p.to)-Date.parse(p.from))/86400000)+1;
$('sales-metrics').innerHTML=metrics([['주문 매출',revenues.length?fmt(amount)+'원':'미입력',change(amount,sumRows(prevRevenue,'amount'),prevRevenue.length)],['출고 수량',ships.length?fmt(qty)+'개':'미입력',change(qty,sumRows(prevShips,'quantity'),prevShips.length)],['입력일 평균 매출',days?fmt(Math.round(amount/days))+'원':'미집계',`${days}/${totalDays}일 매출 입력 · 입력일 기준`],['취급 SKU',fmt(new Set(ships.filter(r=>num(r.quantity)>0).map(r=>r.product_id)).size)+'종',`${fmt(ships.length)}건 출고 기록`]]);
paintTrend();paintChannels();paintStrategy();paintCategories();paintWeekdays();loadSalesTop10();loadSalesLogInline();
}catch(e){if(ticket===view.ticket)$('w11-sales-error').innerHTML=empty('불러오지 못했습니다. '+e.message)+button('다시 불러오기','retry-sales');}finally{if(ticket===view.ticket)salesPage.removeAttribute('aria-busy');}};
const sumRows=(rows,key)=>rows.reduce((n,r)=>n+num(r[key]),0);
function groupRows(rows,key,value){const map=new Map();for(const r of rows)map.set(r[key],(map.get(r[key])||0)+num(r[value]));return map;}
function change(value,previous,hasPrevious=true){return !hasPrevious?'비교 기록 없음':previous===0?(value===0?'변동 없음':'비교값 0 · 증감률 미산출'):`${value>=previous?'+':''}${((value-previous)/Math.abs(previous)*100).toFixed(1)}%`;}
function paintTrend(){const cur=groupRows(view.monthly,'date','amount'),prev=groupRows(view.previousMonth,'date','amount'),m=view.month,pm=view.previousMonthPeriod,today=nowDay(),days=Number(m.to.slice(8));const buckets=Array.from({length:days},(_,i)=>{const date=m.from.slice(0,8)+pad(i+1),pd=pm.from.slice(0,8)+pad(i+1);return{date,amount:cur.get(date)||0,entered:cur.has(date),previous:prev.get(pd)||0,previousEntered:pd<=pm.to&&prev.has(pd),previousDate:pd<=pm.to?pd:null,future:date>today};});view.buckets=buckets;
const values=buckets.flatMap(r=>[r.amount,r.previous]),high=Math.max(...values,1),low=Math.min(...values,0),max=Math.ceil(high/Math.pow(10,Math.floor(Math.log10(high))))*Math.pow(10,Math.floor(Math.log10(high))),min=low<0?Math.floor(low/Math.pow(10,Math.floor(Math.log10(-low))))*Math.pow(10,Math.floor(Math.log10(-low))):0;const W=Math.max(280,$('sales-trend-wrap').clientWidth||(window.innerWidth<=650?480:900)),H=260,L=64,R=14,T=20,B=32,plotW=W-L-R,plotH=H-T-B,y=v=>T+(max-v)/(max-min)*plotH,x=i=>L+(i+.5)*plotW/days,base=y(0);const short=v=>Math.abs(v)>=10000?(v/10000).toLocaleString(undefined,{maximumFractionDigits:1})+'만':fmt(v);
let line='';buckets.forEach((r,i)=>{if(!r.previousEntered)return;line+=(i&&buckets[i-1].previousEntered?'L':'M')+x(i)+','+y(r.previous)+' ';});
$('sales-trend-wrap').innerHTML=`<div class="w12-chart-heading"><strong>${esc(m.from.slice(0,7).replace('-','년 '))}월 · 일별 주문 매출</strong><span><i></i>선택 월 <i class="previous"></i>전월 같은 일자</span></div><p class="w11-note">커서를 올리거나 모바일에서 날짜를 터치하세요. 월 전체 날짜를 표시하며 빈 구간은 미입력입니다. ${_salesRange==='month'?'':'아래 그래프는 선택 월만 표시합니다.'}</p><div class="w12-chart-wrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${m.from.slice(0,7)} 일별 주문 매출과 전월 비교">${Array.from({length:5},(_,i)=>{const v=min+(max-min)*i/4;return`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="#e9e9e9"/><text x="${L-10}" y="${y(v)+4}" text-anchor="end">${short(v)}</text>`;}).join('')}<line x1="${L}" x2="${W-R}" y1="${base}" y2="${base}" stroke="#bdbdbd"/>${buckets.map((r,i)=>`${r.entered?`<rect x="${x(i)-plotW/days*.27}" y="${Math.min(base,y(r.amount))}" width="${plotW/days*.54}" height="${Math.max(1,Math.abs(base-y(r.amount)))}" fill="${r.future?'#d9bdcb':'#b33c72'}"/>`:''}${i===0||(i+1)%5===0||i===days-1?`<text x="${x(i)}" y="${H-8}" text-anchor="middle">${i+1}일</text>`:''}`).join('')}<path d="${line}" stroke="#9b9b9b" stroke-width="1.8" stroke-dasharray="4 3" fill="none"/>${buckets.map((r,i)=>r.previousEntered?`<circle cx="${x(i)}" cy="${y(r.previous)}" r="2" fill="#999"/>`:'').join('')}</svg><div class="w12-chart-targets" style="left:${L/W*100}%;right:${R/W*100}%;top:${T/H*100}%;bottom:${B/H*100}%;grid-template-columns:repeat(${days},1fr)">${buckets.map(r=>`<button type="button" data-chart-date="${r.date}" aria-label="${r.date} ${r.entered?fmt(r.amount)+'원':r.future?'예정일':'미입력'}"></button>`).join('')}</div><div id="w12-chart-tooltip" role="status" hidden></div></div><p id="w11-chart-value" class="w11-note">선택 월 입력 ${cur.size}일 · 합계 ${fmt(sumRows(view.monthly,'amount'))}원 · 전월 비교선은 실제 입력된 날짜만 표시</p>`;
const wrap=$('sales-trend-wrap');for(const b of wrap.querySelectorAll('[data-chart-date]')){const show=()=>{const r=buckets.find(r=>r.date===b.dataset.chartDate),tip=$('w12-chart-tooltip');tip.innerHTML=`<strong>${r.date} (${'일월화수목금토'[new Date(r.date+'T12:00:00Z').getUTCDay()]})</strong><span>선택 월 <b>${r.entered?fmt(r.amount)+'원':r.future?'예정일':'미입력'}</b></span><span>전월 같은 일자 <b>${r.previousEntered?fmt(r.previous)+'원':r.previousDate?'미입력':'해당 날짜 없음'}</b></span>`;tip.hidden=false;const container=b.closest('.w12-chart-wrap'),left=b.getBoundingClientRect().left-container.getBoundingClientRect().left;tip.style.left=Math.max(0,Math.min(left-95,container.clientWidth-210))+'px';};b.onpointerenter=show;b.onfocus=show;b.onclick=show;b.onkeydown=e=>{if(e.key==='Escape')$('w12-chart-tooltip').hidden=true;};}wrap.querySelector('.w12-chart-wrap').onpointerleave=()=>{$('w12-chart-tooltip').hidden=true;};}
function paintChannels(){const cur=groupRows(view.revenues,'channel','amount'),prev=groupRows(view.prevRevenue,'channel','amount'),total=sumRows(view.revenues,'amount');const rows=[...new Set([...cur.keys(),...prev.keys()])].map(ch=>({ch,current:cur.get(ch)||0,previous:prev.get(ch)||0,entered:cur.has(ch),prevEntered:prev.has(ch)})).sort((a,b)=>b.current-a.current);view.channelPerformance=rows;$('sales-channel-list').innerHTML=rows.length?table(['채널','주문 매출','매출 비중','비교 기간 매출','증감액','증감률'],rows.map(r=>`<tr><td>${esc(r.ch)}</td><td>${r.entered?fmt(r.current)+'원':'미입력'}</td><td>${r.entered&&total>0?(r.current/total*100).toFixed(1)+'%':'—'}</td><td>${r.prevEntered?fmt(r.previous)+'원':'미입력'}</td><td>${r.entered&&r.prevEntered?fmt(r.current-r.previous)+'원':'—'}</td><td>${r.entered?change(r.current,r.previous,r.prevEntered):'—'}</td></tr>`)):empty('조회 기간의 매출 입력이 없습니다.');}
function productComparison(){const cur=groupRows(view.sales,'product_id','quantity'),prev=groupRows(view.prevShips,'product_id','quantity');return [...new Set([...cur.keys(),...prev.keys()])].map(id=>({id,product:view.products.find(p=>p.id===id),current:cur.get(id)||0,previous:prev.get(id)||0,previousEntered:prev.has(id)})).filter(r=>r.current>0||r.previous>0);}
function paintStrategy(){const items=productComparison(),positive=items.map(r=>r.current).filter(n=>n>0).sort((a,b)=>a-b),median=positive.length?positive[Math.floor(positive.length/2)]:0;view.productComparison=items;const groups=[['주력 성장','현재 출고가 중앙값 이상이며 비교 기간보다 증가한 상품. 노출 확대 후보입니다.',items.filter(r=>r.current>=median&&r.current>r.previous&&r.previous>0)],['주력 하락','비교 기간 출고가 중앙값 이상이며 감소한 상품. 품절·행사 종료·노출 변화를 확인하세요.',items.filter(r=>r.previous>=median&&r.previous>r.current)],['성장 후보','출고 규모는 작지만 증가한 상품. 소규모 콘텐츠 테스트 후보입니다.',items.filter(r=>r.current<median&&r.current>r.previous&&r.previous>0)],['감소·무출고','비교 기간 대비 출고가 줄어든 소량 상품. 입력 누락과 판매 노출부터 확인하세요.',items.filter(r=>r.previous>r.current&&r.previous<median)],['비교 기록 없는 상품','이번 기간 출고가 있고 비교 기간 출고 기록은 없습니다. 신상품 여부는 별도 확인이 필요합니다.',items.filter(r=>r.current>0&&!r.previousEntered)]];
$('w12-strategy').innerHTML=`<p class="w11-note">출고 수량 기준 · 현재 출고 중앙값 ${fmt(median)}개 · 재고 부족이나 입력 누락도 증감에 영향을 줍니다. 매출·이익 순위가 아닙니다.</p><div class="w12-strategy-grid">${groups.map(([title,desc,rows])=>`<details class="w12-strategy-card"><summary><strong>${title}</strong><b>${rows.length}종</b><span>${desc}</span></summary>${rows.length?table(['상품·옵션','이번','비교','증감'],rows.sort((a,b)=>Math.abs(b.current-b.previous)-Math.abs(a.current-a.previous)).map(r=>`<tr><td>${esc(label(r.product))}</td><td>${fmt(r.current)}</td><td>${r.previousEntered?fmt(r.previous):'미입력'}</td><td>${change(r.current,r.previous,r.previousEntered)}</td></tr>`)):empty('해당 상품 없음')}</details>`).join('')}</div>`;}
function paintCategories(){const map=new Map(),prev=new Map();for(const r of productComparison()){const cat=r.product?.category||'미분류';map.set(cat,(map.get(cat)||0)+r.current);prev.set(cat,(prev.get(cat)||0)+r.previous);}const total=sumRows(view.sales,'quantity');$('w12-category-analysis').innerHTML=map.size?table(['카테고리','출고 수량','수량 비중','비교 기간','증감'],[...map].sort((a,b)=>b[1]-a[1]).map(([cat,qty])=>`<tr><td>${esc(cat)}</td><td>${fmt(qty)}개</td><td>${total>0?(qty/total*100).toFixed(1)+'%':'—'}</td><td>${fmt(prev.get(cat))}개</td><td>${change(qty,prev.get(cat),view.prevShips.length>0)}</td></tr>`)):empty('출고 기록이 없습니다.');}
function paintWeekdays(){const daily=groupRows(view.revenues,'date','amount'),rows=Array.from({length:7},(_,i)=>({day:(i+1)%7,total:0,days:0}));for(const[date,amount]of daily){const r=rows.find(r=>r.day===new Date(date+'T12:00:00Z').getUTCDay());r.total+=amount;r.days++;}const top=Math.max(...rows.map(r=>r.days?r.total/r.days:0),1);$('w12-weekdays').innerHTML=`<p class="w11-note">매출이 입력된 날짜만 평균에 포함합니다. 채널별 누락·팝업 일정에 따라 달라질 수 있어 광고 집행 시간의 직접 근거로 사용하지 않습니다.</p><div class="w12-weekday-grid">${rows.map(r=>`<div><span>${'일월화수목금토'[r.day]}</span><div class="w12-week-bar"><i style="height:${r.days?Math.max(0,r.total/r.days)/top*100:0}%"></i></div><strong>${r.days?fmt(Math.round(r.total/r.days))+'원':'미입력'}</strong><small>${r.days}일 입력</small></div>`).join('')}</div>`;}
loadSalesTop10=async function(){const amount=_salesTop10Mode==='amount',current=groupRows(view.sales,'product_id',amount?'amount':'quantity'),previous=groupRows(view.prevShips,'product_id',amount?'amount':'quantity'),total=[...current.values()].reduce((n,v)=>n+v,0),rows=[...current].filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,10);document.querySelectorAll('[data-stock="rank"]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.id===_salesTop10Mode));$('sales-top10').innerHTML=amount&&!view.sales.some(r=>num(r.amount))?empty('상품별 금액이 기록되어 있지 않아 실제 상품 매출 순위를 계산할 수 없습니다. 채널 매출은 매출·판매 전략에서 확인하세요.'):table(['순위','상품·옵션',amount?'기록 금액':'출고 수량','비중','비교 기간','증감'],rows.map(([id,v],i)=>`<tr><td>${i+1}</td><td>${esc(label(view.products.find(p=>p.id===id)))}</td><td>${fmt(v)}${amount?'원':'개'}</td><td>${total?(v/total*100).toFixed(1):0}%</td><td>${previous.has(id)?fmt(previous.get(id)):'미입력'}</td><td>${change(v,previous.get(id)||0,previous.has(id))}</td></tr>`));};

loadSalesLogInline=async function(){$('sales-log-inline-total').textContent=`${view.revenues.length.toLocaleString()}건 · 합계 ${fmt(view.revenues.reduce((n,r)=>n+num(r.amount),0))}원`;$('sales-log-inline').innerHTML=view.revenues.length?table(['날짜','채널','금액','메모',''],view.revenues.slice().sort((a,b)=>b.date.localeCompare(a.date)||String(b.id).localeCompare(String(a.id))).map(r=>`<tr data-revenue-id="${esc(r.id)}"><td>${esc(r.date)}</td><td>${esc(r.channel)}</td><td>${fmt(r.amount)}원</td><td>${esc(r.note||'—')}</td><td>${button('수정·삭제','edit-revenue',r.id)}</td></tr>`)):empty('선택 기간에 입력된 주문 매출이 없습니다.');};
document.addEventListener('click',async e=>{const b=e.target.closest('[data-stock]');if(!b)return;const id=b.dataset.id;try{switch(b.dataset.stock){case'toggle-channels':{const on=inventoryPage.classList.toggle('w12-show-channels');b.setAttribute('aria-pressed',on);b.textContent=on?'채널별 재고 접기':'채널별 재고 함께 보기';break;}case'clear-search':{$(id).value='';$(id).focus();if(id==='inv-search')await loadInvList({cached:true});else await loadChannelInv(invCurrentChannel,{cached:true});break;}case'channel-filter':invCurrentChannel=id;$('w11-channel').value=id;await loadChannelInv(id,{cached:true});break;case'channel-category':invChCurrentCat=id;$('w11-channel-category').value=id;await loadChannelInv(invCurrentChannel,{cached:true});break;case'categories':openCatManageModal();break;case'allocate':openChAllocModal(id);break;case'ship':await openShipmentModal();break;case'revenue':openSalesRevenueModal();break;case'edit-revenue':{const r=view.revenues.find(r=>r.id===id);if(r)openSalesLogEdit(r.id,r.date,r.channel,r.amount,r.note||'');break;}case'plan':await addProdToToday(id);break;case'sales-tab':showSalesTab(id);history.replaceState(null,'','#sales/'+id);break;case'range':_salesRange=id;_sales6m=id!=='month';await loadSalesData();break;case'rank':_salesTop10Mode=id;loadSalesTop10();break;case'chart':{const r=view.buckets.find(r=>r.date===id);$('w11-chart-value').textContent=id+' · '+(r.entered?fmt(r.amount)+'원':'미입력');break;}case'retry-sales':await loadSalesData();break;}}catch(error){toast(error.message||'처리하지 못했습니다.',5000);}});
const originalInvTab=invSetTab;invSetTab=function(tab,el){if(tab==='channel'&&invCurrentTab!=='channel')$('w12-allocation-alert').open=false;originalInvTab(tab,el||[...document.querySelectorAll('#inv-tabs .page-tab')][['overview','shiplog','channel','receipt','alert'].indexOf(tab)]);if(location.hash.startsWith('#inventory'))history.replaceState(null,'','#inventory/'+tab);};
const originalRender=renderPage;renderPage=async function(page,sub){const result=await originalRender(page,sub);if(page==='inventory'&&['overview','shiplog','channel','receipt','alert'].includes(sub))invSetTab(sub);if(page==='sales')showSalesTab(sub||'overview');return result;};
for(const b of inventoryPage.querySelectorAll('.page-header-top button'))b.textContent=b.textContent.replace(/^[^가-힣+]+/,'');
$('inv-cat-pills').parentElement.classList.add('w11-legacy-filter');
for(const id of ['inv-product-modal','inv-receipt-modal','inv-alloc-modal','inv-cat-modal','shipment-modal','ship-log-edit-modal','inv-upload-modal','inv-import-modal','ch-alloc-modal','sales-log-edit-modal','sales-revenue-modal','sales-log-modal','receipt-edit-modal'])$(id)?.classList.add('w8-modal');
const originalSaveChAlloc=saveChAlloc;saveChAlloc=async function(){await originalSaveChAlloc();if(!$('ch-alloc-modal').classList.contains('on')&&invCurrentTab==='channel')await loadChannelInv(invCurrentChannel,{cached:true});};
window.addEventListener('resize',()=>{if(view.monthly)paintTrend();});
window.CHEROPStockSales={view,period,readClient,showSalesTab,stockData,invalidate(){stockSnapshot=null;stockSnapshotAt=0;}};
})();
