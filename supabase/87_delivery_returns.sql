-- Devoluções: importação atômica, monitoramento editável e isolamento por unidade.
-- Não altera MAPAS, clientes, avarias ou dados da conferência.
-- Instalação inicial. Em bancos com Devoluções, use as migrações incrementais.
begin;
do $$begin
 if to_regclass('public.delivery_return_cases') is not null then
  raise exception 'DEVOLUCOES_JA_INSTALADO: use as migracoes incrementais; para module_settings_name_valid, use supabase/migrations/20261123105236_module_settings_names_compatibility.sql.';
 end if;
end$$;
insert into public.permissions(code,module,name,description,sort_order,active) values
 ('RETURNS_VIEW','Devoluções','Consultar devoluções','Dashboards, acompanhamento e histórico da unidade.',10,true),
 ('RETURNS_EDIT','Devoluções','Monitorar devoluções','Cadastrar e editar a auditoria e as metas da unidade.',20,true),
 ('RETURNS_IMPORT','Devoluções','Importar relatórios','Importar devoluções, pedidos e bases auxiliares.',30,true)
on conflict(code) do nothing;
insert into public.role_permissions(role,permission_code) values
 ('ADMIN','RETURNS_VIEW'),('ADMIN','RETURNS_EDIT'),('ADMIN','RETURNS_IMPORT') on conflict do nothing;
alter table public.module_settings drop constraint if exists module_settings_name_valid;
alter table public.module_settings add constraint module_settings_name_valid check(module_name in
 ('NRI','Conferência','Contagem FEFO','Ativo de Giro','Materiais','Refugo','Avarias de Entrega','Avarias de Vendas','Validade do Estoque','Escalonada Digital','Puxada','Formulários','Devoluções','Pedidos'));
insert into public.module_settings(module_name,active) values('Devoluções',true) on conflict do nothing;

create table if not exists public.delivery_return_imports (
 id uuid primary key,unit text not null references public.units(name),kind text not null
 check(kind in ('REPORT','ORDERS','CUSTOMERS','JOURNEYS','ROUTES')),
 filename text not null check(length(filename)<=250),file_hash text not null check(file_hash~'^[a-f0-9]{64}$'),
 expected_rows integer not null check(expected_rows between 1 and 100000),
 status text not null default 'STAGING' check(status in ('STAGING','COMPLETED')),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),completed_at timestamptz
);
create table if not exists public.delivery_return_staging (
 import_id uuid not null references public.delivery_return_imports(id) on delete cascade,
 row_key text not null check(length(row_key) between 1 and 500),data jsonb not null,
 primary key(import_id,row_key)
);
create table if not exists public.delivery_return_records (
 unit text not null references public.units(name),kind text not null,row_key text not null,
 operation_date date,data jsonb not null,import_id uuid not null references public.delivery_return_imports(id),
 updated_at timestamptz not null default now(),primary key(unit,kind,row_key)
);
create index if not exists delivery_return_records_date on public.delivery_return_records(unit,kind,operation_date);
create table if not exists public.delivery_return_cases (
 id uuid primary key,unit text not null references public.units(name),operation_date date not null,
 customer_code text not null check(length(customer_code) between 1 and 40),map_number text not null default '',
 data jsonb not null,status text not null check(status in ('AGUARDANDO_REPASSE','DEVOLVIDO','REVERTIDO')),
 revision integer not null default 1,created_by uuid not null references public.profiles(id),
 updated_by uuid not null references public.profiles(id),updated_by_name text not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(unit,operation_date,customer_code,map_number)
);
create index if not exists delivery_return_cases_date on public.delivery_return_cases(unit,operation_date);
create table if not exists public.delivery_return_audit (
 id bigint generated always as identity primary key,case_id uuid not null references public.delivery_return_cases(id),
 unit text not null,actor_id uuid not null references public.profiles(id),actor_name text not null,
 previous jsonb,next jsonb not null,created_at timestamptz not null default now()
);
create table if not exists public.delivery_return_operations (
 id uuid primary key,actor_id uuid not null,unit text not null,payload jsonb not null,result jsonb not null
);
create table if not exists public.delivery_return_goals (
 unit text not null references public.units(name),month date not null check(extract(day from month)=1),
 outlet_rate numeric check(outlet_rate between 0 and 1),hl_rate numeric check(hl_rate between 0 and 1),
 updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default now(),primary key(unit,month)
);

