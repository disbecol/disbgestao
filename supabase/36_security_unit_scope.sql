-- Corrige acessos que contornavam o escopo de unidade das policies RLS.
-- Executar depois de 35_v1_7_1_materiais.sql.

begin;

-- As RPCs de aprovacao sao SECURITY DEFINER. O gatilho aplica o mesmo
-- limite de unidade mesmo quando a atualizacao contorna RLS.
create or replace function public.enforce_damage_item_unit_access()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_request_id uuid;
  v_unit text;
begin
  if tg_op='DELETE' then
    v_request_id := old.request_id;
  else
    v_request_id := new.request_id;
  end if;

  -- Operacoes de manutencao executadas sem JWT pelo service_role.
  if auth.uid() is null then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name='damage_items' then
    select r.unit into v_unit
    from public.damage_requests r where r.id=v_request_id;
  elsif tg_table_name='sales_damage_items' then
    select r.unit into v_unit
    from public.sales_damage_requests r where r.id=v_request_id;
  else
    raise exception 'TABELA_AVARIA_INVALIDA';
  end if;

  if v_unit is null or not public.user_has_unit(v_unit) then
    raise exception 'UNIDADE_SEM_ACESSO';
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_damage_item_unit_access on public.damage_items;
create trigger trg_damage_item_unit_access
before insert or update or delete on public.damage_items
for each row execute function public.enforce_damage_item_unit_access();

drop trigger if exists trg_sales_damage_item_unit_access on public.sales_damage_items;
create trigger trg_sales_damage_item_unit_access
before insert or update or delete on public.sales_damage_items
for each row execute function public.enforce_damage_item_unit_access();

