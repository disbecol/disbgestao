begin;
-- Crew draws may fill unfinished schedules without changing recorded routes.
create or replace function escala_private.escala_save_composition(p_unit text,p_month date,p_token text,p_seed text,p_assignments jsonb,p_helpers integer,p_area text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare target_ids uuid[];all_staff uuid[];crew jsonb;member_id uuid;person record;team_id uuid;last_day date;driver_count integer;helper_count integer;old_data jsonb;new_data jsonb;result jsonb;v_hash text;prior escala_audit%rowtype;cal escala_months%rowtype;
begin
 if not escala_private.has_access(p_unit,'ESCALA_MANAGE') then raise exception 'FORBIDDEN';end if;
 if p_month is null or extract(day from p_month)<>1 or p_month<'2020-01-01' or p_month>'2100-12-01' or p_request_id is null or p_helpers is null or p_helpers not between 1 and 5 or length(coalesce(p_seed,'')) not between 1 and 150 or length(coalesce(p_area,''))>100 or jsonb_typeof(p_assignments) is distinct from 'array' or pg_column_size(p_assignments)>200000 then raise exception 'ESCALA_COMPOSITION_INVALID';end if;
 perform pg_advisory_xact_lock(hashtext('staff-directory'));
 perform pg_advisory_xact_lock(hashtextextended('escala:'||p_unit,0));
 v_hash:=md5(jsonb_build_array('COMPOSITION_DRAW',p_month,p_token,p_seed,p_assignments,p_helpers,p_area)::text);
 select * into prior from escala_audit a where a.unit=p_unit and a.request_id=p_request_id;
 if found then if prior.actor_id<>auth.uid() or prior.request_hash<>v_hash then raise exception 'ESCALA_REQUEST_CONFLICT';end if;return prior.result;end if;
 if p_token is distinct from escala_private.composition_token(p_unit,p_month) then raise exception 'ESCALA_VERSION_CONFLICT';end if;
 if exists(select 1 from escala_months where unit=p_unit and month=p_month and status<>'DRAFT') then raise exception 'ESCALA_COMPOSITION_LOCKED';end if;
 target_ids:=escala_private.composition_targets(p_unit,p_month);last_day:=(p_month+interval '1 month'-interval '1 day')::date;
 if cardinality(target_ids)=0 or jsonb_array_length(p_assignments)<>cardinality(target_ids) then raise exception 'ESCALA_COMPOSITION_TEAMS';end if;
 if (select count(distinct value->>'team_id') from jsonb_array_elements(p_assignments))<>cardinality(target_ids) then raise exception 'ESCALA_COMPOSITION_TEAMS';end if;
 all_staff:='{}';
 for crew in select value from jsonb_array_elements(p_assignments) loop
  team_id:=(crew->>'team_id')::uuid;
  if team_id is null or not team_id=any(target_ids) or jsonb_typeof(crew->'members') is distinct from 'array' or jsonb_array_length(crew->'members')<>p_helpers+1 then raise exception 'ESCALA_COMPOSITION_TEAMS';end if;
  driver_count:=0;helper_count:=0;
  for member_id in select value::uuid from jsonb_array_elements_text(crew->'members') loop
   if member_id is null or member_id=any(all_staff) then raise exception 'ESCALA_DUPLICATE_MEMBERSHIP';end if;
   select s.*,p.area into person from escala_staff s join staff_people p on p.id=s.person_id join staff_people_units u on u.person_id=p.id and u.unit=s.unit
   where s.id=member_id and s.unit=p_unit and s.deleted_at is null and s.status not in('INACTIVE','LEAVE') and p.active and p.archived_at is null
   and (coalesce(p_area,'')='' or forms_area_key(p.area)=forms_area_key(p_area))
   and not(s.status='VACATION' and (s.vacation_start is null or s.vacation_start<=last_day and (s.vacation_end is null or s.vacation_end>=p_month)))
   and not exists(select 1 from escala_unavailable u where u.unit=p_unit and u.staff_id=s.id and u.cancelled_at is null and u.starts_on<=last_day and u.ends_on>=p_month);
   if not found then raise exception 'ESCALA_COMPOSITION_PERSON';end if;
   if exists(select 1 from escala_memberships m where m.unit=p_unit and m.staff_id=member_id and m.starts_on<=last_day and (m.ends_on is null or m.ends_on>=p_month) and not(m.origin='AUTO' and m.draw_month=p_month and m.team_id=any(target_ids))) then raise exception 'ESCALA_DUPLICATE_MEMBERSHIP';end if;
   if person.job~*'^motorista([ _(-]|$)' then driver_count:=driver_count+1;elsif person.job~*'^ajudante([ _(-]|$)' then helper_count:=helper_count+1;else raise exception 'ESCALA_COMPOSITION_ROLE';end if;
   all_staff:=array_append(all_staff,member_id);
  end loop;
  if driver_count<>1 or helper_count<>p_helpers then raise exception 'ESCALA_COMPOSITION_ROLE';end if;
 end loop;
 select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') into old_data from escala_memberships m where m.unit=p_unit and m.team_id=any(target_ids) and m.origin='AUTO' and m.draw_month=p_month;
 -- Only replace an unprotected draft month's automatic links. Earlier draws
 -- remain available in the audit; completed/approved schedule snapshots stay intact.
 delete from escala_memberships m where m.unit=p_unit and m.team_id=any(target_ids) and m.origin='AUTO' and m.draw_month=p_month;
 for crew in select value from jsonb_array_elements(p_assignments) loop
  for member_id in select value::uuid from jsonb_array_elements_text(crew->'members') loop
   insert into escala_memberships(unit,team_id,staff_id,starts_on,ends_on,origin,draw_month) values(p_unit,(crew->>'team_id')::uuid,member_id,p_month,last_day,'AUTO',p_month);
  end loop;
 end loop;
 update escala_duties a set members=public.escala_members(p_unit,a.team_id,d.date),revision=a.revision+1 from escala_days d join escala_months m on m.id=d.month_id where a.day_id=d.id and a.unit=p_unit and m.unit=p_unit and m.month=p_month and m.status='DRAFT' and not d.locked and not a.completed and a.team_id=any(target_ids);
 update escala_months set revision=revision+1,updated_at=now() where unit=p_unit and month=p_month and status='DRAFT' returning * into cal;
 new_data:=jsonb_build_object('month',p_month,'seed',p_seed,'helpers_per_team',p_helpers,'area',coalesce(p_area,''),'assignments',p_assignments,'people',(select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'job',s.job) order by s.id) from escala_staff s where s.unit=p_unit and s.id=any(all_staff)));
 result:=jsonb_build_object('ok',true,'teams',cardinality(target_ids),'people',cardinality(all_staff),'month_revision',cal.revision);
 insert into escala_audit(unit,action,record_id,actor_id,actor_name,reason,before,after,request_id,request_hash,result) values(p_unit,'COMPOSITION_DRAW',cal.id,auth.uid(),(select name from profiles where id=auth.uid()),'Sorteio mensal dos integrantes das equipes sem composição manual.',old_data,new_data,p_request_id,v_hash,result);
 return result;
