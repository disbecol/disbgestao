-- Pedidos: solicitações de fora de rota, bipasse e cliente novo.
-- Implementação própria; não importa usuários, senhas ou registros do site de referência.
begin;
insert into public.permissions(code,module,name,description,sort_order,active) values
 ('ORDERS_CREATE','Pedidos','Nova solicitação','Solicitar fora de rota, bipasse ou atendimento de cliente novo.',10,true),
 ('ORDERS_OWN','Pedidos','Minhas solicitações','Consultar as próprias solicitações e respostas.',20,true),
 ('ORDERS_REVIEW','Pedidos','Analisar solicitações','Assumir a fila e aprovar ou reprovar as próprias análises.',30,true),
 ('ORDERS_VIEW_ALL','Pedidos','Consultar todas','Consultar todas as solicitações da unidade.',40,true),
 ('ORDERS_MANAGE','Pedidos','Gerenciar análises','Intervir nas análises de outros responsáveis e devolver à fila.',50,true),
 ('ORDERS_DASHBOARD','Pedidos','Dashboard gerencial','Indicadores, rankings e análise individual por cliente.',60,true),
 ('ORDERS_AUDIT','Pedidos','Auditoria','Consultar o histórico de alterações da unidade.',70,true),
 ('ORDERS_CONFIG','Pedidos','Configurar regras','Editar horários de solicitação e prazos de atendimento.',80,true)
on conflict(code) do nothing;
insert into public.role_permissions(role,permission_code)
 select 'ADMIN',code from public.permissions where module='Pedidos' on conflict do nothing;
insert into public.role_permissions(role,permission_code) values
 ('VENDEDOR','ORDERS_CREATE'),('VENDEDOR','ORDERS_OWN'),
 ('GERENTE_VENDAS','ORDERS_CREATE'),('GERENTE_VENDAS','ORDERS_OWN'),
 ('GERENTE_VENDAS','ORDERS_VIEW_ALL'),('GERENTE_VENDAS','ORDERS_DASHBOARD') on conflict do nothing;
alter table public.module_settings drop constraint if exists module_settings_name_valid;
alter table public.module_settings add constraint module_settings_name_valid check(module_name in
 ('NRI','Conferência','Contagem FEFO','Ativo de Giro','Materiais','Refugo','Avarias de Entrega','Avarias de Vendas','Validade do Estoque','Escalonada Digital','Puxada','Formulários','Devoluções','Pedidos'));
insert into public.module_settings(module_name,active) values('Pedidos',true) on conflict do nothing;

create table public.order_request_settings (
 unit text primary key references public.units(name),revision integer not null default 1,
 restricted_hours boolean not null default true,
 morning_start integer not null default 510,morning_end integer not null default 690,
 afternoon_start integer not null default 840,afternoon_end integer not null default 960,
 route_sla integer not null default 30 check(route_sla between 1 and 10080),
 bypass_sla integer not null default 2880 check(bypass_sla between 1 and 43200),
 updated_by uuid references public.profiles(id),updated_at timestamptz not null default now(),
 check(0<=morning_start and morning_start<morning_end and morning_end<afternoon_start
 and afternoon_start<afternoon_end and afternoon_end<=1439)
);
create table public.order_requests (
 id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),
 kind text not null check(kind in ('FORA_ROTA','BIPASSE','CLIENTE_NOVO')),
 customer_code text not null check(length(customer_code) between 1 and 40),
 customer_name text not null check(length(customer_name) between 1 and 200),city text not null default '',
 desired_date date,weekdays integer[] not null default '{}',
 reason text not null check(length(reason) between 1 and 250),notes text not null check(length(notes) between 1 and 4000),
 status text not null default 'PENDENTE' check(status in ('PENDENTE','EM_ANALISE','APROVADO','REPROVADO')),
 created_by uuid not null references public.profiles(id),created_by_name text not null,
 analyst_id uuid references public.profiles(id),analyst_name text,
 created_at timestamptz not null default now(),claimed_at timestamptz,resolved_at timestamptz,
 response text not null default '',sla_minutes integer not null check(sla_minutes>0),
 resolution_minutes numeric,within_sla boolean,revision integer not null default 1,
 updated_at timestamptz not null default now(),
 check((kind='BIPASSE' and desired_date is null and cardinality(weekdays) between 1 and 5 and weekdays<@array[1,2,3,4,5])
 or(kind<>'BIPASSE' and desired_date is not null and cardinality(weekdays)=0)),
 check((status='PENDENTE' and analyst_id is null and claimed_at is null and resolved_at is null)
 or(status='EM_ANALISE' and analyst_id is not null and claimed_at is not null and resolved_at is null)
 or(status in ('APROVADO','REPROVADO') and analyst_id is not null and claimed_at is not null and resolved_at is not null and within_sla is not null))
);
create index order_requests_unit_date on public.order_requests(unit,created_at desc,id);
create index order_requests_creator_date on public.order_requests(created_by,unit,created_at desc);
create index order_requests_analyst_date on public.order_requests(analyst_id,unit,resolved_at desc);
create index order_requests_queue on public.order_requests(unit,status,created_at) where status in ('PENDENTE','EM_ANALISE');
create table public.order_request_audit (
 id bigint generated always as identity primary key,request_id uuid references public.order_requests(id),
 unit text not null references public.units(name),event text not null,
 actor_id uuid not null references public.profiles(id),actor_name text not null,
 previous jsonb,next jsonb not null,created_at timestamptz not null default now()
);
create index order_request_audit_unit_date on public.order_request_audit(unit,created_at desc,id);
create index order_request_audit_request on public.order_request_audit(request_id,id);
create table public.order_request_operations (
 actor_id uuid not null,operation_id uuid not null,payload jsonb not null,result jsonb not null,
 primary key(actor_id,operation_id)
);
alter table public.order_requests enable row level security;
alter table public.order_request_audit enable row level security;
alter table public.order_request_settings enable row level security;
alter table public.order_request_operations enable row level security;
revoke all on public.order_requests,public.order_request_audit,public.order_request_settings,public.order_request_operations from public,anon,authenticated;
grant select on public.order_requests,public.order_request_audit,public.order_request_settings to authenticated;

