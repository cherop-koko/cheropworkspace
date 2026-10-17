-- Atomic partial QC; invoker permissions retain the existing table access model.
-- Existing records are not migrated. Original IDs remain on pending remainders.
create or replace function public.resolve_production_defects_v1(p_expected jsonb, p_good integer, p_dispose integer, p_operation text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 s jsonb; expected jsonb; actual jsonb; r jsonb; piece jsonb; out_rows jsonb := '[]';
 reservations jsonb; rv jsonb; pending_total integer; good_left integer := p_good; bad_left integer := p_dispose;
 q integer; good_n integer; bad_n integer; remain_n integer; pid text; receipt text; typ text;
 inv public.inventory%rowtype; avail integer; move_n integer; allocated integer := 0; changed integer;
 resolved text := to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD'); original_used boolean;
begin
 if p_operation is null or length(p_operation)<16 or length(p_operation)>100 or p_good is null or p_dispose is null or p_good<0 or p_dispose<0 or p_good::bigint+p_dispose::bigint<1 then raise exception '처리 수량이 올바르지 않습니다.'; end if;
 if jsonb_typeof(p_expected) is distinct from 'array' or jsonb_array_length(p_expected)=0 then raise exception '접수 내역이 없습니다.'; end if;
 select data into s from public.app_state where id='cherop_main' for update;
 if not found then raise exception '업무 데이터를 불러오지 못했습니다.'; end if;
 if exists(select 1 from jsonb_array_elements(coalesce(s->'prod_defects','[]')) x where x->>'qc_operation'=p_operation) then
   if not exists(select 1 from jsonb_array_elements(s->'prod_defects') x where x->>'qc_operation'=p_operation and x->'qc_request'=jsonb_build_object('expected',p_expected,'good',p_good,'dispose',p_dispose)) then raise exception '처리 번호가 중복되었습니다.'; end if;
   return jsonb_build_object('already_applied',true);
 end if;
 pid := p_expected->0->>'product_id'; receipt := coalesce(p_expected->0->>'group_id',p_expected->0->>'id'); typ := p_expected->0->>'type';
 if pid is null or typ is null or typ not in ('production','return') then raise exception '상품 또는 접수 유형을 확인해주세요.'; end if;
 select jsonb_agg(x order by x->>'id') into expected from jsonb_array_elements(p_expected) x;
 select jsonb_agg(x order by x->>'id'),sum(coalesce((x->>'qty')::integer,1)) into actual,pending_total
 from jsonb_array_elements(coalesce(s->'prod_defects','[]')) x
 where coalesce(x->>'group_id',x->>'id')=receipt and x->>'product_id'=pid and x->>'type'=typ and x->>'status'='pending';
 if actual is distinct from expected then raise exception '다른 직원이 이 접수를 변경했습니다. 다시 불러와주세요.'; end if;
 if p_good::bigint+p_dispose::bigint>pending_total or exists(select 1 from jsonb_array_elements(actual) x where coalesce((x->>'qty')::integer,1)<1) then raise exception '대기 수량을 초과했습니다.'; end if;
 for r in select value from jsonb_array_elements(s->'prod_defects') loop
  if not exists(select 1 from jsonb_array_elements(actual) x where x->>'id'=r->>'id') then out_rows:=out_rows||jsonb_build_array(r); continue; end if;
  q:=coalesce((r->>'qty')::integer,1); good_n:=least(q,good_left); bad_n:=least(q-good_n,bad_left); remain_n:=q-good_n-bad_n;
  good_left:=good_left-good_n; bad_left:=bad_left-bad_n; original_used:=remain_n>0;
  if remain_n>0 then out_rows:=out_rows||jsonb_build_array(r||jsonb_build_object('qty',remain_n)); end if;
  for piece in select value from jsonb_array_elements(jsonb_build_array(jsonb_build_object('status','restored','qty',good_n),jsonb_build_object('status','disposed','qty',bad_n))) loop
   if (piece->>'qty')::integer=0 then continue; end if;
   out_rows:=out_rows||jsonb_build_array(r||piece||jsonb_build_object('id',case when original_used then (r->>'id')||':qc:'||p_operation||':'||(piece->>'status') else r->>'id' end,'group_id',coalesce(r->>'group_id',r->>'id'),'source_id',coalesce(r->>'source_id',r->>'id'),'resolvedDate',resolved,'qc_operation',p_operation,'qc_request',jsonb_build_object('expected',p_expected,'good',p_good,'dispose',p_dispose)));
   original_used:=true;
  end loop;
 end loop;
 if p_good>0 then
  select * into strict inv from public.inventory where product_id=pid for update;
  perform 1 from public.channel_inventory where product_id=pid for update;
  avail:=coalesce(inv.available_stock,0)+p_good;
  reservations:=coalesce(s->'ch_reservations','[]');
  for rv in select value from jsonb_array_elements(reservations) where value->>'product_id'=pid order by value->>'createdAt',value->>'id' loop
   exit when avail<=0; move_n:=least(greatest(coalesce((rv->>'qty')::integer,0),0),avail); if move_n=0 then continue; end if;
   if nullif(rv->>'channel','') is null then raise exception '예약 채널을 확인해주세요.'; end if;
   update public.channel_inventory set stock=coalesce(stock,0)+move_n,updated_at=clock_timestamp() where product_id=pid and channel=rv->>'channel';
   get diagnostics changed=row_count;
   if changed>1 then raise exception '채널 재고가 중복되었습니다. 확인 후 처리해주세요.'; end if;
   if changed=0 then insert into public.channel_inventory(id,product_id,channel,stock) values('chinv_'||pid||'_'||(rv->>'channel'),pid,rv->>'channel',move_n); end if;
   select coalesce(jsonb_agg(case when x->>'id'=rv->>'id' then x||jsonb_build_object('qty',(x->>'qty')::integer-move_n) else x end),'[]') into reservations from jsonb_array_elements(reservations) x;
   avail:=avail-move_n; allocated:=allocated+move_n;
  end loop;
  select coalesce(jsonb_agg(x),'[]') into reservations from jsonb_array_elements(reservations) x where coalesce((x->>'qty')::integer,0)>0;
  update public.inventory set total_stock=coalesce(total_stock,0)+p_good,produced_stock=coalesce(produced_stock,0)+p_good,available_stock=avail,updated_at=clock_timestamp() where id=inv.id;
  s:=jsonb_set(s,'{ch_reservations}',reservations);
 end if;
 s:=jsonb_set(s,'{prod_defects}',out_rows);
 update public.app_state set data=s,updated_at=clock_timestamp() where id='cherop_main';
 return jsonb_build_object('good',p_good,'disposed',p_dispose,'pending',pending_total-p_good-p_dispose,'allocated',allocated);
end $$;
revoke all on function public.resolve_production_defects_v1(jsonb,integer,integer,text) from public;
grant execute on function public.resolve_production_defects_v1(jsonb,integer,integer,text) to anon,authenticated;
