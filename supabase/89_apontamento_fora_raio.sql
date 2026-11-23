-- Apontamento Fora do Raio (FDR), isolado por unidade e com consulta de referências.
begin;

insert into public.permissions(code,module,name,description,sort_order,active) values
 ('FDR_VIEW','Apontamento Fora do Raio','Consultar apontamentos FDR','Consultar e filtrar entregas apontadas fora do raio.',10,true),
 ('FDR_EDIT','Apontamento Fora do Raio','Registrar apontamentos FDR','Criar e editar apontamentos fora do raio.',20,true)
on conflict(code) do nothing;
insert into public.role_permissions(role,permission_code)
values ('ADMIN','FDR_VIEW'),('ADMIN','FDR_EDIT') on conflict do nothing;

alter table public.module_settings drop constraint if exists module_settings_name_valid;
alter table public.module_settings add constraint module_settings_name_valid check(module_name in
 ('NRI','Conferência','Contagem FEFO','Ativo de Giro','Materiais','Refugo','Avarias de Entrega','Avarias de Vendas','Validade do Estoque','Escalonada Digital','Puxada','Formulários','Devoluções','Pedidos','Apontamento Fora do Raio'));
insert into public.module_settings(module_name,active)
values('Apontamento Fora do Raio',true) on conflict do nothing;

create table if not exists public.delivery_radius_reports (
 id uuid primary key default gen_random_uuid(),
 unit text not null references public.units(name),
 report_date date not null,
 customer_code text not null check(length(customer_code) between 1 and 40),
 map_number text not null default '' check(length(map_number)<=40),
 branch text not null check(branch in ('MATRIZ','FILIAL')),
 city text not null default '' check(length(city)<=200),
 customer_name text not null default '' check(length(customer_name)<=300),
 driver text not null default '' check(length(driver)<=200),
 seller text not null default '' check(length(seller)<=200),
 driver_treatment text not null default '' check(length(driver_treatment)<=2000),
 justified boolean not null default false,
 observations text not null default '' check(length(observations)<=2000),
 revision integer not null default 1 check(revision>0),
 created_by uuid not null references public.profiles(id),
 updated_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists delivery_radius_reports_unit_date
 on public.delivery_radius_reports(unit,report_date desc);
create index if not exists delivery_radius_reports_unit_city
 on public.delivery_radius_reports(unit,city);
create index if not exists delivery_radius_reports_unit_driver
 on public.delivery_radius_reports(unit,driver);

create or replace function public.fdr_can(p_unit text,p_permission text) returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce(exists(select 1 from public.profiles where id=auth.uid() and active)
 and public.user_has_unit(p_unit) and public.has_permission(p_permission)
 and exists(select 1 from public.module_settings where module_name='Apontamento Fora do Raio' and active),false)
$$;
revoke all on function public.fdr_can(text,text) from public,anon;
grant execute on function public.fdr_can(text,text) to authenticated;

alter table public.delivery_radius_reports enable row level security;
revoke all on public.delivery_radius_reports from anon,authenticated;
grant select on public.delivery_radius_reports to authenticated;
drop policy if exists fdr_read on public.delivery_radius_reports;
create policy fdr_read on public.delivery_radius_reports for select to authenticated
 using(public.fdr_can(unit,'FDR_VIEW'));

create or replace function public.fdr_lookup(p_unit text,p_customer text,p_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare customer_data jsonb;result jsonb;branch_name text;
begin
 if not public.fdr_can(p_unit,'FDR_VIEW') then raise exception 'FORBIDDEN';end if;
 if p_date is null or length(btrim(coalesce(p_customer,''))) not between 1 and 40 then raise exception 'INVALID_LOOKUP';end if;
 branch_name:=case when p_unit='Matriz Caicó' then 'MATRIZ' else 'FILIAL' end;

 select data into customer_data from public.delivery_return_records
 where unit=p_unit and kind='CUSTOMERS' and row_key=p_customer;
 if customer_data is null then
  select to_jsonb(c) into customer_data from public.customers c
  where c.code=p_customer and c.branch=case when branch_name='MATRIZ' then 'Caicó' else 'Pau dos Ferros' end
  limit 1;
 end if;
 customer_data:=coalesce(customer_data,'{}'::jsonb);

 with order_maps as (
  select data->>'map_number' as map_number,
   string_agg(distinct nullif(btrim(data->>'seller'),''),' / ' order by nullif(btrim(data->>'seller'),''))
    filter(where nullif(btrim(data->>'seller'),'') is not null) as seller
  from public.delivery_return_records
  where unit=p_unit and kind='ORDERS' and operation_date=p_date
   and data->>'customer_code'=p_customer and nullif(data->>'map_number','') is not null
  group by data->>'map_number'
 ), candidates as (
  select om.map_number,om.seller,m.city,
   coalesce(nullif(j.data->>'driver',''),m.driver,'') as driver
  from order_maps om
  left join public.maps m on m.map_number=om.map_number and m.map_date=p_date
   and not exists(select 1 from public.delivery_return_records other
    where other.unit<>p_unit and other.kind in ('REPORT','ORDERS')
     and other.operation_date=p_date and other.data->>'map_number'=om.map_number)
  left join lateral (
   select r.data from public.delivery_return_records r
   where r.unit=p_unit and r.kind='JOURNEYS' and r.operation_date=p_date
    and r.data->>'map_number'=om.map_number order by r.updated_at desc limit 1
  ) j on true
  union all
  select m.map_number,null,m.city,m.driver
  from public.maps m
  where m.map_date=p_date and not exists(select 1 from order_maps)
   and (select count(*) from public.maps x where x.map_date=p_date)=1
   and exists(select 1 from public.delivery_return_records own
    where own.unit=p_unit and own.kind in ('REPORT','ORDERS')
     and own.operation_date=p_date and own.data->>'map_number'=m.map_number)
   and not exists(select 1 from public.delivery_return_records other
    where other.unit<>p_unit and other.kind in ('REPORT','ORDERS')
     and other.operation_date=p_date and other.data->>'map_number'=m.map_number)
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'operation_date',p_date,'customer_code',p_customer,'map_number',c.map_number,
  'branch',branch_name,
  'city',coalesce(nullif(customer_data->>'city',''),c.city,''),
  'customer_name',coalesce(nullif(customer_data->>'customer_name',''),nullif(customer_data->>'name',''), ''),
  'driver',coalesce(c.driver,''),
  'seller',coalesce(c.seller,nullif(customer_data->>'seller',''),'')
 ) order by c.map_number),'[]'::jsonb) into result from candidates c;

 if jsonb_array_length(result)=0 then
  result:=jsonb_build_array(jsonb_build_object(
   'operation_date',p_date,'customer_code',p_customer,'map_number','',
   'branch',branch_name,'city',coalesce(customer_data->>'city',''),
   'customer_name',coalesce(customer_data->>'customer_name',customer_data->>'name',''),
   'driver','','seller',coalesce(customer_data->>'seller','')
  ));
 end if;
 return result;
