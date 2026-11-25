begin;
-- Remove a duplicate/obsolete identity from current rosters while retaining its
-- stable ID for previously completed individual evaluations and schedule records.
alter table public.staff_people add column if not exists archived_at timestamptz;
alter table public.staff_people add constraint staff_people_archive_inactive check(archived_at is null or not active);
drop policy if exists staff_read on public.staff_people;
create policy staff_read on public.staff_people for select to authenticated using(archived_at is null and exists(select 1 from public.staff_people_units u where u.person_id=id and staff_private.can_read(u.unit)));
create or replace function public.staff_directory_state(p_unit text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not staff_private.can_manage(p_unit) and not (staff_private.can_read(p_unit) and public.has_permission('STAFF_DIRECTORY_VIEW')) then raise exception 'FORBIDDEN';end if;
 return jsonb_build_object('people',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('units',(select jsonb_agg(u.unit order by u.unit) from staff_people_units u where u.person_id=p.id and public.user_has_unit(u.unit)),
 'can_edit',not exists(select 1 from staff_people_units u where u.person_id=p.id and not staff_private.can_manage(u.unit))) order by p.name,p.id),'[]') from staff_people p where p.archived_at is null and exists(select 1 from staff_people_units u where u.person_id=p.id and u.unit=p_unit)),
 'units',(select coalesce(jsonb_agg(name order by name),'[]') from units where active and staff_private.can_manage(name)));
end;$$;
create or replace function public.staff_directory_save(p_unit text,p_id uuid,p_revision integer,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare person public.staff_people%rowtype;old jsonb;unit_list text[];actor text;
begin
 if not staff_private.can_manage(p_unit) then raise exception 'FORBIDDEN';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload)>12000 or jsonb_typeof(p_payload->'units') is distinct from 'array' then raise exception 'STAFF_DATA_INVALID';end if;
 select array_agg(distinct btrim(value)) into unit_list from jsonb_array_elements_text(p_payload->'units');
 if coalesce(cardinality(unit_list),0) not between 1 and 20 or not p_unit=any(unit_list) or exists(select 1 from unnest(unit_list) u where not staff_private.can_manage(u)) then raise exception 'UNIDADE_SEM_ACESSO';end if;
 perform pg_advisory_xact_lock(hashtext('staff-directory'));
 if p_id is not null then
  select * into person from staff_people where id=p_id for update;
  if not found or person.archived_at is not null or not exists(select 1 from staff_people_units where person_id=p_id and unit=p_unit) or exists(select 1 from staff_people_units where person_id=p_id and not staff_private.can_manage(unit)) then raise exception 'FORBIDDEN';end if;
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

notify pgrst,'reload schema';
commit;
