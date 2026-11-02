begin;
do $$
declare s jsonb; aliases jsonb := '{"prod-1776161021184":"prod-1782869098252","prod-1782188585203":"prod-1776133597196","prod-1782188631237":"prod-1776133530235","prod_사랑_몽모M":"prod-1776133597196","prod_행운_몽모M":"prod-1776133530235"}'; old_id text; new_id text; r record; confirmed jsonb := '{"prod-1778748898489":220,"prod-1787364774213":80,"prod-1787364814112":124,"prod-1787283666120":100,"prod-1782869098252":73,"prod-1776133597196":61,"prod-1776133530235":65}';
begin
 perform pg_advisory_xact_lock(hashtextextended('cherop_inventory_sales_v1',0));
 select data into s from public.app_state where id='cherop_main' for update;
 if exists(select 1 from public.app_state where id='cherop_inventory_confirmed_backup_20261102') then raise exception 'Confirmed adjustment already applied'; end if;
 perform 1 from public.inventory order by id for update;
 perform 1 from public.channel_inventory order by id for update;
 insert into public.app_state(id,data,updated_at) values('cherop_inventory_confirmed_backup_20261102',jsonb_build_object('at',now(),'reason','대표님 직원 실사 수량 확인: 판매용 723개 및 코코 L 샘플 1개','app_state',s,'aliases',aliases,'confirmed',confirmed,
 'products',(select jsonb_agg(to_jsonb(t)) from public.products t),
 'inventory',(select jsonb_agg(to_jsonb(t)) from public.inventory t),
 'channel_inventory',(select jsonb_agg(to_jsonb(t)) from public.channel_inventory t),
 'channel_product_mapping',(select jsonb_agg(to_jsonb(t)) from public.channel_product_mapping t),
 'sales_log',(select jsonb_agg(to_jsonb(t)) from public.sales_log t where aliases ? t.product_id),
 'stock_receipts',(select jsonb_agg(to_jsonb(t)) from public.stock_receipts t where aliases ? t.product_id),
 'channel_sales_log',(select jsonb_agg(to_jsonb(t)) from public.channel_sales_log t)),now());
 for old_id,new_id in select key,value from jsonb_each_text(aliases) loop
   update public.channel_product_mapping set product_id=new_id where product_id=old_id;
   update public.sales_log set product_id=new_id where product_id=old_id;
   update public.stock_receipts set product_id=new_id where product_id=old_id;
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
 for r in select key,value::integer as qty from jsonb_each_text(confirmed) loop
   if not exists(select 1 from public.inventory where product_id=r.key and produced_stock<=r.qty) then raise exception 'Inventory breakdown needs review: %',r.key; end if;
   update public.inventory set total_stock=r.qty,pending_production=r.qty-produced_stock,updated_at=now() where product_id=r.key;
   update public.products set is_discontinued=false,disc_status='active',disc_date=null where id=r.key;
 end loop;
 -- Do not invent which channel owns the two overstated units. Release this incorrect allocation to the shared pool.
 update public.channel_inventory set stock=0,updated_at=now() where product_id='prod-1787364814112';
 update public.inventory set available_stock=produced_stock,updated_at=now() where product_id='prod-1787364814112';
 s:=jsonb_set(s,'{inventory_review}',coalesce(s->'inventory_review','{}')-array['prod-1776161021184','prod-1782869098252','prod-1782188585203','prod-1782188631237','prod-1776133597196','prod-1776133530235']);
 -- Preserve the upcoming sale SKU at zero; recovered discontinued unit is sample-only.
 insert into public.products(id,name,option_name,is_discontinued,disc_status,category)
 select 'sample-coco-l-20261102','오리지널 코코','L · 샘플 보관',true,'disc',category from public.products where id='prod-1789543525092';
 insert into public.inventory(id,product_id,total_stock,produced_stock,pending_production,available_stock,updated_at)
 values('inv-sample-coco-l-20261102','sample-coco-l-20261102',1,1,0,0,now());
 insert into public.channel_inventory(id,product_id,channel,stock,updated_at)
 values('ci-sample-coco-l-20261102','sample-coco-l-20261102','샘플 보관',1,now());
 s:=jsonb_set(s,'{inventory_review}',(s->'inventory_review')||jsonb_build_object('sample-coco-l-20261102',jsonb_build_object('reason','단종 이후 발견된 1개. 추후 샘플용 보관, 판매·출고 금지.','block_sales',true,'sample_only',true)));
 s:=jsonb_set(s,'{inventory_adjustments}',coalesce(s->'inventory_adjustments','[]')||jsonb_build_array(jsonb_build_object('id','confirmed-20261102','at',now(),'confirmed',confirmed,'sample_coco_l',1,'allocation_reset',jsonb_build_object('product_id','prod-1787364814112','previous_allocated',46,'shared_available',44),'reason','대표님 확인 수량 반영 및 중복 통합. 상품화 완료/대기 구분 유지.')));
 update public.app_state set data=s,updated_at=now() where id='cherop_main';
end $$;
commit;