create function public.orders_can(p_unit text,p_permission text) returns boolean
language sql stable security definer set search_path=public as $$
 select auth.uid() is not null and public.has_permission(p_permission) and public.user_has_unit(p_unit)
 and exists(select 1 from public.module_settings where module_name='Pedidos' and active);
$$;
create policy order_requests_read on public.order_requests for select to authenticated using (
 (created_by=(select auth.uid()) and (public.orders_can(unit,'ORDERS_CREATE') or public.orders_can(unit,'ORDERS_OWN')))
 or public.orders_can(unit,'ORDERS_REVIEW') or public.orders_can(unit,'ORDERS_MANAGE')
 or public.orders_can(unit,'ORDERS_VIEW_ALL') or public.orders_can(unit,'ORDERS_DASHBOARD') or public.orders_can(unit,'ORDERS_AUDIT'));
create policy order_request_audit_read on public.order_request_audit for select to authenticated using (
 public.orders_can(unit,'ORDERS_AUDIT') or exists(select 1 from public.order_requests r where r.id=request_id));
create policy order_request_settings_read on public.order_request_settings for select to authenticated using (
 public.orders_can(unit,'ORDERS_CONFIG') or public.orders_can(unit,'ORDERS_CREATE') or public.orders_can(unit,'ORDERS_REVIEW'));

