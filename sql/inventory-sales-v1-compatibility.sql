-- Old open tabs retain safe retries/cancellation, but must reload for pending-stock consent.
create or replace function public.apply_inventory_sales_v1(p_rows jsonb default '[]',p_delete_ids jsonb default '[]')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 result:=public.apply_inventory_sales_v2(p_rows,p_delete_ids,null,'{}');
 if coalesce((result->>'needs_confirmation')::boolean,false) then
   raise exception '대기재고 차감 확인이 필요합니다. 화면을 새로고침한 뒤 출고를 등록해주세요. 아직 저장되지 않았습니다.';
 end if;
 return result;
end;
$$;
