-- Correcoes de contagens FEFO finalizadas. Independente da migracao 70.
begin;

create table if not exists public.fefo_completed_edits (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.fefo_counts(id) on delete cascade,
  item_id uuid,
  target text not null check (target in ('HEADER','ITEM')),
  action text not null check (action in ('UPDATE','ADD','DELETE')),
  before_data jsonb,
  after_data jsonb,
  reason text not null check (length(btrim(reason)) between 5 and 500),
  edited_by uuid not null references public.profiles(id),
  edited_at timestamptz not null default now()
);
create index if not exists idx_fefo_completed_edits_count on public.fefo_completed_edits(count_id,edited_at desc);
alter table public.fefo_completed_edits enable row level security;
drop policy if exists fefo_completed_edits_admin_read on public.fefo_completed_edits;
create policy fefo_completed_edits_admin_read on public.fefo_completed_edits
  for select to authenticated using (
    public.is_admin() and exists (
      select 1 from public.fefo_counts c
      where c.id=count_id and public.user_has_unit(c.unit)
    )
  );
revoke all on public.fefo_completed_edits from public,anon,authenticated;
grant select on public.fefo_completed_edits to authenticated;

create or replace function public.edit_completed_fefo_header_v2(
  p_count_id uuid, p_unit text, p_counter_id uuid,
  p_started_at timestamptz, p_completed_at timestamptz, p_reason text
) returns public.fefo_counts language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_count public.fefo_counts%rowtype;
  v_after public.fefo_counts%rowtype;
  v_profile public.profiles%rowtype;
  v_unit text:=btrim(coalesce(p_unit,''));
  v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.is_admin() or not public.has_permission('FEFO_REPORT') then raise exception 'FORBIDDEN'; end if;
  select * into v_count from public.fefo_counts where id=p_count_id for update;
  if v_count.id is null or v_count.status<>'COMPLETED' then raise exception 'FEFO_CONTAGEM_NAO_FINALIZADA'; end if;
  if not public.user_has_unit(v_count.unit) or not public.user_has_unit(v_unit) then raise exception 'UNIDADE_SEM_ACESSO'; end if;
  if length(v_reason) not between 5 and 500 then raise exception 'JUSTIFICATIVA_OBRIGATORIA'; end if;
  if not exists(select 1 from public.units where name=v_unit and active=true) then raise exception 'UNIDADE_INVALIDA'; end if;
  select * into v_profile from public.profiles where id=p_counter_id;
  if v_profile.id is null then raise exception 'RESPONSAVEL_INVALIDO'; end if;
  if p_started_at is null or p_completed_at is null or p_started_at>p_completed_at
     or p_completed_at>now()+interval '1 day' then raise exception 'PERIODO_INVALIDO'; end if;
  update public.fefo_counts set unit=v_unit,counter_id=v_profile.id,
    counter_username=v_profile.username,counter_name=v_profile.name,
    started_at=p_started_at,completed_at=p_completed_at
  where id=v_count.id returning * into v_after;
  if (v_count.unit,v_count.counter_id,v_count.started_at,v_count.completed_at)
     is distinct from (v_after.unit,v_after.counter_id,v_after.started_at,v_after.completed_at) then
    insert into public.fefo_completed_edits(count_id,target,action,before_data,after_data,reason,edited_by)
    values(v_count.id,'HEADER','UPDATE',to_jsonb(v_count),to_jsonb(v_after),v_reason,auth.uid());
  end if;
  return v_after;
