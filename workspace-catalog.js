/* Removing a catalog entry must never erase its receipts or shipment history. */
(() => {
'use strict';
const api=window.CHEROPSections;
let saving=false;
const equal=(a,b)=>a===b||!!a&&!!b&&typeof a==='object'&&typeof b==='object'&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
async function archiveProduct(id){
 const result=await db.from('products').select('*').eq('id',id).single();if(result.error)throw result.error;
 const before=result.data;if(!before)throw Error('상품을 찾을 수 없습니다.');if(before.disc_status==='deleted')return;
 const related={};
 for(const table of ['inventory','channel_inventory','stock_receipts','sales_log','channel_product_mapping'])related[table]=await api.queryAll(table,q=>q.eq('product_id',id));
 const backup={product:before,related,actor:user.name,at:new Date().toISOString(),action:'remove-from-inventory'},backupId='cherop_product_archive_'+crypto.randomUUID();
 await api.putRecord(backupId,backup);
 if(!equal(await api.getRecord(backupId),backup))throw Error('백업을 확인하지 못해 삭제를 중단했습니다.');
 let q=db.from('products').update({is_discontinued:true,disc_status:'deleted'}).eq('id',id);
 for(const [k,v] of Object.entries(before))if(k!=='id')q=v==null?q.is(k,null):q.eq(k,v);
 const saved=await q.select('id');if(saved.error)throw saved.error;if(!saved.data?.length)throw Error('다른 화면에서 상품을 수정했습니다. 다시 확인해주세요.');
 const verify=await db.from('products').select('disc_status').eq('id',id).single();if(verify.error)throw verify.error;if(verify.data?.disc_status!=='deleted')throw Error('삭제 결과를 확인하지 못했습니다. 새로고침 후 확인해주세요.');
 window.CHEROPStockSales?.invalidate();_appStateCache=null;
 return backupId;
}
deleteProduct=async function(){
 if(saving)return;const id=invProdEditId;if(!id){toast('삭제할 상품을 먼저 선택해주세요.');return;}
 saving=true;
 try{
  const ok=await customConfirm('이 상품을 재고 목록에서 삭제할까요?','상품과 재고 수량, 입고·출고 내역은 백업·보관되며 현재 재고 목록과 채널별 재고에서는 제외됩니다.');if(!ok)return;
  await archiveProduct(id);closeModal('inv-product-modal');await loadInvOverview();if(invCurrentTab==='channel')await loadChannelInv(invCurrentChannel);toast('재고 목록에서 삭제했습니다. 기존 기록은 보관했습니다.');
 }catch(error){toast(error.message||'삭제하지 못했습니다.',6000);}finally{saving=false;}
};
// Legacy quick-search is also used by incoming-stock and production dialogs.
let searchTicket=0;
invSearchProduct=async function(searchId,dropId,hiddenId,lblId){
 const ticket=++searchTicket,query=$(searchId).value.trim(),drop=$(dropId);
 drop.classList.remove('open');window._invSearchResults=[];if(!query)return;
 try{
  const products=await api.queryAll('products',q=>q.ilike('name',`%${query}%`));if(ticket!==searchTicket)return;
  window._invSearchResults=products.filter(p=>p.disc_status!=='deleted').map(p=>({id:p.id,label:p.name+(p.option_name?' '+p.option_name:''),display:p.name+(p.option_name?' · '+p.option_name:'')}));
  drop.innerHTML=window._invSearchResults.map((it,i)=>`<div class="inv-search-opt" onclick="invSelectProduct(${i},'${searchId}','${dropId}','${hiddenId}','${lblId}')">${escapeHtml(it.display)}</div>`).join('');
  drop.classList.toggle('open',window._invSearchResults.length>0);
 }catch(error){if(ticket===searchTicket)toast('상품 검색에 실패했습니다. 다시 검색해주세요.');}
};
window.CHEROPCatalog={archiveProduct};
})();
