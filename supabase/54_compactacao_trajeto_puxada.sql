-- Guarda o desenho do trajeto em um registro compacto por viagem concluida.
-- Os apontamentos das etapas e ocorrencias permanecem nas tabelas originais.
create extension if not exists pg_cron;

create table if not exists public.pull_trip_route_snapshots (
  trip_id uuid primary key references public.pull_trips(id) on delete cascade,
  route_points jsonb not null default '[]'::jsonb,
  sampled_points integer not null default 0,
  original_points integer not null default 0,
  archived_at timestamptz not null default now(),
  constraint pull_trip_route_points_array check (jsonb_typeof(route_points) = 'array')
);

alter table public.pull_trip_route_snapshots enable row level security;

drop policy if exists pull_trip_route_read on public.pull_trip_route_snapshots;
create policy pull_trip_route_read on public.pull_trip_route_snapshots
for select to authenticated using (exists (
  select 1 from public.pull_trips t
  where t.id = trip_id
    and public.user_has_unit(t.origin_unit)
    and (
      public.has_permission('PULL_FAROL')
      or public.has_permission('PULL_HISTORY')
      or public.has_permission('PULL_DASHBOARD')
      or public.has_permission('PULL_TMA_ADJUST')
      or (public.has_permission('PULL_TRIP') and (t.driver1_id = auth.uid() or t.driver2_id = auth.uid()))
    )
));

grant select on public.pull_trip_route_snapshots to authenticated;

-- Um ponto a cada 15 segundos, mais o primeiro e o ultimo, preserva a forma
-- geral da rota. As lacunas temporais continuam visiveis no mapa.
create or replace function public.archive_finished_pull_track(p_trip_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.pull_trips%rowtype;
  v_original integer;
  v_sampled integer;
  v_route jsonb;
  v_deleted integer;
begin
  select * into v_trip
  from public.pull_trips
  where id = p_trip_id
  for update;

  if v_trip.id is null
     or v_trip.status not in ('ARRIVED', 'CANCELLED')
     or v_trip.ended_at is null
     or v_trip.ended_at > now() - interval '48 hours' then
    return 0;
  end if;

  -- Um snapshot existente nunca pode ser substituido por uma fila tardia.
  if exists (select 1 from public.pull_trip_route_snapshots where trip_id = p_trip_id) then
    return 0;
  end if;

  select count(*) into v_original
  from public.pull_track_points
  where trip_id = p_trip_id;

  if v_original = 0 then
    return 0;
  end if;

  with valid as (
    select p.id, p.latitude, p.longitude,
           coalesce(p.device_at, p.recorded_at) as at
    from public.pull_track_points p
    where p.trip_id = p_trip_id
      and p.latitude between -90 and 90
      and p.longitude between -180 and 180
      and (p.gps_accuracy is null or p.gps_accuracy <= 300)
      and coalesce(p.device_at, p.recorded_at)
          between v_trip.started_at - interval '10 minutes'
              and v_trip.ended_at + interval '20 minutes'
  ), ranked as (
    select *,
      row_number() over (
        partition by floor(extract(epoch from at) / 15)
        order by at, id
      ) as bucket_rank,
      row_number() over (order by at, id) as first_rank,
      row_number() over (order by at desc, id desc) as last_rank
    from valid
  ), sampled as (
    select id, latitude, longitude, at
    from ranked
    where bucket_rank = 1 or first_rank = 1 or last_rank = 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_array(
        round(latitude::numeric, 5),
        round(longitude::numeric, 5),
        floor(extract(epoch from at))::bigint
      ) order by at, id
    ), '[]'::jsonb
  ), count(*)
  into v_route, v_sampled
  from sampled;

  insert into public.pull_trip_route_snapshots
    (trip_id, route_points, sampled_points, original_points)
  values (p_trip_id, v_route, v_sampled, v_original);

  delete from public.pull_track_points where trip_id = p_trip_id;
  get diagnostics v_deleted = row_count;

  if v_deleted <> v_original then
    raise exception 'TRACK_ARCHIVE_COUNT_MISMATCH: % <> %', v_deleted, v_original;
  end if;

  return v_deleted;
end;
$$;

revoke all on function public.archive_finished_pull_track(uuid)
from public, anon, authenticated;

create or replace function public.archive_finished_pull_tracks(p_limit integer default 25)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip_id uuid;
  v_total integer := 0;
begin
  for v_trip_id in
    select t.id
    from public.pull_trips t
    where t.status in ('ARRIVED', 'CANCELLED')
      and t.ended_at <= now() - interval '48 hours'
      and exists (select 1 from public.pull_track_points p where p.trip_id = t.id)
      and not exists (select 1 from public.pull_trip_route_snapshots s where s.trip_id = t.id)
    order by t.ended_at
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  loop
    v_total := v_total + public.archive_finished_pull_track(v_trip_id);
  end loop;
  return v_total;
end;
$$;

revoke all on function public.archive_finished_pull_tracks(integer)
from public, anon, authenticated;

-- Um ponto que chegar depois do arquivamento e descartado sem erro para
-- permitir que a fila offline do aplicativo seja concluida.
create or replace function public.ignore_archived_pull_track_point()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.pull_trip_route_snapshots
    where trip_id = new.trip_id
  ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ignore_archived_pull_track_point on public.pull_track_points;
create trigger trg_ignore_archived_pull_track_point
before insert on public.pull_track_points
for each row execute function public.ignore_archived_pull_track_point();

-- Execucao automatica a cada seis horas. O primeiro processamento dos dados
-- historicos deve ser feito separadamente apos revisar o total elegivel.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'archive-finished-pull-tracks') then
    perform cron.unschedule('archive-finished-pull-tracks');
  end if;
end;
$$;

select cron.schedule(
  'archive-finished-pull-tracks',
  '0 */6 * * *',
  'select public.archive_finished_pull_tracks(25)'
);
