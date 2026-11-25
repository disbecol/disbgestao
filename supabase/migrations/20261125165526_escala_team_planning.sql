begin;
create schema if not exists escala_private;
revoke all on schema escala_private from public,anon,authenticated;
grant usage on schema escala_private to authenticated;
-- Escala uses the authenticated profile, existing unit memberships and explicit
-- capabilities. No anonymous access or direct client writes are granted.
do $constraint$ declare predicate text;names text[];begin
 select pg_get_expr(conbin,conrelid) into predicate from pg_constraint where conrelid='public.module_settings'::regclass and conname='module_settings_name_valid';
 if predicate is not null and position('''Escala''' in predicate)>0 then return;end if;
 if predicate is null then select array_agg(distinct name) into names from (select module_name name from public.module_settings union select unnest(array['NRI','Conferência','Contagem FEFO','Ativo de Giro','Materiais','Refugo','Avarias de Entrega','Avarias de Vendas','Validade do Estoque','Escalonada Digital','Puxada','Formulários','Devoluções','Pedidos','Apontamento Fora do Raio'])) n;predicate:=format('module_name=any(%L::text[])',names);end if;
 alter table public.module_settings drop constraint if exists module_settings_name_valid;
 execute format('alter table public.module_settings add constraint module_settings_name_valid check ((%s) or module_name=%L)',predicate,'Escala');
end;$constraint$;
insert into public.module_settings(module_name,active) values('Escala',true) on conflict do nothing;
insert into public.permissions(code,module,name,description,sort_order,active) values
 ('ESCALA_VIEW','Escala','Consultar escala','Calendário e relatórios da unidade autorizada.',10,true),
 ('ESCALA_MANAGE','Escala','Organizar escala','Gerenciar equipes, funcionários, caminhões, indisponibilidades e rascunhos.',20,true),
 ('ESCALA_APPROVE','Escala','Aprovar escala','Aprovar após validação dos conflitos; desbloqueio exclusivo do administrador.',30,true),
 ('ESCALA_CONFIG','Escala','Configurar escala','Configurar regras, feriados e limites da operação.',40,true)
on conflict(code) do update set module=excluded.module,name=excluded.name,description=excluded.description,active=true;
insert into public.role_permissions(role,permission_code) select 'ADMIN',code from public.permissions where code like 'ESCALA_%' on conflict do nothing;

create table if not exists public.escala_staff(
 id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),profile_id uuid references public.profiles(id),name text not null check(length(btrim(name)) between 1 and 150),job text not null check(length(btrim(job)) between 1 and 80),
 status text not null default 'ACTIVE' check(status in('ACTIVE','VACATION','LEAVE','INACTIVE')),vacation_start date,vacation_end date,notes text not null default '' check(length(notes)<=3000),revision integer not null default 1,deleted_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(unit,id),check(vacation_end is null or vacation_start is not null and vacation_end>=vacation_start),check(status<>'VACATION' or vacation_start is not null and vacation_end is not null)
);
create unique index if not exists escala_staff_profile on public.escala_staff(unit,profile_id) where profile_id is not null and deleted_at is null;
create table if not exists public.escala_teams(
 id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),code text not null check(length(code) between 1 and 40),name text not null check(length(btrim(name)) between 1 and 150),active boolean not null default true,draw_enabled boolean not null default true,notes text not null default '' check(length(notes)<=3000),revision integer not null default 1,deleted_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(unit,id),unique(unit,code)
);
create table if not exists public.escala_trucks(
 id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),label text not null check(length(btrim(label)) between 1 and 100),plate text not null default '' check(length(plate)<=12),team_id uuid,status text not null default 'UNAVAILABLE' check(status in('AVAILABLE','MAINTENANCE','UNAVAILABLE')),notes text not null default '' check(length(notes)<=3000),revision integer not null default 1,deleted_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(unit,id),foreign key(unit,team_id) references public.escala_teams(unit,id),check(status<>'AVAILABLE' or length(btrim(plate))>=7)
);
create unique index if not exists escala_truck_plate on public.escala_trucks(unit,upper(plate)) where deleted_at is null and plate<>'';
create table if not exists public.escala_memberships(
 id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),team_id uuid not null,staff_id uuid not null,starts_on date not null,ends_on date,override_reason text not null default '' check(length(override_reason)<=2000),revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(unit,id),foreign key(unit,team_id) references public.escala_teams(unit,id),foreign key(unit,staff_id) references public.escala_staff(unit,id),check(ends_on is null or ends_on>=starts_on)
);
create index if not exists escala_memberships_staff on public.escala_memberships(unit,staff_id,starts_on);
create table if not exists public.escala_unavailable(
 id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),team_id uuid,staff_id uuid,starts_on date not null,ends_on date not null,cancelled_at timestamptz,reason text not null check(length(btrim(reason)) between 1 and 2000),revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(unit,id),foreign key(unit,team_id) references public.escala_teams(unit,id),foreign key(unit,staff_id) references public.escala_staff(unit,id),check((team_id is null)<>(staff_id is null)),check(ends_on>=starts_on)
);
create table if not exists public.escala_holidays(
 id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),date date not null,name text not null check(length(btrim(name)) between 1 and 150),kind text not null check(kind in('NATIONAL','STATE','MUNICIPAL','OPTIONAL')),source_url text not null default '' check(source_url='' or source_url~'^https://'),automatic boolean not null default false,enabled boolean not null default true,operates boolean not null default false,previous_saturday boolean not null default true,confirmed boolean not null default false,revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(unit,id),unique(unit,date,name)
);
create table if not exists public.escala_rules(
 id uuid primary key default gen_random_uuid(),unit text not null unique references public.units(name),regime text not null default '5X2',start_minute integer not null default 420,work_minutes integer not null default 504,break_minutes integer not null default 60,weekly_minutes integer not null default 2520,daily_limit integer not null default 504,min_rest_minutes integer not null default 660,weekly_rest_minutes integer not null default 1440,max_consecutive integer not null default 5,max_week_days integer not null default 5,weekday_routes integer not null default 9,saturday_routes integer,sunday_rest boolean not null default true,holiday_treatment text not null default '',collective_reference text not null default '',reviewed_on date,effective_from date not null default '2026-01-01',effective_until date,overtime_minutes integer not null default 0,time_bank boolean not null default false,agreement_notes text not null default '',revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(start_minute between 0 and 1439 and work_minutes between 1 and 720 and break_minutes between 0 and 240 and start_minute+work_minutes+break_minutes<=1440),check(weekly_minutes between 1 and 2640 and daily_limit between 1 and 720 and min_rest_minutes>=660 and weekly_rest_minutes>=1440 and max_consecutive between 1 and 6 and max_week_days between 1 and 6),check(weekday_routes between 0 and 100 and (saturday_routes is null or saturday_routes between 0 and 100)),check(overtime_minutes between 0 and 240),check(length(collective_reference)<=2000 and length(holiday_treatment)<=2000 and length(agreement_notes)<=3000),check(effective_until is null or effective_until>=effective_from)
);
create table if not exists public.escala_months(
 id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),month date not null check(extract(day from month)=1),status text not null default 'DRAFT' check(status in('DRAFT','APPROVED','LOCKED')),revision integer not null default 1,seed text not null default '',algorithm_version text not null default '',notes text not null default '' check(length(notes)<=3000),rules_snapshot jsonb not null default '{}',approved_at timestamptz,approved_by uuid references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(unit,id),unique(unit,month)
);
create table if not exists public.escala_days(
 id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),month_id uuid not null,date date not null,kind text not null check(kind in('NORMAL','SATURDAY','SUNDAY','HOLIDAY')),required integer not null check(required between 0 and 100),notes text not null default '' check(length(notes)<=3000),confirmed boolean not null default false,locked boolean not null default false,manual boolean not null default false,unique(unit,id),unique(unit,date),foreign key(unit,month_id) references public.escala_months(unit,id)
);
create table if not exists public.escala_duties(
 id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),day_id uuid not null,team_id uuid not null,mode text not null check(mode in('ROUTE','REST','UNAVAILABLE','RESERVE')),truck_id uuid,members jsonb not null default '[]' check(jsonb_typeof(members)='array'),completed boolean not null default false,revision int not null default 1,foreign key(unit,day_id) references public.escala_days(unit,id),foreign key(unit,team_id) references public.escala_teams(unit,id),foreign key(unit,truck_id) references public.escala_trucks(unit,id),unique(day_id,team_id)
);
create index if not exists escala_duties_team on public.escala_duties(unit,team_id,day_id);
create table if not exists public.escala_opening_days(id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),team_id uuid not null,date date not null,mode text not null check(mode in('REST','RESERVE','UNAVAILABLE')),work_minutes int not null check(work_minutes between 0 and 720),members jsonb not null check(jsonb_typeof(members)='array'),actor_id uuid not null references public.profiles(id),updated_at timestamptz not null default now(),foreign key(unit,team_id) references public.escala_teams(unit,id),unique(unit,date,team_id));
create table if not exists public.escala_audit(
 id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),action text not null,record_id uuid,actor_id uuid not null references public.profiles(id),actor_name text not null,reason text not null default '',before jsonb,after jsonb,request_id uuid not null,request_hash text not null,result jsonb,changed_at timestamptz not null default now(),unique(unit,request_id)
);
create index if not exists escala_audit_unit_date on public.escala_audit(unit,changed_at desc,id);
create table if not exists public.escala_draws(id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),month_id uuid not null,seed text not null,algorithm_version text not null,rules_snapshot jsonb not null,actor_id uuid not null references public.profiles(id),created_at timestamptz not null default now(),foreign key(unit,month_id) references public.escala_months(unit,id));
create table if not exists public.escala_manual_changes(id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),month_id uuid not null,before jsonb,after jsonb,reason text not null,actor_id uuid not null references public.profiles(id),created_at timestamptz not null default now(),foreign key(unit,month_id) references public.escala_months(unit,id));
create table if not exists public.escala_approvals(id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),month_id uuid not null,action text not null check(action in('APPROVE','LOCK','UNLOCK')),reason text not null,actor_id uuid not null references public.profiles(id),created_at timestamptz not null default now(),foreign key(unit,month_id) references public.escala_months(unit,id));

