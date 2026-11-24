-- Prioridades da Matriz passam a ser importadas da guia Google Planilhas.
begin;

alter table public.delivery_return_imports
 drop constraint if exists delivery_return_imports_kind_check;
alter table public.delivery_return_imports
 add constraint delivery_return_imports_kind_check
 check(kind in ('REPORT','ORDERS','CUSTOMERS','JOURNEYS','ROUTES','PRIORITIES'));

create or replace function public.returns_google_sync(p_unit text,p_id uuid,p_action text,p_import_ids uuid[] default '{}',p_result jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.delivery_return_google_sync%rowtype;i uuid;begin
 if not public.returns_can(p_unit,'RETURNS_IMPORT') or not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 if p_id is null or p_action is null or p_action not in ('START','HEARTBEAT','FAIL','COMMIT') or jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>12000 then raise exception 'INVALID_SYNC';end if;
 insert into public.delivery_return_google_sync(unit) values(p_unit) on conflict do nothing;
 select * into v from public.delivery_return_google_sync where unit=p_unit for update;
 if p_action='START' then
  if v.lease_id is not null and v.lease_until>now() and (v.lease_id<>p_id or v.lease_actor<>auth.uid()) then return to_jsonb(v)-'lease_id'-'lease_actor'||jsonb_build_object('acquired',false);end if;
  update public.delivery_return_google_sync set lease_id=p_id,lease_actor=auth.uid(),lease_until=now()+interval '5 minutes',last_attempt_at=now() where unit=p_unit returning * into v;
  return to_jsonb(v)-'lease_id'-'lease_actor'||jsonb_build_object('acquired',true);
 end if;
 if v.lease_id is distinct from p_id or v.lease_actor is distinct from auth.uid() then raise exception 'SYNC_LEASE_CONFLICT';end if;
 if p_action='FAIL' then
  update public.delivery_return_google_sync set lease_id=null,lease_actor=null,lease_until=null,last_error=left(coalesce(p_result->>'error','Atualização interrompida.'),2000),sources=coalesce(p_result->'sources',sources) where unit=p_unit returning * into v;
  return to_jsonb(v)-'lease_id'-'lease_actor';
 end if;
 if v.lease_until<=now() then raise exception 'SYNC_LEASE_EXPIRED';end if;
 if p_action='HEARTBEAT' then
  update public.delivery_return_google_sync set lease_until=now()+interval '5 minutes' where unit=p_unit returning * into v;
  return to_jsonb(v)-'lease_id'-'lease_actor';
 end if;
 if cardinality(p_import_ids)>6 or p_import_ids is null then raise exception 'INVALID_SYNC_IMPORTS';end if;
 if exists(select 1 from unnest(p_import_ids) x where not exists(select 1 from public.delivery_return_imports imp where imp.id=x and imp.unit=p_unit and imp.created_by=auth.uid() and imp.filename like 'Google Planilhas / %')) then raise exception 'INVALID_SYNC_IMPORTS';end if;
 for i in select id from public.delivery_return_imports where id=any(p_import_ids) order by kind,id loop perform public.returns_finish_import(i);end loop;
 update public.delivery_return_google_sync set lease_id=null,lease_actor=null,lease_until=null,last_error='',sources=coalesce(p_result->'sources','{}'),
 last_synced_at=case when exists(select 1 from jsonb_each(coalesce(p_result->'sources','{}')) where value->>'state'='OK') then now() else last_synced_at end
 where unit=p_unit returning * into v;
 return to_jsonb(v)-'lease_id'-'lease_actor';
end$$;

create or replace function public.returns_stage_import(p_id uuid,p_rows jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare v public.delivery_return_imports%rowtype;r jsonb;k text;old jsonb;n integer;begin
 select * into v from public.delivery_return_imports where id=p_id for update;
 if not found or v.created_by<>auth.uid() or not public.returns_can(v.unit,'RETURNS_IMPORT') then raise exception 'FORBIDDEN';end if;
 if v.status='COMPLETED' then return v.expected_rows;end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'INVALID_BATCH';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  k=r->>'row_key';if k is null or length(k) not between 1 and 500 or octet_length(r::text)>20000 then raise exception 'INVALID_ROW';end if;
  if v.kind<>'CUSTOMERS' and (coalesce(r->>'operation_date','')!~'^\d{4}-\d{2}-\d{2}$' or (r->>'operation_date')::date not between date '2000-01-01' and date '2200-12-31') then raise exception 'INVALID_DATE';end if;
  if v.kind in ('REPORT','ORDERS','CUSTOMERS','PRIORITIES') and length(coalesce(r->>'customer_code','')) not between 1 and 40 then raise exception 'INVALID_CUSTOMER';end if;
  if v.kind in ('REPORT','ORDERS','JOURNEYS') and length(coalesce(r->>'map_number','')) not between 1 and 40 then raise exception 'INVALID_MAP';end if;
  if v.kind='REPORT' then
   if coalesce(r->>'amount_cents','')!~'^\d+$' or (r->>'amount_cents')::numeric>1e13 or coalesce(r->>'volume_hl','')!~'^\d+(\.\d+)?$' or (r->>'volume_hl')::numeric>1e9
   or length(coalesce(r->>'invoice_number','')) not between 1 and 40 then raise exception 'INVALID_REPORT';end if;
  elsif v.kind='ORDERS' then
   if coalesce(r->>'order_amount_cents','')!~'^\d+$' or (r->>'order_amount_cents')::numeric>1e13 then raise exception 'INVALID_ORDER';end if;
  elsif v.kind='ROUTES' then
   if coalesce(r->>'planned_outlets','')!~'^\d+$' or (r->>'planned_outlets')::numeric>1e7 or coalesce(r->>'planned_hl','')!~'^\d+(\.\d+)?$' or (r->>'planned_hl')::numeric>1e9 then raise exception 'INVALID_ROUTE';end if;
  elsif v.kind='PRIORITIES' then
   if jsonb_typeof(r->'customer_name') is distinct from 'string'
   or length(coalesce(r->>'customer_name',''))>300
   or coalesce(jsonb_typeof(r->'order_amount_cents'),'null') not in ('number','null')
   or coalesce(jsonb_typeof(r->'off_route'),'null') not in ('boolean','null')
   or coalesce(jsonb_typeof(r->'focus_client'),'null') not in ('boolean','null')
   or length(coalesce(r->>'city',''))>200 or length(coalesce(r->>'seller',''))>200
   or length(coalesce(r->>'visit_day',''))>40 or length(coalesce(r->>'reason',''))>2000 then
    raise exception 'INVALID_PRIORITY_ROW';
   end if;
  end if;
  select data into old from public.delivery_return_staging where import_id=p_id and row_key=k;
  if found and old<>r then raise exception 'IMPORT_ROW_CONFLICT';end if;
  insert into public.delivery_return_staging values(p_id,k,r) on conflict do nothing;
 end loop;
 select count(*) into n from public.delivery_return_staging where import_id=p_id;
 if n>v.expected_rows then raise exception 'IMPORT_COUNT';end if;return n;
end$$;

create or replace function public.returns_priority_snapshot(p_unit text,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;record_count integer;
begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'INVALID_PERIOD';end if;
 select count(*) into record_count from public.delivery_return_records
 where unit=p_unit and kind='PRIORITIES' and operation_date between p_from and p_to;
 if record_count>15000 then raise exception 'REDUCE_PERIOD';end if;
 select coalesce(jsonb_agg(data||jsonb_build_object('priority_date',operation_date)
  order by operation_date desc,data->>'customer_code'),'[]'::jsonb)
 into result from public.delivery_return_records
 where unit=p_unit and kind='PRIORITIES' and operation_date between p_from and p_to;
 return jsonb_build_object('priorities',result,'at',now());
end$$;

create or replace function public.returns_priority_lookup(p_unit text,p_date date,p_customer text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 if p_date is null or length(btrim(coalesce(p_customer,''))) not between 1 and 40 then
  raise exception 'INVALID_PRIORITY_LOOKUP';end if;
 select data||jsonb_build_object('priority_date',operation_date) into result
 from public.delivery_return_records
 where unit=p_unit and kind='PRIORITIES' and operation_date=p_date
  and data->>'customer_code'=btrim(p_customer);
 return result;
end$$;

create or replace function public.returns_priority_routes(p_unit text,p_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;record_count integer;
begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 if p_date is null then raise exception 'INVALID_PRIORITY_DATE';end if;
 select count(*) into record_count from public.delivery_return_records
 where unit=p_unit and kind='PRIORITIES' and operation_date=p_date;
 if record_count>15000 then raise exception 'REDUCE_PERIOD';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'priority',r.data||jsonb_build_object('priority_date',r.operation_date),
  'routes',public.returns_lookup(p_unit,r.data->>'customer_code',r.operation_date)
 ) order by r.data->>'customer_code'),'[]'::jsonb)
 into result from public.delivery_return_records r
 where r.unit=p_unit and r.kind='PRIORITIES' and r.operation_date=p_date;
 return result;
end$$;

revoke all on function public.returns_priority_snapshot(text,date,date),
 public.returns_priority_lookup(text,date,text),
 public.returns_priority_routes(text,date) from public,anon;
grant execute on function public.returns_priority_snapshot(text,date,date),
 public.returns_priority_lookup(text,date,text),
 public.returns_priority_routes(text,date) to authenticated;

commit;
