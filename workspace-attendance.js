/* Dashboard clock actions use the existing attendance rows. Nothing writes on load. */
(() => {
  'use strict';
  const day = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const clock = () => new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  const esc = s => escapeHtml(String(s ?? ''));
  let row=null, member='', date='', loading=true, busy=false, error='', request=0;
  function render() {
    const hosts=document.querySelectorAll('#ws-attendance,[data-ws-attendance]');if(!hosts.length)return;
    const fresh=member===user?.name&&date===day();
    const ready=fresh&&!loading&&!error;
    const entered=ready&&row?.clock_in, left=ready&&row?.clock_out;
    const status=error||(!ready?'출퇴근 기록 확인 중…':left?'퇴근 완료':entered?'근무 중':'출근 전');
    for(const host of hosts)host.innerHTML=`<span class="ws-attendance-status" ${error?'role="alert"':''}>${esc(status)}</span><div class="ws-attendance-actions"><button type="button" class="ws-action" data-ws-clock="in" ${!ready||busy||entered||left?'disabled':''}>출근${entered?` <time>${esc(row.clock_in.slice(0,5))}</time>`:''}</button><button type="button" class="ws-action" data-ws-clock="out" ${!ready||busy||!entered||left?'disabled':''}>퇴근${left?` <time>${esc(row.clock_out.slice(0,5))}</time>`:''}</button>${error?'<button type="button" class="ws-action" data-ws-clock="retry">다시 확인</button>':''}</div>`;
  }
  async function read(name,today) {
    const result=await db.from('attendances').select('*').eq('member',name).eq('date',today).maybeSingle();
    if(result.error)throw result.error;
    return result.data;
  }
  async function load() {
    if(!user||busy)return;
    const token=++request,name=user.name,today=day();loading=true;error='';render();
    try {const value=await read(name,today);if(token!==request||user?.name!==name)return;row=value;member=name;date=today;}
    catch(e){if(token===request){error='출퇴근 기록을 불러오지 못했습니다.';console.error(e);}}
    finally{if(token===request){loading=false;render();}}
  }
  async function record(type) {
    if(!['in','out'].includes(type)||!user||busy)return;
    busy=true;error='';render();const name=user.name,today=day();
    try {
      const current=await read(name,today);
      if(user?.name!==name||day()!==today)throw Error('날짜 또는 사용자가 변경됐습니다. 다시 확인해주세요.');
      const column=type==='in'?'clock_in':'clock_out';
      if(current?.[column]){toast('이미 '+(type==='in'?'출근':'퇴근')+' 기록이 있습니다.');return;}
      if(type==='out'&&!current?.clock_in)throw Error('출근을 먼저 등록해주세요.');
      if(type==='in'&&current?.clock_out)throw Error('이미 퇴근한 기록입니다. 출퇴근 내역에서 확인해주세요.');
      const time=clock();let result;
      if(current){
        result=await db.from('attendances').update({[column]:time}).eq('id',current.id).is(column,null).select('id');
      }else{
        result=await db.from('attendances').insert({id:name+'-'+today,member:name,date:today,[column]:time}).select('id');
      }
      if(result.error){if(result.error.code==='23505'){toast('다른 화면에서 등록된 기록을 불러옵니다.');return;}throw result.error;}
      if(!result.data?.length){toast('기록이 변경되어 최신 내용을 불러옵니다.');return;}
      toast((type==='in'?'출근':'퇴근')+' '+time+' 저장됐습니다.');
      document.dispatchEvent(new CustomEvent('workspace-attendance-changed'));
    }catch(e){error='저장 실패: '+(e.message||'다시 시도해주세요.');toast(error);}
    finally{
      const failure=error;busy=false;await load();if(failure){error=failure;render();}
    }
  }
  document.addEventListener('click',e=>{const button=e.target.closest('[data-ws-clock]');if(!button||button.disabled)return;if(button.dataset.wsClock==='retry')load();else record(button.dataset.wsClock);});
  const previous=loadDashboard;
  loadDashboard=async function(){await previous();await load();};
  window.addEventListener('focus',()=>{if(document.getElementById('page-dashboard')?.classList.contains('on'))load();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&document.getElementById('page-dashboard')?.classList.contains('on'))load();});
  setInterval(()=>{if(date!==day()&&document.getElementById('page-dashboard')?.classList.contains('on'))load();},60000);
  window.CHEROPAttendance={load,render,record};
})();
