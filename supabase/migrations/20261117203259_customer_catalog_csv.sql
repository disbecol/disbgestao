-- Catálogo por código e filial; preserva IDs, coordenadas e vínculos existentes.
begin;
alter table public.customers add column if not exists registration_date date;
do $$begin
 if exists(select 1 from pg_constraint where conrelid='public.customers'::regclass and conname='customers_pkey' and pg_get_constraintdef(oid)='PRIMARY KEY (code)') then
  alter table public.customers drop constraint customers_pkey;
  alter table public.customers add constraint customers_pkey primary key(code,branch);
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.customers'::regclass and contype in('p','u') and conkey=array[(select attnum from pg_attribute where attrelid='public.customers'::regclass and attname='code'),(select attnum from pg_attribute where attrelid='public.customers'::regclass and attname='branch')]::smallint[]) then
  alter table public.customers add constraint customers_code_branch_import_unique unique(code,branch);
 end if;
end$$;

create or replace function public.import_customer_catalog(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare n integer;result jsonb;begin
 if auth.uid() is null or not public.has_permission('ADMIN_BASES') or not exists(select 1 from public.profiles where id=auth.uid() and active) then raise exception 'FORBIDDEN';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 20000 or octet_length(p_rows::text)>10000000 then raise exception 'CUSTOMER_IMPORT_INVALID';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) value where jsonb_typeof(value)<>'object') then raise exception 'CUSTOMER_IMPORT_INVALID';end if;
 if exists(select 1 from jsonb_to_recordset(p_rows) x(code text,name text,city text,branch text,registration_date text)
  where coalesce(x.code,'')!~'^[0-9]{1,40}$' or length(btrim(coalesce(x.name,''))) not between 1 and 300
   or length(coalesce(x.city,''))>200 or x.name~'[[:cntrl:]]' or x.city~'[[:cntrl:]]' or x.name like '%'||chr(65533)||'%' or x.city like '%'||chr(65533)||'%'
   or (x.registration_date is not null and (x.registration_date!~'^\d{4}-\d{2}-\d{2}$' or x.registration_date::date not between date '1900-01-01' and date '2200-12-31'))
   or coalesce(x.branch,'') not in ('Caicó','Pau dos Ferros')) then raise exception 'CUSTOMER_IMPORT_INVALID';end if;
 if exists(select 1 from jsonb_to_recordset(p_rows) x(code text,branch text) group by code,branch having count(*)>1) then raise exception 'CUSTOMER_IMPORT_DUPLICATE';end if;
 if exists(select 1 from jsonb_to_recordset(p_rows) x(branch text) where not public.user_has_unit(case x.branch when 'Caicó' then 'Matriz Caicó' else 'Filial Pau dos Ferros' end)) then raise exception 'CUSTOMER_IMPORT_UNIT_FORBIDDEN';end if;
 n=jsonb_array_length(p_rows);
 perform pg_advisory_xact_lock(hashtextextended('customer-catalog-import',0));
 with updated as (
  insert into public.customers(code,name,city,branch,registration_date)
   select code,btrim(name),btrim(coalesce(city,'')),branch,registration_date::date from jsonb_to_recordset(p_rows) x(code text,name text,city text,branch text,registration_date text)
  on conflict(code,branch) do update set name=excluded.name,city=coalesce(nullif(excluded.city,''),customers.city),registration_date=coalesce(excluded.registration_date,customers.registration_date),updated_at=now()
   where customers.name is distinct from excluded.name or customers.city is distinct from coalesce(nullif(excluded.city,''),customers.city) or customers.registration_date is distinct from coalesce(excluded.registration_date,customers.registration_date)
  returning (xmax=0) inserted,branch
 ) select jsonb_build_object('received',n,'inserted',count(*) filter(where inserted),'updated',count(*) filter(where not inserted),'unchanged',n-count(*)) into result from updated;
 return result;