create function public.orders_settings(p_unit text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v jsonb;begin
 if not(public.orders_can(p_unit,'ORDERS_CONFIG') or public.orders_can(p_unit,'ORDERS_CREATE') or public.orders_can(p_unit,'ORDERS_OWN')
 or public.orders_can(p_unit,'ORDERS_REVIEW') or public.orders_can(p_unit,'ORDERS_MANAGE') or public.orders_can(p_unit,'ORDERS_VIEW_ALL')
 or public.orders_can(p_unit,'ORDERS_DASHBOARD') or public.orders_can(p_unit,'ORDERS_AUDIT')) then raise exception 'FORBIDDEN';end if;
 select to_jsonb(s) into v from public.order_request_settings s where unit=p_unit;
 return coalesce(v,jsonb_build_object('unit',p_unit,'revision',0,'restricted_hours',true,'morning_start',510,'morning_end',690,
 'afternoon_start',840,'afternoon_end',960,'route_sla',30,'bypass_sla',2880));
end$$;
create function public.orders_customer(p_unit text,p_code text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v jsonb;begin
 if not public.orders_can(p_unit,'ORDERS_CREATE') then raise exception 'FORBIDDEN';end if;
 select jsonb_build_object('code',c.code,'name',c.name,'city',c.city) into v from public.customers c
 where c.code=btrim(p_code) and c.branch=case p_unit when 'Matriz Caicó' then 'Caicó' when 'Filial Pau dos Ferros' then 'Pau dos Ferros' else p_unit end limit 1;
 return v;
end$$;

create function public.orders_create(p_unit text,p_operation uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare payload jsonb:=jsonb_build_object('op','CREATE','unit',p_unit,'data',p_data);prior public.order_request_operations%rowtype;
 v public.order_requests%rowtype;s jsonb;kind text;v_code text;name text;city text:='';days integer[];d date;minute integer;today date;actor text;
begin
 if not public.orders_can(p_unit,'ORDERS_CREATE') then raise exception 'FORBIDDEN';end if;
 if p_operation is null then raise exception 'INVALID_OPERATION';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_operation::text,0));
 select * into prior from public.order_request_operations where actor_id=auth.uid() and operation_id=p_operation;
 if found then if prior.payload<>payload then raise exception 'OPERATION_CONFLICT';end if;return prior.result;end if;
 s:=public.orders_settings(p_unit);kind:=p_data->>'kind';v_code:=btrim(p_data->>'customer_code');
 today:=(now() at time zone 'America/Sao_Paulo')::date;
 minute:=extract(hour from now() at time zone 'America/Sao_Paulo')::int*60+extract(minute from now() at time zone 'America/Sao_Paulo')::int;
 if (s->>'restricted_hours')::boolean and not exists(select 1 from public.profiles where id=auth.uid() and role='ADMIN' and active)
 and not(minute between (s->>'morning_start')::int and (s->>'morning_end')::int or minute between (s->>'afternoon_start')::int and (s->>'afternoon_end')::int)
 then raise exception 'OUTSIDE_REQUEST_WINDOW';end if;
 if kind is null or kind not in ('FORA_ROTA','BIPASSE','CLIENTE_NOVO') or coalesce(v_code,'')='' then raise exception 'INVALID_REQUEST';end if;
 if kind='CLIENTE_NOVO' then name:=btrim(p_data->>'customer_name');else
 select c.name,c.city into name,city from public.customers c where c.code=v_code and c.branch=case p_unit when 'Matriz Caicó' then 'Caicó' when 'Filial Pau dos Ferros' then 'Pau dos Ferros' else p_unit end limit 1;
 if not found then raise exception 'CUSTOMER_NOT_FOUND';end if;end if;
 if coalesce(name,'')='' or coalesce(btrim(p_data->>'reason'),'')='' or coalesce(btrim(p_data->>'notes'),'')='' then raise exception 'INVALID_REQUEST';end if;
 if kind='BIPASSE' then
 if jsonb_typeof(p_data->'weekdays') is distinct from 'array' then raise exception 'INVALID_WEEKDAYS';end if;
 select array_agg(distinct value::int order by value::int) into days from jsonb_array_elements_text(p_data->'weekdays');
 if coalesce(cardinality(days),0)=0 or not days<@array[1,2,3,4,5] then raise exception 'INVALID_WEEKDAYS';end if;
 else days:='{}';d:=(p_data->>'desired_date')::date;if d is null or d<today then raise exception 'INVALID_DATE';end if;end if;
 select pr.name into actor from public.profiles pr where pr.id=auth.uid();
 insert into public.order_requests(unit,kind,customer_code,customer_name,city,desired_date,weekdays,reason,notes,created_by,created_by_name,sla_minutes)
 values(p_unit,kind,v_code,name,coalesce(city,''),d,days,btrim(p_data->>'reason'),btrim(p_data->>'notes'),auth.uid(),actor,
 case when kind='BIPASSE' then (s->>'bypass_sla')::int else (s->>'route_sla')::int end) returning * into v;
 insert into public.order_request_audit(request_id,unit,event,actor_id,actor_name,next) values(v.id,p_unit,'CREATED',auth.uid(),actor,to_jsonb(v));
 insert into public.order_request_operations values(auth.uid(),p_operation,payload,to_jsonb(v));return to_jsonb(v);
end$$;

create function public.orders_action(p_unit text,p_id uuid,p_revision integer,p_operation uuid,p_action text,p_response text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare payload jsonb:=jsonb_build_object('op',p_action,'unit',p_unit,'id',p_id,'revision',p_revision,'response',p_response);
 prior public.order_request_operations%rowtype;v public.order_requests%rowtype;old jsonb;actor text;manage boolean;event text;
begin
 manage:=public.orders_can(p_unit,'ORDERS_MANAGE');
 if not(manage or public.orders_can(p_unit,'ORDERS_REVIEW')) then raise exception 'FORBIDDEN';end if;
 if p_operation is null then raise exception 'INVALID_OPERATION';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_operation::text,0));
 select * into prior from public.order_request_operations where actor_id=auth.uid() and operation_id=p_operation;
 if found then if prior.payload<>payload then raise exception 'OPERATION_CONFLICT';end if;return prior.result;end if;
 select * into v from public.order_requests where id=p_id and unit=p_unit for update;
 if not found then raise exception 'REQUEST_NOT_FOUND';end if;
 if v.revision is distinct from p_revision then raise exception 'ORDER_VERSION_CONFLICT';end if;old:=to_jsonb(v);
 select name into actor from public.profiles where id=auth.uid();
 if p_action='CLAIM' and v.status='PENDENTE' then
 v.status:='EM_ANALISE';v.analyst_id:=auth.uid();v.analyst_name:=actor;v.claimed_at:=now();event:='CLAIMED';
 elsif p_action in ('RETURN','APPROVE','REJECT') and v.status='EM_ANALISE' then
 if v.analyst_id<>auth.uid() and not manage then raise exception 'ANOTHER_ANALYST';end if;
 if p_action='RETURN' then v.status:='PENDENTE';v.analyst_id:=null;v.analyst_name:=null;v.claimed_at:=null;event:='RETURNED';
 else
 if p_action='REJECT' and coalesce(btrim(p_response),'')='' then raise exception 'RESPONSE_REQUIRED';end if;
 if length(coalesce(p_response,''))>4000 then raise exception 'RESPONSE_TOO_LONG';end if;
 v.status:=case p_action when 'APPROVE' then 'APROVADO' else 'REPROVADO' end;
 v.response:=coalesce(nullif(btrim(p_response),''),'Confirmada inclusão no BEES');v.resolved_at:=now();
 v.resolution_minutes:=greatest(0,extract(epoch from(v.resolved_at-v.created_at))/60);
 v.within_sla:=v.resolution_minutes<=v.sla_minutes;event:=case p_action when 'APPROVE' then 'APPROVED' else 'REJECTED' end;
 end if;
 else raise exception 'INVALID_ORDER_TRANSITION';end if;
 update public.order_requests set status=v.status,analyst_id=v.analyst_id,analyst_name=v.analyst_name,claimed_at=v.claimed_at,
 response=v.response,resolved_at=v.resolved_at,resolution_minutes=v.resolution_minutes,within_sla=v.within_sla,
 revision=revision+1,updated_at=now() where id=v.id returning * into v;
 insert into public.order_request_audit(request_id,unit,event,actor_id,actor_name,previous,next) values(v.id,p_unit,event,auth.uid(),actor,old,to_jsonb(v));
 insert into public.order_request_operations values(auth.uid(),p_operation,payload,to_jsonb(v));return to_jsonb(v);
