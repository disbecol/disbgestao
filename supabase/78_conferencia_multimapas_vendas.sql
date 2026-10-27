begin;

alter table public.container_conferences
  add column if not exists map_numbers text[] not null default '{}',
  add column if not exists chapatex integer not null default 0,
  add column if not exists pbr1 integer not null default 0,
  add column if not exists pbr2 integer not null default 0,
  add column if not exists sales jsonb not null default '[]'::jsonb;

alter table public.maps
  add column if not exists chapatex integer,
  add column if not exists pbr1 integer,
  add column if not exists pbr2 integer;

update public.container_conferences
set map_numbers=array[map_number]
where cardinality(map_numbers)=0;

create table if not exists public.container_conference_maps (
  conference_id uuid not null references public.container_conferences(id) on delete cascade,
  conference_date date not null,
  map_number text not null,
  primary key(conference_id,map_number),
  unique(conference_date,map_number)
);
alter table public.container_conference_maps enable row level security;
revoke all on table public.container_conference_maps from public,anon,authenticated;

insert into public.container_conference_maps(conference_id,conference_date,map_number)
select id,conference_date,unnest(map_numbers)
from public.container_conferences
on conflict (conference_id,map_number) do nothing;

create or replace function public.container_conference_validate_maps()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_number text;
begin
  if cardinality(new.map_numbers)=0 then new.map_numbers:=array[new.map_number]; end if;
  if new.map_number is distinct from new.map_numbers[1] then
    raise exception 'CONFERENCIA_MAPA_PRINCIPAL_INVALIDO';
  end if;
  foreach v_number in array new.map_numbers loop
    if v_number is null or v_number !~ '^[0-9]{1,12}$' then
      raise exception 'CONFERENCIA_MAPA_INVALIDO';
    end if;
  end loop;
  if cardinality(new.map_numbers)<>(select count(distinct x) from unnest(new.map_numbers) x) then
    raise exception 'CONFERENCIA_MAPA_DUPLICADO';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_container_conference_validate_maps on public.container_conferences;
create trigger trg_container_conference_validate_maps
before insert or update of map_number,map_numbers,conference_date
on public.container_conferences
for each row execute function public.container_conference_validate_maps();

create or replace function public.container_conference_sync_maps()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  delete from public.container_conference_maps where conference_id=new.id;
  insert into public.container_conference_maps(conference_id,conference_date,map_number)
  select new.id,new.conference_date,unnest(new.map_numbers);
  return new;
exception when unique_violation then
  raise exception 'CONFERENCIA_MAPA_DUPLICADO';
end;
$$;

drop trigger if exists trg_container_conference_sync_maps on public.container_conferences;
create trigger trg_container_conference_sync_maps
after insert or update of map_number,map_numbers,conference_date
on public.container_conferences
for each row execute function public.container_conference_sync_maps();

create or replace function public.create_container_conference_v2(p_payload jsonb)
returns public.container_conferences
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_now timestamp;
  v_numbers text[];
  v_number text;
  v_sales jsonb:=coalesce(p_payload->'sales','[]'::jsonb);
  v_sale jsonb;
  v_type text;
  v_mode text;
  v_quantity text;
  v_row public.container_conferences%rowtype;
