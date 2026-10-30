/* Production is a tab inside AI team. Reuse its typography, controls and spacing. */
(()=>{'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const host=document.getElementById('page-ai-team');
const oldParse=parseHash;parseHash=function(){if(location.hash==='#production-engine'){history.replaceState(null,'','#ai-team/production');return {page:'ai-team',sub:'production'};}return oldParse();};
let timer=null,ticket=0,filter='active',data={},previews={},updated='';
const active=()=>location.hash==='#ai-team/production';
const names={queued:'실행 대기',working:'제작 중',review:'검수 대기',blocked:'자료 확인 필요',failed:'실행 실패',cancelled:'취소',approved:'승인'};
const time=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'—';
function safeLink(value){try{const u=new URL(value);return u.protocol==='https:'&&((u.hostname==='chatgpt.com'&&u.pathname==='/library')||u.hostname==='cherop-production-preview.yehuingo.chatgpt.site')?esc(u.href):'';}catch{return '';}}
function paint(error=''){
 if(!active())return;
 const jobs=data.jobs||[],shown=jobs.filter(j=>filter==='all'||!['cancelled','approved'].includes(j.status));
 const rows=shown.map(j=>{const p=previews[j.id]||{},preview=safeLink(p.previewURL),download=safeLink(p.downloadURL);return `<tr><td data-label="작업"><span class="pe-product">${esc(j.product_key)}</span><strong>${esc(j.title)}</strong><details class="pe-job-info"><summary>작업 정보</summary><span>${esc(j.id)}</span><p>${esc(j.stage)}</p></details></td><td data-label="상태"><span class="ai-chip pe-state-${esc(j.status)}">${esc(names[j.status]||j.status)}</span>${j.error?`<p class="ai-error">${esc(j.error)}</p>`:''}</td><td data-label="등록">${esc(time(j.created_at))}</td><td data-label="처리">${esc(time(j.finished_at))}</td><td data-label="결과"><div class="pe-actions">${preview?`<a class="pe-preview" href="${preview}" target="_blank" rel="noopener">미리보기</a>`:j.output_path?'<span class="pe-muted">미리보기 준비 중</span>':'<span class="pe-muted">—</span>'}${download?`<a href="${download}" target="_blank" rel="noopener">파일 받기</a>`:''}</div></td></tr>`;}).join('');
 host.innerHTML=`<div class="ai-team pe-team"><header class="ai-heading"><div><h1>AI 운영본부</h1><p>대표님의 지시부터 담당 배정, 검수와 결과 보고까지 한곳에서 확인합니다.</p></div><button data-pe-refresh>기록 새로고침</button></header><nav class="ai-work-tabs" aria-label="AI 조직도 메뉴"><a href="#ai-team">조직도</a><a href="#ai-team/production" aria-current="page">제작실</a></nav><div class="ai-notice">승인된 기본틀과 준비된 자료로 제작합니다. 결과는 검수 후 확정합니다.</div>${error?`<p class="ai-error" role="alert">${esc(error)}</p>`:''}<div class="ai-summary">${[['실행 대기','queued'],['제작 중','working'],['검수 대기','review']].map(([title,status])=>`<div><small>${title}</small><strong>${jobs.filter(j=>j.status===status).length}건</strong><span>${status==='queued'?'준비된 작업부터 순서대로 실행':status==='working'?'서버에서 처리 중인 작업':'결과 확인이 필요한 작업'}</span></div>`).join('')}</div><div class="ai-section-title"><h2>제작 작업</h2><span>${data.estimate?`처리시간 평균 약 ${esc(data.estimate.seconds)}초 · ${esc(data.estimate.samples)}건 기준`:'예상시간 · 실행 기록 수집 중'}</span></div><div class="ai-filters" aria-label="제작 상태 필터"><button data-pe-filter="active" aria-pressed="${filter==='active'}">진행·검수</button><button data-pe-filter="all" aria-pressed="${filter==='all'}">전체 기록</button></div><div class="pe-table-wrap"><table class="pe-table"><thead><tr><th>작업</th><th>상태</th><th>등록</th><th>처리</th><th>결과</th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="ai-empty">해당하는 제작 작업이 없습니다.</td></tr>'}</tbody></table></div><details class="pe-guide"><summary>제작 요청·이어서 작업하기</summary><p>채팅에서 “제작실의 K번호 작업을 이어서 진행해 주세요”라고 요청해 주세요. 작업 기준과 진행 기록을 확인해 이어서 처리합니다.</p><p>자료가 준비된 요청은 서버가 1분마다 확인합니다. 현재 범위는 승인 틀 조립이며, 새 이미지 생성·자동 상품 게시·휴대폰 푸시는 연결 전입니다.</p></details><footer class="ai-footer">최근 갱신 ${esc(time(updated))} (한국시간) · 15초마다 상태 갱신</footer></div>`;
}
async function load(){
 clearTimeout(timer);const t=++ticket;paint();
 try{
 const [r,p]=await Promise.all([db.from('app_state').select('data,updated_at').eq('id','cherop_production_summary').maybeSingle(),db.from('app_state').select('data').eq('id','cherop_production_previews').maybeSingle()]);
 if(r.error)throw r.error;if(t!==ticket||!active())return;
 data=r.data?.data||{};updated=r.data?.updated_at||'';previews=p.data?.data?.jobs||{};paint(p.error?'미리보기 링크를 불러오지 못했습니다. 새로고침해 주세요.':'');
 }catch(e){if(t===ticket&&active())paint('제작 기록을 불러오지 못했습니다. 다시 시도해 주세요.');}
 if(active())timer=setTimeout(load,15000);
}
host.addEventListener('click',e=>{if(e.target.closest('[data-pe-refresh]'))load();const f=e.target.closest('[data-pe-filter]');if(f){filter=f.dataset.peFilter;paint();}});
addEventListener('hashchange',()=>{if(!active()){clearTimeout(timer);ticket++;}});
window.CHEROPProductionEngine={load};
})();
