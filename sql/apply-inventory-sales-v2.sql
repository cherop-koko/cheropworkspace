-- One transaction for sales rows, inventory, channel allocations and revenue.
-- Invoker permissions preserve the workspace's existing table access model.
create or replace function public.apply_inventory_sales_v2(p_rows jsonb default '[]', p_delete_ids jsonb default '[]', p_confirmation text default null, p_actor jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 r jsonb; old public.sales_log%rowtype; inv public.inventory%rowtype;
 s jsonb; request_rows jsonb; affected jsonb := '[]'; rv jsonb; reservations jsonb;
 pid text; ch text; sid text; legacy text; label text; q integer; delta integer; allocated integer; take_n integer;
 total_alloc integer; free_stock integer; stock_limit integer; inventory_warnings jsonb := '{}';
 n integer := 0; remain_n integer; stock_changed boolean:=false;
 deleted boolean; pass integer; cid text;
 sources jsonb; reviews jsonb; entry jsonb; lots jsonb; lot jsonb; rv_original jsonb; review jsonb;
 source_kind text; store_id text; review_id text; actor jsonb; plan jsonb := '[]'; confirmation_token text; detail_text text;
 complete_n integer; pending_n integer; free_n integer; own_reserved integer; other_reserved integer; pending_limit integer;
 restore_n integer; lot_index integer; source_remaining integer; changed_reviews boolean:=false; snapshot jsonb;
 previous_guard text; unlimited boolean;
begin
 begin -- All preview writes are rolled back by the confirmation exception below.
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_typeof(p_delete_ids) is distinct from 'array' then raise exception '판매 입력 형식 오류'; end if;
 if jsonb_array_length(p_rows)>20000 then raise exception '한 번에 20,000행까지 처리할 수 있습니다.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cherop_inventory_sales_v1',0));
 -- Same lock order as the production/QC transaction.
 select data into s from public.app_state where id='cherop_main' for update;
 if s is null then raise exception '업무 데이터를 찾지 못했습니다.'; end if;
 sources:=coalesce(s->'inventory_sale_sources','{}'); reviews:=coalesce(s->'inventory_pending_reviews','{}');
 actor:=jsonb_build_object('id',left(coalesce(p_actor->>'id',''),100),'name',left(coalesce(p_actor->>'name',''),100));
 request_rows := p_rows || coalesce((select jsonb_agg(jsonb_build_object('id',x->>'id','delete',true,'expected',x->'expected')) from jsonb_array_elements(p_delete_ids) x),'[]');
 if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(request_rows) x) then raise exception '입력에 중복 판매 ID가 있습니다.'; end if;
 for r in select value from jsonb_array_elements(request_rows) loop
   sid:=r->>'id'; deleted:=coalesce((r->>'delete')::boolean,false);
   select name||coalesce(' · '||nullif(option_name,''),'') into label from public.products where id=r->>'product_id';
   label:=coalesce(label,'선택한 상품');
   if sid is null or length(sid)>500 then raise exception '판매 ID 오류'; end if;
   select * into old from public.sales_log where id=sid for update;
   if old.id is null and not deleted then
     if (select count(*) from public.sales_log where id in (select jsonb_array_elements_text(coalesce(r->'legacy_ids','[]'))))>1 then
       raise exception '같은 날짜·상품의 기존 판매 기록이 여러 개입니다. 중복 여부를 확인해주세요: %',label;
     end if;
     for legacy in select jsonb_array_elements_text(coalesce(r->'legacy_ids','[]')) loop
       select * into old from public.sales_log where id=legacy for update;
       if old.id is not null then
         if old.channel is distinct from r->>'channel' or old.product_id is distinct from r->>'product_id' then
           raise exception '과거 판매 ID의 채널/상품이 다릅니다. 중복 차감 방지를 위해 확인이 필요합니다: %',label;
         end if;
         exit;
       end if;
     end loop;
   end if;
   if r ? 'expected' and r->'expected'<>'null'::jsonb and
      (old.id is null or jsonb_build_object('quantity',old.quantity,'channel',old.channel,'product_id',old.product_id,'sale_date',old.sale_date,'amount',old.amount) is distinct from r->'expected') then
     raise exception '다른 작업에서 판매 기록이 바뀌었습니다. 새로고침 후 다시 시도해주세요.';
   end if;
   if deleted and old.id is null then continue; end if;
   if not deleted then
     pid:=r->>'product_id'; ch:=r->>'channel'; q:=(r->>'quantity')::integer;
     if pid is null or nullif(ch,'') is null or q is null or q<0 or r->>'sale_date' is null then raise exception '상품·채널·날짜·수량을 확인해주세요.'; end if;
     select name||coalesce(' · '||nullif(option_name,''),'') into label from public.products where id=pid;
     if not found then raise exception '상품 정보를 찾지 못했습니다. 판매 매칭을 다시 선택해주세요.'; end if;
     if exists(select 1 from public.products where id=pid and disc_status='deleted') then raise exception '삭제·통합된 상품입니다. 판매 매칭을 다시 선택해주세요: %',label; end if;
     if coalesce((s->'inventory_review'->pid->>'block_sales')::boolean,false) then raise exception '%: %',label,s->'inventory_review'->pid->>'reason'; end if;
   end if;
   store_id:=coalesce(old.id,sid);
   entry:=sources->store_id;
   if old.id is not null and entry is null then
     -- Older unlimited-service shipments never represent physical stock. Other legacy shipments retain their cancellation behavior.
     entry:=jsonb_build_object('product_id',old.product_id,'channel',old.channel,'quantity',old.quantity,'legacy',true,
       'lots',jsonb_build_array(jsonb_build_object('kind',case when exists(select 1 from public.products where id=old.product_id and stock_unlimited) then 'unlimited' else 'legacy_completed' end,'qty',old.quantity)));
   end if;
   if old.id is not null and (entry->>'product_id' is distinct from old.product_id or entry->>'channel' is distinct from old.channel
      or (entry->>'quantity')::integer is distinct from old.quantity
      or (select coalesce(sum((x->>'qty')::integer),0) from jsonb_array_elements(entry->'lots') x)<>old.quantity) then
     raise exception '출고 차감 내역이 변경됐습니다. 다시 확인해주세요.';
   end if;
   lots:=coalesce(entry->'lots','[]');
   -- Two passes restore the previous record and apply the replacement. Same-key updates use only the delta.
   for pass in 1..2 loop
     if old.id is not null and not deleted and old.product_id=r->>'product_id' and old.channel=r->>'channel' then
       if pass=1 then continue; end if;
       pid:=old.product_id; ch:=old.channel; delta:=q-old.quantity;
     elsif pass=1 then
       if old.id is null then continue; end if;
       pid:=old.product_id; ch:=old.channel; delta:=-old.quantity;
     else
       if deleted then continue; end if;
       pid:=r->>'product_id'; ch:=r->>'channel'; delta:=q;
     end if;
     if delta=0 then continue; end if;
     select name||coalesce(' · '||nullif(option_name,''),''),stock_unlimited into label,unlimited from public.products where id=pid for share;
     label:=coalesce(label,'상품 정보 없음');
     -- Unlimited services record quantity/revenue but never manufacture physical stock.
     if delta>0 and unlimited then
       lots:=lots||jsonb_build_array(jsonb_build_object('kind','unlimited','qty',delta));
       stock_changed:=true; continue;
     elsif delta<0 and not exists(select 1 from jsonb_array_elements(lots) x where x->>'kind'<>'unlimited') then
       remain_n:=-delta;
       for lot,lot_index in select value,(ordinality-1)::integer from jsonb_array_elements(lots) with ordinality order by ordinality desc loop
         exit when remain_n=0;
         restore_n:=least((lot->>'qty')::integer,remain_n);
         lots:=jsonb_set(lots,array[lot_index::text,'qty'],to_jsonb((lot->>'qty')::integer-restore_n));
         remain_n:=remain_n-restore_n;
       end loop;
       if remain_n<>0 then raise exception '%: 취소할 출고 기록 수량을 확인해주세요.',label; end if;
       select coalesce(jsonb_agg(value),'[]') into lots from jsonb_array_elements(lots) where (value->>'qty')::integer>0;
       stock_changed:=true; continue;
     end if;
     select * into inv from public.inventory where product_id=pid for update;
     if not found then raise exception '재고 기록을 찾지 못했습니다: % / %',label,ch; end if;
     perform 1 from public.channel_inventory where product_id=pid order by id for update;
     select coalesce(sum(stock),0) into total_alloc from public.channel_inventory where product_id=pid;
     select coalesce(sum(stock),0),min(id) into allocated,cid from public.channel_inventory where product_id=pid and channel=ch;
     if (select count(*) from public.channel_inventory where product_id=pid and channel=ch)>1 then raise exception '채널 배정 기록이 중복되었습니다: % / %',label,ch; end if;
     if inv.total_stock is null or inv.produced_stock is null or inv.pending_production is null or inv.available_stock is null
        or least(inv.total_stock,inv.produced_stock,inv.pending_production,inv.available_stock)<0
        or inv.total_stock<>inv.produced_stock+inv.pending_production
        or exists(select 1 from public.channel_inventory where product_id=pid and (stock is null or stock<0)) then
       raise exception '재고 확인 필요: % (상품화 완료 %, 채널 배정 %, 가용 %). 판매는 저장되지 않았습니다.',label,inv.produced_stock,total_alloc,inv.available_stock;
     end if;
     -- Historical allocation differences must not block a stock-backed shipment.
     -- Preserve the difference; never invent stock or use another channel's units.
     free_stock:=least(inv.available_stock,greatest(inv.produced_stock-total_alloc,0));
     stock_limit:=least(allocated+free_stock,greatest(inv.produced_stock-(total_alloc-allocated),0));
     if inv.produced_stock<total_alloc or inv.available_stock<>greatest(inv.produced_stock-total_alloc,0) then
       inventory_warnings:=inventory_warnings||jsonb_build_object(pid,jsonb_build_object(
         'product_id',pid,'produced_stock',inv.produced_stock,'allocated_stock',total_alloc,'available_stock',inv.available_stock));
     end if;
     if delta>0 then
       complete_n:=least(delta,stock_limit); pending_n:=delta-complete_n;
       select coalesce(sum(greatest((x->>'qty')::integer,0)) filter(where x->>'channel'=ch),0),
              coalesce(sum(greatest((x->>'qty')::integer,0)) filter(where x->>'channel' is distinct from ch),0)
       into own_reserved,other_reserved from jsonb_array_elements(coalesce(s->'ch_reservations','[]')) x where x->>'product_id'=pid;
       pending_limit:=greatest(inv.pending_production-other_reserved,0);
       if pending_n>pending_limit then
         raise exception '판매 가능 재고 부족: % / % (해당 채널 출고 가능 완료 %개, 사용 가능한 대기 %개, 요청 %개)',label,ch,stock_limit,pending_limit,delta;
       end if;
       if pending_n>0 then
         select name||coalesce(' · '||nullif(option_name,''),'') into label from public.products where id=pid;
         snapshot:=jsonb_build_object('produced',inv.produced_stock,'pending',inv.pending_production,'available',inv.available_stock,
           'allocated',allocated,'total_allocated',total_alloc,'own_reserved',own_reserved,'other_reserved',other_reserved);
         plan:=plan||jsonb_build_array(jsonb_build_object('sale_id',store_id,'product_id',pid,'product_name',label,'channel',ch,
           'quantity',delta,'completed_quantity',complete_n,'pending_quantity',pending_n,'snapshot',snapshot));
         review_id:=gen_random_uuid()::text;
       else review_id:=null;
       end if;
       take_n:=least(allocated,complete_n); free_n:=complete_n-take_n;
       if take_n>0 then
         update public.channel_inventory set stock=stock-take_n,updated_at=now() where id=cid;
         lots:=lots||jsonb_build_array(jsonb_build_object('kind','completed_allocated','qty',take_n));
       end if;
       -- Satisfy this channel's reservations first. Record every source for exact reversal.
       foreach source_kind in array array['completed_free','pending'] loop
         source_remaining:=case when source_kind='pending' then pending_n else free_n end;
         reservations:='[]';
         for rv in select value from jsonb_array_elements(coalesce(s->'ch_reservations','[]')) loop
           if rv->>'product_id'=pid and rv->>'channel'=ch and source_remaining>0 and coalesce((rv->>'qty')::integer,0)>0 then
             take_n:=least((rv->>'qty')::integer,source_remaining); rv_original:=rv;
             lots:=lots||jsonb_build_array(jsonb_build_object('kind',source_kind,'qty',take_n,'reservation',rv_original,'review_id',case when source_kind='pending' then review_id end));
             rv:=jsonb_set(rv,'{qty}',to_jsonb((rv->>'qty')::integer-take_n)); source_remaining:=source_remaining-take_n;
             if (rv->>'qty')::integer>0 then reservations:=reservations||jsonb_build_array(rv); end if;
           else reservations:=reservations||jsonb_build_array(rv);
           end if;
         end loop;
         s:=jsonb_set(s,'{ch_reservations}',reservations);
         if source_remaining>0 then lots:=lots||jsonb_build_array(jsonb_build_object('kind',source_kind,'qty',source_remaining,'review_id',case when source_kind='pending' then review_id end)); end if;
       end loop;
       update public.inventory set total_stock=total_stock-delta,produced_stock=produced_stock-complete_n,
         pending_production=pending_production-pending_n,available_stock=available_stock-free_n,updated_at=now() where id=inv.id;
       if pending_n>0 then
         reviews:=reviews||jsonb_build_object(review_id,jsonb_build_object('id',review_id,'sale_id',store_id,'product_id',pid,
           'channel',ch,'sale_date',r->>'sale_date','quantity',pending_n,'original_quantity',pending_n,'status','open',
           'created_at',now(),'created_by',actor)); changed_reviews:=true;
       end if;
     else
       remain_n:=-delta;
       -- Reverse the latest source portions first, including partial edits/cancellations.
       for lot,lot_index in select value,(ordinality-1)::integer from jsonb_array_elements(lots) with ordinality order by ordinality desc loop
         exit when remain_n=0;
         restore_n:=least((lot->>'qty')::integer,remain_n); if restore_n<=0 then continue; end if;
         source_kind:=lot->>'kind';
         if source_kind='unlimited' then
           lots:=jsonb_set(lots,array[lot_index::text,'qty'],to_jsonb((lot->>'qty')::integer-restore_n)); remain_n:=remain_n-restore_n; continue;
         end if;
         if source_kind in ('completed_allocated','legacy_completed') then
           if cid is null then
             cid:='ci-sale-'||gen_random_uuid()::text;
             insert into public.channel_inventory(id,product_id,channel,stock,updated_at) values(cid,pid,ch,restore_n,now());
           else update public.channel_inventory set stock=stock+restore_n,updated_at=now() where id=cid; end if;
         elsif source_kind not in ('completed_free','pending') then raise exception '출고 차감 원본을 확인해주세요.';
         end if;
         update public.inventory set total_stock=total_stock+restore_n,
           produced_stock=produced_stock+case when source_kind='pending' then 0 else restore_n end,
           pending_production=pending_production+case when source_kind='pending' then restore_n else 0 end,
           available_stock=available_stock+case when source_kind='completed_free' then restore_n else 0 end,updated_at=now() where id=inv.id;
         rv_original:=lot->'reservation';
         if rv_original is not null and rv_original<>'null'::jsonb then
           if exists(select 1 from jsonb_array_elements(coalesce(s->'ch_reservations','[]')) x where x->>'id'=rv_original->>'id' and (x->>'product_id'<>pid or x->>'channel'<>ch)) then
             raise exception '예약 원본이 다른 상품으로 변경됐습니다. 다시 확인해주세요.';
           end if;
           if exists(select 1 from jsonb_array_elements(coalesce(s->'ch_reservations','[]')) x where x->>'id'=rv_original->>'id') then
             select coalesce(jsonb_agg(case when x->>'id'=rv_original->>'id' then jsonb_set(x,'{qty}',to_jsonb((x->>'qty')::integer+restore_n)) else x end),'[]') into reservations
             from jsonb_array_elements(s->'ch_reservations') x;
           else reservations:=coalesce(s->'ch_reservations','[]')||jsonb_build_array(jsonb_set(rv_original,'{qty}',to_jsonb(restore_n)));
           end if;
           s:=jsonb_set(s,'{ch_reservations}',reservations);
         end if;
         review_id:=lot->>'review_id';
         if source_kind='pending' and review_id is not null then
           review:=reviews->review_id;
           if review is null or (review->>'quantity')::integer<restore_n then raise exception '선출고 확인 기록을 다시 확인해주세요.'; end if;
           review:=jsonb_set(review,'{quantity}',to_jsonb((review->>'quantity')::integer-restore_n))||jsonb_build_object('adjusted_at',now());
           if (review->>'quantity')::integer=0 then review:=review||jsonb_build_object('status','cancelled'); end if;
           reviews:=jsonb_set(reviews,array[review_id],review); changed_reviews:=true;
         end if;
         lots:=jsonb_set(lots,array[lot_index::text,'qty'],to_jsonb((lot->>'qty')::integer-restore_n)); remain_n:=remain_n-restore_n;
       end loop;
       if remain_n<>0 then raise exception '취소할 출고 차감 원본이 부족합니다.'; end if;
       select coalesce(jsonb_agg(value),'[]') into lots from jsonb_array_elements(lots) where (value->>'qty')::integer>0;
     end if;
     stock_changed:=true;
   end loop;
   -- Keep the source ledger even after deletion; no historic review is erased.
   sources:=jsonb_set(sources,array[store_id],jsonb_build_object('product_id',case when deleted then old.product_id else r->>'product_id' end,
     'channel',case when deleted then old.channel else r->>'channel' end,'quantity',case when deleted then 0 else q end,'lots',lots,'updated_at',now()));
   if not deleted then
     if exists(select 1 from jsonb_each(reviews) where value->>'sale_id'=store_id and value->>'sale_date' is distinct from r->>'sale_date') then changed_reviews:=true; end if;
     select coalesce(jsonb_object_agg(key,case when value->>'sale_id'=store_id then value||jsonb_build_object('sale_date',r->>'sale_date') else value end),'{}') into reviews from jsonb_each(reviews);
   end if;
   if old.id is not null then affected:=affected||jsonb_build_array(jsonb_build_object('product_id',old.product_id,'channel',old.channel,'date',old.sale_date)); end if;
   if deleted then delete from public.sales_log where id=old.id;
   else
     -- Keep legacy IDs: re-upload is a replacement, never a new deduction.
     insert into public.sales_log(id,product_id,channel,quantity,amount,sale_date,created_at)
     values(coalesce(old.id,sid),r->>'product_id',r->>'channel',q,coalesce((r->>'amount')::bigint,0),(r->>'sale_date')::date,coalesce(old.created_at,now()))
     on conflict(id) do update set product_id=excluded.product_id,channel=excluded.channel,quantity=excluded.quantity,amount=excluded.amount,sale_date=excluded.sale_date;
     affected:=affected||jsonb_build_array(jsonb_build_object('product_id',r->>'product_id','channel',r->>'channel','date',r->>'sale_date'));
   end if;
   n:=n+1;
 end loop;
 -- Recompute import revenue from all saved rows, including rows outside this partial file.
 for r in select distinct value from jsonb_array_elements(affected) loop
   if exists(select 1 from public.sales_log where product_id=r->>'product_id' and channel=r->>'channel' and sale_date=(r->>'date')::date and id like 'sale-%') or
      exists(select 1 from public.channel_sales_log where id='csl-'||(r->>'date')||'-'||(r->>'channel')||'-'||(r->>'product_id')) then
     insert into public.channel_sales_log(id,channel,date,amount,note)
     select 'csl-'||(r->>'date')||'-'||(r->>'channel')||'-'||(r->>'product_id'),r->>'channel',(r->>'date')::date,coalesce(sum(amount),0),'판매 입력 합계'
     from public.sales_log where product_id=r->>'product_id' and channel=r->>'channel' and sale_date=(r->>'date')::date and id like 'sale-%'
     on conflict(id) do update set amount=excluded.amount;
   end if;
 end loop;
 if jsonb_array_length(plan)>0 then
   confirmation_token:=md5(jsonb_build_object('rows',p_rows,'deletes',p_delete_ids,'plan',plan)::text);
   if p_confirmation is distinct from confirmation_token then
     raise exception using errcode='PZ001',message='Pending stock confirmation required',
       detail=jsonb_build_object('needs_confirmation',true,'confirmation',confirmation_token,'pending_rows',plan)::text;
   end if;
 end if;
 if stock_changed or changed_reviews then
   s:=jsonb_set(jsonb_set(s,'{inventory_sale_sources}',sources),'{inventory_pending_reviews}',reviews);
   previous_guard:=current_setting('cherop.pending_mutation',true);
   perform set_config('cherop.pending_mutation','on',true);
   update public.app_state set data=s,updated_at=clock_timestamp() where id='cherop_main';
   perform set_config('cherop.pending_mutation',coalesce(previous_guard,''),true);
 end if;
 return jsonb_build_object('processed',n,'affected',affected,'needs_confirmation',false,'pending_rows',plan,'inventory_warnings',
   coalesce((select jsonb_agg(value) from jsonb_each(inventory_warnings)),'[]'));
 exception when sqlstate 'PZ001' then
   get stacked diagnostics detail_text=pg_exception_detail;
   return detail_text::jsonb;
 end;
end;
$$;
revoke all on function public.apply_inventory_sales_v2(jsonb,jsonb,text,jsonb) from public;
grant execute on function public.apply_inventory_sales_v2(jsonb,jsonb,text,jsonb) to anon,authenticated;
