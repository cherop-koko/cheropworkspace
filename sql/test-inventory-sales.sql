begin;
insert into public.products(id,name,option_name,disc_status,is_discontinued) values('__inventory_test__','재고 트랜잭션 검증','S','active',false);
insert into public.inventory(id,product_id,total_stock,produced_stock,pending_production,available_stock) values('__inventory_test__','__inventory_test__',120,100,20,40);
insert into public.channel_inventory(id,product_id,channel,stock) values('__inventory_test__','__inventory_test__','QA',60);
do $$
declare r jsonb; n integer;
begin
 r:='[{"id":"sale-__inventory_test__","product_id":"__inventory_test__","channel":"QA","quantity":10,"amount":1000,"sale_date":"2026-11-02"}]';
 perform public.apply_inventory_sales_v1(r);
 perform public.apply_inventory_sales_v1(r);
 if (select total_stock from inventory where id='__inventory_test__')<>110 then raise exception 'Retry double deducted'; end if;
 perform public.apply_inventory_sales_v1(jsonb_set(r,'{0,quantity}','4'));
 if (select total_stock from inventory where id='__inventory_test__')<>116 then raise exception 'Quantity edit failed'; end if;
 if (select sum(stock) from channel_inventory where product_id='__inventory_test__')<>56 then raise exception 'Allocation edit failed'; end if;
 -- A good row followed by insufficient stock must roll back the whole batch.
 begin
   perform public.apply_inventory_sales_v1('[{"id":"sale-__inventory_test_good__","product_id":"__inventory_test__","channel":"QA","quantity":1,"amount":1,"sale_date":"2026-11-02"},{"id":"sale-__inventory_test_bad__","product_id":"__inventory_test__","channel":"QA","quantity":999,"amount":1,"sale_date":"2026-11-02"}]');
   raise exception 'Expected insufficient stock failure';
 exception when others then
   if sqlerrm not like '판매 가능 재고 부족:%' then raise; end if;
 end;
 if exists(select 1 from sales_log where id='sale-__inventory_test_good__') or (select total_stock from inventory where id='__inventory_test__')<>116 then raise exception 'Partial batch commit'; end if;
 -- Changing a channel restores the old allocation and uses unallocated stock.
 perform public.apply_inventory_sales_v1(jsonb_set(jsonb_set(r,'{0,quantity}','4'),'{0,channel}','"QA2"'));
 if (select total_stock from inventory where id='__inventory_test__')<>116 then raise exception 'Channel edit changed total'; end if;
 perform public.apply_inventory_sales_v1('[]','[{"id":"sale-__inventory_test__"}]');
 if (select total_stock from inventory where id='__inventory_test__')<>120 then raise exception 'Delete did not restore'; end if;
 perform public.apply_inventory_sales_v1('[]','[{"id":"sale-__inventory_test__"}]');
 if (select total_stock from inventory where id='__inventory_test__')<>120 then raise exception 'Delete retry duplicated stock'; end if;
 -- A legacy ID is updated in place and is not deducted a second time.
 perform public.apply_inventory_sales_v1(r);
 r:=jsonb_set(r,'{0,id}','"sale-__inventory_test_new__"');
 r:=jsonb_set(r,'{0,legacy_ids}','["sale-__inventory_test__"]');
 perform public.apply_inventory_sales_v1(r);
 if (select total_stock from inventory where id='__inventory_test__')<>110 or exists(select 1 from sales_log where id='sale-__inventory_test_new__') then raise exception 'Legacy alias double deducted'; end if;
 if (select amount from channel_sales_log where id='csl-2026-11-02-QA-__inventory_test__')<>1000 then raise exception 'Revenue retry duplicated'; end if;
 -- Oversubscribed channel allocations are an error, not a zero-clamp success.
 update channel_inventory set stock=999 where id='__inventory_test__';
 begin
   perform public.apply_inventory_sales_v1(jsonb_set(r,'{0,quantity}','11'));
   raise exception 'Expected inventory mismatch';
 exception when others then if sqlerrm not like '재고 확인 필요:%' then raise; end if; end;
end $$;
rollback;
select 'PASS: retry, quantity edit, channel edit, cancellation, legacy alias, revenue and batch rollback; test rows rolled back' as result;
