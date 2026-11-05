-- Identificação e registro imutável de cada PDF, inclusive após excluir a avaria.
begin;
create table if not exists public.damage_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_code text generated always as ('DGB-' || upper(substr(replace(id::text,'-',''),1,8)) || '-' ||
    upper(substr(replace(id::text,'-',''),9,8)) || '-' || upper(substr(replace(id::text,'-',''),17,8)) || '-' ||
    upper(substr(replace(id::text,'-',''),25,8))) stored unique not null,
  -- Sem CASCADE: estas referências e a cópia da emissão são evidência histórica.
  request_id uuid not null,
  send_id uuid not null unique,
  requested_by uuid not null,
  unit text not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  reserved_at timestamptz not null default now(),
  pdf_sha256 text check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  generated_at timestamptz,
  constraint damage_receipts_sealed check ((pdf_sha256 is null) = (generated_at is null))
);
create index if not exists damage_receipts_request_idx on public.damage_receipts(request_id,reserved_at desc);

create or replace function public.guard_damage_receipt_record() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.id is distinct from old.id or new.request_id is distinct from old.request_id
    or new.send_id is distinct from old.send_id or new.requested_by is distinct from old.requested_by
    or new.unit is distinct from old.unit or new.snapshot is distinct from old.snapshot
    or new.reserved_at is distinct from old.reserved_at then
    raise exception 'RECEIPT_IMMUTABLE';
  end if;
  if old.pdf_sha256 is not null and (new.pdf_sha256 is distinct from old.pdf_sha256
    or new.generated_at is distinct from old.generated_at) then raise exception 'RECEIPT_IMMUTABLE'; end if;
  return new;
end $$;
drop trigger if exists damage_receipt_record_guard on public.damage_receipts;
create trigger damage_receipt_record_guard before update on public.damage_receipts
for each row execute function public.guard_damage_receipt_record();
revoke all on function public.guard_damage_receipt_record() from public;

alter table public.damage_receipts enable row level security;
revoke all on public.damage_receipts from anon,authenticated,service_role;
grant select on public.damage_receipts to authenticated,service_role;
grant insert(request_id,send_id,requested_by,unit,snapshot) on public.damage_receipts to service_role;
grant update(pdf_sha256,generated_at) on public.damage_receipts to service_role;
drop policy if exists damage_receipts_read on public.damage_receipts;
create policy damage_receipts_read on public.damage_receipts for select to authenticated using (
  public.user_has_unit(unit) and (
    (requested_by=auth.uid() and public.has_permission('DELIVERY_DAMAGE_CREATE'))
    or public.has_permission('DELIVERY_DAMAGE_VIEW_ALL')
    or public.has_permission('DELIVERY_DAMAGE_REVIEW')
    or public.has_permission('DELIVERY_DAMAGE_POST')
  )
);

create or replace function public.find_damage_receipt(p_code text,p_unit text)
returns table(id uuid,request_id uuid,receipt_code text,snapshot jsonb,pdf_sha256 text,generated_at timestamptz)
language sql stable security invoker set search_path=public,pg_temp as $$
  select r.id,r.request_id,r.receipt_code,r.snapshot,r.pdf_sha256,r.generated_at
  from public.damage_receipts r
  where r.unit=p_unit and r.pdf_sha256 is not null
    and r.receipt_code = case when upper(regexp_replace(p_code,'[^a-zA-Z0-9]','','g')) ~ '^DGB[0-9A-F]{32}$'
      then 'DGB-' || substr(upper(regexp_replace(p_code,'[^a-zA-Z0-9]','','g')),4,8) || '-' ||
        substr(upper(regexp_replace(p_code,'[^a-zA-Z0-9]','','g')),12,8) || '-' ||
        substr(upper(regexp_replace(p_code,'[^a-zA-Z0-9]','','g')),20,8) || '-' ||
        substr(upper(regexp_replace(p_code,'[^a-zA-Z0-9]','','g')),28,8) end
$$;
revoke all on function public.find_damage_receipt(text,text) from public,anon;
grant execute on function public.find_damage_receipt(text,text) to authenticated;
commit;
