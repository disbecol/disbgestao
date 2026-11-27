begin;
-- Warehouse calendars are isolated from delivery calendars. Staff identities
-- remain in Cadastro de Equipes; this migration creates no login or roster row.
create table public.escala_warehouse_settings(unit text primary key references public.units(name),config jsonb not null,revision integer not null default 1,updated_at timestamptz not null default now(),updated_by uuid references public.profiles(id));
create table public.escala_warehouse_months(id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),month date not null check(extract(day from month)=1),status text not null default 'DRAFT' check(status in('DRAFT','APPROVED','LOCKED')),revision integer not null default 1,seed text not null default '',days jsonb not null default '[]',config_snapshot jsonb not null,notes text not null default '' check(length(notes)<=3000),approved_at timestamptz,approved_by uuid references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(unit,month));
create table public.escala_warehouse_audit(id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),action text not null,record_id uuid,actor_id uuid not null references public.profiles(id),actor_name text not null,reason text not null default '',before jsonb,after jsonb,request_id uuid not null,request_hash text not null,result jsonb not null,changed_at timestamptz not null default now(),unique(unit,request_id));
create index escala_warehouse_audit_unit_date on public.escala_warehouse_audit(unit,changed_at desc);
alter table public.escala_warehouse_settings enable row level security;
alter table public.escala_warehouse_months enable row level security;
alter table public.escala_warehouse_audit enable row level security;
create policy warehouse_settings_read on public.escala_warehouse_settings for select to authenticated using(escala_private.has_access(unit));
create policy warehouse_months_read on public.escala_warehouse_months for select to authenticated using(escala_private.has_access(unit));
create policy warehouse_audit_read on public.escala_warehouse_audit for select to authenticated using(escala_private.has_access(unit));
revoke all on public.escala_warehouse_settings,public.escala_warehouse_months,public.escala_warehouse_audit from public,anon,authenticated;
grant select on public.escala_warehouse_settings,public.escala_warehouse_months,public.escala_warehouse_audit to authenticated;

create function escala_private.warehouse_people(p_unit text) returns jsonb language sql stable set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'job',p.job,'role',case when lower(p.job) like '%conferente%' then 'CHECKER' when lower(p.job) like '%empilh%' then 'FORKLIFT' else 'HELPER' end,'active',p.active,'status',case when not p.active then 'INACTIVE' else coalesce(e.status,'ACTIVE') end,'vacation_start',e.vacation_start,'vacation_end',e.vacation_end) order by p.name),'[]')
 from staff_people p join staff_people_units u on u.person_id=p.id and u.unit=p_unit left join escala_staff e on e.person_id=p.id and e.unit=p_unit and e.deleted_at is null
 where translate(lower(p.area),'áãâéêíóôõúç','aaaeeiooouc')='armazem' and (lower(p.job) like '%conferente%' or lower(p.job) like '%empilh%' or lower(p.job) like 'ajudante%');
