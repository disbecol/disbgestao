-- Viagens preparadas por quem possui PULL_PLAN; preserva os RPCs existentes.
begin;

insert into public.permissions(code,module,name,description,sort_order)
values('PULL_PLAN','Puxada','Cadastrar viagens','Preparar e atribuir viagens antes do início pelo Motorista 1.',5)
on conflict(code) do update set module=excluded.module,name=excluded.name,
  description=excluded.description,sort_order=excluded.sort_order,active=true;

-- Permite escolher apenas motoristas ativos sem abrir os demais perfis.
drop policy if exists pull_plan_driver_roster on public.profiles;
create policy pull_plan_driver_roster on public.profiles for select to authenticated
using(public.has_permission('PULL_PLAN') and role='MOTORISTA_PUXADOR' and active=true);

create table if not exists public.pull_trip_plans (
  id uuid primary key default gen_random_uuid(),
  cycle_type text not null check(cycle_type in ('PULL','TRANSFER')),
  origin_unit text not null references public.units(name),
  plate text not null,
  carrier text not null,
  factory text not null,
  driver1_id uuid not null references public.profiles(id),
  driver1_name text not null,
  driver2_id uuid references public.profiles(id),
  driver2_name text,
  solo_trip boolean not null default false,
  scheduled_at timestamptz,
  status text not null default 'PLANNED' check(status in ('PLANNED','STARTED','CANCELLED')),
  trip_id uuid unique references public.pull_trips(id),
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pull_plan_driver_valid check ((solo_trip and driver2_id is null) or
    (not solo_trip and driver2_id is not null and driver2_id<>driver1_id)),
  constraint pull_plan_appointment_valid check(cycle_type='TRANSFER' or scheduled_at is not null)
);
create index if not exists pull_trip_plans_driver1 on public.pull_trip_plans(driver1_id,status,scheduled_at);
create index if not exists pull_trip_plans_driver2 on public.pull_trip_plans(driver2_id,status,scheduled_at);
create index if not exists pull_trip_plans_unit on public.pull_trip_plans(origin_unit,status,scheduled_at);
alter table public.pull_trip_plans enable row level security;
drop policy if exists pull_trip_plans_read on public.pull_trip_plans;
create policy pull_trip_plans_read on public.pull_trip_plans for select to authenticated
using(public.user_has_unit(origin_unit) and
  (public.has_permission('PULL_PLAN') or driver1_id=auth.uid() or driver2_id=auth.uid()));
grant select on public.pull_trip_plans to authenticated;

alter table public.pull_trips add column if not exists appointment_at timestamptz;

create or replace function public.save_pull_trip_plan(
  p_plan_id uuid,p_cycle_type text,p_origin_unit text,p_plate text,p_factory text,
  p_driver1 uuid,p_driver2 uuid,p_solo_trip boolean,p_scheduled_at timestamptz
) returns public.pull_trip_plans language plpgsql security definer set search_path=public as $$
declare
  v_plan public.pull_trip_plans%rowtype;
  v_driver1 public.profiles%rowtype;
  v_driver2 public.profiles%rowtype;
  v_vehicle public.pull_vehicles%rowtype;
  v_type text:=upper(btrim(coalesce(p_cycle_type,'')));
  v_origin text:=btrim(coalesce(p_origin_unit,''));
  v_factory text:=btrim(coalesce(p_factory,''));
  v_plate text:=upper(regexp_replace(coalesce(p_plate,''),'[^A-Za-z0-9]','','g'));
  v_solo boolean:=coalesce(p_solo_trip,false);
