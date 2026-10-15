-- Checklists na sequência operacional. Aplicar após 67_sales_stock_validity.sql.
-- Ciclos já iniciados mantêm a regra anterior para não bloquear motoristas em trânsito.
begin;

alter table public.pull_trips add column if not exists checklist_flow_version smallint;
-- O APK anterior continua criando ciclos na versão 1 durante a distribuição.
alter table public.pull_trips alter column checklist_flow_version set default 1;
update public.pull_trips set checklist_flow_version=1 where checklist_flow_version is null;
alter table public.pull_trips alter column checklist_flow_version set not null;

create or replace function public.pull_checklist_requirements(p_trip_id uuid)
returns table(checkpoint_code text,checklist_type text,driver_no smallint,after_action text,gate_action text,sort_order integer)
language sql stable security definer set search_path=public as $$
  select v.checkpoint_code,v.checklist_type,v.driver_no::smallint,v.after_action,v.gate_action,v.sort_order
  from public.pull_trips t
  cross join lateral (values
    ('D1_START','DEPARTURE',1,'START_TRIP','ARRIVE_SUPPORT_OUT',10,
      t.cycle_type='PULL' and t.week_trip_type='FIRST' and not t.solo_trip),
    ('D1_SUPPORT_OUT','RETURN',1,'ARRIVE_SUPPORT_OUT','DRIVER_SWAP_OUT',20,
      t.cycle_type='PULL' and t.week_trip_type is not null and not t.solo_trip),
    ('D2_SUPPORT_OUT','DEPARTURE',2,
      case when t.checklist_flow_version>=2 then 'ARRIVE_SUPPORT_OUT' else 'DRIVER_SWAP_OUT' end,
      case when t.checklist_flow_version>=2 then 'DRIVER_SWAP_OUT' else 'ARRIVE_FACTORY' end,30,
      t.cycle_type='PULL' and t.week_trip_type is not null and not t.solo_trip),
    ('D2_SUPPORT_RETURN','RETURN',2,'ARRIVE_SUPPORT_RETURN','DRIVER_SWAP_RETURN',40,
      t.cycle_type='PULL' and t.week_trip_type is not null and not t.solo_trip),
    ('D1_SUPPORT_RETURN','DEPARTURE',1,
      case when t.checklist_flow_version>=2 then 'ARRIVE_SUPPORT_RETURN' else 'DRIVER_SWAP_RETURN' end,
      case when t.checklist_flow_version>=2 then 'DRIVER_SWAP_RETURN' else 'ARRIVE_UNIT' end,50,
      t.cycle_type='PULL' and t.week_trip_type is not null and not t.solo_trip),
    ('D1_UNIT_LAST','RETURN',1,'DRIVER_SWAP_RETURN','ARRIVE_UNIT',60,
      t.cycle_type='PULL' and t.week_trip_type='LAST' and not t.solo_trip),
    ('SOLO_START','DEPARTURE',1,'START_TRIP','ARRIVE_FACTORY',10,
      t.cycle_type='PULL' and t.week_trip_type is not null and t.solo_trip),
    ('SOLO_UNIT_LAST','RETURN',1,'LEAVE_FACTORY','ARRIVE_UNIT',60,
      t.cycle_type='PULL' and t.week_trip_type='LAST' and t.solo_trip),
    ('TRANSFER_START','DEPARTURE',1,'TRANSFER_START','TRANSFER_ARRIVE_BRANCH',10,
      t.cycle_type='TRANSFER' and t.week_trip_type is not null),
    ('TRANSFER_END','RETURN',1,'TRANSFER_LEAVE_BRANCH','TRANSFER_ARRIVE_MATRIX',60,
      t.cycle_type='TRANSFER' and t.week_trip_type is not null)
  ) v(checkpoint_code,checklist_type,driver_no,after_action,gate_action,sort_order,required)
  where t.id=p_trip_id and v.required;
$$;

