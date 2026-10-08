-- Gestao Operacional Disbecol - Supabase/PostgreSQL
-- NRI + Avarias + Conferencia de Vasilhames
-- Execute este arquivo no SQL Editor de um projeto Supabase novo.

create extension if not exists pgcrypto;

-- PERFIS / AUTENTICACAO -------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  name text not null,
  role text not null default 'COLABORADOR_ARMAZEM' check (role in ('ADMIN','COLABORADOR_ARMAZEM','COLABORADOR_ENTREGA','CONFERENTE')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_name text;
begin
  v_username := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', split_part(coalesce(new.email,''),'@',1)), E'\\s+', '.', 'g'));
  v_name := coalesce(nullif(new.raw_user_meta_data->>'name',''), initcap(replace(v_username,'.',' ')));
  insert into public.profiles(id,username,name,role,active)
  values(new.id,v_username,v_name,'COLABORADOR_ARMAZEM',true)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active = true limit 1;
$$;

create or replace function public.has_role(allowed text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role() = any(allowed), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.has_role(array['ADMIN']::text[]); $$;

-- BASES DE APOIO -------------------------------------------------------------
create table if not exists public.products (
  code text primary key,
  name text not null,
  active boolean not null default true,
  nf_reference_code text,
  commercial_units_per_pallet integer,
  invoice_unit text,
  updated_at timestamptz not null default now()
);
create table if not exists public.units (
  name text primary key,
  active boolean not null default true
);
create table if not exists public.shifts (
  name text primary key,
  active boolean not null default true
);
create table if not exists public.drivers (
  name text primary key,
  active boolean not null default true
);
create table if not exists public.factories (
  name text primary key,
  active boolean not null default true
);
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  city text not null default '',
  branch text not null default '',
  updated_at timestamptz not null default now(),
  unique(code,branch)
);
create index if not exists idx_customers_code on public.customers(code);

-- NRI ------------------------------------------------------------------------
create sequence if not exists public.nri_number_seq start 1;

create table if not exists public.nri_requests (
  id uuid primary key default gen_random_uuid(),
  unit text not null,
  request_type text not null default 'AMBEV' check (request_type in ('AMBEV','MARKETPLACE')),
  receipt_date date not null,
  checker_id uuid references auth.users(id),
  checker_name text not null,
  shift text, -- legado: não utilizado em novos NRIs
  receipt_time time not null,
  driver text not null,
  plate text not null,
  factory text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.nris (
  id uuid primary key default gen_random_uuid(),
  nri text not null unique,
  request_id uuid references public.nri_requests(id) on delete set null,
  product_code text not null,
  product_name text not null,
  unit text not null,
  request_type text not null default 'AMBEV' check (request_type in ('AMBEV','MARKETPLACE')),
  validity_date date,
  lot text not null,
  receipt_date date not null,
  block_date date,
  checker_name text not null,
  shift text, -- legado: não utilizado em novos NRIs
  receipt_time time not null,
  driver text not null,
  plate text not null,
  factory text not null,
  quantity integer not null check (quantity >= 0),
  status text not null default 'PENDENTE' check (status in ('PENDENTE','IMPRESSO','REMOVIDO')),
  created_by uuid references auth.users(id),
  created_by_username text not null default '',
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  printed_at timestamptz,
  removed_at timestamptz
);

create or replace function public.assign_nri_number()
returns trigger language plpgsql as $$
begin
  if new.nri is null or btrim(new.nri) = '' then
    new.nri := 'NRI-' || lpad(nextval('public.nri_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_nri_number on public.nris;
create trigger trg_assign_nri_number before insert on public.nris
for each row execute function public.assign_nri_number();

create index if not exists idx_nris_status on public.nris(status);
create index if not exists idx_nris_lot on public.nris(upper(lot));
create index if not exists idx_nris_product on public.nris(product_code);
create index if not exists idx_nris_created_at on public.nris(created_at desc);

create table if not exists public.print_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_type text not null default 'IMPRESSAO',
  nri_ids uuid[] not null default '{}',
  nri_codes text[] not null default '{}',
  result text not null,
  copies integer,
  user_id uuid references auth.users(id),
  username text not null default '',
  user_name text not null default '',
  observation text not null default ''
);

create or replace function public.create_nri_request(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_req uuid;
  v_item jsonb;
  v_count integer;
  v_i integer;
  v_rows jsonb;
  v_type text;
  v_driver text;
  v_plate text;
  v_factory text;
  v_validity date;
begin
  if not public.has_role(array['ADMIN','COLABORADOR_ARMAZEM','CONFERENTE']::text[]) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;

  v_type := upper(coalesce(nullif(btrim(p_payload->>'request_type'),''),'AMBEV'));
  if v_type not in ('AMBEV','MARKETPLACE') then raise exception 'TIPO_NRI_INVALIDO'; end if;

  if v_type = 'MARKETPLACE' then
    v_driver := '--';
    v_plate := '--';
    v_factory := '--';
  else
    v_driver := btrim(p_payload->>'driver');
    v_plate := upper(btrim(p_payload->>'plate'));
    v_factory := btrim(p_payload->>'factory');
    if coalesce(v_driver,'')='' or coalesce(v_plate,'')='' or coalesce(v_factory,'')='' then
      raise exception 'DADOS_TRANSPORTE_OBRIGATORIOS';
    end if;
  end if;

  insert into public.nri_requests(
    unit,request_type,receipt_date,checker_id,checker_name,receipt_time,driver,plate,factory,created_by
  ) values(
    btrim(p_payload->>'unit'),v_type,(p_payload->>'receipt_date')::date,
    auth.uid(),v_profile.name,(p_payload->>'receipt_time')::time,
    v_driver,v_plate,v_factory,auth.uid()
  ) returning id into v_req;

  for v_item in select value from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    v_count := greatest(1, coalesce((v_item->>'pallets')::integer,1));
    v_validity := nullif(btrim(coalesce(v_item->>'validity_date','')),'')::date;

    for v_i in 1..v_count loop
      insert into public.nris(
        nri,request_id,product_code,product_name,unit,request_type,validity_date,lot,receipt_date,block_date,
        checker_name,receipt_time,driver,plate,factory,quantity,status,created_by,created_by_username,created_by_name
      ) values(
        null,v_req,btrim(v_item->>'product_code'),btrim(v_item->>'product_name'),btrim(p_payload->>'unit'),v_type,
        v_validity,upper(btrim(v_item->>'lot')),(p_payload->>'receipt_date')::date,
        case when v_validity is null then null else (v_validity - 30) end,
        v_profile.name,(p_payload->>'receipt_time')::time,
        v_driver,v_plate,v_factory,
        greatest(0,(v_item->>'quantity')::integer),'PENDENTE',auth.uid(),v_profile.username,v_profile.name
      );
    end loop;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.nri),'[]'::jsonb)
    into v_rows
  from public.nris x where x.request_id=v_req;

  return jsonb_build_object('request_id',v_req,'nris',v_rows);
end;
$$;

create or replace function public.confirm_nri_print(p_ids uuid[], p_reprint boolean default false, p_result text default 'IMPRESSO')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_codes text[];
begin
  if not public.has_role(array['ADMIN','COLABORADOR_ARMAZEM','CONFERENTE']::text[]) then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  select coalesce(array_agg(nri order by nri),'{}') into v_codes from public.nris where id=any(p_ids);

  if upper(p_result)='IMPRESSO' and not p_reprint then
    update public.nris set status='IMPRESSO', printed_at=now() where id=any(p_ids) and status='PENDENTE';
  end if;

  insert into public.print_events(event_type,nri_ids,nri_codes,result,copies,user_id,username,user_name,observation)
  values(case when p_reprint then 'REIMPRESSAO' else 'IMPRESSAO' end,p_ids,v_codes,upper(p_result),
         case when upper(p_result)='IMPRESSO' then 3 else null end,auth.uid(),v_profile.username,v_profile.name,'');
  return jsonb_build_object('ok',true,'count',cardinality(p_ids));
end;
$$;

create or replace function public.remove_nris(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if not public.has_role(array['ADMIN','COLABORADOR_ARMAZEM','CONFERENTE']::text[]) then raise exception 'FORBIDDEN'; end if;
  update public.nris set status='REMOVIDO',removed_at=now() where id=any(p_ids) and status='PENDENTE';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.sync_nri_sequence()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_max bigint;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select coalesce(max(nullif(regexp_replace(nri,E'\\D','','g'),'')::bigint),0) into v_max from public.nris;
  if v_max > 0 then
    perform setval('public.nri_number_seq', v_max, true);
  else
    perform setval('public.nri_number_seq', 1, false);
  end if;
  return v_max;
end;
$$;

-- AVARIAS --------------------------------------------------------------------
create table if not exists public.damage_requests (
  id uuid primary key default gen_random_uuid(),
  occurrence_date date not null,
  delivery_user_id uuid references auth.users(id),
  delivery_username text not null,
  delivery_name text not null,
  customer_code text not null,
  customer_name text not null,
  city text not null,
  map_number text not null,
  signature_path text not null,
  status text not null default 'PENDENTE' check (status in ('PENDENTE','PARCIAL','APROVADO','REPROVADO')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  last_review_at timestamptz
);

create table if not exists public.damage_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.damage_requests(id) on delete cascade,
  item_order integer not null,
  product_text text not null,
  lot text not null,
  quantity numeric not null check (quantity >= 0),
  quantity_unit text not null check (quantity_unit in ('UNIDADE','CAIXA')),
  reason text not null,
  photo_path text not null,
  latitude double precision not null,
  longitude double precision not null,
  gps_accuracy double precision,
  gps_captured_at timestamptz,
  status text not null default 'PENDENTE' check (status in ('PENDENTE','APROVADO','REPROVADO')),
  reviewer_id uuid references auth.users(id),
  reviewer_name text,
  reviewed_at timestamptz,
  review_note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_damage_items_lot on public.damage_items(upper(lot));
create index if not exists idx_damage_requests_status on public.damage_requests(status);

create table if not exists public.damage_item_photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.damage_items(id) on delete cascade,
  photo_order integer not null check (photo_order between 1 and 5),
  photo_path text not null,
  latitude double precision not null,
  longitude double precision not null,
  gps_accuracy double precision,
  gps_captured_at timestamptz,
  created_at timestamptz not null default now(),
  unique(item_id, photo_order)
);
create index if not exists idx_damage_item_photos_item on public.damage_item_photos(item_id);

create or replace function public.create_damage_request(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_req uuid;
  v_item jsonb;
  v_item_id uuid;
  v_order integer := 0;
  v_photos jsonb;
  v_photo jsonb;
  v_first_photo jsonb;
  v_photo_order integer;
begin
  if not public.has_role(array['ADMIN','COLABORADOR_ENTREGA']::text[]) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;

  insert into public.damage_requests(
    occurrence_date,delivery_user_id,delivery_username,delivery_name,customer_code,customer_name,city,map_number,
    signature_path,status,created_by
  ) values(
    (p_payload->>'date')::date,auth.uid(),v_profile.username,v_profile.name,btrim(p_payload->>'customer_code'),
    btrim(p_payload->>'customer_name'),btrim(p_payload->>'city'),btrim(p_payload->>'map_number'),
    btrim(p_payload->>'signature_path'),'PENDENTE',auth.uid()
  ) returning id into v_req;

  for v_item in select value from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    v_order := v_order + 1;
    v_photos := case when jsonb_typeof(v_item->'photos')='array' then v_item->'photos' else '[]'::jsonb end;

    -- Compatibilidade: se o cliente antigo mandar somente photo_path/GPS no item,
    -- converte para um array de uma foto.
    if jsonb_array_length(v_photos)=0 and coalesce(v_item->>'photo_path','')<>'' then
      v_photos := jsonb_build_array(jsonb_build_object(
        'photo_path',v_item->>'photo_path',
        'latitude',v_item->>'latitude',
        'longitude',v_item->>'longitude',
        'accuracy',v_item->>'accuracy',
        'gps_at',v_item->>'gps_at'
      ));
    end if;

    if jsonb_array_length(v_photos)=0 then raise exception 'FOTO_OBRIGATORIA'; end if;
    if jsonb_array_length(v_photos)>5 then raise exception 'MAXIMO_5_FOTOS'; end if;

    v_first_photo := v_photos->0;

    insert into public.damage_items(
      request_id,item_order,product_text,lot,quantity,quantity_unit,reason,
      photo_path,latitude,longitude,gps_accuracy,gps_captured_at
    ) values(
      v_req,v_order,btrim(v_item->>'product'),upper(btrim(v_item->>'lot')),(v_item->>'quantity')::numeric,
      upper(v_item->>'unit'),btrim(v_item->>'reason'),btrim(v_first_photo->>'photo_path'),
      (v_first_photo->>'latitude')::double precision,(v_first_photo->>'longitude')::double precision,
      nullif(v_first_photo->>'accuracy','')::double precision,nullif(v_first_photo->>'gps_at','')::timestamptz
    ) returning id into v_item_id;

    v_photo_order := 0;
    for v_photo in select value from jsonb_array_elements(v_photos) loop
      v_photo_order := v_photo_order + 1;
      insert into public.damage_item_photos(
        item_id,photo_order,photo_path,latitude,longitude,gps_accuracy,gps_captured_at
      ) values(
        v_item_id,v_photo_order,btrim(v_photo->>'photo_path'),
        (v_photo->>'latitude')::double precision,(v_photo->>'longitude')::double precision,
        nullif(v_photo->>'accuracy','')::double precision,nullif(v_photo->>'gps_at','')::timestamptz
      );
    end loop;
  end loop;

  return v_req;
end;
$$;

create or replace function public.review_damage_items(p_item_ids uuid[], p_status text, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_req uuid;
  v_status text;
  v_pending integer;
  v_appr integer;
  v_rej integer;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  v_status := upper(p_status);
  if v_status not in ('APROVADO','REPROVADO') then raise exception 'STATUS_INVALIDO'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;

  update public.damage_items
  set status=v_status, reviewer_id=auth.uid(), reviewer_name=v_profile.name, reviewed_at=now(), review_note=coalesce(p_note,'')
  where id=any(p_item_ids);

  for v_req in select distinct request_id from public.damage_items where id=any(p_item_ids) loop
    select count(*) filter(where status='PENDENTE'),count(*) filter(where status='APROVADO'),count(*) filter(where status='REPROVADO')
      into v_pending,v_appr,v_rej from public.damage_items where request_id=v_req;
    update public.damage_requests
      set status=case when v_pending>0 then 'PARCIAL' when v_appr>0 and v_rej=0 then 'APROVADO' when v_rej>0 and v_appr=0 then 'REPROVADO' else 'PARCIAL' end,
          last_review_at=now()
      where id=v_req;
  end loop;
  return jsonb_build_object('ok',true,'count',cardinality(p_item_ids));
end;
$$;

-- CONFERENCIA DE VASILHAMES --------------------------------------------------
create table if not exists public.container_conferences (
  id uuid primary key default gen_random_uuid(),
  conference_date date not null,
  conference_time time not null,
  checker_id uuid references auth.users(id),
  checker_username text not null,
  checker_name text not null,
  map_number text not null,
  g300 integer not null default 0,
  g600_green integer not null default 0,
  g600_brown integer not null default 0,
  g_litrao integer not null default 0,
  keg30 integer not null default 0,
  keg50 integer not null default 0,
  created_at timestamptz not null default now(),
  unique(map_number,conference_date)
);

create table if not exists public.maps (
  id uuid primary key default gen_random_uuid(),
  map_number text not null,
  map_date date not null,
  city text not null default '',
  driver text not null default '',
  helper1 text not null default '',
  helper2 text not null default '',
  g300 integer not null default 0,
  g600_green integer not null default 0,
  g600_brown integer not null default 0,
  g_litrao integer not null default 0,
  keg30 integer not null default 0,
  keg50 integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(map_number,map_date)
);
create index if not exists idx_maps_date on public.maps(map_date desc);
create index if not exists idx_conferences_date on public.container_conferences(conference_date desc);

create or replace function public.create_container_conference(
  p_map_number text,p_g300 integer,p_g600_green integer,p_g600_brown integer,p_g_litrao integer,p_keg30 integer,p_keg50 integer
)
returns public.container_conferences
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_now timestamp;
  v_row public.container_conferences%rowtype;
begin
  if not public.has_role(array['ADMIN','COLABORADOR_ARMAZEM','CONFERENTE']::text[]) then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  v_now := timezone('America/Fortaleza', now());
  insert into public.container_conferences(
    conference_date,conference_time,checker_id,checker_username,checker_name,map_number,g300,g600_green,g600_brown,g_litrao,keg30,keg50
  ) values(
    v_now::date,v_now::time,auth.uid(),v_profile.username,v_profile.name,regexp_replace(coalesce(p_map_number,''),E'\\D','','g'),
    greatest(0,p_g300),greatest(0,p_g600_green),greatest(0,p_g600_brown),greatest(0,p_g_litrao),greatest(0,p_keg30),greatest(0,p_keg50)
  ) returning * into v_row;
  return v_row;
end;
$$;

-- ROW LEVEL SECURITY ----------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.units enable row level security;
alter table public.shifts enable row level security;
alter table public.drivers enable row level security;
alter table public.factories enable row level security;
alter table public.customers enable row level security;
alter table public.nri_requests enable row level security;
alter table public.nris enable row level security;
alter table public.print_events enable row level security;
alter table public.damage_requests enable row level security;
alter table public.damage_items enable row level security;
alter table public.damage_item_photos enable row level security;
alter table public.container_conferences enable row level security;
alter table public.maps enable row level security;

-- Permite executar novamente o script sem conflito de nomes de políticas.
drop policy if exists "profile_self_or_admin_select" on public.profiles;
drop policy if exists "profile_admin_update" on public.profiles;
drop policy if exists "products_read" on public.products;
drop policy if exists "products_admin_all" on public.products;
drop policy if exists "units_read" on public.units;
drop policy if exists "units_admin_all" on public.units;
drop policy if exists "shifts_read" on public.shifts;
drop policy if exists "shifts_admin_all" on public.shifts;
drop policy if exists "drivers_read" on public.drivers;
drop policy if exists "drivers_admin_all" on public.drivers;
drop policy if exists "factories_read" on public.factories;
drop policy if exists "factories_admin_all" on public.factories;
drop policy if exists "customers_read" on public.customers;
drop policy if exists "customers_admin_all" on public.customers;
drop policy if exists "nri_requests_read" on public.nri_requests;
drop policy if exists "nris_read" on public.nris;
drop policy if exists "nris_admin_insert_migration" on public.nris;
drop policy if exists "nris_nri_roles_update" on public.nris;
drop policy if exists "print_events_admin_read" on public.print_events;
drop policy if exists "damage_requests_read" on public.damage_requests;
drop policy if exists "damage_items_read" on public.damage_items;
drop policy if exists "damage_item_photos_read" on public.damage_item_photos;
drop policy if exists "conference_read" on public.container_conferences;
drop policy if exists "conference_admin_insert_migration" on public.container_conferences;
drop policy if exists "maps_admin_read" on public.maps;
drop policy if exists "maps_admin_all" on public.maps;

-- Perfis
create policy "profile_self_or_admin_select" on public.profiles for select to authenticated
using (id=auth.uid() or public.is_admin());
create policy "profile_admin_update" on public.profiles for update to authenticated
using (public.is_admin()) with check (public.is_admin());

-- Bases: todos autenticados consultam; apenas Admin altera
create policy "products_read" on public.products for select to authenticated using (true);
create policy "products_admin_all" on public.products for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "units_read" on public.units for select to authenticated using (true);
create policy "units_admin_all" on public.units for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "shifts_read" on public.shifts for select to authenticated using (true);
create policy "shifts_admin_all" on public.shifts for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "drivers_read" on public.drivers for select to authenticated using (true);
create policy "drivers_admin_all" on public.drivers for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "factories_read" on public.factories for select to authenticated using (true);
create policy "factories_admin_all" on public.factories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "customers_read" on public.customers for select to authenticated using (true);
create policy "customers_admin_all" on public.customers for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- NRI
create policy "nri_requests_read" on public.nri_requests for select to authenticated
using (public.has_role(array['ADMIN','COLABORADOR_ARMAZEM','CONFERENTE']::text[]));
create policy "nris_read" on public.nris for select to authenticated
using (public.has_role(array['ADMIN','COLABORADOR_ARMAZEM','CONFERENTE']::text[]));
create policy "nris_admin_insert_migration" on public.nris for insert to authenticated
with check (public.is_admin());
create policy "nris_nri_roles_update" on public.nris for update to authenticated
using (public.has_role(array['ADMIN','COLABORADOR_ARMAZEM','CONFERENTE']::text[]))
with check (public.has_role(array['ADMIN','COLABORADOR_ARMAZEM','CONFERENTE']::text[]));
create policy "print_events_admin_read" on public.print_events for select to authenticated using (public.is_admin());

-- Avarias
create policy "damage_requests_read" on public.damage_requests for select to authenticated
using (public.is_admin() or created_by=auth.uid());
create policy "damage_items_read" on public.damage_items for select to authenticated
using (public.is_admin() or exists(select 1 from public.damage_requests r where r.id=request_id and r.created_by=auth.uid()));
create policy "damage_item_photos_read" on public.damage_item_photos for select to authenticated
using (public.is_admin() or exists(
  select 1 from public.damage_items i join public.damage_requests r on r.id=i.request_id
  where i.id=item_id and r.created_by=auth.uid()
));

-- Conferencias
create policy "conference_read" on public.container_conferences for select to authenticated
using (public.is_admin() or checker_id=auth.uid());
create policy "conference_admin_insert_migration" on public.container_conferences for insert to authenticated
with check (public.is_admin());
create policy "maps_admin_read" on public.maps for select to authenticated using (public.is_admin());
create policy "maps_admin_all" on public.maps for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Grants. RLS continua controlando as linhas.
grant usage on schema public to authenticated;
grant usage on schema public to service_role;
grant select,insert,update,delete on table public.profiles to service_role;
grant select,insert,update,delete on public.profiles,public.products,public.units,public.shifts,public.drivers,public.factories,public.customers,
  public.nri_requests,public.nris,public.print_events,public.damage_requests,public.damage_items,public.damage_item_photos,public.container_conferences,public.maps to authenticated;
grant execute on function public.current_role() to authenticated;
grant execute on function public.has_role(text[]) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.create_nri_request(jsonb) to authenticated;
grant execute on function public.confirm_nri_print(uuid[],boolean,text) to authenticated;
grant execute on function public.remove_nris(uuid[]) to authenticated;
grant execute on function public.sync_nri_sequence() to authenticated;
grant execute on function public.create_damage_request(jsonb) to authenticated;
grant execute on function public.review_damage_items(uuid[],text,text) to authenticated;
grant execute on function public.create_container_conference(text,integer,integer,integer,integer,integer,integer) to authenticated;

-- STORAGE DE AVARIAS ---------------------------------------------------------
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('avarias','avarias',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=10485760;

drop policy if exists "avarias_upload_own_folder" on storage.objects;
drop policy if exists "avarias_read_own_or_admin" on storage.objects;
drop policy if exists "avarias_update_own_or_admin" on storage.objects;
drop policy if exists "avarias_delete_own_or_admin" on storage.objects;

create policy "avarias_upload_own_folder" on storage.objects for insert to authenticated
with check (bucket_id='avarias' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "avarias_read_own_or_admin" on storage.objects for select to authenticated
using (bucket_id='avarias' and ((storage.foldername(name))[1]=auth.uid()::text or public.is_admin()));
create policy "avarias_update_own_or_admin" on storage.objects for update to authenticated
using (bucket_id='avarias' and ((storage.foldername(name))[1]=auth.uid()::text or public.is_admin()));
create policy "avarias_delete_own_or_admin" on storage.objects for delete to authenticated
using (bucket_id='avarias' and ((storage.foldername(name))[1]=auth.uid()::text or public.is_admin()));

-- REALTIME -------------------------------------------------------------------
do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='nris') then
    execute 'alter publication supabase_realtime add table public.nris';
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='damage_requests') then
    execute 'alter publication supabase_realtime add table public.damage_requests';
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='damage_items') then
    execute 'alter publication supabase_realtime add table public.damage_items';
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='damage_item_photos') then
    execute 'alter publication supabase_realtime add table public.damage_item_photos';
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='container_conferences') then
    execute 'alter publication supabase_realtime add table public.container_conferences';
  end if;
end $$;

-- IMPORTACAO: depois de importar NRIs antigos, execute SELECT public.sync_nri_sequence();


-- >>> v1.1.0 MODULO PUXADA >>>
-- Disb Gestao v1.1.0 - Modulo Puxada
-- Execute uma unica vez no SQL Editor do Supabase antes de publicar o frontend v1.1.0.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- PERFIS
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('ADMIN','COLABORADOR_ARMAZEM','COLABORADOR_ENTREGA','CONFERENTE','MOTORISTA_PUXADOR'));

-- Motoristas puxadores precisam enxergar os outros puxadores ativos para escolher o Motorista 2.
drop policy if exists "profile_self_or_admin_select" on public.profiles;
create policy "profile_self_or_admin_select" on public.profiles for select to authenticated
using (
  id=auth.uid() or public.is_admin()
  or (public.current_role()='MOTORISTA_PUXADOR' and role='MOTORISTA_PUXADOR' and active=true)
);

-- ---------------------------------------------------------------------------
-- FABRICAS / GEOFENCE
-- ---------------------------------------------------------------------------
alter table public.factories add column if not exists latitude double precision;
alter table public.factories add column if not exists longitude double precision;
alter table public.factories add column if not exists radius_meters integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='factories_radius_meters_check' and conrelid='public.factories'::regclass
  ) then
    alter table public.factories add constraint factories_radius_meters_check
      check (radius_meters is null or radius_meters > 0);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CONFIGURACAO GERAL DA PUXADA
