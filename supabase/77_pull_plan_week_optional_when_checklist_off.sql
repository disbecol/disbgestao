-- Sem checklist, o planejamento volta a dispensar a classificacao semanal.
-- NULL tambem evita impor checklists retroativamente se a chave for reativada.
begin;

create or replace function public.save_pull_trip_plan(
  p_plan_id uuid,p_cycle_type text,p_origin_unit text,p_plate text,p_factory text,
  p_driver1 uuid,p_driver2 uuid,p_solo_trip boolean,p_scheduled_at timestamptz,p_week_trip_type text
) returns public.pull_trip_plans language plpgsql security definer set search_path=public as $$
declare v_plan public.pull_trip_plans%rowtype;
  v_checklist_enabled boolean;
begin
  select coalesce(checklist_enabled,true) into v_checklist_enabled
    from public.pull_settings where singleton=true;
  v_checklist_enabled:=coalesce(v_checklist_enabled,true);

  if v_checklist_enabled and (p_week_trip_type is null or p_week_trip_type not in ('FIRST','ROUTINE','LAST')) then
    raise exception 'TIPO_SEMANA_OBRIGATORIO';
  end if;

  v_plan:=public.save_pull_trip_plan(p_plan_id,p_cycle_type,p_origin_unit,p_plate,p_factory,
    p_driver1,p_driver2,p_solo_trip,p_scheduled_at);
  update public.pull_trip_plans
     set week_trip_type=case when v_checklist_enabled then p_week_trip_type else null end
   where id=v_plan.id returning * into v_plan;
  return v_plan;
end;$$;

commit;
