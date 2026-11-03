-- Synthetic fixtures only; no inventory or confirmation record survives the rollback.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
insert into public.products(id,name,option_name,disc_status,is_discontinued) values('__pending_ship_test__','선출고 검증','S','active',false);
insert into public.inventory(id,product_id,total_stock,produced_stock,pending_production,available_stock) values('__pending_ship_test__','__pending_ship_test__',100,10,90,4);
insert into public.channel_inventory(id,product_id,channel,stock) values('__pending_ship_test__','__pending_ship_test__','QA',6);
do $$
declare rows jsonb; result jsonb; preview jsonb; baseline jsonb; after_completion jsonb; review_id text; token text; failures integer:=0; current_review jsonb;
begin
 update public.app_state set data=jsonb_set(data,'{ch_reservations}',coalesce(data->'ch_reservations','[]')||
 '[{"id":"__pending_rsv_qa__","product_id":"__pending_ship_test__","channel":"QA","qty":8,"createdAt":"2026-01-01"},
 {"id":"__pending_rsv_qb__","product_id":"__pending_ship_test__","channel":"QB","qty":20,"createdAt":"2026-01-02"}]'::jsonb) where id='cherop_main';
 select data into baseline from public.app_state where id='cherop_main';
 rows:='[{"id":"ship-__pending_test__","product_id":"__pending_ship_test__","channel":"QA","quantity":15,"amount":0,"sale_date":"2026-11-03"}]';
 preview:=public.apply_inventory_sales_v2(rows);
 if preview->>'needs_confirmation'<>'true' or preview->'pending_rows'->0->>'completed_quantity'<>'10' or preview->'pending_rows'->0->>'pending_quantity'<>'5' then raise exception 'Wrong confirmation breakdown'; end if;
 if exists(select 1 from public.sales_log where id='ship-__pending_test__')
   or (select total_stock from public.inventory where id='__pending_ship_test__')<>100
   or (select data from public.app_state where id='cherop_main') is distinct from baseline then raise exception 'Preview changed records'; end if;
 result:=public.apply_inventory_sales_v2(rows,'[]',preview->>'confirmation','{"id":"qa","name":"검증"}');
 if result->>'needs_confirmation'<>'false' or (select quantity from public.sales_log where id='ship-__pending_test__')<>15 then raise exception 'Confirmed save missing'; end if;
 if not exists(select 1 from public.inventory where id='__pending_ship_test__' and total_stock=85 and produced_stock=0 and pending_production=85 and available_stock=0)
   or (select stock from public.channel_inventory where id='__pending_ship_test__')<>0 then raise exception 'Mixed stock deduction incorrect'; end if;
 select key into strict review_id from public.app_state a cross join lateral jsonb_each(a.data->'inventory_pending_reviews') r where a.id='cherop_main' and r.value->>'sale_id'='ship-__pending_test__';
 if (select data->'inventory_pending_reviews'->review_id->>'quantity' from public.app_state where id='cherop_main')<>'5' then raise exception 'Review quantity incorrect'; end if;
 if exists(select 1 from public.app_state a cross join lateral jsonb_array_elements(a.data->'ch_reservations') r where a.id='cherop_main' and r->>'id'='__pending_rsv_qa__') then raise exception 'Own reservation not consumed'; end if;
 if not exists(select 1 from public.app_state a cross join lateral jsonb_array_elements(a.data->'ch_reservations') r where a.id='cherop_main' and r->>'id'='__pending_rsv_qb__' and r->>'qty'='20') then raise exception 'Other reservation consumed'; end if;
 result:=public.apply_inventory_sales_v2(rows);
 if result->>'needs_confirmation'<>'false' or (select total_stock from public.inventory where id='__pending_ship_test__')<>85 then raise exception 'Retry repeated deduction'; end if;
 -- Partial reduction reverses the newest pending portions, not completed stock.
 result:=public.apply_inventory_sales_v2(jsonb_set(rows,'{0,quantity}','12'));
 if not exists(select 1 from public.inventory where id='__pending_ship_test__' and total_stock=88 and produced_stock=0 and pending_production=88)
   or (select data->'inventory_pending_reviews'->review_id->>'quantity' from public.app_state where id='cherop_main')<>'2' then raise exception 'Partial cancellation incorrect'; end if;
 begin perform public.complete_pending_shipment_review_v1(review_id,5,'{}'); exception when others then failures:=failures+1; end;
 if failures<>1 then raise exception 'Stale completion accepted'; end if;
 result:=public.complete_pending_shipment_review_v1(review_id,2,'{"id":"qa","name":"검증"}');
 select data into after_completion from public.app_state where id='cherop_main';
 if after_completion->'inventory_pending_reviews'->review_id->>'status'<>'completed' then raise exception 'Completion not saved'; end if;
 if not exists(select 1 from jsonb_array_elements(after_completion->'work_logs') r where r->>'shipment_review_id'=review_id and r->>'inventory_effect'='already_shipped' and r->>'qty'='2') then raise exception 'Linked work record missing'; end if;
 result:=public.complete_pending_shipment_review_v1(review_id,2,'{}');
 if result->>'already_completed'<>'true' or (select data from public.app_state where id='cherop_main') is distinct from after_completion
   or (select total_stock from public.inventory where id='__pending_ship_test__')<>88 then raise exception 'Completion changed stock or duplicated record'; end if;
 -- Increasing a completed review creates a new open review, retaining the old history.
 preview:=public.apply_inventory_sales_v2(rows);
 result:=public.apply_inventory_sales_v2(rows,'[]',preview->>'confirmation');
 if (select count(*) from public.app_state a cross join lateral jsonb_each(a.data->'inventory_pending_reviews') r where a.id='cherop_main' and r.value->>'sale_id'='ship-__pending_test__' and r.value->>'status'='open')<>1 then raise exception 'New pending quantity not reopened separately'; end if;
 result:=public.apply_inventory_sales_v2('[]','[{"id":"ship-__pending_test__"}]');
 if not exists(select 1 from public.inventory where id='__pending_ship_test__' and total_stock=100 and produced_stock=10 and pending_production=90 and available_stock=4)
   or (select stock from public.channel_inventory where id='__pending_ship_test__')<>6 then raise exception 'Cancel failed to restore exact source buckets'; end if;
 if not exists(select 1 from public.app_state a cross join lateral jsonb_array_elements(a.data->'ch_reservations') r where a.id='cherop_main' and r->>'id'='__pending_rsv_qa__' and r->>'qty'='8') then raise exception 'Original reservation not restored'; end if;
 if exists(select 1 from public.app_state a cross join lateral jsonb_each(a.data->'inventory_pending_reviews') r where a.id='cherop_main' and r.value->>'sale_id'='ship-__pending_test__' and r.value->>'status'='open') then raise exception 'Cancelled review remains open'; end if;
 result:=public.apply_inventory_sales_v2('[]','[{"id":"ship-__pending_test__"}]');
 if (select total_stock from public.inventory where id='__pending_ship_test__')<>100 then raise exception 'Cancel retry duplicated stock'; end if;
 -- A stale modal cannot approve a different pending quantity.
 preview:=public.apply_inventory_sales_v2(rows);token:=preview->>'confirmation';
 update public.inventory set produced_stock=9,pending_production=91,available_stock=3 where id='__pending_ship_test__';
 result:=public.apply_inventory_sales_v2(rows,'[]',token);
 if result->>'needs_confirmation'<>'true' or result->'pending_rows'->0->>'pending_quantity'<>'6'
   or exists(select 1 from public.sales_log where id='ship-__pending_test__')
   or (select produced_stock from public.inventory where id='__pending_ship_test__')<>9 then raise exception 'Stale confirmation was applied'; end if;
 update public.inventory set produced_stock=10,pending_production=90,available_stock=4 where id='__pending_ship_test__';
 -- Other channels' reserved 20 units cannot be used, even though total stock is 100.
 begin perform public.apply_inventory_sales_v2(jsonb_set(rows,'{0,quantity}','81')); exception when others then
   if sqlerrm not like '판매 가능 재고 부족:%' then raise; end if; failures:=failures+1; end;
 if failures<>2 then raise exception 'Other channel reservation was borrowed'; end if;
 begin perform public.apply_inventory_sales_v2(rows||jsonb_set(jsonb_set(rows,'{0,id}','"ship-__pending_second__"'),'{0,quantity}','80')); exception when others then
   if sqlerrm not like '판매 가능 재고 부족:%' then raise; end if; failures:=failures+1; end;
 if failures<>3 or (select total_stock from public.inventory where id='__pending_ship_test__')<>100
   or exists(select 1 from public.sales_log where product_id='__pending_ship_test__') then raise exception 'Batch partially committed'; end if;
 begin perform public.apply_inventory_sales_v1(rows); exception when others then
   if sqlerrm not like '대기재고 차감 확인이 필요합니다.%' then raise; end if; failures:=failures+1; end;
 if failures<>4 then raise exception 'Old client bypassed pending confirmation'; end if;
 -- A fully completed-stock shipment requires no modal and also gets an exact source ledger.
 result:=public.apply_inventory_sales_v2(jsonb_set(rows,'{0,quantity}','2'));
 if result->>'needs_confirmation'<>'false' or (select total_stock from public.inventory where id='__pending_ship_test__')<>98 then raise exception 'Normal shipment failed'; end if;
 result:=public.apply_inventory_sales_v1('[]','[{"id":"ship-__pending_test__"}]');
 if (select total_stock from public.inventory where id='__pending_ship_test__')<>100 then raise exception 'Old-tab cancellation lost source ledger'; end if;
 -- Stale tabs and ordinary work editors cannot erase the protected history.
 begin update public.app_state set data=baseline where id='cherop_main'; exception when others then
   if sqlerrm not like '출고 확인 이력이 변경됐습니다.%' then raise; end if; failures:=failures+1; end;
 if failures<>5 then raise exception 'Stale state overwrote shipment history'; end if;
 begin update public.app_state set data=jsonb_set(data,'{work_logs}','[]') where id='cherop_main'; exception when others then
   if sqlerrm not like '출고 확인 이력이 변경됐습니다.%' then raise; end if; failures:=failures+1; end;
 if failures<>6 then raise exception 'Linked work history was erased'; end if;
 update public.app_state set data=jsonb_set(data,'{__pending_test_note}','"ordinary save remains usable"') where id='cherop_main';
end $$;
rollback;
select 'PASS: completed-first + pending confirmation, preview rollback, confirmed readback, exact-source partial/full cancellation, reservation isolation/restoration, retries, completion without stock change, linked work history, stale consent, batch rollback and old-client compatibility; fixtures rolled back' as result;
