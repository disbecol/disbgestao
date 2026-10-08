-- Desvincula NF incorreta antes da emissao dos NRIs e libera a limpeza do PDF privado.
begin;

create or replace function public.delete_pull_invoice(p_trip_id uuid default null,p_plan_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_trip public.pull_trips%rowtype; v_plan public.pull_trip_plans%rowtype;
  v_note public.pull_trip_invoices%rowtype;
begin
  if (p_trip_id is null)=(p_plan_id is null) then raise exception 'NOTA_DESTINO_INVALIDO'; end if;
  if p_plan_id is not null then
    select * into v_plan from public.pull_trip_plans where id=p_plan_id for update;
    if v_plan.id is null or v_plan.cycle_type<>'PULL' or v_plan.status<>'PLANNED'
      or not public.has_permission('PULL_PLAN') or not public.user_has_unit(v_plan.origin_unit)
      then raise exception 'NOTA_PLANO_SEM_ACESSO'; end if;
    select * into v_note from public.pull_trip_invoices where plan_id=p_plan_id for update;
  else
    select * into v_trip from public.pull_trips where id=p_trip_id for update;
    if v_trip.id is null or v_trip.cycle_type<>'PULL'
      or not (v_trip.status='IN_PROGRESS' or (v_trip.status='ARRIVED' and v_trip.nri_status='PENDING'))
      or not public.user_has_unit(v_trip.origin_unit)
      or not (auth.uid() in (v_trip.driver1_id,v_trip.driver2_id) or public.has_permission('NRI_CREATE')
        or public.has_permission('PULL_FAROL') or public.has_permission('PULL_PLAN'))
      then raise exception 'NOTA_PUXADA_SEM_ACESSO'; end if;
    select * into v_note from public.pull_trip_invoices where trip_id=p_trip_id for update;
  end if;
  if v_note.id is null then raise exception 'NOTA_NAO_ENCONTRADA'; end if;
  delete from public.pull_trip_invoices where id=v_note.id;
  return jsonb_build_object('pdf_path',v_note.pdf_path,'invoice_number',v_note.invoice_number);
end;$$;
revoke all on function public.delete_pull_invoice(uuid,uuid) from public,anon;
grant execute on function public.delete_pull_invoice(uuid,uuid) to authenticated;

drop policy if exists pull_invoice_orphan_delete on storage.objects;
create policy pull_invoice_orphan_delete on storage.objects for delete to authenticated using (
  bucket_id='puxada-notas' and not exists(select 1 from public.pull_trip_invoices n where n.pdf_path=name)
  and ((storage.foldername(name))[2]=auth.uid()::text
    or exists(select 1 from public.pull_trips t where t.id::text=(storage.foldername(name))[1]
      and public.user_has_unit(t.origin_unit) and t.cycle_type='PULL'
      and (auth.uid() in (t.driver1_id,t.driver2_id) or public.has_permission('NRI_CREATE')
        or public.has_permission('PULL_FAROL') or public.has_permission('PULL_PLAN')))
    or exists(select 1 from public.pull_trip_plans p where p.id::text=(storage.foldername(name))[1]
      and public.user_has_unit(p.origin_unit) and p.cycle_type='PULL'
      and public.has_permission('PULL_PLAN')))
);

commit;
