-- Reenvio deliberado de comprovantes: uma operação por confirmação, sem
-- modificar aceites, PDFs ou códigos anteriores. Não realiza nenhum envio.
begin;

alter table public.damage_receipt_sends add column if not exists operation_id uuid;
update public.damage_receipt_sends set operation_id=id where operation_id is null;
alter table public.damage_receipt_sends alter column operation_id set default gen_random_uuid();
alter table public.damage_receipt_sends alter column operation_id set not null;
alter table public.damage_receipt_sends add column if not exists resend_of uuid
  references public.damage_receipt_sends(id);

create unique index if not exists damage_receipt_sends_operation_unique
  on public.damage_receipt_sends(operation_id);

-- Mantém a proteção dos servidores/APKs anteriores: inserts antigos sem
-- resend_of continuam impedidos quando o primeiro envio já foi aceito.
drop index if exists public.damage_receipt_sends_active_unique;
create unique index damage_receipt_sends_active_unique
  on public.damage_receipt_sends(request_id,contact_id)
  where resend_of is null and status in ('PROCESSING','ACCEPTED','UNKNOWN');
-- Mesmo reenvios confirmados nunca ultrapassam um resultado incerto/em curso.
create unique index if not exists damage_receipt_sends_inflight_unique
  on public.damage_receipt_sends(request_id,contact_id)
  where status in ('PROCESSING','UNKNOWN');
create index if not exists damage_receipt_sends_resend_of_idx
  on public.damage_receipt_sends(resend_of) where resend_of is not null;

create or replace function public.reserve_damage_receipt_send(
  p_request_id uuid,
  p_contact_id uuid,
  p_requested_by uuid,
  p_operation_id uuid,
  p_resend boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_attempt public.damage_receipt_sends%rowtype;
  v_previous public.damage_receipt_sends%rowtype;
  v_phone text;
begin
  if p_request_id is null or p_contact_id is null or p_requested_by is null
     or p_operation_id is null or p_resend is null then
    raise exception 'INVALID_BODY';
  end if;
  -- A função é interna do servidor. A Edge Function já valida RLS, unidade,
  -- contato e consentimento; a reserva também confere a autoria no banco.
  if not exists(select 1 from public.damage_requests
    where id=p_request_id and created_by=p_requested_by) then
    raise exception 'FORBIDDEN';
  end if;
  select phone_normalized into v_phone from public.customer_contacts where id=p_contact_id;
  if v_phone is null then raise exception 'CONTACT_NOT_FOUND'; end if;

  -- Serializa tanto a identidade da operação quanto os envios ao destinatário.
  -- Todas as reservas usam a mesma ordem de locks para evitar deadlocks.
  perform pg_advisory_xact_lock(hashtextextended('damage-receipt-operation:'||p_operation_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('damage-receipt-pair:'||p_request_id::text||':'||p_contact_id::text,0));

  select * into v_attempt from public.damage_receipt_sends where operation_id=p_operation_id;
  if found then
    if v_attempt.request_id is distinct from p_request_id or v_attempt.contact_id is distinct from p_contact_id
       or v_attempt.requested_by is distinct from p_requested_by
       or (v_attempt.resend_of is not null) is distinct from p_resend then
      raise exception 'OPERATION_ID_CONFLICT';
    end if;
    -- REJECTED também é terminal para esta operação. Uma nova tentativa
    -- deliberada usa outro UUID, preservando a tentativa recusada no histórico.
    return to_jsonb(v_attempt)||jsonb_build_object('reserved',false);
  end if;

  select * into v_attempt from public.damage_receipt_sends
    where request_id=p_request_id and contact_id=p_contact_id
      and status in ('PROCESSING','UNKNOWN')
    order by created_at desc,id desc limit 1;
  if found then return to_jsonb(v_attempt)||jsonb_build_object('reserved',false); end if;

  select * into v_previous from public.damage_receipt_sends
    where request_id=p_request_id and contact_id=p_contact_id and status='ACCEPTED'
    order by created_at desc,id desc limit 1;
  if found then
    if not p_resend then return to_jsonb(v_previous)||jsonb_build_object('reserved',false); end if;
  elsif p_resend then
    raise exception 'RESEND_NOT_AVAILABLE';
  end if;

  insert into public.damage_receipt_sends(
    request_id,contact_id,recipient_phone,requested_by,status,operation_id,resend_of
  ) values(
    p_request_id,p_contact_id,v_phone,p_requested_by,'PROCESSING',p_operation_id,
    case when p_resend then v_previous.id else null end
  ) returning * into v_attempt;
  return to_jsonb(v_attempt)||jsonb_build_object('reserved',true);
end;
$$;
revoke all on function public.reserve_damage_receipt_send(uuid,uuid,uuid,uuid,boolean)
  from public,anon,authenticated;
grant execute on function public.reserve_damage_receipt_send(uuid,uuid,uuid,uuid,boolean)
  to service_role;

-- As políticas e os grants de leitura/gravação do histórico permanecem iguais.
notify pgrst,'reload schema';
commit;
