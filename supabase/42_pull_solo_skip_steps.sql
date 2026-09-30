-- Etapas configuráveis dispensadas em Puxada com um único motorista.
-- Execute após 38_pull_solo_trip.sql.
begin;

alter table public.pull_trips
  add column if not exists solo_trip boolean not null default false;

-- Aplica o padrão às etapas do ponto de apoio apenas na primeira execução.
-- Em execuções posteriores, preserva o que o administrador definiu na tela.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='pull_steps' and column_name='skip_when_solo'
  ) then
    alter table public.pull_steps
      add column skip_when_solo boolean not null default false;
    update public.pull_steps
       set skip_when_solo=true
     where step_type='MAIN' and flow_type='PULL'
       and action_code in (
         'ARRIVE_SUPPORT_OUT','DRIVER_SWAP_OUT',
         'ARRIVE_SUPPORT_RETURN','DRIVER_SWAP_RETURN'
       );
  end if;
end;
$$;

-- Início, chegada e saída da fábrica e chegada à unidade são necessários
-- para concluir a viagem e calcular os indicadores.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid='public.pull_steps'::regclass
       and conname='pull_steps_solo_skip_valid'
  ) then
    alter table public.pull_steps
      add constraint pull_steps_solo_skip_valid check (
        not skip_when_solo or (
          step_type='MAIN' and flow_type='PULL'
          and action_code not in ('START_TRIP','ARRIVE_FACTORY','LEAVE_FACTORY','ARRIVE_UNIT')
        )
      );
  end if;
end;
$$;

