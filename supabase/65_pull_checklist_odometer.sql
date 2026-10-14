-- KM obrigatório em cada novo checklist da Puxada. Aplicar após 64_pull_checklists.sql.
begin;

-- Registros antigos permanecem sem KM; a nova função exige o valor antes de gravar.
alter table public.pull_checklist_runs
  add column if not exists odometer_km integer check (odometer_km between 0 and 9999999);
alter table public.pull_checklist_runs
  add column if not exists odometer_previous_km integer;
alter table public.pull_checklist_runs
  add column if not exists odometer_delta_km integer;
alter table public.pull_checklist_runs
  add column if not exists odometer_alert text check (odometer_alert in ('LOWER','JUMP'));

-- O motorista vê o último KM da mesma placa, inclusive de viagens anteriores.
create or replace function public.pull_checklist_last_km(p_trip_id uuid)
returns table(odometer_km integer,recorded_at timestamptz,trip_id uuid)
language plpgsql stable security definer set search_path=public as $$
declare v_trip public.pull_trips%rowtype;
begin
  if not public.has_permission('PULL_TRIP') then raise exception 'FORBIDDEN'; end if;
  select * into v_trip from public.pull_trips where id=p_trip_id;
  if v_trip.id is null or (auth.uid() is distinct from v_trip.driver1_id
    and auth.uid() is distinct from v_trip.driver2_id) then
    raise exception 'FORBIDDEN';
  end if;
  return query select r.odometer_km,r.recorded_at,r.trip_id
    from public.pull_checklist_runs r join public.pull_trips t on t.id=r.trip_id
    where t.plate=v_trip.plate and r.odometer_km is not null
    order by r.recorded_at desc,r.id desc limit 1;
end;$$;
revoke all on function public.pull_checklist_last_km(uuid) from public,anon;
grant execute on function public.pull_checklist_last_km(uuid) to authenticated;

-- Impede que versões antigas do aplicativo salvem novos checklists sem quilometragem.
revoke execute on function public.submit_pull_checklist(
  uuid,text,jsonb,double precision,double precision,double precision,timestamptz
) from public,anon,authenticated;

create or replace function public.submit_pull_checklist(
  p_trip_id uuid,p_checkpoint_code text,p_answers jsonb,p_latitude double precision,
  p_longitude double precision,p_accuracy double precision,p_device_at timestamptz,
  p_odometer_km integer
) returns public.pull_checklist_runs language plpgsql security definer set search_path=public as $$
declare v_run public.pull_checklist_runs%rowtype; v_plate text; v_previous integer;
begin
  if p_odometer_km is null or p_odometer_km not between 0 and 9999999 then
    raise exception 'CHECKLIST_KM_OBRIGATORIO';
  end if;

  -- Reaproveita todas as validações de motorista, etapa, GPS e respostas da migração 64.
  v_run:=public.submit_pull_checklist(p_trip_id,p_checkpoint_code,p_answers,p_latitude,
    p_longitude,p_accuracy,p_device_at);

  if v_run.odometer_km is not null then
    if v_run.odometer_km<>p_odometer_km then raise exception 'CHECKLIST_JA_REGISTRADO'; end if;
    return v_run;
  end if;

  select plate into v_plate from public.pull_trips where id=p_trip_id;
  select r.odometer_km into v_previous
    from public.pull_checklist_runs r join public.pull_trips t on t.id=r.trip_id
    where t.plate=v_plate and r.odometer_km is not null
    order by r.recorded_at desc,r.id desc limit 1;

  -- A operação inteira é uma transação: checklist, KM e alerta são persistidos juntos.
  update public.pull_checklist_runs set
    odometer_km=p_odometer_km,
    odometer_previous_km=v_previous,
    odometer_delta_km=case when v_previous is null then null else p_odometer_km-v_previous end,
    odometer_alert=case when v_previous is null then null
      when p_odometer_km<v_previous then 'LOWER'
      when p_odometer_km-v_previous>=1500 then 'JUMP'
      else null end
    where id=v_run.id returning * into v_run;
  return v_run;
end;$$;

revoke all on function public.submit_pull_checklist(
  uuid,text,jsonb,double precision,double precision,double precision,timestamptz,integer
) from public,anon;
grant execute on function public.submit_pull_checklist(
  uuid,text,jsonb,double precision,double precision,double precision,timestamptz,integer
) to authenticated;

commit;
