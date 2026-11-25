begin;
-- The directory is the only identity entry point. Opening Escala must not
-- require a second manual import of people already registered for that unit.
alter table public.escala_staff drop constraint if exists escala_staff_job_check;
alter table public.escala_staff add constraint escala_staff_job_check check(length(btrim(job)) between 1 and 100);
create or replace function staff_private.ensure_escala_person(p_person uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.escala_staff(unit,person_id,profile_id,name,job)
 select u.unit,p.id,p.profile_id,p.name,p.job from public.staff_people p
 join public.staff_people_units u on u.person_id=p.id join public.units un on un.name=u.unit and un.active
 where p.id=p_person and p.active and not exists(select 1 from public.escala_staff s where s.unit=u.unit and s.person_id=p.id)
 on conflict do nothing;
 update public.escala_staff s set name=p.name,job=p.job,profile_id=p.profile_id,
 status=case when not p.active or not exists(select 1 from public.staff_people_units u join public.units un on un.name=u.unit and un.active where u.person_id=p.id and u.unit=s.unit) then 'INACTIVE' else s.status end,
 revision=s.revision+1,updated_at=now()
 from public.staff_people p where p.id=p_person and s.person_id=p.id and s.deleted_at is null
 and (s.name is distinct from p.name or s.job is distinct from p.job or s.profile_id is distinct from p.profile_id
 or (s.status<>'INACTIVE' and (not p.active or not exists(select 1 from public.staff_people_units u join public.units un on un.name=u.unit and un.active where u.person_id=p.id and u.unit=s.unit))));
end;$$;
create or replace function staff_private.sync_operational_people() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_person uuid;
begin
 if tg_table_name='staff_people' then v_person:=new.id;elsif tg_op='DELETE' then v_person:=old.person_id;else v_person:=new.person_id;end if;
 perform staff_private.ensure_escala_person(v_person);
 return null;
end;$$;
drop trigger if exists staff_sync on public.staff_people;
create trigger staff_sync after insert or update on public.staff_people for each row execute function staff_private.sync_operational_people();
-- Existing unit insert/delete triggers already call the replaced function.
do $$declare person record;begin
 for person in select id from public.staff_people loop perform staff_private.ensure_escala_person(person.id);end loop;
end;$$;
create or replace function public.escala_state(p_unit text,p_month date) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;begin
 result:=public.escala_state_before_directory(p_unit,p_month);
 return result||jsonb_build_object(
 'staff',(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('area',coalesce(p.area,'')) order by s.name,s.id),'[]') from public.escala_staff s left join public.staff_people p on p.id=s.person_id where s.unit=p_unit),
 'profiles',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'role',p.job) order by p.name),'[]') from public.staff_people p join public.staff_people_units u on u.person_id=p.id where u.unit=p_unit and p.active));
end;$$;
revoke all on function staff_private.ensure_escala_person(uuid),staff_private.sync_operational_people() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
