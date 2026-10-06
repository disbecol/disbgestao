-- Comprovantes pela Cloud API: autorização específica e maioridade do destinatário.
-- Os contatos existentes começam bloqueados até validação individual na entrega ou pelo administrador.
alter table public.customer_contacts
  add column if not exists whatsapp_receipt_eligible boolean not null default false;
alter table public.customer_contacts
  add column if not exists whatsapp_receipt_verified_at timestamptz;
alter table public.customer_contacts
  add column if not exists whatsapp_receipt_verified_by uuid references auth.users(id);
alter table public.customer_contacts
  add column if not exists whatsapp_receipt_evidence text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname='customer_contacts_whatsapp_receipt_verified' and conrelid='public.customer_contacts'::regclass) then
    alter table public.customer_contacts add constraint customer_contacts_whatsapp_receipt_verified
      check (whatsapp_receipt_eligible=false or
        (whatsapp_receipt_verified_at is not null and whatsapp_receipt_verified_by is not null
         and length(btrim(whatsapp_receipt_evidence)) between 10 and 300));
  end if;
end;
$$;

create or replace function public.reset_customer_contact_receipt_eligibility()
returns trigger
language plpgsql
as $$
begin
  if new.customer_id is distinct from old.customer_id
    or new.customer_code is distinct from old.customer_code
    or new.phone_normalized is distinct from old.phone_normalized then
    new.whatsapp_receipt_eligible := false;
    new.whatsapp_receipt_verified_at := null;
    new.whatsapp_receipt_verified_by := null;
    new.whatsapp_receipt_evidence := '';
  end if;
  return new;
end;
$$;

drop trigger if exists customer_contacts_reset_receipt_eligibility on public.customer_contacts;
create trigger customer_contacts_reset_receipt_eligibility
before update of customer_id,customer_code,phone_normalized on public.customer_contacts
for each row execute function public.reset_customer_contact_receipt_eligibility();

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
  if p_approved and (length(v_note)<10 or length(v_note)>300) then
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

revoke all on function public.set_customer_contact_receipt_eligibility(uuid,boolean,text) from public,anon;
grant execute on function public.set_customer_contact_receipt_eligibility(uuid,boolean,text) to authenticated;

-- Na entrega, o motorista só pode registrar o aceite para um contato do cliente
-- de uma avaria que ele próprio criou. Cada autorização fica vinculada ao autor.
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
    length(v_age_evidence)<10 or length(v_age_evidence)>120 then
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

revoke all on function public.capture_customer_contact_receipt_optin(uuid,uuid,text,text,boolean,boolean,boolean) from public,anon;
grant execute on function public.capture_customer_contact_receipt_optin(uuid,uuid,text,text,boolean,boolean,boolean) to authenticated;
