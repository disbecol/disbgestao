-- A NF pode ser vinculada ao plano antes da partida ou ao ciclo ate a emissao dos NRIs.
begin;

alter table public.products add column if not exists nf_reference_code_filial text;
create unique index if not exists products_nf_reference_filial_unique on public.products(upper(nf_reference_code_filial))
  where nf_reference_code_filial is not null and nf_reference_code_filial<>'';

alter table public.pull_trip_invoices alter column trip_id drop not null;
alter table public.pull_trip_invoices add column if not exists plan_id uuid references public.pull_trip_plans(id) on delete cascade;
create unique index if not exists pull_trip_invoices_plan_unique on public.pull_trip_invoices(plan_id);
do $$ begin
  if not exists(select 1 from pg_constraint where conname='pull_invoice_has_owner' and conrelid='public.pull_trip_invoices'::regclass) then
    alter table public.pull_trip_invoices add constraint pull_invoice_has_owner check(trip_id is not null or plan_id is not null);
  end if;
end $$;

drop policy if exists pull_trip_invoices_read on public.pull_trip_invoices;
create policy pull_trip_invoices_read on public.pull_trip_invoices for select to authenticated using (
  (trip_id is not null and exists(select 1 from public.pull_trips t where t.id=trip_id
    and public.user_has_unit(t.origin_unit)
    and (auth.uid() in (t.driver1_id,t.driver2_id) or public.has_permission('NRI_CREATE')
      or public.has_permission('PULL_FAROL') or public.has_permission('PULL_PLAN'))))
  or (plan_id is not null and exists(select 1 from public.pull_trip_plans p where p.id=plan_id
    and public.user_has_unit(p.origin_unit)
    and (auth.uid() in (p.driver1_id,p.driver2_id) or public.has_permission('PULL_PLAN')
      or public.has_permission('NRI_CREATE'))))
);

-- Inclui ciclos antigos sem plano que ainda aguardam NRI na tela de viagens.
drop policy if exists pull_trips_plan_pending_read on public.pull_trips;
create policy pull_trips_plan_pending_read on public.pull_trips for select to authenticated using (
  public.has_permission('PULL_PLAN') and public.user_has_unit(origin_unit)
  and cycle_type='PULL' and status='ARRIVED' and nri_status='PENDING'
);

drop policy if exists pull_invoice_upload on storage.objects;
create policy pull_invoice_upload on storage.objects for insert to authenticated with check (
  bucket_id='puxada-notas' and (storage.foldername(name))[2]=auth.uid()::text and (
    exists(select 1 from public.pull_trips t where t.id::text=(storage.foldername(name))[1]
      and t.cycle_type='PULL' and (t.status='IN_PROGRESS' or (t.status='ARRIVED' and t.nri_status='PENDING'))
      and public.user_has_unit(t.origin_unit)
      and (auth.uid() in (t.driver1_id,t.driver2_id) or public.has_permission('NRI_CREATE')
        or public.has_permission('PULL_FAROL') or public.has_permission('PULL_PLAN')))
    or exists(select 1 from public.pull_trip_plans p where p.id::text=(storage.foldername(name))[1]
      and p.cycle_type='PULL' and p.status='PLANNED' and public.user_has_unit(p.origin_unit)
      and public.has_permission('PULL_PLAN'))
  )
);
drop policy if exists pull_invoice_read on storage.objects;
create policy pull_invoice_read on storage.objects for select to authenticated using (
  bucket_id='puxada-notas' and (
    exists(select 1 from public.pull_trips t where t.id::text=(storage.foldername(name))[1]
      and public.user_has_unit(t.origin_unit)
      and (auth.uid() in (t.driver1_id,t.driver2_id) or public.has_permission('NRI_CREATE')
        or public.has_permission('PULL_HISTORY') or public.has_permission('PULL_FAROL') or public.has_permission('PULL_PLAN')))
    or exists(select 1 from public.pull_trip_plans p where p.id::text=(storage.foldername(name))[1]
      and public.user_has_unit(p.origin_unit)
      and (auth.uid() in (p.driver1_id,p.driver2_id) or public.has_permission('NRI_CREATE')
        or public.has_permission('PULL_HISTORY') or public.has_permission('PULL_FAROL') or public.has_permission('PULL_PLAN')))
  )
);