create or replace function escala_private.has_access(p_unit text,p_permission text default 'ESCALA_VIEW') returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and public.has_permission(p_permission) and public.user_has_unit(p_unit) and exists(select 1 from public.units where name=p_unit and active) and exists(select 1 from public.module_settings where module_name='Escala' and active);
$$;
do $rls$ declare t text;begin
 foreach t in array array['escala_staff','escala_teams','escala_trucks','escala_memberships','escala_unavailable','escala_holidays','escala_rules','escala_months','escala_days','escala_duties','escala_audit','escala_draws','escala_manual_changes','escala_approvals','escala_opening_days'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('drop policy if exists escala_read on public.%I',t);
  execute format('create policy escala_read on public.%I for select to authenticated using(escala_private.has_access(unit))',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end;$rls$;

create or replace function public.escala_members(p_unit text,p_team uuid,p_date date) returns jsonb
language sql stable set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'job',s.job,'profile_id',s.profile_id) order by s.job desc,s.name),'[]')
 from public.escala_memberships m join public.escala_staff s on s.id=m.staff_id and s.unit=m.unit where m.unit=p_unit and m.team_id=p_team and p_date>=m.starts_on and (m.ends_on is null or p_date<=m.ends_on);
$$;
create or replace function public.escala_days_json(p_unit text,p_month uuid) returns jsonb
language sql stable set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('date',d.date,'kind',d.kind,'required',d.required,'notes',d.notes,'confirmed',d.confirmed,'locked',d.locked,'manual',d.manual,'duties',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'revision',a.revision,'completed',a.completed,'work_minutes',(select (m.rules_snapshot->>'work_minutes')::int from public.escala_months m where m.id=d.month_id),'team_id',a.team_id,'mode',a.mode,'truck_id',a.truck_id,'members',a.members) order by a.team_id),'[]') from public.escala_duties a where a.day_id=d.id and a.unit=p_unit)) order by d.date),'[]') from public.escala_days d where d.unit=p_unit and d.month_id=p_month;
$$;
create or replace function public.escala_state(p_unit text,p_month date) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c public.escala_months;begin
 if not escala_private.has_access(p_unit) then raise exception 'FORBIDDEN';end if;
 if extract(day from p_month)<>1 then raise exception 'ESCALA_MONTH_INVALID';end if;
 select * into c from public.escala_months where unit=p_unit and month=p_month;
 return jsonb_build_object(
  'staff',(select coalesce(jsonb_agg(to_jsonb(s) order by s.name),'[]') from public.escala_staff s where s.unit=p_unit),
  'teams',(select coalesce(jsonb_agg(to_jsonb(t) order by t.code),'[]') from public.escala_teams t where t.unit=p_unit),
  'trucks',(select coalesce(jsonb_agg(to_jsonb(t) order by t.label),'[]') from public.escala_trucks t where t.unit=p_unit),
  'memberships',(select coalesce(jsonb_agg(to_jsonb(m) order by m.starts_on),'[]') from public.escala_memberships m where m.unit=p_unit),
  'unavailable',(select coalesce(jsonb_agg(to_jsonb(u)),'[]') from public.escala_unavailable u where u.unit=p_unit),
  'holidays',(select coalesce(jsonb_agg(to_jsonb(h) order by h.date),'[]') from public.escala_holidays h where h.unit=p_unit and h.date between date_trunc('year',p_month)-interval '1 month' and date_trunc('year',p_month)+interval '2 years'),
  'rules',(select to_jsonb(r) from public.escala_rules r where r.unit=p_unit),
  'plan',case when c.id is null then null else to_jsonb(c)||jsonb_build_object('days',public.escala_days_json(p_unit,c.id)) end,
  'history',(select coalesce(jsonb_agg(value order by value->>'date'),'[]') from (
 select d value from public.escala_months m cross join lateral jsonb_array_elements(public.escala_days_json(p_unit,m.id)) d where m.unit=p_unit and m.month<>p_month and m.status in('APPROVED','LOCKED')
 union all select jsonb_build_object('date',o.date,'kind','NORMAL','required',0,'notes','Saldo inicial informado pela gestão','confirmed',true,'locked',true,'manual',true,'duties',jsonb_agg(jsonb_build_object('team_id',o.team_id,'mode',o.mode,'truck_id',null,'members',o.members,'work_minutes',o.work_minutes))) value from public.escala_opening_days o where o.unit=p_unit and not exists(select 1 from public.escala_days d join public.escala_months m on m.id=d.month_id where d.unit=p_unit and d.date=o.date and m.status in('APPROVED','LOCKED')) group by o.date) history),
  'audit',(select coalesce(jsonb_agg(a order by a.changed_at desc),'[]') from (select id,action,record_id,actor_name,reason,changed_at from public.escala_audit where unit=p_unit order by changed_at desc limit 100) a),
  'profiles',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'role',p.role) order by p.name),'[]') from public.profiles p join public.user_units u on u.user_id=p.id where u.unit_name=p_unit and p.active),
  'months',(select coalesce(jsonb_agg(jsonb_build_object('month',m.month,'status',m.status,'revision',m.revision) order by m.month desc),'[]') from public.escala_months m where m.unit=p_unit));