$$;
create function escala_private.warehouse_shift(p_shift jsonb) returns jsonb language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare s jsonb;v_start integer;v_end integer;v_previous integer:=-1;v_day integer:=0;v_first integer;v_total integer:=0;
begin
 if jsonb_typeof(p_shift->'segments') is distinct from 'array' or jsonb_array_length(p_shift->'segments') not between 1 and 4 then raise exception 'WH_SHIFT_INVALID';end if;
 for s in select value from jsonb_array_elements(p_shift->'segments') loop
  if coalesce(s->>'start','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(s->>'end','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'WH_SHIFT_INVALID';end if;
  v_start:=split_part(s->>'start',':',1)::int*60+split_part(s->>'start',':',2)::int+v_day*1440;
  if v_start<v_previous then v_day:=v_day+1;v_start:=v_start+1440;end if;
  v_end:=split_part(s->>'end',':',1)::int*60+split_part(s->>'end',':',2)::int+v_day*1440;if v_end<=v_start then v_end:=v_end+1440;end if;
  v_first:=coalesce(v_first,v_start);v_total:=v_total+v_end-v_start;v_previous:=v_end;
 end loop;
 if coalesce(p_shift->>'break_minutes','')!~'^[0-9]{1,3}$' or (p_shift->>'break_minutes')::int not between 0 and 180 or v_total-(p_shift->>'break_minutes')::int not between 1 and 960 or v_previous-v_first>1440 then raise exception 'WH_SHIFT_INVALID';end if;
 return jsonb_build_object('start',v_first,'end',v_previous,'minutes',v_total-(p_shift->>'break_minutes')::int);
end;
$$;
create function escala_private.warehouse_validate_config(p_unit text,c jsonb) returns void language plpgsql stable set search_path=public,pg_temp as $$
#variable_conflict use_column
declare s jsonb;r record;w jsonb;cell jsonb;goal record;section record;roster jsonb:=escala_private.warehouse_people(p_unit);
begin
 if jsonb_typeof(c) is distinct from 'object' or pg_column_size(c)>200000 or c->>'version' is distinct from '1' then raise exception 'WH_CONFIG_INVALID';end if;
 if nullif(c->>'anchor_date','') is not null and (extract(dow from (c->>'anchor_date')::date)<>1 or (c->>'anchor_date')::date not between '2020-01-01' and '2100-12-31') then raise exception 'WH_ANCHOR_MONDAY';end if;
 if jsonb_typeof(c->'shifts') is distinct from 'array' or jsonb_array_length(c->'shifts') not between 1 and 30 then raise exception 'WH_SHIFT_INVALID';end if;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(c->'shifts')) then raise exception 'WH_SHIFT_INVALID';end if;
 for s in select value from jsonb_array_elements(c->'shifts') loop
  if coalesce(s->>'id','')!~'^[A-Z0-9_]{1,40}$' or length(btrim(coalesce(s->>'name',''))) not between 1 and 100 then raise exception 'WH_SHIFT_INVALID';end if;perform escala_private.warehouse_shift(s);
 end loop;
 if not exists(select 1 from jsonb_array_elements(c->'shifts') s where s->>'id'=c->>'helper_shift') then raise exception 'WH_SHIFT_INVALID';end if;
 if jsonb_typeof(c->'people') is distinct from 'object' then raise exception 'WH_CONFIG_INVALID';end if;
 for r in select * from jsonb_each(c->'people') loop
  if not exists(select 1 from jsonb_array_elements(roster) p where p->>'id'=r.key and p->>'role'<>'HELPER') then raise exception 'WH_PERSON_INVALID';end if;
  if not exists(select 1 from jsonb_array_elements(c->'shifts') s where s->>'id'=r.value->>'base_shift') then raise exception 'WH_SHIFT_INVALID';end if;
  if jsonb_typeof(r.value->'weeks') is distinct from 'array' or jsonb_array_length(r.value->'weeks') not between 1 and 8 then raise exception 'WH_CYCLE_INVALID';end if;
  for w in select value from jsonb_array_elements(r.value->'weeks') loop
   if jsonb_typeof(w) is distinct from 'array' or jsonb_array_length(w)<>7 or w->6->>'mode' is distinct from 'REST' then raise exception 'WH_CYCLE_INVALID';end if;
   for cell in select value from jsonb_array_elements(w) loop
    if coalesce(cell->>'mode','') not in('WORK','REST') or length(coalesce(cell->>'notes',''))>2000 then raise exception 'WH_CYCLE_INVALID';end if;
    if cell->>'mode'='WORK' and not exists(select 1 from jsonb_array_elements(c->'shifts') s where s->>'id'=cell->>'shift_id') then raise exception 'WH_SHIFT_INVALID';end if;
   end loop;
  end loop;
 end loop;
 if jsonb_typeof(c->'qlp') is distinct from 'object' then raise exception 'WH_CONFIG_INVALID';end if;
 for section in select * from jsonb_each(c->'qlp') loop
  if section.key not in('weekdays','dates') or jsonb_typeof(section.value) is distinct from 'object' then raise exception 'WH_CONFIG_INVALID';end if;
  for r in select * from jsonb_each(section.value) loop
   if section.key='weekdays' and r.key!~'^[1-6]$' or section.key='dates' and (r.key!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or r.key::date::text<>r.key) then raise exception 'WH_CONFIG_INVALID';end if;
   if jsonb_typeof(r.value) is distinct from 'object' then raise exception 'WH_CONFIG_INVALID';end if;
   for goal in select * from jsonb_each(r.value) loop
    if goal.key not in('CHECKER','FORKLIFT','HELPER') or jsonb_typeof(goal.value) is distinct from 'number' or goal.value::text!~'^[0-9]{1,4}$' or (goal.value::text)::int>1000 then raise exception 'WH_CONFIG_INVALID';end if;
   end loop;
  end loop;
 end loop;
 if jsonb_typeof(c->'rules') is distinct from 'object' or coalesce(c->'rules'->>'weekly_minutes','')!~'^[0-9]{1,4}$' or (c->'rules'->>'weekly_minutes')::int not between 1 and 2640 or coalesce(c->'rules'->>'daily_minutes','')!~'^[0-9]{1,3}$' or (c->'rules'->>'daily_minutes')::int not between 1 and 600 or coalesce(c->'rules'->>'min_rest_minutes','')!~'^[0-9]{1,4}$' or (c->'rules'->>'min_rest_minutes')::int not between 660 and 1440 then raise exception 'WH_RULES_INVALID';end if;
 if coalesce((c->'rules'->>'compensation')::boolean,false) and nullif(btrim(c->'rules'->>'reference'),'') is null then raise exception 'WH_RULES_REFERENCE';end if;
