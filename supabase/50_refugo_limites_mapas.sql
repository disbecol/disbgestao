-- Refugo: valida mapas importados da base MAPAS e limita afericoes por vasilhame.
-- Execute depois de 49_refugo_usuario_afericao.sql.
begin;

alter table public.refugo_catalog add column map_field text;
alter table public.refugo_catalog add constraint refugo_catalog_map_field_valid
  check (map_field is null or (kind='TYPE' and map_field in
    ('g300','g600_green','g600_brown','g_litrao','keg30','keg50')));

-- Associa os nomes ja usados no cadastro. Outros tipos podem ser vinculados na tela.
update public.refugo_catalog set map_field=case
  when lower(name) like '%300%' then 'g300'
  when lower(name) like '%600%' and lower(name) like '%verde%' then 'g600_green'
  when lower(name) like '%600%' and (lower(name) like '%marrom%' or lower(name) like '%âmbar%' or lower(name) like '%ambar%') then 'g600_brown'
  when lower(name) like '%1l%' or lower(name) like '%litr%' then 'g_litrao'
  when (lower(name) like '%barril%' or lower(name) like '%chopp%') and lower(name) like '%30%' then 'keg30'
  when (lower(name) like '%barril%' or lower(name) like '%chopp%') and lower(name) like '%50%' then 'keg50'
  else null end
where kind='TYPE' and map_field is null;

alter table public.refugo_sessions add column map_date date;
alter table public.refugo_sessions add column map_limits jsonb;
alter table public.refugo_items add column map_field text;
alter table public.refugo_items add column planned_quantity integer;
alter table public.refugo_items add constraint refugo_planned_quantity_positive
  check (planned_quantity is null or planned_quantity>0);

update public.refugo_items i set map_field=c.map_field
from public.refugo_catalog c
where i.type_id=c.id and i.map_field is null and c.map_field is not null;

-- Mapas em andamento passam a usar a ultima data importada do mesmo numero.
with latest_maps as (
  select distinct on (map_number) * from public.maps
  order by map_number,map_date desc,updated_at desc,id desc
)
update public.refugo_sessions s set map_date=m.map_date,
  map_limits=jsonb_build_object(
    'g300',greatest(m.g300,0)::bigint*23,
    'g600_green',greatest(m.g600_green,0)::bigint*24,
    'g600_brown',greatest(m.g600_brown,0)::bigint*24,
    'g_litrao',greatest(m.g_litrao,0)::bigint*12,
    'keg30',greatest(m.keg30,0)::bigint,
    'keg50',greatest(m.keg50,0)::bigint)
from latest_maps m
where s.status='OPEN' and s.map_limits is null
  and coalesce(nullif(ltrim(s.map_number,'0'),''),'0')=m.map_number;

create or replace function public.save_refugo_catalog_v2(
  p_id uuid,p_kind text,p_name text,p_active boolean,p_map_field text
)
returns public.refugo_catalog language plpgsql security definer set search_path=public as $$
declare v_row public.refugo_catalog%rowtype; v_field text;
begin
  if not public.has_permission('REFUGO_CONFIG') then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('TYPE','REASON') then raise exception 'REFUGO_CADASTRO_TIPO_INVALIDO'; end if;
  if length(btrim(coalesce(p_name,''))) not between 1 and 100 then raise exception 'REFUGO_NOME_INVALIDO'; end if;
  v_field:=nullif(btrim(coalesce(p_map_field,'')),'');
  if p_kind='TYPE' and (v_field is null or v_field not in
    ('g300','g600_green','g600_brown','g_litrao','keg30','keg50')) then
    raise exception 'REFUGO_TIPO_SEM_VINCULO';
  end if;
  if p_kind='REASON' then v_field:=null; end if;
  if p_id is null then
    insert into public.refugo_catalog(kind,unit,name,active,map_field,updated_by)
    values(p_kind,null,btrim(p_name),coalesce(p_active,true),v_field,auth.uid()) returning * into v_row;
  else
    update public.refugo_catalog set name=btrim(p_name),active=coalesce(p_active,true),
      map_field=v_field,updated_at=now(),updated_by=auth.uid()
    where id=p_id and kind=p_kind and unit is null returning * into v_row;
    if v_row.id is null then raise exception 'REFUGO_CADASTRO_NAO_ENCONTRADO'; end if;
  end if;
  return v_row;