end;$$;

create or replace function public.escala_command(p_unit text,p_action text,p_id uuid,p_revision integer,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare tab text;allowed text[];base jsonb:='{}';clean jsonb;old jsonb;result jsonb;prior public.escala_audit;request_hash text;actor text;record_id uuid:=p_id;reason text:=btrim(coalesce(p_payload->>'reason',''));permission text;rev int;cal public.escala_months;day_row public.escala_days;day_data jsonb;duty jsonb;members jsonb;issues jsonb;v_date date;v_month date;v_id uuid;n int;entry record;begin
 permission:=case when p_action in('RULES_SAVE','HOLIDAY_SAVE','HOLIDAY_ARCHIVE','HOLIDAYS_SYNC','SETUP') then 'ESCALA_CONFIG' when p_action in('APPROVE','LOCK','UNLOCK') then 'ESCALA_APPROVE' else 'ESCALA_MANAGE' end;
 if not escala_private.has_access(p_unit,permission) then raise exception 'FORBIDDEN';end if;
 if p_request_id is null or p_revision<0 or jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload)>2000000 then raise exception 'ESCALA_PAYLOAD_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('escala:'||p_unit,0));
 request_hash:=md5(jsonb_build_array(p_action,p_id,p_revision,p_payload)::text);
 select * into prior from public.escala_audit where unit=p_unit and request_id=p_request_id;
 if found then if prior.request_hash<>request_hash or prior.actor_id<>auth.uid() then raise exception 'ESCALA_REQUEST_CONFLICT';end if;return prior.result;end if;
 select name into actor from public.profiles where id=auth.uid();
 if p_action='SETUP' then
  if (p_payload->>'teams')::int not between 1 and 100 or (p_payload->>'trucks')::int not between 1 and 100 then raise exception 'ESCALA_SETUP_INVALID';end if;
  if exists(select 1 from public.escala_teams where unit=p_unit) or exists(select 1 from public.escala_trucks where unit=p_unit) then raise exception 'ESCALA_ALREADY_SETUP';end if;
  for n in 1..(p_payload->>'teams')::int loop insert into public.escala_teams(unit,code,name) values(p_unit,lpad(n::text,2,'0'),'Equipe '||lpad(n::text,2,'0'));end loop;
  for n in 1..(p_payload->>'trucks')::int loop insert into public.escala_trucks(unit,label,notes) values(p_unit,'Caminhão '||lpad(n::text,2,'0'),'Cadastro inicial: informe a placa e confirme a disponibilidade.');end loop;
  insert into public.escala_rules(unit,agreement_notes) values(p_unit,'Regime 5x2 informado pela gestão: entrada 07h, trabalho de 8h24 e intervalo de 1h, inclusive aos sábados.') on conflict do nothing;
  result:=jsonb_build_object('ok',true);
 elsif p_action='HOLIDAYS_SYNC' then
  n:=(p_payload->>'year')::int;if n not between 2020 and 2100 then raise exception 'ESCALA_YEAR_INVALID';end if;
  for entry in select * from (values('01-01','Confraternização Universal','l0662'),('04-21','Tiradentes','l0662'),('05-01','Dia do Trabalho','l0662'),('09-07','Independência do Brasil','l0662'),('10-12','Nossa Senhora Aparecida','l6802'),('11-02','Finados','l0662'),('11-15','Proclamação da República','l0662'),('11-20','Consciência Negra','l14759'),('12-25','Natal','l0662')) h(md,title,law) loop
   if entry.law<>'l14759' or n>=2024 then insert into public.escala_holidays(unit,date,name,kind,source_url,automatic) values(p_unit,(n::text||'-'||entry.md)::date,entry.title,'NATIONAL',case when entry.law='l14759' then 'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14759.htm' else 'https://www.planalto.gov.br/ccivil_03/leis/'||entry.law||'.htm' end,true) on conflict(unit,date,name) do nothing;end if;
  end loop;
  v_date:=public.escala_easter(n)-2;
  insert into public.escala_holidays(unit,date,name,kind,source_url,automatic,enabled,previous_saturday) values(p_unit,v_date,'Sexta-feira Santa — confirmar lei municipal','MUNICIPAL','https://www.planalto.gov.br/ccivil_03/leis/l9093.htm',true,false,false) on conflict(unit,date,name) do nothing;
  result:=jsonb_build_object('ok',true);
 elsif p_action='MEMBERSHIP_TRANSFER' then
  select to_jsonb(m) into old from public.escala_memberships m where id=p_id and unit=p_unit for update;
  if old is null then raise exception 'ESCALA_NOT_FOUND';end if;if (old->>'revision')::int<>p_revision then raise exception 'ESCALA_VERSION_CONFLICT';end if;
  v_date:=(p_payload->>'date')::date;v_id:=(p_payload->>'team_id')::uuid;
  if reason='' then raise exception 'ESCALA_REASON_REQUIRED';end if;
  if v_date<=(old->>'starts_on')::date or (old->>'ends_on' is not null and v_date>(old->>'ends_on')::date) then raise exception 'ESCALA_TRANSFER_DATE';end if;
  if exists(select 1 from public.escala_memberships m join public.escala_teams t on t.id=m.team_id and t.active and t.deleted_at is null where m.unit=p_unit and m.staff_id=(old->>'staff_id')::uuid and m.id<>p_id and daterange(m.starts_on,m.ends_on,'[]')&&daterange(v_date,(old->>'ends_on')::date,'[]')) then raise exception 'ESCALA_DUPLICATE_MEMBERSHIP';end if;
  update public.escala_memberships set ends_on=v_date-1,revision=revision+1,updated_at=now() where id=p_id;
  insert into public.escala_memberships(unit,team_id,staff_id,starts_on,ends_on) values(p_unit,v_id,(old->>'staff_id')::uuid,v_date,(old->>'ends_on')::date) returning to_jsonb(escala_memberships.*) into result;
 elsif p_action='ROUTE_COMPLETE' then
  select to_jsonb(a)||jsonb_build_object('date',d.date) into old from public.escala_duties a join public.escala_days d on d.id=a.day_id where a.id=p_id and a.unit=p_unit for update of a;
  if old is null or old->>'mode'<>'ROUTE' then raise exception 'ESCALA_NOT_FOUND';end if;
  if (old->>'revision')::int<>p_revision then raise exception 'ESCALA_VERSION_CONFLICT';end if;
  if (old->>'date')::date>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'ESCALA_FUTURE_COMPLETION';end if;
  if reason='' then raise exception 'ESCALA_REASON_REQUIRED';end if;
  update public.escala_duties set completed=(p_payload->>'completed')::boolean,revision=revision+1 where id=p_id returning to_jsonb(escala_duties.*) into result;
 elsif p_action='OPENING_SAVE' then
  if (select revision from public.escala_rules where unit=p_unit) is distinct from p_revision then raise exception 'ESCALA_VERSION_CONFLICT';end if;
  v_month:=(p_payload->>'month')::date;
  if v_month is null or extract(day from v_month)<>1 or extract(dow from v_month) not between 2 and 6 or jsonb_typeof(p_payload->'days') is distinct from 'array' or jsonb_array_length(p_payload->'days')<>extract(dow from v_month)::int-1 or not coalesce((p_payload->>'attested')::boolean,false) then raise exception 'ESCALA_OPENING_INVALID';end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'days') x group by x->>'date' having count(*)<>1) then raise exception 'ESCALA_OPENING_INVALID';end if;
  for day_data in select value from jsonb_array_elements(p_payload->'days') loop
   v_date:=(day_data->>'date')::date;
   if v_date<date_trunc('week',v_month)::date or v_date>=v_month then raise exception 'ESCALA_OPENING_INVALID';end if;
   if exists(select 1 from public.escala_days d join public.escala_months m on m.id=d.month_id where d.unit=p_unit and d.date=v_date and m.status in('APPROVED','LOCKED')) then raise exception 'ESCALA_APPROVED_HISTORY_EXISTS';end if;
   if jsonb_typeof(day_data->'duties') is distinct from 'array' or exists(select 1 from public.escala_teams t where t.unit=p_unit and t.active and t.deleted_at is null and not exists(select 1 from jsonb_array_elements(day_data->'duties') x where x->>'team_id'=t.id::text)) then raise exception 'ESCALA_TEAM_MISSING';end if;
   for duty in select value from jsonb_array_elements(day_data->'duties') loop
    if not exists(select 1 from public.escala_teams where unit=p_unit and id=(duty->>'team_id')::uuid) then raise exception 'ESCALA_TEAM_INVALID';end if;
    if jsonb_array_length(public.escala_members(p_unit,(duty->>'team_id')::uuid,v_month))=0 then raise exception 'ESCALA_COMPOSE_FIRST';end if;
    insert into public.escala_opening_days(unit,team_id,date,mode,work_minutes,members,actor_id) values(p_unit,(duty->>'team_id')::uuid,v_date,duty->>'mode',case when duty->>'mode'='RESERVE' then (duty->>'work_minutes')::int else 0 end,public.escala_members(p_unit,(duty->>'team_id')::uuid,v_month),auth.uid()) on conflict(unit,date,team_id) do update set mode=excluded.mode,work_minutes=excluded.work_minutes,members=excluded.members,actor_id=excluded.actor_id,updated_at=now();
   end loop;
  end loop;update public.escala_rules set revision=revision+1,updated_at=now() where unit=p_unit;result:=jsonb_build_object('ok',true);
 elsif p_action='STAFF_IMPORT' then
  if jsonb_typeof(p_payload->'ids') is distinct from 'array' or jsonb_array_length(p_payload->'ids')>500 then raise exception 'ESCALA_PAYLOAD_INVALID';end if;
  n:=0;
  for entry in select p.id,p.name,p.role from public.profiles p join public.user_units u on u.user_id=p.id where u.unit_name=p_unit and p.active and (p_payload->'ids') ? p.id::text loop
   insert into public.escala_staff(unit,profile_id,name,job) values(p_unit,entry.id,entry.name,case when entry.role in('MOTORISTA','COLABORADOR_ENTREGA','MOTORISTA_PUXADOR') then 'Motorista' when entry.role='AJUDANTE_ENTREGA' then 'Ajudante' else initcap(replace(entry.role,'_',' ')) end) on conflict(unit,profile_id) where profile_id is not null and deleted_at is null do nothing;n:=n+1;
  end loop;
  result:=jsonb_build_object('ok',true,'selected',n);
 elsif p_action in('MONTH_SAVE','APPROVE','LOCK','UNLOCK') then
  v_month:=(p_payload->>'month')::date;
  if v_month is null or extract(day from v_month)<>1 or v_month<'2020-01-01' or v_month>'2100-12-01' then raise exception 'ESCALA_MONTH_INVALID';end if;
  select * into cal from public.escala_months where unit=p_unit and month=v_month for update;
  if coalesce(cal.revision,0)<>p_revision then raise exception 'ESCALA_VERSION_CONFLICT';end if;
  if p_id is not null and p_id is distinct from cal.id then raise exception 'ESCALA_NOT_FOUND';end if;
  record_id:=cal.id;old:=case when cal.id is null then null else to_jsonb(cal)||jsonb_build_object('days',public.escala_days_json(p_unit,cal.id)) end;
  if p_action='MONTH_SAVE' then
   if cal.id is not null and cal.status<>'DRAFT' then raise exception 'ESCALA_LOCKED';end if;
   if jsonb_typeof(p_payload->'days') is distinct from 'array' or jsonb_array_length(p_payload->'days')<>extract(day from v_month+interval '1 month'-interval '1 day')::int then raise exception 'ESCALA_DAYS_INVALID';end if;
   if exists(select 1 from jsonb_array_elements(p_payload->'days') x group by x->>'date' having count(*)<>1) then raise exception 'ESCALA_DAYS_INVALID';end if;
   if coalesce((p_payload->>'manual')::boolean,false) and reason='' then raise exception 'ESCALA_REASON_REQUIRED';end if;
   if cal.id is null then insert into public.escala_months(unit,month) values(p_unit,v_month) returning * into cal;end if;
   record_id:=cal.id;
   for day_data in select value from jsonb_array_elements(p_payload->'days') loop
    v_date:=(day_data->>'date')::date;
    if v_date<v_month or v_date>=v_month+interval '1 month' then raise exception 'ESCALA_DAYS_INVALID';end if;
    select * into day_row from public.escala_days where unit=p_unit and date=v_date;
    if day_row.locked and exists(select 1 from jsonb_array_elements(old->'days') prev where prev->>'date'=v_date::text and prev is distinct from day_data) and not (public.is_admin() and coalesce((p_payload->>'override_locked')::boolean,false) and reason<>'') then raise exception 'ESCALA_DAY_LOCKED';end if;
    if jsonb_typeof(day_data->'duties') is distinct from 'array' or jsonb_array_length(day_data->'duties')>100 or exists(select 1 from jsonb_array_elements(day_data->'duties') a where not exists(select 1 from public.escala_teams t where t.id=(a->>'team_id')::uuid and t.unit=p_unit)) then raise exception 'ESCALA_TEAM_INVALID';end if;
    if exists(select 1 from public.escala_teams t where t.unit=p_unit and t.active and t.deleted_at is null and not exists(select 1 from jsonb_array_elements(day_data->'duties') a where a->>'team_id'=t.id::text)) then raise exception 'ESCALA_TEAM_MISSING';end if;
    insert into public.escala_days(unit,month_id,date,kind,required,notes,confirmed,locked,manual) values(p_unit,cal.id,v_date,day_data->>'kind',(day_data->>'required')::int,coalesce(day_data->>'notes',''),coalesce((day_data->>'confirmed')::boolean,false),coalesce((day_data->>'locked')::boolean,false),coalesce((day_data->>'manual')::boolean,false)) on conflict(unit,date) do update set kind=excluded.kind,required=excluded.required,notes=excluded.notes,confirmed=excluded.confirmed,locked=excluded.locked,manual=excluded.manual returning * into day_row;
    -- An operating weekday cannot evade the configured route requirement.
    if extract(dow from v_date) between 1 and 5 and not exists(select 1 from public.escala_holidays h where h.unit=p_unit and h.date=v_date and h.enabled and h.kind<>'OPTIONAL' and not h.operates) and day_row.required<(select weekday_routes from public.escala_rules where unit=p_unit) then raise exception 'ESCALA_REQUIRED_ROUTES';end if;
    delete from public.escala_duties where unit=p_unit and day_id=day_row.id;
    for duty in select value from jsonb_array_elements(day_data->'duties') loop
     if coalesce((duty->>'completed')::boolean,false) and (duty->>'mode'<>'ROUTE' or v_date>(now() at time zone 'America/Sao_Paulo')::date) then raise exception 'ESCALA_FUTURE_COMPLETION';end if;
     v_id:=nullif(duty->>'truck_id','')::uuid;
     if v_id is not null and not exists(select 1 from public.escala_trucks where unit=p_unit and id=v_id) then raise exception 'ESCALA_TRUCK_INVALID';end if;
     members:=public.escala_members(p_unit,(duty->>'team_id')::uuid,v_date);
     insert into public.escala_duties(unit,day_id,team_id,mode,truck_id,members,completed) values(p_unit,day_row.id,(duty->>'team_id')::uuid,duty->>'mode',v_id,members,coalesce((duty->>'completed')::boolean,false));
    end loop;
   end loop;
   update public.escala_months set revision=p_revision+1,updated_at=now(),seed=left(coalesce(p_payload->>'seed',''),200),algorithm_version=left(coalesce(p_payload->>'algorithm_version',''),100),notes=coalesce(p_payload->>'notes',''),rules_snapshot=coalesce((select to_jsonb(r) from public.escala_rules r where unit=p_unit),'{}') where id=cal.id returning * into cal;
   if coalesce((p_payload->>'generated')::boolean,false) then insert into public.escala_draws(unit,month_id,seed,algorithm_version,rules_snapshot,actor_id) values(p_unit,cal.id,cal.seed,cal.algorithm_version,cal.rules_snapshot,auth.uid());end if;
   if coalesce((p_payload->>'manual')::boolean,false) then insert into public.escala_manual_changes(unit,month_id,before,after,reason,actor_id) values(p_unit,cal.id,old,p_payload,reason,auth.uid());end if;
  else
   if cal.id is null then raise exception 'ESCALA_NOT_FOUND';end if;
   if p_action='APPROVE' then
    if cal.status<>'DRAFT' then raise exception 'ESCALA_LOCKED';end if;
    issues:=public.escala_issues(p_unit,v_month);
    if jsonb_array_length(issues)>0 then raise exception 'ESCALA_APPROVAL_CONFLICT' using detail=issues::text;end if;
    update public.escala_months set status='APPROVED',approved_at=now(),approved_by=auth.uid(),revision=revision+1,updated_at=now() where id=cal.id returning * into cal;
   elsif p_action='LOCK' then
    if cal.status='DRAFT' then raise exception 'ESCALA_APPROVE_FIRST';end if;
    update public.escala_months set status='LOCKED',revision=revision+1,updated_at=now() where id=cal.id returning * into cal;
   else
    if not public.is_admin() then raise exception 'FORBIDDEN';end if;
    if reason='' then raise exception 'ESCALA_REASON_REQUIRED';end if;
    update public.escala_months set status='DRAFT',approved_at=null,approved_by=null,revision=revision+1,updated_at=now() where id=cal.id returning * into cal;
   end if;
   insert into public.escala_approvals(unit,month_id,action,reason,actor_id) values(p_unit,cal.id,p_action,reason,auth.uid());
  end if;
  result:=to_jsonb(cal)||jsonb_build_object('days',public.escala_days_json(p_unit,cal.id),'issues',public.escala_issues(p_unit,v_month));
 else
  case split_part(p_action,'_',1)
   when 'STAFF' then tab:='escala_staff';allowed:=array['profile_id','name','job','status','vacation_start','vacation_end','notes'];base:='{"profile_id":null,"job":"Ajudante","status":"ACTIVE","vacation_start":null,"vacation_end":null,"notes":"","deleted_at":null}';
   when 'TEAM' then tab:='escala_teams';allowed:=array['code','name','active','draw_enabled','notes'];base:='{"active":true,"draw_enabled":true,"notes":"","deleted_at":null}';
   when 'TRUCK' then tab:='escala_trucks';allowed:=array['label','plate','team_id','status','notes'];base:='{"plate":"","team_id":null,"status":"UNAVAILABLE","notes":"","deleted_at":null}';
   when 'MEMBERSHIP' then tab:='escala_memberships';allowed:=array['team_id','staff_id','starts_on','ends_on','override_reason'];base:='{"ends_on":null,"override_reason":""}';
   when 'UNAVAILABLE' then tab:='escala_unavailable';allowed:=array['team_id','staff_id','starts_on','ends_on','reason'];base:='{"team_id":null,"staff_id":null,"cancelled_at":null}';
   when 'HOLIDAY' then tab:='escala_holidays';allowed:=array['date','name','kind','source_url','enabled','operates','previous_saturday','confirmed'];base:='{"source_url":"","automatic":false,"enabled":true,"operates":false,"previous_saturday":true,"confirmed":false}';
   when 'RULES' then tab:='escala_rules';allowed:=array['regime','start_minute','work_minutes','break_minutes','weekly_minutes','daily_limit','min_rest_minutes','weekly_rest_minutes','max_consecutive','max_week_days','weekday_routes','saturday_routes','sunday_rest','holiday_treatment','collective_reference','reviewed_on','effective_from','effective_until','overtime_minutes','time_bank','agreement_notes'];
   else raise exception 'ESCALA_ACTION_INVALID';
  end case;
  if p_action not in('STAFF_SAVE','STAFF_ARCHIVE','TEAM_SAVE','TEAM_ARCHIVE','TRUCK_SAVE','TRUCK_ARCHIVE','MEMBERSHIP_SAVE','UNAVAILABLE_SAVE','UNAVAILABLE_ARCHIVE','HOLIDAY_SAVE','HOLIDAY_ARCHIVE','RULES_SAVE') then raise exception 'ESCALA_ACTION_INVALID';end if;
  if tab='escala_rules' then select to_jsonb(r) into old from public.escala_rules r where unit=p_unit for update;record_id:=(old->>'id')::uuid;
  elsif record_id is not null then execute format('select to_jsonb(t) from public.%I t where id=$1 and unit=$2 for update',tab) into old using record_id,p_unit;end if;
  if p_id is not null and (old is null or (old->>'id')::uuid is distinct from p_id) then raise exception 'ESCALA_NOT_FOUND';end if;
  if coalesce((old->>'revision')::int,0)<>p_revision then raise exception 'ESCALA_VERSION_CONFLICT';end if;
  select coalesce(jsonb_object_agg(key,value),'{}') into clean from jsonb_each(p_payload) where key=any(allowed);
  clean:=base||coalesce(old,'{}')||clean||jsonb_build_object('id',coalesce(record_id,gen_random_uuid()),'unit',p_unit,'revision',p_revision+1,'created_at',coalesce(old->>'created_at',now()::text),'updated_at',now());record_id:=(clean->>'id')::uuid;
  if tab='escala_holidays' and coalesce((old->>'automatic')::boolean,false) then clean:=clean||jsonb_build_object('date',old->'date','name',old->'name','kind',old->'kind','source_url',old->'source_url','enabled',case when old->>'kind'='NATIONAL' then 'true'::jsonb else clean->'enabled' end);end if;
  if p_action like '%_ARCHIVE' then
   if old is null then raise exception 'ESCALA_NOT_FOUND';end if;
   if reason='' then raise exception 'ESCALA_REASON_REQUIRED';end if;
   if tab='escala_holidays' then if (old->>'automatic')::boolean then raise exception 'ESCALA_AUTOMATIC_HOLIDAY';end if;clean:=clean||'{"enabled":false}';
   elsif tab='escala_unavailable' then clean:=clean||jsonb_build_object('cancelled_at',now());
   else clean:=clean||jsonb_build_object('deleted_at',now());end if;
  end if;
  if tab='escala_staff' and clean->>'profile_id' is not null and not exists(select 1 from public.user_units where user_id=(clean->>'profile_id')::uuid and unit_name=p_unit) then raise exception 'ESCALA_PROFILE_UNIT_INVALID';end if;
  if tab='escala_memberships' then
   if clean->>'override_reason'<>'' and not public.is_admin() then raise exception 'FORBIDDEN';end if;
   if exists(select 1 from public.escala_memberships m join public.escala_teams t on t.id=m.team_id and t.active and t.deleted_at is null where m.unit=p_unit and m.staff_id=(clean->>'staff_id')::uuid and m.id<>record_id and daterange(m.starts_on,m.ends_on,'[]')&&daterange((clean->>'starts_on')::date,(clean->>'ends_on')::date,'[]')) and (not public.is_admin() or nullif(btrim(clean->>'override_reason'),'') is null) then raise exception 'ESCALA_DUPLICATE_MEMBERSHIP';end if;
  end if;
  if tab='escala_rules' then clean:=clean||jsonb_build_object('regime',upper(btrim(clean->>'regime')));if length(clean->>'regime') not between 1 and 80 then raise exception 'ESCALA_RULES_INVALID';end if;end if;
  if tab='escala_rules' and (coalesce((clean->>'max_week_days')::int,99)>5 or coalesce((clean->>'max_consecutive')::int,99)>5) and (clean->>'regime')='5X2' then raise exception 'ESCALA_5X2_LIMIT';end if;
  if old is null then execute format('insert into public.%I select (jsonb_populate_record(null::public.%I,$1)).* returning to_jsonb(%I.*)',tab,tab,tab) into result using clean;
  else
   select string_agg(format('%1$I=(jsonb_populate_record(null::public.%2$I,$1)).%1$I',key,tab),',') into tab from jsonb_each(clean) where key<>all(array['id','unit','created_at']);
   -- The table identifier is selected exclusively from the fixed action whitelist.
   execute format('update public.%I set %s where id=$2 and unit=$3 returning to_jsonb(%I.*)',case split_part(p_action,'_',1) when 'STAFF' then 'escala_staff' when 'TEAM' then 'escala_teams' when 'TRUCK' then 'escala_trucks' when 'MEMBERSHIP' then 'escala_memberships' when 'UNAVAILABLE' then 'escala_unavailable' when 'HOLIDAY' then 'escala_holidays' else 'escala_rules' end,tab,case split_part(p_action,'_',1) when 'STAFF' then 'escala_staff' when 'TEAM' then 'escala_teams' when 'TRUCK' then 'escala_trucks' when 'MEMBERSHIP' then 'escala_memberships' when 'UNAVAILABLE' then 'escala_unavailable' when 'HOLIDAY' then 'escala_holidays' else 'escala_rules' end) into result using clean,record_id,p_unit;
  end if;
 end if;
 insert into public.escala_audit(unit,action,record_id,actor_id,actor_name,reason,before,after,request_id,request_hash,result) values(p_unit,case when p_action='MONTH_SAVE' and coalesce((p_payload->>'generated')::boolean,false) then 'DRAW' when p_action='MONTH_SAVE' and coalesce((p_payload->>'manual')::boolean,false) then 'MANUAL_CHANGE' else p_action end,record_id,auth.uid(),coalesce(actor,''),reason,old,p_payload,p_request_id,request_hash,result);
 return result;
