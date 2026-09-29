-- Justificativa obrigatória somente na reprovação de avarias de entrega e vendas.

-- As funções preservam as permissões, transições de status e auditoria existentes.

begin;

create or replace function public.review_damage_items(p_item_ids uuid[], p_status text, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_req uuid;
  v_status text;
  v_note text;
  v_updated integer;
begin
  if not public.has_permission('DELIVERY_DAMAGE_REVIEW') then raise exception 'FORBIDDEN'; end if;
  v_status := upper(coalesce(p_status,''));
  if v_status not in ('APROVADO','REPROVADO') then raise exception 'STATUS_INVALIDO'; end if;
  v_note := btrim(coalesce(p_note,''));
  if v_status='REPROVADO' and v_note='' then raise exception 'JUSTIFICATIVA_OBRIGATORIA'; end if;

  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;

  update public.damage_items
     set status=v_status,
         reviewer_id=auth.uid(),
         reviewer_name=v_profile.name,
         reviewed_at=now(),
         review_note=v_note,
         launched_by=null,
         launched_by_name=null,
         launched_at=null,
         delivered_by=null,
         delivered_by_name=null,
         delivered_at=null
   where id=any(p_item_ids)
     and status='PENDENTE';

  get diagnostics v_updated=row_count;
  if v_updated=0 then raise exception 'NENHUM_ITEM_PENDENTE'; end if;

  for v_req in select distinct request_id from public.damage_items where id=any(p_item_ids) loop
    perform public.refresh_damage_request_status(v_req);
  end loop;

  return jsonb_build_object('ok',true,'updated',v_updated,'status',v_status);
end;
$$;

create or replace function public.review_sales_damage_items(
  p_item_ids uuid[],
  p_status text,
  p_justification text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_status text:=upper(btrim(coalesce(p_status,'')));
  v_next_status text;
  v_note text:=btrim(coalesce(p_justification,''));
  v_req uuid;
  v_count integer;
begin
  if not public.has_permission('SALES_DAMAGE_REVIEW') then raise exception 'FORBIDDEN'; end if;
  if v_status not in ('APROVADO','REPROVADO') then raise exception 'STATUS_INVALIDO'; end if;
  if v_status='REPROVADO' and v_note='' then raise exception 'JUSTIFICATIVA_OBRIGATORIA'; end if;
  if p_item_ids is null or cardinality(p_item_ids)=0 then raise exception 'ITEM_OBRIGATORIO'; end if;

  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;

  v_next_status:=case when v_status='APROVADO' then 'EM_ANALISE' else 'REPROVADO' end;

  update public.sales_damage_items
     set status=v_next_status,
         reviewer_id=auth.uid(),
         reviewer_name=v_profile.name,
         reviewer_role=v_profile.role,
         reviewed_at=now(),
         review_justification=v_note,
         final_reviewer_id=null,
         final_reviewer_name=null,
         final_reviewer_role=null,
         final_reviewed_at=null,
         final_justification='',
         launched_by=null,
         launched_by_name=null,
         launched_at=null
   where id=any(p_item_ids)
     and status='PENDENTE';

  get diagnostics v_count=row_count;
  if v_count=0 then raise exception 'NENHUM_ITEM_PENDENTE'; end if;

  for v_req in select distinct request_id from public.sales_damage_items where id=any(p_item_ids) loop
    perform public.refresh_sales_damage_request_status(v_req);
  end loop;

  return jsonb_build_object('updated',v_count,'status',v_next_status);
end;
$$;

create or replace function public.finalize_sales_damage_items(
  p_item_ids uuid[],
  p_status text,
  p_justification text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_status text:=upper(btrim(coalesce(p_status,'')));
  v_note text:=btrim(coalesce(p_justification,''));
  v_req uuid;
  v_count integer;
begin
  if not public.has_permission('SALES_DAMAGE_OVERRIDE') then raise exception 'FORBIDDEN'; end if;
  if v_status not in ('APROVADO','REPROVADO') then raise exception 'STATUS_INVALIDO'; end if;
  if v_status='REPROVADO' and v_note='' then raise exception 'JUSTIFICATIVA_OBRIGATORIA'; end if;
  if p_item_ids is null or cardinality(p_item_ids)=0 then raise exception 'ITEM_OBRIGATORIO'; end if;

  select * into v_profile
  from public.profiles
  where id=auth.uid() and active=true;

  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;

  update public.sales_damage_items
     set status=v_status,
         final_reviewer_id=auth.uid(),
         final_reviewer_name=v_profile.name,
         final_reviewer_role=v_profile.role,
         final_reviewed_at=now(),
         final_justification=v_note,
         launched_by=null,
         launched_by_name=null,
         launched_at=null,
         delivered_by=null,
         delivered_by_name=null,
         delivered_at=null
   where id=any(p_item_ids)
     and status in ('PENDENTE','EM_ANALISE');

  get diagnostics v_count=row_count;
  if v_count=0 then raise exception 'NENHUM_ITEM_FINALIZAVEL'; end if;

  for v_req in
    select distinct request_id
    from public.sales_damage_items
    where id=any(p_item_ids)
  loop
    perform public.refresh_sales_damage_request_status(v_req);
  end loop;

  return jsonb_build_object('updated',v_count,'status',v_status);
end;
$$;

grant execute on function public.review_damage_items(uuid[],text,text) to authenticated;

grant execute on function public.review_sales_damage_items(uuid[],text,text) to authenticated;

grant execute on function public.finalize_sales_damage_items(uuid[],text,text) to authenticated;

commit;
