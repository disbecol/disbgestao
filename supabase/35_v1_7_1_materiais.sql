-- Disb Gestao v1.7.1
-- SQL 35 - Submodulo Armazem > Materiais
-- Estoque, cadastro, movimentacoes e inventario com identificadores individuais.
-- Executar manualmente no Supabase SQL Editor.

begin;

-- ===========================================================================
-- PERMISSOES
-- ===========================================================================
insert into public.permissions(code,module,name,description,sort_order,active) values
  ('MATERIAL_INVENTORY','Materiais','Contagem','Iniciar, preencher, finalizar e consultar inventarios de materiais.',10,true),
  ('MATERIAL_STOCK_VIEW','Materiais','Estoque','Consultar saldos e identificadores individuais em estoque.',20,true),
  ('MATERIAL_CATALOG','Materiais','Cadastro de Materiais','Cadastrar e editar materiais controlados pelo armazem.',30,true),
  ('MATERIAL_MOVEMENT','Materiais','Movimentacao do estoque','Registrar entradas/saidas manuais e consultar o historico.',40,true)
on conflict(code) do update set
  module=excluded.module,
  name=excluded.name,
  description=excluded.description,
  sort_order=excluded.sort_order,
  active=true;

insert into public.role_permissions(role,permission_code) values
  ('COLABORADOR_ARMAZEM','MATERIAL_INVENTORY'),
  ('COLABORADOR_ARMAZEM','MATERIAL_STOCK_VIEW'),
  ('COLABORADOR_ARMAZEM','MATERIAL_CATALOG'),
  ('COLABORADOR_ARMAZEM','MATERIAL_MOVEMENT'),
  ('CONFERENTE','MATERIAL_INVENTORY'),
  ('CONFERENTE','MATERIAL_STOCK_VIEW'),
  ('CONFERENTE','MATERIAL_CATALOG'),
  ('CONFERENTE','MATERIAL_MOVEMENT')
on conflict do nothing;

insert into public.role_permissions(role,permission_code)
select 'ADMIN',code
from public.permissions
where code in ('MATERIAL_INVENTORY','MATERIAL_STOCK_VIEW','MATERIAL_CATALOG','MATERIAL_MOVEMENT')
on conflict do nothing;

