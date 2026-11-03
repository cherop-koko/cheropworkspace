-- Reject stale whole-state writes that would erase server-managed shipment history.
-- This is a consistency guard, not a replacement for authentication/RLS.
create or replace function public.guard_pending_shipment_state_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare old_linked jsonb; new_linked jsonb;
begin
 if old.id<>'cherop_main' or current_setting('cherop.pending_mutation',true)='on' then return new; end if;
 select coalesce(jsonb_agg(x order by x->>'id'),'[]') into old_linked
 from jsonb_array_elements(coalesce(old.data->'work_logs','[]')) x where x->>'inventory_effect'='already_shipped';
 select coalesce(jsonb_agg(x order by x->>'id'),'[]') into new_linked
 from jsonb_array_elements(coalesce(new.data->'work_logs','[]')) x where x->>'inventory_effect'='already_shipped';
 if coalesce(new.data->'inventory_sale_sources','{}') is distinct from coalesce(old.data->'inventory_sale_sources','{}')
 or coalesce(new.data->'inventory_pending_reviews','{}') is distinct from coalesce(old.data->'inventory_pending_reviews','{}')
 or new_linked is distinct from old_linked then
   raise exception '출고 확인 이력이 변경됐습니다. 입력을 복사한 뒤 새로고침해주세요. 이번 저장은 반영되지 않았습니다.';
 end if;
 return new;
end;
$$;
revoke all on function public.guard_pending_shipment_state_v1() from public;
create or replace trigger guard_pending_shipment_state
before update on public.app_state for each row execute function public.guard_pending_shipment_state_v1();
