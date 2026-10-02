-- Coordenadas dos PDVs para auditoria visual de avarias (raio de 100 m definido no aplicativo).
-- Aplicar antes de importar o CSV pela tela Bases e importações.
begin;

alter table public.customers add column if not exists latitude double precision;
alter table public.customers add column if not exists longitude double precision;

alter table public.customers drop constraint if exists customers_latitude_range;
alter table public.customers add constraint customers_latitude_range
  check (latitude is null or latitude between -90 and 90);
alter table public.customers drop constraint if exists customers_longitude_range;
alter table public.customers add constraint customers_longitude_range
  check (longitude is null or longitude between -180 and 180);
alter table public.customers drop constraint if exists customers_coordinates_pair;
alter table public.customers add constraint customers_coordinates_pair
  check ((latitude is null) = (longitude is null));

-- Avarias sem foto ainda podem guardar o GPS obtido ao registrar a ocorrência.
alter table public.damage_requests add column if not exists capture_latitude double precision;
alter table public.damage_requests add column if not exists capture_longitude double precision;
alter table public.damage_requests add column if not exists capture_accuracy double precision;
alter table public.damage_requests add column if not exists capture_at timestamptz;
alter table public.damage_requests drop constraint if exists damage_requests_capture_coordinates;
alter table public.damage_requests add constraint damage_requests_capture_coordinates check (
  ((capture_latitude is null) = (capture_longitude is null))
  and (capture_latitude is null or (capture_latitude between -90 and 90 and capture_longitude between -180 and 180))
);

create or replace function public.set_damage_request_location(
  p_request_id uuid, p_latitude double precision, p_longitude double precision,
  p_accuracy double precision, p_captured_at timestamptz
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare v_request public.damage_requests%rowtype;
begin
  if not public.has_permission('DELIVERY_DAMAGE_CREATE') then raise exception 'FORBIDDEN'; end if;
  if p_request_id is null or p_latitude is null or p_longitude is null
     or not (p_latitude between -90 and 90 and p_longitude between -180 and 180)
     or (p_accuracy is not null and p_accuracy < 0) then
    raise exception 'GPS_INVALIDO';
  end if;
  select * into v_request from public.damage_requests where id=p_request_id for update;
  if v_request.id is null or v_request.created_by is distinct from auth.uid()
     or not public.user_has_unit(v_request.unit) then raise exception 'FORBIDDEN'; end if;
  if v_request.capture_latitude is null then
    update public.damage_requests set capture_latitude=p_latitude,
      capture_longitude=p_longitude,capture_accuracy=p_accuracy,
      capture_at=coalesce(p_captured_at,now())
    where id=p_request_id returning * into v_request;
  end if;
  return jsonb_build_object('request_id',v_request.id,'latitude',v_request.capture_latitude,
    'longitude',v_request.capture_longitude);
end;
$$;
revoke all on function public.set_damage_request_location(uuid,double precision,double precision,double precision,timestamptz) from public;
grant execute on function public.set_damage_request_location(uuid,double precision,double precision,double precision,timestamptz) to authenticated;

create or replace function public.import_customer_coordinates(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_received integer;
  v_matched_codes integer;
  v_updated_customers integer;
begin
  if not public.has_permission('ADMIN_BASES') then
    raise exception 'FORBIDDEN';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 300 then
    raise exception 'COORDINATES_BATCH_INVALID';
  end if;

  with input as (
    select btrim(x.code) as code, x.latitude, x.longitude
    from jsonb_to_recordset(p_rows) as x(code text, latitude double precision, longitude double precision)
  )
  select count(*) into v_received from input;

  if exists (
    select 1 from jsonb_to_recordset(p_rows) as x(code text, latitude double precision, longitude double precision)
    where x.code is null or x.code !~ '^[0-9]+$'
      or x.latitude is null or x.longitude is null
      or not (x.latitude between -90 and 90 and x.longitude between -180 and 180)
  ) then
    raise exception 'COORDINATES_INVALID';
  end if;

  with input as (
    select btrim(x.code) as code
    from jsonb_to_recordset(p_rows) as x(code text, latitude double precision, longitude double precision)
  )
  select count(*) into v_matched_codes from input i
  where exists (
    select 1 from public.customers c
    where ltrim(regexp_replace(c.code,'[^0-9]','','g'),'0')=ltrim(i.code,'0')
  );

  with input as (
    select btrim(x.code) as code, x.latitude, x.longitude
    from jsonb_to_recordset(p_rows) as x(code text, latitude double precision, longitude double precision)
  )
  update public.customers c
     set latitude=i.latitude, longitude=i.longitude, updated_at=now()
    from input i
   where ltrim(regexp_replace(c.code,'[^0-9]','','g'),'0')=ltrim(i.code,'0')
     and (c.latitude is distinct from i.latitude or c.longitude is distinct from i.longitude);
  get diagnostics v_updated_customers = row_count;

  return jsonb_build_object(
    'received',v_received,
    'matched_codes',v_matched_codes,
    'unmatched_codes',v_received-v_matched_codes,
    'updated_customers',v_updated_customers
  );
end;
$$;

revoke all on function public.import_customer_coordinates(jsonb) from public;
grant execute on function public.import_customer_coordinates(jsonb) to authenticated;

commit;