end;
$$;

create function escala_private.warehouse_issues(p_unit text,p_plan jsonb) returns jsonb language plpgsql stable set search_path=public,pg_temp as $$
#variable_conflict use_column
declare issues jsonb:='[]';c jsonb:=p_plan->'config_snapshot';d jsonb;p jsonb;s jsonb;t jsonb;v record;v_role text;v_goal int;v_count int;v_days jsonb;v_month date:=(p_plan->>'month')::date;
begin
 if nullif(c->>'anchor_date','') is null then issues:=issues||jsonb_build_array(jsonb_build_object('code','ANCHOR','message','Defina a segunda-feira de início do revezamento.','severity','ERROR'));end if;
 for d in select value from jsonb_array_elements(p_plan->'days') loop
  for p in select value from jsonb_array_elements(d->'people') where value->>'mode'='WORK' loop
   select value into s from jsonb_array_elements(c->'shifts') where value->>'id'=p->>'shift_id';
   if s is null then issues:=issues||jsonb_build_array(jsonb_build_object('code','SHIFT_MISSING','message',p->'person'->>'name'||': defina o turno.','date',d->>'date','person',p->'person'->>'id','severity','ERROR'));continue;end if;
   t:=escala_private.warehouse_shift(s);
   if (t->>'minutes')::int>(c->'rules'->>'daily_minutes')::int and not coalesce((c->'rules'->>'compensation')::boolean,false) then issues:=issues||jsonb_build_array(jsonb_build_object('code','DAILY_HOURS','message',p->'person'->>'name'||': jornada acima do limite diário configurado. Revise a compensação e o intervalo.','date',d->>'date','person',p->'person'->>'id','severity','ERROR'));end if;
   if jsonb_array_length(s->'segments')=1 and (s->>'break_minutes')::int<60 and (t->>'minutes')::int>360 then issues:=issues||jsonb_build_array(jsonb_build_object('code','BREAK','message',p->'person'->>'name'||': confira o intervalo do turno.','date',d->>'date','person',p->'person'->>'id','severity','ERROR'));end if;
  end loop;
  if (d->>'date')::date>=(c->>'anchor_date')::date and extract(dow from (d->>'date')::date)<>0 and not exists(select 1 from escala_holidays h where h.unit=p_unit and h.date=(d->>'date')::date and h.enabled and h.kind<>'OPTIONAL' and not h.operates) then
   foreach v_role in array array['CHECKER','FORKLIFT','HELPER'] loop
    v_goal:=coalesce(c->'qlp'->'dates'->(d->>'date')->>v_role,c->'qlp'->'weekdays'->(extract(dow from (d->>'date')::date)::int)::text->>v_role)::int;
    select count(*) into v_count from jsonb_array_elements(d->'people') p where p->'person'->>'role'=v_role and p->>'mode'='WORK';
    if v_goal is not null and v_count<v_goal then issues:=issues||jsonb_build_array(jsonb_build_object('code','QLP_SHORTAGE','message',case v_role when 'CHECKER' then 'Conferentes' when 'FORKLIFT' then 'Empilhadores' else 'Ajudantes de armazém' end||': '||v_count||' disponíveis; QLP configurado '||v_goal||'.','date',d->>'date','severity','ERROR'));end if;
   end loop;
  end if;
 end loop;
 select coalesce(jsonb_agg(warehouse_day),'[]') into v_days from(select day||jsonb_build_object('_config',m.config_snapshot) as warehouse_day from escala_warehouse_months m cross join lateral jsonb_array_elements(m.days) day where m.unit=p_unit and m.month<>v_month and m.month between v_month-interval '1 month' and v_month+interval '1 month' union all select value||jsonb_build_object('_config',c) from jsonb_array_elements(p_plan->'days')) q;
 for v in with rows as(select (d->>'date')::date date,p,d->'_config' cfg,date_trunc('week',(d->>'date')::date)::date week from jsonb_array_elements(v_days) d cross join lateral jsonb_array_elements(d->'people') p),calc as(select p->'person'->>'id' id,max(p->'person'->>'name') name,week,count(*) present,count(*) filter(where p->>'mode'='UNAVAILABLE') unavailable,count(*) filter(where p->>'mode'='REST' and (extract(dow from date) in(0,6) or not exists(select 1 from escala_holidays h where h.unit=p_unit and h.date=rows.date and h.enabled and h.kind<>'OPTIONAL' and not h.operates))) rests,count(*) filter(where p->>'mode'='WORK') worked,coalesce(sum(case when p->>'mode'='WORK' then (escala_private.warehouse_shift((select s from jsonb_array_elements(cfg->'shifts') s where s->>'id'=p->>'shift_id'))->>'minutes')::int else 0 end),0) minutes from rows where date>=(c->>'anchor_date')::date group by p->'person'->>'id',week) select * from calc where week<=v_month+interval '1 month'-interval '1 day' and week+6>=v_month loop
  if v.present=7 and v.unavailable=0 and v.rests<2 then issues:=issues||jsonb_build_array(jsonb_build_object('code','WEEKLY_REST','message',v.name||': tem apenas '||v.rests||' folga na semana de '||to_char(v.week,'DD/MM/YYYY')||'. Garanta duas folgas.','date',v.week+6,'person',v.id,'severity','ERROR'));end if;
  if v.worked>5 or v.minutes>(c->'rules'->>'weekly_minutes')::int then issues:=issues||jsonb_build_array(jsonb_build_object('code','WEEKLY_HOURS','message',v.name||': dias ou horas acima do limite na semana de '||to_char(v.week,'DD/MM/YYYY')||'.','date',v.week+6,'person',v.id,'severity','ERROR'));end if;
 end loop;
 for v in with work as(select p->'person'->>'id' id,p->'person'->>'name' name,(d->>'date')::date date,escala_private.warehouse_shift(s) times from jsonb_array_elements(v_days) d cross join lateral jsonb_array_elements(d->'people') p join lateral jsonb_array_elements(d->'_config'->'shifts') s on s->>'id'=p->>'shift_id' where p->>'mode'='WORK'),bounds as(select *,date::timestamp+((times->>'start')::int)*interval '1 minute' starts,date::timestamp+((times->>'end')::int)*interval '1 minute' ends from work),ordered as(select *,lag(ends) over(partition by id order by date) previous_end from bounds) select * from ordered where date>=v_month and date<v_month+interval '1 month' and starts-previous_end<((c->'rules'->>'min_rest_minutes')::int)*interval '1 minute' loop
  issues:=issues||jsonb_build_array(jsonb_build_object('code','INTERDAY_REST','message',v.name||': intervalo entre turnos abaixo do mínimo configurado.','date',v.date,'person',v.id,'severity','ERROR'));
 end loop;
 return issues;
