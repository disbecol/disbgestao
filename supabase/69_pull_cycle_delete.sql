-- Exclusão administrativa de Puxadas. NRIs emitidos permanecem, sem vínculo
-- com o ciclo apagado. Os arquivos privados são removidos pela Storage API.
begin;

create table if not exists public.pull_deleted_storage_files (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null,
  subject_code text not null,
  bucket_id text not null check (bucket_id in ('puxada-anexos','puxada-notas')),
  object_name text not null,
  queued_at timestamptz not null default now(),
  unique (bucket_id,object_name)
);
alter table public.pull_deleted_storage_files enable row level security;
drop policy if exists pull_deleted_storage_files_admin_read on public.pull_deleted_storage_files;
create policy pull_deleted_storage_files_admin_read on public.pull_deleted_storage_files
  for select to authenticated using (public.is_admin());
revoke all on public.pull_deleted_storage_files from public,anon,authenticated;
grant select on public.pull_deleted_storage_files to authenticated;

-- A fila limita a remoção por administradores aos arquivos de ciclos já excluídos.
drop policy if exists pull_deleted_storage_select on storage.objects;
create policy pull_deleted_storage_select on storage.objects for select to authenticated using (
  public.is_admin() and exists (
    select 1 from public.pull_deleted_storage_files f
    where f.bucket_id=storage.objects.bucket_id and f.object_name=storage.objects.name
  )
);
drop policy if exists pull_deleted_storage_delete on storage.objects;
create policy pull_deleted_storage_delete on storage.objects for delete to authenticated using (
  public.is_admin() and exists (
    select 1 from public.pull_deleted_storage_files f
    where f.bucket_id=storage.objects.bucket_id and f.object_name=storage.objects.name
  )
);

create or replace function public.preview_pull_cycle_deletion(p_trip_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_trip public.pull_trips%rowtype; v_plans integer; v_files integer;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into v_trip from public.pull_trips where id=p_trip_id and cycle_type='PULL';
  if v_trip.id is null then raise exception 'PUXADA_NAO_ENCONTRADA'; end if;
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
    'trip_id',v_trip.id,'trip_code',v_trip.trip_code,'plate',v_trip.plate,
    'status',v_trip.status,'origin_unit',v_trip.origin_unit,
    'driver1_name',v_trip.driver1_name,'driver2_name',v_trip.driver2_name,
    'plans',v_plans,'files',v_files,
    'events',(select count(*) from public.pull_events where trip_id=p_trip_id),
    'checklists',(select count(*) from public.pull_checklist_runs where trip_id=p_trip_id),
    'nris_preserved',(select count(*) from public.nri_requests where pull_trip_id=p_trip_id)
  );
end;$$;
revoke all on function public.preview_pull_cycle_deletion(uuid) from public,anon;
grant execute on function public.preview_pull_cycle_deletion(uuid) to authenticated;

-- Uso interno pelo botão administrativo e pela limpeza pontual de usuário.
create or replace function public.purge_pull_cycle_data(p_trip_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_trip public.pull_trips%rowtype; v_nris integer; v_next_started_at timestamptz;
begin
  select * into v_trip from public.pull_trips where id=p_trip_id for update;
  if v_trip.id is null then raise exception 'CICLO_NAO_ENCONTRADO'; end if;
  select count(*) into v_nris from public.nri_requests where pull_trip_id=p_trip_id;

  insert into public.pull_deleted_storage_files(subject_id,subject_code,bucket_id,object_name)
  select p_trip_id,v_trip.trip_code,o.bucket_id,o.name from storage.objects o where
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
            where i.plan_id=p.id and i.pdf_path=o.name)))))
  on conflict (bucket_id,object_name) do nothing;

  -- Preserva as NRIs e evita que a exclusão da viagem apague documentos emitidos.
  update public.nri_requests set pull_trip_id=null where pull_trip_id=p_trip_id;
  delete from public.pull_checklist_answers where run_id in
    (select id from public.pull_checklist_runs where trip_id=p_trip_id);
  delete from public.pull_checklist_runs where trip_id=p_trip_id;
  delete from public.pull_trip_invoices where trip_id=p_trip_id or plan_id in
    (select id from public.pull_trip_plans where trip_id=p_trip_id);
  delete from public.pull_trip_plans where trip_id=p_trip_id;

  -- Se esta saída fechou o TMA da viagem anterior, usa a próxima saída restante.
  select min(next_trip.started_at) into v_next_started_at
  from public.pull_trips next_trip
  where next_trip.plate=v_trip.plate and next_trip.id<>p_trip_id
    and next_trip.started_at>v_trip.started_at;
  update public.pull_trips previous
    set next_started_at=v_next_started_at,
      kpi_status=case when v_next_started_at is null then 'WAITING_NEXT_START' else 'CLOSED' end
    where previous.plate=v_trip.plate and previous.id<>p_trip_id
      and previous.started_at<v_trip.started_at
      and previous.next_started_at=v_trip.started_at;

  delete from public.pull_trips where id=p_trip_id;
  return jsonb_build_object(
    'trip_id',p_trip_id,'trip_code',v_trip.trip_code,'nris_preserved',v_nris,
    'files',coalesce((select jsonb_agg(jsonb_build_object('bucket',bucket_id,'path',object_name))
      from public.pull_deleted_storage_files where subject_id=p_trip_id),'[]'::jsonb)
  );
end;$$;
revoke all on function public.purge_pull_cycle_data(uuid) from public,anon,authenticated;

create or replace function public.delete_pull_cycle(p_trip_id uuid,p_trip_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_code text;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select trip_code into v_code from public.pull_trips
    where id=p_trip_id and cycle_type='PULL' for update;
  if v_code is null then raise exception 'PUXADA_NAO_ENCONTRADA'; end if;
  if upper(btrim(coalesce(p_trip_code,'')))<>upper(v_code) then
    raise exception 'CODIGO_PUXADA_DIVERGENTE'; end if;
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
  if v_plan.id is null or v_plan.cycle_type<>'PULL' or v_plan.trip_id is not null
      or v_plan.status='STARTED' then raise exception 'VIAGEM_PLANEJADA_NAO_DISPONIVEL'; end if;
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

create or replace function public.ack_pull_deleted_file(p_bucket text,p_path text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if exists(select 1 from storage.objects where bucket_id=p_bucket and name=p_path) then
    raise exception 'ARQUIVO_AINDA_EXISTE'; end if;
  delete from public.pull_deleted_storage_files where bucket_id=p_bucket and object_name=p_path;
end;$$;
revoke all on function public.ack_pull_deleted_file(text,text) from public,anon;
grant execute on function public.ack_pull_deleted_file(text,text) to authenticated;

commit;