-- A conversao continua sendo conferida no servidor; linhas repetidas sao somadas.
create or replace function public.pull_invoice_items(p_lines jsonb,p_origin_unit text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_product public.products%rowtype; v_line record; v_items jsonb:='[]'::jsonb;
  v_seen text[]:='{}'; v_count integer:=0;
begin
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>500 then
    raise exception 'ITENS_NOTA_INVALIDOS'; end if;
  for v_line in
    select upper(btrim(x.reference_code)) as reference_code,upper(btrim(x.commercial_unit)) as commercial_unit,
      sum(x.quantity) as quantity
    from jsonb_to_recordset(p_lines) as x(reference_code text,commercial_unit text,quantity numeric)
    group by upper(btrim(x.reference_code)),upper(btrim(x.commercial_unit))
  loop
    if v_line.reference_code is null or v_line.reference_code='' or v_line.commercial_unit is null
      or v_line.commercial_unit not in ('CX','DZ','UN','UND','UNID','UNIDADE','DUZIA','DÚZIA','CAIXA')
      or v_line.quantity is null or v_line.quantity<=0 or v_line.quantity<>trunc(v_line.quantity)
      then raise exception 'ITEM_NOTA_INVALIDO'; end if;
    if v_line.reference_code=any(v_seen) then raise exception 'UNIDADES_DIFERENTES_NA_NOTA: %',v_line.reference_code; end if;
    v_seen:=array_append(v_seen,v_line.reference_code);
    select * into v_product from public.products where
      upper(case when p_origin_unit='Filial Pau dos Ferros' then nf_reference_code_filial else nf_reference_code end)=v_line.reference_code
      and active=true;
    if v_product.code is null then raise exception 'REFERENCIA_NF_NAO_CADASTRADA: %',v_line.reference_code; end if;
    if coalesce(v_product.commercial_units_per_pallet,0)<1 then raise exception 'PALETE_NAO_CADASTRADO: %',v_product.code; end if;
    if v_product.invoice_unit is not null and v_product.invoice_unit<>v_line.commercial_unit then
      raise exception 'UNIDADE_NOTA_DIVERGENTE: %',v_product.code; end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object(
      'reference_code',v_line.reference_code,'commercial_unit',v_line.commercial_unit,
      'quantity',v_line.quantity,'product_code',v_product.code,'product_name',v_product.name,
      'commercial_units_per_pallet',v_product.commercial_units_per_pallet,
      'full_pallets',trunc(v_line.quantity/v_product.commercial_units_per_pallet),
      'remaining_units',mod(v_line.quantity,v_product.commercial_units_per_pallet)));
    v_count:=v_count+1;
  end loop;
  if v_count<1 then raise exception 'ITENS_NOTA_INVALIDOS'; end if;
  return v_items;
end;$$;
revoke all on function public.pull_invoice_items(jsonb,text) from public,anon,authenticated;

