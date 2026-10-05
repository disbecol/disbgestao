-- Refugo: o usuario autenticado identifica quem inicia a afericao.
-- Execute depois de 48_refugo_afericoes.sql. Registros antigos permanecem intactos.
begin;

update public.permissions
set description='Cadastrar tipos de vasilhame e motivos de refugo.'
where code='REFUGO_CONFIG';

-- Preserva os ajudantes historicos, mas novos mapas nao precisam de um cadastro.
alter table public.refugo_sessions alter column helper_id drop not null;

create or replace function public.save_refugo_catalog(
  p_id uuid,p_kind text,p_unit text,p_name text,p_active boolean
)
returns public.refugo_catalog language plpgsql security definer set search_path=public as $$
declare v_row public.refugo_catalog%rowtype;
begin
  if not public.has_permission('REFUGO_CONFIG') then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('TYPE','REASON') then raise exception 'REFUGO_CADASTRO_TIPO_INVALIDO'; end if;
  if length(btrim(coalesce(p_name,''))) not between 1 and 100 then raise exception 'REFUGO_NOME_INVALIDO'; end if;
  if p_id is null then
    insert into public.refugo_catalog(kind,unit,name,active,updated_by)
    values(p_kind,null,btrim(p_name),coalesce(p_active,true),auth.uid()) returning * into v_row;
  else
    update public.refugo_catalog set name=btrim(p_name),active=coalesce(p_active,true),
      updated_at=now(),updated_by=auth.uid()
    where id=p_id and kind=p_kind and unit is null returning * into v_row;
    if v_row.id is null then raise exception 'REFUGO_CADASTRO_NAO_ENCONTRADO'; end if;
  end if;
  return v_row;
end;
$$;

-- Mantem a assinatura de tres argumentos para os APKs anteriores.
-- p_helper_id e ignorado; a identidade vem exclusivamente de auth.uid().
create or replace function public.start_refugo_session(
  p_unit text,p_map_number text,p_helper_id uuid
)
returns public.refugo_sessions language plpgsql security definer set search_path=public as $$
declare v_row public.refugo_sessions%rowtype; v_name text;
begin
  if not public.has_permission('REFUGO_AFERIR') or not public.refugo_user_has_unit(p_unit) then raise exception 'FORBIDDEN'; end if;
  if btrim(coalesce(p_map_number,'')) !~ '^[0-9]{1,30}$' then raise exception 'REFUGO_MAPA_INVALIDO'; end if;
  select btrim(name) into v_name from public.profiles where id=auth.uid() and active=true;
  if v_name is null or v_name='' then raise exception 'UNAUTHORIZED'; end if;
  insert into public.refugo_sessions(unit,map_number,helper_id,helper_name,created_by,created_by_name)
  values(p_unit,btrim(p_map_number),null,v_name,auth.uid(),v_name) returning * into v_row;
  return v_row;
end;
$$;

commit;