end;
$$;

create function escala_private.warehouse_state(p_unit text,p_month date) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not escala_private.has_access(p_unit) then raise exception 'FORBIDDEN';end if;
 if p_month is null or extract(day from p_month)<>1 or p_month not between '2020-01-01' and '2100-12-01' then raise exception 'WH_MONTH_INVALID';end if;
 return jsonb_build_object('staff',escala_private.warehouse_people(p_unit),'config',(select config from escala_warehouse_settings where unit=p_unit),'config_revision',coalesce((select revision from escala_warehouse_settings where unit=p_unit),0),'holidays',coalesce((select jsonb_agg(to_jsonb(h)) from escala_holidays h where unit=p_unit and date between p_month-interval '1 year' and p_month+interval '1 year'),'[]'),'plan',(select to_jsonb(m) from escala_warehouse_months m where unit=p_unit and month=p_month),'history',coalesce((select jsonb_agg(to_jsonb(m) order by month) from escala_warehouse_months m where unit=p_unit and month<p_month),'[]'),'adjacent',coalesce((select jsonb_agg(to_jsonb(m) order by month) from escala_warehouse_months m where unit=p_unit and month between p_month-interval '1 month' and p_month+interval '1 month'),'[]'),'audit',coalesce((select jsonb_agg(to_jsonb(a) order by changed_at desc) from(select id,action,actor_name,reason,before,after,changed_at from escala_warehouse_audit where unit=p_unit order by changed_at desc limit 100) a),'[]'));
