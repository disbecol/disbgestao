begin;
alter table public.escala_teams add column fixed_group boolean not null default false;
alter table public.escala_months add column planning_mode text not null default 'TEAM' check(planning_mode in('TEAM','INDIVIDUAL'));
alter table public.escala_days add column people jsonb check(people is null or case when jsonb_typeof(people)='array' then jsonb_array_length(people)<=200 else false end);
-- Preserve all existing crews, memberships and history. Only identify the
-- manually maintained groups; starter groups have no assigned people here.
update public.escala_teams t set fixed_group=true where t.active and t.deleted_at is null and exists(select 1 from public.escala_memberships m where m.unit=t.unit and m.team_id=t.id and m.origin='MANUAL' and (m.ends_on is null or m.ends_on>=(now() at time zone 'America/Sao_Paulo')::date));
update public.escala_teams t set fixed_group=true where t.id in(select id from(select id,row_number() over(partition by unit order by code,id) n from public.escala_teams x where active and deleted_at is null and not exists(select 1 from public.escala_teams f where f.unit=x.unit and f.fixed_group)) ranked where n<=2);

create function escala_private.individual_roster(p_unit text,p_date date)
returns table(id uuid,name text,job text,profile_id uuid,fixed_team_id uuid,available boolean)
language sql stable set search_path=public,pg_temp as $$
 select s.id,s.name,s.job,s.profile_id,f.team_id,
 s.status not in('INACTIVE','LEAVE') and not(s.status='VACATION' and (s.vacation_start is null or s.vacation_start<=p_date and (s.vacation_end is null or s.vacation_end>=p_date)))
 and not exists(select 1 from escala_unavailable u where u.unit=p_unit and u.cancelled_at is null and p_date between u.starts_on and u.ends_on and (u.staff_id=s.id or u.team_id=f.team_id))
 from escala_staff s left join staff_people p on p.id=s.person_id
 left join lateral(select m.team_id from escala_memberships m join escala_teams t on t.id=m.team_id and t.unit=m.unit where m.unit=p_unit and m.staff_id=s.id and m.origin='MANUAL' and m.starts_on<=p_date and (m.ends_on is null or m.ends_on>=p_date) and t.active and t.deleted_at is null and t.fixed_group order by m.starts_on desc,m.id limit 1) f on true
 where s.unit=p_unit and s.deleted_at is null and s.status<>'INACTIVE' and s.job~*'^(motorista|ajudante)([ _(-]|$)' and (p.id is null or p.active and p.archived_at is null and forms_area_key(p.area)=forms_area_key('Entrega'));
$$;
create function escala_private.day_people(p_unit text,p_day uuid) returns jsonb
language sql stable set search_path=public,pg_temp as $$
 select coalesce(d.people,(select jsonb_agg(jsonb_build_object('person',member,'fixed_team_id',case when exists(select 1 from escala_memberships m where m.unit=p_unit and m.staff_id=(member->>'id')::uuid and m.team_id=a.team_id and m.origin='MANUAL' and m.starts_on<=d.date and (m.ends_on is null or m.ends_on>=d.date)) then a.team_id else null end,'mode',a.mode,'completed',a.completed)) from escala_duties a cross join lateral jsonb_array_elements(a.members) member where a.unit=p_unit and a.day_id=d.id),'[]') from escala_days d where d.unit=p_unit and d.id=p_day;
$$;
create or replace function public.escala_days_json(p_unit text,p_month uuid) returns jsonb
language sql stable set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('date',d.date,'kind',d.kind,'required',d.required,'notes',d.notes,'confirmed',d.confirmed,'locked',d.locked,'manual',d.manual,'duties',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'revision',a.revision,'completed',a.completed,'work_minutes',(select (m.rules_snapshot->>'work_minutes')::int from escala_months m where m.id=d.month_id),'team_id',a.team_id,'mode',a.mode,'truck_id',a.truck_id,'members',a.members) order by a.team_id),'[]') from escala_duties a where a.day_id=d.id and a.unit=p_unit))||case when d.people is null then '{}'::jsonb else jsonb_build_object('people',d.people) end order by d.date),'[]') from escala_days d where d.unit=p_unit and d.month_id=p_month;
$$;
alter function escala_private.escala_state(text,date) rename to escala_state_before_individual;
revoke all on function escala_private.escala_state_before_individual(text,date) from public,anon,authenticated;
create function escala_private.escala_state(p_unit text,p_month date) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not escala_private.has_access(p_unit) then raise exception 'FORBIDDEN';end if;
 return escala_private.escala_state_before_individual(p_unit,p_month)||jsonb_build_object('individual_enabled',true,'rotation_history',(select coalesce(jsonb_agg(day order by day->>'date'),'[]') from escala_months m cross join lateral jsonb_array_elements(public.escala_days_json(p_unit,m.id)) day where m.unit=p_unit and m.month<p_month));