-- ---------------------------------------------------------------------------
create table if not exists public.pull_settings (
  singleton boolean primary key default true check (singleton),
  default_unit text references public.units(name) on update cascade,
  gps_max_accuracy_m integer not null default 100 check (gps_max_accuracy_m between 5 and 5000),
  track_interval_seconds integer not null default 60 check (track_interval_seconds between 30 and 3600),
  track_min_distance_m integer not null default 50 check (track_min_distance_m between 0 and 10000),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into public.pull_settings(singleton) values(true) on conflict(singleton) do nothing;

create table if not exists public.pull_vehicles (
  id uuid primary key default gen_random_uuid(),
  plate text not null unique,
  carrier text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_pull_vehicles_updated on public.pull_vehicles;
create trigger trg_pull_vehicles_updated before update on public.pull_vehicles
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- ETAPAS E OCORRENCIAS CONFIGURAVEIS
-- ---------------------------------------------------------------------------
create table if not exists public.pull_steps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  step_type text not null check (step_type in ('MAIN','OCCURRENCE')),
  sort_order integer not null default 100,
  action_code text not null unique,
  active boolean not null default true,
  required boolean not null default true,
  duration_mode text not null default 'POINT' check (duration_mode in ('POINT','INTERVAL')),
  requires_factory_geofence boolean not null default false,
  suggest_tma_discount boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_pull_steps_updated on public.pull_steps;
create trigger trg_pull_steps_updated before update on public.pull_steps
for each row execute function public.touch_updated_at();

insert into public.pull_steps(name,step_type,sort_order,action_code,active,required,duration_mode,requires_factory_geofence,suggest_tma_discount)
values
  ('Saída da revenda (início de jornada)','MAIN',10,'START_TRIP',true,true,'POINT',false,false),
  ('Chegada ao ponto de apoio','MAIN',20,'ARRIVE_SUPPORT_OUT',true,true,'POINT',false,false),
  ('Troca de motorista - ida','MAIN',30,'DRIVER_SWAP_OUT',true,true,'POINT',false,false),
  ('Chegada à fábrica','MAIN',40,'ARRIVE_FACTORY',true,true,'POINT',true,false),
  ('Carregamento','MAIN',50,'LOADING',true,true,'POINT',false,false),
  ('Conferência','MAIN',60,'CONFERENCE',true,true,'POINT',false,false),
  ('Saída da fábrica','MAIN',70,'LEAVE_FACTORY',true,true,'POINT',false,false),
  ('Chegada ao ponto de apoio - retorno','MAIN',80,'ARRIVE_SUPPORT_RETURN',true,true,'POINT',false,false),
  ('Troca de motorista - retorno','MAIN',90,'DRIVER_SWAP_RETURN',true,true,'POINT',false,false),
  ('Chegada à revenda (fim da viagem)','MAIN',100,'ARRIVE_UNIT',true,true,'POINT',false,false),
  ('Descanso','OCCURRENCE',10,'OCC_REST',true,false,'INTERVAL',false,true),
  ('Abastecimento','OCCURRENCE',20,'OCC_FUEL',true,false,'INTERVAL',false,false),
  ('Parada operacional','OCCURRENCE',30,'OCC_OPERATIONAL_STOP',true,false,'INTERVAL',false,false),
  ('Manutenção','OCCURRENCE',40,'OCC_MAINTENANCE',true,false,'INTERVAL',false,false),
  ('Espera','OCCURRENCE',50,'OCC_WAIT',true,false,'INTERVAL',false,false)
on conflict(action_code) do nothing;

-- ---------------------------------------------------------------------------
-- METAS GLOBAIS POR ANO
-- ---------------------------------------------------------------------------
create table if not exists public.pull_goals (
  year integer primary key check (year between 2020 and 2100),
  tmv_out_target_minutes integer not null default 0 check (tmv_out_target_minutes >= 0),
  factory_target_minutes integer not null default 0 check (factory_target_minutes >= 0),
  tmv_return_target_minutes integer not null default 0 check (tmv_return_target_minutes >= 0),
  unit_target_minutes integer not null default 0 check (unit_target_minutes >= 0),
  cycle_target_minutes integer not null default 0 check (cycle_target_minutes >= 0),
  tmv_out_adherence numeric(5,2) not null default 85 check (tmv_out_adherence between 0 and 100),
  factory_adherence numeric(5,2) not null default 85 check (factory_adherence between 0 and 100),
  tmv_return_adherence numeric(5,2) not null default 85 check (tmv_return_adherence between 0 and 100),
  unit_adherence numeric(5,2) not null default 85 check (unit_adherence between 0 and 100),
  cycle_adherence numeric(5,2) not null default 85 check (cycle_adherence between 0 and 100),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- VIAGENS / CICLOS
-- ---------------------------------------------------------------------------
create sequence if not exists public.pull_trip_number_seq start 1;

create table if not exists public.pull_trips (
  id uuid primary key default gen_random_uuid(),
  trip_code text unique,
  origin_unit text not null,
  plate text not null,
  carrier text not null default '',
  factory text not null,
  driver1_id uuid not null references auth.users(id),
  driver1_name text not null,
  driver2_id uuid not null references auth.users(id),
  driver2_name text not null,
  active_driver_id uuid references auth.users(id),
  active_driver_name text not null default '',
  started_at timestamptz not null default now(),
  start_latitude double precision not null,
  start_longitude double precision not null,
  start_accuracy double precision,
  arrived_factory_at timestamptz,
  left_factory_at timestamptz,
  ended_at timestamptz,
  ended_by_id uuid references auth.users(id),
  ended_by_name text,
  end_latitude double precision,
  end_longitude double precision,
  end_accuracy double precision,
  next_started_at timestamptz,
  status text not null default 'IN_PROGRESS' check (status in ('IN_PROGRESS','ARRIVED','CANCELLED')),
  kpi_status text not null default 'IN_PROGRESS' check (kpi_status in ('IN_PROGRESS','WAITING_NEXT_START','CLOSED','CANCELLED')),
  nri_status text not null default 'NOT_READY' check (nri_status in ('NOT_READY','PENDING','COMPLETED')),
  tma_adjust_minutes integer not null default 0 check (tma_adjust_minutes >= 0),
  tma_adjust_reason text not null default '',
  tma_adjusted_by uuid references auth.users(id),
  tma_adjusted_by_name text,
  tma_adjusted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pull_trips_status on public.pull_trips(status, started_at desc);
create index if not exists idx_pull_trips_plate on public.pull_trips(plate, started_at desc);
create index if not exists idx_pull_trips_driver1 on public.pull_trips(driver1_id, started_at desc);
create index if not exists idx_pull_trips_driver2 on public.pull_trips(driver2_id, started_at desc);

drop trigger if exists trg_pull_trips_updated on public.pull_trips;
create trigger trg_pull_trips_updated before update on public.pull_trips
for each row execute function public.touch_updated_at();

create or replace function public.assign_pull_trip_code()
returns trigger language plpgsql as $$
begin
  if new.trip_code is null or btrim(new.trip_code)='' then
    new.trip_code := 'PUX-' || lpad(nextval('public.pull_trip_number_seq')::text, 7, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_pull_trip_code on public.pull_trips;
create trigger trg_assign_pull_trip_code before insert on public.pull_trips
for each row execute function public.assign_pull_trip_code();

create table if not exists public.pull_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.pull_trips(id) on delete cascade,
  step_id uuid references public.pull_steps(id),
  step_name text not null,
  action_code text not null,
  step_order integer not null,
  user_id uuid not null references auth.users(id),
  user_name text not null,
  recorded_at timestamptz not null default now(),
  device_at timestamptz,
  latitude double precision not null,
  longitude double precision not null,
  gps_accuracy double precision,
  geofence_status text not null default 'NOT_APPLICABLE' check (geofence_status in ('NOT_APPLICABLE','INSIDE','OUTSIDE','NOT_CONFIGURED')),
  distance_factory_m double precision,
  factory_latitude double precision,
  factory_longitude double precision,
  factory_radius_m integer,
  exception_reason text not null default '',
  unique(trip_id,step_id)
);
create index if not exists idx_pull_events_trip on public.pull_events(trip_id,step_order,recorded_at);

create table if not exists public.pull_occurrences (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.pull_trips(id) on delete cascade,
  step_id uuid references public.pull_steps(id),
  occurrence_name text not null,
  action_code text not null,
  duration_mode text not null check (duration_mode in ('POINT','INTERVAL')),
  suggest_tma_discount boolean not null default false,
  started_by uuid not null references auth.users(id),
  started_by_name text not null,
  started_at timestamptz not null default now(),
  start_latitude double precision not null,
  start_longitude double precision not null,
  start_accuracy double precision,
  ended_by uuid references auth.users(id),
  ended_by_name text,
  ended_at timestamptz,
  end_latitude double precision,
  end_longitude double precision,
  end_accuracy double precision,
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  note text not null default ''
);
create index if not exists idx_pull_occurrences_trip on public.pull_occurrences(trip_id,started_at);

create table if not exists public.pull_track_points (
  id bigint generated by default as identity primary key,
  trip_id uuid not null references public.pull_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  device_at timestamptz,
  latitude double precision not null,
  longitude double precision not null,
  gps_accuracy double precision
);
create index if not exists idx_pull_track_trip_time on public.pull_track_points(trip_id,recorded_at);

create table if not exists public.pull_tma_adjust_audit (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.pull_trips(id) on delete cascade,
  old_minutes integer not null,
  new_minutes integer not null,
  old_reason text not null default '',
  new_reason text not null default '',
  changed_by uuid not null references auth.users(id),
  changed_by_name text not null,
  changed_at timestamptz not null default now()
);

-- Vinculo com NRI
alter table public.nri_requests add column if not exists pull_trip_id uuid references public.pull_trips(id) on delete set null;
create index if not exists idx_nri_requests_pull_trip on public.nri_requests(pull_trip_id);

-- ---------------------------------------------------------------------------
-- HELPERS / RPCs
-- ---------------------------------------------------------------------------
create or replace function public.pull_distance_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision
language sql
immutable
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2-lat1)/2),2) +
    cos(radians(lat1))*cos(radians(lat2))*power(sin(radians(lon2-lon1)/2),2)
  ));