end;
$$;

create function escala_private.warehouse_command(p_unit text,p_action text,p_revision integer,p_payload jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
declare config_row escala_warehouse_settings;cal escala_warehouse_months;old jsonb;result jsonb;prior escala_warehouse_audit;digest text;roster jsonb;d jsonb;p jsonb;person jsonb;old_day jsonb;old_person jsonb;clean_day jsonb;clean_people jsonb;days jsonb:='[]';seen_dates date[]:='{}';seen_people text[];v_month date;v_date date;reason text:=left(coalesce(p_payload->>'reason',''),2000);issues jsonb;
begin
 if not escala_private.has_access(p_unit,case when p_action='SETTINGS_SAVE' then 'ESCALA_CONFIG' when p_action in('APPROVE','UNLOCK') then 'ESCALA_APPROVE' else 'ESCALA_MANAGE' end) then raise exception 'FORBIDDEN';end if;
 if p_request_id is null or p_revision<0 or jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload)>2000000 then raise exception 'WH_PAYLOAD_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('warehouse-escala:'||p_unit,0));digest:=md5(jsonb_build_array(p_action,p_revision,p_payload)::text);
 select * into prior from escala_warehouse_audit where unit=p_unit and request_id=p_request_id;
 if found then if prior.actor_id<>auth.uid() or prior.request_hash<>digest then raise exception 'WH_REQUEST_CONFLICT';end if;return prior.result;end if;
 if p_action='SETTINGS_SAVE' then
  select * into config_row from escala_warehouse_settings where unit=p_unit for update;
  if coalesce(config_row.revision,0)<>p_revision then raise exception 'WH_VERSION_CONFLICT';end if;
  perform escala_private.warehouse_validate_config(p_unit,p_payload->'config');old:=to_jsonb(config_row);
  insert into escala_warehouse_settings(unit,config,revision,updated_by) values(p_unit,p_payload->'config',p_revision+1,auth.uid()) on conflict(unit) do update set config=excluded.config,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=now() returning * into config_row;result:=to_jsonb(config_row);
 elsif p_action in('MONTH_SAVE','APPROVE','UNLOCK') then
  v_month:=(p_payload->>'month')::date;if v_month is null or extract(day from v_month)<>1 or v_month not between '2020-01-01' and '2100-12-01' then raise exception 'WH_MONTH_INVALID';end if;
  select * into cal from escala_warehouse_months where unit=p_unit and month=v_month for update;
  if coalesce(cal.revision,0)<>p_revision then raise exception 'WH_VERSION_CONFLICT';end if;old:=to_jsonb(cal);
  if p_action='UNLOCK' then
   if not public.is_admin() or cal.id is null or length(btrim(reason))<3 then raise exception 'FORBIDDEN';end if;
   update escala_warehouse_months set status='DRAFT',revision=revision+1,approved_at=null,approved_by=null,updated_at=now() where id=cal.id returning * into cal;
  elsif p_action='APPROVE' then
   if cal.id is null or cal.status<>'DRAFT' then raise exception 'WH_LOCKED';end if;
   issues:=escala_private.warehouse_issues(p_unit,to_jsonb(cal));if exists(select 1 from jsonb_array_elements(issues) i where i->>'severity'='ERROR') then raise exception 'WH_APPROVAL_CONFLICT' using detail=issues::text;end if;
   update escala_warehouse_months set status='APPROVED',revision=revision+1,approved_at=now(),approved_by=auth.uid(),updated_at=now() where id=cal.id returning * into cal;
  else
   if cal.id is not null and cal.status<>'DRAFT' then raise exception 'WH_LOCKED';end if;
   select * into config_row from escala_warehouse_settings where unit=p_unit;
   if config_row.unit is null or nullif(config_row.config->>'anchor_date','') is null then raise exception 'WH_ANCHOR_MISSING';end if;
   if coalesce((p_payload->>'config_revision')::int,-1)<>config_row.revision then raise exception 'WH_CONFIG_CHANGED';end if;
   if jsonb_typeof(p_payload->'days') is distinct from 'array' or jsonb_array_length(p_payload->'days')<>extract(day from v_month+interval '1 month'-interval '1 day')::int then raise exception 'WH_DAYS_INVALID';end if;
   roster:=escala_private.warehouse_people(p_unit);
   for d in select value from jsonb_array_elements(p_payload->'days') order by value->>'date' loop
    v_date:=(d->>'date')::date;if v_date is null or date_trunc('month',v_date)::date<>v_month or v_date=any(seen_dates) then raise exception 'WH_DAYS_INVALID';end if;seen_dates:=array_append(seen_dates,v_date);
    select value into old_day from jsonb_array_elements(coalesce(cal.days,'[]')) where value->>'date'=d->>'date';
    if coalesce((old_day->>'locked')::boolean,false) and d is distinct from old_day then raise exception 'WH_DAY_LOCKED';end if;
    if not coalesce((old_day->>'locked')::boolean,false) and coalesce((d->>'locked')::boolean,false) and (not public.is_admin() or length(btrim(reason))<3) then raise exception 'FORBIDDEN';end if;
    clean_people:='[]';seen_people:='{}';
    if jsonb_typeof(d->'people') is distinct from 'array' then raise exception 'WH_PEOPLE_INVALID';end if;
    for p in select value from jsonb_array_elements(d->'people') loop
     if p->'person'->>'id'=any(seen_people) then raise exception 'WH_PEOPLE_INVALID';end if;seen_people:=array_append(seen_people,p->'person'->>'id');
     select value into old_person from jsonb_array_elements(coalesce(old_day->'people','[]')) where value->'person'->>'id'=p->'person'->>'id';
     if coalesce((old_person->>'completed')::boolean,false) then if p is distinct from old_person then raise exception 'WH_ACTUAL_PROTECTED';end if;clean_people:=clean_people||jsonb_build_array(old_person);continue;end if;
     if coalesce((p->>'completed')::boolean,false) then raise exception 'WH_ACTUAL_PROTECTED';end if;
     select value into person from jsonb_array_elements(roster) where value->>'id'=p->'person'->>'id' and (value->>'active')::boolean and value->>'status'<>'INACTIVE';if person is null then raise exception 'WH_PERSON_INVALID';end if;
     if coalesce(p->>'mode','') not in('WORK','REST','UNAVAILABLE','UNASSIGNED') then raise exception 'WH_PEOPLE_INVALID';end if;
     if v_date<(config_row.config->>'anchor_date')::date and p->>'mode'<>'UNASSIGNED' or v_date>=(config_row.config->>'anchor_date')::date and p->>'mode'='UNASSIGNED' then raise exception 'WH_BEFORE_START';end if;
     if p->>'mode'='UNAVAILABLE' and not (person->>'status'='LEAVE' or person->>'status'='VACATION' and (person->>'vacation_start' is null or (person->>'vacation_start')::date<=v_date and (person->>'vacation_end' is null or (person->>'vacation_end')::date>=v_date))) then raise exception 'WH_UNAVAILABLE';end if;
     if p->>'mode'='WORK' then
      if extract(dow from v_date)=0 or exists(select 1 from escala_holidays h where h.unit=p_unit and h.date=v_date and h.enabled and h.kind<>'OPTIONAL' and not h.operates) then raise exception 'WH_CLOSED_DAY';end if;
      if person->>'status'='LEAVE' or person->>'status'='VACATION' and (person->>'vacation_start' is null or (person->>'vacation_start')::date<=v_date and (person->>'vacation_end' is null or (person->>'vacation_end')::date>=v_date)) then raise exception 'WH_UNAVAILABLE';end if;
      if not exists(select 1 from jsonb_array_elements(config_row.config->'shifts') s where s->>'id'=p->>'shift_id') then raise exception 'WH_SHIFT_INVALID';end if;
     end if;
     clean_people:=clean_people||jsonb_build_array(jsonb_build_object('person',jsonb_build_object('id',person->>'id','name',person->>'name','job',person->>'job','role',person->>'role'),'mode',p->>'mode','shift_id',case when p->>'mode'='WORK' then p->'shift_id' else 'null'::jsonb end,'notes',left(coalesce(p->>'notes',''),2000),'manual',coalesce((p->>'manual')::boolean,false),'completed',false));
    end loop;
    if exists(select 1 from jsonb_array_elements(roster) r where (r->>'active')::boolean and r->>'status'<>'INACTIVE' and not (r->>'id'=any(seen_people))) then raise exception 'WH_PERSON_MISSING';end if;
    clean_day:=jsonb_build_object('date',v_date,'kind',case when extract(dow from v_date)=0 then 'SUNDAY' when exists(select 1 from escala_holidays h where h.unit=p_unit and h.date=v_date and h.enabled and h.kind<>'OPTIONAL' and not h.operates) then 'HOLIDAY' else 'NORMAL' end,'locked',coalesce((d->>'locked')::boolean,false),'people',clean_people);days:=days||jsonb_build_array(clean_day);
   end loop;
   if exists(select 1 from jsonb_array_elements(coalesce(cal.days,'[]')) previous cross join lateral jsonb_array_elements(previous->'people') actual where coalesce((actual->>'completed')::boolean,false) and not exists(select 1 from jsonb_array_elements(days) d2 cross join lateral jsonb_array_elements(d2->'people') p2 where d2->>'date'=previous->>'date' and p2->'person'->>'id'=actual->'person'->>'id')) then raise exception 'WH_ACTUAL_PROTECTED';end if;
   if cal.id is not null and days is distinct from cal.days and length(btrim(reason))<3 then raise exception 'WH_REASON_REQUIRED';end if;
   insert into escala_warehouse_months(unit,month,revision,seed,days,config_snapshot,notes) values(p_unit,v_month,p_revision+1,left(coalesce(p_payload->>'seed',''),200),days,config_row.config,left(coalesce(p_payload->>'notes',''),3000)) on conflict(unit,month) do update set revision=excluded.revision,seed=excluded.seed,days=excluded.days,config_snapshot=excluded.config_snapshot,notes=excluded.notes,updated_at=now() returning * into cal;
  end if;
  result:=to_jsonb(cal)||jsonb_build_object('issues',escala_private.warehouse_issues(p_unit,to_jsonb(cal)));
 else raise exception 'WH_ACTION_INVALID';end if;
 insert into escala_warehouse_audit(unit,action,record_id,actor_id,actor_name,reason,before,after,request_id,request_hash,result) values(p_unit,p_action,cal.id,auth.uid(),coalesce((select name from profiles where id=auth.uid()),'Gestor'),reason,old,result,p_request_id,digest,result);
 return result;
end;
$$;
revoke all on function escala_private.warehouse_people(text),escala_private.warehouse_shift(jsonb),escala_private.warehouse_validate_config(text,jsonb),escala_private.warehouse_issues(text,jsonb),escala_private.warehouse_state(text,date),escala_private.warehouse_command(text,text,integer,jsonb,uuid) from public,anon,authenticated;
create function public.escala_warehouse_state(p_unit text,p_month date) returns jsonb language sql stable security invoker set search_path='' as $$select escala_private.warehouse_state(p_unit,p_month);$$;
create function public.escala_warehouse_command(p_unit text,p_action text,p_revision integer,p_payload jsonb,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select escala_private.warehouse_command(p_unit,p_action,p_revision,p_payload,p_request_id);$$;
revoke all on function public.escala_warehouse_state(text,date),public.escala_warehouse_command(text,text,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.escala_warehouse_state(text,date),public.escala_warehouse_command(text,text,integer,jsonb,uuid),escala_private.warehouse_state(text,date),escala_private.warehouse_command(text,text,integer,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
