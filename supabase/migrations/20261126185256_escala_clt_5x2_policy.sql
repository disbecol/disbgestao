begin;
-- EC 141/2026, Decreto 13.173/2026, Portaria MTE 2.041/2026;
-- CLT arts. 58–59, 66–67, 71; Lei 605/1949 arts. 8–9.
-- No saved calendar, membership, approval or actual work record is changed.
alter table public.escala_rules add column daily_compensation boolean not null default false;
alter table public.escala_rules alter work_minutes set default 480,alter daily_limit set default 480,alter weekly_minutes set default 2400,alter max_consecutive set default 6;
-- Replace only the unreviewed starter settings, not an agreed company rule.
update public.escala_rules set work_minutes=480,daily_limit=480,weekly_minutes=2400,max_consecutive=6,
 agreement_notes='Regime geral 5x2: 8h de trabalho e 1h de intervalo. Compensação acima de 8h depende de instrumento aplicável.',revision=revision+1,updated_at=now()
 where revision=1 and nullif(btrim(collective_reference),'') is null and reviewed_on is null and work_minutes=504 and daily_limit=504 and weekly_minutes=2520;

create function escala_private.is_weekly_rest(p_unit text,p_date date,p jsonb) returns boolean
language sql stable set search_path=public,pg_temp as $$
 select p->>'mode'='REST' and (extract(dow from p_date)=0 or nullif(p->>'fixed_team_id','') is not null and extract(dow from p_date)=6
 or not exists(select 1 from escala_holidays h where h.unit=p_unit and h.date=p_date and h.enabled and h.kind<>'OPTIONAL' and not h.operates)
 or coalesce((p->>'weekly_rest')::boolean,extract(dow from p_date)=6));
$$;
revoke all on function escala_private.is_weekly_rest(text,date,jsonb) from public,anon,authenticated;

create or replace function escala_private.individual_issues(p_unit text,p_month date) returns jsonb
language plpgsql stable set search_path=public,pg_temp as $$
#variable_conflict use_column
declare v_result jsonb:='[]';r escala_rules;cal escala_months;d record;v record;v_expected text;
begin
 if not escala_private.has_access(p_unit) then raise exception 'FORBIDDEN';end if;
 select * into r from escala_rules where unit=p_unit;select * into cal from escala_months where unit=p_unit and month=p_month;
 if cal.id is null then return v_result;end if;
 if r.id is null or nullif(btrim(r.collective_reference),'') is null or r.reviewed_on is null then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','RULES_REVIEW','message','Revise a jornada e a referência do regime antes de aprovar.','severity','ERROR'));end if;
 if r.work_minutes>480 and (not r.daily_compensation or nullif(btrim(r.collective_reference),'') is null or r.reviewed_on is null) then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','DAILY_COMPENSATION','message','Jornada normal acima de 8h exige compensação autorizada no instrumento coletivo cadastrado.','severity','ERROR'));end if;
 if r.work_minutes+r.overtime_minutes>600 or r.overtime_minutes>120 or r.daily_limit>600 or r.min_rest_minutes<660 or r.weekly_rest_minutes<1440 or r.max_consecutive>6 then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','REST_BASELINE','message','Revise os limites diários e os descansos mínimos da CLT.','severity','ERROR'));end if;
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
  select p->'person'->>'id' id,max(p->'person'->>'name') name,date_trunc('week',date)::date week,count(distinct date) present,count(*) filter(where p->>'mode'='UNAVAILABLE') unavailable,count(*) filter(where escala_private.is_weekly_rest(p_unit,date,p)) rests,count(*) filter(where p->>'mode' in('ROUTE','RESERVE')) worked,coalesce(sum(minutes) filter(where p->>'mode' in('ROUTE','RESERVE')),0) minutes,bool_or(nullif(p->>'fixed_team_id','') is not null) fixed,count(*) filter(where escala_private.is_weekly_rest(p_unit,date,p) and extract(dow from date)>0) ordinary,count(*) filter(where p->>'mode'='REST' and extract(dow from date)>0 and holiday) holidays
  from rows group by p->'person'->>'id',date_trunc('week',date)
 )select * from summary where week+6>=p_month and week<p_month+interval '1 month' loop
  if v.present=7 and v.unavailable=0 and v.rests<2 then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','PERSON_WEEKLY_REST','message',v.name||': precisa de duas folgas na semana de '||to_char(v.week,'DD/MM/YYYY')||'.','date',v.week+6,'severity','ERROR'));end if;
  if not v.fixed and v.ordinary>1 then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','DOUBLE_REST','message',v.name||': quem folga na semana deve estar disponível no sábado.','date',v.week+5,'severity','ERROR'));end if;
  if v.worked>5 or v.minutes>r.weekly_minutes+r.overtime_minutes*v.worked then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','PERSON_WEEKLY','message',v.name||': dias ou horas semanais acima do limite.','date',v.week+6,'severity','ERROR'));end if;
 end loop;
 return v_result;
end;$$;

-- Keep the existing actor/unit/revision checks and function grants intact.
do $migration$
declare source text;old_row text;new_row text;f record;n integer:=0;
begin
 source:=pg_get_functiondef('escala_private.escala_command(text,text,uuid,integer,jsonb,uuid)'::regprocedure);
 old_row:='''completed'',false,''work_minutes'',(select work_minutes from escala_rules where unit=p_unit)';
 new_row:=old_row||',''weekly_rest'',case when v_mode<>''REST'' then false when extract(dow from v_date)=0 or person.fixed_team_id is not null and extract(dow from v_date)=6 then true when not exists(select 1 from escala_holidays h where h.unit=p_unit and h.date=v_date and h.enabled and h.kind<>''OPTIONAL'' and not h.operates) then true else coalesce((a->>''weekly_rest'')::boolean,false) end';
 if position(old_row in source)=0 then raise exception 'ESCALA_CLT_POLICY_BASE';end if;
 execute replace(source,old_row,new_row);
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','escala_private') and p.proname like 'escala_command%' loop
  source:=pg_get_functiondef(f.oid);
  if position('allowed:=array[''regime'',''start_minute''' in source)>0 then
   source:=replace(source,'coalesce((clean->>''max_consecutive'')::int,99)>5','coalesce((clean->>''max_consecutive'')::int,99)>6');
   execute replace(source,'allowed:=array[''regime'',''start_minute''','allowed:=array[''daily_compensation'',''regime'',''start_minute''');n:=n+1;
  end if;
 end loop;
 if n<>1 then raise exception 'ESCALA_CLT_RULES_HANDLER_BASE';end if;
end;
$migration$;
notify pgrst,'reload schema';
commit;
