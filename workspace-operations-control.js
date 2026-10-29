/* Read-only operating overview. No writes, account changes or background work. */
(() => {
'use strict';
const roles=Object.freeze(['시스템·데이터','재무·성과','재고·발주·물류','상품·채널MD','마케팅·인스타','프로젝트·인력','품질·고객경험']);
const statusNames={todo:'시작 전',ing:'진행 중',review:'확인 요청',hold:'보류',done:'완료'};
const esc=v=>escapeHtml(String(v??''));
const text=v=>typeof v==='string'?v:'';
const key=t=>t.source+':'+t.id;
// Optional metadata contract, deliberately separate from the human assignee.
// state.task_meta['task:ID'|'project:ID'].ai_control =
// { role, next_action, evidence, dependency_ids: ['task:ID'], last_reviewed_at }.
// A future authenticated writer must preserve all other task/meta fields.
function records(rows,state){
 const map=new Map(rows.map(t=>[key(t),t]));
 return rows.map(t=>{
  const value=state.task_meta?.[key(t)]?.ai_control;
  const meta=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const ids=Array.isArray(meta.dependency_ids)?[...new Set(meta.dependency_ids.filter(x=>typeof x==='string'&&x))]:[];
  const dependencies=ids.map(id=>({id,task:map.get(id)}));
  return {...t,control:{role:text(meta.role),next_action:text(meta.next_action),evidence:text(meta.evidence),last_reviewed_at:text(meta.last_reviewed_at)},dependencies,blocked:dependencies.some(d=>!d.task||d.task.status!=='done')};
 });
}
function reviewed(v){
 if(!v)return '검수 기록 없음';
 // Require an explicit timezone: never invent a timezone for ambiguous values.
 if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v))return '검수 시각 형식 확인 필요';
 const d=new Date(v);return Number.isNaN(d.getTime())?'검수 시각 형식 확인 필요':new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d);
}
function render({rows,projects,state,filters,asOf}){
 const all=records(rows,state),active=all.filter(t=>t.status!=='done');
 const role=filters.opsRole||'all',mode=filters.opsMode||'active',query=text(filters.query).trim().toLowerCase();
 const filtered=all.filter(t=>(role==='all'||(role==='unassigned'?!t.control.role:t.control.role===role))&&(!query||[t.title,t.assignee,t.control.role,t.control.next_action,t.control.evidence,key(t)].join(' ').toLowerCase().includes(query))&&(mode==='all'||mode==='blocked'?(mode==='all'||t.status!=='done'&&t.blocked):mode==='review'?t.status==='review':mode==='evidence'?t.status==='done'&&!t.control.evidence:t.status!=='done')).sort((a,b)=>Number(b.blocked)-Number(a.blocked)||(a.due_date||'9999').localeCompare(b.due_date||'9999')||key(a).localeCompare(key(b)));
 const option=(value,label,current)=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`;
 const counts=[['미완료',active.length],['선행 업무 대기',active.filter(t=>t.blocked).length],['AI 담당 미지정',active.filter(t=>!t.control.role).length],['완료 증거 미등록',all.filter(t=>t.status==='done'&&!t.control.evidence).length]];
 return `<section class="oc-view" aria-label="AI 총괄 조회"><p class="oc-intro">기존 업무의 담당·다음 행동·근거를 함께 확인합니다. AI 담당 정보는 아직 편집할 수 없으며, 이 화면은 업무를 자동 실행하거나 상태를 변경하지 않습니다.</p><div class="oc-summary">${counts.map(([label,n])=>`<div><span>${label}</span><strong>${n}<small>건</small></strong></div>`).join('')}</div><div class="oc-filters"><label>AI 담당<select data-w6-filter="opsRole" aria-label="AI 담당 역할">${option('all','전체 역할',role)}${option('unassigned','미지정',role)}${roles.map(r=>option(r,r,role)).join('')}</select></label><label>표시<select data-w6-filter="opsMode" aria-label="총괄 업무 상태">${[['active','미완료'],['all','전체'],['blocked','선행 업무 대기'],['review','확인 요청'],['evidence','완료 증거 미등록']].map(([v,l])=>option(v,l,mode)).join('')}</select></label><form data-w6-search><label for="oc-query">업무·담당·다음 행동 검색</label><div><input id="oc-query" name="query" type="search" value="${esc(filters.query||'')}" placeholder="업무명 또는 ID"><button type="submit" class="hp-action">검색</button></div></form></div><p class="oc-count">${filtered.length}건 표시 · 집계 기준 ${esc(asOf)} · 상태와 근거는 원장 기록 기준입니다.</p><div class="oc-table-wrap"><table class="oc-table"><thead><tr><th>업무 · 담당</th><th>다음 행동 · 완료 증거</th><th>선행 업무 · 검수</th></tr></thead><tbody>${filtered.map(t=>{
  const p=projects.find(p=>p.id===t.proj_id),late=t.status!=='done'&&t.due_date&&t.due_date<asOf;
  return `<tr><td><button type="button" class="oc-title" data-w6="task-edit" data-id="${esc(key(t))}">${esc(t.title||'제목 없음')}</button><span class="oc-id">${esc(key(t))}</span><div class="oc-tags"><span>${esc(statusNames[t.status]||t.status||'상태 미등록')}</span>${late?'<span class="oc-alert">기한 지남</span>':''}${t.blocked&&t.status!=='done'?'<span class="oc-alert">선행 업무 대기</span>':''}</div><dl><dt>실행 담당</dt><dd>${esc(t.assignee||'미지정')}</dd><dt>AI 담당</dt><dd>${esc(t.control.role||'미지정')}${t.control.role&&!roles.includes(t.control.role)?' · 역할 확인 필요':''}</dd><dt>프로젝트</dt><dd>${esc(p?.title||'일반 업무')}</dd><dt>마감</dt><dd>${esc(t.due_date||'미정')}</dd></dl></td><td><span class="oc-label">다음 행동</span><p>${esc(t.control.next_action||'미등록')}</p><span class="oc-label">완료 증거</span><p>${esc(t.control.evidence||'미등록')}</p>${t.status==='done'&&!t.control.evidence?'<small class="oc-muted">완료 표시는 유지되며, 증거는 별도 확인이 필요합니다.</small>':''}</td><td><span class="oc-label">선행 업무</span>${t.dependencies.length?'<ul class="oc-dependencies">'+t.dependencies.map(d=>`<li>${d.task?`<button type="button" class="oc-link" data-w6="task-edit" data-id="${esc(d.id)}">${esc(d.task.title||d.id)}</button><small>${esc(statusNames[d.task.status]||d.task.status||'상태 미등록')}</small>`:`<span class="oc-alert">참조 확인 필요: ${esc(d.id)}</span>`}</li>`).join('')+'</ul>':'<p>등록 없음</p>'}<span class="oc-label">마지막 검수 · 한국시간</span><p>${esc(reviewed(t.control.last_reviewed_at))}</p></td></tr>`;
 }).join('')||'<tr><td colspan="3" class="oc-empty">표시할 업무가 없습니다.</td></tr>'}</tbody></table></div><p class="oc-footnote">AI 담당은 실제 직원 계정과 별개입니다. 업무명을 누르면 기존 업무 편집 창이 열립니다. 근거 미등록은 검수 미완료와 같은 뜻이 아니며, 별도 확인 대상으로 표시합니다.</p></section>`;
}
window.CHEROPOperationsControl=Object.freeze({roles,records,render});
})();