-- Lê apenas o último hodômetro da placa atribuída ao Motorista 1.
create or replace function public.pull_plan_checklist_last_km(p_plan_id uuid)
returns table(odometer_km integer,recorded_at timestamptz,trip_id uuid)
language plpgsql stable security definer set search_path=public as $$
declare v_plan public.pull_trip_plans%rowtype;
begin
  if not public.has_permission('PULL_TRIP') then raise exception 'FORBIDDEN'; end if;
  select * into v_plan from public.pull_trip_plans where id=p_plan_id;
  if v_plan.id is null or v_plan.status<>'PLANNED' or v_plan.driver1_id<>auth.uid()
    or not public.user_has_unit(v_plan.origin_unit) then raise exception 'FORBIDDEN'; end if;
  return query select r.odometer_km,r.recorded_at,r.trip_id
    from public.pull_checklist_runs r join public.pull_trips t on t.id=r.trip_id
    where t.plate=v_plan.plate and r.odometer_km is not null
    order by r.recorded_at desc,r.id desc limit 1;
end;$$;
revoke all on function public.pull_plan_checklist_last_km(uuid) from public,anon;
grant execute on function public.pull_plan_checklist_last_km(uuid) to authenticated;

-- Somente o APK atualizado solicita a nova sequência para ciclos sem checklist inicial.
create or replace function public.start_planned_pull_trip_v2(
  p_plan_id uuid,p_latitude double precision,p_longitude double precision,
  p_accuracy double precision,p_device_at timestamptz
) returns public.pull_trips language plpgsql security definer set search_path=public as $$
declare v_trip public.pull_trips%rowtype;
begin
  v_trip:=public.start_planned_pull_trip(p_plan_id,p_latitude,p_longitude,p_accuracy,p_device_at);
  update public.pull_trips set checklist_flow_version=2 where id=v_trip.id returning * into v_trip;
  return v_trip;
end;$$;
revoke all on function public.start_planned_pull_trip_v2(
  uuid,double precision,double precision,double precision,timestamptz
) from public,anon;
grant execute on function public.start_planned_pull_trip_v2(
  uuid,double precision,double precision,double precision,timestamptz
) to authenticated;

-- Checklist preenchido antes de iniciar. Início e gravação ocorrem na mesma transação.
create or replace function public.start_planned_pull_trip_checked(
  p_plan_id uuid,p_latitude double precision,p_longitude double precision,
  p_accuracy double precision,p_device_at timestamptz,p_answers jsonb,p_odometer_km integer
) returns public.pull_trips language plpgsql security definer set search_path=public as $$
declare v_plan public.pull_trip_plans%rowtype; v_trip public.pull_trips%rowtype;
  v_checkpoint text;
begin
  if not public.has_permission('PULL_TRIP') then raise exception 'FORBIDDEN'; end if;
  select * into v_plan from public.pull_trip_plans where id=p_plan_id;
  if v_plan.id is null or v_plan.status<>'PLANNED' or v_plan.driver1_id<>auth.uid()
    or not public.user_has_unit(v_plan.origin_unit) then raise exception 'FORBIDDEN'; end if;
  if v_plan.cycle_type='PULL' and v_plan.week_trip_type='FIRST' then
    v_checkpoint:=case when v_plan.solo_trip then 'SOLO_START' else 'D1_START' end;
  end if;
  if v_checkpoint is null then raise exception 'CHECKLIST_INICIAL_NAO_PREVISTO'; end if;
  if p_odometer_km is null or p_answers is null then raise exception 'CHECKLIST_INCOMPLETO'; end if;
  v_trip:=public.start_planned_pull_trip_v2(p_plan_id,p_latitude,p_longitude,p_accuracy,p_device_at);
  perform public.submit_pull_checklist(v_trip.id,v_checkpoint,p_answers,
    p_latitude,p_longitude,p_accuracy,p_device_at,p_odometer_km);
  return v_trip;
end;$$;
revoke all on function public.start_planned_pull_trip_checked(
  uuid,double precision,double precision,double precision,timestamptz,jsonb,integer
) from public,anon;
grant execute on function public.start_planned_pull_trip_checked(
  uuid,double precision,double precision,double precision,timestamptz,jsonb,integer
) to authenticated;

commit;
