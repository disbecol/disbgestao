-- Inclui transferências na exclusão administrativa já existente da Puxada.
-- Não remove ciclos ao aplicar esta migração; a exclusão exige confirmação no app.
begin;

create or replace function public.preview_pull_cycle_deletion(p_trip_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_trip public.pull_trips%rowtype; v_plans integer; v_files integer;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into v_trip from public.pull_trips
    where id=p_trip_id and cycle_type in ('PULL','TRANSFER');
  if v_trip.id is null then raise exception 'CICLO_NAO_ENCONTRADO'; end if;
  select count(*) into v_plans from public.pull_trip_plans where trip_id=p_trip_id;
  select count(*) into v_files from storage.objects o where
    (o.bucket_id='puxada-anexos' and (
      split_part(o.name,'/',1)=p_trip_id::text or exists (
        select 1 from public.pull_trip_attachments a
        where a.trip_id=p_trip_id and a.photo_path=o.name)))
    or (o.bucket_id='puxada-notas' and (
      split_part(o.name,'/',1)=p_trip_id::text or exists (
        select 1 from public.pull_trip_invoices i
        where i.trip_id=p_trip_id and i.pdf_path=o.name) or exists (
        select 1 from public.pull_trip_plans p
        where p.trip_id=p_trip_id and (split_part(o.name,'/',1)=p.id::text
          or exists (select 1 from public.pull_trip_invoices i
            where i.plan_id=p.id and i.pdf_path=o.name)))));
  return jsonb_build_object(
    'trip_id',v_trip.id,'trip_code',v_trip.trip_code,'cycle_type',v_trip.cycle_type,
    'plate',v_trip.plate,'status',v_trip.status,'origin_unit',v_trip.origin_unit,
    'driver1_name',v_trip.driver1_name,'driver2_name',v_trip.driver2_name,
    'plans',v_plans,'files',v_files,
    'events',(select count(*) from public.pull_events where trip_id=p_trip_id),
    'checklists',(select count(*) from public.pull_checklist_runs where trip_id=p_trip_id),
    'nris_preserved',(select count(*) from public.nri_requests where pull_trip_id=p_trip_id)
  );
end;$$;
revoke all on function public.preview_pull_cycle_deletion(uuid) from public,anon;
grant execute on function public.preview_pull_cycle_deletion(uuid) to authenticated;

create or replace function public.delete_pull_cycle(p_trip_id uuid,p_trip_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_code text;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select trip_code into v_code from public.pull_trips
    where id=p_trip_id and cycle_type in ('PULL','TRANSFER') for update;
  if v_code is null then raise exception 'CICLO_NAO_ENCONTRADO'; end if;
  if upper(btrim(coalesce(p_trip_code,'')))<>upper(v_code) then
    raise exception 'CODIGO_CICLO_DIVERGENTE'; end if;
  return public.purge_pull_cycle_data(p_trip_id);
end;$$;
revoke all on function public.delete_pull_cycle(uuid,text) from public,anon;
grant execute on function public.delete_pull_cycle(uuid,text) to authenticated;

create or replace function public.delete_pull_plan(p_plan_id uuid,p_plate text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_plan public.pull_trip_plans%rowtype;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into v_plan from public.pull_trip_plans where id=p_plan_id for update;
  if v_plan.id is null or v_plan.cycle_type not in ('PULL','TRANSFER')
      or v_plan.trip_id is not null or v_plan.status='STARTED'
    then raise exception 'VIAGEM_PLANEJADA_NAO_DISPONIVEL'; end if;
  if upper(btrim(coalesce(p_plate,'')))<>upper(v_plan.plate) then
    raise exception 'PLACA_DIVERGENTE'; end if;
  insert into public.pull_deleted_storage_files(subject_id,subject_code,bucket_id,object_name)
  select p_plan_id,v_plan.plate,o.bucket_id,o.name from storage.objects o
  where o.bucket_id='puxada-notas' and (
    split_part(o.name,'/',1)=p_plan_id::text or exists (
      select 1 from public.pull_trip_invoices i
      where i.plan_id=p_plan_id and i.pdf_path=o.name))
  on conflict (bucket_id,object_name) do nothing;
  delete from public.pull_trip_invoices where plan_id=p_plan_id;
  delete from public.pull_trip_plans where id=p_plan_id;
  return jsonb_build_object('plan_id',p_plan_id,'plate',v_plan.plate,
    'files',coalesce((select jsonb_agg(jsonb_build_object('bucket',bucket_id,'path',object_name))
      from public.pull_deleted_storage_files where subject_id=p_plan_id),'[]'::jsonb));
end;$$;
revoke all on function public.delete_pull_plan(uuid,text) from public,anon;
grant execute on function public.delete_pull_plan(uuid,text) to authenticated;

commit;
