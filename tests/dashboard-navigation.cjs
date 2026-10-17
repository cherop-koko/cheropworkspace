const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),cp=require('child_process');
const source=fs.readFileSync('workspace-dashboard.js','utf8');
const nodes=new Map();
function makeNode(){const classes=new Set();return {id:'',dataset:{},hidden:false,attrs:{},html:'',textContent:'',listeners:{},children:[],classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),toggle(x){if(classes.has(x)){classes.delete(x);return false;}classes.add(x);return true;}},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},addEventListener(k,f){this.listeners[k]=f},replaceChildren(){this.children=[]},insertBefore(){},appendChild(n){this.children.push(n);if(n.id)nodes.set(n.id,n);return n},get firstChild(){return null},set innerHTML(s){this.html=s;if(this.id==='ws-navigation'){this.menu=[...s.matchAll(/<a class="([^"]+)" href="([^"]+)" data-ws-page="([^"]+)" data-ws-sub="([^"]*)"/g)].map(m=>{const n=makeNode();n.dataset={wsPage:m[3],wsSub:m[4]};n.admin=m[1].includes('ws-admin');return n});}},get innerHTML(){return this.html},closest(){return null},querySelectorAll(s){return (this.menu||[]).filter(n=>s==='.ws-admin'?n.admin:true)}};}
for(const key of ['app','page-dashboard','ops-tabs','.sidebar','.tb-nav','.tb-logo','.topbar','.tb-div','.main'])nodes.set(key,makeNode());
const tabs=[makeNode(),makeNode()],calls=[],writes=[];
const state={projects:[{id:'p1',title:'실제 프로젝트',status:'ing',end_date:'2026-10-23'}],proj_tasks:[{id:'pt1',proj_id:'p1',assignee:'정현진',status:'todo'}],notices:[{id:'n1',title:'실제 공지',date:'2026-10-17'}],ops_events:[{id:'e1',cat:'cat-popup',title:'연속 팝업',startDate:'2026-10-10',endDate:'2026-10-22'},{id:'e2',cat:'cat-meeting',title:'미팅',startDate:'2026-10-12'},{id:'e3',cat:'cat-general',title:'일반 일정 숨김',startDate:'2026-10-12'}]};
const taskData=Array.from({length:501},(_,i)=>({id:i,title:'업무 '+i,assignee:i===0?'정현진':'김성애',status:'todo',due_date:'2026-10-20'}));
const ctx={document:{getElementById:k=>nodes.get(k),querySelector:k=>nodes.get(k),querySelectorAll:k=>k==='#ops-tabs .page-tab'?tabs:[] ,createElement:()=>makeNode()},console,Intl,Date,sessionStorage:{setItem(){}},location:{hash:'#dashboard'},history:{replaceState(a,b,h){ctx.location.hash=h}},user:{name:'고예흰',admin:true},escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),getAppState:async()=>structuredClone(state),opsCatOf:cat=>({name:{'cat-popup':'팝업','cat-meeting':'미팅'}[cat]||cat}),renderPage:(...a)=>calls.push(['render',...a]),initOpsPage:async()=>calls.push(['ops']),refreshCurrentPage(){},parseHash:()=>{const [page,sub='']=ctx.location.hash.slice(1).split('/');return {page,sub:decodeURIComponent(sub)}},opsSetTab:t=>calls.push(['tab',t]),loadOpsCal:async()=>calls.push(['cal']),opsSelectDay:async d=>calls.push(['day',d]),markRefreshed(){},toast:s=>calls.push(['toast',s]),selectedProjId:null,selectedNotice:null,opsCalOffset:0,_appStateCache:null,_appStateCacheAt:0,loadDashboard:null,db:{from(table){let filters=[];return {select(){return this},eq(k,v){filters.push([k,v]);return this},order(){return this},range(a,b){calls.push(['read',table,a,b]);const rows=table==='tasks'?taskData:[{id:'l1',member:'정현진',type:'half_am',status:'approved',start_date:'2026-10-12',end_date:'2026-10-12'}];return Promise.resolve({data:rows.filter(r=>filters.every(([k,v])=>r[k]===v)).slice(a,b+1)})},insert(){writes.push('insert');throw Error('write')},update(){writes.push('update');throw Error('write')},upsert(){writes.push('upsert');throw Error('write')},delete(){writes.push('delete');throw Error('write')}}}}};
vm.createContext(ctx);vm.runInContext(source,ctx);
const menuHtml=nodes.get('.sidebar').innerHTML;
let cursor=-1;for(const label of ['대시보드','업무·프로젝트','재고·물류','상품화 관리','판매분석','상품·라인업','오프라인·팝업','업무 매뉴얼','팀·공지','업무 캘린더','목표·예산','경영·정산']){const next=menuHtml.indexOf('>'+label+'<',cursor+1);assert(next>cursor,label);cursor=next;}
assert(!menuHtml.includes('기존 메뉴'));assert(!menuHtml.includes('처리할 업무'));assert(!menuHtml.includes('출퇴근·연차'));assert(menuHtml.includes('WORKSPACE'));