$$;

create or replace function public.start_pull_trip(
  p_plate text,
  p_factory text,
  p_driver2 uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy double precision default null,
  p_device_at timestamptz default null
)
returns public.pull_trips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_driver2 public.profiles%rowtype;
  v_trip public.pull_trips%rowtype;
  v_start_step public.pull_steps%rowtype;
  v_unit text;
  v_plate text;
  v_carrier text;
  v_now timestamptz := now();
begin
  if not public.has_role(array['MOTORISTA_PUXADOR','ADMIN']::text[]) then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;

  select * into v_driver2 from public.profiles where id=p_driver2 and role='MOTORISTA_PUXADOR' and active=true;
  if v_driver2.id is null then raise exception 'MOTORISTA_2_INVALIDO'; end if;
  if v_driver2.id=v_profile.id then raise exception 'MOTORISTA_2_DEVE_SER_OUTRO_USUARIO'; end if;

  if exists(select 1 from public.pull_trips t where t.status='IN_PROGRESS' and (t.driver1_id in (v_profile.id,v_driver2.id) or t.driver2_id in (v_profile.id,v_driver2.id))) then
    raise exception 'MOTORISTA_COM_CICLO_EM_ANDAMENTO';
  end if;

  if not exists(select 1 from public.factories where name=p_factory and active=true) then raise exception 'FABRICA_INVALIDA'; end if;
  select default_unit into v_unit from public.pull_settings where singleton=true;
  if coalesce(btrim(v_unit),'')='' then raise exception 'UNIDADE_PADRAO_PUXADA_NAO_CONFIGURADA'; end if;

  v_plate := upper(regexp_replace(coalesce(p_plate,''),'[^A-Za-z0-9]','','g'));
  if v_plate='' then raise exception 'PLACA_OBRIGATORIA'; end if;
  if exists(select 1 from public.pull_trips where plate=v_plate and status='IN_PROGRESS') then raise exception 'PLACA_COM_CICLO_EM_ANDAMENTO'; end if;
  select carrier into v_carrier from public.pull_vehicles where plate=v_plate and active=true limit 1;

  -- A nova saida fecha o TMA Revenda do ciclo anterior da mesma placa.
  update public.pull_trips
     set next_started_at=v_now, kpi_status='CLOSED'
   where id=(select id from public.pull_trips where plate=v_plate and status='ARRIVED' and next_started_at is null order by ended_at desc limit 1);

  insert into public.pull_trips(
    origin_unit,plate,carrier,factory,driver1_id,driver1_name,driver2_id,driver2_name,
    active_driver_id,active_driver_name,started_at,start_latitude,start_longitude,start_accuracy
  ) values(
    v_unit,v_plate,coalesce(v_carrier,''),p_factory,v_profile.id,v_profile.name,v_driver2.id,v_driver2.name,
    v_profile.id,v_profile.name,v_now,p_latitude,p_longitude,p_accuracy
  ) returning * into v_trip;

  select * into v_start_step from public.pull_steps where action_code='START_TRIP' and step_type='MAIN' and active=true limit 1;
  if v_start_step.id is null then raise exception 'ETAPA_INICIO_NAO_CONFIGURADA'; end if;

  insert into public.pull_events(
    trip_id,step_id,step_name,action_code,step_order,user_id,user_name,recorded_at,device_at,latitude,longitude,gps_accuracy
  ) values(
    v_trip.id,v_start_step.id,v_start_step.name,v_start_step.action_code,v_start_step.sort_order,
    v_profile.id,v_profile.name,v_now,p_device_at,p_latitude,p_longitude,p_accuracy
  );

  return v_trip;
