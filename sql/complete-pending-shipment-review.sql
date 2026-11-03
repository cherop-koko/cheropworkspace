-- A confirmation creates a linked work record but never changes inventory.
create or replace function public.complete_pending_shipment_review_v1(p_review_id text,p_expected_quantity integer,p_actor jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s jsonb; review jsonb; actor jsonb; product_label text; work_id text; previous_guard text;
begin
 select data into strict s from public.app_state where id='cherop_main' for update;
 review:=s->'inventory_pending_reviews'->p_review_id;
 if review is null then raise exception '확인할 출고 기록을 찾지 못했습니다.'; end if;
 if review->>'status'='completed' then return jsonb_build_object('already_completed',true,'review',review); end if;
 if review->>'status'<>'open' or (review->>'quantity')::integer<=0 then raise exception '취소되거나 변경된 출고 기록입니다.'; end if;
 if (review->>'quantity')::integer is distinct from p_expected_quantity then raise exception '출고 수량이 변경됐습니다. 다시 확인해주세요.'; end if;
 actor:=jsonb_build_object('id',left(coalesce(p_actor->>'id',''),100),'name',left(coalesce(p_actor->>'name',''),100));
 review:=review||jsonb_build_object('status','completed','completed_at',now(),'completed_by',actor,'completed_quantity',(review->>'quantity')::integer);
 s:=jsonb_set(s,array['inventory_pending_reviews',p_review_id],review);
 work_id:='wlog-shipped-review-'||p_review_id;
 select name||coalesce(' · '||nullif(option_name,''),'') into product_label from public.products where id=review->>'product_id';
 if not exists(select 1 from jsonb_array_elements(coalesce(s->'work_logs','[]')) x where x->>'id'=work_id) then
   s:=jsonb_set(s,'{work_logs}',coalesce(s->'work_logs','[]')||jsonb_build_array(jsonb_build_object(
     'id',work_id,'date',to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD'),'product_id',review->>'product_id',
     'label',coalesce(product_label,review->>'product_id')||' · 선출고 확인','qty',(review->>'quantity')::integer,
     'createdAt',now(),'created_by',actor,'shipment_review_id',p_review_id,'sale_id',review->>'sale_id','inventory_effect','already_shipped')));
 end if;
 previous_guard:=current_setting('cherop.pending_mutation',true);
 perform set_config('cherop.pending_mutation','on',true);
 update public.app_state set data=s,updated_at=clock_timestamp() where id='cherop_main';
 perform set_config('cherop.pending_mutation',coalesce(previous_guard,''),true);
 return jsonb_build_object('already_completed',false,'review',review);
end;
$$;
revoke all on function public.complete_pending_shipment_review_v1(text,integer,jsonb) from public;
grant execute on function public.complete_pending_shipment_review_v1(text,integer,jsonb) to anon,authenticated;
