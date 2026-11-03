/* Sales writes use one database transaction; retrying an identical import is a no-op. */
function buildInventorySalesRows(agg, mappings, skipped, channel, aliases = {}) {
  const rows = new Map();
  for (const [key, group] of Object.entries(agg)) {
    const pid = mappings[key];
    if (!pid || skipped.has(key)) continue;
    for (const source of group.rows) {
      const date = source.saleDate;
      const qty = Number(source.qty), amount = Number(source.orderAmt || 0);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isSafeInteger(qty) || qty < 0 || !Number.isSafeInteger(amount)) throw Error('판매 날짜·수량·금액을 확인해주세요: ' + key);
      const item = source.itemNo == null ? '' : String(source.itemNo).trim();
      const id = item ? `sale-item-${encodeURIComponent(channel)}-${encodeURIComponent(item)}` : `sale-${date}-${encodeURIComponent(channel)}-${pid}`;
      const oldPids = [pid, ...Object.keys(aliases).filter(k => aliases[k] === pid)];
      const legacy_ids = item ? [`sale-item-${item}`] : oldPids.map(p => `sale-${date}-${channel.replace(/[^a-z0-9]/gi, '')}-${p}`);
      const row = {id, product_id:pid, channel, quantity:qty, amount, sale_date:date, legacy_ids};
      const prev = rows.get(id);
      if (prev && item) {
        if (prev.product_id !== pid || prev.quantity !== qty || prev.amount !== amount || prev.sale_date !== date) throw Error('같은 주문 품목번호에 서로 다른 내용이 있습니다: ' + item);
        continue; // Repeated identical order line in the same file.
      }
      if (prev) { prev.quantity += qty; prev.amount += amount; }
      else rows.set(id, row);
    }
  }
  return [...rows.values()];
}
function inventorySaleExpected(row) {
  return Object.fromEntries(['quantity','channel','product_id','sale_date','amount'].map(k=>[k,row[k]]));
}
async function commitInventorySales(rows, deletes = []) {
  const {data,error} = await db.rpc('apply_inventory_sales_v1', {p_rows:rows,p_delete_ids:deletes});
  if (error) throw Error(error.message);
  return data;
}
function inventorySalesSaved(result, message) {
  const count = result?.inventory_warnings?.length || 0;
  toast(message + (count ? ` · 기존 재고 배정 확인 필요 ${count}종` : ''), count ? 6000 : 3000);
}
async function refreshInventorySales(result) {
  const dates = new Map((result?.affected || []).map(r=>[r.date+'|'+r.channel,r]));
  for (const r of dates.values()) {
    try { await syncSalesToTaxLedger(r.date,r.channel); }
    catch (e) { console.error('세무 매출장 재계산 실패',e); toast('판매·재고 저장 완료. 세무 매출장 재계산은 다시 확인해주세요.'); }
  }
  await loadInvOverview();
}
let inventorySalesBusy = false;
async function processUpload() {
  if (inventorySalesBusy) return;
  const btn=$('inv-up-submit'), agg=window._invUploadAgg||{}, mappings=window._invUploadMappings||{}, skipped=window._invUploadSkipped||new Set();
  inventorySalesBusy=true;
  try {
    const unresolved=Object.keys(agg).filter(k=>!mappings[k]&&!skipped.has(k));
    if (unresolved.length) {
      if (!await customConfirm(`매칭 안된 항목 ${unresolved.length}개`,'매칭된 항목만 업로드하고 나머지는 건너뛸까요?')) return;
      unresolved.forEach(k=>skipped.add(k));
    }
    if (btn) {btn.disabled=true;btn.textContent='판매·재고 저장 중…';}
    const state=await getAppState();
    const rows=buildInventorySalesRows(agg,mappings,skipped,invUploadChannel,state.inventory_product_aliases||{});
    if (!rows.length) throw Error('저장할 판매내역이 없습니다.');
    const result=await commitInventorySales(rows);
    // Mapping persistence may be retried safely; inventory was already committed atomically.
    for (const [key,pid] of Object.entries(mappings)) {
      if (skipped.has(key)||!agg[key]) continue;
      const {data:existing,error:readError}=await db.from('channel_product_mapping').select('id').eq('channel',invUploadChannel).eq('channel_name',key);
      if (readError) {toast('판매·재고 저장 완료. 상품 매칭 저장은 재확인해주세요.');break;}
      const payload={product_id:pid,channel:invUploadChannel,channel_name:key};
      const write=existing?.length ? await db.from('channel_product_mapping').update(payload).eq('channel',invUploadChannel).eq('channel_name',key) : await db.from('channel_product_mapping').insert({...payload,id:'map-'+crypto.randomUUID()});
      if(write.error){toast('판매·재고 저장 완료. 상품 매칭 저장은 재확인해주세요.');break;}
    }
    inventorySalesSaved(result,'판매·재고 저장 완료 · 재업로드는 변경 수량만 반영됩니다');
    closeModal('inv-upload-modal');
    await refreshInventorySales(result);
  } catch(e){toast('판매 입력 실패: '+e.message);console.error(e);}
  finally {inventorySalesBusy=false;if(btn){btn.disabled=false;btn.textContent='업로드 처리';btn.style.opacity='';}}
}
async function saveShipment() {
  if(inventorySalesBusy)return;
  const date=$('shipment-date').value, channel=$('shipment-channel').value;
  const items=[...$('shipment-rows').querySelectorAll('div[id^="sr-"]')].map(row=>({rowId:row.id,pid:row.querySelector('.ship-prod-id')?.value,qty:Number(row.querySelector('.ship-qty')?.value)})).filter(x=>x.pid);
  if(!date||!items.length||items.some(x=>!Number.isSafeInteger(x.qty)||x.qty<=0)){toast('날짜·상품·양의 정수 수량을 입력해주세요');return;}
  inventorySalesBusy=true;
  window._shipmentOperationId ||= crypto.randomUUID();
  try {
    const result=await commitInventorySales(items.map(x=>({id:`ship-${window._shipmentOperationId}-${x.rowId}`,product_id:x.pid,channel,quantity:x.qty,amount:0,sale_date:date})));
    inventorySalesSaved(result,'출고·재고 저장 완료');closeModal('shipment-modal');await refreshInventorySales(result);
    if(invCurrentTab==='shiplog')await loadShipLog();
  } catch(e){toast('출고 입력 실패: '+e.message);}
  finally {inventorySalesBusy=false;}
}
async function saveShipLogEdit(id) {
  if(inventorySalesBusy)return;
  const quantity=Number($('slog-edit-amount').value),sale_date=$('slog-edit-date').value,channel=$('slog-edit-channel').value;
  if(!sale_date||!Number.isSafeInteger(quantity)||quantity<=0){toast('날짜와 양의 정수 수량을 입력해주세요');return;}
  inventorySalesBusy=true;
  try {
    const {data:prev,error}=await db.from('sales_log').select('*').eq('id',id).single();if(error)throw error;
    const result=await commitInventorySales([{...prev,quantity,sale_date,channel,expected:inventorySaleExpected(prev)}]);
    inventorySalesSaved(result,'출고 수정·재고 조정 완료');closeModal('sales-log-edit-modal');await refreshInventorySales(result);await loadShipLog();
  } catch(e){toast('수정 실패: '+e.message);}
  finally{inventorySalesBusy=false;}
}
async function deleteShipLog(id) {
  if(inventorySalesBusy)return;
  inventorySalesBusy=true;
  try {
    const {data:prev,error}=await db.from('sales_log').select('*').eq('id',id).single();if(error)throw error;
    if(!await customConfirm('출고 내역 삭제',`재고 ${prev.quantity}개를 복구하고 출고 내역을 삭제할까요?`))return;
    const result=await commitInventorySales([],[{id,expected:inventorySaleExpected(prev)}]);
    inventorySalesSaved(result,'출고 삭제·재고 복구 완료');closeModal('sales-log-edit-modal');await refreshInventorySales(result);await loadShipLog();
  } catch(e){toast('삭제 실패: '+e.message);}
  finally{inventorySalesBusy=false;}
}

