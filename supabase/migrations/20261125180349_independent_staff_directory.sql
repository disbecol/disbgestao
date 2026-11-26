-- Operational people are independent of authentication accounts. Existing IDs
-- remain stable so historical individual answers and scores need no rewriting.
begin;
alter table public.profiles add column if not exists access_archived_at timestamptz;
alter table public.profiles add column if not exists access_archive_reason text;
insert into public.permissions(code,module,name,description,sort_order,active) values
 ('STAFF_DIRECTORY_VIEW','Administração','Consultar Cadastro de Equipes','Consultar pessoas, funções, áreas e unidades sem criar contas de acesso.',25,true),
 ('STAFF_DIRECTORY_MANAGE','Administração','Gerenciar Cadastro de Equipes','Cadastrar e editar pessoas e seus vínculos operacionais.',26,true)
on conflict(code) do update set name=excluded.name,description=excluded.description,active=true;
insert into public.role_permissions(role,permission_code) values ('ADMIN','STAFF_DIRECTORY_VIEW'),('ADMIN','STAFF_DIRECTORY_MANAGE') on conflict do nothing;
create schema if not exists staff_private;
revoke all on schema staff_private from public,anon,authenticated;
grant usage on schema staff_private to authenticated;
create table public.staff_people(
 id uuid primary key default gen_random_uuid(),profile_id uuid unique references public.profiles(id) on delete set null,
 name text not null check(length(btrim(name)) between 1 and 150),job text not null check(length(btrim(job)) between 1 and 100),
 area text not null check(length(btrim(area)) between 1 and 100),active boolean not null default true,
 notes text not null default '' check(length(notes)<=3000),revision integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.staff_people_units(person_id uuid not null references public.staff_people(id),unit text not null references public.units(name),primary key(person_id,unit));
create index staff_people_units_unit on public.staff_people_units(unit,person_id);
create table public.staff_people_audit(id uuid primary key default gen_random_uuid(),person_id uuid not null references public.staff_people(id),actor_id uuid not null references public.profiles(id),actor_name text not null,before jsonb,after jsonb,changed_at timestamptz not null default now());
create index staff_people_audit_person on public.staff_people_audit(person_id,changed_at desc);
create function staff_private.can_read(p_unit text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and public.user_has_unit(p_unit) and exists(select 1 from units where name=p_unit and active)
 and (public.has_permission('STAFF_DIRECTORY_VIEW') or public.has_permission('STAFF_DIRECTORY_MANAGE') or public.has_permission('ADMIN_USERS')
 or (public.forms_enabled() and (public.has_permission('FORMS_MANAGE') or public.has_permission('FORMS_REPORT') or public.has_permission('FORMS_FILL')))
 or escala_private.has_access(p_unit));
$$;
create function staff_private.can_manage(p_unit text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and public.user_has_unit(p_unit) and exists(select 1 from units where name=p_unit and active)
 and (public.has_permission('STAFF_DIRECTORY_MANAGE') or public.has_permission('ADMIN_USERS'));
$$;
alter table public.staff_people enable row level security;
alter table public.staff_people_units enable row level security;
alter table public.staff_people_audit enable row level security;
create policy staff_read on public.staff_people for select to authenticated using(exists(select 1 from public.staff_people_units u where u.person_id=id and staff_private.can_read(u.unit)));
create policy staff_units_read on public.staff_people_units for select to authenticated using(staff_private.can_read(unit));
create policy staff_audit_read on public.staff_people_audit for select to authenticated using(exists(select 1 from public.staff_people_units u where u.person_id=staff_people_audit.person_id and staff_private.can_manage(u.unit)));
revoke all on public.staff_people,public.staff_people_units,public.staff_people_audit from anon,authenticated;
grant select on public.staff_people,public.staff_people_units to authenticated;

insert into public.staff_people(id,profile_id,name,job,area,active)
select p.id,p.id,p.name,coalesce((select r->>'label' from jsonb_array_elements(public.app_role_catalog()) r where r->>'code'=p.role),p.role),
 coalesce(nullif(public.forms_staff_area(p.role,p.evaluation_area),''),'Operações'),p.active
from public.profiles p where p.active or exists(select 1 from public.form_responses f cross join lateral jsonb_array_elements(f.evaluated_people) e where e->>'id'=p.id::text);
insert into public.staff_people_units(person_id,unit) select p.id,u.unit_name from public.staff_people p join public.user_units u on u.user_id=p.profile_id;

create function public.staff_directory_state(p_unit text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not staff_private.can_manage(p_unit) and not (staff_private.can_read(p_unit) and public.has_permission('STAFF_DIRECTORY_VIEW')) then raise exception 'FORBIDDEN';end if;
 return jsonb_build_object('people',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('units',(select jsonb_agg(u.unit order by u.unit) from staff_people_units u where u.person_id=p.id and public.user_has_unit(u.unit)),
 'can_edit',not exists(select 1 from staff_people_units u where u.person_id=p.id and not staff_private.can_manage(u.unit))) order by p.name,p.id),'[]') from staff_people p where exists(select 1 from staff_people_units u where u.person_id=p.id and u.unit=p_unit)),
 'units',(select coalesce(jsonb_agg(name order by name),'[]') from units where active and staff_private.can_manage(name)));
end;$$;
create function public.staff_directory_save(p_unit text,p_id uuid,p_revision integer,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare person public.staff_people%rowtype;old jsonb;unit_list text[];actor text;
begin
 if not staff_private.can_manage(p_unit) then raise exception 'FORBIDDEN';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload)>12000 or jsonb_typeof(p_payload->'units') is distinct from 'array' then raise exception 'STAFF_DATA_INVALID';end if;
 select array_agg(distinct btrim(value)) into unit_list from jsonb_array_elements_text(p_payload->'units');
 if coalesce(cardinality(unit_list),0) not between 1 and 20 or not p_unit=any(unit_list) or exists(select 1 from unnest(unit_list) u where not staff_private.can_manage(u)) then raise exception 'UNIDADE_SEM_ACESSO';end if;
 perform pg_advisory_xact_lock(hashtext('staff-directory'));
 if p_id is not null then
  select * into person from staff_people where id=p_id for update;
  if not found or not exists(select 1 from staff_people_units where person_id=p_id and unit=p_unit) or exists(select 1 from staff_people_units where person_id=p_id and not staff_private.can_manage(unit)) then raise exception 'FORBIDDEN';end if;
  if person.revision is distinct from p_revision then raise exception 'STAFF_VERSION_CONFLICT';end if;
  old:=to_jsonb(person)||jsonb_build_object('units',(select jsonb_agg(unit order by unit) from staff_people_units where person_id=p_id));
  update staff_people set name=btrim(p_payload->>'name'),job=btrim(p_payload->>'job'),area=btrim(p_payload->>'area'),active=(p_payload->>'active')::boolean,notes=coalesce(p_payload->>'notes',''),revision=revision+1,updated_at=now() where id=p_id returning * into person;
 else
  if coalesce(p_revision,0)<>0 then raise exception 'STAFF_VERSION_CONFLICT';end if;
  insert into staff_people(name,job,area,active,notes) values(btrim(p_payload->>'name'),btrim(p_payload->>'job'),btrim(p_payload->>'area'),coalesce((p_payload->>'active')::boolean,true),coalesce(p_payload->>'notes','')) returning * into person;
 end if;
 delete from staff_people_units where person_id=person.id and not unit=any(unit_list);
 insert into staff_people_units(person_id,unit) select person.id,u from unnest(unit_list) u on conflict do nothing;
 select name into actor from profiles where id=auth.uid();
 insert into staff_people_audit(person_id,actor_id,actor_name,before,after) values(person.id,auth.uid(),actor,old,to_jsonb(person)||jsonb_build_object('units',to_jsonb(unit_list)));
 return to_jsonb(person)||jsonb_build_object('units',to_jsonb(unit_list),'can_edit',true);
end;$$;
create function public.forms_staff_people() returns table(id uuid,name text,role text,area text,units text[],active boolean) language sql stable security definer set search_path=public,pg_temp as $$
 select p.id,p.name,p.job,p.area,array_agg(u.unit order by u.unit),p.active from staff_people p join staff_people_units u on u.person_id=p.id where staff_private.can_read(u.unit) group by p.id order by p.name,p.id;
$$;

-- Preserve separate operational state while sharing the person's identity.
alter table public.escala_staff add column person_id uuid references public.staff_people(id);
update public.escala_staff s set person_id=p.id from public.staff_people p where s.profile_id=p.profile_id;
create unique index escala_staff_person on public.escala_staff(unit,person_id) where person_id is not null and deleted_at is null;
create function staff_private.sync_operational_people() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_person uuid;
begin
 if tg_table_name='staff_people' then v_person:=new.id;elsif tg_op='DELETE' then v_person:=old.person_id;else v_person:=new.person_id;end if;
 update escala_staff s set name=p.name,job=p.job,profile_id=p.profile_id,
 status=case when not p.active or not exists(select 1 from staff_people_units u where u.person_id=p.id and u.unit=s.unit) then 'INACTIVE' else s.status end,
 revision=s.revision+1,updated_at=now() from staff_people p where s.person_id=p.id and p.id=v_person and s.deleted_at is null;
 return null;
end;$$;
create trigger staff_sync after update on public.staff_people for each row execute function staff_private.sync_operational_people();
create trigger staff_units_sync after insert or delete on public.staff_people_units for each row execute function staff_private.sync_operational_people();
alter function public.escala_state(text,date) rename to escala_state_before_directory;
revoke all on function public.escala_state_before_directory(text,date) from public,anon,authenticated;
create function public.escala_state(p_unit text,p_month date) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;begin
 result:=public.escala_state_before_directory(p_unit,p_month);
 return result||jsonb_build_object('profiles',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'role',p.job) order by p.name),'[]') from staff_people p join staff_people_units u on u.person_id=p.id where u.unit=p_unit and p.active));
