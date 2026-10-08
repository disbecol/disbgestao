-- Nota de Puxada: acrescenta metadados à tabela única public.products.
begin;
alter table public.products add column if not exists nf_reference_code text;
alter table public.products add column if not exists commercial_units_per_pallet integer;
alter table public.products add column if not exists invoice_unit text;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='products_pallet_positive' and conrelid='public.products'::regclass) then
    alter table public.products add constraint products_pallet_positive check (commercial_units_per_pallet is null or commercial_units_per_pallet > 0);
  end if;
  if not exists(select 1 from pg_constraint where conname='products_invoice_unit_valid' and conrelid='public.products'::regclass) then
    alter table public.products add constraint products_invoice_unit_valid check (invoice_unit is null or invoice_unit in ('CX','DZ','UN'));
  end if;
end $$;
create unique index if not exists products_nf_reference_unique on public.products (upper(nf_reference_code)) where nf_reference_code is not null and nf_reference_code<>'';

create table if not exists public.pull_trip_invoices (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references public.pull_trips(id) on delete cascade,
  pdf_path text not null unique,
  invoice_number text not null default '',
  items jsonb not null check (jsonb_typeof(items)='array'),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pull_trip_invoices_trip on public.pull_trip_invoices(trip_id);
alter table public.pull_trip_invoices enable row level security;
drop policy if exists pull_trip_invoices_read on public.pull_trip_invoices;
create policy pull_trip_invoices_read on public.pull_trip_invoices for select to authenticated using (
  exists(select 1 from public.pull_trips t where t.id=trip_id and public.user_has_unit(t.origin_unit)
    and (auth.uid() in (t.driver1_id,t.driver2_id) or public.has_permission('NRI_CREATE') or public.has_permission('PULL_FAROL')))
);
grant select on public.pull_trip_invoices to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('puxada-notas','puxada-notas',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['application/pdf'];
drop policy if exists pull_invoice_upload on storage.objects;
create policy pull_invoice_upload on storage.objects for insert to authenticated with check (
  bucket_id='puxada-notas' and (storage.foldername(name))[2]=auth.uid()::text
  and exists(select 1 from public.pull_trips t where t.id::text=(storage.foldername(name))[1]
    and t.cycle_type='PULL' and (t.status='IN_PROGRESS' or (t.status='ARRIVED' and t.nri_status='PENDING'))
    and public.user_has_unit(t.origin_unit)
    and (auth.uid() in (t.driver1_id,t.driver2_id) or public.has_permission('NRI_CREATE') or public.has_permission('PULL_FAROL')))
);
drop policy if exists pull_invoice_read on storage.objects;
create policy pull_invoice_read on storage.objects for select to authenticated using (
  bucket_id='puxada-notas' and exists(select 1 from public.pull_trips t
    where t.id::text=(storage.foldername(name))[1] and public.user_has_unit(t.origin_unit)
    and (auth.uid() in (t.driver1_id,t.driver2_id) or public.has_permission('NRI_CREATE') or public.has_permission('PULL_HISTORY') or public.has_permission('PULL_FAROL')))
);
drop policy if exists pull_invoice_orphan_delete on storage.objects;
create policy pull_invoice_orphan_delete on storage.objects for delete to authenticated using (
  bucket_id='puxada-notas' and (storage.foldername(name))[2]=auth.uid()::text
  and not exists(select 1 from public.pull_trip_invoices n where n.pdf_path=name)
);

create or replace function public.register_pull_trip_invoice(p_trip_id uuid,p_pdf_path text,p_invoice_number text,p_lines jsonb)
returns public.pull_trip_invoices language plpgsql security definer set search_path=public as $$
declare
  v_trip public.pull_trips%rowtype;
  v_product public.products%rowtype;
  v_line record;
  v_items jsonb:='[]'::jsonb;
  v_row public.pull_trip_invoices%rowtype;
  v_count integer:=0;
  v_seen_references text[]:='{}';
begin
  select * into v_trip from public.pull_trips where id=p_trip_id for update;
  if v_trip.id is null or v_trip.cycle_type<>'PULL'
    or not (v_trip.status='IN_PROGRESS' or (v_trip.status='ARRIVED' and v_trip.nri_status='PENDING'))
    or not public.user_has_unit(v_trip.origin_unit)
    or not (auth.uid() in (v_trip.driver1_id,v_trip.driver2_id) or public.has_permission('NRI_CREATE') or public.has_permission('PULL_FAROL'))
    then raise exception 'NOTA_PUXADA_SEM_ACESSO'; end if;
  if p_pdf_path is null or p_pdf_path not like (p_trip_id::text||'/'||auth.uid()::text||'/%')
    or p_pdf_path !~ '[.]pdf$' then raise exception 'CAMINHO_NOTA_INVALIDO'; end if;
  if not exists(select 1 from storage.objects where bucket_id='puxada-notas' and name=p_pdf_path) then raise exception 'ARQUIVO_NOTA_NAO_ENCONTRADO'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>500 then raise exception 'ITENS_NOTA_INVALIDOS'; end if;
  for v_line in
    select upper(btrim(x.reference_code)) as reference_code,upper(btrim(x.commercial_unit)) as commercial_unit,
      sum(x.quantity) as quantity
    from jsonb_to_recordset(p_lines) as x(reference_code text,commercial_unit text,quantity numeric)
    group by upper(btrim(x.reference_code)),upper(btrim(x.commercial_unit))
  loop
    if v_line.reference_code is null or v_line.reference_code='' or v_line.commercial_unit is null or v_line.commercial_unit not in ('CX','DZ','UN','UND','UNID','UNIDADE','DUZIA','DÚZIA','CAIXA')
      or v_line.quantity is null or v_line.quantity<=0 or v_line.quantity<>trunc(v_line.quantity) then raise exception 'ITEM_NOTA_INVALIDO'; end if;
    if v_line.reference_code=any(v_seen_references) then raise exception 'UNIDADES_DIFERENTES_NA_NOTA: %',v_line.reference_code; end if;
    v_seen_references:=array_append(v_seen_references,v_line.reference_code);
    select * into v_product from public.products where upper(nf_reference_code)=v_line.reference_code and active=true;
    if v_product.code is null then raise exception 'REFERENCIA_NF_NAO_CADASTRADA: %',v_line.reference_code; end if;
    if coalesce(v_product.commercial_units_per_pallet,0)<1 then raise exception 'PALETE_NAO_CADASTRADO: %',v_product.code; end if;
    if v_product.invoice_unit is not null and v_product.invoice_unit<>v_line.commercial_unit then raise exception 'UNIDADE_NOTA_DIVERGENTE: %',v_product.code; end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object(
      'reference_code',v_line.reference_code,'commercial_unit',v_line.commercial_unit,
      'quantity',v_line.quantity,'product_code',v_product.code,'product_name',v_product.name,
      'commercial_units_per_pallet',v_product.commercial_units_per_pallet,
      'full_pallets',trunc(v_line.quantity/v_product.commercial_units_per_pallet),
      'remaining_units',mod(v_line.quantity,v_product.commercial_units_per_pallet)
    ));
    v_count:=v_count+1;
  end loop;
  if v_count<1 then raise exception 'ITENS_NOTA_INVALIDOS'; end if;
  insert into public.pull_trip_invoices(trip_id,pdf_path,invoice_number,items,uploaded_by)
  values(p_trip_id,p_pdf_path,left(btrim(coalesce(p_invoice_number,'')),30),v_items,auth.uid())
  on conflict(trip_id) do update set pdf_path=excluded.pdf_path,invoice_number=excluded.invoice_number,
    items=excluded.items,uploaded_by=excluded.uploaded_by,updated_at=now()
  returning * into v_row;
  return v_row;
end;$$;
revoke all on function public.register_pull_trip_invoice(uuid,text,text,jsonb) from public,anon;
grant execute on function public.register_pull_trip_invoice(uuid,text,text,jsonb) to authenticated;

-- Valida a soma de unidades de todas as NRIs emitidas para cada produto da nota,
-- permitindo diferentes lotes e validades para um mesmo produto.
create or replace function public.validate_pull_invoice_nris()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_note public.pull_trip_invoices%rowtype;
begin
  if new.nri_status<>'COMPLETED' or old.nri_status='COMPLETED' then return new; end if;
  select * into v_note from public.pull_trip_invoices where trip_id=new.id;
  if v_note.id is null then return new; end if;
  if not exists(select 1 from public.nri_requests where pull_trip_id=new.id) then return new; end if;
  if exists(
    with expected as (select x->>'product_code' as code,sum((x->>'quantity')::numeric) as qty
      from jsonb_array_elements(v_note.items) x group by x->>'product_code'),
    actual as (select n.product_code as code,sum(n.quantity) as qty
      from public.nris n join public.nri_requests r on r.id=n.request_id where r.pull_trip_id=new.id group by n.product_code)
    select 1 from expected e full join actual a using(code) where e.qty is distinct from a.qty
  ) then raise exception 'NRI_NOTA_QUANTIDADE_DIVERGENTE'; end if;
  if exists(select 1 from public.nris n join public.nri_requests r on r.id=n.request_id
    where r.pull_trip_id=new.id and btrim(coalesce(n.lot,''))='') then raise exception 'NRI_NOTA_LOTE_OBRIGATORIO'; end if;
  return new;
end;$$;
drop trigger if exists validate_pull_invoice_nris on public.pull_trips;
create trigger validate_pull_invoice_nris before update of nri_status on public.pull_trips
for each row execute function public.validate_pull_invoice_nris();
commit;
