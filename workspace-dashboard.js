/* Dashboard/navigation only. Existing page renderers and persistence remain intact. */
(() => {
  'use strict';
  const app = document.getElementById('app');
  app.classList.add('workspace-shell');
  document.querySelector('.tb-logo').innerHTML='<img class="ws-brand-logo" src="cherop-logo.png" alt="CHEROP">';
  const esc = value => escapeHtml(String(value ?? ''));
  const href = (page, sub='') => '#' + page + (sub ? '/' + encodeURIComponent(sub) : '');
  const link = (label,page,sub='',cls='ws-action') => `<a class="${cls}" href="${esc(href(page,sub))}">${esc(label)}</a>`;
  const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const dayDate = s => new Date(s+'T12:00:00Z');
  const iso = d => d.toISOString().slice(0,10);
  const week = {offset:0, selected:null};
  let dashboardData = null, generation = 0;
  const sidebar = document.querySelector('.sidebar');
  const nav = document.querySelector('.tb-nav');
  nav.replaceChildren();
  nav.classList.add('ws-breadcrumb');
  sidebar.id='ws-navigation';
  const entry = (label,page,sub='',admin=false) => `<a class="ws-nav-link${admin?' ws-admin':''}" href="${href(page,sub)}" data-ws-page="${page}" data-ws-sub="${esc(sub)}">${label}</a>`;
  const logo=document.querySelector('.tb-logo').innerHTML;
  sidebar.innerHTML = `<div class="ws-brand"><a class="ws-brand-home" href="#dashboard" aria-label="체로프 대시보드로 이동">${logo}</a><span>WORKSPACE</span></div><nav aria-label="워크스페이스 메뉴">
    ${entry('대시보드','dashboard')}${entry('업무·프로젝트','tasks')}
    ${entry('재고·물류','inventory')}${entry('상품화 관리','production')}${entry('판매분석','sales')}${entry('상품·라인업','lineup')}
    <span class="ws-nav-unlinked" aria-disabled="true">오프라인·팝업</span>
    <span class="ws-nav-unlinked" aria-disabled="true">업무 매뉴얼</span>
  </nav><div class="ws-nav-caption">관리</div><nav aria-label="관리 메뉴">
    ${entry('팀·공지','notice')}${entry('업무 캘린더','ops','calendar')}${entry('목표·예산','plan','',true)}${entry('경영·정산','tax','',true)}
  </nav>`;
  const contextBar=document.createElement('nav');contextBar.className='ws-context-links';
  contextBar.setAttribute('aria-label','현재 카테고리 화면');contextBar.hidden=true;
  const main=document.querySelector('.main');main.insertBefore(contextBar,main.firstChild);
  const labels={dashboard:'대시보드',tasks:'업무·프로젝트 / 처리할 업무',project:'업무·프로젝트 / 프로젝트',inventory:'재고·물류',production:'상품화 관리',sales:'판매분석',lineup:'상품·라인업',notice:'팀·공지 / 공지',attendance:'팀·공지 / 출퇴근·연차',plan:'목표·예산',tax:'경영·정산',content:'기존 메뉴 / 콘텐츠',assets:'기존 메뉴 / 브랜드 자산·자료 링크',ops:'업무 캘린더',revenue:'기존 매출 화면'};
  function syncNavigation(page,sub='') {
    sidebar.querySelectorAll('.ws-admin').forEach(el=>{el.hidden=!user?.admin;});
    sidebar.querySelectorAll('[data-ws-page]').forEach(el=>{
      const menuPage=page==='project'?'tasks':page==='attendance'?'notice':page;
      const on=el.dataset.wsPage===menuPage && (page!=='ops' || sub!=='order');
      if(on)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
    });
    nav.textContent=page==='ops'&&sub==='order'?'기존 메뉴 / 발주 관리':labels[page]||page;
    const links=['tasks','project'].includes(page)?[['처리할 업무','tasks'],['프로젝트','project']]:['notice','attendance'].includes(page)?[['공지','notice'],['출퇴근·연차','attendance']]:[];
    contextBar.hidden=!links.length;
    contextBar.innerHTML=links.map(([label,key])=>`<a href="${href(key)}" ${page===key?'aria-current="page"':''}>${label}</a>`).join('');
  }
  // Adapter for URL selection only: all existing page init/render functions remain unchanged.
  const originalRenderPage=renderPage;
  renderPage=function(page,sub='') {
    if((page==='plan'||page==='tax'||page==='revenue')&&!user?.admin){toast('접근 권한이 없어요');return;}
    if(page==='project')selectedProjId=sub||null;
    if(page==='notice')selectedNotice=sub||null;
    originalRenderPage(page,sub);
    syncNavigation(page,sub);
  };
  const originalOpsInit=initOpsPage;
  initOpsPage=async function() {
    const expected=location.hash;
    await originalOpsInit();
    if(location.hash!==expected)return;
    const {page,sub}=parseHash();if(page!=='ops')return;
    if(sub==='order')opsSetTab('order',document.querySelectorAll('#ops-tabs .page-tab')[1]);
    if(sub.startsWith('date:')){
      const ds=sub.slice(5);if(!/^\d{4}-\d{2}-\d{2}$/.test(ds))return;
      const n=dayDate(today()),d=dayDate(ds);
      opsCalOffset=(d.getUTCFullYear()-n.getUTCFullYear())*12+d.getUTCMonth()-n.getUTCMonth();
      await loadOpsCal();if(location.hash===expected)await opsSelectDay(ds);
    }
  };
  // Native tabs also update their individual URLs, preserving the selected tab on refresh.
  document.getElementById('ops-tabs').addEventListener('click',e=>{
    const tab=e.target.closest('.page-tab');if(!tab)return;
    const sub=Array.from(document.querySelectorAll('#ops-tabs .page-tab')).indexOf(tab)===1?'order':'calendar';
    history.replaceState(null,'',href('ops',sub));sessionStorage.setItem('cherop_last_hash',location.hash);syncNavigation('ops',sub);
  });
  refreshCurrentPage=async function(){
    _appStateCache=null;_appStateCacheAt=0;
    const {page,sub}=parseHash();renderPage(page,sub);markRefreshed();
  };
  const host=document.getElementById('page-dashboard');
  const legacy=document.createElement('div');legacy.hidden=true;legacy.id='ws-dashboard-legacy';
  while(host.firstChild)legacy.appendChild(host.firstChild);
  host.appendChild(legacy);
  const view=document.createElement('div');view.id='ws-dashboard';host.appendChild(view);
  function dates(){const d=dayDate(today());d.setUTCDate(d.getUTCDate()-d.getUTCDay()+week.offset*7);return Array.from({length:7},(_,i)=>{const x=new Date(d);x.setUTCDate(x.getUTCDate()+i);return iso(x);});}
  const empty=t=>`<p class="ws-empty">${esc(t)}</p>`;
  const section=(title,body,page,sub='')=>`<section class="ws-section"><header class="ws-section-head"><h2>${title}</h2>${link('전체 보기',page,sub)}</header>${body}</section>`;
  const states={todo:'시작 전',ing:'진행 중',hold:'보류',done:'완료'};
  function calendar(state,leaves){
    const ds=dates(),allowed=['cat-incoming','cat-open','cat-meeting','cat-popup'];
    const events=(state.ops_events||[]).filter(e=>allowed.includes(e.cat)&&e.status!=='cancelled'&&e.startDate).map(e=>({start:e.startDate,end:e.endDate||e.startDate,title:e.title,type:opsCatOf(e.cat).name,page:'ops',sub:'date:'+e.startDate}));
    for(const l of leaves)events.push({start:l.start_date,end:l.end_date||l.start_date,title:l.member+' · '+({annual:'연차',half_am:'오전반차',half_pm:'오후반차'}[l.type]||l.type),type:'휴가·반차',page:'attendance',sub:''});
    const visible=events.filter(e=>e.start<=ds[6]&&e.end>=ds[0]).sort((a,b)=>a.start.localeCompare(b.start));
    const selected=week.selected?visible.filter(e=>e.start<=week.selected&&e.end>=week.selected):visible;
    return `<section class="ws-week"><header class="ws-week-head"><div><h2>주간 캘린더</h2><span>${ds[0].slice(0,4)}년 · ${ds[0].slice(5).replace('-','.')} — ${ds[6].slice(5).replace('-','.')}</span></div><div class="ws-week-actions"><button type="button" data-week="prev" aria-label="지난주">‹</button><button type="button" data-week="next" aria-label="다음주">›</button><button type="button" data-week="today">이번 주</button>${link('전체 일정','ops','calendar')}</div></header>
      <div class="ws-week-days">${ds.map((d,i)=>`<button type="button" data-week="day" data-date="${d}" aria-pressed="${week.selected===d}" class="${d===today()?'is-today':''}"><span>${['일','월','화','수','목','금','토'][i]}</span><strong>${+d.slice(8)}</strong><i class="${visible.some(e=>e.start<=d&&e.end>=d)?'has-event':''}" aria-hidden="true"></i></button>`).join('')}</div>
      ${week.selected?`<div class="ws-day-label">${esc(week.selected)}<button type="button" data-week="clear">주간 전체</button></div>`:''}
      <div>${selected.slice(0,4).map(e=>`<a class="ws-agenda" href="${esc(href(e.page,e.sub))}"><span>${e.start.slice(5).replace('-','.')}${e.end!==e.start?' — '+e.end.slice(5).replace('-','.'):''}</span><strong>${esc(e.title)}</strong><small>${esc(e.type)}</small></a>`).join('')||empty('등록된 일정이 없습니다.')}${selected.length>4?link(`일정 ${selected.length-4}건 더 보기`,'ops','calendar'):''}</div>
    </section>`;
  }
  function renderDashboard(){
    if(!dashboardData)return;
    const {state,tasks,leaves,errors}=dashboardData;
    const who=user?.name, combined=[...tasks.map(t=>({...t,source:'task'})),...(state.proj_tasks||[]).map(t=>({...t,source:'project'}))], pending=combined.filter(t=>t.status!=='done'&&(user?.admin||t.assignee===who)).sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999'));
    const pts=state.proj_tasks||[];
    const projects=(state.projects||[]).filter(p=>p.status!=='done'&&(user?.admin||pts.some(t=>t.proj_id===p.id&&t.assignee===who)));
    const taskRows=pending.slice(0,5).map(t=>`<a class="ws-task" href="${esc(href(t.source==='project'?'project':'tasks',t.source==='project'?t.proj_id:(t.assignee||who)))}"><span><strong>${esc(t.title)}</strong><small>${esc(t.assignee||'담당자 미지정')}${t.due_date?' · '+esc(t.due_date.slice(5).replace('-','.')):''}</small></span><span class="ws-status">${t.due_date&&t.due_date<today()?'기한 지남':esc(states[t.status]||t.status||'시작 전')}</span></a>`).join('')||empty('미완료 업무가 없습니다.');
    const projectRows=projects.slice(0,3).map(p=>{const items=pts.filter(t=>t.proj_id===p.id),done=items.filter(t=>t.status==='done').length;return `<a class="ws-task" href="${esc(href('project',p.id))}"><span><strong>${esc(p.title)}</strong><small>${p.end_date?esc(p.end_date.slice(5).replace('-','.'))+' 마감':'마감일 미지정'}</small></span><span class="ws-status">${done}/${items.length}</span></a>`;}).join('')||empty('진행 프로젝트가 없습니다.');
    const notices=[...(state.notices||[])].filter(n=>!n.archived).sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,2);
    const noticeRows=notices.map(n=>`<a class="ws-notice" href="${esc(href('notice',n.id))}"><small>${esc(n.category||'공지')}</small><strong>${esc(n.title)}</strong><span>${esc(n.date||'')}</span></a>`).join('')||empty('등록된 공지가 없습니다.');
    const popups=[...(state.ops_events||[])].filter(e=>e.cat==='cat-popup'&&e.status!=='cancelled').sort((a,b)=>(b.startDate||'').localeCompare(a.startDate||''));
    const popupRows=popups.slice(0,3).map(p=>`<div class="ws-popup"><div><strong>${esc(p.title)}</strong><small>${esc(p.startDate||'')} — ${esc(p.endDate||p.startDate||'')}</small></div><span>${(p.endDate||p.startDate)&& (p.endDate||p.startDate)<today()?'종료':p.startDate>today()?'예정':'진행 중'}</span>${link('상세 보기','ops','date:'+p.startDate)}</div>`).join('')||empty('운영 캘린더에 등록된 팝업 일정이 없습니다.');
    view.innerHTML=`<header class="ws-dashboard-head"><h1>대시보드</h1><span>${today().replaceAll('-','.')}</span></header><div id="ws-attendance" class="ws-attendance" aria-live="polite"></div>${errors.length?`<p class="ws-error" role="alert">${esc(errors.join(' / '))} · 새로고침해 다시 확인해주세요.</p>`:''}${calendar(state,leaves)}<div class="ws-work-grid">${section('처리할 업무',errors.includes('업무 조회 실패')?empty('업무를 불러오지 못했습니다.'):taskRows,'tasks')}${section('진행 프로젝트',errors.includes('운영 데이터 조회 실패')?empty('프로젝트를 불러오지 못했습니다.'):projectRows,'project')}</div>${section('공지',errors.includes('운영 데이터 조회 실패')?empty('공지를 불러오지 못했습니다.'):noticeRows,'notice')}${section('오프라인·팝업 현황',errors.includes('운영 데이터 조회 실패')?empty('팝업 일정을 불러오지 못했습니다.'):popupRows,'ops','calendar')}`;
    globalThis.CHEROPAttendance?.render();
  }
  // Read-only, paginated queries. Never seed data or call any existing save function.
  async function rows(table,filter){let all=[];for(let from=0;;from+=500){let q=db.from(table).select('*');if(filter)q=filter(q);const r=await q.order('id',{ascending:true}).range(from,from+499);if(r.error)throw r.error;all.push(...(r.data||[]));if((r.data||[]).length<500)return all;}}
  loadDashboard=async function(){
    const ticket=++generation;
    view.innerHTML='<p class="ws-empty" role="status">불러오는 중…</p>';
    const result=await Promise.allSettled([getAppState(),rows('tasks'),rows('leaves',q=>q.eq('status','approved'))]);
    if(ticket!==generation)return;
    const errors=[];['운영 데이터 조회 실패','업무 조회 실패','휴가 조회 실패'].forEach((e,i)=>{if(result[i].status==='rejected'){errors.push(e);console.error(e,result[i].reason);}});
    dashboardData={state:result[0].status==='fulfilled'?result[0].value:{},tasks:result[1].status==='fulfilled'?result[1].value:[],leaves:result[2].status==='fulfilled'?result[2].value:[],errors};renderDashboard();
  };
  view.addEventListener('click',e=>{
    const b=e.target.closest('[data-week]');if(!b)return;
    const action=b.dataset.week;
    if(action==='prev')week.offset--;if(action==='next')week.offset++;if(action==='today')week.offset=0;
    if(action==='day')week.selected=week.selected===b.dataset.date?null:b.dataset.date;else week.selected=null;
    renderDashboard();
  });
})();
