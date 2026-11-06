-- Aceita descrições curtas como RG e CNH, mantendo o preenchimento obrigatório.
-- Preserva consentimento, maioridade, país, autoria, unidade, permissões e histórico.
-- CREATE OR REPLACE mantém os privilégios das duas funções já existentes.
begin;
alter table public.customer_contacts drop constraint customer_contacts_whatsapp_receipt_verified;
alter table public.customer_contacts add constraint customer_contacts_whatsapp_receipt_verified
  check (whatsapp_receipt_eligible=false or
    (whatsapp_receipt_verified_at is not null and whatsapp_receipt_verified_by is not null
     and length(btrim(whatsapp_receipt_evidence)) between 1 and 300));

create or replace function public.set_customer_contact_receipt_eligibility(
  p_contact_id uuid,
  p_approved boolean,
  p_note text default ''
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_note text := btrim(coalesce(p_note,''));
begin
  if not public.has_permission('ADMIN_BASES') then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;
  if p_approved is null then raise exception 'CONFIRMACAO_OBRIGATORIA'; end if;
  if p_approved and (length(v_note)=0 or length(v_note)>300) then
    raise exception 'COMPROVANTE_CONSENTIMENTO_MAIORIDADE_OBRIGATORIO';
  end if;

  update public.customer_contacts set
    whatsapp_receipt_eligible=p_approved,
    whatsapp_receipt_verified_at=case when p_approved then now() else null end,
    whatsapp_receipt_verified_by=case when p_approved then auth.uid() else null end,
    whatsapp_receipt_evidence=case when p_approved then v_note else '' end,
    updated_by=auth.uid(),
    updated_by_name=v_profile.name,
    updated_at=now()
  where id=p_contact_id;
  if not found then raise exception 'CONTATO_NAO_ENCONTRADO'; end if;
  return true;
end;
$$;


create or replace function public.capture_customer_contact_receipt_optin(
  p_request_id uuid,
  p_contact_id uuid,
  p_recipient_name text,
  p_age_evidence text,
  p_consent_confirmed boolean,
  p_adult_confirmed boolean,
  p_brazil_confirmed boolean
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_damage public.damage_requests%rowtype;
  v_contact public.customer_contacts%rowtype;
  v_customer public.customers%rowtype;
  v_recipient text := btrim(coalesce(p_recipient_name,''));
  v_age_evidence text := btrim(coalesce(p_age_evidence,''));
begin
  if not public.has_permission('DELIVERY_DAMAGE_CREATE') then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_damage from public.damage_requests where id=p_request_id and created_by=auth.uid();
  if v_damage.id is null then raise exception 'AVARIA_NAO_ENCONTRADA'; end if;
  select * into v_contact from public.customer_contacts where id=p_contact_id for update;
  select * into v_customer from public.customers where id=v_contact.customer_id;
  if v_contact.id is null or
    v_customer.id is null or
    ltrim(regexp_replace(v_contact.customer_code,E'\\D','','g'),'0') <>
    ltrim(regexp_replace(v_damage.customer_code,E'\\D','','g'),'0') or
    lower(btrim(v_customer.name)) <> lower(btrim(v_damage.customer_name)) then
    raise exception 'CONTATO_NAO_ENCONTRADO';
  end if;
  if length(v_recipient)<2 or length(v_recipient)>120 or
    length(v_age_evidence)=0 or length(v_age_evidence)>120 then
    raise exception 'COMPROVANTE_DADOS_ACEITE_INVALIDOS';
  end if;
  if p_consent_confirmed is distinct from true or p_adult_confirmed is distinct from true
    or p_brazil_confirmed is distinct from true then
    raise exception 'COMPROVANTE_CONFIRMACOES_OBRIGATORIAS';
  end if;

  update public.customer_contacts set
    whatsapp_receipt_eligible=true,
    whatsapp_receipt_verified_at=now(),
    whatsapp_receipt_verified_by=auth.uid(),
    whatsapp_receipt_evidence=left('Entrega: aceite WhatsApp, 18+ e Brasil; destinatário: '||v_recipient||'; idade: '||v_age_evidence,300),
    updated_by=auth.uid(),
    updated_by_name=v_profile.name,
    updated_at=now()
  where id=p_contact_id;
  return true;
end;
$$;


commit;
