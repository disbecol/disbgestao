-- Preserva toda a geometria GPS válida em um snapshot por viagem.
-- Pontos offline que cheguem depois do arquivamento ficam disponíveis para
-- o mapa imediatamente e são incorporados ao snapshot no próximo ciclo.
begin;

create or replace function public.archive_finished_pull_track(p_trip_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_trip public.pull_trips%rowtype;
  v_original integer; v_kept integer; v_route jsonb;
begin
  select * into v_trip from public.pull_trips where id=p_trip_id for update;
  if v_trip.id is null or v_trip.status not in ('ARRIVED','CANCELLED')
    or v_trip.ended_at is null or v_trip.ended_at>now()-interval '48 hours' then return 0; end if;
  if exists(select 1 from public.pull_trip_route_snapshots where trip_id=p_trip_id) then return 0; end if;

  -- Agrega exatamente os registros removidos. Um ponto inserido em paralelo
  -- após este DELETE permanece na tabela para a etapa posterior de mesclagem.
  with moved as (
    delete from public.pull_track_points where trip_id=p_trip_id
    returning id,latitude,longitude,gps_accuracy,device_at,recorded_at
  ), valid as (
    select id,latitude,longitude,coalesce(device_at,recorded_at) as at
    from moved
    where latitude between -90 and 90 and longitude between -180 and 180
      and (gps_accuracy is null or gps_accuracy<=300)
      and coalesce(device_at,recorded_at) between
        v_trip.started_at-interval '10 minutes' and v_trip.ended_at+interval '20 minutes'
  )
  select (select count(*) from moved), (select count(*) from valid),
    coalesce((select jsonb_agg(jsonb_build_array(
      round(latitude::numeric,5),round(longitude::numeric,5),
      floor(extract(epoch from at))::bigint) order by at,id) from valid),'[]'::jsonb)
    into v_original,v_kept,v_route;

  if v_original=0 then return 0; end if;
  insert into public.pull_trip_route_snapshots(trip_id,route_points,sampled_points,original_points)
    values(p_trip_id,v_route,v_kept,v_original);
  return v_original;
end;$$;

-- A regra antiga descartava pontos válidos enviados pelo APK após 48 horas.
drop trigger if exists trg_ignore_archived_pull_track_point on public.pull_track_points;

create or replace function public.merge_archived_pull_track(p_trip_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_snapshot public.pull_trip_route_snapshots%rowtype;
  v_trip public.pull_trips%rowtype; v_deleted integer; v_route jsonb;
begin
  select * into v_snapshot from public.pull_trip_route_snapshots where trip_id=p_trip_id for update;
  if v_snapshot.trip_id is null then return 0; end if;
  select * into v_trip from public.pull_trips where id=p_trip_id;

  with moved as (
    delete from public.pull_track_points where trip_id=p_trip_id
    returning latitude,longitude,gps_accuracy,device_at,recorded_at
  ), valid as (
    select latitude,longitude,coalesce(device_at,recorded_at) as at from moved
    where latitude between -90 and 90 and longitude between -180 and 180
      and (gps_accuracy is null or gps_accuracy<=300)
      and coalesce(device_at,recorded_at) between
        v_trip.started_at-interval '10 minutes' and v_trip.ended_at+interval '20 minutes'
  ), combined as (
    select point from jsonb_array_elements(v_snapshot.route_points) p(point)
    union all
    select jsonb_build_array(round(latitude::numeric,5),round(longitude::numeric,5),
      floor(extract(epoch from at))::bigint) from valid
  ), unique_points as (select distinct point from combined)
  select (select count(*) from moved),
    coalesce((select jsonb_agg(point order by (point->>2)::bigint,
      (point->>0)::numeric,(point->>1)::numeric) from unique_points),'[]'::jsonb)
    into v_deleted,v_route;

  if v_deleted=0 then return 0; end if;
  update public.pull_trip_route_snapshots set route_points=v_route,
    sampled_points=jsonb_array_length(v_route),original_points=original_points+v_deleted
    where trip_id=p_trip_id;
  return v_deleted;
end;$$;
revoke all on function public.merge_archived_pull_track(uuid) from public,anon,authenticated;

-- O cron existente já chama esta função a cada seis horas.
create or replace function public.archive_finished_pull_tracks(p_limit integer default 25)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_trip_id uuid; v_total integer:=0; v_limit integer:=greatest(1,least(coalesce(p_limit,25),100));
begin
  for v_trip_id in
    select s.trip_id from public.pull_trip_route_snapshots s
    where exists(select 1 from public.pull_track_points p where p.trip_id=s.trip_id)
    order by s.archived_at limit v_limit
  loop
    v_total:=v_total+public.merge_archived_pull_track(v_trip_id);
  end loop;

  for v_trip_id in
    select t.id from public.pull_trips t
    where t.status in ('ARRIVED','CANCELLED')
      and t.ended_at<=now()-interval '48 hours'
      and exists(select 1 from public.pull_track_points p where p.trip_id=t.id)
      and not exists(select 1 from public.pull_trip_route_snapshots s where s.trip_id=t.id)
    order by t.ended_at limit v_limit
  loop
    v_total:=v_total+public.archive_finished_pull_track(v_trip_id);
  end loop;
  return v_total;
end;$$;

commit;