end$$;
revoke all on function public.import_customer_catalog(jsonb) from public,anon;
grant execute on function public.import_customer_catalog(jsonb) to authenticated;
do $$begin if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='public.returns_enrich(text,jsonb)'::regprocedure)<>'3916a8ec83dc204cbcb11f4dac42f256' then raise exception 'RETURNS_SOURCE_CHANGED';end if;end$$;
create or replace function public.returns_enrich(p_unit text,p_data jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c jsonb;b jsonb;j jsonb;m jsonb;a jsonb;o jsonb;city_name text;city_code text;begin
 select to_jsonb(x) into b from public.customers x where x.code=p_data->>'customer_code'
 and x.branch=case p_unit when 'Matriz Caicó' then 'Caicó' when 'Filial Pau dos Ferros' then 'Pau dos Ferros' else p_unit end limit 1;
 select data into c from public.delivery_return_records where unit=p_unit and kind='CUSTOMERS' and row_key=p_data->>'customer_code';
 select jsonb_build_object('city',max(data->>'city'),'seller',string_agg(distinct nullif(data->>'seller',''),' / ')) into o
 from public.delivery_return_records where unit=p_unit and kind='ORDERS' and operation_date=(p_data->>'operation_date')::date
 and data->>'customer_code'=p_data->>'customer_code' and data->>'map_number'=p_data->>'map_number'
 and (nullif(p_data->>'invoice_number','') is null or data->>'invoice_number'=p_data->>'invoice_number')
 and (nullif(p_data->>'invoice_series','') is null or data->>'invoice_series'=p_data->>'invoice_series');
 select data into j from public.delivery_return_records where unit=p_unit and kind='JOURNEYS' and operation_date=(p_data->>'operation_date')::date and data->>'map_number'=p_data->>'map_number' limit 1;
 if j is null then
  select to_jsonb(x) into m from public.maps x where x.map_number=p_data->>'map_number' and x.map_date=(p_data->>'operation_date')::date
  and exists(select 1 from public.delivery_return_records r where r.unit=p_unit and r.kind in ('REPORT','ORDERS') and r.operation_date=x.map_date and r.data->>'map_number'=x.map_number)
  and not exists(select 1 from public.delivery_return_records r where r.unit<>p_unit and r.kind in ('REPORT','ORDERS') and r.operation_date=x.map_date and r.data->>'map_number'=x.map_number)
  and (select count(*) from public.maps y where y.map_number=x.map_number and y.map_date=x.map_date)=1;j=m;
 end if;
 select data into a from public.delivery_return_cases where unit=p_unit and operation_date=(p_data->>'operation_date')::date and customer_code=p_data->>'customer_code' and map_number=coalesce(p_data->>'map_number','');
 city_name=public.returns_city_value(array[o->>'city',c->>'city',b->>'city',p_data->>'city']);
 if city_name='' then
  select btrim(value) into city_code from unnest(array[o->>'city',c->>'city',b->>'city',p_data->>'city']) with ordinality input(value,position)
   where btrim(value)~*'^([a-z]{2}[- ]?[0-9]{4,}|[0-9]+)$' order by position limit 1;
  -- Somente uma associação inequívoca entre o código importado e nomes do
  -- cadastro da mesma unidade pode completar um PDV ainda não cadastrado.
  if city_code is not null then
   select case when count(distinct translate(lower(btrim(x.city)),'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn'))=1 then min(btrim(x.city)) else '' end into city_name
   from public.delivery_return_records r join public.customers x on x.code=r.row_key
    and x.branch=case p_unit when 'Matriz Caicó' then 'Caicó' when 'Filial Pau dos Ferros' then 'Pau dos Ferros' else p_unit end
   where r.unit=p_unit and r.kind='CUSTOMERS' and upper(btrim(r.data->>'city'))=upper(city_code)
    and public.returns_city_value(array[x.city])<>'';
  end if;
 end if;
 return p_data||jsonb_build_object('customer_name',coalesce(nullif(p_data->>'customer_name',''),nullif(c->>'customer_name',''),b->>'name',''),
 'registration_date',b->>'registration_date','city',coalesce(city_name,''),'branch',coalesce(nullif(c->>'branch',''),b->>'branch',p_unit),'seller',coalesce(nullif(o->>'seller',''),c->>'seller',''),
 'driver',coalesce(j->>'driver',''),'helper1',coalesce(j->>'helper1',''),'helper2',coalesce(j->>'helper2',''),
 'is_drop',case when jsonb_typeof(a->'is_drop')='boolean' then a->'is_drop' else j->'is_drop' end);
end$$;
revoke all on function public.returns_enrich(text,jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
