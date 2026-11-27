begin;
-- Targets are configuration only. Calendars, people and actual work are not rewritten.
create function escala_private.valid_daily_staffing(config jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare section record;day record;goal record;
begin
 if jsonb_typeof(config) is distinct from 'object' or pg_column_size(config)>100000 then return false;end if;
 for section in select * from jsonb_each(config) loop
  if section.key not in('weekdays','dates') or jsonb_typeof(section.value) is distinct from 'object' then return false;end if;
  for day in select * from jsonb_each(section.value) loop
   if section.key='weekdays' and day.key!~'^[1-6]$' then return false;end if;
   if section.key='dates' then
    if day.key!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or day.key::date::text<>day.key or extract(dow from day.key::date)=0 then return false;end if;
   end if;
   if jsonb_typeof(day.value) is distinct from 'object' then return false;end if;
   for goal in select * from jsonb_each(day.value) loop
    if goal.key not in('drivers','helpers') or jsonb_typeof(goal.value) is distinct from 'number' or goal.value::text!~'^[0-9]{1,4}$' or (goal.value::text)::int>1000 then return false;end if;
   end loop;
  end loop;
 end loop;
 return true;
exception when others then return false;
end;
$$;
revoke all on function escala_private.valid_daily_staffing(jsonb) from public,anon,authenticated;
alter table public.escala_rules add column daily_staffing jsonb not null default '{"weekdays":{},"dates":{}}'::jsonb;
alter table public.escala_rules add constraint escala_daily_staffing_valid check(escala_private.valid_daily_staffing(daily_staffing));

create function escala_private.staffing_goal(config jsonb,p_date date,p_role text) returns integer
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select case when extract(dow from p_date)=0 then 0 else coalesce(config->'dates'->p_date::text->>p_role,config->'weekdays'->(extract(dow from p_date)::int)::text->>p_role)::integer end;
$$;
revoke all on function escala_private.staffing_goal(jsonb,date,text) from public,anon,authenticated;

do $migration$
declare source text;old_piece text;new_piece text;start_at integer;end_at integer;
begin
 source:=pg_get_functiondef('public.escala_command_before_directory(text,text,uuid,integer,jsonb,uuid)'::regprocedure);
 old_piece:='allowed:=array[''daily_compensation'',''regime''';
 if (length(source)-length(replace(source,old_piece,'')))/length(old_piece)<>1 then raise exception 'ESCALA_STAFFING_COMMAND_BASE';end if;
 execute replace(source,old_piece,'allowed:=array[''daily_staffing'',''daily_compensation'',''regime''');

 source:=pg_get_functiondef('escala_private.individual_issues(text,date)'::regprocedure);
 if strpos(source,'v_expected text;')=0 then raise exception 'ESCALA_STAFFING_ISSUES_BASE';end if;
 source:=replace(source,'v_expected text;','v_expected text;v_goal integer;');
 old_piece:='  if extract(dow from d.date) between 1 and 5 and not exists';
 start_at:=strpos(source,old_piece);
 if start_at=0 then raise exception 'ESCALA_STAFFING_CAPACITY_BASE';end if;
 end_at:=strpos(substr(source,start_at),E'  end if;\n');
 if end_at=0 then raise exception 'ESCALA_STAFFING_CAPACITY_END';end if;
 old_piece:=substr(source,start_at,end_at-1+length(E'  end if;\n'));
 new_piece:=$block$
  if extract(dow from d.date) between 1 and 6 and not exists(select 1 from escala_holidays h where h.unit=p_unit and h.date=d.date and h.enabled and h.kind<>'OPTIONAL' and not h.operates) then
   for v in select roles.role,count(*) filter(where p->>'mode' in('ROUTE','RESERVE')) available,count(*) filter(where p->>'mode'='REST' and nullif(p->>'fixed_team_id','') is null) rests
    from (values('DRIVER'),('HELPER')) roles(role) left join lateral jsonb_array_elements(d.people) p on (case when p->'person'->>'job'~*'^motorista' then 'DRIVER' else 'HELPER' end)=roles.role group by roles.role loop
    v_goal:=escala_private.staffing_goal(r.daily_staffing,d.date,case when v.role='DRIVER' then 'drivers' else 'helpers' end);
    if v_goal is null then
     if extract(dow from d.date)<6 and v.rests>(case when v.role='DRIVER' then 1 else 2 end) then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','REST_CAPACITY','message','Por dia útil, no máximo 1 motorista e 2 ajudantes de folga, salvo QLP diário configurado.','date',d.date,'severity','ERROR'));end if;
    elsif v.available<v_goal then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','QLP_SHORTAGE','message','QLP de '||(case when v.role='DRIVER' then 'motoristas' else 'ajudantes' end)||': '||v.available||' disponíveis; configurado '||v_goal||'. Faltam '||(v_goal-v.available)||'.','date',d.date,'severity','ERROR'));
    elsif v.available>v_goal then v_result:=v_result||jsonb_build_array(jsonb_build_object('code','QLP_SURPLUS','message','QLP de '||(case when v.role='DRIVER' then 'motoristas' else 'ajudantes' end)||': '||v.available||' disponíveis; configurado '||v_goal||'. Revise a distribuição das folgas.','date',d.date,'severity','WARN'));
    end if;
   end loop;
  end if;
$block$;
 execute replace(source,old_piece,new_piece);
end;
$migration$;
notify pgrst,'reload schema';
commit;
