/* Finish deferred initialization after all adapters are available. */
(async()=>{
try {
  if(!window.CHEROPProduction||!window.CHEROPSections||!window.CHEROPAttendance||!window.CHEROPTasks || !window.CHEROPManagement)throw Error('화면 파일을 불러오지 못했습니다.');
  cleanupBrokenRoutineKeys();
  await boot();
  document.documentElement.classList.remove('ws-resuming');
  document.getElementById('ws-startup')?.remove();
} catch (error) {
  console.error(error);
  const status=document.getElementById('ws-startup-status');
  if(status)status.innerHTML='화면을 불러오지 못했습니다.'+' <button type="button" onclick="location.reload()">다시 시도</button>';
}
})();
// Spreadsheet imports wait for the deferred parser without blocking navigation.
function workspaceSpreadsheetReady(){
 if(window.XLSX)return Promise.resolve();
 return new Promise((resolve,reject)=>{const script=document.querySelector('script[src*="vendor/xlsx-"]');if(!script){reject(Error('엑셀 기능을 불러오지 못했습니다. 새로고침해주세요.'));return;}let timer;const done=()=>{clearTimeout(timer);script.removeEventListener('load',loaded);script.removeEventListener('error',failed);};const loaded=()=>{done();window.XLSX?resolve():reject(Error('엑셀 기능을 불러오지 못했습니다.'));};const failed=()=>{done();reject(Error('엑셀 기능을 불러오지 못했습니다. 새로고침해주세요.'));};script.addEventListener('load',loaded,{once:true});script.addEventListener('error',failed,{once:true});timer=setTimeout(failed,20000);});
}
for(const name of ['parseImportFile','exportInvExcel','handleInvUpload','cardUsageImportXlsx','handleLedgerXlsx']){const original=window[name];if(typeof original==='function')window[name]=async function(...args){try{if(!window.XLSX)toast('엑셀 기능을 불러오는 중입니다.');await workspaceSpreadsheetReady();return await original.apply(this,args);}catch(error){toast(error.message);}};

}
