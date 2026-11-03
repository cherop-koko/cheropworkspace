-- Only use before any v2 shipment has been recorded. Never overwrite business data
-- with a snapshot after people have resumed work. For later recovery, preserve v2
-- and its source ledger, pause new pending shipments, and deploy a forward fix.
begin;
set local lock_timeout='5s';
select pg_advisory_xact_lock(hashtextextended('cherop_inventory_sales_v1',0));
select 1 from public.app_state where id='cherop_main' for update;
do $$
declare saved text;
begin
 if exists(select 1 from public.app_state where id='cherop_main' and
   (coalesce(data->'inventory_sale_sources','{}')<>'{}'::jsonb or coalesce(data->'inventory_pending_reviews','{}')<>'{}'::jsonb)) then
   raise exception 'New shipment history exists. Preserve the v2 functions/guard and source ledger; use a forward fix.';
 end if;
 select definition into strict saved from cherop_pending_review_20261103.function_backup
 where definition_md5='66c5bfff3ec34af6f6a02630b7f84f0a';
 execute saved;
end $$;
drop trigger if exists guard_pending_shipment_state on public.app_state;
drop function if exists public.guard_pending_shipment_state_v1();
drop function if exists public.complete_pending_shipment_review_v1(text,integer,jsonb);
drop function if exists public.apply_inventory_sales_v2(jsonb,jsonb,text,jsonb);
commit;
-- Restore the frontend to the pre-feature revision only together with this rollback.
-- The private backup schema remains available; no data rows are deleted/restored.