-- A próxima etapa já é calculada ignorando as dispensadas para viagens solo.
create or replace function public.start_pull_trip(
  p_origin_unit text,
  p_plate text,
  p_factory text,
  p_carrier text,
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
  v_next_step public.pull_steps%rowtype;
  v_origin text;
  v_plate text;
  v_carrier text;
  v_solo boolean;
  v_max_accuracy integer := 200;
  v_now timestamptz := now();
begin
  if not public.has_permission('PULL_TRIP') then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;

  v_solo := p_driver2 is null or p_driver2=v_profile.id;
  if v_solo then
    v_driver2 := v_profile;
  else
    select * into v_driver2 from public.profiles
      where id=p_driver2 and role='MOTORISTA_PUXADOR' and active=true;
    if v_driver2.id is null then raise exception 'MOTORISTA_2_INVALIDO'; end if;
  end if;

  if exists(
    select 1 from public.pull_trips t
    where t.status='IN_PROGRESS'
      and (t.driver1_id in (v_profile.id,v_driver2.id)
        or t.driver2_id in (v_profile.id,v_driver2.id))
  ) then raise exception 'MOTORISTA_COM_CICLO_EM_ANDAMENTO'; end if;

  if not exists(select 1 from public.factories where name=p_factory and active=true) then
    raise exception 'FABRICA_INVALIDA';
  end if;
  v_origin := btrim(coalesce(p_origin_unit,''));
  if v_origin='' or not exists(select 1 from public.units where name=v_origin and active=true) then
    raise exception 'ORIGEM_INVALIDA';
  end if;
  v_carrier := btrim(coalesce(p_carrier,''));
  if v_carrier='' then raise exception 'PARCEIRO_OBRIGATORIO'; end if;

  select coalesce(gps_max_accuracy_m,200) into v_max_accuracy
    from public.pull_settings where singleton=true;
  v_max_accuracy := least(500,greatest(5,coalesce(v_max_accuracy,200)));
  if p_accuracy is null or p_accuracy>v_max_accuracy then
    raise exception 'GPS_PRECISAO_INSUFICIENTE:%:%',coalesce(round(p_accuracy)::text,'SEM_SINAL'),v_max_accuracy;
  end if;

  v_plate := upper(regexp_replace(coalesce(p_plate,''),'[^A-Za-z0-9]','','g'));
  if v_plate='' then raise exception 'PLACA_OBRIGATORIA'; end if;
  if exists(select 1 from public.pull_trips where plate=v_plate and status='IN_PROGRESS') then
    raise exception 'PLACA_COM_CICLO_EM_ANDAMENTO';
  end if;

  update public.pull_trips
     set next_started_at=v_now, kpi_status='CLOSED'
   where id=(select id from public.pull_trips
     where plate=v_plate and cycle_type='PULL' and status='ARRIVED'
       and next_started_at is null order by ended_at desc limit 1);

  insert into public.pull_trips(
    cycle_type,origin_unit,plate,carrier,factory,
    driver1_id,driver1_name,driver2_id,driver2_name,solo_trip,
    active_driver_id,active_driver_name,started_at,
    start_latitude,start_longitude,start_accuracy
  ) values(
    'PULL',v_origin,v_plate,v_carrier,p_factory,
    v_profile.id,v_profile.name,v_driver2.id,v_driver2.name,v_solo,
    v_profile.id,v_profile.name,v_now,
    p_latitude,p_longitude,p_accuracy
  ) returning * into v_trip;

  select * into v_start_step from public.pull_steps
    where action_code='START_TRIP' and step_type='MAIN'
      and flow_type='PULL' and active=true limit 1;
  if v_start_step.id is null then raise exception 'ETAPA_INICIO_NAO_CONFIGURADA'; end if;

  insert into public.pull_events(
    trip_id,step_id,step_name,action_code,step_order,
    user_id,user_name,recorded_at,device_at,latitude,longitude,gps_accuracy
  ) values(
    v_trip.id,v_start_step.id,v_start_step.name,v_start_step.action_code,
    v_start_step.sort_order,v_profile.id,v_profile.name,v_now,p_device_at,
    p_latitude,p_longitude,p_accuracy
  );

  select * into v_next_step from public.pull_steps
    where step_type='MAIN' and flow_type='PULL' and active=true
      and sort_order>v_start_step.sort_order
      and (not v_solo or not coalesce(skip_when_solo,false))
    order by sort_order limit 1;

  if v_next_step.id is not null then
    if v_next_step.executor_driver=2 and not v_solo then
      update public.pull_trips
        set active_driver_id=v_driver2.id,active_driver_name=v_driver2.name
        where id=v_trip.id returning * into v_trip;
    else
      update public.pull_trips
        set active_driver_id=v_profile.id,active_driver_name=v_profile.name
        where id=v_trip.id returning * into v_trip;
    end if;
  end if;

  return v_trip;
end;
$$;

grant execute on function public.start_pull_trip(
  text,text,text,text,uuid,double precision,double precision,double precision,timestamptz
) to authenticated;

-- A validação da sequência e a troca do motorista ativo seguem a mesma regra.
-- offline_sync_pull_step chama esta função, então o envio offline usa a regra também.
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
  v_after public.pull_steps%rowtype;
  v_factory public.factories%rowtype;
  v_event public.pull_events%rowtype;
  v_open_occ public.pull_occurrences%rowtype;
  v_max_order integer;
  v_distance double precision;
  v_geofence text := 'NOT_APPLICABLE';
  v_max_accuracy integer := 200;
  v_reason text := btrim(coalesce(p_exception_reason,''));
  v_now timestamptz := now();
begin
  if not public.has_permission('PULL_TRIP') then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;

  select * into v_trip from public.pull_trips where id=p_trip_id for update;
  if v_trip.id is null then raise exception 'CICLO_NAO_ENCONTRADO'; end if;
  if not public.is_admin() and auth.uid() not in (v_trip.driver1_id,v_trip.driver2_id) then raise exception 'FORBIDDEN'; end if;
  if v_trip.status<>'IN_PROGRESS' then raise exception 'CICLO_NAO_ESTA_EM_ANDAMENTO'; end if;

  select coalesce(max(step_order),-2147483648) into v_max_order from public.pull_events where trip_id=v_trip.id;
  select * into v_next from public.pull_steps
   where step_type='MAIN' and flow_type=v_trip.cycle_type and active=true and sort_order>v_max_order
     and (v_trip.cycle_type<>'PULL' or not v_trip.solo_trip or not coalesce(skip_when_solo,false))
   order by sort_order limit 1;
  if v_next.id is null then raise exception 'SEM_PROXIMA_ETAPA'; end if;
  if v_next.id<>p_step_id then raise exception 'ETAPA_FORA_DE_SEQUENCIA'; end if;
  v_step := v_next;

  if coalesce(v_step.required,true) then
    select * into v_open_occ from public.pull_occurrences
     where trip_id=v_trip.id and status='OPEN' order by started_at desc limit 1;
    if v_open_occ.id is not null then raise exception 'OCORRENCIA_EM_ANDAMENTO:%',v_open_occ.occurrence_name; end if;
  end if;

  if not public.is_admin() then
    if v_step.executor_driver=1 and auth.uid()<>v_trip.driver1_id then raise exception 'ETAPA_MOTORISTA_1'; end if;
    if v_step.executor_driver=2 and auth.uid()<>v_trip.driver2_id then raise exception 'ETAPA_MOTORISTA_2'; end if;
    if v_step.executor_driver is null and v_trip.active_driver_id<>auth.uid() then raise exception 'MOTORISTA_NAO_ESTA_ATIVO'; end if;
  end if;

  select coalesce(gps_max_accuracy_m,200) into v_max_accuracy from public.pull_settings where singleton=true;
  v_max_accuracy:=least(500,greatest(5,coalesce(v_max_accuracy,200)));
  if p_accuracy is null or p_accuracy>v_max_accuracy then
    raise exception 'GPS_PRECISAO_INSUFICIENTE:%:%',coalesce(round(p_accuracy)::text,'SEM_SINAL'),v_max_accuracy;
  end if;

  if v_trip.cycle_type='PULL' and v_step.requires_factory_geofence then
    select * into v_factory from public.factories where name=v_trip.factory;
    if v_factory.latitude is null or v_factory.longitude is null or v_factory.radius_meters is null then
      v_geofence := 'NOT_CONFIGURED';
    else
      v_distance := public.pull_distance_m(p_latitude,p_longitude,v_factory.latitude,v_factory.longitude);
      if v_distance<=v_factory.radius_meters then v_geofence:='INSIDE'; else v_geofence:='OUTSIDE'; end if;
    end if;
  end if;

  insert into public.pull_events(
    trip_id,step_id,step_name,action_code,step_order,user_id,user_name,recorded_at,device_at,
    latitude,longitude,gps_accuracy,geofence_status,distance_factory_m,factory_latitude,factory_longitude,factory_radius_m,exception_reason
  ) values(
    v_trip.id,v_step.id,v_step.name,v_step.action_code,v_step.sort_order,v_profile.id,v_profile.name,v_now,p_device_at,
    p_latitude,p_longitude,p_accuracy,v_geofence,v_distance,v_factory.latitude,v_factory.longitude,v_factory.radius_meters,v_reason
  ) returning * into v_event;

  if v_trip.cycle_type='PULL' and v_step.action_code='ARRIVE_FACTORY' then
    update public.pull_trips set arrived_factory_at=v_now where id=v_trip.id;
  elsif v_trip.cycle_type='PULL' and v_step.action_code='LEAVE_FACTORY' then
    update public.pull_trips set left_factory_at=v_now where id=v_trip.id;
  elsif v_trip.cycle_type='PULL' and v_step.action_code='ARRIVE_UNIT' then
    update public.pull_trips
       set ended_at=v_now,ended_by_id=v_profile.id,ended_by_name=v_profile.name,
           end_latitude=p_latitude,end_longitude=p_longitude,end_accuracy=p_accuracy,
           status='ARRIVED',kpi_status='WAITING_NEXT_START',nri_status='PENDING',
           active_driver_id=v_profile.id,active_driver_name=v_profile.name
     where id=v_trip.id;
  elsif v_trip.cycle_type='TRANSFER' and v_step.action_code='TRANSFER_ARRIVE_MATRIX' then
    update public.pull_trips
       set ended_at=v_now,next_started_at=v_now,ended_by_id=v_profile.id,ended_by_name=v_profile.name,
           end_latitude=p_latitude,end_longitude=p_longitude,end_accuracy=p_accuracy,
           status='ARRIVED',kpi_status='CLOSED',nri_status='NOT_READY',
           active_driver_id=v_profile.id,active_driver_name=v_profile.name
     where id=v_trip.id;
  end if;

  if not (
    (v_trip.cycle_type='PULL' and v_step.action_code='ARRIVE_UNIT')
    or (v_trip.cycle_type='TRANSFER' and v_step.action_code='TRANSFER_ARRIVE_MATRIX')
  ) then
    select * into v_after from public.pull_steps
     where step_type='MAIN' and flow_type=v_trip.cycle_type and active=true and sort_order>v_step.sort_order
     and (v_trip.cycle_type<>'PULL' or not v_trip.solo_trip or not coalesce(skip_when_solo,false))
     order by sort_order limit 1;
    if v_after.id is not null then
      if v_after.executor_driver=1 then
        update public.pull_trips set active_driver_id=v_trip.driver1_id,active_driver_name=v_trip.driver1_name where id=v_trip.id;
      elsif v_after.executor_driver=2 then
        update public.pull_trips set active_driver_id=v_trip.driver2_id,active_driver_name=v_trip.driver2_name where id=v_trip.id;
      end if;
    end if;
  end if;

  select * into v_trip from public.pull_trips where id=p_trip_id;
  return jsonb_build_object('event',to_jsonb(v_event),'trip',to_jsonb(v_trip));
end;
$$;

grant execute on function public.record_pull_step(
  uuid,uuid,double precision,double precision,double precision,text,timestamptz
) to authenticated;

commit;
