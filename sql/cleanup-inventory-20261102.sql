begin;
-- Exact-string product references only; canonical object values win key collisions.
create function public.inventory_remap_json_20261102(v jsonb, aliases jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare result jsonb; k text; val jsonb; mapped text;
begin
 case jsonb_typeof(v)
 when 'object' then
   result:='{}';
   for k,val in select key,value from jsonb_each(v) loop
     mapped:=coalesce(aliases->>k,k);
     if mapped<>k and v ? mapped then continue; end if;
     result:=result||jsonb_build_object(mapped,public.inventory_remap_json_20261102(val,aliases));
   end loop;
 when 'array' then
   select coalesce(jsonb_agg(public.inventory_remap_json_20261102(value,aliases)),'[]') into result from jsonb_array_elements(v);
 when 'string' then result:=coalesce(aliases->(v#>>'{}'),v);
 else result:=v;
 end case;
 return result;
end $$;
do $$
declare s jsonb; aliases jsonb := '{"prod_플라잉_몽모XS":"prod-1778748898489","prod_몽숭이L":"prod-1787364774213","prod_아가_몽범L":"prod-1787364814112","prod_토몽이L":"prod-1787283666120","prod_오리지널_코코L":"prod-1789543525092"}'; old_id text; new_id text; r record; review jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('cherop_inventory_sales_v1',0));
 select data into s from public.app_state where id='cherop_main' for update;
 if exists(select 1 from public.app_state where id='cherop_inventory_cleanup_backup_20261102') then raise exception 'Cleanup already applied'; end if;
 perform 1 from public.inventory order by id for update;
 perform 1 from public.channel_inventory order by id for update;
 insert into public.app_state(id,data,updated_at) values('cherop_inventory_cleanup_backup_20261102',jsonb_build_object(
   'reason','대표님 지시: 단종예정 제거, 기존 판매중 재고 기준 통합, 닥스훈트 L 오등록 보존 후 제외',
   'at',now(),'aliases',aliases,'app_state',s,
   'products',(select jsonb_agg(to_jsonb(t)) from public.products t),
   'inventory',(select jsonb_agg(to_jsonb(t)) from public.inventory t),
   'channel_inventory',(select jsonb_agg(to_jsonb(t)) from public.channel_inventory t),
   'channel_product_mapping',(select jsonb_agg(to_jsonb(t)) from public.channel_product_mapping t),
   'sales_log',(select jsonb_agg(to_jsonb(t)) from public.sales_log t where aliases ? t.product_id),
   'stock_receipts',(select jsonb_agg(to_jsonb(t)) from public.stock_receipts t where aliases ? t.product_id),
   'channel_sales_log',(select jsonb_agg(to_jsonb(t)) from public.channel_sales_log t)
 ),now());
 for old_id,new_id in select key,value from jsonb_each_text(aliases) loop
   if not exists(select 1 from public.products where id=new_id and not is_discontinued and disc_status='active') then raise exception 'Canonical active product missing: %',new_id; end if;
   update public.channel_product_mapping set product_id=new_id where product_id=old_id;
   update public.sales_log set product_id=new_id where product_id=old_id;
   update public.stock_receipts set product_id=new_id where product_id=old_id;
   -- Preserve recorded historical revenue while moving its product suffix.
   for r in select * from public.channel_sales_log where right(id,length(old_id)+1)='-'||old_id loop
     insert into public.channel_sales_log(id,channel,date,amount,note,created_at)
     values(left(r.id,length(r.id)-length(old_id))||new_id,r.channel,r.date,r.amount,r.note,r.created_at)
     on conflict(id) do update set amount=public.channel_sales_log.amount+excluded.amount;
     update public.channel_sales_log set amount=0,note=coalesce(note,'')||' [상품 통합: '||new_id||']' where id=r.id;
   end loop;
   update public.inventory set total_stock=0,produced_stock=0,pending_production=0,available_stock=0,updated_at=now() where product_id=old_id;
   update public.channel_inventory set stock=0,updated_at=now() where product_id=old_id;
   update public.products set is_discontinued=true,disc_status='deleted',disc_date=null where id=old_id;
 end loop;
 s:=public.inventory_remap_json_20261102(s,aliases);
 s:=jsonb_set(s,'{inventory_product_aliases}',coalesce(s->'inventory_product_aliases','{}')||aliases);
 -- All remaining planned items become selling records, with physical ambiguities clearly flagged.
 update public.products set disc_status=case when is_discontinued then 'disc' else 'active' end,disc_date=null where disc_status='planned';
 update public.products set disc_status='review',is_discontinued=false where id in ('prod-1776161021184','prod-1782869098252');
 -- L is a misclassification of keyring stock; preserve the current keyring stock, never add both.
 update public.inventory set total_stock=0,produced_stock=0,pending_production=0,available_stock=0,updated_at=now() where product_id='prod-1793079844791';
 update public.channel_inventory set stock=0,updated_at=now() where product_id='prod-1793079844791';
 review:=coalesce(s->'inventory_review','{}')||jsonb_build_object(
 'prod-1776161021184',jsonb_build_object('reason','자이언트 몽모리 2개 기록 관계·실수량 확인 전. 합산 금지.','block_sales',true),
 'prod-1782869098252',jsonb_build_object('reason','자이언트 몽모리 2개 기록 관계·실수량 확인 전. 합산 금지.','block_sales',true),
 'prod-1782188585203',jsonb_build_object('reason','사랑 몽모 옵션 미기재. M·키링으로 추정하지 말고 사이즈 확인.','block_sales',true),
 'prod-1782188631237',jsonb_build_object('reason','행운 몽모 옵션 미기재. M·키링으로 추정하지 말고 사이즈 확인.','block_sales',true),
 'prod-1793177572153',jsonb_build_object('reason','현 키링 기록 300개 유지. L 오등록 306개와의 6개 차이 실사 필요. 중복 합산하지 않음.','block_sales',false),
 'prod-1793079844791',jsonb_build_object('reason','기존 306개는 키링 오등록이므로 L 재고에서 제외. L 입고 확인 기록 없음.','block_sales',true));
 s:=jsonb_set(s,'{inventory_review}',review);
 update public.app_state set data=s,updated_at=now() where id='cherop_main';
end $$;

commit;
