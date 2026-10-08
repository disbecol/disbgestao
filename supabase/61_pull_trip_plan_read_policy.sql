-- O ID sem qualificacao em 47 era resolvido como p.id dentro da subconsulta.
-- Isso impedia o planejador de ler o ciclo associado e de anexar sua NF.
begin;

drop policy if exists pull_trips_plan_read on public.pull_trips;
create policy pull_trips_plan_read on public.pull_trips
for select to authenticated using (
  public.has_permission('PULL_PLAN')
  and public.user_has_unit(pull_trips.origin_unit)
  and exists (
    select 1 from public.pull_trip_plans p
    where p.trip_id = pull_trips.id
  )
);

commit;