end;$$;
alter function public.escala_command(text,text,uuid,integer,jsonb,uuid) rename to escala_command_before_directory;
revoke all on function public.escala_command_before_directory(text,text,uuid,integer,jsonb,uuid) from public,anon,authenticated;
create function public.escala_command(p_unit text,p_action text,p_id uuid default null,p_revision integer default 0,p_payload jsonb default '{}',p_request_id uuid default gen_random_uuid()) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare entry record;person public.staff_people%rowtype;n integer:=0;result jsonb;v_request_hash text;
begin
 if not escala_private.has_access(p_unit,'ESCALA_MANAGE') and p_action in('STAFF_IMPORT','STAFF_SAVE') then raise exception 'FORBIDDEN';end if;
 if p_action='STAFF_IMPORT' then
  if p_request_id is null or jsonb_typeof(p_payload->'ids') is distinct from 'array' or jsonb_array_length(p_payload->'ids') not between 1 and 500 then raise exception 'ESCALA_PAYLOAD_INVALID';end if;
  perform pg_advisory_xact_lock(hashtext('staff-directory'));perform pg_advisory_xact_lock(hashtext('escala:'||p_unit));
  v_request_hash:=md5(p_action||p_payload::text);
  select a.result into result from escala_audit a where a.unit=p_unit and a.request_id=p_request_id and a.actor_id=auth.uid() and a.request_hash=v_request_hash;
  if found then return result;end if;
  if exists(select 1 from escala_audit where unit=p_unit and request_id=p_request_id) then raise exception 'ESCALA_REQUEST_CONFLICT';end if;
  if exists(select 1 from jsonb_array_elements_text(p_payload->'ids') x where not exists(select 1 from staff_people p join staff_people_units u on u.person_id=p.id where p.id::text=x and p.active and u.unit=p_unit)) then raise exception 'STAFF_PERSON_INVALID';end if;
  for entry in select p.* from staff_people p where (p_payload->'ids') ? p.id::text loop
   insert into escala_staff(unit,person_id,profile_id,name,job) values(p_unit,entry.id,entry.profile_id,entry.name,entry.job) on conflict(unit,person_id) where person_id is not null and deleted_at is null do nothing;n:=n+1;
  end loop;
  result:=jsonb_build_object('ok',true,'selected',n);
  insert into escala_audit(unit,action,actor_id,actor_name,request_id,request_hash,result,after) values(p_unit,p_action,auth.uid(),(select name from profiles where id=auth.uid()),p_request_id,v_request_hash,result,p_payload);
  return result;
 elsif p_action='STAFF_SAVE' then
  if p_id is null then raise exception 'STAFF_USE_DIRECTORY';end if;
  select p.* into person from escala_staff s join staff_people p on p.id=s.person_id join staff_people_units u on u.person_id=p.id and u.unit=s.unit where s.id=p_id and s.unit=p_unit;
  if not found then raise exception 'STAFF_PERSON_INVALID';end if;
  if not person.active and coalesce(p_payload->>'status','')<>'INACTIVE' then raise exception 'STAFF_PERSON_INACTIVE';end if;
  p_payload:=(p_payload-'person_id')||jsonb_build_object('name',person.name,'job',person.job,'profile_id',person.profile_id);
 end if;
 return public.escala_command_before_directory(p_unit,p_action,p_id,p_revision,p_payload,p_request_id);