end;
$$;

create or replace function public.record_pull_step(
  p_trip_id uuid,
  p_step_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy double precision default null,
  p_exception_reason text default '',
  p_device_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_trip public.pull_trips%rowtype;
  v_step public.pull_steps%rowtype;
  v_next public.pull_steps%rowtype;
  v_factory public.factories%rowtype;
  v_event public.pull_events%rowtype;
  v_max_order integer;
  v_distance double precision;
  v_geofence text := 'NOT_APPLICABLE';
  v_max_accuracy integer := 100;
  v_other_id uuid;
  v_other_name text;
  v_now timestamptz := now();
begin
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;

  select * into v_trip from public.pull_trips where id=p_trip_id for update;
  if v_trip.id is null then raise exception 'CICLO_NAO_ENCONTRADO'; end if;
  if not public.is_admin() and auth.uid() not in (v_trip.driver1_id,v_trip.driver2_id) then raise exception 'FORBIDDEN'; end if;
  if not public.is_admin() and v_trip.active_driver_id<>auth.uid() then raise exception 'MOTORISTA_NAO_ESTA_ATIVO'; end if;
  if v_trip.status<>'IN_PROGRESS' then raise exception 'CICLO_NAO_ESTA_EM_ANDAMENTO'; end if;

  select coalesce(max(step_order),-2147483648) into v_max_order from public.pull_events where trip_id=v_trip.id;
  select * into v_next from public.pull_steps
   where step_type='MAIN' and active=true and sort_order>v_max_order
   order by sort_order limit 1;
  if v_next.id is null then raise exception 'SEM_PROXIMA_ETAPA'; end if;
  if v_next.id<>p_step_id then raise exception 'ETAPA_FORA_DE_SEQUENCIA'; end if;
  v_step := v_next;

  select gps_max_accuracy_m into v_max_accuracy from public.pull_settings where singleton=true;
  if p_accuracy is not null and p_accuracy>coalesce(v_max_accuracy,100) and btrim(coalesce(p_exception_reason,''))='' then
    raise exception 'GPS_BAIXA_PRECISAO';
  end if;

  if v_step.requires_factory_geofence then
    select * into v_factory from public.factories where name=v_trip.factory;
    if v_factory.latitude is null or v_factory.longitude is null or v_factory.radius_meters is null then
      v_geofence := 'NOT_CONFIGURED';
    else
      v_distance := public.pull_distance_m(p_latitude,p_longitude,v_factory.latitude,v_factory.longitude);
      if v_distance<=v_factory.radius_meters then v_geofence:='INSIDE'; else v_geofence:='OUTSIDE'; end if;
      if v_geofence='OUTSIDE' and btrim(coalesce(p_exception_reason,''))='' then
        raise exception 'FORA_RAIO_FABRICA';
      end if;
    end if;
  end if;

  insert into public.pull_events(
    trip_id,step_id,step_name,action_code,step_order,user_id,user_name,recorded_at,device_at,
    latitude,longitude,gps_accuracy,geofence_status,distance_factory_m,factory_latitude,factory_longitude,factory_radius_m,exception_reason
  ) values(
    v_trip.id,v_step.id,v_step.name,v_step.action_code,v_step.sort_order,v_profile.id,v_profile.name,v_now,p_device_at,
    p_latitude,p_longitude,p_accuracy,v_geofence,v_distance,v_factory.latitude,v_factory.longitude,v_factory.radius_meters,btrim(coalesce(p_exception_reason,''))
  ) returning * into v_event;

  if v_step.action_code='ARRIVE_FACTORY' then
    update public.pull_trips set arrived_factory_at=v_now where id=v_trip.id;
  elsif v_step.action_code='LEAVE_FACTORY' then
    update public.pull_trips set left_factory_at=v_now where id=v_trip.id;
  elsif v_step.action_code in ('DRIVER_SWAP_OUT','DRIVER_SWAP_RETURN') then
    if v_trip.active_driver_id=v_trip.driver1_id then
      v_other_id:=v_trip.driver2_id; v_other_name:=v_trip.driver2_name;
    else
      v_other_id:=v_trip.driver1_id; v_other_name:=v_trip.driver1_name;
    end if;
    update public.pull_trips set active_driver_id=v_other_id,active_driver_name=v_other_name where id=v_trip.id;
  elsif v_step.action_code='ARRIVE_UNIT' then
    update public.pull_trips
       set ended_at=v_now,ended_by_id=v_profile.id,ended_by_name=v_profile.name,
           end_latitude=p_latitude,end_longitude=p_longitude,end_accuracy=p_accuracy,
           status='ARRIVED',kpi_status='WAITING_NEXT_START',nri_status='PENDING',
           active_driver_id=v_profile.id,active_driver_name=v_profile.name
     where id=v_trip.id;
  end if;

  select * into v_trip from public.pull_trips where id=p_trip_id;
  return jsonb_build_object('event',to_jsonb(v_event),'trip',to_jsonb(v_trip));
end;
$$;

create or replace function public.start_pull_occurrence(
  p_trip_id uuid,
  p_step_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy double precision default null,
  p_note text default ''
)
returns public.pull_occurrences
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_trip public.pull_trips%rowtype;
  v_step public.pull_steps%rowtype;
  v_row public.pull_occurrences%rowtype;
  v_now timestamptz:=now();
begin
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  select * into v_trip from public.pull_trips where id=p_trip_id;
  if v_profile.id is null or v_trip.id is null then raise exception 'CICLO_NAO_ENCONTRADO'; end if;
  if auth.uid() not in (v_trip.driver1_id,v_trip.driver2_id) and not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if not public.is_admin() and v_trip.active_driver_id<>auth.uid() then raise exception 'MOTORISTA_NAO_ESTA_ATIVO'; end if;
  if v_trip.status<>'IN_PROGRESS' then raise exception 'CICLO_NAO_ESTA_EM_ANDAMENTO'; end if;
  select * into v_step from public.pull_steps where id=p_step_id and step_type='OCCURRENCE' and active=true;
  if v_step.id is null then raise exception 'OCORRENCIA_INVALIDA'; end if;
  if v_step.duration_mode='INTERVAL' and exists(select 1 from public.pull_occurrences where trip_id=v_trip.id and status='OPEN') then
    raise exception 'JA_EXISTE_OCORRENCIA_ABERTA';
  end if;

  insert into public.pull_occurrences(
    trip_id,step_id,occurrence_name,action_code,duration_mode,suggest_tma_discount,
    started_by,started_by_name,started_at,start_latitude,start_longitude,start_accuracy,
    ended_by,ended_by_name,ended_at,end_latitude,end_longitude,end_accuracy,status,note
  ) values(
    v_trip.id,v_step.id,v_step.name,v_step.action_code,v_step.duration_mode,v_step.suggest_tma_discount,
    v_profile.id,v_profile.name,v_now,p_latitude,p_longitude,p_accuracy,
    case when v_step.duration_mode='POINT' then v_profile.id else null end,
    case when v_step.duration_mode='POINT' then v_profile.name else null end,
    case when v_step.duration_mode='POINT' then v_now else null end,
    case when v_step.duration_mode='POINT' then p_latitude else null end,
    case when v_step.duration_mode='POINT' then p_longitude else null end,
    case when v_step.duration_mode='POINT' then p_accuracy else null end,
    case when v_step.duration_mode='POINT' then 'CLOSED' else 'OPEN' end,
    btrim(coalesce(p_note,''))
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.end_pull_occurrence(
  p_occurrence_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy double precision default null
)
returns public.pull_occurrences
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_row public.pull_occurrences%rowtype;
  v_trip public.pull_trips%rowtype;
begin
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  select * into v_row from public.pull_occurrences where id=p_occurrence_id for update;
  if v_row.id is null or v_row.status<>'OPEN' then raise exception 'OCORRENCIA_NAO_ESTA_ABERTA'; end if;
  select * into v_trip from public.pull_trips where id=v_row.trip_id;
  if auth.uid() not in (v_trip.driver1_id,v_trip.driver2_id) and not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if not public.is_admin() and v_trip.active_driver_id<>auth.uid() then raise exception 'MOTORISTA_NAO_ESTA_ATIVO'; end if;
  update public.pull_occurrences set ended_by=v_profile.id,ended_by_name=v_profile.name,ended_at=now(),
    end_latitude=p_latitude,end_longitude=p_longitude,end_accuracy=p_accuracy,status='CLOSED'
  where id=v_row.id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.record_pull_track_point(
  p_trip_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy double precision default null,
  p_device_at timestamptz default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.pull_trips%rowtype;
  v_id bigint;
begin
  select * into v_trip from public.pull_trips where id=p_trip_id;
  if v_trip.id is null or v_trip.status<>'IN_PROGRESS' then raise exception 'CICLO_NAO_ESTA_EM_ANDAMENTO'; end if;
  if auth.uid() not in (v_trip.driver1_id,v_trip.driver2_id) and not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if not public.is_admin() and v_trip.active_driver_id<>auth.uid() then raise exception 'MOTORISTA_NAO_ESTA_ATIVO'; end if;
  insert into public.pull_track_points(trip_id,user_id,device_at,latitude,longitude,gps_accuracy)
  values(v_trip.id,auth.uid(),p_device_at,p_latitude,p_longitude,p_accuracy) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.adjust_pull_tma(p_trip_id uuid,p_minutes integer,p_reason text)
returns public.pull_trips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_trip public.pull_trips%rowtype;
  v_raw integer;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  select * into v_trip from public.pull_trips where id=p_trip_id for update;
  if v_trip.id is null then raise exception 'CICLO_NAO_ENCONTRADO'; end if;
  if coalesce(p_minutes,0)<0 then raise exception 'AJUSTE_INVALIDO'; end if;
  if p_minutes>0 and btrim(coalesce(p_reason,''))='' then raise exception 'MOTIVO_AJUSTE_OBRIGATORIO'; end if;
  if v_trip.ended_at is not null and v_trip.next_started_at is not null then
    v_raw:=greatest(0,floor(extract(epoch from (v_trip.next_started_at-v_trip.ended_at))/60)::integer);
    if p_minutes>v_raw then raise exception 'AJUSTE_MAIOR_QUE_TMA_BRUTO'; end if;
  end if;
  insert into public.pull_tma_adjust_audit(trip_id,old_minutes,new_minutes,old_reason,new_reason,changed_by,changed_by_name)
  values(v_trip.id,v_trip.tma_adjust_minutes,p_minutes,v_trip.tma_adjust_reason,btrim(coalesce(p_reason,'')),v_profile.id,v_profile.name);
  update public.pull_trips set tma_adjust_minutes=p_minutes,tma_adjust_reason=btrim(coalesce(p_reason,'')),
    tma_adjusted_by=v_profile.id,tma_adjusted_by_name=v_profile.name,tma_adjusted_at=now()
  where id=v_trip.id returning * into v_trip;
  return v_trip;
end;
$$;

-- Atualiza a funcao de NRI para aceitar o vinculo com uma Puxada.
create or replace function public.create_nri_request(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_req uuid;
  v_item jsonb;
  v_count integer;
  v_i integer;
  v_rows jsonb;
  v_type text;
  v_driver text;
  v_plate text;
  v_factory text;
  v_validity date;
  v_pull_trip uuid;
  v_pull public.pull_trips%rowtype;
begin
  if not public.has_role(array['ADMIN','COLABORADOR_ARMAZEM','CONFERENTE']::text[]) then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;

  v_type := upper(coalesce(nullif(btrim(p_payload->>'request_type'),''),'AMBEV'));
  if v_type not in ('AMBEV','MARKETPLACE') then raise exception 'TIPO_NRI_INVALIDO'; end if;

  if coalesce(btrim(p_payload->>'pull_trip_id'),'')<>'' then
    v_pull_trip := (p_payload->>'pull_trip_id')::uuid;
    select * into v_pull from public.pull_trips where id=v_pull_trip for update;
    if v_pull.id is null or v_pull.status<>'ARRIVED' or v_pull.nri_status<>'PENDING' then raise exception 'PUXADA_NAO_DISPONIVEL_PARA_NRI'; end if;
  end if;

  if v_type = 'MARKETPLACE' then
    v_driver := '--'; v_plate := '--'; v_factory := '--';
  else
    v_driver := btrim(p_payload->>'driver');
    v_plate := upper(btrim(p_payload->>'plate'));
    v_factory := btrim(p_payload->>'factory');
    if coalesce(v_driver,'')='' or coalesce(v_plate,'')='' or coalesce(v_factory,'')='' then raise exception 'DADOS_TRANSPORTE_OBRIGATORIOS'; end if;
  end if;

  insert into public.nri_requests(
    unit,request_type,receipt_date,checker_id,checker_name,receipt_time,driver,plate,factory,created_by,pull_trip_id
  ) values(
    btrim(p_payload->>'unit'),v_type,(p_payload->>'receipt_date')::date,
    auth.uid(),v_profile.name,(p_payload->>'receipt_time')::time,
    v_driver,v_plate,v_factory,auth.uid(),v_pull_trip
  ) returning id into v_req;

  for v_item in select value from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    v_count := greatest(1, coalesce((v_item->>'pallets')::integer,1));
    v_validity := nullif(btrim(coalesce(v_item->>'validity_date','')),'')::date;
    for v_i in 1..v_count loop
      insert into public.nris(
        nri,request_id,product_code,product_name,unit,request_type,validity_date,lot,receipt_date,block_date,
        checker_name,receipt_time,driver,plate,factory,quantity,status,created_by,created_by_username,created_by_name
      ) values(
        null,v_req,btrim(v_item->>'product_code'),btrim(v_item->>'product_name'),btrim(p_payload->>'unit'),v_type,
        v_validity,upper(btrim(v_item->>'lot')),(p_payload->>'receipt_date')::date,
        case when v_validity is null then null else (v_validity - 30) end,
        v_profile.name,(p_payload->>'receipt_time')::time,v_driver,v_plate,v_factory,
        greatest(0,(v_item->>'quantity')::integer),'PENDENTE',auth.uid(),v_profile.username,v_profile.name
      );
    end loop;
  end loop;

  if v_pull_trip is not null then
    update public.pull_trips set nri_status='COMPLETED' where id=v_pull_trip;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.nri),'[]'::jsonb) into v_rows
  from public.nris x where x.request_id=v_req;
  return jsonb_build_object('request_id',v_req,'pull_trip_id',v_pull_trip,'nris',v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.pull_settings enable row level security;
alter table public.pull_vehicles enable row level security;
alter table public.pull_steps enable row level security;
alter table public.pull_goals enable row level security;
alter table public.pull_trips enable row level security;
alter table public.pull_events enable row level security;
alter table public.pull_occurrences enable row level security;
alter table public.pull_track_points enable row level security;
alter table public.pull_tma_adjust_audit enable row level security;

drop policy if exists pull_settings_read on public.pull_settings;
drop policy if exists pull_settings_admin on public.pull_settings;
drop policy if exists pull_vehicles_read on public.pull_vehicles;
drop policy if exists pull_vehicles_admin on public.pull_vehicles;
drop policy if exists pull_steps_read on public.pull_steps;
drop policy if exists pull_steps_admin on public.pull_steps;
drop policy if exists pull_goals_read on public.pull_goals;
drop policy if exists pull_goals_admin on public.pull_goals;
drop policy if exists pull_trips_read on public.pull_trips;
drop policy if exists pull_trips_admin on public.pull_trips;
drop policy if exists pull_events_read on public.pull_events;
drop policy if exists pull_events_admin on public.pull_events;
drop policy if exists pull_occurrences_read on public.pull_occurrences;
drop policy if exists pull_occurrences_admin on public.pull_occurrences;
drop policy if exists pull_track_read on public.pull_track_points;
drop policy if exists pull_track_admin on public.pull_track_points;
drop policy if exists pull_tma_audit_admin on public.pull_tma_adjust_audit;

create policy pull_settings_read on public.pull_settings for select to authenticated using (true);
create policy pull_settings_admin on public.pull_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pull_vehicles_read on public.pull_vehicles for select to authenticated using (true);
create policy pull_vehicles_admin on public.pull_vehicles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pull_steps_read on public.pull_steps for select to authenticated using (true);
create policy pull_steps_admin on public.pull_steps for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pull_goals_read on public.pull_goals for select to authenticated using (true);
create policy pull_goals_admin on public.pull_goals for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy pull_trips_read on public.pull_trips for select to authenticated using (
  public.is_admin() or driver1_id=auth.uid() or driver2_id=auth.uid()
  or (public.has_role(array['COLABORADOR_ARMAZEM','CONFERENTE']::text[]) and status='ARRIVED')
);
create policy pull_trips_admin on public.pull_trips for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pull_events_read on public.pull_events for select to authenticated using (
  public.is_admin() or exists(select 1 from public.pull_trips t where t.id=trip_id and (t.driver1_id=auth.uid() or t.driver2_id=auth.uid()))
);
create policy pull_events_admin on public.pull_events for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pull_occurrences_read on public.pull_occurrences for select to authenticated using (
  public.is_admin() or exists(select 1 from public.pull_trips t where t.id=trip_id and (t.driver1_id=auth.uid() or t.driver2_id=auth.uid()))
);
create policy pull_occurrences_admin on public.pull_occurrences for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pull_track_read on public.pull_track_points for select to authenticated using (
  public.is_admin() or exists(select 1 from public.pull_trips t where t.id=trip_id and (t.driver1_id=auth.uid() or t.driver2_id=auth.uid()))
);
create policy pull_track_admin on public.pull_track_points for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pull_tma_audit_admin on public.pull_tma_adjust_audit for select to authenticated using (public.is_admin());

-- Grants: as escritas operacionais de motorista passam pelas RPCs acima.
grant select,insert,update,delete on public.pull_settings,public.pull_vehicles,public.pull_steps,public.pull_goals,
  public.pull_trips,public.pull_events,public.pull_occurrences,public.pull_track_points,public.pull_tma_adjust_audit to authenticated;
grant usage,select on sequence public.pull_trip_number_seq to authenticated;
grant usage,select on sequence public.pull_track_points_id_seq to authenticated;
grant execute on function public.pull_distance_m(double precision,double precision,double precision,double precision) to authenticated;
grant execute on function public.start_pull_trip(text,text,uuid,double precision,double precision,double precision,timestamptz) to authenticated;
grant execute on function public.record_pull_step(uuid,uuid,double precision,double precision,double precision,text,timestamptz) to authenticated;
grant execute on function public.start_pull_occurrence(uuid,uuid,double precision,double precision,double precision,text) to authenticated;
grant execute on function public.end_pull_occurrence(uuid,double precision,double precision,double precision) to authenticated;
grant execute on function public.record_pull_track_point(uuid,double precision,double precision,double precision,timestamptz) to authenticated;
grant execute on function public.adjust_pull_tma(uuid,integer,text) to authenticated;
grant execute on function public.create_nri_request(jsonb) to authenticated;

-- Realtime
DO $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='pull_trips') then
    execute 'alter publication supabase_realtime add table public.pull_trips';
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='pull_events') then
    execute 'alter publication supabase_realtime add table public.pull_events';
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='pull_occurrences') then
    execute 'alter publication supabase_realtime add table public.pull_occurrences';
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='pull_track_points') then
    execute 'alter publication supabase_realtime add table public.pull_track_points';
  end if;
end $$;

-- <<< v1.1.0 MODULO PUXADA <<<
