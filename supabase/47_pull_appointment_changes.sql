-- Permite ao Analista de Puxada corrigir o agendamento após o início,
-- preservando o horário anterior, o novo e a justificativa no histórico.
begin;

create table if not exists public.pull_appointment_changes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.pull_trips(id) on delete cascade,
  old_appointment_at timestamptz,
  new_appointment_at timestamptz not null,
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  changed_by uuid not null references auth.users(id),
  changed_by_name text not null,
  changed_at timestamptz not null default now()
);
create index if not exists pull_appointment_changes_trip_time
  on public.pull_appointment_changes(trip_id,changed_at desc);

alter table public.pull_appointment_changes enable row level security;
drop policy if exists pull_trips_plan_read on public.pull_trips;
create policy pull_trips_plan_read on public.pull_trips for select to authenticated using (
  public.has_permission('PULL_PLAN') and public.user_has_unit(origin_unit)
  and exists (select 1 from public.pull_trip_plans p where p.trip_id=id)
);
drop policy if exists pull_appointment_changes_read on public.pull_appointment_changes;
create policy pull_appointment_changes_read on public.pull_appointment_changes
for select to authenticated using (
  exists (
    select 1 from public.pull_trips t
    where t.id=trip_id and public.user_has_unit(t.origin_unit)
      and (
        public.has_permission('PULL_PLAN')
        or public.has_permission('PULL_HISTORY')
        or public.has_permission('PULL_TMA_ADJUST')
        or t.driver1_id=auth.uid()
        or t.driver2_id=auth.uid()
      )
  )
);
grant select on public.pull_appointment_changes to authenticated;

-- O PDF do ciclo inclui ajustes de TMA e NRIs vinculados mesmo quando o
-- usuário tem Histórico de Puxada, mas não os módulos de NRI.
drop policy if exists pull_tma_audit_history_read on public.pull_tma_adjust_audit;
create policy pull_tma_audit_history_read on public.pull_tma_adjust_audit
for select to authenticated using (
  public.has_permission('PULL_HISTORY') and exists (
    select 1 from public.pull_trips t
    where t.id=trip_id and public.user_has_unit(t.origin_unit)
  )
);
drop policy if exists nri_requests_pull_history_read on public.nri_requests;
create policy nri_requests_pull_history_read on public.nri_requests
for select to authenticated using (
  public.has_permission('PULL_HISTORY') and pull_trip_id is not null
  and public.user_has_unit(unit)
);
drop policy if exists nris_pull_history_read on public.nris;
create policy nris_pull_history_read on public.nris
for select to authenticated using (
  public.has_permission('PULL_HISTORY') and public.user_has_unit(unit)
  and exists (select 1 from public.nri_requests r
    where r.id=request_id and r.pull_trip_id is not null)
);

create or replace function public.change_pull_trip_appointment(
  p_trip_id uuid, p_new_appointment_at timestamptz, p_reason text
) returns public.pull_appointment_changes
language plpgsql security definer set search_path=public as $$
declare
  v_trip public.pull_trips%rowtype;
  v_change public.pull_appointment_changes%rowtype;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_actor text;
begin
  if not public.has_permission('PULL_PLAN') then raise exception 'FORBIDDEN'; end if;
  if p_new_appointment_at is null then raise exception 'AGENDAMENTO_OBRIGATORIO'; end if;
  if char_length(v_reason) not between 5 and 500 then raise exception 'JUSTIFICATIVA_AGENDAMENTO_OBRIGATORIA'; end if;

  select * into v_trip from public.pull_trips where id=p_trip_id for update;
  if v_trip.id is null or v_trip.cycle_type<>'PULL' or v_trip.status='CANCELLED'
     or not public.user_has_unit(v_trip.origin_unit) then
    raise exception 'VIAGEM_NAO_EDITAVEL';
  end if;
  if v_trip.appointment_at is not distinct from p_new_appointment_at then
    raise exception 'AGENDAMENTO_SEM_ALTERACAO';
  end if;

  select coalesce(nullif(btrim(name),''),username,auth.uid()::text)
    into v_actor from public.profiles where id=auth.uid();
  update public.pull_trips set appointment_at=p_new_appointment_at where id=p_trip_id;
  update public.pull_trip_plans set scheduled_at=p_new_appointment_at,
    updated_by=auth.uid(),updated_at=now()
    where trip_id=p_trip_id and status='STARTED';
  insert into public.pull_appointment_changes(
    trip_id,old_appointment_at,new_appointment_at,reason,changed_by,changed_by_name
  ) values (
    p_trip_id,v_trip.appointment_at,p_new_appointment_at,v_reason,
    auth.uid(),coalesce(v_actor,auth.uid()::text)
  ) returning * into v_change;
  return v_change;
end;
$$;
revoke all on function public.change_pull_trip_appointment(uuid,timestamptz,text) from public,anon;
grant execute on function public.change_pull_trip_appointment(uuid,timestamptz,text) to authenticated;

commit;
