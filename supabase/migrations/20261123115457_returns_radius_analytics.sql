-- Classificação derivada; não altera devoluções nem apontamentos FDR.
begin;
create index if not exists delivery_radius_reports_return_match
 on public.delivery_radius_reports(unit,report_date,customer_code,map_number);

create or replace function public.returns_radius_snapshot(p_unit text,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'INVALID_PERIOD';end if;
 if not exists(select 1 from public.module_settings where module_name='Apontamento Fora do Raio' and active) then
  return jsonb_build_object('available',false,'reason','FDR_INACTIVE','matches','[]'::jsonb);
 end if;
 if (select count(*) from public.delivery_return_records where unit=p_unit and kind='REPORT' and operation_date between p_from and p_to)>15000
 or (select count(*) from public.delivery_radius_reports where unit=p_unit and report_date between p_from and p_to)>20000 then raise exception 'REDUCE_PERIOD';end if;
 with occurrences as (
  select distinct operation_date,btrim(data->>'customer_code') customer_code,btrim(coalesce(data->>'map_number','')) map_number
  from public.delivery_return_records where unit=p_unit and kind='REPORT' and operation_date between p_from and p_to
 ), customers_by_day as (
  select operation_date,customer_code,count(*) routes from occurrences group by operation_date,customer_code
 ), classified as (
  select o.*,count(f.id) filter(where btrim(f.map_number)<>'' or c.routes=1) matches,
   count(f.id) filter(where btrim(f.map_number)='' and c.routes>1) pending,
   bool_and(f.justified) filter(where btrim(f.map_number)<>'' or c.routes=1) justified
  from occurrences o join customers_by_day c using(operation_date,customer_code)
  left join public.delivery_radius_reports f on f.unit=p_unit and f.report_date=o.operation_date
   and btrim(f.customer_code)=o.customer_code and (btrim(f.map_number)=o.map_number or btrim(f.map_number)='')
  group by o.operation_date,o.customer_code,o.map_number
 )
 select coalesce(jsonb_agg(jsonb_build_object('operation_date',operation_date,'customer_code',customer_code,'map_number',map_number,
  'state',case when matches>0 then 'OUTSIDE' when pending>0 then 'PENDING' else 'INSIDE' end,
  'justified',case when matches>0 then justified else null end,'match_count',matches)
  order by operation_date,customer_code,map_number),'[]'::jsonb) into result from classified;
 return jsonb_build_object('available',true,'from',p_from,'to',p_to,'matches',result,'at',statement_timestamp());
end$$;
revoke all on function public.returns_radius_snapshot(text,date,date) from public,anon;
grant execute on function public.returns_radius_snapshot(text,date,date) to authenticated;
notify pgrst,'reload schema';
commit;