end$$;

create function public.orders_snapshot(p_unit text,p_from date,p_to date,p_scope text default 'OWN') returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare all_rows boolean;rows jsonb;n integer;begin
 all_rows:=public.orders_can(p_unit,'ORDERS_REVIEW') or public.orders_can(p_unit,'ORDERS_MANAGE') or public.orders_can(p_unit,'ORDERS_VIEW_ALL')
 or public.orders_can(p_unit,'ORDERS_DASHBOARD') or public.orders_can(p_unit,'ORDERS_AUDIT');
 if not(all_rows or public.orders_can(p_unit,'ORDERS_OWN') or public.orders_can(p_unit,'ORDERS_CREATE')) then raise exception 'FORBIDDEN';end if;
 if p_scope is null or p_scope not in ('OWN','ALL','QUEUE','PRODUCTIVITY') or(p_scope<>'OWN' and not all_rows) then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 then raise exception 'INVALID_PERIOD';end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id),'[]'::jsonb),count(*) into rows,n from (
 select * from public.order_requests where unit=p_unit
 and (case p_scope when 'QUEUE' then status in ('PENDENTE','EM_ANALISE')
 when 'PRODUCTIVITY' then resolved_at>=(p_from::timestamp at time zone 'America/Sao_Paulo') and resolved_at<((p_to+1)::timestamp at time zone 'America/Sao_Paulo')
 else created_at>=(p_from::timestamp at time zone 'America/Sao_Paulo') and created_at<((p_to+1)::timestamp at time zone 'America/Sao_Paulo') end)
 and (p_scope<>'OWN' or created_by=auth.uid()) and (p_scope<>'PRODUCTIVITY' or analyst_id=auth.uid())
 order by created_at desc,id limit 5001) r;
 if n>5000 then raise exception 'REDUCE_PERIOD';end if;
 return jsonb_build_object('requests',rows,'settings',public.orders_settings(p_unit),'server_now',now());
