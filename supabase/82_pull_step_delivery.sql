-- Puxada: confirmação idempotente e leitura atômica para a troca de motorista.
-- Não altera viagens, respostas, permissões de unidade ou a opção do checklist.
begin;
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
  -- Reenvios (inclusive com outro operation_id) confirmam o mesmo evento.
  -- A autorização é validada antes de devolver qualquer dado da viagem.
  perform public.assert_user_unit(v_trip.origin_unit);
  select * into v_event from public.pull_events
    where trip_id=v_trip.id and step_id=p_step_id order by recorded_at limit 1;
  if found then
    if not public.is_admin() and v_event.user_id<>auth.uid() then
      raise exception 'ETAPA_REGISTRADA_POR_OUTRO_MOTORISTA';
    end if;
    return jsonb_build_object('event',to_jsonb(v_event),'trip',to_jsonb(v_trip),'already_recorded',true);
  end if;
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
  if p_latitude is null or p_longitude is null
     or not (p_latitude between -90 and 90) or not (p_longitude between -180 and 180) then
    raise exception 'GPS_COORDENADAS_INVALIDAS';
  end if;
  if p_accuracy is null or not (p_accuracy>=0 and p_accuracy<=v_max_accuracy) then
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



-- Uma leitura consistente, sem depender do catálogo de veículos, perfis, NF,
-- fotos ou checklist. SECURITY INVOKER conserva as políticas RLS existentes.
create or replace function public.pull_driver_state(p_trip_id uuid default null)
returns jsonb language plpgsql stable security invoker
set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.has_permission('PULL_TRIP') then
    raise exception 'FORBIDDEN';
  end if;
  return (
    with trip as (
      select t.* from public.pull_trips t
      where auth.uid() in (t.driver1_id,t.driver2_id)
        and public.user_has_unit(t.origin_unit)
        and ((p_trip_id is null and t.status='IN_PROGRESS') or t.id=p_trip_id)
      order by t.started_at desc,t.id desc limit 1
    )
    select jsonb_build_object(
      'trip',(select to_jsonb(t) from trip t),
      'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.step_order,e.recorded_at,e.id)
        from public.pull_events e where e.trip_id=(select id from trip)),'[]'::jsonb),
      'occurrences',coalesce((select jsonb_agg(to_jsonb(o) order by o.started_at,o.id)
        from public.pull_occurrences o where o.trip_id=(select id from trip)),'[]'::jsonb),
      'steps',coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order,s.id)
        from public.pull_steps s where s.active),'[]'::jsonb),
      'settings',(select to_jsonb(s) from public.pull_settings s where s.singleton),
      'server_at',statement_timestamp()
    )
  );
end;$$;
revoke all on function public.pull_driver_state(uuid) from public,anon;
grant execute on function public.pull_driver_state(uuid) to authenticated;

-- Encerramentos repetidos não ficam presos por uma resposta perdida.
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
  v_max_accuracy integer:=200;
begin
  if not public.has_permission('PULL_TRIP') then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  select * into v_row from public.pull_occurrences where id=p_occurrence_id for update;
  if v_row.id is null then raise exception 'OCORRENCIA_NAO_ENCONTRADA'; end if;
  select * into v_trip from public.pull_trips where id=v_row.trip_id;
  if auth.uid() not in (v_trip.driver1_id,v_trip.driver2_id) and not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  perform public.assert_user_unit(v_trip.origin_unit);
  if v_profile.id is null then raise exception 'UNAUTHORIZED';end if;
  if v_row.status='CLOSED' then return v_row;end if;
  if v_row.status<>'OPEN' then raise exception 'OCORRENCIA_NAO_ESTA_ABERTA';end if;
  if not public.is_admin() and v_trip.active_driver_id<>auth.uid() then raise exception 'MOTORISTA_NAO_ESTA_ATIVO'; end if;
  select coalesce(gps_max_accuracy_m,200) into v_max_accuracy from public.pull_settings where singleton=true;
  v_max_accuracy:=least(500,greatest(5,coalesce(v_max_accuracy,200)));
  if p_accuracy is null or p_accuracy>v_max_accuracy then raise exception 'GPS_PRECISAO_INSUFICIENTE:%:%',coalesce(round(p_accuracy)::text,'SEM_SINAL'),v_max_accuracy; end if;
  update public.pull_occurrences set ended_by=v_profile.id,ended_by_name=v_profile.name,ended_at=now(),
    end_latitude=p_latitude,end_longitude=p_longitude,end_accuracy=p_accuracy,status='CLOSED'
  where id=v_row.id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.offline_sync_pull_occurrence_end(
  p_operation_id uuid,p_occurrence_id uuid,
  p_latitude double precision,p_longitude double precision,p_accuracy double precision,
  p_device_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;v_row public.pull_occurrences%rowtype;v_at timestamptz:=coalesce(p_device_at,now());
begin
  if p_operation_id is null then raise exception 'OFFLINE_OPERATION_ID_OBRIGATORIO';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select result into v_result from public.offline_sync_receipts
    where operation_id=p_operation_id and user_id=auth.uid();
  if found then return v_result;end if;
  select * into v_row from public.pull_occurrences where id=p_occurrence_id for update;
  if v_row.id is null then raise exception 'OCORRENCIA_NAO_ENCONTRADA';end if;
  if v_row.status='OPEN' then
    if v_at<v_row.started_at or v_at>now()+interval '5 minutes' then raise exception 'HORARIO_OCORRENCIA_INVALIDO';end if;
    v_row:=public.end_pull_occurrence(p_occurrence_id,p_latitude,p_longitude,p_accuracy);
    update public.pull_occurrences set ended_at=v_at where id=v_row.id returning * into v_row;
  else
    -- Confirma o encerramento anterior, preservando seu horário e responsável.
    v_row:=public.end_pull_occurrence(p_occurrence_id,p_latitude,p_longitude,p_accuracy);
  end if;
  v_result:=to_jsonb(v_row);
  insert into public.offline_sync_receipts(operation_id,user_id,operation_type,result)
    values(p_operation_id,auth.uid(),'PULL_OCC_END',v_result);
  return v_result;
end;$$;

notify pgrst, 'reload schema';
commit;