(async()=>{
 await ctx.loadDashboard();const view=nodes.get('ws-dashboard');let html=view.innerHTML;
 const labels=['주간 캘린더','처리할 업무','진행 프로젝트','공지','오프라인·팝업 현황'];let last=-1;for(const label of labels){const at=html.indexOf('<h2>'+label+'</h2>');assert(at>last,label);last=at;}
 assert.equal((html.match(/data-week="day"/g)||[]).length,7);
 assert(html.includes('실제 프로젝트'));assert(html.includes('实际')===false);assert(!html.includes('일반 일정 숨김'));
 assert(calls.some(c=>c[0]==='read'&&c[1]==='tasks'&&c[2]===500),'pagination');
 assert(html.includes('#project/p1'));assert(html.includes('#notice/n1'));assert(html.includes('#ops/date%3A2026-10-10'));
 function click(action,date){view.listeners.click({target:{closest:()=>({dataset:{week:action,date}})}})}
 click('day','2026-10-12');assert(view.innerHTML.includes('ws-day-label'));assert(view.innerHTML.includes('오전반차'));
 click('next');assert(!view.innerHTML.includes('ws-day-label'));click('today');
 ctx.user={name:'정현진',admin:false};ctx.renderPage('dashboard');await ctx.loadDashboard();
 assert(view.innerHTML.includes('업무 0'));assert(!view.innerHTML.includes('업무 1<'));
 assert(nodes.get('.sidebar').menu.filter(n=>n.admin).every(n=>n.hidden));
 const before=calls.length;ctx.renderPage('tax');assert.equal(calls.at(-1)[0],'toast');assert.equal(calls.length,before+1);
 ctx.user={name:'고예흰',admin:true};ctx.location.hash='#project/p1';ctx.renderPage('project','p1');assert.equal(ctx.selectedProjId,'p1');
 ctx.location.hash='#notice/n1';ctx.renderPage('notice','n1');assert.equal(ctx.selectedNotice,'n1');
 ctx.location.hash='#ops/order';await ctx.initOpsPage();assert(calls.some(c=>c[0]==='tab'&&c[1]==='order'));
 ctx.location.hash='#ops/date%3A2026-12-03';await ctx.initOpsPage();assert(calls.some(c=>c[0]==='day'&&c[1]==='2026-12-03'));
 await ctx.refreshCurrentPage();assert.deepEqual(calls.filter(c=>c[0]==='render').at(-1),['render','ops','date:2026-12-03']);
 assert.equal(writes.length,0);
 const baseline=cp.execFileSync('git',['show','5a825fff5b34accad17c47ed44e65a54374fc287:index.html'],{encoding:'utf8',maxBuffer:4e6});
 let edited=fs.readFileSync('index.html','utf8').replace(/^.*(?:workspace-sections\.(?:js|css)|workspace-popup\.(?:js|css)|workspace-manual-seed\.js|workspace-polish\.css).*\n/gm,'');edited=edited.replace('<link rel="stylesheet" href="workspace-dashboard.css?v=20261017-1">\n','').replace('</script>\n<script src="workspace-dashboard.js?v=20261017-1"></script>\n<script>\n','');assert.equal(edited,baseline,'every byte of original pages and persistence code preserved');
 assert(!/\.(insert|update|upsert|delete)\s*\(/.test(source));
 console.log('PASS: 5 sections, 7 dates, calendar interactions, half-day leave, paginated reads, employee filtering, admin menu/route checks, deep links and refresh; original index preserved byte-for-byte apart from two load hooks; no new database writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