begin
  if not public.has_permission('PULL_PLAN') then raise exception 'FORBIDDEN'; end if;
  if v_type not in ('PULL','TRANSFER') then raise exception 'TIPO_CICLO_INVALIDO'; end if;
  if v_type='TRANSFER' then
    v_origin:='Matriz Caicó'; v_factory:='Filial Pau dos Ferros'; v_solo:=true; p_driver2:=null;
  end if;
  if not public.user_has_unit(v_origin) then raise exception 'UNIDADE_SEM_ACESSO'; end if;
  if not exists(select 1 from public.units where name=v_origin and active) then raise exception 'ORIGEM_INVALIDA'; end if;
  if v_type='PULL' and not exists(select 1 from public.factories where name=v_factory and active) then raise exception 'FABRICA_INVALIDA'; end if;
  if v_type='PULL' and p_scheduled_at is null then raise exception 'AGENDAMENTO_OBRIGATORIO'; end if;
  select * into v_vehicle from public.pull_vehicles where plate=v_plate and active=true;
  if v_vehicle.id is null then raise exception 'PLACA_INVALIDA'; end if;
  select * into v_driver1 from public.profiles where id=p_driver1 and role='MOTORISTA_PUXADOR' and active=true;
  if v_driver1.id is null then raise exception 'MOTORISTA_1_INVALIDO'; end if;
  if not exists(select 1 from public.user_units where user_id=v_driver1.id and unit_name=v_origin) then
    raise exception 'MOTORISTA_1_SEM_ACESSO_UNIDADE'; end if;
  if not v_solo then
    select * into v_driver2 from public.profiles where id=p_driver2 and role='MOTORISTA_PUXADOR' and active=true;
    if v_driver2.id is null or v_driver2.id=v_driver1.id then raise exception 'MOTORISTA_2_INVALIDO'; end if;
    if not exists(select 1 from public.user_units where user_id=v_driver2.id and unit_name=v_origin) then
      raise exception 'MOTORISTA_2_SEM_ACESSO_UNIDADE'; end if;
  end if;
  if p_plan_id is not null then
    select * into v_plan from public.pull_trip_plans where id=p_plan_id for update;
    if v_plan.id is null or v_plan.status<>'PLANNED' or not public.user_has_unit(v_plan.origin_unit) then
      raise exception 'VIAGEM_NAO_EDITAVEL'; end if;
    update public.pull_trip_plans set cycle_type=v_type,origin_unit=v_origin,plate=v_plate,
      carrier=coalesce(nullif(btrim(v_vehicle.carrier),''),'Ambev'),factory=v_factory,
      driver1_id=v_driver1.id,driver1_name=v_driver1.name,
      driver2_id=case when v_solo then null else v_driver2.id end,
      driver2_name=case when v_solo then null else v_driver2.name end,
      solo_trip=v_solo,scheduled_at=p_scheduled_at,updated_by=auth.uid(),updated_at=now()
    where id=p_plan_id returning * into v_plan;
  else
    insert into public.pull_trip_plans(cycle_type,origin_unit,plate,carrier,factory,
      driver1_id,driver1_name,driver2_id,driver2_name,solo_trip,scheduled_at,created_by)
    values(v_type,v_origin,v_plate,coalesce(nullif(btrim(v_vehicle.carrier),''),'Ambev'),v_factory,
      v_driver1.id,v_driver1.name,case when v_solo then null else v_driver2.id end,
      case when v_solo then null else v_driver2.name end,v_solo,p_scheduled_at,auth.uid())
    returning * into v_plan;
  end if;
  return v_plan;
end;$$;
revoke all on function public.save_pull_trip_plan(uuid,text,text,text,text,uuid,uuid,boolean,timestamptz) from public,anon;
grant execute on function public.save_pull_trip_plan(uuid,text,text,text,text,uuid,uuid,boolean,timestamptz) to authenticated;

create or replace function public.cancel_pull_trip_plan(p_plan_id uuid)
returns public.pull_trip_plans language plpgsql security definer set search_path=public as $$
declare v_plan public.pull_trip_plans%rowtype;
begin
  if not public.has_permission('PULL_PLAN') then raise exception 'FORBIDDEN'; end if;
  update public.pull_trip_plans set status='CANCELLED',updated_by=auth.uid(),updated_at=now()
   where id=p_plan_id and status='PLANNED' and public.user_has_unit(origin_unit)
   returning * into v_plan;
  if v_plan.id is null then raise exception 'VIAGEM_NAO_CANCELAVEL'; end if;
  return v_plan;
end;$$;
revoke all on function public.cancel_pull_trip_plan(uuid) from public,anon;
grant execute on function public.cancel_pull_trip_plan(uuid) to authenticated;

create or replace function public.start_planned_pull_trip(
  p_plan_id uuid,p_latitude double precision,p_longitude double precision,
  p_accuracy double precision,p_device_at timestamptz
) returns public.pull_trips language plpgsql security definer set search_path=public as $$
declare v_plan public.pull_trip_plans%rowtype; v_trip public.pull_trips%rowtype;
begin
  if not public.has_permission('PULL_TRIP') then raise exception 'FORBIDDEN'; end if;
  select * into v_plan from public.pull_trip_plans where id=p_plan_id for update;
  if v_plan.id is null or v_plan.status<>'PLANNED' then raise exception 'VIAGEM_INDISPONIVEL'; end if;
  if v_plan.driver1_id<>auth.uid() then raise exception 'APENAS_MOTORISTA_1_INICIA'; end if;
  if not public.user_has_unit(v_plan.origin_unit) then raise exception 'UNIDADE_SEM_ACESSO'; end if;
  if v_plan.cycle_type='TRANSFER' then
    v_trip:=public.start_transfer_trip(v_plan.plate,p_latitude,p_longitude,p_accuracy,p_device_at);
  else
    v_trip:=public.start_pull_trip(v_plan.origin_unit,v_plan.plate,v_plan.factory,v_plan.carrier,
      v_plan.driver2_id,p_latitude,p_longitude,p_accuracy,p_device_at);
  end if;
  update public.pull_trips set appointment_at=v_plan.scheduled_at where id=v_trip.id returning * into v_trip;
  update public.pull_trip_plans set status='STARTED',trip_id=v_trip.id,updated_by=auth.uid(),updated_at=now()
    where id=v_plan.id;
  return v_trip;