end;
$$;
revoke all on function public.edit_completed_fefo_header_v2(uuid,text,uuid,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.edit_completed_fefo_header_v2(uuid,text,uuid,timestamptz,timestamptz,text) to authenticated;

create or replace function public.edit_completed_fefo_item_v2(
  p_count_id uuid,p_action text,p_item_id uuid,p_product_code text,
  p_validity_date date,p_lot text,p_street text,p_pallet integer,p_layer integer,
  p_box integer,p_loose_unit integer,p_reason text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_count public.fefo_counts%rowtype;
  v_item public.fefo_count_items%rowtype;
  v_product public.products%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_action text:=upper(btrim(coalesce(p_action,'')));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_code text:=btrim(coalesce(p_product_code,''));
begin
  if not public.is_admin() or not public.has_permission('FEFO_REPORT') then raise exception 'FORBIDDEN'; end if;
  select * into v_count from public.fefo_counts where id=p_count_id for update;
  if v_count.id is null or v_count.status<>'COMPLETED' then raise exception 'FEFO_CONTAGEM_NAO_FINALIZADA'; end if;
  if not public.user_has_unit(v_count.unit) then raise exception 'UNIDADE_SEM_ACESSO'; end if;
  if length(v_reason) not between 5 and 500 then raise exception 'JUSTIFICATIVA_OBRIGATORIA'; end if;
  if v_action not in ('ADD','UPDATE','DELETE') then raise exception 'ACAO_INVALIDA'; end if;
  if v_action in ('UPDATE','DELETE') then
    select * into v_item from public.fefo_count_items where id=p_item_id and count_id=v_count.id for update;
    if v_item.id is null then raise exception 'FEFO_ITEM_NAO_ENCONTRADO'; end if;
    v_before:=to_jsonb(v_item);
  end if;
  if v_action='DELETE' then
    if (select count(*) from public.fefo_count_items where count_id=v_count.id)<=1 then
      raise exception 'FEFO_CONTAGEM_SEM_ITENS';
    end if;
    delete from public.fefo_count_items where id=v_item.id;
  else
    if p_validity_date is null then raise exception 'FEFO_VALIDADE_OBRIGATORIA'; end if;
    if length(coalesce(p_lot,''))>120 or length(coalesce(p_street,''))>100 then raise exception 'CAMPO_LONGO'; end if;
    if p_pallet is null or p_layer is null or p_box is null or p_loose_unit is null
       or least(p_pallet,p_layer,p_box,p_loose_unit)<0 then raise exception 'QUANTIDADE_INVALIDA'; end if;
    if v_action='UPDATE' and v_code=v_item.product_code then
      -- Preserva produto historico mesmo se foi desativado no cadastro.
      v_product.code:=v_item.product_code;
      v_product.name:=v_item.product_name;
    else
      select * into v_product from public.products
      where active=true and (code=v_code or ltrim(code,'0')=ltrim(v_code,'0'))
      order by case when code=v_code then 0 else 1 end limit 1;
      if v_product.code is null then raise exception 'FEFO_PRODUTO_NAO_CADASTRADO'; end if;
    end if;
    if v_action='ADD' then
      insert into public.fefo_count_items(count_id,product_code,product_name,validity_date,lot,street,
        pallet,layer,box,loose_unit,created_by,created_by_name)
      values(v_count.id,v_product.code,v_product.name,p_validity_date,btrim(coalesce(p_lot,'')),
        btrim(coalesce(p_street,'')),p_pallet,p_layer,p_box,p_loose_unit,auth.uid(),
        (select name from public.profiles where id=auth.uid())) returning * into v_item;
    else
      update public.fefo_count_items set product_code=v_product.code,product_name=v_product.name,
        validity_date=p_validity_date,lot=btrim(coalesce(p_lot,'')),street=btrim(coalesce(p_street,'')),
        pallet=p_pallet,layer=p_layer,box=p_box,loose_unit=p_loose_unit
      where id=v_item.id returning * into v_item;
    end if;
    v_after:=to_jsonb(v_item);
  end if;
  insert into public.fefo_completed_edits(count_id,item_id,target,action,before_data,after_data,reason,edited_by)
  values(v_count.id,v_item.id,'ITEM',v_action,v_before,v_after,v_reason,auth.uid());
  return v_item.id;
end;
$$;
revoke all on function public.edit_completed_fefo_item_v2(uuid,text,uuid,text,date,text,text,integer,integer,integer,integer,text) from public,anon,authenticated;
grant execute on function public.edit_completed_fefo_item_v2(uuid,text,uuid,text,date,text,text,integer,integer,integer,integer,text) to authenticated;

notify pgrst, 'reload schema';
commit;
