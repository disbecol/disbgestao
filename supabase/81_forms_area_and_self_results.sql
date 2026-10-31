-- Formulários: equipe dinâmica por área e consulta privada da própria avaliação.
-- Não modifica respostas, resultados ou pessoas dos históricos existentes.
begin;
insert into public.permissions(code,module,name,description,sort_order,active) values
 ('FORMS_SELF_VIEW','Formulários','Minhas avaliações','Consultar somente os próprios resultados, perguntas e evidências.',15,true)
on conflict(code) do update set name=excluded.name,description=excluded.description,active=true;
insert into public.role_permissions(role,permission_code)
select r,'FORMS_SELF_VIEW' from unnest(array['ADMIN','COLABORADOR_ARMAZEM','CONFERENTE','COLABORADOR_ENTREGA','MOTORISTA_PUXADOR','VENDEDOR','GERENTE_VENDAS']) r on conflict do nothing;

alter table public.profiles add column if not exists evaluation_area text not null default '';
alter table public.profiles drop constraint if exists profile_evaluation_area_length;
alter table public.profiles add constraint profile_evaluation_area_length check(length(evaluation_area)<=100);

create or replace function public.forms_staff_area(p_role text,p_area text) returns text
language sql immutable set search_path=public,pg_temp as $$
 select coalesce(nullif(btrim(p_area),''),case p_role when 'ADMIN' then 'Gestão' when 'COLABORADOR_ENTREGA' then 'Entrega' when 'MOTORISTA_PUXADOR' then 'Puxada' when 'COLABORADOR_ARMAZEM' then 'Armazém' when 'CONFERENTE' then 'Armazém' when 'VENDEDOR' then 'Vendas' when 'GERENTE_VENDAS' then 'Vendas' else '' end);
$$;
-- Preserva a área explicitamente escolhida nos modelos antigos quando não há conflito.
with members as (
 select p.id,min(btrim(f.schema->'evaluation'->>'area')) area
 from public.profiles p join public.form_definitions f on (f.schema->'evaluation'->'user_ids') ? p.id::text
 where coalesce((f.schema->'evaluation'->>'enabled')::boolean,false) and length(btrim(f.schema->'evaluation'->>'area')) between 1 and 100
 group by p.id having count(distinct lower(btrim(f.schema->'evaluation'->>'area')))=1
) update public.profiles p set evaluation_area=m.area from members m where p.id=m.id and p.evaluation_area='';

create table if not exists public.form_staff_area_audit(
 id bigint generated always as identity primary key,user_id uuid not null references public.profiles(id),
 old_area text not null,new_area text not null,actor_id uuid not null references public.profiles(id),changed_at timestamptz not null default now()
);
alter table public.form_staff_area_audit enable row level security;
drop policy if exists forms_staff_area_audit_read on public.form_staff_area_audit;
create policy forms_staff_area_audit_read on public.form_staff_area_audit for select to authenticated using(public.has_permission('ADMIN_USERS'));
revoke all on public.form_staff_area_audit from anon,authenticated;
grant select on public.form_staff_area_audit to authenticated;
create or replace function public.admin_set_form_staff_area(p_user_id uuid,p_area text) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare previous text;new_area text:=btrim(coalesce(p_area,''));
begin
 if not public.has_permission('ADMIN_USERS') then raise exception 'FORBIDDEN';end if;
 if length(new_area)>100 then raise exception 'FORM_AREA_INVALID';end if;
 select evaluation_area into previous from public.profiles where id=p_user_id for update;
 if not found then raise exception 'USUARIO_NAO_ENCONTRADO';end if;
 if previous is distinct from new_area then
  update public.profiles set evaluation_area=new_area where id=p_user_id;
  insert into public.form_staff_area_audit(user_id,old_area,new_area,actor_id) values(p_user_id,previous,new_area,auth.uid());
 end if;
 return new_area;
end;$$;
create or replace function public.forms_people_with_areas() returns table(id uuid,name text,role text,units text[],area text)
language sql stable security definer set search_path=public,pg_temp as $$
 select p.id,p.name,p.role,array_agg(u.unit_name order by u.unit_name),public.forms_staff_area(p.role,p.evaluation_area)
 from public.profiles p join public.user_units u on u.user_id=p.id join public.units un on un.name=u.unit_name and un.active
 where p.active and public.forms_enabled() and public.user_has_unit(u.unit_name)
 and (public.has_permission('FORMS_MANAGE') or public.has_permission('FORMS_REPORT'))
 group by p.id,p.name,p.role,p.evaluation_area order by p.name;
