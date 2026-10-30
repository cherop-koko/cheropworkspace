import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {Zip,ZipPassThrough} from 'npm:fflate@0.8.2';
import {render,EvidenceError} from './renderer.mjs';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const bucket=db.storage.from('cherop-production');
const origin='https://cherop-koko.github.io';
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
async function required(p:any){const r=await p;if(r.error)throw Error(r.error.message);return r.data;}
const validPath=(p:any)=>typeof p==='string'&&/^(inputs|outputs)\/[a-zA-Z0-9_./-]+$/.test(p)&&!p.includes('..');
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 const reply=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers});
 try{
  if(req.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
  const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
  const internal=token.length===64&&await required(db.rpc('production_token_valid',{p_token:token}));
  let member=false,admin=false;
  if(!internal){const {data,error}=await db.auth.getUser(token);const m=data?.user?.app_metadata;member=!error&&!!data.user?.email_confirmed_at&&m?.workspace_enabled===true&&['ceo','hyomin','hyunjin','sungae'].includes(m.workspace_member_id);admin=member&&['ceo','hyomin'].includes(m.workspace_member_id);}
  if(!internal&&!member)return reply({error:'SIGN_IN_REQUIRED'},401);
  if(Number(req.headers.get('content-length'))>16384)return reply({error:'REQUEST_TOO_LARGE'},413);
  const raw=await req.text();if(raw.length>16384)return reply({error:'REQUEST_TOO_LARGE'},413);
  const body=JSON.parse(raw||'{}'),action=body.action;
  if(action==='list'){
   const jobs=await required(db.from('production_jobs').select('id,title,product_key,status,stage,attempts,created_at,started_at,finished_at,output_path,error,report').order('created_at',{ascending:false}).limit(100));
   const samples=jobs.filter((j:any)=>j.status==='review'&&j.finished_at&&j.started_at).map((j:any)=>(Date.parse(j.finished_at)-Date.parse(j.started_at))/1000);
   return reply({jobs,estimate:samples.length>=5?{seconds:Math.round(samples.reduce((a:number,b:number)=>a+b,0)/samples.length),samples:samples.length,scope:'동일 실행기 처리시간 · 대기·자료준비·시각검수 제외'}:null});
  }
  if(action==='download'){
   const j=await required(db.from('production_jobs').select('output_path').eq('id',body.id).single());if(!j.output_path)return reply({error:'NO_OUTPUT'},404);
   const s=await required(bucket.createSignedUrl(j.output_path,600,{download:true}));return reply({url:s.signedUrl});
  }
  if(!internal&&!admin)return reply({error:'ADMIN_REQUIRED'},403);
  if(action==='prepare-uploads'){
   if(!Array.isArray(body.paths)||body.paths.length>40||body.paths.some((p:any)=>!validPath(p)||!p.startsWith('inputs/')))return reply({error:'INVALID_PATH'},400);
   const uploads=[];for(const path of body.paths) uploads.push(await required(bucket.createSignedUploadUrl(path)));return reply({uploads});
  }
  if(action==='prepare-upload'){
   if(!validPath(body.path)||!body.path.startsWith('inputs/'))return reply({error:'INVALID_PATH'},400);
   return reply(await required(bucket.createSignedUploadUrl(body.path)));
  }
  if(action==='submit'){
   if(!validPath(body.input_path)||!body.input_path.startsWith('inputs/')||!body.title||!body.product_key||!body.request_key)return reply({error:'INVALID_INPUT'},400);
   const existing=await required(db.from('production_jobs').select('id').eq('request_key',body.request_key).maybeSingle());
   if(existing)return reply(existing);
   const jobs=await required(db.from('production_jobs').insert({title:String(body.title).slice(0,180),product_key:body.product_key,input_path:body.input_path,request_key:body.request_key}).select('id').single());return reply(jobs);
  }
  if(action==='cancel'){
   return reply(await required(db.from('production_jobs').update({status:'cancelled',stage:'취소',finished_at:new Date().toISOString()}).eq('id',body.id).in('status',['queued','working']).select('id')));
  }
  if(action==='run'&&internal){
   const [job]=await required(db.rpc('production_claim'))||[];
   if(!job)return reply({idle:true});
   try{
    const source=await required(bucket.download(job.input_path));
    if(source.size>52428800)throw new EvidenceError('입력 파일 50MB 초과');
    const input=JSON.parse(await source.text());
    const approved=await required(db.from('production_templates').select('sha256').eq('id',input.template?.id||'').maybeSingle());
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input.template?.html||'')))).map(x=>x.toString(16).padStart(2,'0')).join('');
    if(!approved||approved.sha256!==digest)throw new EvidenceError('등록된 승인 기본틀과 불일치');
    if(input.productKey!==job.product_key)throw new EvidenceError('작업번호와 상품 입력 불일치');
    const sourceAssets=input.assets,relativeAssets={};
    for(const [key,path] of Object.entries(sourceAssets)){
     if(!validPath(path)||!String(path).startsWith('inputs/')||!/\.(png|jpg|gif|webp|woff2)$/.test(String(path)))throw new EvidenceError('원본 파일 경로 확인 필요');
     relativeAssets[key]='assets/'+key+'.'+String(path).split('.').at(-1);
    }
    input.assets=relativeAssets;
    const {html,report}=render(input);
    await required(db.from('production_jobs').update({stage:'원본 파일 묶음 제작'}).eq('id',job.id).eq('lease_token',job.lease_token).eq('status','working'));
    const chunks:Uint8Array[]=[];let zipError:any=null;
    const zip=new Zip((err,data)=>{if(err)zipError=err;else chunks.push(data);});
    const page=new ZipPassThrough('index.html');zip.add(page);page.push(new TextEncoder().encode(html),true);
    let total=0;
    for(const [key,assetPath] of Object.entries(sourceAssets)){
     const blob=await required(bucket.download(assetPath));total+=blob.size;
     if(total>45*1024*1024)throw new EvidenceError('원본 총용량 45MB 초과');
     const entry=new ZipPassThrough(relativeAssets[key]);zip.add(entry);
     const reader=blob.stream().getReader();while(true){const part=await reader.read();if(part.done)break;entry.push(part.value,false);}entry.push(new Uint8Array(),true);
    }
    zip.end();if(zipError)throw zipError;
    const path=`outputs/${job.id}/${job.lease_token}.zip`;
    report['format']='offline_html_and_original_assets_zip';
    report['assetBytes']=total;
    await required(bucket.upload(path,new Blob(chunks,{type:'application/zip'}),{contentType:'application/zip',upsert:false}));
    const committed=await required(db.rpc('production_finish',{p_id:job.id,p_lease:job.lease_token,p_status:'review',p_output:path,p_report:report,p_error:null}));
    if(!committed)await bucket.remove([path]);
    return reply({id:job.id,committed});
   }catch(e){
    const status=e instanceof EvidenceError?'blocked':'failed';
    await required(db.rpc('production_finish',{p_id:job.id,p_lease:job.lease_token,p_status:status,p_output:null,p_report:{visualReview:'not_run'},p_error:String(e.message||e).slice(0,500)}));
    return reply({id:job.id,status});
   }
  }
  return reply({error:'NOT_FOUND'},404);
 }catch(e){console.error('production-engine',e.message);return reply({error:'REQUEST_FAILED'},500);}
});