-- ===========================================================================
-- HELPERS
-- ===========================================================================
create or replace function public.material_user_has_unit(p_unit text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(exists(
    select 1
    from public.user_units uu
    join public.profiles p on p.id=uu.user_id and p.active=true
    where uu.user_id=auth.uid()
      and uu.unit_name=btrim(coalesce(p_unit,''))
  ),false);
$$;

create or replace function public.material_any_permission()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select
    public.has_permission('MATERIAL_INVENTORY')
    or public.has_permission('MATERIAL_STOCK_VIEW')
    or public.has_permission('MATERIAL_CATALOG')
    or public.has_permission('MATERIAL_MOVEMENT');
$$;

-- ===========================================================================
-- CADASTRO
-- ===========================================================================
create sequence if not exists public.material_number_seq start 1;

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null default '',
  stock_unit text not null default 'UNIDADE',
  requires_identifier boolean not null default false,
  minimum_stock integer not null default 0 check(minimum_stock>=0),
  notes text not null default '',
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_materials_name_ci
  on public.materials(lower(btrim(name)));
create index if not exists idx_materials_active_name
  on public.materials(active,name);

drop trigger if exists trg_materials_updated on public.materials;
create trigger trg_materials_updated before update on public.materials
for each row execute function public.touch_updated_at();

create or replace function public.assign_material_code()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.code is null or btrim(new.code)='' then
    new.code := 'MAT-' || lpad(nextval('public.material_number_seq')::text,6,'0');
  end if;
  new.code := upper(btrim(new.code));
  new.name := btrim(new.name);
  new.category := btrim(coalesce(new.category,''));
  new.stock_unit := upper(btrim(coalesce(new.stock_unit,'UNIDADE')));
  new.notes := btrim(coalesce(new.notes,''));
  return new;
end;
$$;

drop trigger if exists trg_assign_material_code on public.materials;
create trigger trg_assign_material_code
before insert or update of code,name,category,stock_unit,notes on public.materials
for each row execute function public.assign_material_code();

-- ===========================================================================
-- ESTOQUE E IDENTIFICADORES
-- ===========================================================================
create table if not exists public.material_stock (
  unit text not null references public.units(name) on update cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  quantity integer not null default 0 check(quantity>=0),
  updated_by uuid references auth.users(id),
  updated_by_name text not null default '',
  updated_at timestamptz not null default now(),
  primary key(unit,material_id)
);

create index if not exists idx_material_stock_material
  on public.material_stock(material_id,unit);

create table if not exists public.material_identifiers (
  id uuid primary key default gen_random_uuid(),
  identifier_code text not null unique,
  material_id uuid not null references public.materials(id) on delete restrict,
  unit text not null references public.units(name) on update cascade,
  in_stock boolean not null default true,
  works boolean,
  last_source_type text not null default 'MANUAL',
  last_source_id uuid,
  updated_by uuid references auth.users(id),
  updated_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_material_identifiers_stock
  on public.material_identifiers(unit,material_id,in_stock,identifier_code);

drop trigger if exists trg_material_identifiers_updated on public.material_identifiers;
create trigger trg_material_identifiers_updated before update on public.material_identifiers
for each row execute function public.touch_updated_at();

-- ===========================================================================
-- MOVIMENTACOES
-- ===========================================================================
create table if not exists public.material_movements (
  id uuid primary key default gen_random_uuid(),
  unit text not null references public.units(name) on update cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  material_code text not null,
  material_name text not null,
  movement_type text not null check(movement_type in ('ENTRY','EXIT','INVENTORY_ADJUSTMENT')),
  quantity_delta integer not null,
  balance_before integer not null check(balance_before>=0),
  balance_after integer not null check(balance_after>=0),
  origin_type text not null default 'MANUAL' check(origin_type in ('MANUAL','INVENTORY')),
  origin_id uuid,
  justification text not null default '',
  created_by uuid not null references auth.users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  check(movement_type='INVENTORY_ADJUSTMENT' or quantity_delta<>0)
);

create index if not exists idx_material_movements_unit_date
  on public.material_movements(unit,created_at desc);
create index if not exists idx_material_movements_material
  on public.material_movements(material_id,created_at desc);

create table if not exists public.material_movement_identifiers (
  movement_id uuid not null references public.material_movements(id) on delete cascade,
  identifier_id uuid references public.material_identifiers(id) on delete set null,
  identifier_code text not null,
  works boolean,
  action text not null default 'COUNTED' check(action in ('ENTRY','EXIT','COUNTED','MISSING')),
  created_at timestamptz not null default now(),
  primary key(movement_id,identifier_code,action)
);

create index if not exists idx_material_movement_ids_code
  on public.material_movement_identifiers(identifier_code,created_at desc);

-- ===========================================================================
-- INVENTARIO
-- ===========================================================================
create sequence if not exists public.material_inventory_number_seq start 1;

create table if not exists public.material_inventory_counts (
  id uuid primary key default gen_random_uuid(),
  count_code text not null unique,
  unit text not null references public.units(name) on update cascade,
  count_date date not null default ((now() at time zone 'America/Fortaleza')::date),
  status text not null default 'IN_PROGRESS' check(status in ('IN_PROGRESS','FINALIZED','CANCELLED')),
  counter_id uuid not null references auth.users(id),
  counter_name text not null,
  started_at timestamptz not null default now(),
  finalized_at timestamptz,
  finalized_by uuid references auth.users(id),
  finalized_by_name text,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancelled_by_name text,
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_material_inventory_active_unit
  on public.material_inventory_counts(unit)
  where status='IN_PROGRESS';
create index if not exists idx_material_inventory_history
  on public.material_inventory_counts(unit,status,count_date desc,started_at desc);

drop trigger if exists trg_material_inventory_counts_updated on public.material_inventory_counts;
create trigger trg_material_inventory_counts_updated before update on public.material_inventory_counts
for each row execute function public.touch_updated_at();

create or replace function public.assign_material_inventory_code()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.count_code is null or btrim(new.count_code)='' then
    new.count_code := 'MAT-INV-' || lpad(nextval('public.material_inventory_number_seq')::text,6,'0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_material_inventory_code on public.material_inventory_counts;
create trigger trg_assign_material_inventory_code
before insert on public.material_inventory_counts
for each row execute function public.assign_material_inventory_code();

create table if not exists public.material_inventory_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.material_inventory_counts(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  material_code text not null,
  material_name text not null,
  requires_identifier boolean not null default false,
  system_quantity integer not null default 0 check(system_quantity>=0),
  counted_quantity integer check(counted_quantity>=0),
  difference integer,
  justification text not null default '',
  updated_at timestamptz not null default now(),
  unique(count_id,material_id)
);

create index if not exists idx_material_inventory_items_count
  on public.material_inventory_items(count_id,material_name);

drop trigger if exists trg_material_inventory_items_updated on public.material_inventory_items;
create trigger trg_material_inventory_items_updated before update on public.material_inventory_items
for each row execute function public.touch_updated_at();

create table if not exists public.material_inventory_identifiers (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.material_inventory_counts(id) on delete cascade,
  count_item_id uuid not null references public.material_inventory_items(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  identifier_code text not null,
  works boolean not null,
  created_at timestamptz not null default now(),
  unique(count_id,identifier_code),
  unique(count_item_id,identifier_code)
);

create index if not exists idx_material_inventory_ids_item
  on public.material_inventory_identifiers(count_item_id,identifier_code);

-- ===========================================================================
-- RLS: SOMENTE LEITURA DIRETA. ESCRITAS PASSAM PELAS RPCs TRANSACIONAIS.
-- ===========================================================================
alter table public.materials enable row level security;
alter table public.material_stock enable row level security;
alter table public.material_identifiers enable row level security;
alter table public.material_movements enable row level security;
alter table public.material_movement_identifiers enable row level security;
alter table public.material_inventory_counts enable row level security;
alter table public.material_inventory_items enable row level security;
alter table public.material_inventory_identifiers enable row level security;

drop policy if exists materials_read on public.materials;
create policy materials_read on public.materials
for select to authenticated
using(public.material_any_permission());

drop policy if exists material_stock_read on public.material_stock;
create policy material_stock_read on public.material_stock
for select to authenticated
using(public.material_user_has_unit(unit) and public.material_any_permission());

drop policy if exists material_identifiers_read on public.material_identifiers;
create policy material_identifiers_read on public.material_identifiers
for select to authenticated
using(public.material_user_has_unit(unit) and public.material_any_permission());

drop policy if exists material_movements_read on public.material_movements;
create policy material_movements_read on public.material_movements
for select to authenticated
using(public.material_user_has_unit(unit) and public.has_permission('MATERIAL_MOVEMENT'));

drop policy if exists material_movement_identifiers_read on public.material_movement_identifiers;
create policy material_movement_identifiers_read on public.material_movement_identifiers
for select to authenticated
using(exists(
  select 1 from public.material_movements m
  where m.id=material_movement_identifiers.movement_id
    and public.material_user_has_unit(m.unit)
    and public.has_permission('MATERIAL_MOVEMENT')
));

drop policy if exists material_inventory_counts_read on public.material_inventory_counts;
create policy material_inventory_counts_read on public.material_inventory_counts
for select to authenticated
using(public.material_user_has_unit(unit) and public.has_permission('MATERIAL_INVENTORY'));

drop policy if exists material_inventory_items_read on public.material_inventory_items;
create policy material_inventory_items_read on public.material_inventory_items
for select to authenticated
using(exists(
  select 1 from public.material_inventory_counts c
  where c.id=material_inventory_items.count_id
    and public.material_user_has_unit(c.unit)
    and public.has_permission('MATERIAL_INVENTORY')
));

drop policy if exists material_inventory_identifiers_read on public.material_inventory_identifiers;
create policy material_inventory_identifiers_read on public.material_inventory_identifiers
for select to authenticated
using(exists(
  select 1 from public.material_inventory_counts c
  where c.id=material_inventory_identifiers.count_id
    and public.material_user_has_unit(c.unit)
    and public.has_permission('MATERIAL_INVENTORY')
));

grant select on public.materials,
                public.material_stock,
                public.material_identifiers,
                public.material_movements,
                public.material_movement_identifiers,
                public.material_inventory_counts,
                public.material_inventory_items,
                public.material_inventory_identifiers
to authenticated;

-- ===========================================================================
-- RPC: CADASTRO DE MATERIAL
-- ===========================================================================
create or replace function public.save_material(
  p_id uuid,
  p_name text,
  p_category text default '',
  p_stock_unit text default 'UNIDADE',
  p_requires_identifier boolean default false,
  p_minimum_stock integer default 0,
  p_active boolean default true,
  p_notes text default ''
)
returns public.materials
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_row public.materials%rowtype;
  v_name text:=btrim(coalesce(p_name,''));
  v_old_requires boolean;
begin
  if not public.has_permission('MATERIAL_CATALOG') then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;
  if v_name='' then raise exception 'MATERIAL_SEM_NOME'; end if;

  if p_id is null then
    insert into public.materials(
      code,name,category,stock_unit,requires_identifier,minimum_stock,notes,active,created_by,created_by_name
    ) values(
      null,v_name,btrim(coalesce(p_category,'')),upper(btrim(coalesce(p_stock_unit,'UNIDADE'))),coalesce(p_requires_identifier,false),greatest(0,coalesce(p_minimum_stock,0)),btrim(coalesce(p_notes,'')),coalesce(p_active,true),auth.uid(),v_profile.name
    ) returning * into v_row;
  else
    select requires_identifier into v_old_requires from public.materials where id=p_id for update;
    if not found then raise exception 'MATERIAL_NAO_ENCONTRADO'; end if;

    if v_old_requires is distinct from coalesce(p_requires_identifier,false)
       and (
         exists(select 1 from public.material_stock s where s.material_id=p_id and s.quantity>0)
         or exists(select 1 from public.material_identifiers i where i.material_id=p_id)
         or exists(select 1 from public.material_movements mv where mv.material_id=p_id)
       ) then
      raise exception 'MATERIAL_RASTREIO_NAO_PODE_SER_ALTERADO';
    end if;

    update public.materials
       set name=v_name,
           category=btrim(coalesce(p_category,'')),
           stock_unit=upper(btrim(coalesce(p_stock_unit,'UNIDADE'))),
           requires_identifier=coalesce(p_requires_identifier,false),
           minimum_stock=greatest(0,coalesce(p_minimum_stock,0)),
           notes=btrim(coalesce(p_notes,'')),
           active=coalesce(p_active,true)
     where id=p_id
     returning * into v_row;
  end if;

  return v_row;
exception
  when unique_violation then
    raise exception 'MATERIAL_NOME_DUPLICADO';
end;
$$;

grant execute on function public.save_material(uuid,text,text,text,boolean,integer,boolean,text) to authenticated;

-- ===========================================================================
-- RPC: MOVIMENTACAO MANUAL
-- ===========================================================================
create or replace function public.create_material_movement(
  p_unit text,
  p_material_id uuid,
  p_type text,
  p_quantity integer,
  p_justification text,
  p_identifiers jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_material public.materials%rowtype;
  v_unit text:=btrim(coalesce(p_unit,''));
  v_type text:=upper(btrim(coalesce(p_type,'')));
  v_just text:=btrim(coalesce(p_justification,''));
  v_before integer:=0;
  v_after integer:=0;
  v_qty integer:=greatest(0,coalesce(p_quantity,0));
  v_payload_count integer:=0;
  v_move_id uuid;
  v_item jsonb;
  v_code text;
  v_works boolean;
  v_identifier public.material_identifiers%rowtype;
begin
  if not public.has_permission('MATERIAL_MOVEMENT') then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;
  if v_unit='' or not public.material_user_has_unit(v_unit) then raise exception 'UNIDADE_INVALIDA'; end if;
  select * into v_material from public.materials where id=p_material_id and active=true;
  if v_material.id is null then raise exception 'MATERIAL_NAO_ENCONTRADO'; end if;
  if v_type not in ('ENTRY','EXIT') then raise exception 'MATERIAL_TIPO_MOVIMENTO_INVALIDO'; end if;
  if v_just='' then raise exception 'MATERIAL_JUSTIFICATIVA_OBRIGATORIA'; end if;

  insert into public.material_stock(unit,material_id,quantity,updated_by,updated_by_name)
  values(v_unit,v_material.id,0,auth.uid(),v_profile.name)
  on conflict(unit,material_id) do nothing;

  select quantity into v_before
  from public.material_stock
  where unit=v_unit and material_id=v_material.id
  for update;

  if v_material.requires_identifier then
    if jsonb_typeof(coalesce(p_identifiers,'[]'::jsonb))<>'array' then raise exception 'MATERIAL_IDENTIFICADOR_OBRIGATORIO'; end if;
    v_payload_count:=jsonb_array_length(coalesce(p_identifiers,'[]'::jsonb));
    if v_payload_count<=0 then raise exception 'MATERIAL_IDENTIFICADOR_OBRIGATORIO'; end if;
    if v_qty<>v_payload_count then raise exception 'MATERIAL_QUANTIDADE_IDENTIFICADORES_DIVERGENTE'; end if;

    if exists(
      select 1
      from (
        select upper(regexp_replace(btrim(coalesce(value->>'code','')),E'\\s+','','g')) as code,count(*) n
        from jsonb_array_elements(coalesce(p_identifiers,'[]'::jsonb))
        group by 1
      ) d
      where d.code='' or d.n>1
    ) then
      raise exception 'MATERIAL_IDENTIFICADOR_DUPLICADO';
    end if;

    if exists(
      select 1
      from jsonb_array_elements(coalesce(p_identifiers,'[]'::jsonb)) j
      join public.material_identifiers mi
        on mi.identifier_code=upper(regexp_replace(btrim(coalesce(j->>'code','')),E'\\s+','','g'))
      where mi.material_id<>v_material.id
    ) then
      raise exception 'MATERIAL_IDENTIFICADOR_OUTRO_MATERIAL';
    end if;

    if v_type='ENTRY' then
      if exists(
        select 1
        from jsonb_array_elements(coalesce(p_identifiers,'[]'::jsonb)) j
        join public.material_identifiers mi
          on mi.identifier_code=upper(regexp_replace(btrim(coalesce(j->>'code','')),E'\\s+','','g'))
        where mi.in_stock=true
      ) then
        raise exception 'MATERIAL_IDENTIFICADOR_JA_EM_ESTOQUE';
      end if;
      if exists(
        select 1 from jsonb_array_elements(coalesce(p_identifiers,'[]'::jsonb)) j
        where not (j ? 'works') or (j->>'works') is null
      ) then
        raise exception 'MATERIAL_IDENTIFICADOR_FUNCIONAMENTO_OBRIGATORIO';
      end if;
      v_after:=v_before+v_qty;
    else
      if exists(
        select 1
        from jsonb_array_elements(coalesce(p_identifiers,'[]'::jsonb)) j
        left join public.material_identifiers mi
          on mi.identifier_code=upper(regexp_replace(btrim(coalesce(j->>'code','')),E'\\s+','','g'))
         and mi.material_id=v_material.id
         and mi.unit=v_unit
         and mi.in_stock=true
        where mi.id is null
      ) then
        raise exception 'MATERIAL_IDENTIFICADOR_NAO_ENCONTRADO';
      end if;
      v_after:=v_before-v_qty;
      if v_after<0 then raise exception 'MATERIAL_ESTOQUE_INSUFICIENTE'; end if;
    end if;
  else
    if v_qty<=0 then raise exception 'MATERIAL_QUANTIDADE_INVALIDA'; end if;
    v_after:=case when v_type='ENTRY' then v_before+v_qty else v_before-v_qty end;
    if v_after<0 then raise exception 'MATERIAL_ESTOQUE_INSUFICIENTE'; end if;
  end if;

  insert into public.material_movements(
    unit,material_id,material_code,material_name,movement_type,quantity_delta,balance_before,balance_after,origin_type,justification,created_by,created_by_name
  ) values(
    v_unit,v_material.id,v_material.code,v_material.name,v_type,
    case when v_type='ENTRY' then v_qty else -v_qty end,
    v_before,v_after,'MANUAL',v_just,auth.uid(),v_profile.name
  ) returning id into v_move_id;

  if v_material.requires_identifier then
    for v_item in select value from jsonb_array_elements(coalesce(p_identifiers,'[]'::jsonb))
    loop
      v_code:=upper(regexp_replace(btrim(coalesce(v_item->>'code','')),E'\\s+','','g'));
      if v_type='ENTRY' then
        v_works:=(v_item->>'works')::boolean;
        select * into v_identifier from public.material_identifiers where identifier_code=v_code for update;
        if v_identifier.id is null then
          insert into public.material_identifiers(
            identifier_code,material_id,unit,in_stock,works,last_source_type,last_source_id,updated_by,updated_by_name
          ) values(
            v_code,v_material.id,v_unit,true,v_works,'MANUAL',v_move_id,auth.uid(),v_profile.name
          ) returning * into v_identifier;
        else
          update public.material_identifiers
             set unit=v_unit,in_stock=true,works=v_works,last_source_type='MANUAL',last_source_id=v_move_id,updated_by=auth.uid(),updated_by_name=v_profile.name
           where id=v_identifier.id
           returning * into v_identifier;
        end if;
        insert into public.material_movement_identifiers(movement_id,identifier_id,identifier_code,works,action)
        values(v_move_id,v_identifier.id,v_identifier.identifier_code,v_identifier.works,'ENTRY');
      else
        select * into v_identifier
        from public.material_identifiers
        where identifier_code=v_code and material_id=v_material.id and unit=v_unit and in_stock=true
        for update;
        if v_identifier.id is null then raise exception 'MATERIAL_IDENTIFICADOR_NAO_ENCONTRADO'; end if;
        insert into public.material_movement_identifiers(movement_id,identifier_id,identifier_code,works,action)
        values(v_move_id,v_identifier.id,v_identifier.identifier_code,v_identifier.works,'EXIT');
        update public.material_identifiers
           set in_stock=false,last_source_type='MANUAL',last_source_id=v_move_id,updated_by=auth.uid(),updated_by_name=v_profile.name
         where id=v_identifier.id;
      end if;
    end loop;
  end if;

  update public.material_stock
     set quantity=v_after,updated_by=auth.uid(),updated_by_name=v_profile.name,updated_at=now()
   where unit=v_unit and material_id=v_material.id;

  return jsonb_build_object('movement_id',v_move_id,'balance_before',v_before,'balance_after',v_after);
end;
$$;

grant execute on function public.create_material_movement(text,uuid,text,integer,text,jsonb) to authenticated;

-- ===========================================================================
-- RPC: INICIAR INVENTARIO
-- ===========================================================================
create or replace function public.start_material_inventory(p_unit text)
returns public.material_inventory_counts
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_count public.material_inventory_counts%rowtype;
  v_unit text:=btrim(coalesce(p_unit,''));
begin
  if not public.has_permission('MATERIAL_INVENTORY') then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;
  if v_unit='' or not public.material_user_has_unit(v_unit) then raise exception 'UNIDADE_INVALIDA'; end if;
  if not exists(select 1 from public.materials where active=true) then raise exception 'MATERIAL_INVENTARIO_SEM_MATERIAIS'; end if;

  select * into v_count
  from public.material_inventory_counts
  where unit=v_unit and status='IN_PROGRESS'
  order by started_at desc limit 1;
  if v_count.id is not null then return v_count; end if;

  insert into public.material_inventory_counts(unit,counter_id,counter_name)
  values(v_unit,auth.uid(),v_profile.name)
  returning * into v_count;

  insert into public.material_inventory_items(
    count_id,material_id,material_code,material_name,requires_identifier,system_quantity,counted_quantity,difference,justification
  )
  select
    v_count.id,m.id,m.code,m.name,m.requires_identifier,coalesce(s.quantity,0),null,null,''
  from public.materials m
  left join public.material_stock s on s.material_id=m.id and s.unit=v_unit
  where m.active=true
  order by m.name;

  return v_count;
end;
$$;

grant execute on function public.start_material_inventory(text) to authenticated;

-- ===========================================================================
-- RPC: SALVAR UM ITEM DO INVENTARIO
-- ===========================================================================
create or replace function public.save_material_inventory_item(
  p_count_id uuid,
  p_material_id uuid,
  p_counted_quantity integer,
  p_justification text default '',
  p_identifiers jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_count public.material_inventory_counts%rowtype;
  v_item public.material_inventory_items%rowtype;
  v_qty integer:=coalesce(p_counted_quantity,-1);
  v_payload_count integer:=0;
  v_json jsonb;
  v_code text;
  v_works boolean;
begin
  if not public.has_permission('MATERIAL_INVENTORY') then raise exception 'FORBIDDEN'; end if;
  select * into v_count from public.material_inventory_counts where id=p_count_id for update;
  if v_count.id is null then raise exception 'MATERIAL_INVENTARIO_NAO_ENCONTRADO'; end if;
  if not public.material_user_has_unit(v_count.unit) then raise exception 'FORBIDDEN'; end if;
  if v_count.status<>'IN_PROGRESS' then raise exception 'MATERIAL_INVENTARIO_FINALIZADO'; end if;

  select * into v_item
  from public.material_inventory_items
  where count_id=v_count.id and material_id=p_material_id
  for update;
  if v_item.id is null then raise exception 'MATERIAL_NAO_ENCONTRADO'; end if;

  if v_item.requires_identifier then
    if jsonb_typeof(coalesce(p_identifiers,'[]'::jsonb))<>'array' then raise exception 'MATERIAL_IDENTIFICADOR_OBRIGATORIO'; end if;
    v_payload_count:=jsonb_array_length(coalesce(p_identifiers,'[]'::jsonb));
    if v_qty<>v_payload_count then raise exception 'MATERIAL_QUANTIDADE_IDENTIFICADORES_DIVERGENTE'; end if;

    if exists(
      select 1
      from (
        select upper(regexp_replace(btrim(coalesce(value->>'code','')),E'\\s+','','g')) code,count(*) n
        from jsonb_array_elements(coalesce(p_identifiers,'[]'::jsonb))
        group by 1
      ) d
      where d.code='' or d.n>1
    ) then raise exception 'MATERIAL_IDENTIFICADOR_DUPLICADO'; end if;

    if exists(
      select 1 from jsonb_array_elements(coalesce(p_identifiers,'[]'::jsonb)) j
      where not (j ? 'works') or (j->>'works') is null
    ) then raise exception 'MATERIAL_IDENTIFICADOR_FUNCIONAMENTO_OBRIGATORIO'; end if;

    if exists(
      select 1
      from jsonb_array_elements(coalesce(p_identifiers,'[]'::jsonb)) j
      join public.material_identifiers mi
        on mi.identifier_code=upper(regexp_replace(btrim(coalesce(j->>'code','')),E'\\s+','','g'))
      where mi.material_id<>v_item.material_id
    ) then raise exception 'MATERIAL_IDENTIFICADOR_OUTRO_MATERIAL'; end if;

    delete from public.material_inventory_identifiers where count_item_id=v_item.id;

    for v_json in select value from jsonb_array_elements(coalesce(p_identifiers,'[]'::jsonb))
    loop
      v_code:=upper(regexp_replace(btrim(coalesce(v_json->>'code','')),E'\\s+','','g'));
      v_works:=(v_json->>'works')::boolean;
      insert into public.material_inventory_identifiers(count_id,count_item_id,material_id,identifier_code,works)
      values(v_count.id,v_item.id,v_item.material_id,v_code,v_works);
    end loop;
  else
    if v_qty<0 then raise exception 'MATERIAL_QUANTIDADE_INVALIDA'; end if;
    delete from public.material_inventory_identifiers where count_item_id=v_item.id;
  end if;

  update public.material_inventory_items
     set counted_quantity=v_qty,
         difference=v_qty-system_quantity,
         justification=btrim(coalesce(p_justification,'')),
         updated_at=now()
   where id=v_item.id
   returning * into v_item;

  return to_jsonb(v_item);
end;
$$;

grant execute on function public.save_material_inventory_item(uuid,uuid,integer,text,jsonb) to authenticated;

-- ===========================================================================
-- RPC: FINALIZAR INVENTARIO
-- ===========================================================================
create or replace function public.finalize_material_inventory(p_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_count public.material_inventory_counts%rowtype;
  v_item public.material_inventory_items%rowtype;
  v_material public.materials%rowtype;
  v_before integer;
  v_after integer;
  v_move_id uuid;
  v_inv_id public.material_inventory_identifiers%rowtype;
  v_existing public.material_identifiers%rowtype;
  v_missing public.material_identifiers%rowtype;
  v_identifier_count integer;
begin
  if not public.has_permission('MATERIAL_INVENTORY') then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;

  select * into v_count from public.material_inventory_counts where id=p_count_id for update;
  if v_count.id is null then raise exception 'MATERIAL_INVENTARIO_NAO_ENCONTRADO'; end if;
  if not public.material_user_has_unit(v_count.unit) then raise exception 'FORBIDDEN'; end if;
  if v_count.status<>'IN_PROGRESS' then raise exception 'MATERIAL_INVENTARIO_FINALIZADO'; end if;

  for v_item in
    select * from public.material_inventory_items
    where count_id=v_count.id
    order by material_name
    for update
  loop
    if v_item.counted_quantity is null then
      raise exception 'MATERIAL_INVENTARIO_ITEM_PENDENTE:%',v_item.material_name;
    end if;
    if coalesce(v_item.difference,v_item.counted_quantity-v_item.system_quantity)<>0
       and btrim(coalesce(v_item.justification,''))='' then
      raise exception 'MATERIAL_INVENTARIO_JUSTIFICATIVA_OBRIGATORIA:%',v_item.material_name;
    end if;

    select * into v_material from public.materials where id=v_item.material_id;
    if v_material.id is null then raise exception 'MATERIAL_NAO_ENCONTRADO'; end if;

    insert into public.material_stock(unit,material_id,quantity,updated_by,updated_by_name)
    values(v_count.unit,v_material.id,0,auth.uid(),v_profile.name)
    on conflict(unit,material_id) do nothing;

    select quantity into v_before
    from public.material_stock
    where unit=v_count.unit and material_id=v_material.id
    for update;

    if v_before<>v_item.system_quantity then
      raise exception 'MATERIAL_ESTOQUE_ALTERADO_DURANTE_CONTAGEM:%',v_item.material_name;
    end if;

    v_after:=v_item.counted_quantity;

    if v_item.requires_identifier then
      select count(*) into v_identifier_count
      from public.material_inventory_identifiers
      where count_item_id=v_item.id;
      if v_identifier_count<>v_after then raise exception 'MATERIAL_QUANTIDADE_IDENTIFICADORES_DIVERGENTE'; end if;

      if exists(
        select 1
        from public.material_inventory_identifiers ii
        join public.material_identifiers mi on mi.identifier_code=ii.identifier_code
        where ii.count_item_id=v_item.id and mi.material_id<>v_item.material_id
      ) then raise exception 'MATERIAL_IDENTIFICADOR_OUTRO_MATERIAL'; end if;

      if exists(
        select 1
        from public.material_inventory_identifiers ii
        join public.material_identifiers mi on mi.identifier_code=ii.identifier_code
        where ii.count_item_id=v_item.id
          and mi.material_id=v_item.material_id
          and mi.in_stock=true
          and mi.unit<>v_count.unit
      ) then
        raise exception 'MATERIAL_IDENTIFICADOR_OUTRA_UNIDADE';
      end if;

      insert into public.material_movements(
        unit,material_id,material_code,material_name,movement_type,quantity_delta,balance_before,balance_after,origin_type,origin_id,justification,created_by,created_by_name
      ) values(
        v_count.unit,v_material.id,v_material.code,v_material.name,'INVENTORY_ADJUSTMENT',v_after-v_before,v_before,v_after,'INVENTORY',v_count.id,
        case when btrim(coalesce(v_item.justification,''))<>'' then v_item.justification else 'ConferÃªncia de identificadores no inventÃ¡rio '||v_count.count_code end,
        auth.uid(),v_profile.name
      ) returning id into v_move_id;

      -- Identificadores que estavam no sistema e nao apareceram fisicamente.
      for v_missing in
        select mi.*
        from public.material_identifiers mi
        where mi.unit=v_count.unit
          and mi.material_id=v_material.id
          and mi.in_stock=true
          and not exists(
            select 1 from public.material_inventory_identifiers ii
            where ii.count_item_id=v_item.id and ii.identifier_code=mi.identifier_code
          )
        for update
      loop
        insert into public.material_movement_identifiers(movement_id,identifier_id,identifier_code,works,action)
        values(v_move_id,v_missing.id,v_missing.identifier_code,v_missing.works,'MISSING');
        update public.material_identifiers
           set in_stock=false,last_source_type='INVENTORY',last_source_id=v_count.id,updated_by=auth.uid(),updated_by_name=v_profile.name
         where id=v_missing.id;
      end loop;

      -- Identificadores encontrados fisicamente: cria/reativa e atualiza funcionamento.
      for v_inv_id in
        select * from public.material_inventory_identifiers
        where count_item_id=v_item.id
        order by identifier_code
      loop
        select * into v_existing
        from public.material_identifiers
        where identifier_code=v_inv_id.identifier_code
        for update;

        if v_existing.id is null then
          insert into public.material_identifiers(
            identifier_code,material_id,unit,in_stock,works,last_source_type,last_source_id,updated_by,updated_by_name
          ) values(
            v_inv_id.identifier_code,v_material.id,v_count.unit,true,v_inv_id.works,'INVENTORY',v_count.id,auth.uid(),v_profile.name
          ) returning * into v_existing;
        else
          update public.material_identifiers
             set unit=v_count.unit,in_stock=true,works=v_inv_id.works,last_source_type='INVENTORY',last_source_id=v_count.id,updated_by=auth.uid(),updated_by_name=v_profile.name
           where id=v_existing.id
           returning * into v_existing;
        end if;

        insert into public.material_movement_identifiers(movement_id,identifier_id,identifier_code,works,action)
        values(v_move_id,v_existing.id,v_existing.identifier_code,v_existing.works,'COUNTED');
      end loop;
    elsif v_after<>v_before then
      insert into public.material_movements(
        unit,material_id,material_code,material_name,movement_type,quantity_delta,balance_before,balance_after,origin_type,origin_id,justification,created_by,created_by_name
      ) values(
        v_count.unit,v_material.id,v_material.code,v_material.name,'INVENTORY_ADJUSTMENT',v_after-v_before,v_before,v_after,'INVENTORY',v_count.id,v_item.justification,auth.uid(),v_profile.name
      );
    end if;

    update public.material_stock
       set quantity=v_after,updated_by=auth.uid(),updated_by_name=v_profile.name,updated_at=now()
     where unit=v_count.unit and material_id=v_material.id;

    update public.material_inventory_items
       set difference=v_after-system_quantity,updated_at=now()
     where id=v_item.id;
  end loop;

  update public.material_inventory_counts
     set status='FINALIZED',finalized_at=now(),finalized_by=auth.uid(),finalized_by_name=v_profile.name,updated_at=now()
   where id=v_count.id;

  return jsonb_build_object('count_id',v_count.id,'count_code',v_count.count_code,'status','FINALIZED');
end;
$$;

grant execute on function public.finalize_material_inventory(uuid) to authenticated;

-- ===========================================================================
-- RPC: CANCELAR INVENTARIO
-- ===========================================================================
create or replace function public.cancel_material_inventory(p_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_count public.material_inventory_counts%rowtype;
begin
  if not public.has_permission('MATERIAL_INVENTORY') then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_count from public.material_inventory_counts where id=p_count_id for update;
  if v_count.id is null then raise exception 'MATERIAL_INVENTARIO_NAO_ENCONTRADO'; end if;
  if not public.material_user_has_unit(v_count.unit) then raise exception 'FORBIDDEN'; end if;
  if v_count.status<>'IN_PROGRESS' then raise exception 'MATERIAL_INVENTARIO_FINALIZADO'; end if;

  update public.material_inventory_counts
     set status='CANCELLED',cancelled_at=now(),cancelled_by=auth.uid(),cancelled_by_name=v_profile.name,updated_at=now()
   where id=v_count.id;

  return jsonb_build_object('count_id',v_count.id,'count_code',v_count.count_code,'status','CANCELLED');
end;
$$;

grant execute on function public.cancel_material_inventory(uuid) to authenticated;

commit;

-- ===========================================================================
-- CONFERENCIA FINAL (somente leitura)
-- ===========================================================================
select code,module,name,active
from public.permissions
where code in ('MATERIAL_INVENTORY','MATERIAL_STOCK_VIEW','MATERIAL_CATALOG','MATERIAL_MOVEMENT')
order by sort_order;

select table_name
from information_schema.tables
where table_schema='public'
  and table_name in (
    'materials','material_stock','material_identifiers','material_movements',
    'material_movement_identifiers','material_inventory_counts',
    'material_inventory_items','material_inventory_identifiers'
  )
order by table_name;