begin
  if not public.has_permission('CONF_CREATE') then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;
  if jsonb_typeof(p_payload->'map_numbers')<>'array' then raise exception 'CONFERENCIA_MAPA_INVALIDO'; end if;
  select array_agg(value order by ordinality) into v_numbers
  from jsonb_array_elements_text(p_payload->'map_numbers') with ordinality as input(value,ordinality);
  if cardinality(v_numbers) is null or cardinality(v_numbers)=0 then raise exception 'CONFERENCIA_MAPA_INVALIDO'; end if;
  if cardinality(v_numbers)<>(select count(distinct x) from unnest(v_numbers) x) then raise exception 'CONFERENCIA_MAPA_DUPLICADO'; end if;
  foreach v_number in array v_numbers loop
    if v_number !~ '^[0-9]{1,12}$' then raise exception 'CONFERENCIA_MAPA_INVALIDO'; end if;
  end loop;
  if cardinality(v_numbers)>1 then
    foreach v_number in array v_numbers loop
      if not exists(select 1 from public.maps where map_number=v_number) then
        raise exception 'CONFERENCIA_MAPA_SEM_BASE: %',v_number;
      end if;
    end loop;
  end if;
  if jsonb_typeof(v_sales)<>'array' then raise exception 'CONFERENCIA_VENDA_INVALIDA'; end if;
  for v_sale in select value from jsonb_array_elements(v_sales) loop
    v_type:=v_sale->>'type';v_mode:=v_sale->>'mode';v_quantity:=v_sale->>'quantity';
    if coalesce(v_type,'') not in ('g300','g600_green','g600_brown','g_litrao','keg30','keg50','chapatex','pbr1','pbr2')
       or v_quantity is null or v_quantity !~ '^[0-9]+$' or v_quantity::bigint<1 or v_quantity::bigint>2147483647
       or (v_type in ('g300','g600_green','g600_brown','g_litrao') and coalesce(v_mode,'') not in ('crate','bottle','both'))
       or (v_type in ('keg30','keg50','chapatex','pbr1','pbr2') and v_mode is distinct from 'item') then
      raise exception 'CONFERENCIA_VENDA_INVALIDA';
    end if;
  end loop;
  v_now:=timezone('America/Fortaleza',now());
  insert into public.container_conferences(
    conference_date,conference_time,checker_id,checker_username,checker_name,map_number,map_numbers,
    g300,g600_green,g600_brown,g_litrao,keg30,keg50,chapatex,pbr1,pbr2,sales
  ) values (
    v_now::date,v_now::time,auth.uid(),v_profile.username,v_profile.name,v_numbers[1],v_numbers,
    (p_payload->>'g300')::integer,(p_payload->>'g600_green')::integer,
    (p_payload->>'g600_brown')::integer,(p_payload->>'g_litrao')::integer,
    (p_payload->>'keg30')::integer,(p_payload->>'keg50')::integer,
    (p_payload->>'chapatex')::integer,(p_payload->>'pbr1')::integer,(p_payload->>'pbr2')::integer,v_sales
  ) returning * into v_row;
  if least(v_row.g300,v_row.g600_green,v_row.g600_brown,v_row.g_litrao,
           v_row.keg30,v_row.keg50,v_row.chapatex,v_row.pbr1,v_row.pbr2)<0 then
    raise exception 'CONFERENCIA_QUANTIDADE_INVALIDA';
  end if;
  return v_row;
end;
$$;

revoke all on function public.create_container_conference_v2(jsonb) from public,anon;
grant execute on function public.create_container_conference_v2(jsonb) to authenticated;

create or replace function public.get_container_conference_share(p_conference_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_conference public.container_conferences%rowtype;
  v_map public.maps%rowtype;
  v_maps jsonb:='[]'::jsonb;
  v_first jsonb;
  v_number text;
begin
  select * into v_conference from public.container_conferences where id=p_conference_id;
  if v_conference.id is null then raise exception 'CONFERENCIA_NAO_ENCONTRADA'; end if;
  if not (
    (v_conference.checker_id=auth.uid() and (public.has_permission('CONF_CREATE') or public.has_permission('CONF_OWN_HISTORY')))
    or public.has_permission('CONF_HISTORY')
    or public.has_permission('CONF_DASHBOARD')
  ) then raise exception 'FORBIDDEN'; end if;
  foreach v_number in array v_conference.map_numbers loop
    select * into v_map from public.maps
    where map_number=v_number
    order by (map_date<=v_conference.conference_date) desc,map_date desc
    limit 1;
    if v_map.id is not null then
      if v_first is null then v_first:=to_jsonb(v_map); end if;
      v_maps:=v_maps||jsonb_build_array(to_jsonb(v_map));
    end if;
  end loop;
  return jsonb_build_object('conference',to_jsonb(v_conference),'map',v_first,'maps',v_maps);
end;
$$;

revoke all on function public.get_container_conference_share(uuid) from public,anon;
grant execute on function public.get_container_conference_share(uuid) to authenticated;

commit;
