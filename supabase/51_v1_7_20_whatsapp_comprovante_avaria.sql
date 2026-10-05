-- Histórico e trava de duplicidade do comprovante de avaria de entrega.
create table if not exists public.damage_receipt_sends (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.damage_requests(id) on delete cascade,
  contact_id uuid not null references public.customer_contacts(id),
  recipient_phone text not null,
  requested_by uuid not null references auth.users(id),
  status text not null check (status in ('PROCESSING','ACCEPTED','REJECTED','UNKNOWN')),
  provider_message_id text,
  provider_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uma rejeição explícita da Meta pode ser tentada novamente. Resposta perdida ou
-- processamento em andamento exigem conferência para não duplicar mensagens.
create unique index if not exists damage_receipt_sends_active_unique
  on public.damage_receipt_sends(request_id,contact_id)
  where status in ('PROCESSING','ACCEPTED','UNKNOWN');
create index if not exists damage_receipt_sends_request_idx
  on public.damage_receipt_sends(request_id,created_at desc);

alter table public.damage_receipt_sends enable row level security;
revoke all on public.damage_receipt_sends from anon,authenticated;
grant select on public.damage_receipt_sends to authenticated;
drop policy if exists damage_receipt_sends_read on public.damage_receipt_sends;
create policy damage_receipt_sends_read on public.damage_receipt_sends
  for select to authenticated using (
    requested_by=auth.uid()
    or exists (
      select 1 from public.damage_requests r
      where r.id=request_id
      and public.user_has_unit(r.unit)
      and (public.has_permission('DELIVERY_DAMAGE_VIEW_ALL')
        or public.has_permission('DELIVERY_DAMAGE_REVIEW'))
    )
  );
