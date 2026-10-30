"""Run a supplied private input on an independent machine/GitHub runner.
Claims exclusively through production_ai_claim (migration required).
Credentials must be explicitly configured; never discover stored credentials.
"""
import asyncio,json,os,sys,tempfile,zipfile
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.parse import quote
from worker import run,Blocked

def api(path,data=None,method='POST',content_type='application/json'):
    url=os.environ['CHEROP_SUPABASE_URL'].rstrip('/')+path
    token=os.environ['CHEROP_SUPABASE_SERVICE_KEY']
    raw=json.dumps(data).encode() if isinstance(data,(dict,list)) else data
    with urlopen(Request(url,data=raw,method=method,headers={'apikey':token,'Authorization':'Bearer '+token,'Content-Type':content_type,'Prefer':'return=representation'}),timeout=60) as r:
        raw=r.read()
        return json.loads(raw) if 'json' in r.headers.get('Content-Type','') else raw

async def main():
    for key in ('CHEROP_SUPABASE_URL','CHEROP_SUPABASE_SERVICE_KEY','OPENAI_API_KEY','CHEROP_TEXT_MODEL'):
        if not os.environ.get(key): raise Blocked('실행 설정 필요: '+key)
    jobs=api('/rest/v1/rpc/production_ai_claim',{})
    if not jobs: print('대기 작업 없음'); return
    job=jobs[0];job_id=job['id'];lease=job['lease_token']
    def patch(data):
        return api('/rest/v1/production_jobs?id=eq.'+job_id+'&lease_token=eq.'+lease+'&status=eq.working',data,'PATCH')
    stop=asyncio.Event()
    async def heartbeat():
        from datetime import datetime,timedelta,timezone
        while not stop.is_set():
            rows=await asyncio.to_thread(patch,{'lease_until':(datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat()})
            if not rows: raise Blocked('취소 또는 작업 임대 만료')
            try: await asyncio.wait_for(stop.wait(),30)
            except asyncio.TimeoutError: pass
    async def work():
        with tempfile.TemporaryDirectory() as d:
            out=Path(d)
            raw=await asyncio.to_thread(api,'/storage/v1/object/cherop-production/'+quote(job['input_path'],safe='/'),None,'GET')
            b=json.loads(raw) if isinstance(raw,bytes) else raw
            if b['productKey']!=job['product_key']: raise Blocked('상품번호 불일치')
            # Model calls and browser rendering run in a separate thread/event loop;
            # heartbeat remains responsive during a long model request.
            result=await asyncio.to_thread(lambda:asyncio.run(run(b,out)))
            prefix='outputs/'+job_id+'/'+lease
            for name in ('index.html','report.json','progress.json'):
                p=out/name
                if p.exists(): await asyncio.to_thread(api,'/storage/v1/object/cherop-production/'+prefix+'/'+name,p.read_bytes(),'POST','text/html' if name.endswith('.html') else 'application/json')
            bundle=out/'result.zip'
            with zipfile.ZipFile(bundle,'w',zipfile.ZIP_DEFLATED) as z:
                for p in out.iterdir():
                    if p!=bundle: z.write(p,p.name)
            await asyncio.to_thread(api,'/storage/v1/object/cherop-production/'+prefix+'/result.zip',bundle.read_bytes(),'POST','application/zip')
            result.update({'previewPath':prefix+'/index.html' if (out/'index.html').exists() else None,'previewPublished':False})
            committed=await asyncio.to_thread(api,'/rest/v1/rpc/production_finish',{'p_id':job_id,'p_lease':lease,'p_status':result['status'],'p_output':prefix+'/result.zip','p_report':result,'p_error':None if result['status']=='review' else 'AI 검수 미통과'})
            if committed is not True: raise Blocked('취소·임대 변경으로 결과 반영되지 않음')
            print(json.dumps({'id':job_id,'title':job['title'],'status':result['status']},ensure_ascii=False))
    beat=asyncio.create_task(heartbeat());task=asyncio.create_task(work())
    try:
        done,_=await asyncio.wait([beat,task],return_when=asyncio.FIRST_COMPLETED)
        for x in done: await x
    except Exception as e:
        reason=str(e) if isinstance(e,Blocked) else type(e).__name__
        await asyncio.to_thread(api,'/rest/v1/rpc/production_finish',{'p_id':job_id,'p_lease':lease,'p_status':'blocked' if isinstance(e,Blocked) else 'failed','p_output':None,'p_report':{'previewPublished':False},'p_error':reason})
        raise
    finally:
        stop.set();beat.cancel();task.cancel()
        await asyncio.gather(beat,task,return_exceptions=True)

if __name__=='__main__':
    try: asyncio.run(main())
    except Exception as e:
        print(str(e) if isinstance(e,Blocked) else '실행 오류: '+type(e).__name__)
        sys.exit(2)