-- Storage recebe fotos antes da RPC criar a solicitacao. Arquivos ainda nao
-- vinculados podem ser lidos apenas pelo dono da pasta. Depois do vinculo,
-- toda leitura, edicao e exclusao exige acesso a unidade da solicitacao.
create or replace function public.storage_damage_in_my_unit(
  p_bucket text,
  p_name text,
  p_allow_unlinked boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_unit text;
begin
  if auth.uid() is null then return false; end if;

  if p_bucket='avarias' then
    select r.unit into v_unit from public.damage_requests r
    where r.signature_path=p_name limit 1;
    if found then return public.user_has_unit(v_unit); end if;

    select r.unit into v_unit from public.damage_items i
    join public.damage_requests r on r.id=i.request_id
    where i.photo_path=p_name limit 1;
    if found then return public.user_has_unit(v_unit); end if;

    select r.unit into v_unit from public.damage_item_photos ph
    join public.damage_items i on i.id=ph.item_id
    join public.damage_requests r on r.id=i.request_id
    where ph.photo_path=p_name limit 1;
    if found then return public.user_has_unit(v_unit); end if;

  elsif p_bucket='avarias-vendas' then
    select r.unit into v_unit from public.sales_damage_items i
    join public.sales_damage_requests r on r.id=i.request_id
    where i.photo_path=p_name limit 1;
    if found then return public.user_has_unit(v_unit); end if;

    select r.unit into v_unit from public.sales_damage_item_photos ph
    join public.sales_damage_items i on i.id=ph.item_id
    join public.sales_damage_requests r on r.id=i.request_id
    where ph.photo_path=p_name limit 1;
    if found then return public.user_has_unit(v_unit); end if;

  elsif p_bucket='nri-avarias' then
    select r.unit into v_unit from public.nri_damage_photos ph
    join public.nri_damage_items i on i.id=ph.damage_item_id
    join public.nri_requests r on r.id=i.request_id
    where ph.photo_path=p_name limit 1;
    if found then return public.user_has_unit(v_unit); end if;
  else
    return false;
  end if;

  return coalesce(p_allow_unlinked,false);
end;
$$;

revoke all on function public.storage_damage_in_my_unit(text,text,boolean) from public,anon;
grant execute on function public.storage_damage_in_my_unit(text,text,boolean) to authenticated;

create index if not exists idx_damage_requests_signature_path
  on public.damage_requests(signature_path);
create index if not exists idx_damage_items_photo_path
  on public.damage_items(photo_path);
create index if not exists idx_damage_item_photos_photo_path
  on public.damage_item_photos(photo_path);
create index if not exists idx_sales_damage_items_photo_path
  on public.sales_damage_items(photo_path);
create index if not exists idx_sales_damage_item_photos_photo_path
  on public.sales_damage_item_photos(photo_path);
create index if not exists idx_nri_damage_photos_photo_path
  on public.nri_damage_photos(photo_path);

drop policy if exists "avarias_read_own_or_admin" on storage.objects;
create policy "avarias_read_own_or_admin" on storage.objects for select to authenticated
using (bucket_id='avarias' and (
  (public.has_permission('DELIVERY_DAMAGE_CREATE')
    and (storage.foldername(name))[1]=auth.uid()::text
    and public.storage_damage_in_my_unit(bucket_id,name,true))
  or ((public.has_permission('DELIVERY_DAMAGE_VIEW_ALL')
       or public.has_permission('DELIVERY_DAMAGE_REVIEW')
       or public.has_permission('DELIVERY_DAMAGE_POST'))
      and public.storage_damage_in_my_unit(bucket_id,name,false))
));

drop policy if exists "avarias_update_own_or_admin" on storage.objects;
create policy "avarias_update_own_or_admin" on storage.objects for update to authenticated
using (bucket_id='avarias' and (
  (public.has_permission('DELIVERY_DAMAGE_CREATE')
    and (storage.foldername(name))[1]=auth.uid()::text
    and public.storage_damage_in_my_unit(bucket_id,name,true))
  or (public.has_permission('DELIVERY_DAMAGE_REVIEW')
      and public.storage_damage_in_my_unit(bucket_id,name,false))
))
with check (bucket_id='avarias' and (
  (public.has_permission('DELIVERY_DAMAGE_CREATE')
    and (storage.foldername(name))[1]=auth.uid()::text
    and public.storage_damage_in_my_unit(bucket_id,name,true))
  or (public.has_permission('DELIVERY_DAMAGE_REVIEW')
      and public.storage_damage_in_my_unit(bucket_id,name,false))
));

drop policy if exists "avarias_delete_own_or_admin" on storage.objects;
create policy "avarias_delete_own_or_admin" on storage.objects for delete to authenticated
using (bucket_id='avarias' and (
  (public.has_permission('DELIVERY_DAMAGE_CREATE')
    and (storage.foldername(name))[1]=auth.uid()::text
    and public.storage_damage_in_my_unit(bucket_id,name,true))
  or (public.has_permission('DELIVERY_DAMAGE_REVIEW')
      and public.storage_damage_in_my_unit(bucket_id,name,false))
));

drop policy if exists sales_damage_read on storage.objects;
create policy sales_damage_read on storage.objects for select to authenticated
using (bucket_id='avarias-vendas' and (
  ((storage.foldername(name))[1]=auth.uid()::text
    and public.has_permission('SALES_DAMAGE_CREATE')
    and public.storage_damage_in_my_unit(bucket_id,name,true))
  or ((public.has_permission('SALES_DAMAGE_VIEW_ALL')
       or public.has_permission('SALES_DAMAGE_REVIEW')
       or public.has_permission('SALES_DAMAGE_OVERRIDE')
       or public.has_permission('SALES_DAMAGE_POST'))
      and public.storage_damage_in_my_unit(bucket_id,name,false))
));

drop policy if exists sales_damage_delete_own on storage.objects;
create policy sales_damage_delete_own on storage.objects for delete to authenticated
using (bucket_id='avarias-vendas'
  and public.has_permission('SALES_DAMAGE_CREATE')
  and (storage.foldername(name))[1]=auth.uid()::text
  and public.storage_damage_in_my_unit(bucket_id,name,true));

drop policy if exists "nri_avarias_read_nri_roles" on storage.objects;
create policy "nri_avarias_read_nri_roles" on storage.objects for select to authenticated
using (bucket_id='nri-avarias' and (
  (public.has_permission('NRI_CREATE')
    and (storage.foldername(name))[1]=auth.uid()::text
    and public.storage_damage_in_my_unit(bucket_id,name,true))
  or ((public.has_permission('NRI_CREATE')
       or public.has_permission('NRI_PENDING_VIEW')
       or public.has_permission('NRI_PRINT')
       or public.has_permission('NRI_HISTORY')
       or public.has_permission('NRI_DAMAGE_HISTORY'))
      and public.storage_damage_in_my_unit(bucket_id,name,false))
));

drop policy if exists "nri_avarias_delete_own_or_admin" on storage.objects;
create policy "nri_avarias_delete_own_or_admin" on storage.objects for delete to authenticated
using (bucket_id='nri-avarias'
  and public.has_permission('NRI_CREATE')
  and (storage.foldername(name))[1]=auth.uid()::text
  and public.storage_damage_in_my_unit(bucket_id,name,true));

-- O cliente pode desativar seu proprio dispositivo mesmo depois de perder
-- acesso a unidade. Dispositivos ativos exigem vinculo atual com a unidade.
drop policy if exists push_devices_insert_own on public.push_devices;
create policy push_devices_insert_own on public.push_devices for insert to authenticated
with check (user_id=auth.uid() and public.user_has_unit(unit));

drop policy if exists push_devices_update_own on public.push_devices;
create policy push_devices_update_own on public.push_devices for update to authenticated
using (user_id=auth.uid())
with check (user_id=auth.uid() and (active=false or public.user_has_unit(unit)));

grant select on public.user_units to service_role;

-- A busca de lotes usa SECURITY DEFINER e deve validar a unidade do pedido.
create or replace function public.get_sales_damage_lot_matches(p_request_id uuid)
returns table(
  item_id uuid,
  nri text,
  validity_date date,
  product_code text,
  product_name text,
  lot text
)
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_req public.sales_damage_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;

  select * into v_req from public.sales_damage_requests where id=p_request_id;
  if v_req.id is null then raise exception 'SOLICITACAO_NAO_ENCONTRADA'; end if;
  if not public.user_has_unit(v_req.unit) then raise exception 'UNIDADE_SEM_ACESSO'; end if;

  if not (
    (v_req.seller_id=auth.uid() and public.has_permission('SALES_DAMAGE_VIEW_OWN'))
    or public.has_permission('SALES_DAMAGE_VIEW_ALL')
    or public.has_permission('SALES_DAMAGE_REVIEW')
    or public.has_permission('SALES_DAMAGE_OVERRIDE')
    or public.has_permission('SALES_DAMAGE_POST')
  ) then raise exception 'FORBIDDEN'; end if;

  return query
  select i.id,n.nri,n.validity_date,n.product_code,n.product_name,
    upper(regexp_replace(lot_piece.value,'[^A-Za-z0-9]','','g')) as lot
  from public.sales_damage_items i
  join public.nris n
    on n.unit=v_req.unit
   and btrim(coalesce(n.product_code,''))=btrim(coalesce(i.product_code,''))
  cross join lateral regexp_split_to_table(
    coalesce(n.lot,''), E'[[:space:]]+[-–—][[:space:]]+|[,;|\\n]+'
  ) as lot_piece(value)
  where i.request_id=p_request_id
    and upper(btrim(coalesce(i.reason,'')))='VALIDADE'
    and btrim(coalesce(i.product_code,''))<>''
    and btrim(coalesce(i.lot,''))<>''
    and upper(regexp_replace(lot_piece.value,'[^A-Za-z0-9]','','g'))
        = upper(regexp_replace(i.lot,'[^A-Za-z0-9]','','g'))
  order by i.item_order,n.created_at desc,n.nri;
end;
$$;

commit;