end;
$$;

-- Mantem a chamada dos aplicativos anteriores, inferindo o campo pelo nome.
create or replace function public.save_refugo_catalog(
  p_id uuid,p_kind text,p_unit text,p_name text,p_active boolean
)
returns public.refugo_catalog language plpgsql security definer set search_path=public as $$
declare v_field text;
begin
  if p_kind='TYPE' then
    v_field:=case
      when lower(p_name) like '%300%' then 'g300'
      when lower(p_name) like '%600%' and lower(p_name) like '%verde%' then 'g600_green'
      when lower(p_name) like '%600%' and (lower(p_name) like '%marrom%' or lower(p_name) like '%âmbar%' or lower(p_name) like '%ambar%') then 'g600_brown'
      when lower(p_name) like '%1l%' or lower(p_name) like '%litr%' then 'g_litrao'
      when (lower(p_name) like '%barril%' or lower(p_name) like '%chopp%') and lower(p_name) like '%30%' then 'keg30'
      when (lower(p_name) like '%barril%' or lower(p_name) like '%chopp%') and lower(p_name) like '%50%' then 'keg50'
      else null end;
  end if;
  return public.save_refugo_catalog_v2(p_id,p_kind,p_name,p_active,v_field);
end;
$$;

create or replace function public.start_refugo_session(
  p_unit text,p_map_number text,p_helper_id uuid
)
returns public.refugo_sessions language plpgsql security definer set search_path=public as $$
declare v_row public.refugo_sessions%rowtype; v_map public.maps%rowtype;
  v_name text; v_number text; v_limits jsonb;
begin
  if not public.has_permission('REFUGO_AFERIR') or not public.refugo_user_has_unit(p_unit) then raise exception 'FORBIDDEN'; end if;
  if btrim(coalesce(p_map_number,'')) !~ '^[0-9]{1,30}$' then raise exception 'REFUGO_MAPA_INVALIDO'; end if;
  v_number:=coalesce(nullif(ltrim(btrim(p_map_number),'0'),''),'0');
  select * into v_map from public.maps where map_number=v_number
    order by map_date desc,updated_at desc,id desc limit 1;
  if v_map.id is null then raise exception 'REFUGO_MAPA_NAO_ENCONTRADO'; end if;
  select btrim(name) into v_name from public.profiles where id=auth.uid() and active=true;
  if v_name is null or v_name='' then raise exception 'UNAUTHORIZED'; end if;
  v_limits:=jsonb_build_object(
    'g300',greatest(v_map.g300,0)::bigint*23,
    'g600_green',greatest(v_map.g600_green,0)::bigint*24,
    'g600_brown',greatest(v_map.g600_brown,0)::bigint*24,
    'g_litrao',greatest(v_map.g_litrao,0)::bigint*12,
    'keg30',greatest(v_map.keg30,0)::bigint,
    'keg50',greatest(v_map.keg50,0)::bigint);
  insert into public.refugo_sessions(unit,map_number,helper_id,helper_name,created_by,
    created_by_name,map_date,map_limits)
  values(p_unit,v_number,null,v_name,auth.uid(),v_name,v_map.map_date,v_limits) returning * into v_row;
  return v_row;
end;
$$;

-- A versao nova usa uma assinatura propria para falhar sem criar mapa se este SQL ainda nao foi aplicado.
create or replace function public.start_refugo_session_v2(p_unit text,p_map_number text)
returns public.refugo_sessions language plpgsql security definer set search_path=public as $$
begin
  return public.start_refugo_session(p_unit,p_map_number,null::uuid);
