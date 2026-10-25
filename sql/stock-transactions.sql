-- Atomic stock operations, with caller permissions. Auth/RLS cutover is separate.
create schema if not exists workspace_stock_internal;
revoke all on schema workspace_stock_internal from public;
grant usage on schema workspace_stock_internal to anon,authenticated;

create or replace function workspace_stock_internal.check_inventory(p_id text) returns public.inventory
language plpgsql security invoker set search_path='' as $$
declare i public.inventory; ch bigint;
begin
 select * into strict i from public.inventory where product_id=p_id for update;
 select coalesce(sum(stock),0) into ch from public.channel_inventory where product_id=p_id;
 if least(i.total_stock,i.produced_stock,i.pending_production,i.available_stock)<0 or
 i.total_stock<>i.produced_stock+i.pending_production or i.produced_stock<>i.available_stock+ch then
  raise exception '재고 수량 확인 필요: % (총 %, 상품화 %, 대기 %, 가용 %, 채널 %). 실사 또는 원본 이력을 확인해주세요.',p_id,i.total_stock,i.produced_stock,i.pending_production,i.available_stock,ch;
 end if;
 if exists(select 1 from public.channel_inventory where product_id=p_id and stock<0) then raise exception '음수 채널 재고가 있습니다.';end if;
 if exists(select 1 from public.channel_inventory where product_id=p_id group by channel having count(*)>1) then raise exception '채널 재고가 중복되었습니다.';end if;
 return i;
end $$;