// Keep the legacy login/core file untouched; install inventory-only overrides here.
// Pasted rows can be created in the same millisecond. Give each row a stable,
// unique ID so both DOM controls and transaction retries address the right row.
function addShipmentRow(prodName='', qty='', prodId='', status='') {
  const row = document.createElement('div');
  const rowId = 'sr-' + crypto.randomUUID();
  row.id = rowId;
  row.style.cssText = 'display:grid;grid-template-columns:1fr 70px 32px;align-items:center;padding:6px 10px;border-bottom:0.5px solid var(--border);position:relative;';
  row.innerHTML = `
    <div style="position:relative;">
      <input class="prop-inp ship-prod-search" placeholder="상품명 검색..." autocomplete="off"
        style="width:100%;font-size:12px;border:none;background:transparent;padding:0;">
      <div class="ship-prod-dropdown" style="display:none;position:fixed;z-index:9999;background:var(--surface);border:0.5px solid var(--border2);border-radius:var(--r);max-height:200px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.12);"></div>
      <span class="ship-selected-prod" style="font-size:10px;margin-left:4px;"></span>
    </div>
    <input type="number" class="prop-inp ship-qty" placeholder="0" min="1"
      style="font-size:12px;text-align:center;border:none;background:var(--surface2);border-radius:4px;padding:3px 6px;">
    <div class="ship-remove" style="cursor:pointer;color:var(--light);font-size:14px;text-align:center;">✕</div>
    <input type="hidden" class="ship-prod-id">`;
  const input = row.querySelector('.ship-prod-search');
  input.value = prodName;
  input.dataset.rowid = rowId;
  input.oninput = input.onfocus = () => shipSearchProd(input, rowId);
  row.querySelector('.ship-prod-dropdown').id = 'ship-drop-' + rowId;
  row.querySelector('.ship-prod-id').value = prodId;
  row.querySelector('.ship-qty').value = qty;
  const selected = row.querySelector('.ship-selected-prod');
  selected.textContent = status ? (status === 'ok' ? '✓ 매칭' : '✕ 미매칭') : '';
  selected.style.display = status ? '' : 'none';
  selected.style.color = status === 'ok' ? '#6B9E7A' : status === 'err' ? '#C4736A' : 'var(--light)';
  row.querySelector('.ship-remove').onclick = () => row.remove();
  $('shipment-rows').appendChild(row);
}
const legacyOpenShipmentModal = openShipmentModal;
openShipmentModal = async function(...args) {
  window._shipmentOperationId = crypto.randomUUID();
  return legacyOpenShipmentModal(...args);
};
const legacySetDiscStatus = setDiscStatus;
setDiscStatus = function(status) {
  return legacySetDiscStatus(status === 'disc' ? 'disc' : 'active');
};
const legacyReconcileInventory = reconcileInventory;
reconcileInventory = async function(productId) {
  const [ir, cr] = await Promise.all([
    db.from('inventory').select('*').eq('product_id', productId).maybeSingle(),
    db.from('channel_inventory').select('stock').eq('product_id', productId)
  ]);
  if (ir.error || cr.error) throw Error(ir.error?.message || cr.error?.message);
  if (!ir.data) return null;
  const allocated = (cr.data || []).reduce((n, r) => n + (r.stock || 0), 0);
  if (allocated > ir.data.produced_stock || ir.data.produced_stock > ir.data.total_stock)
    throw Error('실수량·채널 배정을 먼저 확인해주세요.');
  return legacyReconcileInventory(productId);
};
