-- Synthetic records only. Every write, including app_state changes, is rolled back.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
insert into public.products(id,name,option_name,disc_status,is_discontinued)
values('__shipment_availability_test__','출고 가능 수량 검증','S','active',false);
insert into public.inventory(id,product_id,total_stock,produced_stock,pending_production,available_stock)
values('__shipment_availability_test__','__shipment_availability_test__',572,171,401,0);
insert into public.channel_inventory(id,product_id,channel,stock)
values('__shipment_availability_test__','__shipment_availability_test__','QA',174);
do $$
declare r jsonb; result jsonb; before_reservations jsonb;
begin
 update public.app_state set data=jsonb_set(data,'{ch_reservations}',coalesce(data->'ch_reservations','[]')||
 '[{"id":"__qa_reserve_a__","product_id":"__shipment_availability_test__","channel":"QA","qty":21},
 {"id":"__qa_reserve_b__","product_id":"__shipment_availability_test__","channel":"QB","qty":50},
 {"id":"__qa_reserve_c__","product_id":"__shipment_availability_test__","channel":"QC","qty":47},
 {"id":"__qa_reserve_d__","product_id":"__shipment_availability_test__","channel":"QD","qty":8}]'::jsonb) where id='cherop_main';
 select data->'ch_reservations' into before_reservations from public.app_state where id='cherop_main';
 r:='[{"id":"ship-__availability_test__","product_id":"__shipment_availability_test__","channel":"QA","quantity":1,"amount":0,"sale_date":"2026-11-03"}]';
 result:=public.apply_inventory_sales_v1(r);
 if jsonb_array_length(result->'inventory_warnings')<>1 then raise exception 'Allocation warning missing'; end if;
 if (select quantity from public.sales_log where id='ship-__availability_test__')<>1
    or (select produced_stock from public.inventory where id='__shipment_availability_test__')<>170
    or (select total_stock from public.inventory where id='__shipment_availability_test__')<>571
    or (select stock from public.channel_inventory where id='__shipment_availability_test__')<>173 then
   raise exception 'Stock-backed shipment not saved correctly';
 end if;
 if (select data->'ch_reservations' from public.app_state where id='cherop_main') is distinct from before_reservations then raise exception 'Reservation quantities changed'; end if;
 perform public.apply_inventory_sales_v1(r);
 if (select produced_stock from public.inventory where id='__shipment_availability_test__')<>170 then raise exception 'Retry double deducted'; end if;
 perform public.apply_inventory_sales_v1(jsonb_set(r,'{0,quantity}','2'));
 if (select produced_stock from public.inventory where id='__shipment_availability_test__')<>169 then raise exception 'Quantity delta incorrect'; end if;
 perform public.apply_inventory_sales_v1('[]','[{"id":"ship-__availability_test__"}]');
 if (select produced_stock from public.inventory where id='__shipment_availability_test__')<>171
    or (select total_stock from public.inventory where id='__shipment_availability_test__')<>572
    or (select stock from public.channel_inventory where id='__shipment_availability_test__')<>174 then raise exception 'Cancel did not restore original channel and quantities'; end if;
 if (select data->'ch_reservations' from public.app_state where id='cherop_main') is distinct from before_reservations then raise exception 'Cancel changed reservations'; end if;
 -- Channel allocations and reservations cannot create additional physical units.
 begin
   perform public.apply_inventory_sales_v1(jsonb_set(r,'{0,quantity}','172'));
   raise exception 'Expected physical shortage';
 exception when others then if sqlerrm not like '판매 가능 재고 부족:%' then raise; end if; end;
 -- Even a falsely high stored available count cannot borrow another channel's stock.
 update public.inventory set available_stock=999 where id='__shipment_availability_test__';
 begin
   perform public.apply_inventory_sales_v1(jsonb_set(r,'{0,channel}','"QB"'));
   raise exception 'Expected channel shortage';
 exception when others then if sqlerrm not like '판매 가능 재고 부족:%' then raise; end if; end;
 update public.inventory set available_stock=0 where id='__shipment_availability_test__';
 -- A valid first row and excessive second row must roll back together.
 begin
   perform public.apply_inventory_sales_v1(jsonb_set(r,'{0,quantity}','160') ||
     jsonb_set(jsonb_set(r,'{0,id}','"ship-__availability_second__"'),'{0,quantity}','12'));
   raise exception 'Expected batch shortage';
 exception when others then if sqlerrm not like '판매 가능 재고 부족:%' then raise; end if; end;
 if exists(select 1 from public.sales_log where product_id='__shipment_availability_test__')
    or (select produced_stock from public.inventory where id='__shipment_availability_test__')<>171
    or (select stock from public.channel_inventory where id='__shipment_availability_test__')<>174 then raise exception 'Partial batch saved'; end if;
 -- Keep hard validation for broken physical totals.
 update public.inventory set total_stock=571 where id='__shipment_availability_test__';
 begin
   perform public.apply_inventory_sales_v1(r);
   raise exception 'Expected physical total mismatch';
 exception when others then if sqlerrm not like '재고 확인 필요:%' then raise; end if; end;
end $$;
rollback;
select 'PASS: stock-backed shipment and readback, warning, stable retry, quantity edit, same-channel cancellation, reservation preservation, physical/channel shortage, false availability, whole-batch rollback and total validation; all test records rolled back' as result;
