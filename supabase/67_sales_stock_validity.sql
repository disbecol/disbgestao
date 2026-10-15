-- Vendas > Validade do Estoque. Execute depois do SQL 66.
-- Cada importacao substitui, numa unica transacao, apenas a unidade escolhida.
begin;

insert into public.permissions(code,module,name,description,sort_order,active) values
  ('SALES_STOCK_VALIDITY_VIEW','Validade do Estoque','Consultar validades','Consultar a validade mais proxima dos produtos da unidade autorizada.',10,true),
  ('SALES_STOCK_VALIDITY_IMPORT','Validade do Estoque','Importar arquivo','Substituir o estoque de validades de uma unidade por CSV ou XLSX.',20,true)
on conflict(code) do update set module=excluded.module,name=excluded.name,
  description=excluded.description,sort_order=excluded.sort_order,active=true;

insert into public.role_permissions(role,permission_code) values
  ('ADMIN','SALES_STOCK_VALIDITY_VIEW'),('ADMIN','SALES_STOCK_VALIDITY_IMPORT'),
  ('VENDEDOR','SALES_STOCK_VALIDITY_VIEW'),
  ('GERENTE_VENDAS','SALES_STOCK_VALIDITY_VIEW')
on conflict do nothing;

alter table public.module_settings drop constraint if exists module_settings_name_valid;
alter table public.module_settings add constraint module_settings_name_valid check (module_name in (
  'NRI','Conferência','Contagem FEFO','Ativo de Giro','Materiais','Refugo',
  'Avarias de Entrega','Avarias de Vendas','Validade do Estoque','Puxada'
));
insert into public.module_settings(module_name,active) values ('Validade do Estoque',true)
on conflict(module_name) do nothing;

create table if not exists public.stock_validity_imports (
  unit text primary key references public.units(name) on update cascade on delete restrict,
  file_name text not null,
  imported_at timestamptz not null default now(),
  imported_by uuid references public.profiles(id),
  row_count integer not null check (row_count>0),
  product_count integer not null check (product_count>0)
);

create table if not exists public.stock_validity_rows (
  unit text not null references public.units(name) on update cascade on delete restrict,
  row_no integer not null check (row_no>0),
  product_code text not null check (length(btrim(product_code)) between 1 and 40),
  product_name text not null check (length(btrim(product_name)) between 1 and 300),
  expiry_date date not null,
  quantity numeric(14,3) check (quantity is null or quantity>=0),
  location text not null default '',
  street text not null default '',
  primary key(unit,row_no)
);
create index if not exists idx_stock_validity_unit_product
  on public.stock_validity_rows(unit,product_code,expiry_date);

alter table public.stock_validity_imports enable row level security;
alter table public.stock_validity_rows enable row level security;

drop policy if exists stock_validity_imports_read on public.stock_validity_imports;
create policy stock_validity_imports_read on public.stock_validity_imports
for select to authenticated using (
  public.has_permission('SALES_STOCK_VALIDITY_VIEW') and public.user_has_unit(unit)
);
drop policy if exists stock_validity_rows_read on public.stock_validity_rows;
create policy stock_validity_rows_read on public.stock_validity_rows
for select to authenticated using (
  public.has_permission('SALES_STOCK_VALIDITY_VIEW') and public.user_has_unit(unit)
);

revoke all on public.stock_validity_imports,public.stock_validity_rows from anon,authenticated;
grant select on public.stock_validity_imports,public.stock_validity_rows to authenticated;

create or replace function public.replace_stock_validity(
  p_unit text,p_file_name text,p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_unit text:=btrim(coalesce(p_unit,''));
  v_file text:=btrim(coalesce(p_file_name,''));
  v_count integer;
  v_products integer;
begin
  -- Mesmo que uma permissao seja atribuida manualmente, so ADMIN importa.
  if not public.is_admin() or not public.has_permission('SALES_STOCK_VALIDITY_IMPORT') then
    raise exception 'FORBIDDEN';
  end if;
  if not public.user_has_unit(v_unit) then raise exception 'UNIDADE_SEM_ACESSO'; end if;
  if length(v_file) not between 1 and 200 then raise exception 'ARQUIVO_INVALIDO'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'LINHAS_INVALIDAS'; end if;
  v_count:=jsonb_array_length(p_rows);
  if v_count<1 or v_count>20000 then raise exception 'QUANTIDADE_LINHAS_INVALIDA'; end if;
  if pg_column_size(p_rows)>8000000 then raise exception 'ARQUIVO_MUITO_GRANDE'; end if;

  if exists(
    select 1 from jsonb_array_elements(p_rows) as e(value)
    where jsonb_typeof(e.value) is distinct from 'object'
      or length(btrim(coalesce(e.value->>'product_code',''))) not between 1 and 40
      or length(btrim(coalesce(e.value->>'product_name',''))) not between 1 and 300
      or coalesce(e.value->>'expiry_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (e.value->>'quantity' is not null and e.value->>'quantity' !~ '^[0-9]{1,11}(\.[0-9]{1,3})?$')
      or length(coalesce(e.value->>'location',''))>100
      or length(coalesce(e.value->>'street',''))>100
  ) then raise exception 'LINHA_INVALIDA'; end if;

  -- Serializa duas importacoes simultaneas da mesma unidade.
  perform pg_advisory_xact_lock(hashtext('stock_validity:'||v_unit));
  delete from public.stock_validity_rows where unit=v_unit;
  insert into public.stock_validity_rows(
    unit,row_no,product_code,product_name,expiry_date,quantity,location,street
  )
  select v_unit,e.ordinality::integer,btrim(e.value->>'product_code'),
    btrim(e.value->>'product_name'),(e.value->>'expiry_date')::date,
    (e.value->>'quantity')::numeric,
    btrim(coalesce(e.value->>'location','')),
    btrim(coalesce(e.value->>'street',''))
  from jsonb_array_elements(p_rows) with ordinality as e(value,ordinality);

  select count(distinct product_code) into v_products
  from public.stock_validity_rows where unit=v_unit;
  insert into public.stock_validity_imports(unit,file_name,imported_at,imported_by,row_count,product_count)
  values(v_unit,v_file,now(),auth.uid(),v_count,v_products)
  on conflict(unit) do update set file_name=excluded.file_name,imported_at=excluded.imported_at,
    imported_by=excluded.imported_by,row_count=excluded.row_count,product_count=excluded.product_count;
  return jsonb_build_object('unit',v_unit,'row_count',v_count,'product_count',v_products);
end;
$$;
revoke all on function public.replace_stock_validity(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.replace_stock_validity(text,text,jsonb) to authenticated;

commit;
