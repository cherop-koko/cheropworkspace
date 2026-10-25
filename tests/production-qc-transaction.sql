-- Integration test: all fixture changes roll back, including stock, channels and JSON state.
begin;
set local lock_timeout='5s';
set local role anon;
do $$
declare pid text; baseline jsonb; before_retry jsonb; expected jsonb; result jsonb; current_data jsonb; failures integer:=0;
begin
 select product_id into strict pid from public.inventory order by id limit 1;
 select data into baseline from public.app_state where id='cherop_main' for update;
 expected:=jsonb_build_array(jsonb_build_object('id','qa-legacy','product_id',pid,'qty',5,'status','pending','type','production','date','2026-10-17','memo','preserve memo','photo_urls',jsonb_build_array('https://example.com/qc-test.png'),'extra','retain'));
 perform set_config('workspace.stock_write','atomic',true);
 update public.app_state set data=jsonb_set(jsonb_set(data,'{prod_defects}',expected),'{ch_reservations}',jsonb_build_array(jsonb_build_object('id','qa-reservation','product_id',pid,'qty',3,'channel','__qc_transaction_test__','createdAt','2026-01-01'))),updated_at=clock_timestamp() where id='cherop_main';
 perform set_config('workspace.stock_write','',true);
 update public.inventory set total_stock=15,produced_stock=5,pending_production=10,available_stock=5 where product_id=pid;
 result:=public.resolve_production_defects_v1(expected,2,1,'qa-operation-partial-0001');
 if result->>'pending'<>'2' or result->>'allocated'<>'3' then raise exception 'partial result failed'; end if;
 select data into current_data from public.app_state where id='cherop_main';
 if (select sum((x->>'qty')::int) from jsonb_array_elements(current_data->'prod_defects') x)<>5 then raise exception 'quantity conservation failed'; end if;
 if not exists(select 1 from jsonb_array_elements(current_data->'prod_defects') x where x->>'id'='qa-legacy' and x->>'status'='pending' and x->>'qty'='2' and x->>'memo'='preserve memo' and x->>'extra'='retain') then raise exception 'original record preservation failed'; end if;
 if exists(select 1 from jsonb_array_elements(current_data->'prod_defects') x where x->'photo_urls' is distinct from expected->0->'photo_urls') then raise exception 'photos lost'; end if;
 if current_data-'prod_defects'-'ch_reservations' is distinct from baseline-'prod_defects'-'ch_reservations' then raise exception 'unrelated main data changed'; end if;
 if not exists(select 1 from public.inventory where product_id=pid and total_stock=17 and produced_stock=7 and pending_production=10 and available_stock=4) then raise exception 'stock failed'; end if;
 if not exists(select 1 from public.channel_inventory where product_id=pid and channel='__qc_transaction_test__' and stock=3) then raise exception 'FIFO allocation failed'; end if;
 before_retry:=current_data; result:=public.resolve_production_defects_v1(expected,2,1,'qa-operation-partial-0001');
 if result->>'already_applied'<>'true' then raise exception 'idempotency failed'; end if;
 if (select data from public.app_state where id='cherop_main') is distinct from before_retry then raise exception 'retry changed data'; end if;
 begin perform public.resolve_production_defects_v1(expected,1,0,'qa-operation-stale-0002'); exception when others then failures:=failures+1; end;
 select jsonb_agg(x) into expected from jsonb_array_elements(current_data->'prod_defects') x where x->>'status'='pending';
 begin perform public.resolve_production_defects_v1(expected,3,0,'qa-operation-excess-0003'); exception when others then failures:=failures+1; end;
 if failures<>2 then raise exception 'stale/overdraw protection failed'; end if;
 if (select data from public.app_state where id='cherop_main') is distinct from before_retry then raise exception 'failed saves changed data'; end if;
 -- Simulated inventory-write failure must undo all partial QC changes.
 begin
  delete from public.inventory where product_id=pid;
  perform public.resolve_production_defects_v1(expected,1,0,'qa-operation-missing-0004');
  raise exception 'missing inventory unexpectedly succeeded' using errcode='P9999';
 exception when no_data_found then failures:=failures+1;
 end;
 if failures<>3 or (select data from public.app_state where id='cherop_main') is distinct from before_retry then raise exception 'atomic failure protection failed'; end if;
 -- Finish the remainder with disposal only; no stock increment.
 result:=public.resolve_production_defects_v1(expected,0,2,'qa-operation-dispose-0005');
 if result->>'pending'<>'0' or (select produced_stock from public.inventory where product_id=pid)<>7 then raise exception 'disposal-only failed'; end if;
end $$;
rollback;
select 'PASS: invoker role, partial quantities, retained IDs/memos/photos, FIFO allocation, unchanged unrelated data, duplicate retry, stale/overdraw rejection, failure rollback, disposal-only' as result;
