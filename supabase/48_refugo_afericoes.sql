-- Armazem > Refugo. Execute no SQL Editor do Supabase apos o SQL 47.
-- Tipos, motivos e ajudantes ficam no banco; cada afericao tem itens e tempos proprios.
begin;

insert into public.permissions(code,module,name,description,sort_order,active) values
  ('REFUGO_AFERIR','Refugo','Aferir refugo','Iniciar e finalizar mapas e vasilhames de refugo.',10,true),
  ('REFUGO_HISTORICO','Refugo','Historico / CSV','Consultar afericoes e baixar o CSV de cada mapa.',20,true),
  ('REFUGO_CONFIG','Refugo','Cadastros','Cadastrar tipos de vasilhame, motivos e ajudantes.',30,true)
on conflict(code) do update set module=excluded.module,name=excluded.name,
  description=excluded.description,sort_order=excluded.sort_order,active=true;

insert into public.role_permissions(role,permission_code) values
  ('COLABORADOR_ARMAZEM','REFUGO_AFERIR'),('COLABORADOR_ARMAZEM','REFUGO_HISTORICO'),
  ('CONFERENTE','REFUGO_AFERIR'),('CONFERENTE','REFUGO_HISTORICO'),
  ('ADMIN','REFUGO_AFERIR'),('ADMIN','REFUGO_HISTORICO'),('ADMIN','REFUGO_CONFIG')
on conflict do nothing;

alter table public.module_settings drop constraint if exists module_settings_name_valid;
alter table public.module_settings add constraint module_settings_name_valid check (module_name in (
  'NRI','Conferência','Contagem FEFO','Ativo de Giro','Materiais','Refugo',
  'Avarias de Entrega','Avarias de Vendas','Puxada'
));
insert into public.module_settings(module_name,active) values ('Refugo',true)
on conflict(module_name) do nothing;

create or replace function public.refugo_user_has_unit(p_unit text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.user_units uu
    join public.profiles p on p.id=uu.user_id and p.active=true
    where uu.user_id=auth.uid() and uu.unit_name=btrim(coalesce(p_unit,''))
  );
$$;

create or replace function public.refugo_can_read()
returns boolean language sql stable security definer set search_path=public as $$
  select public.has_permission('REFUGO_AFERIR')
      or public.has_permission('REFUGO_HISTORICO')
      or public.has_permission('REFUGO_CONFIG');
$$;

create table public.refugo_catalog (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('TYPE','REASON','HELPER')),
  unit text references public.units(name) on update cascade,
  name text not null check(length(btrim(name)) between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check((kind='HELPER' and unit is not null) or (kind<>'HELPER' and unit is null))
);
create unique index refugo_catalog_unique_name on public.refugo_catalog(kind,coalesce(unit,''),lower(btrim(name)));
create index refugo_catalog_list on public.refugo_catalog(kind,unit,active,name);