end;$$;

create function escala_private.individual_issues(p_unit text,p_month date) returns jsonb
language plpgsql stable set search_path=public,pg_temp as $$
#variable_conflict use_column
declare v_result jsonb:='[]';r escala_rules;cal escala_months;d record;v record;v_expected text;
begin
 if not escala_private.has_access(p_unit) then raise exception 'FORBIDDEN';end if;
 select * into r from escala_rules where unit=p_unit;select * into cal from escala_months where unit=p_unit and month=p_month;
 if cal.id is null then return v_result;end if;
 if r.id is null or nullif(btrim(r.collective_reference),'') is null or r.reviewed_on is null then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','RULES_REVIEW','message','Revise a jornada e a referência do regime antes de aprovar.','severity','ERROR'));end if;
 if r.break_minutes<60 or r.work_minutes>r.daily_limit+r.overtime_minutes or 1440-r.work_minutes-r.break_minutes<r.min_rest_minutes or r.start_minute+r.work_minutes+r.break_minutes>1440 or r.max_week_days>5 or not r.sunday_rest then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','WORK_HOURS','message','Revise a jornada, os intervalos e as duas folgas semanais.','severity','ERROR'));end if;
 for d in select * from escala_days where unit=p_unit and month_id=cal.id order by date loop
  if d.people is null then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','MISSING_PERSON','message','Esta data não possui disponibilidade individual.','date',d.date,'severity','ERROR'));continue;end if;
  if d.date<r.effective_from or r.effective_until is not null and d.date>r.effective_until or r.weekly_minutes>(case when d.date>='2027-12-16' then 2400 when d.date>='2026-12-16' then 2520 else 2640 end) then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','RULES_DATE','message','Revise a vigência e os limites configurados.','date',d.date,'severity','ERROR'));end if;
  if extract(dow from d.date)=0 and exists(select 1 from jsonb_array_elements(d.people) p where p->>'mode' in('ROUTE','RESERVE')) then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','SUNDAY','message','Todos devem folgar no domingo.','date',d.date,'severity','ERROR'));end if;
  if exists(select 1 from escala_private.individual_roster(p_unit,d.date) p where not exists(select 1 from jsonb_array_elements(d.people) a where a->'person'->>'id'=p.id::text)) then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','MISSING_PERSON','message','Há colaboradores sem situação definida.','date',d.date,'severity','ERROR'));end if;
  for v in select a.value assignment,p.* from jsonb_array_elements(d.people) a join lateral escala_private.individual_roster(p_unit,d.date) p on p.id=(a.value->'person'->>'id')::uuid loop
   if v.assignment->>'mode' in('ROUTE','RESERVE') and not v.available then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','UNAVAILABLE','message',v.name||': indisponível nesta data.','date',d.date,'severity','ERROR'));end if;
   v_expected:=case when extract(dow from d.date) in(0,6) then 'REST' when not v.available then 'UNAVAILABLE' when exists(select 1 from escala_holidays h where h.unit=p_unit and h.date=d.date and h.enabled and h.kind<>'OPTIONAL' and not h.operates) then 'REST' else 'ROUTE' end;
   if v.fixed_team_id is not null and v.assignment->>'mode'<>v_expected and not coalesce((v.assignment->>'completed')::boolean,false) then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','FIXED_TEAM_SCHEDULE','message',v.name||': equipe fixa folga aos sábados e domingos.','date',d.date,'severity','ERROR'));end if;
  end loop;
  if extract(dow from d.date) between 1 and 5 and not exists(select 1 from escala_holidays h where h.unit=p_unit and h.date=d.date and h.enabled and h.kind<>'OPTIONAL' and not h.operates) then
   for v in select case when p->'person'->>'job'~*'^motorista' then 'DRIVER' else 'HELPER' end role,count(*) n from jsonb_array_elements(d.people) p where p->>'mode'='REST' and nullif(p->>'fixed_team_id','') is null group by 1 loop
    if v.n>(case when v.role='DRIVER' then 1 else 2 end) then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','REST_CAPACITY','message','Por dia útil, no máximo 1 motorista e 2 ajudantes de folga.','date',d.date,'severity','ERROR'));end if;
   end loop;
  end if;
 end loop;
 for v in with rows as (
  select d.date,p,coalesce((m.rules_snapshot->>'work_minutes')::int,r.work_minutes) minutes,exists(select 1 from escala_holidays h where h.unit=p_unit and h.date=d.date and h.enabled and h.kind<>'OPTIONAL' and not h.operates) holiday
  from escala_days d join escala_months m on m.id=d.month_id cross join lateral jsonb_array_elements(escala_private.day_people(p_unit,d.id)) p
  where d.unit=p_unit and d.date between date_trunc('week',p_month)::date and (p_month+interval '1 month'-interval '1 day')::date+6
 ),summary as (
  select p->'person'->>'id' id,max(p->'person'->>'name') name,date_trunc('week',date)::date week,count(distinct date) present,count(*) filter(where p->>'mode'='UNAVAILABLE') unavailable,count(*) filter(where p->>'mode'='REST') rests,count(*) filter(where p->>'mode' in('ROUTE','RESERVE')) worked,coalesce(sum(minutes) filter(where p->>'mode' in('ROUTE','RESERVE')),0) minutes,bool_or(nullif(p->>'fixed_team_id','') is not null) fixed,count(*) filter(where p->>'mode'='REST' and extract(dow from date)>0 and not holiday) ordinary,count(*) filter(where p->>'mode'='REST' and extract(dow from date)>0 and holiday) holidays
  from rows group by p->'person'->>'id',date_trunc('week',date)
 )select * from summary where week+6>=p_month and week<p_month+interval '1 month' loop
  if v.present=7 and v.unavailable=0 and v.rests<2 then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','PERSON_WEEKLY_REST','message',v.name||': precisa de duas folgas na semana de '||to_char(v.week,'DD/MM/YYYY')||'.','date',v.week+6,'severity','ERROR'));end if;
  if not v.fixed and v.ordinary>greatest(0,1-v.holidays) then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','DOUBLE_REST','message',v.name||': quem folga na semana deve estar disponível no sábado.','date',v.week+5,'severity','ERROR'));end if;
  if v.worked>5 or v.minutes>r.weekly_minutes+r.overtime_minutes*v.worked then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','PERSON_WEEKLY','message',v.name||': dias ou horas semanais acima do limite.','date',v.week+6,'severity','ERROR'));end if;
 end loop;
 return v_result;