end$$;
create function public.orders_history(p_unit text,p_id uuid default null,p_from date default current_date,p_to date default current_date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v jsonb;n int;begin
 if p_id is null then
 if not public.orders_can(p_unit,'ORDERS_AUDIT') then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 then raise exception 'INVALID_PERIOD';end if;
 elsif not exists(select 1 from public.order_requests r where r.unit=p_unit and r.id=p_id and (
 (r.created_by=auth.uid() and(public.orders_can(p_unit,'ORDERS_CREATE') or public.orders_can(p_unit,'ORDERS_OWN')))
 or public.orders_can(p_unit,'ORDERS_REVIEW') or public.orders_can(p_unit,'ORDERS_MANAGE') or public.orders_can(p_unit,'ORDERS_VIEW_ALL')
 or public.orders_can(p_unit,'ORDERS_DASHBOARD') or public.orders_can(p_unit,'ORDERS_AUDIT'))) then raise exception 'FORBIDDEN';end if;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.id desc),'[]'::jsonb),count(*) into v,n from (
 select * from public.order_request_audit where unit=p_unit and(case when p_id is not null then request_id=p_id else
 created_at>=(p_from::timestamp at time zone 'America/Sao_Paulo') and created_at<((p_to+1)::timestamp at time zone 'America/Sao_Paulo') end) order by id desc limit 5001) a;
 if n>5000 then raise exception 'REDUCE_PERIOD';end if;return v;
end$$;
create function public.orders_save_settings(p_unit text,p_revision int,p_operation uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare old jsonb;v public.order_request_settings%rowtype;actor text;prior public.order_request_operations%rowtype;
 payload jsonb:=jsonb_build_object('op','SETTINGS','unit',p_unit,'revision',p_revision,'data',p_data);
begin
 if not public.orders_can(p_unit,'ORDERS_CONFIG') then raise exception 'FORBIDDEN';end if;
 if p_operation is null then raise exception 'INVALID_OPERATION';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_operation::text,0));
 select * into prior from public.order_request_operations where actor_id=auth.uid() and operation_id=p_operation;
 if found then if prior.payload<>payload then raise exception 'OPERATION_CONFLICT';end if;return prior.result;end if;
 perform pg_advisory_xact_lock(hashtextextended('order-settings:'||p_unit,1));old:=public.orders_settings(p_unit);
 if(old->>'revision')::int is distinct from p_revision then raise exception 'ORDER_VERSION_CONFLICT';end if;
 insert into public.order_request_settings(unit,restricted_hours,morning_start,morning_end,afternoon_start,afternoon_end,route_sla,bypass_sla,updated_by)
 values(p_unit,(p_data->>'restricted_hours')::boolean,(p_data->>'morning_start')::int,(p_data->>'morning_end')::int,
 (p_data->>'afternoon_start')::int,(p_data->>'afternoon_end')::int,(p_data->>'route_sla')::int,(p_data->>'bypass_sla')::int,auth.uid())
 on conflict(unit) do update set restricted_hours=excluded.restricted_hours,morning_start=excluded.morning_start,morning_end=excluded.morning_end,
 afternoon_start=excluded.afternoon_start,afternoon_end=excluded.afternoon_end,route_sla=excluded.route_sla,bypass_sla=excluded.bypass_sla,
 updated_by=auth.uid(),updated_at=now(),revision=order_request_settings.revision+1 returning * into v;
 select name into actor from public.profiles where id=auth.uid();
 insert into public.order_request_audit(unit,event,actor_id,actor_name,previous,next) values(p_unit,'SETTINGS',auth.uid(),actor,old,to_jsonb(v));
 insert into public.order_request_operations values(auth.uid(),p_operation,payload,to_jsonb(v));return to_jsonb(v);
end$$;
do $$declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in
 ('orders_can','orders_settings','orders_customer','orders_create','orders_action','orders_snapshot','orders_history','orders_save_settings') loop
 execute format('revoke all on function %s from public,anon',f.signature);
 execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='order_requests') then
 alter publication supabase_realtime add table public.order_requests;end if;end if;
end$$;
commit;