end$$;

create or replace function public.fdr_save(p_id uuid,p_unit text,p_revision integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare old public.delivery_radius_reports%rowtype;v public.delivery_radius_reports%rowtype;
begin
 if not public.fdr_can(p_unit,'FDR_EDIT') then raise exception 'FORBIDDEN';end if;
 if p_id is null or p_revision is null or jsonb_typeof(p_data) is distinct from 'object'
  or octet_length(p_data::text)>16000 then raise exception 'INVALID_FDR';
 end if;
 if coalesce(p_data->>'report_date','')!~'^\d{4}-\d{2}-\d{2}$'
  or (p_data->>'report_date')::date not between date '2000-01-01' and date '2200-12-31'
  or length(btrim(coalesce(p_data->>'customer_code',''))) not between 1 and 40
  or coalesce(p_data->>'branch','') not in ('MATRIZ','FILIAL')
  or coalesce(p_data->>'justified','') not in ('true','false')
 then raise exception 'INVALID_FDR';end if;
 if exists(select 1 from jsonb_each(p_data) where key in
  ('map_number','city','customer_name','driver','seller','driver_treatment','observations')
  and jsonb_typeof(value) not in ('string','null')) then raise exception 'INVALID_FDR';end if;
 if length(coalesce(p_data->>'map_number',''))>40 or length(coalesce(p_data->>'city',''))>200
  or length(coalesce(p_data->>'customer_name',''))>300 or length(coalesce(p_data->>'driver',''))>200
  or length(coalesce(p_data->>'seller',''))>200 or length(coalesce(p_data->>'driver_treatment',''))>2000
  or length(coalesce(p_data->>'observations',''))>2000 then raise exception 'INVALID_FDR';end if;

 perform pg_advisory_xact_lock(hashtextextended('fdr:'||p_id,0));
 select * into old from public.delivery_radius_reports where id=p_id for update;
 if found and old.unit<>p_unit then raise exception 'FORBIDDEN';end if;
 if (old.id is null and p_revision<>0) or (old.id is not null and p_revision<>old.revision)
 then raise exception 'FDR_VERSION_CONFLICT';end if;

 if old.id is null then
  insert into public.delivery_radius_reports(id,unit,report_date,customer_code,map_number,branch,city,
   customer_name,driver,seller,driver_treatment,justified,observations,created_by,updated_by)
  values(p_id,p_unit,(p_data->>'report_date')::date,btrim(p_data->>'customer_code'),
   btrim(coalesce(p_data->>'map_number','')),p_data->>'branch',btrim(coalesce(p_data->>'city','')),
   btrim(coalesce(p_data->>'customer_name','')),btrim(coalesce(p_data->>'driver','')),
   btrim(coalesce(p_data->>'seller','')),btrim(coalesce(p_data->>'driver_treatment','')),
   (p_data->>'justified')::boolean,btrim(coalesce(p_data->>'observations','')),auth.uid(),auth.uid())
  returning * into v;
 else
  update public.delivery_radius_reports set report_date=(p_data->>'report_date')::date,
   customer_code=btrim(p_data->>'customer_code'),map_number=btrim(coalesce(p_data->>'map_number','')),
   branch=p_data->>'branch',city=btrim(coalesce(p_data->>'city','')),
   customer_name=btrim(coalesce(p_data->>'customer_name','')),driver=btrim(coalesce(p_data->>'driver','')),
   seller=btrim(coalesce(p_data->>'seller','')),driver_treatment=btrim(coalesce(p_data->>'driver_treatment','')),
   justified=(p_data->>'justified')::boolean,observations=btrim(coalesce(p_data->>'observations','')),
   revision=revision+1,updated_by=auth.uid(),updated_at=now()
  where id=p_id returning * into v;
 end if;
 return to_jsonb(v);
end$$;

revoke all on function public.fdr_lookup(text,text,date),public.fdr_save(uuid,text,integer,jsonb) from public,anon;
grant execute on function public.fdr_lookup(text,text,date),public.fdr_save(uuid,text,integer,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
