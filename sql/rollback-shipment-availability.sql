-- Restore only this function, and only if no later edit has replaced its body.
-- Apply through the schema migration tool. No inventory rows are changed.
do $rollback$
declare previous_definition text;
begin
 if (select prosrc from pg_proc where oid='public.apply_inventory_sales_v1(jsonb,jsonb)'::regprocedure) is distinct from
    (select prosrc from pg_proc where oid='cherop_shipment_review_20261103.apply_inventory_sales_v1(jsonb,jsonb)'::regprocedure) then
   raise exception 'A later function edit exists. Review before restoring the backup.';
 end if;
 select definition into previous_definition from cherop_shipment_review_20261103.function_backup
 where name='apply_inventory_sales_v1';
 if previous_definition is null then raise exception 'Verified function backup missing'; end if;
 execute previous_definition;
end $rollback$;