end;$$;

create or replace function public.escala_work_days(p_unit text,p_cal uuid) returns table(team_id uuid,date date,members jsonb,minutes int)
language sql stable set search_path=public,pg_temp as $$
 select a.team_id,d.date,a.members,coalesce((m.rules_snapshot->>'work_minutes')::int,r.work_minutes) from public.escala_duties a join public.escala_days d on d.id=a.day_id join public.escala_months m on m.id=d.month_id join public.escala_rules r on r.unit=a.unit where a.unit=p_unit and a.mode in('ROUTE','RESERVE') and (m.id=p_cal or m.status in('APPROVED','LOCKED'))
 union all select o.team_id,o.date,o.members,o.work_minutes from public.escala_opening_days o where o.unit=p_unit and o.mode='RESERVE' and not exists(select 1 from public.escala_days d join public.escala_months m on m.id=d.month_id where d.unit=p_unit and d.date=o.date and (m.id=p_cal or m.status in('APPROVED','LOCKED')));
$$;
create or replace function public.escala_issues(p_unit text,p_month date) returns jsonb
language plpgsql stable set search_path=public,pg_temp as $$
#variable_conflict use_column
declare r public.escala_rules;c public.escala_months;d public.escala_days;v record;issues jsonb:='[]';n int;lim int;begin
 select * into r from public.escala_rules where unit=p_unit;select * into c from public.escala_months where unit=p_unit and month=p_month;
 if r.id is null or nullif(btrim(r.collective_reference),'') is null or r.reviewed_on is null then issues:=issues||jsonb_build_array(jsonb_build_object('code','RULES_REVIEW','message','Revise o regime e a referência do acordo ou convenção.','severity','ERROR'));end if;
 if r.id is null or c.id is null then return issues;end if;
 if extract(dow from p_month) between 2 and 6 and exists(select 1 from public.escala_teams t cross join generate_series(date_trunc('week',p_month)::date,p_month-1,interval '1 day') previous where t.unit=p_unit and t.active and t.deleted_at is null and not exists(select 1 from public.escala_duties a join public.escala_days d on d.id=a.day_id join public.escala_months m on m.id=d.month_id where a.unit=p_unit and a.team_id=t.id and d.date=previous::date and m.status in('APPROVED','LOCKED')) and not exists(select 1 from public.escala_opening_days o where o.unit=p_unit and o.team_id=t.id and o.date=previous::date)) then issues:=issues||jsonb_build_array(jsonb_build_object('code','MISSING_HISTORY','message','Informe o saldo inicial dos dias anteriores ao mês para validar a primeira semana.','severity','ERROR'));end if;
 if r.break_minutes<60 or r.work_minutes>r.daily_limit+r.overtime_minutes or 1440-r.work_minutes-r.break_minutes<r.min_rest_minutes then issues:=issues||jsonb_build_array(jsonb_build_object('code','WORK_HOURS','message','Jornada ou intervalos incompatíveis com os limites configurados.','severity','ERROR'));end if;
 for d in select * from public.escala_days where unit=p_unit and month_id=c.id order by date loop
  lim:=case when d.date>='2027-12-16' then 2400 when d.date>='2026-12-16' then 2520 else 2640 end;
  if d.date<r.effective_from or (r.effective_until is not null and d.date>r.effective_until) or r.weekly_minutes>lim or (d.date>='2026-12-16' and r.max_week_days>5) then issues:=issues||jsonb_build_array(jsonb_build_object('code','RULES_DATE','message','Revise a vigência e os limites da transição de jornada.','date',d.date,'severity','ERROR'));end if;
  select count(*) into n from public.escala_duties a where a.day_id=d.id and mode='ROUTE';
  if n<d.required then issues:=issues||jsonb_build_array(jsonb_build_object('code','STAFF_SHORTAGE','message','Equipes em rota abaixo da necessidade operacional.','date',d.date,'severity','ERROR'));end if;
  if extract(dow from d.date)=0 and r.sunday_rest and exists(select 1 from public.escala_duties where day_id=d.id and mode in('ROUTE','RESERVE')) then issues:=issues||jsonb_build_array(jsonb_build_object('code','SUNDAY','message','Domingo deve ser descanso de todas as equipes.','date',d.date,'severity','ERROR'));end if;
  if not d.confirmed and exists(select 1 from public.escala_holidays h where h.unit=p_unit and h.enabled and h.kind<>'OPTIONAL' and (h.date=d.date and h.operates or h.previous_saturday and extract(dow from h.date) between 1 and 5 and h.date-(extract(dow from h.date)::int+1)=d.date)) then issues:=issues||jsonb_build_array(jsonb_build_object('code','CONFIRM_OPERATION','message','Confirme a operação do feriado ou sábado especial.','date',d.date,'severity','ERROR'));end if;
  if n>0 and exists(select 1 from public.escala_holidays h where h.unit=p_unit and h.date=d.date and h.enabled and h.kind<>'OPTIONAL') and nullif(btrim(r.holiday_treatment),'') is null then issues:=issues||jsonb_build_array(jsonb_build_object('code','HOLIDAY_TREATMENT','message','Informe o tratamento do trabalho em feriado.','date',d.date,'severity','ERROR'));end if;
  if n>0 and exists(select 1 from public.escala_holidays h where h.unit=p_unit and h.date=d.date and h.enabled and h.kind<>'OPTIONAL' and (not h.operates or not h.confirmed or not d.confirmed)) then issues:=issues||jsonb_build_array(jsonb_build_object('code','HOLIDAY_OPERATION','message','A operação no feriado precisa ser autorizada e conferida.','date',d.date,'severity','ERROR'));end if;
  for v in select a.*,t.active,t.draw_enabled,t.deleted_at from public.escala_duties a join public.escala_teams t on t.id=a.team_id where a.day_id=d.id and a.mode in('ROUTE','RESERVE') loop
   if not v.active or not v.draw_enabled or v.deleted_at is not null or exists(select 1 from public.escala_unavailable u where u.unit=p_unit and u.cancelled_at is null and d.date between u.starts_on and u.ends_on and (u.team_id=v.team_id or exists(select 1 from public.escala_memberships m where m.unit=p_unit and m.team_id=v.team_id and m.staff_id=u.staff_id and d.date>=m.starts_on and (m.ends_on is null or d.date<=m.ends_on)))) or exists(select 1 from public.escala_memberships m join public.escala_staff s on s.id=m.staff_id where m.unit=p_unit and m.team_id=v.team_id and d.date>=m.starts_on and (m.ends_on is null or d.date<=m.ends_on) and (s.deleted_at is not null or s.status in('INACTIVE','LEAVE') or s.status='VACATION' and d.date between s.vacation_start and s.vacation_end)) then issues:=issues||jsonb_build_array(jsonb_build_object('code','UNAVAILABLE','message','Equipe ou integrante indisponível.','date',d.date,'team_id',v.team_id,'severity','ERROR'));end if;
   if not exists(select 1 from public.escala_memberships m join public.escala_staff s on s.id=m.staff_id where m.unit=p_unit and m.team_id=v.team_id and d.date>=m.starts_on and (m.ends_on is null or d.date<=m.ends_on) and upper(s.job) like '%MOTORISTA%') then issues:=issues||jsonb_build_array(jsonb_build_object('code','DRIVER','message','Equipe sem motorista.','date',d.date,'team_id',v.team_id,'severity','ERROR'));end if;
   if v.mode='ROUTE' and not exists(select 1 from public.escala_trucks t where t.id=v.truck_id and t.unit=p_unit and t.status='AVAILABLE' and t.deleted_at is null) then issues:=issues||jsonb_build_array(jsonb_build_object('code','TRUCK','message','Caminhão indisponível ou não associado à rota.','date',d.date,'team_id',v.team_id,'severity','ERROR'));end if;
  end loop;
  if exists(select 1 from public.escala_duties where day_id=d.id and mode='ROUTE' group by truck_id having count(*)>1) then issues:=issues||jsonb_build_array(jsonb_build_object('code','DUPLICATE_TRUCK','message','Caminhão repetido nas rotas.','date',d.date,'severity','ERROR'));end if;
  if exists(select 1 from public.escala_duties a join public.escala_memberships m on m.team_id=a.team_id and m.unit=a.unit and d.date>=m.starts_on and (m.ends_on is null or d.date<=m.ends_on) where a.day_id=d.id and a.mode in('ROUTE','RESERVE') group by m.staff_id having count(*)>1) then issues:=issues||jsonb_build_array(jsonb_build_object('code','DUPLICATE_STAFF','message','Funcionário escalado em duas equipes no mesmo horário.','date',d.date,'severity','ERROR'));end if;
 end loop;
 for v in select w.team_id,date_trunc('week',w.date)::date week,count(*) days,sum(w.minutes) minutes,max(w.date) last_day from public.escala_work_days(p_unit,c.id) w where w.date between date_trunc('week',p_month)::date and (p_month+interval '1 month'-interval '1 day')::date+6 group by w.team_id,date_trunc('week',w.date) loop
  if v.last_day>=p_month and v.week<=(p_month+interval '1 month'-interval '1 day')::date and v.week+6>=p_month and (v.days>r.max_week_days or v.minutes>r.weekly_minutes+r.overtime_minutes*v.days) then issues:=issues||jsonb_build_array(jsonb_build_object('code','WEEKLY_HOURS','message','Excesso de dias ou horas na semana de '||to_char(v.week,'DD/MM/YYYY')||'.','date',v.last_day,'team_id',v.team_id,'severity','ERROR'));end if;
 end loop;
 for v in with worked as (select w.team_id,w.date,w.date-row_number() over(partition by w.team_id order by w.date)::int grp from public.escala_work_days(p_unit,c.id) w where w.date between p_month-7 and (p_month+interval '1 month'-interval '1 day')::date+7) select team_id,min(date) first_day,max(date) last_day,count(*) days from worked group by team_id,grp having count(*)>r.max_consecutive and max(date)>=p_month and min(date)<p_month+interval '1 month' loop
  issues:=issues||jsonb_build_array(jsonb_build_object('code','CONSECUTIVE','message','Dias consecutivos acima do limite do regime.','date',v.last_day,'team_id',v.team_id,'severity','ERROR'));
 end loop;
 for v in select p->>'id' person_id,max(p->>'name') name,date_trunc('week',w.date)::date week,count(distinct w.date) days,sum(w.minutes) minutes,max(w.date) last_day from public.escala_work_days(p_unit,c.id) w cross join lateral jsonb_array_elements(w.members) p where w.date between date_trunc('week',p_month)::date and (p_month+interval '1 month'-interval '1 day')::date+6 group by p->>'id',date_trunc('week',w.date) loop
  if v.last_day>=p_month and v.week<=(p_month+interval '1 month'-interval '1 day')::date and v.week+6>=p_month and (v.days>r.max_week_days or v.minutes>r.weekly_minutes+r.overtime_minutes*v.days) then issues:=issues||jsonb_build_array(jsonb_build_object('code','PERSON_WEEKLY','message',v.name||': dias ou horas semanais acima do limite, inclusive após transferência de equipe.','date',v.last_day,'severity','ERROR'));end if;
 end loop;
 for v in with working_dates as (select distinct p->>'id' person_id,p->>'name' name,w.date from public.escala_work_days(p_unit,c.id) w cross join lateral jsonb_array_elements(w.members) p where w.date between p_month-7 and (p_month+interval '1 month'-interval '1 day')::date+7),groups as (select *,date-row_number() over(partition by person_id order by date)::int grp from working_dates) select person_id,max(name) name,count(*) days,max(date) last_day,min(date) first_day from groups group by person_id,grp having count(*)>r.max_consecutive and max(date)>=p_month and min(date)<p_month+interval '1 month' loop
  issues:=issues||jsonb_build_array(jsonb_build_object('code','PERSON_CONSECUTIVE','message',v.name||': dias consecutivos acima do limite, inclusive após transferência de equipe.','date',v.last_day,'severity','ERROR'));
 end loop;
 return issues;
