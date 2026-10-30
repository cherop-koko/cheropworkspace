-- Apply once after reviewing current production_claim definition.
-- Do not replace the existing queue or change retail data.
alter table public.production_jobs add column if not exists runner text not null default 'template';
do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.production_claim()'::regprocedure) into definition;
 if position('runner' in definition)=0 then
   if position('where (status=''queued''' in definition)=0 then
     raise exception 'production_claim changed; review current definition';
   end if;
   definition:=replace(definition,'where (status=''queued''','where runner=''template'' and (status=''queued''');
   definition:=replace(definition,'where status=''working''','where runner=''template'' and status=''working''');
   execute definition;
 end if;
end $migration$;
create or replace function public.production_ai_claim() returns setof public.production_jobs
language plpgsql security definer set search_path='' as $$
declare j public.production_jobs;
begin
 if not pg_try_advisory_xact_lock(865038) then return; end if;
 for j in select * from public.production_jobs where runner='ai' and status='working' and lease_until<now() and attempts>=3 for update loop
  perform public.production_finish(j.id,j.lease_token,'failed',null,'{}'::jsonb,'AI 실행 3회 실패');
 end loop;
 if exists(select 1 from public.production_jobs where runner='ai' and status='working' and lease_until>now()) then return; end if;
 select * into j from public.production_jobs where runner='ai' and (status='queued' or (status='working' and lease_until<now())) and attempts<3 order by created_at for update skip locked limit 1;
 if j.id is null then return; end if;
 update public.production_jobs set status='working',stage='AI 자료 수집·제작',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',started_at=now() where id=j.id returning * into j;
 insert into public.production_events(job_id,event) values(j.id,'ai_claimed');
 return next j;
end $$;
revoke all on function public.production_ai_claim() from public,anon,authenticated;
grant execute on function public.production_ai_claim() to service_role;