end;
$$;

create or replace function public.start_refugo_item(p_session_id uuid,p_type_id uuid)
returns public.refugo_items language plpgsql security definer set search_path=public as $$
declare v_session public.refugo_sessions%rowtype; v_type public.refugo_catalog%rowtype;
  v_row public.refugo_items%rowtype; v_used bigint; v_cap bigint;
begin
  if not public.has_permission('REFUGO_AFERIR') then raise exception 'FORBIDDEN'; end if;
  select * into v_session from public.refugo_sessions where id=p_session_id for update;
  if v_session.id is null or not public.refugo_user_has_unit(v_session.unit) then raise exception 'FORBIDDEN'; end if;
  if v_session.status<>'OPEN' then raise exception 'REFUGO_MAPA_FINALIZADO'; end if;
  if v_session.map_limits is null then raise exception 'REFUGO_MAPA_NAO_ENCONTRADO'; end if;
  if exists(select 1 from public.refugo_items where session_id=p_session_id and status='RUNNING') then
    raise exception 'REFUGO_ITEM_EM_ANDAMENTO'; end if;
  select * into v_type from public.refugo_catalog where id=p_type_id and kind='TYPE' and active=true;
  if v_type.id is null then raise exception 'REFUGO_TIPO_INVALIDO'; end if;
  if v_type.map_field is null then raise exception 'REFUGO_TIPO_SEM_VINCULO'; end if;
  v_cap:=coalesce((v_session.map_limits->>v_type.map_field)::bigint,0);
  select coalesce(sum(quantity_checked),0) into v_used from public.refugo_items
    where session_id=p_session_id and map_field=v_type.map_field and status='COMPLETED';
  if v_used>=v_cap then raise exception 'REFUGO_LIMITE_MAPA_ATINGIDO'; end if;
  insert into public.refugo_items(session_id,type_id,type_name,map_field,created_by)
  values(p_session_id,v_type.id,v_type.name,v_type.map_field,auth.uid()) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.start_refugo_item_v2(
  p_session_id uuid,p_type_id uuid,p_quantity_planned integer
)
returns public.refugo_items language plpgsql security definer set search_path=public as $$
declare v_session public.refugo_sessions%rowtype; v_type public.refugo_catalog%rowtype;
  v_row public.refugo_items%rowtype; v_used bigint; v_cap bigint;
begin
  if not public.has_permission('REFUGO_AFERIR') then raise exception 'FORBIDDEN'; end if;
  if p_quantity_planned is null or p_quantity_planned<=0 then raise exception 'REFUGO_QUANTIDADE_INVALIDA'; end if;
  select * into v_session from public.refugo_sessions where id=p_session_id for update;
  if v_session.id is null or not public.refugo_user_has_unit(v_session.unit) then raise exception 'FORBIDDEN'; end if;
  if v_session.map_limits is null then raise exception 'REFUGO_MAPA_NAO_ENCONTRADO'; end if;
  select * into v_type from public.refugo_catalog where id=p_type_id and kind='TYPE' and active=true;
  if v_type.id is null then raise exception 'REFUGO_TIPO_INVALIDO'; end if;
  if v_type.map_field is null then raise exception 'REFUGO_TIPO_SEM_VINCULO'; end if;
  v_cap:=coalesce((v_session.map_limits->>v_type.map_field)::bigint,0);
  select coalesce(sum(quantity_checked),0) into v_used from public.refugo_items
    where session_id=p_session_id and map_field=v_type.map_field and status='COMPLETED';
  if v_used+p_quantity_planned>v_cap then raise exception 'REFUGO_QUANTIDADE_EXCEDE_MAPA'; end if;
  select * into v_row from public.start_refugo_item(p_session_id,p_type_id);
  update public.refugo_items set planned_quantity=p_quantity_planned
    where id=v_row.id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.finish_refugo_item(p_item_id uuid,p_quantity_checked integer,p_note text,p_reasons jsonb)
