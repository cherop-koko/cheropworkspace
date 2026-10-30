/* Durable production queue: status is independent of this browser/chat. */
(()=>{'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const host=document.createElement('div');host.id='page-production-engine';host.className='page';document.querySelector('.main').append(host);
const menu=document.querySelector('#ws-navigation nav'),link=document.createElement('a');link.className='ws-nav-link';link.href='#production-engine';link.dataset.wsPage='production-engine';link.textContent='제작실';menu.append(link);
const oldParse=parseHash;parseHash=function(){return location.hash==='#production-engine'?{page:'production-engine',sub:''}:oldParse();};
const oldRender=renderPage;renderPage=function(page,sub=''){oldRender(page,sub);if(page==='production-engine'){document.querySelector('.tb-nav').textContent='자동 제작실';load();}};
let timer=null,ticket=0;
const names={queued:'실행 대기',working:'제작 중',review:'검수 대기',blocked:'자료 확인 필요',failed:'실행 실패',cancelled:'취소',approved:'승인'};
async function load(){
 clearTimeout(timer);const t=++ticket;
 try{
 const r=await db.from('app_state').select('data,updated_at').eq('id','cherop_production_summary').maybeSingle();if(r.error)throw r.error;if(t!==ticket)return;
 const data=r.data?.data||{},jobs=data.jobs||[];
 host.innerHTML=`<div class="pe-wrap"><header><div><small>CHEROP PRODUCTION</small><h1>자동 제작실</h1><p>채팅을 바꿔도 요청·실행 기록·결과는 이어집니다.</p></div><button data-pe-refresh>새로고침</button></header><section class="pe-info"><strong>승인된 틀로 상세페이지 초안을 제작합니다.</strong><p>준비된 작업은 서버가 1분마다 확인합니다. 자료가 없으면 사유를 남기고, 초안은 검수 대기로 전환합니다.</p><p>이 채팅 또는 새 채팅에서 “제작실에 K번호 작업을 등록해 주세요”라고 요청하세요. 담당자가 자료를 대조하여 입력 파일을 등록하면 실행됩니다.</p><p>이미지 AI 생성·자동 상품 게시·휴대폰 푸시 알림은 아직 연결되지 않았습니다.</p></section><div class="pe-stats"><span>대기 <b>${jobs.filter(j=>j.status==='queued').length}</b></span><span>제작 중 <b>${jobs.filter(j=>j.status==='working').length}</b></span><span>검수 대기 <b>${jobs.filter(j=>j.status==='review').length}</b></span></div><p class="pe-muted">${data.estimate?`실행 기록 기준 약 ${esc(data.estimate.seconds)}초 / ${esc(data.estimate.samples)}건 · 대기·자료준비·검수 제외`:'예상시간 산정 중 · 충분한 실행 기록이 쌓이면 표시됩니다.'}</p><div class="pe-jobs">${jobs.map(j=>`<article><div><span class="pe-status">${esc(names[j.status]||j.status)}</span><small>${esc(j.product_key)}</small></div><h2>${esc(j.title)}</h2><p>${esc(j.stage)}</p>${j.error?`<p class="pe-error">${esc(j.error)}</p>`:''}<p class="pe-muted">작업번호 ${esc(j.id)}<br>등록 ${esc(j.created_at)}${j.finished_at?'<br>처리 '+esc(j.finished_at):''}</p>${j.output_path?'<p>결과 파일 보관 완료 · 채팅에서 작업번호로 결과를 요청해 주세요.</p>':''}</article>`).join('')||'<section class="pe-info">등록된 제작 요청이 없습니다.</section>'}</div><details class="pe-info"><summary>새 채팅에서 이어서 작업하는 방법</summary><p>“cheropworkspace 제작실의 production_jobs와 production-engine/README.md를 읽고, 해당 작업번호의 기록부터 확인한 뒤 이어서 진행해 주세요. 승인 기본틀과 인계서 기준을 지키고 중복 실행하지 마세요.”</p></details><p class="pe-muted">최종 상태 동기화 ${esc(r.data?.updated_at||'대기 중')} · 화면을 열어 두면 15초마다 갱신</p></div>`;
 }catch(e){host.innerHTML='<div class="pe-wrap"><p>제작 기록을 불러오지 못했습니다.</p><button data-pe-refresh>다시 시도</button></div>';}
 if(location.hash==='#production-engine')timer=setTimeout(load,15000);
}
host.addEventListener('click',e=>{if(e.target.closest('[data-pe-refresh]'))load();});
addEventListener('hashchange',()=>{if(location.hash!=='#production-engine'){clearTimeout(timer);ticket++;}});
})();
