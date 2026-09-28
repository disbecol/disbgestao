-- Permite Puxada com um único motorista sem mudar as permissões existentes.
-- O segundo ID interno aponta para o próprio motorista nas viagens solo;
-- isso mantém as funções e políticas antigas que exigem dois IDs não nulos.
alter table public.pull_trips
  add column if not exists solo_trip boolean not null default false;

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