create or replace function public.returns_can(p_unit text,p_permission text) returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce(exists(select 1 from public.profiles where id=auth.uid() and active)
 and public.user_has_unit(p_unit) and public.has_permission(p_permission)
 and exists(select 1 from public.module_settings where module_name='Devoluções' and active),false)
$$;
revoke all on function public.returns_can(text,text) from public,anon;
grant execute on function public.returns_can(text,text) to authenticated;
do $$declare t text;begin
 foreach t in array array['delivery_return_imports','delivery_return_records','delivery_return_cases','delivery_return_audit','delivery_return_goals'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('drop policy if exists returns_read on public.%I',t);
  execute format('create policy returns_read on public.%I for select to authenticated using(public.returns_can(unit,''RETURNS_VIEW''))',t);
 end loop;
 foreach t in array array['delivery_return_staging','delivery_return_operations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
 end loop;
end$$;

create or replace function public.returns_begin_import(p_id uuid,p_unit text,p_kind text,p_filename text,p_hash text,p_count integer)
returns uuid language plpgsql security definer set search_path=public as $$
declare v public.delivery_return_imports%rowtype;begin
 if not public.returns_can(p_unit,'RETURNS_IMPORT') then raise exception 'FORBIDDEN';end if;
 insert into public.delivery_return_imports(id,unit,kind,filename,file_hash,expected_rows,created_by)
 values(p_id,p_unit,p_kind,p_filename,p_hash,p_count,auth.uid()) on conflict(id) do nothing;
 select * into v from public.delivery_return_imports where id=p_id for update;
 if v.unit is distinct from p_unit or v.kind is distinct from p_kind or v.file_hash is distinct from p_hash
 or v.expected_rows is distinct from p_count or v.created_by is distinct from auth.uid() then raise exception 'IMPORT_CONFLICT';end if;
 return v.id;
end$$;

create or replace function public.returns_stage_import(p_id uuid,p_rows jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare v public.delivery_return_imports%rowtype;r jsonb;k text;old jsonb;n integer;begin
 select * into v from public.delivery_return_imports where id=p_id for update;
 if not found or v.created_by<>auth.uid() or not public.returns_can(v.unit,'RETURNS_IMPORT') then raise exception 'FORBIDDEN';end if;
 if v.status='COMPLETED' then return v.expected_rows;end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'INVALID_BATCH';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  k=r->>'row_key';if k is null or length(k) not between 1 and 500 or octet_length(r::text)>20000 then raise exception 'INVALID_ROW';end if;
  if v.kind<>'CUSTOMERS' and (coalesce(r->>'operation_date','')!~'^\d{4}-\d{2}-\d{2}$' or (r->>'operation_date')::date not between date '2000-01-01' and date '2200-12-31') then raise exception 'INVALID_DATE';end if;
  if v.kind in ('REPORT','ORDERS','CUSTOMERS') and length(coalesce(r->>'customer_code','')) not between 1 and 40 then raise exception 'INVALID_CUSTOMER';end if;
  if v.kind in ('REPORT','ORDERS','JOURNEYS') and length(coalesce(r->>'map_number','')) not between 1 and 40 then raise exception 'INVALID_MAP';end if;
  if v.kind='REPORT' then
   if coalesce(r->>'amount_cents','')!~'^\d+$' or (r->>'amount_cents')::numeric>1e13 or coalesce(r->>'volume_hl','')!~'^\d+(\.\d+)?$' or (r->>'volume_hl')::numeric>1e9
   or length(coalesce(r->>'invoice_number','')) not between 1 and 40 then raise exception 'INVALID_REPORT';end if;
  elsif v.kind='ORDERS' then
   if coalesce(r->>'order_amount_cents','')!~'^\d+$' or (r->>'order_amount_cents')::numeric>1e13 then raise exception 'INVALID_ORDER';end if;
  elsif v.kind='ROUTES' then
   if coalesce(r->>'planned_outlets','')!~'^\d+$' or (r->>'planned_outlets')::numeric>1e7 or coalesce(r->>'planned_hl','')!~'^\d+(\.\d+)?$' or (r->>'planned_hl')::numeric>1e9 then raise exception 'INVALID_ROUTE';end if;
  end if;
  select data into old from public.delivery_return_staging where import_id=p_id and row_key=k;
  if found and old<>r then raise exception 'IMPORT_ROW_CONFLICT';end if;
  insert into public.delivery_return_staging values(p_id,k,r) on conflict do nothing;
 end loop;
 select count(*) into n from public.delivery_return_staging where import_id=p_id;
 if n>v.expected_rows then raise exception 'IMPORT_COUNT';end if;return n;
end$$;

create or replace function public.returns_finish_import(p_id uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare v public.delivery_return_imports%rowtype;n integer;begin
 select * into v from public.delivery_return_imports where id=p_id for update;
 if not found or v.created_by<>auth.uid() or not public.returns_can(v.unit,'RETURNS_IMPORT') then raise exception 'FORBIDDEN';end if;
 if v.status='COMPLETED' then return v.expected_rows;end if;
 select count(*) into n from public.delivery_return_staging where import_id=p_id;
 if n<>v.expected_rows then raise exception 'IMPORT_INCOMPLETE';end if;
 -- Serializa as publicações da mesma base/unidade; uma prévia nunca fica parcialmente visível.
 perform pg_advisory_xact_lock(hashtextextended('returns-import:'||v.unit||':'||v.kind,0));
 insert into public.delivery_return_records(unit,kind,row_key,operation_date,data,import_id)
 select v.unit,v.kind,row_key,(data->>'operation_date')::date,data,p_id from public.delivery_return_staging where import_id=p_id
 on conflict(unit,kind,row_key) do update set data=excluded.data,operation_date=excluded.operation_date,import_id=p_id,updated_at=now();
 update public.delivery_return_imports set status='COMPLETED',completed_at=now() where id=p_id;
 delete from public.delivery_return_staging where import_id=p_id;return n;
end$$;

-- Consulta exata de equipe e cadastro, sem editar as bases usadas pela conferência.
create or replace function public.returns_enrich(p_unit text,p_data jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c jsonb;j jsonb;m jsonb;a jsonb;begin
 select data into c from public.delivery_return_records where unit=p_unit and kind='CUSTOMERS' and row_key=p_data->>'customer_code';
 if c is null then select to_jsonb(x) into c from public.customers x where x.code=p_data->>'customer_code'
 and x.branch=case p_unit when 'Matriz Caicó' then 'Caicó' when 'Filial Pau dos Ferros' then 'Pau dos Ferros' else p_unit end limit 1;end if;
 select data into j from public.delivery_return_records where unit=p_unit and kind='JOURNEYS' and operation_date=(p_data->>'operation_date')::date and data->>'map_number'=p_data->>'map_number' limit 1;
 if j is null then
  -- MAPAS é uma referência compartilhada, sem coluna unit. Exige vínculo
  -- importado da unidade e uma única equipe para mapa/data. Havendo colisão
  -- entre unidades, somente a jornada importada por unidade pode resolver.
  select to_jsonb(x) into m from public.maps x where x.map_number=p_data->>'map_number' and x.map_date=(p_data->>'operation_date')::date
  and exists(select 1 from public.delivery_return_records r where r.unit=p_unit and r.kind in ('REPORT','ORDERS') and r.operation_date=x.map_date and r.data->>'map_number'=x.map_number)
  and not exists(select 1 from public.delivery_return_records r where r.unit<>p_unit and r.kind in ('REPORT','ORDERS') and r.operation_date=x.map_date and r.data->>'map_number'=x.map_number)
  and (select count(*) from public.maps y where y.map_number=x.map_number and y.map_date=x.map_date)=1;
  j=m;
 end if;
 select data into a from public.delivery_return_cases where unit=p_unit and operation_date=(p_data->>'operation_date')::date and customer_code=p_data->>'customer_code' and map_number=coalesce(p_data->>'map_number','');
 return p_data||jsonb_build_object('customer_name',coalesce(nullif(p_data->>'customer_name',''),c->>'customer_name',c->>'name',''),
 'city',coalesce(c->>'city',''),'branch',coalesce(c->>'branch',p_unit),'seller',coalesce(c->>'seller',''),
 'driver',coalesce(j->>'driver',''),'helper1',coalesce(j->>'helper1',''),'helper2',coalesce(j->>'helper2',''),
 'is_drop',case when jsonb_typeof(a->'is_drop')='boolean' then a->'is_drop' else j->'is_drop' end);
end$$;
revoke all on function public.returns_enrich(text,jsonb) from public,anon,authenticated;

create or replace function public.returns_snapshot(p_unit text,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;n integer;begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'INVALID_PERIOD';end if;
 select count(*) into n from public.delivery_return_records where unit=p_unit and kind='REPORT' and operation_date between least(p_from,p_to-29) and p_to;
 if n>15000 or (select count(*) from public.delivery_return_cases where unit=p_unit and operation_date between p_from and p_to)>15000 then raise exception 'REDUCE_PERIOD';end if;
 select jsonb_build_object(
 'reports',coalesce((select jsonb_agg(public.returns_enrich(p_unit,r.data)||jsonb_build_object('driver_treatment',coalesce(a.data->>'driver_treatment','')) order by r.operation_date desc,r.row_key)
 from public.delivery_return_records r left join public.delivery_return_cases a on a.unit=r.unit and a.operation_date=r.operation_date and a.customer_code=r.data->>'customer_code' and a.map_number=r.data->>'map_number'
 where r.unit=p_unit and r.kind='REPORT' and r.operation_date between least(p_from,p_to-29) and p_to),'[]'::jsonb),
 'cases',coalesce((select jsonb_agg(data||to_jsonb(c)-'data' order by updated_at desc) from public.delivery_return_cases c where unit=p_unit and operation_date between p_from and p_to),'[]'::jsonb),
 'routes',coalesce((select jsonb_agg(data order by operation_date) from public.delivery_return_records where unit=p_unit and kind='ROUTES' and operation_date between p_from and p_to),'[]'::jsonb),
 'goals',coalesce((select jsonb_agg(to_jsonb(g)) from public.delivery_return_goals g where unit=p_unit and month between date_trunc('month',p_from)::date and p_to),'[]'::jsonb),
 'imports',coalesce((select jsonb_agg(to_jsonb(i)) from(select * from public.delivery_return_imports where unit=p_unit and status='COMPLETED' order by completed_at desc limit 12)i),'[]'::jsonb),
 'at',now()) into result;return result;
end$$;

create or replace function public.returns_lookup(p_unit text,p_customer text,p_date date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 select coalesce(jsonb_agg(public.returns_enrich(p_unit,g.data)),'[]'::jsonb) into result from (
 select jsonb_build_object('operation_date',p_date,'customer_code',p_customer,'map_number',data->>'map_number',
 'customer_name',max(data->>'customer_name'),'order_amount_cents',sum((data->>'order_amount_cents')::bigint)) data
 from public.delivery_return_records where unit=p_unit and kind='ORDERS' and operation_date=p_date and data->>'customer_code'=p_customer group by data->>'map_number')g;
 if jsonb_array_length(result)=0 then return jsonb_build_array(public.returns_enrich(p_unit,jsonb_build_object('operation_date',p_date,'customer_code',p_customer,'map_number','','order_amount_cents',null)));end if;
 return result;
end$$;

create or replace function public.returns_save_case(p_id uuid,p_unit text,p_revision integer,p_operation uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare old public.delivery_return_cases%rowtype;v public.delivery_return_cases%rowtype;op public.delivery_return_operations%rowtype;
 clean jsonb;payload jsonb;actor text;begin
 if not public.returns_can(p_unit,'RETURNS_EDIT') or not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 if p_id is null or p_operation is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>20000 then raise exception 'INVALID_CASE';end if;
 payload=jsonb_build_object('id',p_id,'revision',p_revision,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended('returns-operation:'||p_operation,0));
 select * into op from public.delivery_return_operations where id=p_operation;
 if found then
  if op.unit<>p_unit or op.actor_id<>auth.uid() or op.payload<>payload then raise exception 'OPERATION_CONFLICT';end if;return op.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('returns-case:'||p_id,0));
 select * into old from public.delivery_return_cases where id=p_id for update;
 if found and old.unit<>p_unit then raise exception 'FORBIDDEN';end if;
 if p_revision is null or (old.id is null and p_revision<>0) or (old.id is not null and p_revision<>old.revision) then raise exception 'RETURN_VERSION_CONFLICT';end if;
 if coalesce(p_data->>'operation_date','')!~'^\d{4}-\d{2}-\d{2}$' or (p_data->>'operation_date')::date not between date '2000-01-01' and date '2200-12-31'
 or length(btrim(coalesce(p_data->>'customer_code',''))) not between 1 and 40 or length(coalesce(p_data->>'map_number',''))>40
 or length(btrim(coalesce(p_data->>'driver_reason',''))) not between 1 and 200
 or coalesce(p_data->>'status','') not in ('AGUARDANDO_REPASSE','DEVOLVIDO','REVERTIDO') then raise exception 'INVALID_CASE';end if;
 if p_data->>'order_amount_cents' is not null and (p_data->>'order_amount_cents'!~'^\d+$' or (p_data->>'order_amount_cents')::numeric>1e13) then raise exception 'INVALID_AMOUNT';end if;
 select coalesce(jsonb_object_agg(k,case when jsonb_typeof(p_data->k)='string' then to_jsonb(btrim(p_data->>k)) else p_data->k end),'{}') into clean
 from unnest(array['customer_name','city','branch','seller','driver','helper1','helper2','order_amount_cents','driver_reason','driver_treatment','client_reason','client_statement','is_drop'])k;
 if exists(select 1 from jsonb_each(clean) where jsonb_typeof(value)='string' and length(value#>>'{}')>2000) then raise exception 'TEXT_TOO_LONG';end if;
 if clean->>'is_drop' is not null and clean->>'is_drop' not in ('true','false') then raise exception 'INVALID_DROP';end if;
 select name into actor from public.profiles where id=auth.uid();
 if old.id is null then
 insert into public.delivery_return_cases(id,unit,operation_date,customer_code,map_number,data,status,created_by,updated_by,updated_by_name)
 values(p_id,p_unit,(p_data->>'operation_date')::date,btrim(p_data->>'customer_code'),btrim(coalesce(p_data->>'map_number','')),clean,p_data->>'status',auth.uid(),auth.uid(),actor) returning * into v;
 else
 update public.delivery_return_cases set operation_date=(p_data->>'operation_date')::date,customer_code=btrim(p_data->>'customer_code'),map_number=btrim(coalesce(p_data->>'map_number','')),
 data=clean,status=p_data->>'status',revision=revision+1,updated_by=auth.uid(),updated_by_name=actor,updated_at=now() where id=p_id returning * into v;
 end if;
 insert into public.delivery_return_audit(case_id,unit,actor_id,actor_name,previous,next) values(p_id,p_unit,auth.uid(),actor,case when old.id is null then null else to_jsonb(old) end,to_jsonb(v));
 clean=v.data||to_jsonb(v)-'data';
 insert into public.delivery_return_operations values(p_operation,auth.uid(),p_unit,payload,clean);return clean;
end$$;

create or replace function public.returns_save_goal(p_unit text,p_month date,p_outlet numeric,p_hl numeric) returns void
language plpgsql security definer set search_path=public as $$begin
 if not public.returns_can(p_unit,'RETURNS_EDIT') then raise exception 'FORBIDDEN';end if;
 insert into public.delivery_return_goals(unit,month,outlet_rate,hl_rate,updated_by) values(p_unit,p_month,p_outlet,p_hl,auth.uid())
 on conflict(unit,month) do update set outlet_rate=p_outlet,hl_rate=p_hl,updated_by=auth.uid(),updated_at=now();
end$$;

revoke all on function public.returns_begin_import(uuid,text,text,text,text,integer),public.returns_stage_import(uuid,jsonb),public.returns_finish_import(uuid),public.returns_snapshot(text,date,date),public.returns_lookup(text,text,date),public.returns_save_case(uuid,text,integer,uuid,jsonb),public.returns_save_goal(text,date,numeric,numeric) from public,anon;
grant execute on function public.returns_begin_import(uuid,text,text,text,text,integer),public.returns_stage_import(uuid,jsonb),public.returns_finish_import(uuid),public.returns_snapshot(text,date,date),public.returns_lookup(text,text,date),public.returns_save_case(uuid,text,integer,uuid,jsonb),public.returns_save_goal(text,date,numeric,numeric) to authenticated;
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='delivery_return_cases') then alter publication supabase_realtime add table public.delivery_return_cases;end if;
end$$;
notify pgrst,'reload schema';
commit;