end;$$;

revoke all on function staff_private.can_read(text),staff_private.can_manage(text),staff_private.sync_operational_people() from public,anon,authenticated;
grant execute on function staff_private.can_read(text),staff_private.can_manage(text) to authenticated;
revoke all on function public.staff_directory_state(text),public.staff_directory_save(text,uuid,integer,jsonb),public.forms_staff_people(),public.escala_state(text,date),public.escala_command(text,text,uuid,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.staff_directory_state(text),public.staff_directory_save(text,uuid,integer,jsonb),public.forms_staff_people(),public.escala_state(text,date),public.escala_command(text,text,uuid,integer,jsonb,uuid) to authenticated;
-- Form RPC replacements follow below before commit.

create or replace function public.forms_evaluation_people(p_form_id uuid,p_unit text) returns table(id uuid,name text,role text)
language sql stable security definer set search_path=public,pg_temp as $$
 select p.id,p.name,p.job as role from public.form_definitions f join public.staff_people p
 on public.forms_area_key(p.area)=any(public.forms_evaluation_areas(f.schema->'evaluation'))
 where f.id=p_form_id and p.active and coalesce((f.schema->'evaluation'->>'enabled')::boolean,false) and public.forms_can_access(f.id,'FILL',p_unit)
 and exists(select 1 from public.staff_people_units u join public.units un on un.name=u.unit and un.active where u.person_id=p.id and u.unit=p_unit) order by p.name,p.id;
$$;
create or replace function public.start_form_response_evaluated(p_form_id uuid,p_unit text,p_id uuid,p_people uuid[],p_assignment_id uuid default null) returns public.form_responses
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.form_responses%rowtype;chosen jsonb;config jsonb;existing uuid[];
begin
 if coalesce(cardinality(p_people),0) not between 1 and 100 or cardinality(p_people)<>(select count(distinct x) from unnest(p_people) x) then raise exception 'FORM_EVALUATION_REQUIRED';end if;
 r:=public.start_form_response(p_form_id,p_unit,p_id,p_assignment_id);
 select * into r from public.form_responses where id=r.id for update;
 config:=r.schema_snapshot->'evaluation';
 if not coalesce((config->>'enabled')::boolean,false) then raise exception 'FORM_EVALUATION_DISABLED';end if;
 if jsonb_array_length(r.evaluated_people)>0 then
  select array_agg((p->>'id')::uuid order by p->>'id') into existing from jsonb_array_elements(r.evaluated_people) p;
  if existing is distinct from (select array_agg(x order by x::text) from unnest(p_people) x) then raise exception 'FORM_EVALUATION_LOCKED';end if;
  return r;
 end if;
 if r.status<>'DRAFT' then raise exception 'FORM_RESPONSE_CLOSED';end if;
 if exists(select 1 from unnest(p_people) x where not exists(select 1 from public.staff_people p join public.staff_people_units u on u.person_id=p.id join public.units un on un.name=u.unit and un.active where p.id=x and p.active and u.unit=p_unit and public.forms_area_key(p.area)=any(public.forms_evaluation_areas(config)))) then raise exception 'FORM_EVALUATION_USER_INVALID';end if;
 select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'role',p.job,'area',p.area) order by p.name,p.id) into chosen from public.staff_people p where p.id=any(p_people);
 update public.form_responses set evaluated_people=chosen,answers=jsonb_build_object('__evaluations',(select jsonb_object_agg(x::text,'{}'::jsonb) from unnest(p_people) x)),revision=revision+1,updated_at=now() where id=r.id returning * into r;
 insert into public.form_audit(form_id,response_id,action,actor_id,actor_name,details) values(r.form_id,r.id,'SELECT_EVALUATED_PEOPLE',auth.uid(),r.respondent_name,jsonb_build_object('people',chosen));
 return r;
