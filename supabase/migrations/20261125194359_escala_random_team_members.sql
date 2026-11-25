begin;
alter table public.escala_memberships add column origin text not null default 'MANUAL' check(origin in('MANUAL','AUTO'));
alter table public.escala_memberships add column draw_month date;
alter table public.escala_memberships add constraint escala_membership_draw_period check(origin='MANUAL' and draw_month is null or origin='AUTO' and draw_month is not null and extract(day from draw_month)=1 and starts_on=draw_month and ends_on=(draw_month+interval '1 month'-interval '1 day')::date);
-- The legacy generic insert supplies every column, including newly added ones.
create function escala_private.membership_defaults() returns trigger language plpgsql set search_path=public,pg_temp as $$begin new.origin:=coalesce(new.origin,'MANUAL');return new;end;$$;
create trigger escala_membership_defaults before insert on public.escala_memberships for each row execute function escala_private.membership_defaults();
create function escala_private.composition_targets(p_unit text,p_month date) returns uuid[] language sql stable set search_path=public,pg_temp as $$
 select coalesce(array_agg(t.id order by t.code,t.id),'{}') from escala_teams t where t.unit=p_unit and t.active and t.draw_enabled and t.deleted_at is null
 and not exists(select 1 from escala_memberships m where m.unit=p_unit and m.team_id=t.id and m.origin='MANUAL' and m.starts_on<(p_month+interval '1 month') and (m.ends_on is null or m.ends_on>=p_month));
$$;
create function escala_private.composition_token(p_unit text,p_month date) returns text language sql stable set search_path=public,pg_temp as $$
 select md5(jsonb_build_array(
 (select jsonb_agg(to_jsonb(s)||jsonb_build_object('area',p.area,'person_active',p.active,'person_archived_at',p.archived_at,'person_unit',exists(select 1 from staff_people_units u where u.person_id=p.id and u.unit=p_unit)) order by s.id) from escala_staff s left join staff_people p on p.id=s.person_id where s.unit=p_unit),
 (select jsonb_agg(to_jsonb(t) order by t.id) from escala_teams t where t.unit=p_unit),
 (select jsonb_agg(to_jsonb(m) order by m.id) from escala_memberships m where m.unit=p_unit),
 (select jsonb_agg(to_jsonb(u) order by u.id) from escala_unavailable u where u.unit=p_unit),
 (select to_jsonb(m) from escala_months m where m.unit=p_unit and m.month=p_month),
 (select jsonb_agg(jsonb_build_array(d.id,d.locked,a.id,a.completed) order by d.id,a.id) from escala_days d left join escala_duties a on a.day_id=d.id where d.unit=p_unit and d.date>=p_month and d.date<p_month+interval '1 month')
 )::text);
$$;
alter function public.escala_state(text,date) rename to escala_state_before_member_draw;
revoke all on function public.escala_state_before_member_draw(text,date) from public,anon,authenticated;
create function public.escala_state(p_unit text,p_month date) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;begin
 if p_month is null or extract(day from p_month)<>1 then raise exception 'ESCALA_MONTH_INVALID';end if;
 result:=public.escala_state_before_member_draw(p_unit,p_month);
 return result||jsonb_build_object('composition_token',escala_private.composition_token(p_unit,p_month));
end;$$;

create function public.escala_save_composition(p_unit text,p_month date,p_token text,p_seed text,p_assignments jsonb,p_helpers integer,p_area text,p_request_id uuid) returns jsonb
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
 if exists(select 1 from escala_months where unit=p_unit and month=p_month and status<>'DRAFT') or exists(select 1 from escala_days d left join escala_duties a on a.day_id=d.id where d.unit=p_unit and d.date>=p_month and d.date<p_month+interval '1 month' and (d.locked or a.completed)) then raise exception 'ESCALA_COMPOSITION_LOCKED';end if;
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
 update escala_duties a set members=public.escala_members(p_unit,a.team_id,d.date),revision=a.revision+1 from escala_days d join escala_months m on m.id=d.month_id where a.day_id=d.id and a.unit=p_unit and m.unit=p_unit and m.month=p_month and m.status='DRAFT' and a.team_id=any(target_ids);
 update escala_months set revision=revision+1,updated_at=now() where unit=p_unit and month=p_month and status='DRAFT' returning * into cal;
 new_data:=jsonb_build_object('month',p_month,'seed',p_seed,'helpers_per_team',p_helpers,'area',coalesce(p_area,''),'assignments',p_assignments,'people',(select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'job',s.job) order by s.id) from escala_staff s where s.unit=p_unit and s.id=any(all_staff)));
 result:=jsonb_build_object('ok',true,'teams',cardinality(target_ids),'people',cardinality(all_staff),'month_revision',cal.revision);
 insert into escala_audit(unit,action,record_id,actor_id,actor_name,reason,before,after,request_id,request_hash,result) values(p_unit,'COMPOSITION_DRAW',cal.id,auth.uid(),(select name from profiles where id=auth.uid()),'Sorteio mensal dos integrantes das equipes sem composição manual.',old_data,new_data,p_request_id,v_hash,result);
 return result;
end;$$;

alter function public.escala_command(text,text,uuid,integer,jsonb,uuid) rename to escala_command_before_member_draw;
revoke all on function public.escala_command_before_member_draw(text,text,uuid,integer,jsonb,uuid) from public,anon,authenticated;
create function public.escala_command(p_unit text,p_action text,p_id uuid default null,p_revision integer default 0,p_payload jsonb default '{}',p_request_id uuid default gen_random_uuid()) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_action in('MEMBERSHIP_SAVE','MEMBERSHIP_TRANSFER') then
  if not escala_private.has_access(p_unit,'ESCALA_MANAGE') then raise exception 'FORBIDDEN';end if;
  perform pg_advisory_xact_lock(hashtextextended('escala:'||p_unit,0));
  if exists(select 1 from escala_memberships e where e.id=p_id and e.unit=p_unit and e.origin='AUTO' and (
   exists(select 1 from escala_months c where c.unit=e.unit and c.month=e.draw_month and c.status<>'DRAFT')
   or exists(select 1 from escala_days d left join escala_duties a on a.day_id=d.id where d.unit=e.unit and d.date>=e.draw_month and d.date<e.draw_month+interval '1 month' and (d.locked or a.completed)))) then raise exception 'ESCALA_COMPOSITION_LOCKED';end if;
  update escala_memberships set origin='MANUAL',draw_month=null where id=p_id and unit=p_unit and revision=p_revision and origin='AUTO';
 end if;
 return public.escala_command_before_member_draw(p_unit,p_action,p_id,p_revision,p_payload,p_request_id);
end;$$;
revoke all on function escala_private.membership_defaults(),escala_private.composition_targets(text,date),escala_private.composition_token(text,date) from public,anon,authenticated;
revoke all on function public.escala_state(text,date),public.escala_command(text,text,uuid,integer,jsonb,uuid),public.escala_save_composition(text,date,text,text,jsonb,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.escala_state(text,date),public.escala_command(text,text,uuid,integer,jsonb,uuid),public.escala_save_composition(text,date,text,text,jsonb,integer,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
