/* Approved inventory/sales views; original write handlers and record IDs are retained. */
(()=>{'use strict';
const api=CHEROPSections,esc=v=>escapeHtml(String(v??'')),num=v=>Number(v)||0,fmt=v=>num(v).toLocaleString(),label=p=>p?(p.option_name?p.name+' · '+p.option_name:p.name):'상품 정보 없음';
// Paginate every read in the adapted legacy loaders. Explicit pagers keep their own ranges.
const readClient={from(table){let q=db.from(table),explicit=false,single=false;const proxy=new Proxy({}, {get(_,key){if(key==='then')return(resolve,reject)=>(async()=>{q=q.order('id',{ascending:true});if(explicit||single){const r=await q;if(r.error)throw r.error;return r;}let data=[];for(let offset=0;;offset+=500){const r=await q.range(offset,offset+499);if(r.error)throw r.error;data.push(...(r.data||[]));if((r.data||[]).length<500)return{data,error:null};}})().then(resolve,reject);return(...args)=>{if(['insert','update','upsert','delete'].includes(key))throw Error('조회 화면에서 데이터 변경을 차단했습니다.');if(key==='range'||key==='limit')explicit=true;if(key==='single'||key==='maybeSingle')single=true;q=q[key](...args);return proxy;};}});return proxy;}};
const view={salesTab:'overview',channel:'',ticket:0,products:[],sales:[],revenues:[],inventory:[],reservations:[]};
const table=(heads,rows)=>`<div class="w11-scroll"><table class="inv-tbl"><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const button=(t,a,id='')=>`<button type="button" class="w11-button" data-stock="${a}" data-id="${esc(id)}">${t}</button>`;
const empty=t=>`<p class="w11-empty">${esc(t)}</p>`;

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

loadInvList=async function() {
 const db=readClient;

  try {
    const searchQ = ($('inv-search')?.value||'').trim().toLowerCase();
    let query = db.from('products').select('*').order('sort_order',{ascending:true,nullsFirst:false}).order('name');
    if(invCurrentFilter==='disc')     query = query.eq('is_discontinued',true);
    else if(invCurrentFilter==='planned') query = query.eq('is_discontinued',false).eq('disc_status','planned');
    else                                  query = query.eq('is_discontinued',false).or('disc_status.is.null,disc_status.neq.planned');
    const allProds = (await query).data||[];
    let prods = allProds;
    if(invCurrentCat !== '전체') prods = prods.filter(p=>p.category===invCurrentCat);
    if(searchQ) prods = prods.filter(p=>
      p.name?.toLowerCase().includes(searchQ)||(p.option_name||'').toLowerCase().includes(searchQ));
    const invRows   = (await db.from('inventory').select('*')).data||[];
    const chInvRows = (await db.from('channel_inventory').select('*')).data||[];
    const salesRows = await dbFetchAll(() => db.from('sales_log').select('*').gte('sale_date', dateStr(new Date(Date.now()-28*86400000))));
    const sState    = await getAppState();
    const reservations = sState.ch_reservations || [];

    inventorySummary(invRows, reservations, sState, allProds);
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
      <th style="width:20px;"></th><th>상품명 · 옵션</th><th>카테고리</th><th>총재고</th><th>상품화 완료</th><th>상품화 대기</th><th>가용</th><th>채널 배분</th><th>예약</th><th>불량 보류</th><th>품절예상</th><th>상태</th><th></th>
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
        <td><div style="font-weight:500;">${p.name}</div>${opt}</td>
        <td style="font-size:11px;min-width:90px;" onclick="event.stopPropagation()">
          <select class="inv-cat-inline-sel" data-pid="${p.id}" onchange="saveInlineCat(this)" onfocus="populateInlineCat(this)" style="background:transparent;border:none;outline:none;font-size:11px;color:${p.category?'var(--text)':'var(--faint)'};cursor:pointer;width:100%;font-family:var(--font);">
            <option value="${p.category||''}">${p.category||'—'}</option>
          </select>
        </td>
        <td class="inv-num" style="padding:0;"><input class="inv-inline-num" type="number" value="${inv.total_stock||0}" data-pid="${p.id}" data-field="total_stock" data-prev="${inv.total_stock||0}" onfocus="this.select()" onblur="saveInlineStock(this)" onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape'){this.value=this.dataset.prev;this.blur();}"></td>
        <td class="inv-num inv-green" style="padding:0;"><input class="inv-inline-num inv-green" type="number" value="${inv.produced_stock||0}" data-pid="${p.id}" data-field="produced_stock" data-prev="${inv.produced_stock||0}" onfocus="this.select()" onblur="saveInlineStock(this)" onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape'){this.value=this.dataset.prev;this.blur();}"></td>
        <td class="inv-num inv-amber">${inv.pending_production||0}</td>
        <td class="inv-num">${inv.available_stock||0}</td>
        <td onclick="openChAllocModal('${p.id}')" style="cursor:pointer;" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
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

loadChannelInv=async function(ch) {
 const db=readClient;ch=ch||invCurrentChannel||'자사몰';

  try {
    const searchQ = ($('inv-ch-search')?.value||'').trim().toLowerCase();
    const allProds   = (await db.from('products').select('*').order('name')).data||[];
    const allChInv   = (await db.from('channel_inventory').select('*')).data||[];
    const allInvRows = (await db.from('inventory').select('*')).data||[];
    const allSales   = await dbFetchAll(() => db.from('sales_log').select('*').gte('sale_date', dateStr(new Date(Date.now()-28*86400000))));
    // 배분 필요 알림
    const allocNeeded = allProds.filter(p=>{
      const ci=allChInv.find(x=>x.product_id===p.id&&x.channel===ch)||{stock:0};
      const inv=allInvRows.find(x=>x.product_id===p.id)||{};
      const vel=calcVelocity(allSales,p.id,ch);
      const days=vel>0?Math.ceil(ci.stock/vel):null;
      return days!==null && days<=3 && (inv.available_stock||0)>0;
    });
    const allocBanner=$('inv-ch-alloc-banner');
    if(allocNeeded.length){
      allocBanner.innerHTML=`<div style="background:#FAECEB;border:0.5px solid var(--red);border-radius:10px;padding:12px 16px;">
        <div style="font-size:12px;font-weight:500;color:var(--red);margin-bottom:8px;">🚨 배분 필요 ${allocNeeded.length}건 — 가용재고에서 즉시 배분하세요</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${allocNeeded.map(p=>{
          const lbl=p.option_name?`${p.name} · ${p.option_name}`:p.name;
          const ci=allChInv.find(x=>x.product_id===p.id&&x.channel===ch)||{stock:0};
          const vel=calcVelocity(allSales,p.id,ch);
          const days=vel>0?Math.ceil(ci.stock/vel):null;
          return `<span style="font-size:11px;background:#fff;border:0.5px solid var(--red);border-radius:20px;padding:3px 10px;color:var(--red);">${lbl} D+${days}</span>`;
        }).join('')}</div>
      </div>`;
    } else { allocBanner.innerHTML=''; }
    const catSelect=$('w11-channel-category');const cats=['전체',...new Set(allProds.map(p=>p.category).filter(Boolean))];catSelect.innerHTML=cats.map(c=>`<option ${c===invChCurrentCat?'selected':''}>${esc(c)}</option>`).join('');
    // 필터
    const st=await getAppState();const rsv=st.ch_reservations||[];
    let prods = allProds.filter(p=>$('w11-channel-status').value==='all'||($('w11-channel-status').value==='disc'?p.is_discontinued:!p.is_discontinued));
    if(invChCurrentCat !== '전체') prods = prods.filter(p=>p.category===invChCurrentCat);
    if(searchQ) prods = prods.filter(p=>
      p.name?.toLowerCase().includes(searchQ)||(p.option_name||'').toLowerCase().includes(searchQ));
    const chInvRows = allChInv.filter(r=>r.channel===ch);
    const salesRows = allSales.filter(r=>r.channel===ch);
    const total = chInvRows.reduce((s,r)=>s+(r.stock||0),0);
    $('inv-ch-title').textContent=`${ch} 재고`; $('inv-ch-sub').textContent=`총 ${total}개`;
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
      return `<tr>
        <td><div style="font-weight:500;">${p.name}</div>${opt}</td>
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
    const stSup = await getAppState();
    const supMap = {}; (stSup.prod_supplies||[]).forEach(x => supMap[x.id] = x);

    const renderRow=(r,showComplete)=>{
      let label;
      if (r.item_type === 'supply' || (!r.product_id && r.supply_id)) {
        const sup = supMap[r.supply_id];
        label = (sup ? sup.name : '소모품') + ' <span style="font-size:10px;color:var(--light);">· 소모품</span>';
      } else {
        const p=pMap[r.product_id]||{name:'(삭제됨)'};
        label=p.option_name?`${p.name} · ${p.option_name}`:p.name;
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

    // 채널 배분 섹션
    const allocEl = $('inv-ch-alloc-list');
    if(allocEl){
      if(!allocAlerts.length){
        allocEl.innerHTML='<div style="padding:14px 20px;font-size:13px;color:var(--faint);">배분 필요 항목이 없어요 ✓</div>';
      } else {
        allocEl.innerHTML=`<table class="inv-tbl">
          <thead><tr><th>상품</th><th>채널</th><th>채널 재고</th><th>가용재고</th><th></th></tr></thead>
          <tbody>${allocAlerts.map(a=>`<tr>
            <td style="font-weight:500;">${a.label}</td>
            <td class="inv-faint">${a.ch}</td>
            <td class="inv-num inv-red">D+${a.days}</td>
            <td class="inv-num inv-green">${a.avail}개</td>
            <td><button class="f-btn f-btn-cancel" style="font-size:11px;padding:4px 10px;" onclick="openInvModal('alloc')">지금 배분</button></td>
          </tr>`).join('')}</tbody>
        </table>`;
      }
    }

    // 발주 필요 섹션
    const alertEl = $('inv-alert-list');
    if(alertEl){
      const appS = await getAppState();
      const hidden = new Set(appS.inv_alert_hidden || []);
      const visible = orderAlerts.filter(a => !hidden.has(a.productId));
      const hiddenList = orderAlerts.filter(a =>  hidden.has(a.productId));

      const renderAlertRow = (a, isHidden=false) => `<tr ${isHidden?'style="opacity:.55;"':''}>
        <td style="font-weight:500;">${escapeHtml(a.label)}</td>
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
    const total = allocAlerts.length + visAlerts.length;
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
            <div style="flex:1;font-size:12px;color:var(--text);">${lbl}</div>
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
function inventorySummary(rows,reservations,s,products){const ids=new Set(products.filter(p=>invCurrentCat==='전체'||p.category===invCurrentCat).map(p=>p.id));const filtered=rows.filter(r=>ids.has(r.product_id));$('w11-stock-metrics').innerHTML=metrics([['현재 총재고',fmt(filtered.reduce((n,r)=>n+num(r.total_stock),0)),'입고 누계 아님 · 기존 재고 원장'],['상품화 완료',fmt(filtered.reduce((n,r)=>n+num(r.produced_stock),0)),'가용·채널 배분 포함'],['상품화 대기',fmt(filtered.reduce((n,r)=>n+num(r.pending_production),0)),'예약 수량 포함'],['예약',fmt(reservations.filter(r=>ids.has(r.product_id)).reduce((n,r)=>n+num(r.qty),0)),'상품화 완료 후 자동 배분']]);const sel=$('w11-category');sel.innerHTML=[...new Set(['전체',...(s.inv_categories||[]),...products.map(p=>p.category).filter(Boolean)])].map(c=>`<option ${c===invCurrentCat?'selected':''}>${esc(c)}</option>`).join('');}
$('inv-tab-overview').insertAdjacentHTML('afterbegin','<div id="w11-stock-metrics"></div>');
const invFilter=document.createElement('div');invFilter.className='w11-filters';invFilter.innerHTML='<label class="w11-search">상품 검색</label><label>카테고리<select id="w11-category"><option>전체</option></select></label><label>상품 상태<select id="w11-status"><option value="all">활성</option><option value="planned">단종 예정</option><option value="disc">단종</option></select></label>'+button('카테고리 관리','categories');invFilter.querySelector('.w11-search').append($('inv-search'));$('inv-tab-overview').insertBefore(invFilter,$('inv-overview-banner'));
$('w11-category').onchange=e=>{invCurrentCat=e.target.value;loadInvOverview();};$('w11-status').onchange=e=>{invCurrentFilter=e.target.value;loadInvList();};
$('inv-channel-tabs').insertAdjacentHTML('afterend','<select id="w11-channel" aria-label="재고 채널"></select><select id="w11-channel-status" aria-label="채널 상품 상태"><option value="active">활성 상품</option><option value="all">전체 상품</option><option value="disc">단종 상품</option></select>');$('w11-channel').onchange=e=>{invCurrentChannel=e.target.value;loadChannelInv(invCurrentChannel);};$('w11-channel-status').onchange=()=>loadChannelInv(invCurrentChannel);$('inv-ch-cat-pills').innerHTML='<select id="w11-channel-category" aria-label="채널 상품 카테고리"><option>전체</option></select>';$('w11-channel-category').onchange=e=>{invChCurrentCat=e.target.value;loadChannelInv(invCurrentChannel);};
const shipHead=$('ship-log-list').previousElementSibling;shipHead.innerHTML='<div class="w11-filters"><label>조회 월<input type="month" id="w11-ship-month"></label><label>채널<select id="ship-log-ch-filter"><option value="">전체 채널</option></select></label><span id="ship-log-total"></span>'+button('출고 등록','ship')+'</div><span id="ship-log-month-label" hidden></span>';
$('w11-ship-month').onchange=e=>{if(/^\d{4}-\d{2}$/.test(e.target.value)){_shipLogMonth=e.target.value;loadShipLog();}};$('ship-log-ch-filter').onchange=loadShipLog;
function syncShipControls(){$('w11-ship-month').value=_shipLogMonth;}
const originalInitInventory=initInventory;initInventory=async function(){setupChannels().catch(console.error);return originalInitInventory();};
let channelSetup;
async function setupChannels(){if(!channelSetup)channelSetup=Promise.all(['channel_inventory','channel_sales_log','sales_log'].map(t=>readClient.from(t).select('id,channel'))).catch(e=>{channelSetup=null;throw e;});const results=await channelSetup;const [ch,revenues,ships]=results.map(r=>r.data);const names=[...new Set([...CHANNELS,...ch.map(r=>r.channel),...revenues.map(r=>r.channel),...ships.map(r=>r.channel)].filter(Boolean))];for(const[id,all]of [['w11-channel',false],['ship-log-ch-filter',true],['w11-sales-channel',true]]){const el=$(id),value=el.value;el.innerHTML=(all?'<option value="">전체 채널</option>':'')+names.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');el.value=names.includes(value)?value:all?'':invCurrentChannel;}view.channelNames=names;}
const salesTabs=[['overview','매출·재고 보충'],['ranking','판매 TOP 10'],['records','주문 매출 내역']];
salesPage.innerHTML=`<div class="page-header"><div class="page-header-top"><div><div class="page-header-title">판매분석</div><p class="w11-note">주문 매출·출고 원장 기준</p></div>${button('+ 주문 매출 입력','revenue')}</div><nav class="w11-tabs">${salesTabs.map(([id,t])=>button(t,'sales-tab',id)).join('')}</nav></div><div class="w11-filters"><label>조회 연도<select id="w11-sales-year"></select></label><label>조회 월<select id="w11-sales-month">${Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}월</option>`).join('')}</select></label><label>채널<select id="w11-sales-channel"><option value="">전체 채널</option></select></label></div><div class="w11-ranges">${[['month','선택 월'],['6m','최근 6개월'],['year','연간']].map(([k,t])=>button(t,'range',k)).join('')}</div><p id="w11-period" class="w11-note"></p><div id="w11-sales-error" role="alert"></div><section data-sales-section="overview"><div id="sales-metrics"></div><section class="w11-section"><h2>재고 보충 필요 상품</h2><p class="w11-note">최근 28일 출고와 현재 재고 기준 · 기존 7일 긴급 / 21일 주의</p><div id="sales-signal-body"></div></section><section class="w11-section"><h2>기간별 매출 그래프</h2><div id="sales-trend-wrap"></div></section><section class="w11-section"><h2>채널별 매출 비중</h2><div id="sales-channel-list"></div></section></section><section data-sales-section="ranking" hidden><div class="w11-heading"><h2>판매 TOP 10</h2><div id="sales-top10-mode-pills">${button('수량','rank','qty')}${button('금액','rank','amount')}</div></div><p class="w11-note">선택 기간·채널의 상품별 출고 기록 기준</p><div id="sales-top10"></div></section><section data-sales-section="records" hidden><div class="w11-heading"><h2>주문 매출 내역</h2><span id="sales-log-inline-total"></span></div><p class="w11-note">주문 매출과 경영·정산의 실입금은 별도 기준입니다. 기존 수정·삭제 기능을 유지하며, 주문 금액을 실입금 원장에 자동 합산하지 않습니다.</p><div id="sales-log-inline"></div></section>`;
const nowDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),pad=n=>String(n).padStart(2,'0'),iso=d=>d.toISOString().slice(0,10),addDay=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return iso(x);};
function period(){const month=`${_salesYear}-${pad(_salesMonth)}`,last=new Date(Date.UTC(_salesYear,_salesMonth,0)).getUTCDate();let from=month+'-01',to=month+'-'+last;if(_salesRange==='year'){from=_salesYear+'-01-01';to=_salesYear+'-12-31';}else if(_salesRange==='6m'){from=iso(new Date(Date.UTC(_salesYear,_salesMonth-6,1)));}const today=nowDay();if(from<=today&&to>=today)to=today;const days=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;let prevTo=addDay(from,-1),prevFrom=addDay(prevTo,1-days);return{from,to,prevFrom,prevTo,label:from+' — '+to};}
salesDateRange=()=>period();
function syncSalesControls(){const y=$('w11-sales-year');const years=[...new Set([_salesYear,...Array.from({length:10},(_,i)=>Number(nowDay().slice(0,4))-7+i),...(view.revenues||[]).map(r=>Number(r.date.slice(0,4)))])].sort((a,b)=>a-b);y.innerHTML=years.map(n=>`<option value="${n}" ${n===_salesYear?'selected':''}>${n}년</option>`).join('');$('w11-sales-month').value=_salesMonth;$('w11-sales-channel').value=view.channel;document.querySelectorAll('[data-stock="range"]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.id===_salesRange));showSalesTab(view.salesTab);}
function showSalesTab(tab){view.salesTab=salesTabs.some(([k])=>k===tab)?tab:'overview';document.querySelectorAll('[data-sales-section]').forEach(el=>el.hidden=el.dataset.salesSection!==view.salesTab);document.querySelectorAll('[data-stock="sales-tab"]').forEach(el=>el.setAttribute('aria-pressed',el.dataset.id===view.salesTab));}
_initSalesMonthUI=function(){const date=nowDay();_salesYear=Number(date.slice(0,4));_salesMonth=Number(date.slice(5,7));_salesRange='month';_sales6m=false;};
let salesInitialized=false;initSalesPage=async function(){if(!salesInitialized){_initSalesMonthUI();salesInitialized=true;}syncSalesControls();setupChannels().catch(console.error);await loadSalesData();};
for(const id of ['w11-sales-year','w11-sales-month','w11-sales-channel'])$(id).onchange=e=>{if(id.endsWith('year'))_salesYear=Number(e.target.value);else if(id.endsWith('month'))_salesMonth=Number(e.target.value);else view.channel=e.target.value;loadSalesData();};
loadSalesData=async function(){const ticket=++view.ticket;syncSalesControls();const p=period();$('w11-period').textContent=p.label+' · '+(view.channel||'전체 채널');$('w11-sales-error').textContent='';try{const range=(table,date,from,to)=>api.queryAll(table,q=>{q=q.gte(date,from).lte(date,to);return view.channel?q.eq('channel',view.channel):q;});const [ships,revenues,prevShips,prevRevenue,products,inventory,s,recent]=await Promise.all([range('sales_log','sale_date',p.from,p.to),range('channel_sales_log','date',p.from,p.to),range('sales_log','sale_date',p.prevFrom,p.prevTo),range('channel_sales_log','date',p.prevFrom,p.prevTo),api.queryAll('products'),api.queryAll('inventory'),getAppState(),api.queryAll('sales_log',q=>q.gte('sale_date',addDay(nowDay(),-27)).lte('sale_date',nowDay()))]);if(ticket!==view.ticket)return;Object.assign(view,{sales:ships,revenues,products,inventory,reservations:s.ch_reservations||[],recent,state:s});window._salesTop10Rows=ships;
 const amount=revenues.reduce((n,r)=>n+num(r.amount),0),total=ships.reduce((n,r)=>n+num(r.quantity),0),prevAmt=prevRevenue.reduce((n,r)=>n+num(r.amount),0),prevQty=prevShips.reduce((n,r)=>n+num(r.quantity),0);const diff=(n,prev)=>prev?`${n>=prev?'+':''}${((n-prev)/Math.abs(prev)*100).toFixed(1)}% · 직전 동일 일수 대비`:'비교 기간 입력 없음';
 $('sales-metrics').innerHTML=metrics([['주문 매출',revenues.length?fmt(amount)+'원':'미입력',diff(amount,prevAmt)],['출고 수량',ships.length?fmt(total)+'개':'미입력',diff(total,prevQty)],['평균 판매 단가','미집계','주문별 금액·수량 연결 필요'],['취급 SKU',fmt(new Set(ships.filter(r=>num(r.quantity)>0).map(r=>r.product_id)).size)+'종',`${ships.length.toLocaleString()}건 출고 기록`]]);
 paintRecommendations();paintTrend(p);paintChannels();loadSalesTop10();loadSalesLogInline();
 }catch(e){if(ticket===view.ticket)$('w11-sales-error').innerHTML=empty('불러오지 못했습니다. '+e.message)+button('다시 불러오기','retry-sales');}};
function paintRecommendations(){const s=view.state,hidden=new Set(s.prod_hidden||[]),rows=view.products.filter(p=>!p.is_discontinued&&!hidden.has(p.id)).map(p=>{const inv=view.inventory.find(i=>i.product_id===p.id)||{},days=daysUntilSoldOut(inv,calcVelocity(view.recent,p.id)),reserved=view.reservations.filter(r=>r.product_id===p.id).reduce((n,r)=>n+num(r.qty),0);return{p,inv,days,reserved};}).filter(r=>r.days!==null&&r.days<=PRODUCE_TH.warn&&num(r.inv.pending_production)>0).sort((a,b)=>a.days-b.days);$('sales-signal-body').innerHTML=rows.length?table(['상품·옵션','판매가능','상품화 대기','예약','소진 예상',''],rows.map(({p,inv,days,reserved})=>`<tr><td>${esc(label(p))}</td><td>${fmt(inv.produced_stock)}</td><td>${fmt(inv.pending_production)}</td><td>${fmt(reserved)}</td><td>${days}일</td><td>${button('작업 예정에 추가','plan',p.id)}</td></tr>`)):empty('현재 기준에 해당하는 보충 대상이 없습니다.');}
function paintTrend(p){const map=new Map();for(const r of view.revenues){const k=_salesRange==='month'?r.date:r.date.slice(0,7);map.set(k,(map.get(k)||0)+num(r.amount));}const buckets=[];if(_salesRange==='month'){for(let d=p.from;d<=p.to;d=addDay(d,1))buckets.push({date:d,amount:map.get(d)||0,entered:map.has(d)});}else{let d=p.from.slice(0,7);while(d<=p.to.slice(0,7)){buckets.push({date:d,amount:map.get(d)||0,entered:map.has(d)});const[y,m]=d.split('-').map(Number);d=iso(new Date(Date.UTC(y,m,1))).slice(0,7);}}view.buckets=buckets;const max=Math.max(...buckets.map(r=>Math.abs(r.amount)),1);$('sales-trend-wrap').innerHTML=`<p class="w11-note">${_salesRange==='month'?'일별':'월별'} · 막대를 누르면 입력 금액 확인 · 빈 구간은 미입력</p><div class="w11-chart" style="--bars:${buckets.length}">${buckets.map(r=>`<button type="button" data-stock="chart" data-id="${r.date}" aria-label="${r.date} ${r.entered?fmt(r.amount)+'원':'미입력'}"><i style="height:${r.entered?Math.max(Math.abs(r.amount)/max*100,1):0}%" class="${r.amount<0?'negative':''}"></i><span>${_salesRange==='month'?Number(r.date.slice(8)):Number(r.date.slice(5))}</span></button>`).join('')}</div><p id="w11-chart-value" role="status" class="w11-note"></p><details class="w11-chart-data"><summary>그래프 수치 보기</summary>${table(['기간','주문 매출'],buckets.map(r=>`<tr><td>${r.date}</td><td>${r.entered?fmt(r.amount)+'원':'미입력'}</td></tr>`))}</details>`;}
function paintChannels(){const grouped=new Map();for(const r of view.revenues)grouped.set(r.channel,(grouped.get(r.channel)||0)+num(r.amount));const total=[...grouped.values()].reduce((n,v)=>n+v,0),max=Math.max(...grouped.values(),1);$('sales-channel-list').innerHTML=[...grouped].sort((a,b)=>b[1]-a[1]).map(([ch,amount])=>`<div class="w11-channel-row"><span>${esc(ch)}</span><div><i style="width:${Math.max(0,amount)/max*100}%"></i></div><strong>${fmt(amount)}원</strong><small>${total?(amount/total*100).toFixed(1):'0'}%</small></div>`).join('')||empty('선택 기간에 입력된 주문 매출이 없습니다.');}
loadSalesTop10=async function(){const amount=_salesTop10Mode==='amount',group=new Map();for(const r of view.sales){if(r.product_id)group.set(r.product_id,(group.get(r.product_id)||0)+num(amount?r.amount:r.quantity));}document.querySelectorAll('[data-stock="rank"]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.id===_salesTop10Mode));const rows=[...group].filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]).slice(0,10);$('sales-top10').innerHTML=amount&&!view.sales.some(r=>num(r.amount))?empty('상품별 매출금액이 입력되지 않아 금액 순위를 계산할 수 없습니다. 채널별 주문 매출은 매출·재고 보충 탭에서 확인할 수 있습니다.'):table(['순위','상품·옵션',amount?'기록된 상품 금액':'출고 수량'],rows.map(([id,n],i)=>`<tr><td>${i+1}</td><td>${esc(label(view.products.find(p=>p.id===id)))}</td><td>${fmt(n)}${amount?'원':'개'}</td></tr>`));};
loadSalesLogInline=async function(){$('sales-log-inline-total').textContent=`${view.revenues.length.toLocaleString()}건 · 합계 ${fmt(view.revenues.reduce((n,r)=>n+num(r.amount),0))}원`;$('sales-log-inline').innerHTML=view.revenues.length?table(['날짜','채널','금액','메모',''],view.revenues.slice().sort((a,b)=>b.date.localeCompare(a.date)||String(b.id).localeCompare(String(a.id))).map(r=>`<tr data-revenue-id="${esc(r.id)}"><td>${esc(r.date)}</td><td>${esc(r.channel)}</td><td>${fmt(r.amount)}원</td><td>${esc(r.note||'—')}</td><td>${button('수정·삭제','edit-revenue',r.id)}</td></tr>`)):empty('선택 기간에 입력된 주문 매출이 없습니다.');};
document.addEventListener('click',async e=>{const b=e.target.closest('[data-stock]');if(!b)return;const id=b.dataset.id;try{switch(b.dataset.stock){case'categories':openCatManageModal();break;case'allocate':openChAllocModal(id);break;case'ship':await openShipmentModal();break;case'revenue':openSalesRevenueModal();break;case'edit-revenue':{const r=view.revenues.find(r=>r.id===id);if(r)openSalesLogEdit(r.id,r.date,r.channel,r.amount,r.note||'');break;}case'plan':await addProdToToday(id);break;case'sales-tab':showSalesTab(id);history.replaceState(null,'','#sales/'+id);break;case'range':_salesRange=id;_sales6m=id!=='month';await loadSalesData();break;case'rank':_salesTop10Mode=id;loadSalesTop10();break;case'chart':{const r=view.buckets.find(r=>r.date===id);$('w11-chart-value').textContent=id+' · '+(r.entered?fmt(r.amount)+'원':'미입력');break;}case'retry-sales':await loadSalesData();break;}}catch(error){toast(error.message||'처리하지 못했습니다.',5000);}});
const originalInvTab=invSetTab;invSetTab=function(tab,el){originalInvTab(tab,el||[...document.querySelectorAll('#inv-tabs .page-tab')][['overview','shiplog','channel','receipt','alert'].indexOf(tab)]);if(location.hash.startsWith('#inventory'))history.replaceState(null,'','#inventory/'+tab);};
const originalRender=renderPage;renderPage=async function(page,sub){const result=await originalRender(page,sub);if(page==='inventory'&&['overview','shiplog','channel','receipt','alert'].includes(sub))invSetTab(sub);if(page==='sales')showSalesTab(sub||'overview');return result;};
for(const b of inventoryPage.querySelectorAll('.page-header-top button'))b.textContent=b.textContent.replace(/^[^가-힣+]+/,'');
$('inv-cat-pills').parentElement.classList.add('w11-legacy-filter');
for(const id of ['inv-product-modal','inv-receipt-modal','inv-alloc-modal','inv-cat-modal','shipment-modal','ship-log-edit-modal','inv-upload-modal','inv-import-modal','ch-alloc-modal','sales-log-edit-modal','sales-revenue-modal','sales-log-modal','receipt-edit-modal'])$(id)?.classList.add('w8-modal');
window.CHEROPStockSales={view,period,readClient,showSalesTab};
})();
