-- Synthetic data only. Run in the isolated clone first, then against the deployed function.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
insert into public.products(id,name,option_name,disc_status,is_discontinued,stock_unlimited) values
('__care_test__','첫만남케어 검증',null,'active',false,true),
('__care_tracked_test__','기프트박스 검증','소형','active',false,false);
-- Deliberately no inventory/channel row for the unlimited service.
insert into public.inventory(id,product_id,total_stock,produced_stock,pending_production,available_stock)
values('__care_tracked_test__','__care_tracked_test__',1,1,0,1);
do $$
declare rows jsonb; result jsonb; baseline jsonb; saved jsonb; failed boolean:=false;
begin
 select data into baseline from public.app_state where id='cherop_main';
 rows:='[{"id":"sale-__care_test__","product_id":"__care_test__","channel":"자사몰","quantity":10000,"amount":30000,"sale_date":"2026-11-03"}]';
 result:=public.apply_inventory_sales_v2(rows);
 if result->>'needs_confirmation'<>'false' or (select quantity from public.sales_log where id='sale-__care_test__')<>10000 then raise exception 'Unlimited shipment failed'; end if;
 if (select amount from public.channel_sales_log where id='csl-2026-11-03-자사몰-__care_test__')<>30000 then raise exception 'Revenue not recorded'; end if;
 select data into saved from public.app_state where id='cherop_main';
 if coalesce(saved->'inventory_pending_reviews','{}') is distinct from coalesce(baseline->'inventory_pending_reviews','{}')
 or coalesce(saved->'ch_reservations','[]') is distinct from coalesce(baseline->'ch_reservations','[]') then raise exception 'Unlimited shipment changed pending work/reservations'; end if;
 result:=public.apply_inventory_sales_v2(rows);
 if (select count(*) from public.sales_log where id='sale-__care_test__')<>1 then raise exception 'Retry duplicated shipment'; end if;
 result:=public.apply_inventory_sales_v2(jsonb_set(jsonb_set(rows,'{0,quantity}','3'),'{0,channel}','"스마트스토어"'));
 if (select quantity from public.sales_log where id='sale-__care_test__')<>3 then raise exception 'Quantity/channel edit failed'; end if;
 result:=public.apply_inventory_sales_v1('[]','[{"id":"sale-__care_test__"}]');
 if exists(select 1 from public.sales_log where id='sale-__care_test__') or exists(select 1 from public.inventory where product_id='__care_test__')
 or exists(select 1 from public.channel_inventory where product_id='__care_test__') then raise exception 'Cancellation created physical stock'; end if;
 -- Pre-ledger service history can be edited/cancelled without inventing stock.
 insert into public.sales_log(id,product_id,channel,quantity,amount,sale_date) values('ship-__care_legacy__','__care_test__','자사몰',2,0,'2026-11-02');
 result:=public.apply_inventory_sales_v2('[]','[{"id":"ship-__care_legacy__"}]');
 if exists(select 1 from public.inventory where product_id='__care_test__') or exists(select 1 from public.channel_inventory where product_id='__care_test__') then raise exception 'Legacy service cancellation created stock'; end if;
 -- Mixed batches stay atomic. Error names identify the tracked product and option.
 begin
   perform public.apply_inventory_sales_v2(rows||'[{"id":"ship-__care_short__","product_id":"__care_tracked_test__","channel":"자사몰","quantity":2,"amount":0,"sale_date":"2026-11-03"}]'::jsonb);
 exception when others then
   if sqlerrm not like '판매 가능 재고 부족: 기프트박스 검증 · 소형 / 자사몰 (해당 채널 출고 가능 완료 1개,%' or position('__care_tracked_test__' in sqlerrm)>0 then raise; end if;
   failed:=true;
 end;
 if not failed or exists(select 1 from public.sales_log where id='sale-__care_test__') or (select total_stock from public.inventory where id='__care_tracked_test__')<>1 then raise exception 'Mixed batch partially saved or oversold'; end if;
 result:=public.apply_inventory_sales_v2(rows||'[{"id":"ship-__care_tracked__","product_id":"__care_tracked_test__","channel":"자사몰","quantity":1,"amount":0,"sale_date":"2026-11-03"}]'::jsonb);
 if (select total_stock from public.inventory where id='__care_tracked_test__')<>0 then raise exception 'Tracked stock no longer deducted'; end if;
 result:=public.apply_inventory_sales_v2('[]','[{"id":"ship-__care_tracked__"},{"id":"sale-__care_test__"}]');
 if (select total_stock from public.inventory where id='__care_tracked_test__')<>1 then raise exception 'Tracked restoration changed'; end if;
end $$;
rollback;
select 'PASS: unlimited/no inventory row, quantity and revenue save, retry, quantity/channel edit, new/legacy cancellation without stock inflation, named shortage error, mixed-batch rollback and tracked deduction/restoration; test data rolled back' result;