create or replace function workspace_stock_internal.move(p_id text,p_channel text,p_qty integer,p_undo jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare i public.inventory; s jsonb; reservations jsonb; rv jsonb; used jsonb:='[]'; out_r jsonb:='[]';
 ch integer:=0; av integer:=0; rs integer:=0; n integer; left_n integer; ch_id text;
begin
 if p_qty is null or p_qty<1 or nullif(p_channel,'') is null then raise exception '출고 채널과 양의 정수 수량을 확인해주세요.';end if;
 select data into strict s from public.app_state where id='cherop_main' for update;
 i:=workspace_stock_internal.check_inventory(p_id);
 select id,stock into ch_id,ch from public.channel_inventory where product_id=p_id and channel=p_channel for update;
 ch:=coalesce(ch,0);reservations:=coalesce(s->'ch_reservations','[]');
 if p_undo is null then
  if i.total_stock<p_qty then raise exception '총재고가 부족합니다. (%개 / 출고 %개)',i.total_stock,p_qty;end if;
  ch:=least(ch,p_qty);left_n:=p_qty-ch;
  for rv in select value from jsonb_array_elements(reservations) order by value->>'createdAt',value->>'id' loop
   n:=0;
   if rv->>'product_id'=p_id and rv->>'channel'=p_channel and left_n>0 then
    n:=least(greatest((rv->>'qty')::integer,0),left_n,i.pending_production-rs);
    if n>0 then used:=used||jsonb_build_array(rv||jsonb_build_object('qty',n));rs:=rs+n;left_n:=left_n-n;end if;
   end if;
   if n=0 then out_r:=out_r||jsonb_build_array(rv);
   elsif (rv->>'qty')::integer-n>0 then out_r:=out_r||jsonb_build_array(rv||jsonb_build_object('qty',(rv->>'qty')::integer-n));end if;
  end loop;
  av:=left_n;
  if av>i.available_stock then raise exception '출고 가능한 재고가 부족합니다. 채널 실재고·예약·미배분 재고를 확인해주세요.';end if;
  update public.inventory set total_stock=total_stock-p_qty,produced_stock=produced_stock-ch-av,pending_production=pending_production-rs,available_stock=available_stock-av,updated_at=clock_timestamp() where id=i.id;
  if ch>0 then update public.channel_inventory set stock=stock-ch,updated_at=clock_timestamp() where id=ch_id;end if;
  update public.app_state set data=jsonb_set(data,'{ch_reservations}',out_r),updated_at=clock_timestamp() where id='cherop_main';
  return jsonb_build_object('quantity',p_qty,'channel_qty',ch,'available_qty',av,'reserved_qty',rs,'reservations',used);
 else
  ch:=(p_undo->>'channel_qty')::integer;av:=(p_undo->>'available_qty')::integer;rs:=(p_undo->>'reserved_qty')::integer;
  if ch is null or av is null or rs is null or least(ch,av,rs)<0 or ch+av+rs<>p_qty then raise exception '출고 복원 정보가 일치하지 않습니다.';end if;
  for rv in select value from jsonb_array_elements(coalesce(p_undo->'reservations','[]')) loop
   if exists(select 1 from jsonb_array_elements(reservations)x where x->>'id'=rv->>'id' and (x->>'product_id'<>p_id or x->>'channel'<>p_channel)) then raise exception '예약 원본이 변경되어 복원할 수 없습니다.';end if;
   if exists(select 1 from jsonb_array_elements(reservations)x where x->>'id'=rv->>'id') then
    select jsonb_agg(case when x->>'id'=rv->>'id' then x||jsonb_build_object('qty',(x->>'qty')::integer+(rv->>'qty')::integer) else x end) into reservations from jsonb_array_elements(reservations)x;
   else reservations:=reservations||jsonb_build_array(rv);end if;
  end loop;
  update public.inventory set total_stock=total_stock+p_qty,produced_stock=produced_stock+ch+av,pending_production=pending_production+rs,available_stock=available_stock+av,updated_at=clock_timestamp() where id=i.id;
  if ch>0 then
   if ch_id is null then insert into public.channel_inventory(id,product_id,channel,stock)values('chinv_'||p_id||'_'||p_channel,p_id,p_channel,ch);
   else update public.channel_inventory set stock=stock+ch,updated_at=clock_timestamp() where id=ch_id;end if;
  end if;
  update public.app_state set data=jsonb_set(data,'{ch_reservations}',reservations),updated_at=clock_timestamp() where id='cherop_main';
  return jsonb_build_object('restored',p_qty);
 end if;
end $$;

create or replace function workspace_stock_internal.fulfill(p_id text) returns integer
language plpgsql security invoker set search_path='' as $$
declare i public.inventory; s jsonb; rv jsonb; res jsonb:='[]'; n integer; left_n integer; moved integer:=0; ch_id text;
begin
 select data into strict s from public.app_state where id='cherop_main' for update;
 i:=workspace_stock_internal.check_inventory(p_id);left_n:=i.available_stock;
 for rv in select value from jsonb_array_elements(coalesce(s->'ch_reservations','[]')) order by value->>'createdAt',value->>'id' loop
  n:=0;
  if rv->>'product_id'=p_id and left_n>0 then
   n:=least(greatest((rv->>'qty')::integer,0),left_n);
   if n>0 then
    if nullif(rv->>'channel','') is null then raise exception '예약 채널을 확인해주세요.';end if;
    select id into ch_id from public.channel_inventory where product_id=p_id and channel=rv->>'channel';
    if found then update public.channel_inventory set stock=stock+n,updated_at=clock_timestamp() where id=ch_id;
    else insert into public.channel_inventory(id,product_id,channel,stock)values('chinv_'||p_id||'_'||(rv->>'channel'),p_id,rv->>'channel',n);end if;
    left_n:=left_n-n;moved:=moved+n;
   end if;
  end if;
  if n=0 then res:=res||jsonb_build_array(rv);
  elsif (rv->>'qty')::integer-n>0 then res:=res||jsonb_build_array(rv||jsonb_build_object('qty',(rv->>'qty')::integer-n));end if;
 end loop;
 if moved>0 then
  update public.inventory set available_stock=left_n,updated_at=clock_timestamp() where id=i.id;
  update public.app_state set data=jsonb_set(data,'{ch_reservations}',res),updated_at=clock_timestamp() where id='cherop_main';
 end if;
 return moved;
end $$;

create or replace function public.workspace_stock_v2(p_operation text,p_action text,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s jsonb; request jsonb:=jsonb_build_object('action',p_action,'payload',p_payload); prior jsonb; result jsonb;
 r jsonb; old public.sales_log; movement jsonb; pid text; cid text; rec_id text; qty integer; total_n integer:=0; changed integer:=0;
 i public.inventory; desired jsonb; channel_row record; pool integer; actual integer; reserved integer; reserved_total integer:=0;
 res jsonb:='[]'; rv jsonb; snap jsonb; old_qty integer; diff integer; work jsonb; moved integer:=0; previous_guard text;
begin
 if p_operation is null or length(p_operation)<16 or length(p_operation)>100 then raise exception '처리 번호를 확인해주세요.';end if;
 perform pg_advisory_xact_lock(1847810424);
 select data into prior from public.app_state where id='cherop_stock_operation_'||p_operation;
 if found then
  if prior->'request' is distinct from request then raise exception '같은 처리 번호로 다른 요청을 보낼 수 없습니다.';end if;
  return prior->'result';
 end if;
 select data into strict s from public.app_state where id='cherop_main' for update;
 previous_guard:=coalesce(current_setting('workspace.stock_write',true),'');
 perform set_config('workspace.stock_write','atomic',true);
 if p_action='shipments' then
  if jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows')<1 then raise exception '출고 내역이 없습니다.';end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'rows')x group by x->>'id' having count(*)>1) then raise exception '같은 출고 번호가 중복되었습니다.';end if;
  for r in select value from jsonb_array_elements(p_payload->'rows') order by value->>'id' loop
   rec_id:=r->>'id';pid:=r->>'product_id';cid:=r->>'channel';qty:=(r->>'quantity')::integer;
   if nullif(rec_id,'') is null or qty is null or qty<0 or nullif(cid,'') is null or nullif(pid,'') is null or r->>'sale_date' is null then raise exception '출고 항목을 확인해주세요.';end if;
   select * into old from public.sales_log where id=rec_id for update;
   if found and p_payload->>'mode'='insert' then raise exception '이미 등록된 출고 번호입니다.';end if;
   if old.id is not null and r ? 'expected' and to_jsonb(old) is distinct from r->'expected' then raise exception '출고 내역이 변경됐습니다. 다시 열어주세요.';end if;
   if old.id is null or old.product_id is distinct from pid or old.channel is distinct from cid or old.quantity is distinct from qty then
    if old.id is not null and old.quantity>0 then
     select data into movement from public.app_state where id='cherop_stock_movement_'||rec_id;
     if not found then raise exception '이전 출고의 재고 차감 구분이 남아 있지 않습니다. 원본 이력 확인 후 수정해주세요. (%)',rec_id;end if;
     perform workspace_stock_internal.move(old.product_id,old.channel,old.quantity,movement);
    end if;
    if qty>0 then movement:=workspace_stock_internal.move(pid,cid,qty);
    else movement:=jsonb_build_object('quantity',0,'channel_qty',0,'available_qty',0,'reserved_qty',0,'reservations','[]'::jsonb);end if;
    insert into public.app_state(id,data,updated_at)values('cherop_stock_movement_'||rec_id,movement,clock_timestamp()) on conflict(id)do update set data=excluded.data,updated_at=excluded.updated_at;
    changed:=changed+1;
   end if;
   insert into public.sales_log(id,product_id,channel,quantity,amount,sale_date,created_at)
    values(rec_id,pid,cid,qty,coalesce((r->>'amount')::bigint,0),(r->>'sale_date')::date,coalesce((r->>'created_at')::timestamptz,clock_timestamp()))
    on conflict(id)do update set product_id=excluded.product_id,channel=excluded.channel,quantity=excluded.quantity,amount=excluded.amount,sale_date=excluded.sale_date;
   total_n:=total_n+1;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_payload->'revenues','[]')) loop
   insert into public.channel_sales_log(id,channel,date,amount,note)values(r->>'id',r->>'channel',(r->>'date')::date,(r->>'amount')::bigint,r->>'note') on conflict(id)do update set channel=excluded.channel,date=excluded.date,amount=excluded.amount,note=excluded.note;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_payload->'mappings','[]')) loop
   if not exists(select 1 from public.channel_product_mapping where product_id=r->>'product_id' and channel=r->>'channel' and channel_name=r->>'channel_name') then
    insert into public.channel_product_mapping(id,product_id,channel,channel_name)values(r->>'id',r->>'product_id',r->>'channel',r->>'channel_name');end if;
  end loop;
  result:=jsonb_build_object('rows',total_n,'stock_changed',changed);
 elsif p_action='delete_shipment' then
  rec_id:=p_payload->>'id';select * into strict old from public.sales_log where id=rec_id for update;
  if to_jsonb(old) is distinct from p_payload->'expected' then raise exception '출고 내역이 변경됐습니다. 다시 열어주세요.';end if;
  if old.quantity>0 then
   select data into movement from public.app_state where id='cherop_stock_movement_'||rec_id;
   if not found then raise exception '이전 출고의 차감 구분을 확인할 수 없습니다. 원본 이력 확인이 필요합니다.';end if;
   perform workspace_stock_internal.move(old.product_id,old.channel,old.quantity,movement);
  end if;
  delete from public.sales_log where id=rec_id;
  delete from public.app_state where id='cherop_stock_movement_'||rec_id;
  result:=jsonb_build_object('restored',old.quantity);
 elsif p_action='allocate' then
  pid:=p_payload->>'product_id';desired:=p_payload->'desired';
  select * into strict i from public.inventory where product_id=pid for update;
  select jsonb_build_object('inventory',to_jsonb(i),'channels',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.channel_inventory c where c.product_id=pid),'[]'),'reservations',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(coalesce(s->'ch_reservations','[]'))x where x->>'product_id'=pid),'[]')) into snap;
  prior:=p_payload->'expected';
  prior:=jsonb_set(prior,'{channels}',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(prior->'channels')x),'[]'));
  prior:=jsonb_set(prior,'{reservations}',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(prior->'reservations')x),'[]'));
  if snap is distinct from prior then raise exception '재고가 변경됐습니다. 배분 창을 다시 열어주세요.';end if;
  if i.total_stock<>i.produced_stock+i.pending_production or least(i.total_stock,i.produced_stock,i.pending_production)<0 then raise exception '총재고와 상품화 수량을 먼저 확인해주세요.';end if;
  if jsonb_typeof(desired) is distinct from 'object' or exists(select 1 from jsonb_each_text(desired)where value is null or value!~'^[0-9]+$' or key='') then raise exception '배분 수량은 0 이상의 정수여야 합니다.';end if;
  if jsonb_typeof(p_payload->'channels') is distinct from 'array' or exists(select 1 from jsonb_array_elements_text(p_payload->'channels')x group by x having count(*)>1) or (select count(*)from jsonb_object_keys(desired))<>(select count(*)from jsonb_array_elements(p_payload->'channels')) then raise exception '채널 목록을 확인해주세요.';end if;
  if exists(select 1 from public.channel_inventory where product_id=pid group by channel having count(*)>1) then raise exception '중복 채널 재고를 먼저 확인해주세요.';end if;
  pool:=i.produced_stock-coalesce((select sum(stock)from public.channel_inventory where product_id=pid and not desired ? channel),0);
  if pool<0 then raise exception '기존 채널 배분이 상품화 수량을 초과했습니다.';end if;
  select coalesce(jsonb_agg(x),'[]') into res from jsonb_array_elements(coalesce(s->'ch_reservations','[]'))x where x->>'product_id'<>pid or not desired ? (x->>'channel');
  select coalesce(sum((x->>'qty')::integer),0) into reserved_total from jsonb_array_elements(res)x where x->>'product_id'=pid;
  for channel_row in select value as channel from jsonb_array_elements_text(p_payload->'channels') loop
   cid:=channel_row.channel;qty:=(desired->>cid)::integer;if qty is null then raise exception '채널 수량이 없습니다.';end if;
   actual:=least(qty,pool);reserved:=qty-actual;pool:=pool-actual;reserved_total:=reserved_total+reserved;
   select id into rec_id from public.channel_inventory where product_id=pid and channel=cid;
   if found then update public.channel_inventory set stock=actual,updated_at=clock_timestamp() where id=rec_id;
   else insert into public.channel_inventory(id,product_id,channel,stock)values('chinv_'||pid||'_'||cid,pid,cid,actual);end if;
   old_qty:=reserved;
   for rv in select value from jsonb_array_elements(coalesce(s->'ch_reservations','[]')) where value->>'product_id'=pid and value->>'channel'=cid order by value->>'createdAt',value->>'id' loop
    exit when old_qty<=0;qty:=least((rv->>'qty')::integer,old_qty);if qty>0 then res:=res||jsonb_build_array(rv||jsonb_build_object('qty',qty));old_qty:=old_qty-qty;end if;
   end loop;
   if old_qty>0 then res:=res||jsonb_build_array(jsonb_build_object('id','rsv_'||gen_random_uuid(),'product_id',pid,'channel',cid,'qty',old_qty,'createdAt',clock_timestamp()));end if;
  end loop;
  if reserved_total>i.pending_production then raise exception '예약 %개가 상품화 대기 %개를 초과합니다.',reserved_total,i.pending_production;end if;
  update public.inventory set available_stock=pool,updated_at=clock_timestamp() where id=i.id;
  update public.app_state set data=jsonb_set(data,'{ch_reservations}',res),updated_at=clock_timestamp() where id='cherop_main';
  perform workspace_stock_internal.check_inventory(pid);
  result:=jsonb_build_object('reserved',reserved_total,'available',pool);
 elsif p_action='fulfill' then
  moved:=workspace_stock_internal.fulfill(p_payload->>'product_id');result:=jsonb_build_object('allocated',moved);
 elsif p_action='worklog' then
  work:=p_payload->'row';rec_id:=work->>'id';pid:=work->>'product_id';qty:=(work->>'qty')::integer;
  if nullif(rec_id,'') is null or qty is null or qty<0 then raise exception '작업 수량을 확인해주세요.';end if;
  select value into prior from jsonb_array_elements(coalesce(s->'work_logs','[]'))where value->>'id'=rec_id;
  if prior is distinct from nullif(p_payload->'expected','null'::jsonb) then raise exception '작업 기록이 변경됐습니다. 다시 열어주세요.';end if;
  if prior is not null and prior->>'product_id'<>pid then raise exception '작업 상품은 변경할 수 없습니다.';end if;
  old_qty:=coalesce((prior->>'qty')::integer,0);diff:=qty-old_qty;
  i:=workspace_stock_internal.check_inventory(pid);
  if diff>i.pending_production then raise exception '상품화 대기 %개를 초과했습니다. 입고 내역을 먼저 확인해주세요.',i.pending_production;end if;
  if diff<0 and -diff>i.available_stock then raise exception '이미 채널 배분 또는 출고한 수량입니다. 배분을 해제한 후 작업 기록을 수정해주세요.';end if;
  update public.inventory set pending_production=pending_production-diff,produced_stock=produced_stock+diff,available_stock=available_stock+diff,updated_at=clock_timestamp() where id=i.id;
  select coalesce(jsonb_agg(x),'[]') into res from jsonb_array_elements(coalesce(s->'work_logs','[]'))x where x->>'id'<>rec_id;
  if qty>0 then res:=res||jsonb_build_array(work);end if;
  update public.app_state set data=jsonb_set(data,'{work_logs}',res),updated_at=clock_timestamp() where id='cherop_main';
  if diff>0 then moved:=workspace_stock_internal.fulfill(pid);end if;
  result:=jsonb_build_object('quantity',qty,'difference',diff,'allocated',moved);
 else raise exception '지원하지 않는 재고 처리입니다.';
 end if;
 insert into public.app_state(id,data,updated_at)values('cherop_stock_operation_'||p_operation,jsonb_build_object('request',request,'result',result),clock_timestamp());
 perform set_config('workspace.stock_write',previous_guard,true);
 return result;
end $$;
revoke all on all functions in schema workspace_stock_internal from public;
grant execute on all functions in schema workspace_stock_internal to anon,authenticated;
revoke all on function public.workspace_stock_v2(text,text,jsonb) from public;
grant execute on function public.workspace_stock_v2(text,text,jsonb) to anon,authenticated;

-- Concurrency guard only: old browser tabs cannot overwrite atomic stock records.
create or replace function workspace_stock_internal.guard_state_write() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.id='cherop_main' and (new.data->'ch_reservations' is distinct from old.data->'ch_reservations' or new.data->'work_logs' is distinct from old.data->'work_logs')
 and coalesce(current_setting('workspace.stock_write',true),'')<>'atomic' then
  raise exception '예약·작업 기록이 변경됐습니다. 새로고침 후 다시 저장해주세요. 재고 변경은 전용 입력창에서 처리해야 합니다.';
 end if;
 return new;
end $$;
revoke all on function workspace_stock_internal.guard_state_write() from public;
drop trigger if exists workspace_guard_stock_state on public.app_state;
create trigger workspace_guard_stock_state before update on public.app_state for each row execute function workspace_stock_internal.guard_state_write();