$$;
create or replace function public.forms_validate_schema(p_schema jsonb) returns void
language plpgsql immutable set search_path=public,pg_temp as $$
declare s jsonb;f jsonb;ids text[]:='{}';n integer:=0;opts text[];
begin
 if jsonb_typeof(p_schema) is distinct from 'object' or jsonb_typeof(p_schema->'sections') is distinct from 'array'
 or pg_column_size(p_schema)>500000 then raise exception 'FORM_SCHEMA_INVALID';end if;
 if jsonb_array_length(p_schema->'sections') not between 1 and 30 then raise exception 'FORM_SECTIONS_INVALID';end if;
 for s in select value from jsonb_array_elements(p_schema->'sections') loop
  if coalesce(s->>'id','') !~ '^[A-Za-z0-9_-]{1,80}$' or s->>'id'=any(ids)
   or length(btrim(coalesce(s->>'title',''))) not between 1 and 150
   or jsonb_typeof(s->'fields') is distinct from 'array' then raise exception 'FORM_SECTION_INVALID';end if;
  ids:=array_append(ids,s->>'id');
  if jsonb_array_length(s->'fields')<1 then raise exception 'FORM_SECTION_EMPTY';end if;
  for f in select value from jsonb_array_elements(s->'fields') loop
   n:=n+1;
   if coalesce(f->>'id','') !~ '^[A-Za-z0-9_-]{1,80}$' or f->>'id'=any(ids)
    or length(btrim(coalesce(f->>'label',''))) not between 1 and 500 or length(coalesce(f->>'help',''))>500
    or coalesce(f->>'type','') not in ('BOOLEAN','TEXT','LONG_TEXT','NUMBER','DATE','SINGLE_CHOICE','MULTIPLE_CHOICE','PHOTO')
    then raise exception 'FORM_FIELD_INVALID';end if;
   if coalesce(f->>'scope','GROUP') not in ('GROUP','INDIVIDUAL') or (f->>'scope'='INDIVIDUAL' and not coalesce((p_schema->'evaluation'->>'enabled')::boolean,false)) then raise exception 'FORM_SCOPE_INVALID';end if;
   ids:=array_append(ids,f->>'id');
   if f->>'type' in ('SINGLE_CHOICE','MULTIPLE_CHOICE') then
    if jsonb_typeof(f->'options') is distinct from 'array' then raise exception 'FORM_OPTIONS_INVALID';end if;
    if jsonb_array_length(f->'options') not between 2 and 30 or exists(select 1 from jsonb_array_elements(f->'options') o where jsonb_typeof(o) is distinct from 'string' or length(btrim(o#>>'{}')) not between 1 and 150)
      then raise exception 'FORM_OPTIONS_INVALID';end if;
    select array_agg(value) into opts from jsonb_array_elements_text(f->'options');
    if cardinality(opts)<>(select count(distinct x) from unnest(opts) x) then raise exception 'FORM_OPTIONS_DUPLICATED';end if;
   end if;
   if coalesce((f->>'scored')::boolean,false) then
    if f->>'type'='BOOLEAN' then
     if coalesce(f->>'expected','') not in ('YES','NO') then raise exception 'FORM_EXPECTED_INVALID';end if;
    elsif f->>'type'='SINGLE_CHOICE' then
     if not coalesce((f->'options') ? (f->>'expected'),false) then raise exception 'FORM_EXPECTED_INVALID';end if;
    else raise exception 'FORM_SCORE_TYPE_INVALID';end if;
   end if;
   if f->>'type'='NUMBER' then
    if f->>'min' is not null and jsonb_typeof(f->'min')<>'number' then raise exception 'FORM_NUMBER_INVALID';end if;
    if f->>'max' is not null and jsonb_typeof(f->'max')<>'number' then raise exception 'FORM_NUMBER_INVALID';end if;
    if (f->>'min')::numeric>(f->>'max')::numeric then raise exception 'FORM_NUMBER_INVALID';end if;
   end if;
  end loop;
 end loop;
 if coalesce((p_schema->'evaluation'->>'enabled')::boolean,false) then
  if length(btrim(coalesce(p_schema->'evaluation'->>'area',''))) not between 1 and 100 then raise exception 'FORM_EVALUATION_INVALID';end if;
 end if;
 if n>300 then raise exception 'FORM_TOO_MANY_FIELDS';end if;
end;$$;
create or replace function public.save_form_definition(p_id uuid,p_expected_version integer,p_payload jsonb) returns public.form_definitions
language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.form_definitions%rowtype;v_units text[];v_apply_roles text[];v_report_roles text[];v_apply_users uuid[];v_report_users uuid[];v_name text;v_status text;v_before jsonb;v_profile public.profiles%rowtype;
begin
 if not public.forms_enabled() or not public.has_permission('FORMS_MANAGE') then raise exception 'FORBIDDEN';end if;
 if coalesce((p_payload->'schema'->'evaluation'->>'enabled')::boolean,false) then
  p_payload:=jsonb_set(p_payload,'{schema,evaluation}',((p_payload->'schema'->'evaluation')-'user_ids')||jsonb_build_object('membership','AREA'));
 end if;
 perform public.forms_validate_schema(p_payload->'schema');
 v_name:=btrim(coalesce(p_payload->>'name',''));v_status:=coalesce(p_payload->>'status','DRAFT');
 if length(v_name) not between 1 and 200 or length(coalesce(p_payload->>'description',''))>350
 or length(btrim(coalesce(p_payload->>'area',''))) not between 1 and 100
 or v_status not in ('DRAFT','PUBLISHED','ARCHIVED') then raise exception 'FORM_DATA_INVALID';end if;
 select array_agg(distinct value) into v_units from jsonb_array_elements_text(p_payload->'units');
 if coalesce(cardinality(v_units),0)=0 or exists(select 1 from unnest(v_units) x where not public.user_has_unit(x)) then raise exception 'UNIDADE_SEM_ACESSO';end if;

 select coalesce(array_agg(distinct value),'{}') into v_apply_roles from jsonb_array_elements_text(coalesce(p_payload->'apply_roles','[]'));
 select coalesce(array_agg(distinct value),'{}') into v_report_roles from jsonb_array_elements_text(coalesce(p_payload->'report_roles','[]'));
 if exists(select 1 from unnest(v_apply_roles||v_report_roles) x where x not in ('ADMIN','COLABORADOR_ARMAZEM','CONFERENTE','COLABORADOR_ENTREGA','MOTORISTA_PUXADOR','VENDEDOR','GERENTE_VENDAS')) then raise exception 'FORM_ROLE_INVALID';end if;
 select coalesce(array_agg(distinct value::uuid),'{}') into v_apply_users from jsonb_array_elements_text(coalesce(p_payload->'apply_user_ids','[]'));
 select coalesce(array_agg(distinct value::uuid),'{}') into v_report_users from jsonb_array_elements_text(coalesce(p_payload->'report_user_ids','[]'));
 if exists(select 1 from unnest(v_apply_users||v_report_users) x where not exists(select 1 from public.profiles p join public.user_units uu on uu.user_id=p.id where p.id=x and p.active and uu.unit_name=any(v_units))) then raise exception 'FORM_USER_INVALID';end if;
 if not coalesce((p_payload->>'apply_everyone')::boolean,false) and cardinality(v_apply_roles)+cardinality(v_apply_users)=0 then raise exception 'FORM_APPLICANTS_REQUIRED';end if;
 select * into v_profile from public.profiles where id=auth.uid() and active;
 if p_id is not null then
  select * into f from public.form_definitions where id=p_id for update;
  if not found or not public.forms_can_access(p_id,'MANAGE') then raise exception 'FORBIDDEN';end if;
  if f.version is distinct from p_expected_version then raise exception 'FORM_VERSION_CONFLICT';end if;
  v_before:=to_jsonb(f);
  update public.form_definitions set name=v_name,description=coalesce(p_payload->>'description',''),area=btrim(p_payload->>'area'),form_type=coalesce(p_payload->>'form_type','CHECKLIST'),
   units=v_units,apply_everyone=coalesce((p_payload->>'apply_everyone')::boolean,false),apply_roles=v_apply_roles,apply_user_ids=v_apply_users,
   report_roles=v_report_roles,report_user_ids=v_report_users,status=v_status,schema=p_payload->'schema',version=version+1,updated_at=now()
  where id=p_id returning * into f;
 else
  insert into public.form_definitions(name,description,area,form_type,units,apply_everyone,apply_roles,apply_user_ids,report_roles,report_user_ids,status,schema,created_by,created_by_name)
  values(v_name,coalesce(p_payload->>'description',''),btrim(p_payload->>'area'),coalesce(p_payload->>'form_type','CHECKLIST'),v_units,
   coalesce((p_payload->>'apply_everyone')::boolean,false),v_apply_roles,v_apply_users,v_report_roles,v_report_users,v_status,p_payload->'schema',auth.uid(),v_profile.name) returning * into f;
 end if;
 insert into public.form_audit(form_id,action,actor_id,actor_name,details)
 values(f.id,case when p_id is null then 'CREATE_FORM' else 'UPDATE_FORM' end,auth.uid(),v_profile.name,jsonb_build_object('before',v_before,'after',to_jsonb(f)));
 return f;
end;$$;
create or replace function public.forms_evaluation_people(p_form_id uuid,p_unit text) returns table(id uuid,name text,role text)
language sql stable security definer set search_path=public,pg_temp as $$
 select p.id,p.name,p.role from public.form_definitions f join public.profiles p
 on lower(public.forms_staff_area(p.role,p.evaluation_area))=lower(btrim(f.schema->'evaluation'->>'area'))
 where f.id=p_form_id and p.active and coalesce((f.schema->'evaluation'->>'enabled')::boolean,false) and public.forms_can_access(f.id,'FILL',p_unit)
 and exists(select 1 from public.user_units u join public.units un on un.name=u.unit_name and un.active where u.user_id=p.id and u.unit_name=p_unit) order by p.name,p.id;
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
 if exists(select 1 from unnest(p_people) x where not exists(select 1 from public.profiles p join public.user_units u on u.user_id=p.id join public.units un on un.name=u.unit_name and un.active where p.id=x and p.active and u.unit_name=p_unit and lower(public.forms_staff_area(p.role,p.evaluation_area))=lower(btrim(config->>'area')))) then raise exception 'FORM_EVALUATION_USER_INVALID';end if;
 select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'role',p.role,'area',config->>'area') order by p.name,p.id) into chosen from public.profiles p where p.id=any(p_people);
 update public.form_responses set evaluated_people=chosen,answers=jsonb_build_object('__evaluations',(select jsonb_object_agg(x::text,'{}'::jsonb) from unnest(p_people) x)),revision=revision+1,updated_at=now() where id=r.id returning * into r;
 insert into public.form_audit(form_id,response_id,action,actor_id,actor_name,details) values(r.form_id,r.id,'SELECT_EVALUATED_PEOPLE',auth.uid(),r.respondent_name,jsonb_build_object('people',chosen));
 return r;
end;$$;

-- Achata exclusivamente as respostas da pessoa indicada; uso interno, sem RPC público.
create or replace function public.forms_person_answers(p_schema jsonb,p_answers jsonb,p_person uuid) returns jsonb
language plpgsql immutable set search_path=public,pg_temp as $$
declare f jsonb;result jsonb:=jsonb_build_object('__sections',coalesce(p_answers->'__sections','{}'));
begin
 for f in select q.value from jsonb_array_elements(p_schema->'sections') s cross join lateral jsonb_array_elements(s->'fields') q loop
  result:=result||jsonb_build_object(f->>'id',coalesce(case when f->>'scope'='INDIVIDUAL' then p_answers->'__evaluations'->p_person::text->(f->>'id') else p_answers->(f->>'id') end,'{}'::jsonb));
 end loop;
 return result;
end;$$;

create or replace function public.my_form_evaluations(p_unit text,p_from date,p_to date,p_offset integer default 0) returns setof jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r public.form_responses%rowtype;person jsonb;own_answers jsonb;checked jsonb;own_plans jsonb;clean_schema jsonb;
begin
 if not public.forms_enabled() or not public.has_permission('FORMS_SELF_VIEW') or not public.user_has_unit(p_unit) then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>1830 or p_offset is null or p_offset<0 or p_offset>=10000 then raise exception 'FORM_FILTER_INVALID';end if;
 for r in select * from public.form_responses fr where fr.unit=p_unit and fr.status='COMPLETED'
 and fr.started_at>=(p_from::timestamp at time zone 'America/Fortaleza') and fr.started_at<((p_to+1)::timestamp at time zone 'America/Fortaleza')
 and fr.evaluated_people @> jsonb_build_array(jsonb_build_object('id',auth.uid()::text))
 order by fr.started_at desc,fr.id limit 250 offset p_offset loop
  select value into person from jsonb_array_elements(r.evaluated_people) where value->>'id'=auth.uid()::text;
  own_answers:=public.forms_person_answers(r.schema_snapshot,r.answers,auth.uid());
  checked:=public.forms_validate_answers(r.schema_snapshot,own_answers,false);
  clean_schema:=jsonb_set(r.schema_snapshot,'{evaluation}',jsonb_build_object('enabled',true,'area',person->>'area'));
  select coalesce(jsonb_agg(jsonb_build_object('field_id',p.field_id,'description',p.description,'responsible_name',p.responsible_name,'due_date',p.due_date,'status',p.status,'completion_note',p.completion_note) order by p.field_id),'[]') into own_plans
  from public.form_action_plans p where p.response_id=r.id and exists(
   select 1 from jsonb_array_elements(r.schema_snapshot->'sections') s cross join lateral jsonb_array_elements(s->'fields') f
   where p.field_id=case when f->>'scope'='INDIVIDUAL' then (f->>'id')||'@'||auth.uid()::text else f->>'id' end);
  return next jsonb_build_object('id',r.id,'code',r.code,'form_id',r.form_id,'form_name',r.form_name,'form_area',r.form_area,'form_version',r.form_version,
   'unit',r.unit,'respondent_name',r.respondent_name,'status',r.status,'started_at',r.started_at,'completed_at',r.completed_at,
   'schema_snapshot',clean_schema,'answers',checked->'answers','score',checked->'score','ok_count',checked->'ok','nok_count',checked->'nok','na_count',checked->'na',
   'evaluated_people',jsonb_build_array(person),'evaluated_user_id',auth.uid(),'evaluated_name',person->>'name','evaluated_role',person->>'role','evaluated_area',person->>'area',
   '_evaluation_view',true,'_self_view',true,'own_plans',own_plans);
 end loop;
end;$$;
create index if not exists form_responses_evaluated_people_gin on public.form_responses using gin(evaluated_people jsonb_path_ops) where status='COMPLETED';

create or replace function public.forms_evidence_access(p_path text,p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r public.form_responses%rowtype;v_id uuid;own_answers jsonb;
begin
 if p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$' then return false;end if;
 begin v_id:=split_part(p_path,'/',2)::uuid;exception when invalid_text_representation then return false;end;
 select * into r from public.form_responses where id=v_id;
 if r.id is null or split_part(p_path,'/',1)<>r.respondent_id::text or not public.forms_enabled() or not public.user_has_unit(r.unit) then return false;end if;
 if p_write then return r.respondent_id=auth.uid() and r.status='DRAFT' and public.forms_can_access(r.form_id,'FILL',r.unit);end if;
 if (r.respondent_id=auth.uid() and public.has_permission('FORMS_FILL')) or public.forms_can_access(r.form_id,'REPORT',r.unit) then return true;end if;
 if r.status<>'COMPLETED' or not public.has_permission('FORMS_SELF_VIEW') or not exists(select 1 from jsonb_array_elements(r.evaluated_people) p where p->>'id'=auth.uid()::text) then return false;end if;
 own_answers:=public.forms_person_answers(r.schema_snapshot,r.answers,auth.uid());
 return exists(select 1 from jsonb_each(own_answers) a cross join lateral jsonb_array_elements_text(case when jsonb_typeof(a.value->'photos')='array' then a.value->'photos' else '[]'::jsonb end) photo where photo.value=p_path);
end;$$;
-- A RLS de form_responses permanece inalterada: avaliado não recebe o registro coletivo.
revoke all on function public.forms_staff_area(text,text),public.forms_person_answers(jsonb,jsonb,uuid),public.admin_set_form_staff_area(uuid,text),public.forms_people_with_areas(),public.my_form_evaluations(text,date,date,integer) from public,anon,authenticated;
grant execute on function public.admin_set_form_staff_area(uuid,text),public.forms_people_with_areas(),public.my_form_evaluations(text,date,date,integer) to authenticated;
commit;
