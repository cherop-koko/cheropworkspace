-- Read-only dashboard projection: no input brief, asset, token or signed URL.
create or replace function public.production_project_status() returns trigger language plpgsql security definer set search_path='' as $$
declare summary jsonb;
begin
 select jsonb_build_object('jobs',coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb),'mode','template_assembly','worker','server_cron','notifications','workspace_only') into summary
 from (select id,title,product_key,status,stage,attempts,created_at,started_at,finished_at,output_path,error from public.production_jobs order by created_at desc limit 100) j;
 summary=summary||jsonb_build_object('estimate',(select case when count(*)>=5 then jsonb_build_object('samples',count(*),'seconds',round(avg(extract(epoch from finished_at-started_at)))) else null end from public.production_jobs where status in ('review','approved') and report->>'template'=(select report->>'template' from public.production_jobs where status in ('review','approved') order by finished_at desc limit 1)));
 insert into public.app_state(id,data,updated_at) values('cherop_production_summary',summary,now()) on conflict(id) do update set data=excluded.data,updated_at=now();
 return null;
end $$;
revoke all on function public.production_project_status() from public,anon,authenticated;
create trigger production_job_projection after insert or update or delete on public.production_jobs for each statement execute function public.production_project_status();
select cron.schedule('cherop-production-worker','* * * * *', $job$
 select public.production_invoke() where exists(select 1 from public.production_jobs where status='queued' or (status='working' and lease_until<now()));
$job$);
