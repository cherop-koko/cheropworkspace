-- Separate from retail inventory / existing design tasks. No anonymous access.
create table public.production_jobs (
 id uuid primary key default gen_random_uuid(), request_key text unique not null,
 title text not null check(length(title) between 1 and 180), product_key text not null,
 input_path text not null, status text not null default 'queued' check(status in ('queued','working','review','blocked','failed','cancelled','approved')),
 stage text not null default '대기', attempts int not null default 0, lease_token uuid, lease_until timestamptz,
 created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz,
 output_path text, report jsonb not null default '{}'::jsonb, error text,
 constraint input_prefix check(input_path like 'inputs/%')
);
create index production_jobs_queue on public.production_jobs(created_at) where status in ('queued','working');
create table public.production_events(id bigint generated always as identity primary key,job_id uuid references public.production_jobs(id),created_at timestamptz default now(),event text not null,details jsonb default '{}');
create table public.production_runtime(id text primary key,data jsonb not null default '{}',updated_at timestamptz default now());
alter table public.production_jobs enable row level security;
alter table public.production_events enable row level security;
alter table public.production_runtime enable row level security;
revoke all on public.production_jobs,public.production_events,public.production_runtime from anon,authenticated;
grant all on public.production_jobs,public.production_events,public.production_runtime to service_role;
grant usage,select on sequence public.production_events_id_seq to service_role;
insert into storage.buckets(id,name,public,file_size_limit) values('cherop-production','cherop-production',false,52428800) on conflict(id) do nothing;
-- Token never sent to browsers. Existing Auth identities can use the API separately.
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'cherop_production_runner');
create function public.production_token_valid(p_token text) returns boolean language sql security definer set search_path='' as $$
 select length(p_token)=64 and exists(select 1 from vault.decrypted_secrets where name='cherop_production_runner' and extensions.digest(decrypted_secret,'sha256')=extensions.digest(p_token,'sha256'));
$$;
create function public.production_claim() returns setof public.production_jobs language plpgsql security definer set search_path='' as $$
declare j public.production_jobs;
begin
 if not pg_try_advisory_xact_lock(865037) then return; end if;
 for j in select * from public.production_jobs where status='working' and lease_until<now() and attempts>=3 for update loop
  perform public.production_finish(j.id,j.lease_token,'failed',null,'{}'::jsonb,'실행 중단 또는 시간 초과 · 3회 재시도 한도');
 end loop;
 if exists(select 1 from public.production_jobs where status='working' and lease_until>now()) then return; end if;
 select * into j from public.production_jobs where (status='queued' or (status='working' and lease_until<now())) and attempts<3 order by created_at for update skip locked limit 1;
 if j.id is null then return; end if;
 update public.production_jobs set status='working',stage='자료 확인',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',started_at=now() where id=j.id returning * into j;
 insert into public.production_events(job_id,event,details) values(j.id,'claimed',jsonb_build_object('attempt',j.attempts));
 return next j;
end $$;
create function public.production_finish(p_id uuid,p_lease uuid,p_status text,p_output text,p_report jsonb,p_error text) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.production_jobs; n jsonb;
begin
 if p_status not in ('review','blocked','failed') then raise exception 'invalid status'; end if;
 update public.production_jobs set status=p_status,stage=case p_status when 'review' then '초안 생성 · 시각 검수 대기' when 'blocked' then '자료 확인 필요' else '실행 실패' end,finished_at=now(),output_path=p_output,report=p_report,error=left(p_error,500),lease_until=null
 where id=p_id and lease_token=p_lease and status='working' returning * into j;
 if j.id is null then return false; end if;
 insert into public.production_events(job_id,event,details) values(j.id,p_status,p_report);
 n=jsonb_build_object('id','production-'||j.id,'date',to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD'),'title',case when p_status='review' then '제작 초안 준비 · ' else '제작 확인 필요 · ' end||replace(replace(replace(j.title,'&','&amp;'),'<','&lt;'),'>','&gt;'),'author','제작실행기','category','업데이트','content','제작실에서 결과와 검수 기록을 확인해 주세요. 작업번호: '||j.id,'readBy','[]'::jsonb,'managed_by','production-engine');
 update public.app_state set data=jsonb_set(data,'{notices}',jsonb_build_array(n)||coalesce(data->'notices','[]'::jsonb)),updated_at=now() where id='cherop_main';
 return true;
end $$;
create function public.production_invoke(p_body jsonb default '{"action":"run"}') returns bigint language sql security definer set search_path='' as $$
 select net.http_post(url:='https://pmgntojnfglppjtypwzq.supabase.co/functions/v1/production-engine',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='cherop_production_runner')),body:=p_body,timeout_milliseconds:=180000);
$$;
revoke all on function public.production_token_valid(text),public.production_claim(),public.production_finish(uuid,uuid,text,text,jsonb,text),public.production_invoke(jsonb) from public,anon,authenticated;
grant execute on function public.production_token_valid(text),public.production_claim(),public.production_finish(uuid,uuid,text,text,jsonb,text) to service_role;
create table public.production_templates(id text primary key,sha256 text not null,description text not null,created_at timestamptz default now());
alter table public.production_templates enable row level security;
revoke all on public.production_templates from anon,authenticated;
grant all on public.production_templates to service_role;