end;$$;
revoke all on function public.start_planned_pull_trip(uuid,double precision,double precision,double precision,timestamptz) from public,anon;
grant execute on function public.start_planned_pull_trip(uuid,double precision,double precision,double precision,timestamptz) to authenticated;

create table if not exists public.pull_trip_attachments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.pull_trips(id) on delete cascade,
  photo_path text not null unique,
  observation text not null default '' check(char_length(observation)<=500),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists pull_trip_attachments_trip on public.pull_trip_attachments(trip_id,created_at);
alter table public.pull_trip_attachments enable row level security;
drop policy if exists pull_trip_attachments_read on public.pull_trip_attachments;
create policy pull_trip_attachments_read on public.pull_trip_attachments for select to authenticated
using(exists(select 1 from public.pull_trips t where t.id=trip_id and public.user_has_unit(t.origin_unit)
  and (t.driver1_id=auth.uid() or t.driver2_id=auth.uid() or public.has_permission('PULL_HISTORY'))));
grant select on public.pull_trip_attachments to authenticated;

create or replace function public.register_pull_trip_attachment(p_trip_id uuid,p_photo_path text,p_observation text)
returns public.pull_trip_attachments language plpgsql security definer set search_path=public as $$
declare v_trip public.pull_trips%rowtype; v_row public.pull_trip_attachments%rowtype;
begin
  select * into v_trip from public.pull_trips where id=p_trip_id for update;
  if v_trip.id is null or v_trip.status='CANCELLED' or not public.user_has_unit(v_trip.origin_unit)
    or auth.uid() not in (v_trip.driver1_id,v_trip.driver2_id) then raise exception 'FORBIDDEN'; end if;
  if p_photo_path is null or p_photo_path not like (p_trip_id::text||'/'||auth.uid()::text||'/%')
     or p_photo_path !~ '[.]jpg$' then raise exception 'CAMINHO_FOTO_INVALIDO'; end if;
  if not exists(select 1 from storage.objects where bucket_id='puxada-anexos' and name=p_photo_path) then
    raise exception 'FOTO_NAO_ENCONTRADA'; end if;
  if char_length(coalesce(p_observation,''))>500 then raise exception 'OBSERVACAO_EXCEDIDA'; end if;
  select * into v_row from public.pull_trip_attachments where photo_path=p_photo_path;
  if v_row.id is not null then return v_row; end if;
  if (select count(*) from public.pull_trip_attachments where trip_id=p_trip_id)>=10 then
    raise exception 'LIMITE_FOTOS_PUXADA'; end if;
  insert into public.pull_trip_attachments(trip_id,photo_path,observation,uploaded_by)
  values(p_trip_id,p_photo_path,btrim(coalesce(p_observation,'')),auth.uid()) returning * into v_row;
  return v_row;
end;$$;
revoke all on function public.register_pull_trip_attachment(uuid,text,text) from public,anon;
grant execute on function public.register_pull_trip_attachment(uuid,text,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('puxada-anexos','puxada-anexos',false,10485760,array['image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/jpeg'];
drop policy if exists pull_attachment_upload on storage.objects;
create policy pull_attachment_upload on storage.objects for insert to authenticated with check (
  bucket_id='puxada-anexos' and (storage.foldername(name))[2]=auth.uid()::text
  and exists(select 1 from public.pull_trips t where t.id::text=(storage.foldername(name))[1]
    and t.status<>'CANCELLED' and public.user_has_unit(t.origin_unit)
    and auth.uid() in (t.driver1_id,t.driver2_id)
    and (select count(*) from public.pull_trip_attachments a where a.trip_id=t.id)<10)
);
drop policy if exists pull_attachment_read on storage.objects;
create policy pull_attachment_read on storage.objects for select to authenticated using (
  bucket_id='puxada-anexos' and exists(select 1 from public.pull_trips t
    where t.id::text=(storage.foldername(name))[1] and public.user_has_unit(t.origin_unit)
    and (auth.uid() in (t.driver1_id,t.driver2_id) or public.has_permission('PULL_HISTORY')))
);
drop policy if exists pull_attachment_orphan_delete on storage.objects;
create policy pull_attachment_orphan_delete on storage.objects for delete to authenticated using (
  bucket_id='puxada-anexos' and (storage.foldername(name))[2]=auth.uid()::text
  and not exists(select 1 from public.pull_trip_attachments a where a.photo_path=name)
);
commit;