end;$$;

-- MONTH_SAVE rebuilds duties. Preserve the recorded crew on completed routes
-- and locked days when it rebuilds the same duty in a draft month.
alter function escala_private.escala_command(text,text,uuid,integer,jsonb,uuid) rename to escala_command_before_draft_composition;
revoke all on function escala_private.escala_command_before_draft_composition(text,text,uuid,integer,jsonb,uuid) from public,anon,authenticated;
create function escala_private.escala_command(p_unit text,p_action text,p_id uuid default null,p_revision integer default 0,p_payload jsonb default '{}',p_request_id uuid default gen_random_uuid()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare snapshots jsonb;v_result jsonb;
begin
 if p_action='MONTH_SAVE' then
  if not escala_private.has_access(p_unit,'ESCALA_MANAGE') then raise exception 'FORBIDDEN';end if;
  perform pg_advisory_xact_lock(hashtextextended('escala:'||p_unit,0));
  if exists(select 1 from escala_audit where unit=p_unit and request_id=p_request_id) then
   return escala_private.escala_command_before_draft_composition(p_unit,p_action,p_id,p_revision,p_payload,p_request_id);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('date',d.date,'team_id',a.team_id,'members',a.members,'completed',a.completed,'locked',d.locked)),'[]') into snapshots
  from escala_duties a join escala_days d on d.id=a.day_id join escala_months m on m.id=d.month_id
  where a.unit=p_unit and m.month=(p_payload->>'month')::date and (a.completed or d.locked);
 end if;
 v_result:=escala_private.escala_command_before_draft_composition(p_unit,p_action,p_id,p_revision,p_payload,p_request_id);
 if p_action='MONTH_SAVE' then
  update escala_duties a set members=s.value->'members' from escala_days d,jsonb_array_elements(snapshots) s
  where a.day_id=d.id and a.unit=p_unit and d.date=(s.value->>'date')::date and a.team_id=(s.value->>'team_id')::uuid
  and ((s.value->>'completed')::boolean and a.completed or (s.value->>'locked')::boolean and d.locked);
  v_result:=v_result||jsonb_build_object('days',public.escala_days_json(p_unit,(v_result->>'id')::uuid),'issues',public.escala_issues(p_unit,(v_result->>'month')::date));
  update escala_audit set result=v_result where unit=p_unit and request_id=p_request_id and actor_id=auth.uid();
 end if;
 return v_result;
end;$$;
revoke all on function escala_private.escala_command(text,text,uuid,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function escala_private.escala_command(text,text,uuid,integer,jsonb,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
