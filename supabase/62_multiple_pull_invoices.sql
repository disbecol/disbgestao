-- Permite várias notas por plano/ciclo e valida a soma de todos os PDFs no NRI.
begin;

alter table public.pull_trip_invoices drop constraint if exists pull_trip_invoices_trip_id_key;
drop index if exists public.pull_trip_invoices_plan_unique;
create index if not exists pull_trip_invoices_plan on public.pull_trip_invoices(plan_id);

create or replace function public.register_pull_plan_invoice(p_plan_id uuid,p_pdf_path text,p_invoice_number text,p_lines jsonb)
returns public.pull_trip_invoices language plpgsql security definer set search_path=public as $$
declare v_plan public.pull_trip_plans%rowtype; v_row public.pull_trip_invoices%rowtype;
  v_number text:=left(btrim(coalesce(p_invoice_number,'')),30);
begin
  select * into v_plan from public.pull_trip_plans where id=p_plan_id for update;
  if v_plan.id is null or v_plan.cycle_type<>'PULL' or v_plan.status<>'PLANNED'
    or not public.has_permission('PULL_PLAN') or not public.user_has_unit(v_plan.origin_unit)
    then raise exception 'NOTA_PLANO_SEM_ACESSO'; end if;
  if p_pdf_path is null or p_pdf_path not like (p_plan_id::text||'/'||auth.uid()::text||'/%')
    or p_pdf_path !~ '[.]pdf$' then raise exception 'CAMINHO_NOTA_INVALIDO'; end if;
  if not exists(select 1 from storage.objects where bucket_id='puxada-notas' and name=p_pdf_path)
    then raise exception 'ARQUIVO_NOTA_NAO_ENCONTRADO'; end if;
  if v_number<>'' and exists(select 1 from public.pull_trip_invoices
    where plan_id=p_plan_id and upper(invoice_number)=upper(v_number))
    then raise exception 'NOTA_JA_ANEXADA'; end if;
  insert into public.pull_trip_invoices(plan_id,pdf_path,invoice_number,items,uploaded_by)
  values(p_plan_id,p_pdf_path,v_number,public.pull_invoice_items(p_lines,v_plan.origin_unit),auth.uid())
  returning * into v_row;
  return v_row;
end;$$;
revoke all on function public.register_pull_plan_invoice(uuid,text,text,jsonb) from public,anon;
grant execute on function public.register_pull_plan_invoice(uuid,text,text,jsonb) to authenticated;

create or replace function public.register_pull_trip_invoice(p_trip_id uuid,p_pdf_path text,p_invoice_number text,p_lines jsonb)
returns public.pull_trip_invoices language plpgsql security definer set search_path=public as $$
declare v_trip public.pull_trips%rowtype; v_row public.pull_trip_invoices%rowtype;
  v_number text:=left(btrim(coalesce(p_invoice_number,'')),30);
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
  if not exists(select 1 from storage.objects where bucket_id='puxada-notas' and name=p_pdf_path)
    then raise exception 'ARQUIVO_NOTA_NAO_ENCONTRADO'; end if;
  if v_number<>'' and exists(select 1 from public.pull_trip_invoices
    where trip_id=p_trip_id and upper(invoice_number)=upper(v_number))
    then raise exception 'NOTA_JA_ANEXADA'; end if;
  insert into public.pull_trip_invoices(trip_id,pdf_path,invoice_number,items,uploaded_by)
  values(p_trip_id,p_pdf_path,v_number,public.pull_invoice_items(p_lines,v_trip.origin_unit),auth.uid())
  returning * into v_row;
  return v_row;
end;$$;
revoke all on function public.register_pull_trip_invoice(uuid,text,text,jsonb) from public,anon;
grant execute on function public.register_pull_trip_invoice(uuid,text,text,jsonb) to authenticated;

drop function if exists public.delete_pull_invoice(uuid,uuid);
create or replace function public.delete_pull_invoice(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_trip public.pull_trips%rowtype; v_plan public.pull_trip_plans%rowtype;
  v_note public.pull_trip_invoices%rowtype;
begin
  select * into v_note from public.pull_trip_invoices where id=p_invoice_id for update;
  if v_note.id is null then raise exception 'NOTA_NAO_ENCONTRADA'; end if;
  if v_note.trip_id is not null then
    select * into v_trip from public.pull_trips where id=v_note.trip_id for update;
    if v_trip.id is null or v_trip.cycle_type<>'PULL'
      or not (v_trip.status='IN_PROGRESS' or (v_trip.status='ARRIVED' and v_trip.nri_status='PENDING'))
      or not public.user_has_unit(v_trip.origin_unit)
      or not (auth.uid() in (v_trip.driver1_id,v_trip.driver2_id) or public.has_permission('NRI_CREATE')
        or public.has_permission('PULL_FAROL') or public.has_permission('PULL_PLAN'))
      then raise exception 'NOTA_PUXADA_SEM_ACESSO'; end if;
  else
    select * into v_plan from public.pull_trip_plans where id=v_note.plan_id for update;
    if v_plan.id is null or v_plan.cycle_type<>'PULL' or v_plan.status<>'PLANNED'
      or not public.has_permission('PULL_PLAN') or not public.user_has_unit(v_plan.origin_unit)
      then raise exception 'NOTA_PLANO_SEM_ACESSO'; end if;
  end if;
  delete from public.pull_trip_invoices where id=v_note.id;
  return jsonb_build_object('pdf_path',v_note.pdf_path,'invoice_number',v_note.invoice_number);
end;$$;
revoke all on function public.delete_pull_invoice(uuid) from public,anon;
grant execute on function public.delete_pull_invoice(uuid) to authenticated;

create or replace function public.validate_pull_invoice_nris()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.nri_status<>'COMPLETED' or old.nri_status='COMPLETED' then return new; end if;
  if not exists(select 1 from public.pull_trip_invoices where trip_id=new.id) then return new; end if;
  if not exists(select 1 from public.nri_requests where pull_trip_id=new.id) then return new; end if;
  if exists(
    with expected as (
      select x->>'product_code' as code,sum((x->>'quantity')::numeric) as qty
      from public.pull_trip_invoices i cross join lateral jsonb_array_elements(i.items) x
      where i.trip_id=new.id group by x->>'product_code'
    ),actual as (
      select n.product_code as code,sum(n.quantity) as qty
      from public.nris n join public.nri_requests r on r.id=n.request_id
      where r.pull_trip_id=new.id group by n.product_code
    )
    select 1 from expected e full join actual a using(code) where e.qty is distinct from a.qty
  ) then raise exception 'NRI_NOTA_QUANTIDADE_DIVERGENTE'; end if;
  if exists(select 1 from public.nris n join public.nri_requests r on r.id=n.request_id
    where r.pull_trip_id=new.id and btrim(coalesce(n.lot,''))='')
    then raise exception 'NRI_NOTA_LOTE_OBRIGATORIO'; end if;
  return new;
end;$$;

commit;
