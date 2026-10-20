-- A última contagem FEFO finalizada de cada unidade alimenta Vendas.
-- Importações manuais seguem disponíveis até a próxima finalização ou correção
-- da contagem mais recente. Contagens antigas nunca são mescladas.
begin;

alter table public.stock_validity_imports
  add column if not exists source_kind text not null default 'MANUAL',
  add column if not exists source_count_id uuid;

alter table public.stock_validity_imports
  drop constraint if exists stock_validity_imports_source_kind_check;
alter table public.stock_validity_imports
  add constraint stock_validity_imports_source_kind_check
  check (source_kind in ('MANUAL','FEFO'));

-- O RPC de importação existente informa o administrador em imported_by.
-- Esse gatilho limpa a origem FEFO quando um arquivo substitui a base.
create or replace function public.mark_stock_validity_manual()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.imported_by is not null then
    new.source_kind:='MANUAL';
    new.source_count_id:=null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_stock_validity_manual_source on public.stock_validity_imports;
create trigger trg_stock_validity_manual_source
before insert or update on public.stock_validity_imports
for each row execute function public.mark_stock_validity_manual();

create or replace function public.sync_stock_validity_from_fefo(p_unit text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_count public.fefo_counts%rowtype;
  v_rows integer;
  v_products integer;
begin
  perform pg_advisory_xact_lock(hashtext('stock_validity:'||p_unit));
  select * into v_count from public.fefo_counts
  where unit=p_unit and status='COMPLETED'
  order by completed_at desc nulls last,id desc limit 1;

  if v_count.id is null then
    -- Só remove a base antiga quando ela vinha da contagem que saiu da unidade.
    if exists(select 1 from public.stock_validity_imports
      where unit=p_unit and source_kind='FEFO') then
      delete from public.stock_validity_rows where unit=p_unit;
      delete from public.stock_validity_imports where unit=p_unit;
    end if;
    return;
  end if;

  delete from public.stock_validity_rows where unit=p_unit;
  insert into public.stock_validity_rows
    (unit,row_no,product_code,product_name,expiry_date,quantity,location,street)
  select p_unit,
    row_number() over(order by i.validity_date,i.product_code,i.id)::integer,
    left(btrim(i.product_code),40),left(btrim(i.product_name),300),
    i.validity_date,null::numeric,'',left(btrim(coalesce(i.street,'')),100)
  from public.fefo_count_items i where i.count_id=v_count.id;

  select count(*),count(distinct product_code) into v_rows,v_products
  from public.stock_validity_rows where unit=p_unit;
  if v_rows=0 then raise exception 'FEFO_CONTAGEM_SEM_ITENS'; end if;

  insert into public.stock_validity_imports
    (unit,file_name,imported_at,imported_by,row_count,product_count,source_kind,source_count_id)
  values(p_unit,'Contagem '||v_count.count_code,now(),null,v_rows,v_products,'FEFO',v_count.id)
  on conflict(unit) do update set file_name=excluded.file_name,
    imported_at=excluded.imported_at,imported_by=null,
    row_count=excluded.row_count,product_count=excluded.product_count,
    source_kind='FEFO',source_count_id=excluded.source_count_id;
end;
$$;
revoke all on function public.sync_stock_validity_from_fefo(text)
  from public,anon,authenticated;

create or replace function public.sync_stock_validity_on_fefo_count()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.status='COMPLETED'
    and (old.unit is distinct from new.unit or new.status<>'COMPLETED')
    and exists(select 1 from public.stock_validity_imports
      where unit=old.unit and source_count_id=old.id) then
    perform public.sync_stock_validity_from_fefo(old.unit);
  end if;
  if new.status='COMPLETED' and (
    exists(select 1 from public.stock_validity_imports
      where unit=new.unit and source_count_id=new.id)
    or new.id=(select id from public.fefo_counts
      where unit=new.unit and status='COMPLETED'
      order by completed_at desc nulls last,id desc limit 1)
  ) then
    perform public.sync_stock_validity_from_fefo(new.unit);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_fefo_count_stock_validity on public.fefo_counts;
create trigger trg_fefo_count_stock_validity
after update of status,unit,completed_at on public.fefo_counts
for each row execute function public.sync_stock_validity_on_fefo_count();

create or replace function public.sync_stock_validity_on_fefo_item()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_count public.fefo_counts%rowtype;
begin
  select * into v_count from public.fefo_counts
  where id=case when tg_op='DELETE' then old.count_id else new.count_id end;
  if v_count.status='COMPLETED' and v_count.id=(select id from public.fefo_counts
    where unit=v_count.unit and status='COMPLETED'
    order by completed_at desc nulls last,id desc limit 1) then
    perform public.sync_stock_validity_from_fefo(v_count.unit);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_fefo_item_stock_validity on public.fefo_count_items;
create trigger trg_fefo_item_stock_validity
after insert or update or delete on public.fefo_count_items
for each row execute function public.sync_stock_validity_on_fefo_item();

-- Primeira publicação, somente das unidades com FEFO concluído. Unidades sem
-- contagem mantêm a base manual existente.
do $$
declare v_unit text;
begin
  for v_unit in select distinct unit from public.fefo_counts where status='COMPLETED'
  loop
    perform public.sync_stock_validity_from_fefo(v_unit);
  end loop;
end;
$$;

-- O canal em tempo real avisa Vendas quando a versão da base muda.
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public'
        and tablename='stock_validity_imports') then
    alter publication supabase_realtime add table public.stock_validity_imports;
  end if;
end;
$$;

commit;