create or replace function public.register_pull_plan_invoice(p_plan_id uuid,p_pdf_path text,p_invoice_number text,p_lines jsonb)
returns public.pull_trip_invoices language plpgsql security definer set search_path=public as $$
declare v_plan public.pull_trip_plans%rowtype; v_row public.pull_trip_invoices%rowtype;
begin
  select * into v_plan from public.pull_trip_plans where id=p_plan_id for update;
  if v_plan.id is null or v_plan.cycle_type<>'PULL' or v_plan.status<>'PLANNED'
    or not public.has_permission('PULL_PLAN') or not public.user_has_unit(v_plan.origin_unit)
    then raise exception 'NOTA_PLANO_SEM_ACESSO'; end if;
  if p_pdf_path is null or p_pdf_path not like (p_plan_id::text||'/'||auth.uid()::text||'/%')
    or p_pdf_path !~ '[.]pdf$' then raise exception 'CAMINHO_NOTA_INVALIDO'; end if;
  if not exists(select 1 from storage.objects where bucket_id='puxada-notas' and name=p_pdf_path) then
    raise exception 'ARQUIVO_NOTA_NAO_ENCONTRADO'; end if;
  insert into public.pull_trip_invoices(plan_id,pdf_path,invoice_number,items,uploaded_by)
  values(p_plan_id,p_pdf_path,left(btrim(coalesce(p_invoice_number,'')),30),public.pull_invoice_items(p_lines,v_plan.origin_unit),auth.uid())
  on conflict(plan_id) do update set pdf_path=excluded.pdf_path,invoice_number=excluded.invoice_number,
    items=excluded.items,uploaded_by=excluded.uploaded_by,updated_at=now()
  returning * into v_row;
  return v_row;
end;$$;
revoke all on function public.register_pull_plan_invoice(uuid,text,text,jsonb) from public,anon;
grant execute on function public.register_pull_plan_invoice(uuid,text,text,jsonb) to authenticated;

create or replace function public.register_pull_trip_invoice(p_trip_id uuid,p_pdf_path text,p_invoice_number text,p_lines jsonb)
returns public.pull_trip_invoices language plpgsql security definer set search_path=public as $$
declare v_trip public.pull_trips%rowtype; v_row public.pull_trip_invoices%rowtype;
begin
  select * into v_trip from public.pull_trips where id=p_trip_id for update;
  if v_trip.id is null or v_trip.cycle_type<>'PULL'
    or not (v_trip.status='IN_PROGRESS' or (v_trip.status='ARRIVED' and v_trip.nri_status='PENDING'))
    or not public.user_has_unit(v_trip.origin_unit)
    or not (auth.uid() in (v_trip.driver1_id,v_trip.driver2_id) or public.has_permission('NRI_CREATE')
      or public.has_permission('PULL_FAROL') or public.has_permission('PULL_PLAN'))
    then raise exception 'NOTA_PUXADA_SEM_ACESSO'; end if;
  if p_pdf_path is null or p_pdf_path not like (p_trip_id::text||'/'||auth.uid()::text||'/%')
    or p_pdf_path !~ '[.]pdf$' then raise exception 'CAMINHO_NOTA_INVALIDO'; end if;
  if not exists(select 1 from storage.objects where bucket_id='puxada-notas' and name=p_pdf_path) then
    raise exception 'ARQUIVO_NOTA_NAO_ENCONTRADO'; end if;
  insert into public.pull_trip_invoices(trip_id,pdf_path,invoice_number,items,uploaded_by)
  values(p_trip_id,p_pdf_path,left(btrim(coalesce(p_invoice_number,'')),30),public.pull_invoice_items(p_lines,v_trip.origin_unit),auth.uid())
  on conflict(trip_id) do update set pdf_path=excluded.pdf_path,invoice_number=excluded.invoice_number,
    items=excluded.items,uploaded_by=excluded.uploaded_by,updated_at=now()
  returning * into v_row;
  return v_row;
end;$$;
revoke all on function public.register_pull_trip_invoice(uuid,text,text,jsonb) from public,anon;
grant execute on function public.register_pull_trip_invoice(uuid,text,text,jsonb) to authenticated;

create or replace function public.attach_planned_pull_invoice()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='STARTED' and new.trip_id is not null and old.trip_id is distinct from new.trip_id then
    update public.pull_trip_invoices set trip_id=new.trip_id,updated_at=now() where plan_id=new.id;
  end if;
  return new;
end;$$;
drop trigger if exists attach_planned_pull_invoice on public.pull_trip_plans;
create trigger attach_planned_pull_invoice after update of trip_id on public.pull_trip_plans
for each row execute function public.attach_planned_pull_invoice();

commit;