create table public.refugo_sessions (
  id uuid primary key default gen_random_uuid(),
  unit text not null references public.units(name) on update cascade,
  map_number text not null check(map_number ~ '^[0-9]{1,30}$'),
  helper_id uuid not null references public.refugo_catalog(id),
  helper_name text not null,
  status text not null default 'OPEN' check(status in ('OPEN','COMPLETED','CANCELLED')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_by_name text not null,
  completed_by uuid references auth.users(id),
  cancelled_by uuid references auth.users(id),
  check((status='COMPLETED')=(completed_at is not null)),
  check((status='CANCELLED')=(cancelled_at is not null))
);
create unique index refugo_one_open_map on public.refugo_sessions(unit,map_number) where status='OPEN';
create index refugo_sessions_unit_date on public.refugo_sessions(unit,started_at desc);

create table public.refugo_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.refugo_sessions(id) on delete cascade,
  type_id uuid not null references public.refugo_catalog(id),
  type_name text not null,
  status text not null default 'RUNNING' check(status in ('RUNNING','COMPLETED')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  quantity_checked integer check(quantity_checked>0),
  quantity_rejected integer not null default 0 check(quantity_rejected>=0),
  note text not null default '' check(length(note)<=1000),
  created_by uuid not null references auth.users(id),
  check(status='RUNNING' or (ended_at is not null and quantity_checked is not null and quantity_rejected<=quantity_checked))
);
create unique index refugo_one_running_item on public.refugo_items(session_id) where status='RUNNING';
create index refugo_items_session_time on public.refugo_items(session_id,started_at);

create table public.refugo_item_reasons (
  item_id uuid not null references public.refugo_items(id) on delete cascade,
  reason_id uuid not null references public.refugo_catalog(id),
  reason_name text not null,
  quantity integer not null check(quantity>0),
  primary key(item_id,reason_id)
);

alter table public.refugo_catalog enable row level security;
alter table public.refugo_sessions enable row level security;
alter table public.refugo_items enable row level security;
alter table public.refugo_item_reasons enable row level security;
create policy refugo_catalog_read on public.refugo_catalog for select to authenticated
  using(public.refugo_can_read() and (unit is null or public.refugo_user_has_unit(unit)));
create policy refugo_sessions_read on public.refugo_sessions for select to authenticated
  using(public.refugo_can_read() and public.refugo_user_has_unit(unit));
create policy refugo_items_read on public.refugo_items for select to authenticated
  using(exists(select 1 from public.refugo_sessions s where s.id=session_id
    and public.refugo_user_has_unit(s.unit) and public.refugo_can_read()));
create policy refugo_item_reasons_read on public.refugo_item_reasons for select to authenticated
  using(exists(select 1 from public.refugo_items i join public.refugo_sessions s on s.id=i.session_id
    where i.id=item_id and public.refugo_user_has_unit(s.unit) and public.refugo_can_read()));
grant select on public.refugo_catalog,public.refugo_sessions,public.refugo_items,public.refugo_item_reasons to authenticated;

create or replace function public.save_refugo_catalog(p_id uuid,p_kind text,p_unit text,p_name text,p_active boolean)
returns public.refugo_catalog language plpgsql security definer set search_path=public as $$
declare v_row public.refugo_catalog%rowtype; v_unit text;
begin
  if not public.has_permission('REFUGO_CONFIG') then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('TYPE','REASON','HELPER') then raise exception 'REFUGO_CADASTRO_TIPO_INVALIDO'; end if;
  if length(btrim(coalesce(p_name,''))) not between 1 and 100 then raise exception 'REFUGO_NOME_INVALIDO'; end if;
  v_unit:=case when p_kind='HELPER' then btrim(coalesce(p_unit,'')) else null end;
  if p_kind='HELPER' and not public.refugo_user_has_unit(v_unit) then raise exception 'FORBIDDEN'; end if;
  if p_id is null then
    insert into public.refugo_catalog(kind,unit,name,active,updated_by)
    values(p_kind,v_unit,btrim(p_name),coalesce(p_active,true),auth.uid()) returning * into v_row;
  else
    update public.refugo_catalog set name=btrim(p_name),active=coalesce(p_active,true),
      updated_at=now(),updated_by=auth.uid()
    where id=p_id and kind=p_kind and unit is not distinct from v_unit returning * into v_row;
    if v_row.id is null then raise exception 'REFUGO_CADASTRO_NAO_ENCONTRADO'; end if;
  end if;
  return v_row;
end;
$$;

create or replace function public.start_refugo_session(p_unit text,p_map_number text,p_helper_id uuid)
returns public.refugo_sessions language plpgsql security definer set search_path=public as $$
declare v_row public.refugo_sessions%rowtype; v_helper public.refugo_catalog%rowtype; v_name text;
begin
  if not public.has_permission('REFUGO_AFERIR') or not public.refugo_user_has_unit(p_unit) then raise exception 'FORBIDDEN'; end if;
  if btrim(coalesce(p_map_number,'')) !~ '^[0-9]{1,30}$' then raise exception 'REFUGO_MAPA_INVALIDO'; end if;
  select * into v_helper from public.refugo_catalog where id=p_helper_id and kind='HELPER'
    and unit=p_unit and active=true;
  if v_helper.id is null then raise exception 'REFUGO_AJUDANTE_INVALIDO'; end if;
  select name into v_name from public.profiles where id=auth.uid() and active=true;
  if v_name is null then raise exception 'UNAUTHORIZED'; end if;
  insert into public.refugo_sessions(unit,map_number,helper_id,helper_name,created_by,created_by_name)
  values(p_unit,btrim(p_map_number),v_helper.id,v_helper.name,auth.uid(),v_name) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.start_refugo_item(p_session_id uuid,p_type_id uuid)
returns public.refugo_items language plpgsql security definer set search_path=public as $$
declare v_session public.refugo_sessions%rowtype; v_type public.refugo_catalog%rowtype;
  v_row public.refugo_items%rowtype;
begin
  if not public.has_permission('REFUGO_AFERIR') then raise exception 'FORBIDDEN'; end if;
  select * into v_session from public.refugo_sessions where id=p_session_id for update;
  if v_session.id is null or not public.refugo_user_has_unit(v_session.unit) then raise exception 'FORBIDDEN'; end if;
  if v_session.status<>'OPEN' then raise exception 'REFUGO_MAPA_FINALIZADO'; end if;
  if exists(select 1 from public.refugo_items where session_id=p_session_id and status='RUNNING') then
    raise exception 'REFUGO_ITEM_EM_ANDAMENTO'; end if;
  select * into v_type from public.refugo_catalog where id=p_type_id and kind='TYPE' and active=true;
  if v_type.id is null then raise exception 'REFUGO_TIPO_INVALIDO'; end if;
  insert into public.refugo_items(session_id,type_id,type_name,created_by)
  values(p_session_id,v_type.id,v_type.name,auth.uid()) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.finish_refugo_item(p_item_id uuid,p_quantity_checked integer,p_note text,p_reasons jsonb)
returns public.refugo_items language plpgsql security definer set search_path=public as $$
declare v_item public.refugo_items%rowtype; v_session public.refugo_sessions%rowtype;
  v_entry jsonb; v_reason public.refugo_catalog%rowtype; v_qty integer; v_total integer:=0;
begin
  if not public.has_permission('REFUGO_AFERIR') then raise exception 'FORBIDDEN'; end if;
  select * into v_item from public.refugo_items where id=p_item_id for update;
  if v_item.id is null then raise exception 'REFUGO_ITEM_NAO_ENCONTRADO'; end if;
  select * into v_session from public.refugo_sessions where id=v_item.session_id;
  if not public.refugo_user_has_unit(v_session.unit) then raise exception 'FORBIDDEN'; end if;
  if v_session.status<>'OPEN' or v_item.status<>'RUNNING' then raise exception 'REFUGO_ITEM_FINALIZADO'; end if;
  if p_quantity_checked is null or p_quantity_checked<=0 then raise exception 'REFUGO_QUANTIDADE_INVALIDA'; end if;
  if length(btrim(coalesce(p_note,'')))>1000 then raise exception 'REFUGO_OBSERVACAO_LONGA'; end if;
  if p_reasons is null or jsonb_typeof(p_reasons)<>'array' then raise exception 'REFUGO_MOTIVOS_INVALIDOS'; end if;
  for v_entry in select value from jsonb_array_elements(p_reasons) loop
    if jsonb_typeof(v_entry)<>'object' or coalesce(v_entry->>'quantity','') !~ '^[0-9]{1,9}$' then
      raise exception 'REFUGO_MOTIVOS_INVALIDOS'; end if;
    v_qty:=(v_entry->>'quantity')::integer;
    if v_qty=0 then continue; end if;
    select * into v_reason from public.refugo_catalog
      where id=(v_entry->>'id')::uuid and kind='REASON' and active=true;
    if v_reason.id is null then raise exception 'REFUGO_MOTIVO_INVALIDO'; end if;
    insert into public.refugo_item_reasons(item_id,reason_id,reason_name,quantity)
    values(v_item.id,v_reason.id,v_reason.name,v_qty);
    v_total:=v_total+v_qty;
  end loop;
  if v_total>p_quantity_checked then raise exception 'REFUGO_TOTAL_SUPERA_AFERIDO'; end if;
  update public.refugo_items set status='COMPLETED',ended_at=now(),quantity_checked=p_quantity_checked,
    quantity_rejected=v_total,note=btrim(coalesce(p_note,'')) where id=v_item.id returning * into v_item;
  return v_item;
end;
$$;

create or replace function public.cancel_refugo_item(p_item_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_item public.refugo_items%rowtype; v_session public.refugo_sessions%rowtype;
begin
  if not public.has_permission('REFUGO_AFERIR') then raise exception 'FORBIDDEN'; end if;
  select * into v_item from public.refugo_items where id=p_item_id for update;
  if v_item.id is null then raise exception 'REFUGO_ITEM_NAO_ENCONTRADO'; end if;
  select * into v_session from public.refugo_sessions where id=v_item.session_id;
  if not public.refugo_user_has_unit(v_session.unit) then raise exception 'FORBIDDEN'; end if;
  if v_session.status<>'OPEN' or v_item.status<>'RUNNING' then raise exception 'REFUGO_ITEM_FINALIZADO'; end if;
  delete from public.refugo_items where id=v_item.id;
end;
$$;

create or replace function public.complete_refugo_session(p_session_id uuid)
returns public.refugo_sessions language plpgsql security definer set search_path=public as $$
declare v_row public.refugo_sessions%rowtype;
begin
  if not public.has_permission('REFUGO_AFERIR') then raise exception 'FORBIDDEN'; end if;
  select * into v_row from public.refugo_sessions where id=p_session_id for update;
  if v_row.id is null or not public.refugo_user_has_unit(v_row.unit) then raise exception 'FORBIDDEN'; end if;
  if v_row.status<>'OPEN' then raise exception 'REFUGO_MAPA_FINALIZADO'; end if;
  if exists(select 1 from public.refugo_items where session_id=p_session_id and status='RUNNING') then
    raise exception 'REFUGO_ITEM_EM_ANDAMENTO'; end if;
  if not exists(select 1 from public.refugo_items where session_id=p_session_id and status='COMPLETED') then
    raise exception 'REFUGO_MAPA_SEM_ITENS'; end if;
  update public.refugo_sessions set status='COMPLETED',completed_at=now(),completed_by=auth.uid()
    where id=p_session_id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.cancel_refugo_session(p_session_id uuid)
returns public.refugo_sessions language plpgsql security definer set search_path=public as $$
declare v_row public.refugo_sessions%rowtype;
begin
  if not public.has_permission('REFUGO_AFERIR') then raise exception 'FORBIDDEN'; end if;
  select * into v_row from public.refugo_sessions where id=p_session_id for update;
  if v_row.id is null or not public.refugo_user_has_unit(v_row.unit) then raise exception 'FORBIDDEN'; end if;
  if v_row.status<>'OPEN' then raise exception 'REFUGO_MAPA_FINALIZADO'; end if;
  if exists(select 1 from public.refugo_items where session_id=p_session_id and status='RUNNING') then
    raise exception 'REFUGO_ITEM_EM_ANDAMENTO'; end if;
  update public.refugo_sessions set status='CANCELLED',cancelled_at=now(),cancelled_by=auth.uid()
    where id=p_session_id returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.save_refugo_catalog(uuid,text,text,text,boolean) from public;
revoke all on function public.start_refugo_session(text,text,uuid) from public;
revoke all on function public.start_refugo_item(uuid,uuid) from public;
revoke all on function public.finish_refugo_item(uuid,integer,text,jsonb) from public;
revoke all on function public.cancel_refugo_item(uuid) from public;
revoke all on function public.complete_refugo_session(uuid) from public;
revoke all on function public.cancel_refugo_session(uuid) from public;
grant execute on function public.save_refugo_catalog(uuid,text,text,text,boolean),
  public.start_refugo_session(text,text,uuid),public.start_refugo_item(uuid,uuid),
  public.finish_refugo_item(uuid,integer,text,jsonb),public.cancel_refugo_item(uuid),
  public.complete_refugo_session(uuid),public.cancel_refugo_session(uuid) to authenticated;

commit;
