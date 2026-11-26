begin;

create function escala_private.preserved_team(p_unit text,p_team uuid,p_month date) returns boolean
language sql stable set search_path=public,pg_temp as $$
 select exists(select 1 from escala_memberships m join escala_teams t on t.id=m.team_id and t.unit=m.unit where m.unit=p_unit and m.team_id=p_team and t.active and t.deleted_at is null and m.origin='MANUAL' and m.starts_on<p_month+interval '1 month' and (m.ends_on is null or m.ends_on>=p_month));
$$;

create function escala_private.preserved_mode(p_unit text,p_team uuid,p_date date) returns text
language plpgsql stable set search_path=public,pg_temp as $$
begin
 if extract(dow from p_date) in(0,6) then return 'REST';end if;
 if not exists(select 1 from escala_teams t where t.id=p_team and t.unit=p_unit and t.active and t.deleted_at is null)
 or exists(select 1 from escala_unavailable u where u.unit=p_unit and u.cancelled_at is null and p_date between u.starts_on and u.ends_on and (u.team_id=p_team or exists(select 1 from escala_memberships m where m.unit=p_unit and m.team_id=p_team and m.staff_id=u.staff_id and p_date>=m.starts_on and (m.ends_on is null or m.ends_on>=p_date))))
 or exists(select 1 from escala_memberships m join escala_staff s on s.id=m.staff_id and s.unit=m.unit where m.unit=p_unit and m.team_id=p_team and p_date>=m.starts_on and (m.ends_on is null or m.ends_on>=p_date) and (s.deleted_at is not null or s.status in('INACTIVE','LEAVE') or s.status='VACATION' and (s.vacation_start is null or p_date>=s.vacation_start and (s.vacation_end is null or p_date<=s.vacation_end)))) then return 'UNAVAILABLE';end if;
 if exists(select 1 from escala_holidays h where h.unit=p_unit and h.date=p_date and h.enabled and h.kind<>'OPTIONAL' and not h.operates) then return 'REST';end if;
 return 'ROUTE';
end;$$;

create function escala_private.preserved_schedule_issues(p_unit text,p_month date,p_days jsonb default null) returns jsonb
language plpgsql stable set search_path=public,pg_temp as $$
declare fixed uuid[];days jsonb;day jsonb;duty jsonb;team uuid;at_date date;expected text;prior record;issues jsonb:='[]';
begin
 select coalesce(array_agg(t.id),'{}') into fixed from escala_teams t where t.unit=p_unit and t.active and t.deleted_at is null and exists(select 1 from escala_memberships m where m.unit=p_unit and m.team_id=t.id and m.origin='MANUAL' and m.starts_on<p_month+interval '1 month' and (m.ends_on is null or m.ends_on>=p_month));
 if cardinality(fixed)=0 then return issues;end if;
 days:=coalesce(p_days,(select public.escala_days_json(p_unit,c.id) from escala_months c where c.unit=p_unit and c.month=p_month));
 if jsonb_typeof(days) is distinct from 'array' then return issues;end if;
 for day in select value from jsonb_array_elements(days) loop
  at_date:=(day->>'date')::date;
  if at_date<p_month or at_date>=p_month+interval '1 month' or jsonb_typeof(day->'duties') is distinct from 'array' then continue;end if;
  for duty in select value from jsonb_array_elements(day->'duties') loop
   team:=(duty->>'team_id')::uuid;if team is null or not team=any(fixed) then continue;end if;
   select d.locked,a.completed,a.mode into prior from escala_days d join escala_duties a on a.day_id=d.id and a.unit=d.unit where d.unit=p_unit and d.date=at_date and a.team_id=team;
   -- Only recorded protected duties are exempt. Client-supplied flags alone
   -- cannot turn a new assignment into historical or locked data.
   if duty->>'mode'=prior.mode and ((coalesce(prior.locked,false) and coalesce((day->>'locked')::boolean,false)) or (coalesce(prior.completed,false) and coalesce((duty->>'completed')::boolean,false))) then continue;end if;
   expected:=escala_private.preserved_mode(p_unit,team,at_date);
   if duty->>'mode' is distinct from expected then issues:=issues||jsonb_build_array(jsonb_build_object('code','FIXED_TEAM_SCHEDULE','message','Equipe preservada: trabalho de segunda a sexta e folga aos sábados e domingos. Feriados e indisponibilidades são respeitados.','date',at_date,'team_id',team,'severity','ERROR'));end if;
  end loop;
 end loop;
 return issues;
end;$$;

alter function public.escala_issues(text,date) rename to escala_issues_before_preserved_weekdays;
revoke all on function public.escala_issues_before_preserved_weekdays(text,date) from public,anon,authenticated;
create function public.escala_issues(p_unit text,p_month date) returns jsonb
language sql stable security invoker set search_path='' as $$
 select (select coalesce(jsonb_agg(issue),'[]') from jsonb_array_elements(public.escala_issues_before_preserved_weekdays(p_unit,p_month)) issue where not (issue->>'code'='UNAVAILABLE' and escala_private.preserved_team(p_unit,(issue->>'team_id')::uuid,p_month) and escala_private.preserved_mode(p_unit,(issue->>'team_id')::uuid,(issue->>'date')::date)='ROUTE'))||case when exists(select 1 from public.escala_months c where c.unit=p_unit and c.month=p_month and c.status='DRAFT') then escala_private.preserved_schedule_issues(p_unit,p_month) else '[]'::jsonb end;
$$;
revoke all on function public.escala_issues(text,date) from public,anon,authenticated;

alter function escala_private.escala_command(text,text,uuid,integer,jsonb,uuid) rename to escala_command_before_preserved_weekdays;
revoke all on function escala_private.escala_command_before_preserved_weekdays(text,text,uuid,integer,jsonb,uuid) from public,anon,authenticated;
create function escala_private.escala_command(p_unit text,p_action text,p_id uuid default null,p_revision integer default 0,p_payload jsonb default '{}',p_request_id uuid default gen_random_uuid()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare issues jsonb;
begin
 if p_action='MONTH_SAVE' then
  if not escala_private.has_access(p_unit,'ESCALA_MANAGE') then raise exception 'FORBIDDEN';end if;
  perform pg_advisory_xact_lock(hashtextextended('escala:'||p_unit,0));
  if exists(select 1 from escala_audit where unit=p_unit and request_id=p_request_id) then return escala_private.escala_command_before_preserved_weekdays(p_unit,p_action,p_id,p_revision,p_payload,p_request_id);end if;
  if jsonb_typeof(p_payload->'days')='array' and p_payload->>'month'~'^[0-9]{4}-(0[1-9]|1[0-2])-01$' and p_payload->>'month' between '2020-01-01' and '2100-12-01' then
   issues:=escala_private.preserved_schedule_issues(p_unit,(p_payload->>'month')::date,p_payload->'days');
   if jsonb_array_length(issues)>0 then raise exception 'ESCALA_FIXED_TEAM_SCHEDULE' using detail=issues::text;end if;
  end if;
 end if;
 return escala_private.escala_command_before_preserved_weekdays(p_unit,p_action,p_id,p_revision,p_payload,p_request_id);
end;$$;
revoke all on function escala_private.preserved_team(text,uuid,date),escala_private.preserved_mode(text,uuid,date),escala_private.preserved_schedule_issues(text,date,jsonb),escala_private.escala_command(text,text,uuid,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function escala_private.escala_command(text,text,uuid,integer,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