end;$$;
alter function public.escala_issues(text,date) rename to escala_issues_before_individual;
revoke all on function public.escala_issues_before_individual(text,date) from public,anon,authenticated;
create function public.escala_issues(p_unit text,p_month date) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when exists(select 1 from public.escala_months where unit=p_unit and month=p_month and planning_mode='INDIVIDUAL') then escala_private.individual_issues(p_unit,p_month) else public.escala_issues_before_individual(p_unit,p_month) end;
$$;
revoke all on function public.escala_issues(text,date) from public,anon,authenticated;

alter function escala_private.escala_command(text,text,uuid,integer,jsonb,uuid) rename to escala_command_before_individual;
revoke all on function escala_private.escala_command_before_individual(text,text,uuid,integer,jsonb,uuid) from public,anon,authenticated;
create function escala_private.escala_command(p_unit text,p_action text,p_id uuid default null,p_revision integer default 0,p_payload jsonb default '{}',p_request_id uuid default gen_random_uuid()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare cal escala_months;prior escala_audit;v_old jsonb;v_result jsonb;v_hash text;v_day jsonb;a jsonb;v_clean jsonb;v_before_people jsonb;v_prior_assignment jsonb;v_old_day escala_days;d escala_days;person record;v_roster_ids uuid[];v_seen uuid[];v_person_id uuid;v_date date;v_month date;v_reason text:=btrim(coalesce(p_payload->>'reason',''));v_fixed uuid;v_mode text;
begin
 if not escala_private.has_access(p_unit,case when p_action in('RULES_SAVE','HOLIDAY_SAVE','HOLIDAY_ARCHIVE','HOLIDAYS_SYNC','SETUP') then 'ESCALA_CONFIG' when p_action in('APPROVE','LOCK','UNLOCK') then 'ESCALA_APPROVE' else 'ESCALA_MANAGE' end) then raise exception 'FORBIDDEN';end if;
 if p_request_id is null or p_revision<0 or jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload)>2000000 then raise exception 'ESCALA_PAYLOAD_INVALID';end if;
 perform pg_advisory_xact_lock(hashtext('staff-directory'));perform pg_advisory_xact_lock(hashtextextended('escala:'||p_unit,0));
 v_hash:=md5(jsonb_build_array(p_action,p_id,p_revision,p_payload)::text);
 select * into prior from escala_audit where unit=p_unit and request_id=p_request_id;
 if found then if prior.request_hash<>v_hash or prior.actor_id<>auth.uid() then raise exception 'ESCALA_REQUEST_CONFLICT';end if;return prior.result;end if;
 if p_action='MONTH_SAVE' and p_payload->>'planning_mode'='INDIVIDUAL' then
  v_month:=(p_payload->>'month')::date;
  if v_month is null or extract(day from v_month)<>1 or v_month<'2020-01-01' or v_month>'2100-12-01' then raise exception 'ESCALA_MONTH_INVALID';end if;
  select * into cal from escala_months where unit=p_unit and month=v_month for update;
  if coalesce(cal.revision,0)<>p_revision then raise exception 'ESCALA_VERSION_CONFLICT';end if;
  if p_id is not null and p_id is distinct from cal.id then raise exception 'ESCALA_NOT_FOUND';end if;
  if cal.id is not null and cal.status<>'DRAFT' then raise exception 'ESCALA_LOCKED';end if;
  if coalesce((p_payload->>'manual')::boolean,false) and v_reason='' then raise exception 'ESCALA_REASON_REQUIRED';end if;
  if jsonb_typeof(p_payload->'days') is distinct from 'array' or jsonb_array_length(p_payload->'days')<>extract(day from v_month+interval '1 month'-interval '1 day')::int or exists(select 1 from jsonb_array_elements(p_payload->'days') x group by x->>'date' having count(*)>1) then raise exception 'ESCALA_DAYS_INVALID';end if;
  v_old:=case when cal.id is null then null else to_jsonb(cal)||jsonb_build_object('days',public.escala_days_json(p_unit,cal.id)) end;
  if cal.id is null then insert into escala_months(unit,month) values(p_unit,v_month) returning * into cal;end if;
  for v_day in select value from jsonb_array_elements(p_payload->'days') loop
   v_date:=(v_day->>'date')::date;
   if v_date is null or v_date<v_month or v_date>=v_month+interval '1 month' or jsonb_typeof(v_day->'people') is distinct from 'array' or jsonb_array_length(v_day->'people')>200 then raise exception 'ESCALA_PEOPLE_INVALID';end if;
   select * into v_old_day from escala_days where unit=p_unit and date=v_date for update;
   v_before_people:=coalesce(escala_private.day_people(p_unit,v_old_day.id),'[]');
   if v_old_day.locked and not(public.is_admin() and coalesce((p_payload->>'override_locked')::boolean,false) and v_reason<>'') and (coalesce(v_day->'people','[]') is distinct from v_before_people or coalesce(v_day->>'notes','')<>v_old_day.notes or not coalesce((v_day->>'locked')::boolean,false)) then raise exception 'ESCALA_DAY_LOCKED';end if;
   select coalesce(array_agg(id),'{}') into v_roster_ids from escala_private.individual_roster(p_unit,v_date);v_seen:='{}';v_clean:='[]';
   for a in select value from jsonb_array_elements(v_day->'people') loop
    v_person_id:=(a->'person'->>'id')::uuid;v_mode:=a->>'mode';
    if v_person_id is null or v_person_id=any(v_seen) or v_mode is null or v_mode not in('ROUTE','REST','RESERVE','UNAVAILABLE') then raise exception 'ESCALA_PEOPLE_INVALID';end if;
    v_seen:=array_append(v_seen,v_person_id);select value into v_prior_assignment from jsonb_array_elements(v_before_people) where value->'person'->>'id'=v_person_id::text;
    if v_old_day.locked and not(public.is_admin() and coalesce((p_payload->>'override_locked')::boolean,false) and v_reason<>'') and v_prior_assignment is not null then v_clean:=v_clean||jsonb_build_array(v_prior_assignment);continue;end if;
    if coalesce((v_prior_assignment->>'completed')::boolean,false) then
     if v_mode<>v_prior_assignment->>'mode' or not coalesce((a->>'completed')::boolean,false) then raise exception 'ESCALA_ACTUAL_PROTECTED';end if;v_clean:=v_clean||jsonb_build_array(v_prior_assignment);continue;
    end if;
    if not v_person_id=any(v_roster_ids) then raise exception 'ESCALA_PERSON_INVALID';end if;
    if coalesce((a->>'completed')::boolean,false) then raise exception 'ESCALA_ACTUAL_PROTECTED';end if;
    select * into person from escala_private.individual_roster(p_unit,v_date) where id=v_person_id;
    if extract(dow from v_date)=0 and v_mode<>'REST' then raise exception 'ESCALA_SUNDAY_REST';end if;
    if v_mode='UNAVAILABLE' and (person.available or person.fixed_team_id is not null and extract(dow from v_date)=6) then raise exception 'ESCALA_PERSON_UNAVAILABLE';end if;
    if v_mode in('ROUTE','RESERVE') and exists(select 1 from escala_holidays h where h.unit=p_unit and h.date=v_date and h.enabled and h.kind<>'OPTIONAL' and not h.operates) then raise exception 'ESCALA_HOLIDAY_REST';end if;
    if v_mode in('ROUTE','RESERVE') and (not person.available or extract(dow from v_date)=0) then raise exception 'ESCALA_PERSON_UNAVAILABLE';end if;
    if person.fixed_team_id is not null and v_mode<>(case when extract(dow from v_date) in(0,6) then 'REST' when not person.available then 'UNAVAILABLE' when exists(select 1 from escala_holidays h where h.unit=p_unit and h.date=v_date and h.enabled and h.kind<>'OPTIONAL' and not h.operates) then 'REST' else 'ROUTE' end) then raise exception 'ESCALA_FIXED_TEAM_SCHEDULE';end if;
    v_clean:=v_clean||jsonb_build_array(jsonb_build_object('person',jsonb_build_object('id',person.id,'name',person.name,'job',person.job,'profile_id',person.profile_id),'fixed_team_id',person.fixed_team_id,'mode',v_mode,'completed',false,'work_minutes',(select work_minutes from escala_rules where unit=p_unit)));
   end loop;
   if (not v_old_day.locked and not v_roster_ids<@v_seen) or exists(select 1 from jsonb_array_elements(v_before_people) x where coalesce((x->>'completed')::boolean,false) and not (x->'person'->>'id')::uuid=any(v_seen)) then raise exception 'ESCALA_PERSON_MISSING';end if;
   insert into escala_days(unit,month_id,date,kind,required,notes,confirmed,locked,manual,people) values(p_unit,cal.id,v_date,v_day->>'kind',coalesce((v_day->>'required')::int,0),coalesce(v_day->>'notes',''),coalesce((v_day->>'confirmed')::boolean,true),coalesce((v_day->>'locked')::boolean,false),coalesce((v_day->>'manual')::boolean,false),v_clean) on conflict(unit,date) do update set kind=excluded.kind,required=excluded.required,notes=excluded.notes,confirmed=excluded.confirmed,locked=excluded.locked,manual=excluded.manual,people=excluded.people returning * into d;
   delete from escala_duties where unit=p_unit and day_id=d.id and not completed;
   for v_fixed in select t.id from escala_teams t where t.unit=p_unit and t.active and t.deleted_at is null and t.fixed_group loop
    insert into escala_duties(unit,day_id,team_id,mode,members) values(p_unit,d.id,v_fixed,escala_private.preserved_mode(p_unit,v_fixed,v_date),public.escala_members(p_unit,v_fixed,v_date)) on conflict(day_id,team_id) do nothing;
   end loop;
  end loop;
  update escala_months set planning_mode='INDIVIDUAL',revision=p_revision+1,updated_at=now(),seed=left(coalesce(p_payload->>'seed',''),200),algorithm_version=left(coalesce(p_payload->>'algorithm_version',''),100),notes=coalesce(p_payload->>'notes',''),rules_snapshot=coalesce((select to_jsonb(r) from escala_rules r where unit=p_unit),'{}') where id=cal.id returning * into cal;
  v_result:=to_jsonb(cal)||jsonb_build_object('days',public.escala_days_json(p_unit,cal.id),'issues',public.escala_issues(p_unit,v_month));
  if coalesce((p_payload->>'generated')::boolean,false) then insert into escala_draws(unit,month_id,seed,algorithm_version,rules_snapshot,actor_id) values(p_unit,cal.id,cal.seed,cal.algorithm_version,cal.rules_snapshot,auth.uid());end if;
  if coalesce((p_payload->>'manual')::boolean,false) then insert into escala_manual_changes(unit,month_id,before,after,reason,actor_id) values(p_unit,cal.id,v_old,p_payload,v_reason,auth.uid());end if;
  insert into escala_audit(unit,action,record_id,actor_id,actor_name,reason,before,after,request_id,request_hash,result) values(p_unit,case when coalesce((p_payload->>'generated')::boolean,false) then 'DRAW' when coalesce((p_payload->>'manual')::boolean,false) then 'MANUAL_CHANGE' else 'MONTH_SAVE' end,cal.id,auth.uid(),coalesce((select name from profiles where id=auth.uid()),''),v_reason,v_old,p_payload,p_request_id,v_hash,v_result);
  return v_result;
 end if;
 if p_action='MONTH_SAVE' and exists(select 1 from escala_months where unit=p_unit and month=(p_payload->>'month')::date and planning_mode='INDIVIDUAL') then raise exception 'ESCALA_UPDATE_REQUIRED';end if;
 if p_action='TEAM_SAVE' and coalesce((p_payload->>'active')::boolean,(select t.active from escala_teams t where t.id=p_id and t.unit=p_unit),true) and (p_id is null or coalesce((p_payload->>'fixed_group')::boolean,false) or exists(select 1 from escala_teams t where t.id=p_id and t.unit=p_unit and t.fixed_group)) and (select count(*) from escala_teams t where t.unit=p_unit and t.active and t.deleted_at is null and t.fixed_group and t.id is distinct from p_id)>=2 then raise exception 'ESCALA_FIXED_LIMIT';end if;
 v_result:=escala_private.escala_command_before_individual(p_unit,p_action,p_id,p_revision,p_payload,p_request_id);
 if p_action='SETUP' then update escala_teams set fixed_group=true,draw_enabled=false where id in(select t.id from escala_teams t where t.unit=p_unit and t.active and t.deleted_at is null order by t.code,t.id limit 2);end if;
 if p_action='TEAM_SAVE' and (p_id is null or coalesce((p_payload->>'fixed_group')::boolean,false)) then update escala_teams set fixed_group=true,draw_enabled=false where id=(v_result->>'id')::uuid and unit=p_unit returning to_jsonb(escala_teams.*) into v_result;update escala_audit set result=v_result where unit=p_unit and request_id=p_request_id;end if;
 return v_result;
end;$$;
revoke all on function escala_private.individual_roster(text,date),escala_private.day_people(text,uuid),escala_private.individual_issues(text,date),escala_private.escala_state(text,date),escala_private.escala_command(text,text,uuid,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function escala_private.escala_state(text,date),escala_private.escala_command(text,text,uuid,integer,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
