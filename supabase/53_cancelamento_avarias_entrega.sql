-- Cancelamento auditado de avarias de entrega antes da confirmação de entrega.
begin;

alter table public.damage_items add column if not exists cancelled_by uuid references auth.users(id);
alter table public.damage_items add column if not exists cancelled_by_name text;
alter table public.damage_items add column if not exists cancelled_at timestamptz;
alter table public.damage_items add column if not exists cancelled_from_status text;
alter table public.damage_items add column if not exists cancel_reason text;

alter table public.damage_items drop constraint if exists damage_items_status_check;
alter table public.damage_items add constraint damage_items_status_check
  check (status in ('PENDENTE','APROVADO','REPROVADO','LANCADO','ENTREGUE','CANCELADO'));

alter table public.damage_requests drop constraint if exists damage_requests_status_check;
alter table public.damage_requests add constraint damage_requests_status_check
  check (status in ('PENDENTE','PARCIAL','APROVADO','REPROVADO','LANCADO','ENTREGUE','CANCELADO'));

create or replace function public.refresh_damage_request_status(p_request_id uuid)
returns void
language plpgsql security definer set search_path=public
as $$
declare
  v_total integer;
  v_pending integer;
  v_approved integer;
  v_rejected integer;
  v_launched integer;
  v_delivered integer;
  v_cancelled integer;
  v_status text;
begin
  select count(*),
         count(*) filter(where status='PENDENTE'),
         count(*) filter(where status='APROVADO'),
         count(*) filter(where status='REPROVADO'),
         count(*) filter(where status='LANCADO'),
         count(*) filter(where status='ENTREGUE'),
         count(*) filter(where status='CANCELADO')
    into v_total,v_pending,v_approved,v_rejected,v_launched,v_delivered,v_cancelled
  from public.damage_items where request_id=p_request_id;

  v_status := case
    when v_total=0 or v_pending=v_total then 'PENDENTE'
    when v_cancelled=v_total then 'CANCELADO'
    when v_approved=v_total then 'APROVADO'
    when v_rejected=v_total then 'REPROVADO'
    when v_launched=v_total then 'LANCADO'
    when v_delivered=v_total then 'ENTREGUE'
    else 'PARCIAL'
  end;

  update public.damage_requests
     set status=v_status,
         last_review_at=case when v_pending=v_total then last_review_at else now() end
   where id=p_request_id;
end;
$$;

create or replace function public.cancel_damage_items(p_item_ids uuid[],p_reason text)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_count integer;
  v_disallowed integer;
  v_outside_unit integer;
  v_request uuid;
  v_can_review boolean:=public.has_permission('DELIVERY_DAMAGE_REVIEW');
  v_can_post boolean:=public.has_permission('DELIVERY_DAMAGE_POST');
begin
  if not (v_can_review or v_can_post) then raise exception 'FORBIDDEN'; end if;
  if p_item_ids is null or cardinality(p_item_ids)=0 or cardinality(p_item_ids)>200
     or array_position(p_item_ids,null) is not null then raise exception 'ITEM_NAO_ENCONTRADO'; end if;
  if char_length(v_reason)<3 or char_length(v_reason)>500 then raise exception 'MOTIVO_CANCELAMENTO_OBRIGATORIO'; end if;

  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;

  perform i.id from public.damage_items i where i.id=any(p_item_ids) order by i.id for update;
  select count(*),
         count(*) filter(where i.status not in ('PENDENTE','APROVADO','REPROVADO','LANCADO')
           or (not v_can_review and i.status not in ('APROVADO','LANCADO'))),
         count(*) filter(where public.user_has_unit(r.unit) is not true)
    into v_count,v_disallowed,v_outside_unit
  from public.damage_items i
  join public.damage_requests r on r.id=i.request_id
  where i.id=any(p_item_ids);

  if v_count<>cardinality(p_item_ids) then raise exception 'ITEM_NAO_ENCONTRADO'; end if;
  if v_outside_unit>0 then raise exception 'FORBIDDEN'; end if;
  if v_disallowed>0 then raise exception 'ITEM_CANCELAMENTO_INDISPONIVEL'; end if;

  update public.damage_items
     set cancelled_from_status=status,
         status='CANCELADO',
         cancelled_by=auth.uid(),
         cancelled_by_name=v_profile.name,
         cancelled_at=now(),
         cancel_reason=v_reason
   where id=any(p_item_ids);

  for v_request in select distinct request_id from public.damage_items where id=any(p_item_ids) loop
    perform public.refresh_damage_request_status(v_request);
  end loop;
  return jsonb_build_object('updated',v_count,'status','CANCELADO');
end;
$$;

revoke all on function public.cancel_damage_items(uuid[],text) from public,anon;
grant execute on function public.cancel_damage_items(uuid[],text) to authenticated;

notify pgrst, 'reload schema';
commit;