returns public.refugo_items language plpgsql security definer set search_path=public as $$
declare v_item public.refugo_items%rowtype; v_session public.refugo_sessions%rowtype;
  v_entry jsonb; v_reason public.refugo_catalog%rowtype; v_qty integer; v_total integer:=0;
  v_used bigint; v_cap bigint;
begin
  if not public.has_permission('REFUGO_AFERIR') then raise exception 'FORBIDDEN'; end if;
  select * into v_item from public.refugo_items where id=p_item_id for update;
  if v_item.id is null then raise exception 'REFUGO_ITEM_NAO_ENCONTRADO'; end if;
  select * into v_session from public.refugo_sessions where id=v_item.session_id for update;
  if not public.refugo_user_has_unit(v_session.unit) then raise exception 'FORBIDDEN'; end if;
  if v_session.status<>'OPEN' or v_item.status<>'RUNNING' then raise exception 'REFUGO_ITEM_FINALIZADO'; end if;
  if v_session.map_limits is null then raise exception 'REFUGO_MAPA_NAO_ENCONTRADO'; end if;
  if p_quantity_checked is null or p_quantity_checked<=0 then raise exception 'REFUGO_QUANTIDADE_INVALIDA'; end if;
  if v_item.map_field is null then raise exception 'REFUGO_TIPO_SEM_VINCULO'; end if;
  v_cap:=coalesce((v_session.map_limits->>v_item.map_field)::bigint,0);
  select coalesce(sum(quantity_checked),0) into v_used from public.refugo_items
    where session_id=v_session.id and map_field=v_item.map_field and status='COMPLETED';
  if v_used+p_quantity_checked>v_cap then raise exception 'REFUGO_QUANTIDADE_EXCEDE_MAPA'; end if;
  if length(btrim(coalesce(p_note,'')))>1000 then raise exception 'REFUGO_OBSERVACAO_LONGA'; end if;
  if p_reasons is null or jsonb_typeof(p_reasons)<>'array' then raise exception 'REFUGO_MOTIVOS_INVALIDOS'; end if;
  for v_entry in select value from jsonb_array_elements(p_reasons) loop
    if jsonb_typeof(v_entry)<>'object' or coalesce(v_entry->>'quantity','') !~ '^[0-9]{1,9}$' then
      raise exception 'REFUGO_MOTIVOS_INVALIDOS'; end if;
    v_qty:=(v_entry->>'quantity')::integer;
    if v_qty=0 then continue; end if;
    select * into v_reason from public.refugo_catalog
      where id=(v_entry->>'id')::uuid and kind='REASON' and active=true;
    if v_reason.id is null then raise exception 'REFUGO_MOTIVO_INVALIDO'; end if;
    insert into public.refugo_item_reasons(item_id,reason_id,reason_name,quantity)
    values(v_item.id,v_reason.id,v_reason.name,v_qty);
    v_total:=v_total+v_qty;
  end loop;
  if v_total>p_quantity_checked then raise exception 'REFUGO_TOTAL_SUPERA_AFERIDO'; end if;
  update public.refugo_items set status='COMPLETED',ended_at=now(),quantity_checked=p_quantity_checked,
    quantity_rejected=v_total,note=btrim(coalesce(p_note,'')) where id=v_item.id returning * into v_item;
  return v_item;
end;
$$;

revoke all on function public.save_refugo_catalog_v2(uuid,text,text,boolean,text) from public;
grant execute on function public.save_refugo_catalog_v2(uuid,text,text,boolean,text) to authenticated;
revoke all on function public.start_refugo_session_v2(text,text) from public;
grant execute on function public.start_refugo_session_v2(text,text) to authenticated;
revoke all on function public.start_refugo_item_v2(uuid,uuid,integer) from public;
grant execute on function public.start_refugo_item_v2(uuid,uuid,integer) to authenticated;

commit;