end;$$;

create or replace function public.escala_easter(y int) returns date language plpgsql immutable set search_path=public,pg_temp as $$
declare a int:=y%19;b int:=y/100;c int:=y%100;d int:=b/4;e int:=b%4;f int:=(b+8)/25;g int:=(b-f+1)/3;h int:=(19*a+b-d-g+15)%30;i int:=c/4;k int:=c%4;l int:=(32+2*e+2*i-h-k)%7;m int:=(a+11*h+22*l)/451;n int:=h+l-7*m+114;begin return make_date(y,n/31,n%31+1);end;$$;
create or replace function public.escala_audit_page(p_unit text,p_offset integer default 0) returns table(id uuid,unit text,action text,record_id uuid,actor_name text,reason text,changed_at timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin if not escala_private.has_access(p_unit) then raise exception 'FORBIDDEN';end if;if p_offset<0 or p_offset>100000 then raise exception 'ESCALA_PAGE_INVALID';end if;return query select a.id,a.unit,a.action,a.record_id,a.actor_name,a.reason,a.changed_at from public.escala_audit a where a.unit=p_unit order by a.changed_at desc,a.id limit 100 offset p_offset;end;$$;
create or replace function public.escala_audit_detail(p_unit text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin if not escala_private.has_access(p_unit) then raise exception 'FORBIDDEN';end if;return (select jsonb_build_object('id',a.id,'action',a.action,'record_id',a.record_id,'actor_name',a.actor_name,'reason',a.reason,'before',a.before,'after',a.after,'changed_at',a.changed_at) from public.escala_audit a where a.unit=p_unit and a.id=p_id);end;$$;
-- Internal helpers are not RPC endpoints. Public entry points verify identity,
-- permission and unit on every call, including retries and approvals.
revoke all on function public.escala_members(text,uuid,date),public.escala_days_json(text,uuid),public.escala_issues(text,date),public.escala_easter(int),public.escala_work_days(text,uuid) from public,anon,authenticated;
revoke all on function escala_private.has_access(text,text),public.escala_state(text,date),public.escala_command(text,text,uuid,integer,jsonb,uuid),public.escala_audit_page(text,integer),public.escala_audit_detail(text,uuid) from public,anon;
grant execute on function escala_private.has_access(text,text),public.escala_state(text,date),public.escala_command(text,text,uuid,integer,jsonb,uuid),public.escala_audit_page(text,integer),public.escala_audit_detail(text,uuid) to authenticated;
-- Initial slots have no invented employees or vehicle plates. Trucks remain
-- unavailable until the administrator confirms their real registrations.
insert into public.escala_rules(unit,agreement_notes) select name,'Regime 5x2 informado pela gestão: entrada 07h, 8h24 de trabalho e 1h de almoço. Conferir o instrumento aplicável antes de aprovar.' from public.units where active on conflict(unit) do nothing;
insert into public.escala_teams(unit,code,name) select u.name,lpad(n::text,2,'0'),'Equipe '||lpad(n::text,2,'0') from public.units u cross join generate_series(1,10) n where u.active and not exists(select 1 from public.escala_teams t where t.unit=u.name) on conflict(unit,code) do nothing;
insert into public.escala_trucks(unit,label,notes) select u.name,'Caminhão '||lpad(n::text,2,'0'),'Cadastro inicial: informe a placa e confirme a disponibilidade.' from public.units u cross join generate_series(1,9) n where u.active and not exists(select 1 from public.escala_trucks t where t.unit=u.name);
-- Statutory fixed dates are calculated for the supported planning horizon.
-- Existing local operating decisions are preserved by the unique key.
insert into public.escala_holidays(unit,date,name,kind,source_url,automatic)
select u.name,(y::text||'-'||h.md)::date,h.title,'NATIONAL',case when h.law='l14759' then 'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14759.htm' else 'https://www.planalto.gov.br/ccivil_03/leis/'||h.law||'.htm' end,true
from public.units u cross join generate_series(2020,2100) y cross join (values('01-01','Confraternização Universal','l0662'),('04-21','Tiradentes','l0662'),('05-01','Dia do Trabalho','l0662'),('09-07','Independência do Brasil','l0662'),('10-12','Nossa Senhora Aparecida','l6802'),('11-02','Finados','l0662'),('11-15','Proclamação da República','l0662'),('11-20','Consciência Negra','l14759'),('12-25','Natal','l0662')) h(md,title,law)
where u.active and (h.law<>'l14759' or y>=2024) on conflict(unit,date,name) do nothing;
insert into public.escala_holidays(unit,date,name,kind,source_url,automatic,enabled,previous_saturday)
select u.name,public.escala_easter(y)-2,'Sexta-feira Santa — confirmar lei municipal','MUNICIPAL','https://www.planalto.gov.br/ccivil_03/leis/l9093.htm',true,false,false from public.units u cross join generate_series(2020,2100) y where u.active on conflict(unit,date,name) do nothing;
notify pgrst,'reload schema';
commit;