end;$$;
create or replace function public.my_form_evaluations(p_unit text,p_from date,p_to date,p_offset integer default 0) returns setof jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r public.form_responses%rowtype;person jsonb;own_answers jsonb;checked jsonb;own_plans jsonb;clean_schema jsonb;person_id uuid;current_name text;
begin
 if not public.forms_enabled() or not public.has_permission('FORMS_SELF_VIEW') or not public.user_has_unit(p_unit) then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>1830 or p_offset is null or p_offset<0 or p_offset>=10000 then raise exception 'FORM_FILTER_INVALID';end if;
 select id,name into person_id,current_name from public.staff_people where profile_id=auth.uid();
 if person_id is null then return;end if;
 for r in select * from public.form_responses fr where fr.unit=p_unit and fr.status='COMPLETED'
 and fr.started_at>=(p_from::timestamp at time zone 'America/Fortaleza') and fr.started_at<((p_to+1)::timestamp at time zone 'America/Fortaleza')
 and fr.evaluated_people @> jsonb_build_array(jsonb_build_object('id',person_id::text))
 order by fr.started_at desc,fr.id limit 250 offset p_offset loop
  select value into person from jsonb_array_elements(r.evaluated_people) where value->>'id'=person_id::text;
  own_answers:=public.forms_person_answers(r.schema_snapshot,r.answers,person_id);
  checked:=public.forms_validate_answers(r.schema_snapshot,own_answers,false);
  clean_schema:=jsonb_set(r.schema_snapshot,'{evaluation}',jsonb_build_object('enabled',true,'area',person->>'area'));
  select coalesce(jsonb_agg(jsonb_build_object('field_id',p.field_id,'description',p.description,'responsible_name',p.responsible_name,'due_date',p.due_date,'status',p.status,'completion_note',p.completion_note) order by p.field_id),'[]') into own_plans
  from public.form_action_plans p where p.response_id=r.id and exists(
   select 1 from jsonb_array_elements(r.schema_snapshot->'sections') s cross join lateral jsonb_array_elements(s->'fields') f
   where p.field_id=case when f->>'scope'='INDIVIDUAL' then (f->>'id')||'@'||person_id::text else f->>'id' end);
  return next jsonb_build_object('id',r.id,'code',r.code,'form_id',r.form_id,'form_name',r.form_name,'form_area',r.form_area,'form_version',r.form_version,
   'unit',r.unit,'respondent_name',r.respondent_name,'status',r.status,'started_at',r.started_at,'completed_at',r.completed_at,
   'schema_snapshot',clean_schema,'answers',checked->'answers','score',checked->'score','ok_count',checked->'ok','nok_count',checked->'nok','na_count',checked->'na',
   'evaluated_people',jsonb_build_array(person),'evaluated_user_id',person_id,'source_kind',r.source_kind,'source_metadata',r.source_metadata,'evaluated_name',coalesce(current_name,person->>'name'),'evaluated_role',person->>'role','evaluated_area',person->>'area',
   '_evaluation_view',true,'_self_view',true,'own_plans',own_plans);
 end loop;
end;$$;

notify pgrst,'reload schema';
commit;
