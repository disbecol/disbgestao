-- Formulários v1.7.64: avaliados por pergunta, calendário e tipos.
-- Preserva respostas anteriores sem atribuir avaliações retroativas ao aplicador.
begin;
alter table public.form_definitions drop constraint if exists form_definitions_form_type_check;
alter table public.form_definitions add constraint form_definitions_form_type_check check(form_type in ('CHECKLIST','DTO','GSP','GSDPQ','GSA','GSR','ANOMALY','SAFETY','5S','OTHER','AUDIT','SURVEY'));
alter table public.form_responses add column if not exists evaluated_people jsonb not null default '[]' check(jsonb_typeof(evaluated_people)='array' and jsonb_array_length(evaluated_people)<=100);

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
  if length(btrim(coalesce(p_schema->'evaluation'->>'area',''))) not between 1 and 100 or jsonb_typeof(p_schema->'evaluation'->'user_ids') is distinct from 'array' then raise exception 'FORM_EVALUATION_INVALID';end if;
  if jsonb_array_length(p_schema->'evaluation'->'user_ids') not between 1 and 100 then raise exception 'FORM_EVALUATION_INVALID';end if;
 end if;
 if n>300 then raise exception 'FORM_TOO_MANY_FIELDS';end if;
end;$$;

create or replace function public.save_form_definition(p_id uuid,p_expected_version integer,p_payload jsonb) returns public.form_definitions
language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.form_definitions%rowtype;v_units text[];v_apply_roles text[];v_report_roles text[];v_apply_users uuid[];v_report_users uuid[];v_name text;v_status text;v_before jsonb;v_profile public.profiles%rowtype;
begin
 if not public.forms_enabled() or not public.has_permission('FORMS_MANAGE') then raise exception 'FORBIDDEN';end if;
 perform public.forms_validate_schema(p_payload->'schema');
 v_name:=btrim(coalesce(p_payload->>'name',''));v_status:=coalesce(p_payload->>'status','DRAFT');
 if length(v_name) not between 1 and 200 or length(coalesce(p_payload->>'description',''))>350
 or length(btrim(coalesce(p_payload->>'area',''))) not between 1 and 100
 or v_status not in ('DRAFT','PUBLISHED','ARCHIVED') then raise exception 'FORM_DATA_INVALID';end if;
 select array_agg(distinct value) into v_units from jsonb_array_elements_text(p_payload->'units');
 if coalesce(cardinality(v_units),0)=0 or exists(select 1 from unnest(v_units) x where not public.user_has_unit(x)) then raise exception 'UNIDADE_SEM_ACESSO';end if;
 if coalesce((p_payload->'schema'->'evaluation'->>'enabled')::boolean,false) and exists(
  select 1 from jsonb_array_elements_text(p_payload->'schema'->'evaluation'->'user_ids') x where not exists(
   select 1 from public.profiles p join public.user_units u on u.user_id=p.id where p.id=x.value::uuid and p.active and u.unit_name=any(v_units))) then raise exception 'FORM_EVALUATION_USER_INVALID';end if;
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

create or replace function public.forms_validate_answers(p_schema jsonb,p_answers jsonb,p_final boolean) returns jsonb
language plpgsql immutable set search_path=public,pg_temp as $$
declare s jsonb;f jsonb;a jsonb;v jsonb;v_text text;note text;plan text;out_answers jsonb:='{}';notes jsonb:='{}';ok integer:=0;nok integer:=0;na integer:=0;is_negative boolean;photos jsonb;
begin
 if jsonb_typeof(p_answers) is distinct from 'object' or pg_column_size(p_answers)>1500000 then raise exception 'FORM_ANSWERS_INVALID';end if;
 for s in select value from jsonb_array_elements(p_schema->'sections') loop
  note:=coalesce(p_answers->'__sections'->>(s->>'id'),'');
  if length(note)>2000 then raise exception 'FORM_NOTE_TOO_LONG';end if;
  if note<>'' then notes:=notes||jsonb_build_object(s->>'id',note);end if;
  for f in select value from jsonb_array_elements(s->'fields') loop
   a:=p_answers->(f->>'id');v:=a->'value';v_text:=v#>>'{}';note:=btrim(coalesce(a->>'observation',''));plan:=btrim(coalesce(a->>'plan',''));
   photos:=coalesce(a->'photos','[]');
   if jsonb_typeof(photos) is distinct from 'array' then raise exception 'FORM_PHOTOS_INVALID';end if;
   if jsonb_array_length(photos)>5 or exists(select 1 from jsonb_array_elements(photos) x where jsonb_typeof(x)<>'string' or length(x#>>'{}')>250) then raise exception 'FORM_PHOTOS_INVALID';end if;
   if f->>'type'='PHOTO' then v:=photos;v_text:=v#>>'{}';end if;
   if length(note)>2000 or length(plan)>2000 then raise exception 'FORM_NOTE_TOO_LONG';end if;
   if v is null or v='null'::jsonb or v='""'::jsonb or v='[]'::jsonb then
    if p_final and coalesce((f->>'required')::boolean,false) then raise exception 'FORM_REQUIRED:%',f->>'label';end if;
    continue;
   end if;
   if f->>'type'='BOOLEAN' then
    if jsonb_typeof(v)<>'string' or v_text not in ('YES','NO','NA') or (v_text='NA' and not coalesce((f->>'allow_na')::boolean,false)) then raise exception 'FORM_ANSWER_INVALID:%',f->>'label';end if;
   elsif f->>'type' in ('TEXT','LONG_TEXT') then
    if jsonb_typeof(v)<>'string' or length(btrim(v_text))<1 or length(v_text)>(case when f->>'type'='TEXT' then 500 else 4000 end) then raise exception 'FORM_ANSWER_INVALID:%',f->>'label';end if;
   elsif f->>'type'='NUMBER' then
    if jsonb_typeof(v)<>'number' then raise exception 'FORM_ANSWER_INVALID:%',f->>'label';end if;
    if (f->>'min' is not null and v_text::numeric<(f->>'min')::numeric) or (f->>'max' is not null and v_text::numeric>(f->>'max')::numeric) then raise exception 'FORM_ANSWER_INVALID:%',f->>'label';end if;
   elsif f->>'type'='DATE' then
    if jsonb_typeof(v)<>'string' or v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'FORM_ANSWER_INVALID:%',f->>'label';end if;
    perform v_text::date;
   elsif f->>'type'='SINGLE_CHOICE' then
    if jsonb_typeof(v)<>'string' or not coalesce((f->'options')?v_text,false) then raise exception 'FORM_ANSWER_INVALID:%',f->>'label';end if;
   elsif f->>'type'='MULTIPLE_CHOICE' then
    if jsonb_typeof(v)<>'array' then raise exception 'FORM_ANSWER_INVALID:%',f->>'label';end if;
    if exists(select 1 from jsonb_array_elements(v) e where jsonb_typeof(e)<>'string' or not coalesce((f->'options')?(e#>>'{}'),false))
      or jsonb_array_length(v)<>(select count(distinct value) from jsonb_array_elements_text(v)) then raise exception 'FORM_ANSWER_INVALID:%',f->>'label';end if;
   end if;
   is_negative:=false;
   if coalesce((f->>'scored')::boolean,false) then
    if f->>'type'='BOOLEAN' and v_text='NA' then na:=na+1;
    elsif v_text=f->>'expected' then ok:=ok+1;
    else nok:=nok+1;is_negative:=true;end if;
   end if;
   if p_final and is_negative and coalesce((f->>'require_note')::boolean,false) and note='' then raise exception 'FORM_NOK_NOTE_REQUIRED:%',f->>'label';end if;
   out_answers:=out_answers||jsonb_build_object(f->>'id',jsonb_build_object('value',v,'observation',note,'plan',case when is_negative then plan else '' end)||case when jsonb_array_length(photos)>0 then jsonb_build_object('photos',photos) else '{}'::jsonb end);
  end loop;
 end loop;
 out_answers:=out_answers||jsonb_build_object('__sections',notes);
 return jsonb_build_object('answers',out_answers,'ok',ok,'nok',nok,'na',na,'score',case when ok+nok>0 then round(ok::numeric/(ok+nok)*100,2) else null end);
end;$$;

-- Fotos privadas: o caminho sempre pertence ao aplicador e ao registro.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('form-evidence','form-evidence',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
create or replace function public.forms_evidence_access(p_path text,p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r public.form_responses%rowtype;v_id uuid;
begin
 if p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$' then return false;end if;
 begin v_id:=split_part(p_path,'/',2)::uuid;exception when invalid_text_representation then return false;end;
 select * into r from public.form_responses where id=v_id;
 if r.id is null or split_part(p_path,'/',1)<>r.respondent_id::text or not public.forms_enabled() or not public.user_has_unit(r.unit) then return false;end if;
 if p_write then return r.respondent_id=auth.uid() and r.status='DRAFT' and public.forms_can_access(r.form_id,'FILL',r.unit);end if;
 return (r.respondent_id=auth.uid() and public.has_permission('FORMS_FILL')) or public.forms_can_access(r.form_id,'REPORT',r.unit);
end;$$;
drop policy if exists forms_evidence_read on storage.objects;
create policy forms_evidence_read on storage.objects for select to authenticated using(bucket_id='form-evidence' and public.forms_evidence_access(name,false));
drop policy if exists forms_evidence_insert on storage.objects;
create policy forms_evidence_insert on storage.objects for insert to authenticated with check(bucket_id='form-evidence' and public.forms_evidence_access(name,true));
-- Sem UPDATE ou DELETE: evidências salvas não são removidas ao editar respostas.
create or replace function public.forms_validate_evidence(p_id uuid,p_answers jsonb) returns void
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare path text;paths text[];
begin
 select coalesce(array_agg(distinct p.value),'{}') into paths from (
  select v.value from jsonb_each(p_answers) a cross join lateral jsonb_array_elements_text(case when jsonb_typeof(a.value->'photos')='array' then a.value->'photos' else '[]'::jsonb end) v
  union all select v.value from jsonb_each(coalesce(p_answers->'__evaluations','{}')) e cross join lateral jsonb_each(e.value) a cross join lateral jsonb_array_elements_text(case when jsonb_typeof(a.value->'photos')='array' then a.value->'photos' else '[]'::jsonb end) v
 ) p;
 if cardinality(paths)>40 then raise exception 'FORM_TOO_MANY_PHOTOS';end if;
 foreach path in array paths loop
  if split_part(path,'/',1)<>auth.uid()::text or split_part(path,'/',2)<>p_id::text or not exists(select 1 from storage.objects where bucket_id='form-evidence' and name=path) then raise exception 'FORM_PHOTO_INVALID';end if;
 end loop;
end;$$;

-- As pessoas são escolhidas pelo gestor no modelo e filtradas pela unidade da aplicação.
create or replace function public.forms_evaluation_people(p_form_id uuid,p_unit text) returns table(id uuid,name text,role text)
language sql stable security definer set search_path=public,pg_temp as $$
 select p.id,p.name,p.role from public.form_definitions f join public.profiles p on (f.schema->'evaluation'->'user_ids') ? p.id::text
 where f.id=p_form_id and p.active and public.forms_can_access(f.id,'FILL',p_unit)
 and exists(select 1 from public.user_units u where u.user_id=p.id and u.unit_name=p_unit) order by p.name;
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
 if exists(select 1 from unnest(p_people) x where not (config->'user_ids') ? x::text or not exists(select 1 from public.profiles p join public.user_units u on u.user_id=p.id where p.id=x and p.active and u.unit_name=p_unit)) then raise exception 'FORM_EVALUATION_USER_INVALID';end if;
 select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'role',p.role,'area',config->>'area') order by p.name,p.id) into chosen from public.profiles p where p.id=any(p_people);
 update public.form_responses set evaluated_people=chosen,answers=jsonb_build_object('__evaluations',(select jsonb_object_agg(x::text,'{}'::jsonb) from unnest(p_people) x)),revision=revision+1,updated_at=now() where id=r.id returning * into r;
 insert into public.form_audit(form_id,response_id,action,actor_id,actor_name,details) values(r.form_id,r.id,'SELECT_EVALUATED_PEOPLE',auth.uid(),r.respondent_name,jsonb_build_object('people',chosen));
 return r;
end;$$;

create or replace function public.forms_validate_response(p_schema jsonb,p_answers jsonb,p_people jsonb,p_final boolean) returns jsonb
language plpgsql immutable set search_path=public,pg_temp as $$
declare person jsonb;f jsonb;joined jsonb;v jsonb;shared_schema jsonb;shared jsonb;individual jsonb;individuals jsonb:='{}';ok integer:=0;nok integer:=0;na integer:=0;person_answers jsonb;
begin
 if not coalesce((p_schema->'evaluation'->>'enabled')::boolean,false) then return public.forms_validate_answers(p_schema,p_answers,p_final);end if;
 if jsonb_typeof(p_answers) is distinct from 'object' or pg_column_size(p_answers)>5000000 or jsonb_typeof(p_people) is distinct from 'array' then raise exception 'FORM_ANSWERS_INVALID';end if;
 if jsonb_array_length(p_people)=0 then raise exception 'FORM_EVALUATION_REQUIRED';end if;
 if jsonb_typeof(coalesce(p_answers->'__evaluations','{}')) is distinct from 'object' then raise exception 'FORM_EVALUATION_ANSWERS_INVALID';end if;
 if exists(select 1 from jsonb_object_keys(coalesce(p_answers->'__evaluations','{}')) k where not exists(select 1 from jsonb_array_elements(p_people) p where p->>'id'=k)) then raise exception 'FORM_EVALUATION_USER_INVALID';end if;
 select jsonb_build_object('sections',jsonb_agg(s||jsonb_build_object('fields',(select coalesce(jsonb_agg(q),'[]') from jsonb_array_elements(s->'fields') q where coalesce(q->>'scope','GROUP')='GROUP')))) into shared_schema from jsonb_array_elements(p_schema->'sections') s;
 v:=public.forms_validate_answers(shared_schema,p_answers,p_final);shared:=v->'answers';
 for person in select value from jsonb_array_elements(p_people) loop
  person_answers:=coalesce(p_answers->'__evaluations'->(person->>'id'),'{}');
  if jsonb_typeof(person_answers) is distinct from 'object' then raise exception 'FORM_EVALUATION_ANSWERS_INVALID';end if;
  joined:=shared;individual:='{}';
  for f in select q.value from jsonb_array_elements(p_schema->'sections') s cross join lateral jsonb_array_elements(s->'fields') q where q.value->>'scope'='INDIVIDUAL' loop
   joined:=joined||jsonb_build_object(f->>'id',coalesce(person_answers->(f->>'id'),'{}'));
  end loop;
  v:=public.forms_validate_answers(p_schema,joined,p_final);
  for f in select q.value from jsonb_array_elements(p_schema->'sections') s cross join lateral jsonb_array_elements(s->'fields') q where q.value->>'scope'='INDIVIDUAL' loop
   individual:=individual||jsonb_build_object(f->>'id',v->'answers'->(f->>'id'));
  end loop;
  individuals:=individuals||jsonb_build_object(person->>'id',individual);ok:=ok+(v->>'ok')::int;nok:=nok+(v->>'nok')::int;na:=na+(v->>'na')::int;
 end loop;
 return jsonb_build_object('answers',shared||jsonb_build_object('__evaluations',individuals),'ok',ok,'nok',nok,'na',na,'score',case when ok+nok>0 then round(ok::numeric/(ok+nok)*100,2) else null end);
end;$$;

create or replace function public.save_form_response(p_id uuid,p_expected_revision integer,p_answers jsonb,p_finalize boolean default false) returns public.form_responses
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.form_responses%rowtype;v jsonb;s jsonb;f jsonb;plan text;person jsonb;field_key text;person_answer jsonb;
begin
 if not public.forms_enabled() then raise exception 'FORBIDDEN';end if;
 select * into r from public.form_responses where id=p_id for update;
 if not found or r.respondent_id<>auth.uid() or not public.user_has_unit(r.unit) or not public.has_permission('FORMS_FILL') then raise exception 'FORBIDDEN';end if;
 if r.status='COMPLETED' and p_finalize then return r;end if;
 if r.status<>'DRAFT' then raise exception 'FORM_RESPONSE_CLOSED';end if;
 if not public.forms_can_access(r.form_id,'FILL',r.unit) then raise exception 'FORBIDDEN';end if;
 if r.revision is distinct from p_expected_revision then raise exception 'FORM_VERSION_CONFLICT';end if;
 if r.assignment_id is not null then
  perform 1 from public.form_assignments where id=r.assignment_id and status='PENDING' for update;
  if not found then raise exception 'FORM_ASSIGNMENT_INVALID';end if;
 end if;
 v:=public.forms_validate_response(r.schema_snapshot,p_answers,r.evaluated_people,p_finalize);
 perform public.forms_validate_evidence(r.id,v->'answers');
 update public.form_responses set answers=v->'answers',ok_count=(v->>'ok')::integer,nok_count=(v->>'nok')::integer,na_count=(v->>'na')::integer,
  score=(v->>'score')::numeric,status=case when p_finalize then 'COMPLETED' else 'DRAFT' end,
  completed_at=case when p_finalize then now() else null end,revision=revision+1,updated_at=now() where id=p_id returning * into r;
 if p_finalize then
  if r.assignment_id is not null then update public.form_assignments set status='COMPLETED',response_id=r.id,updated_at=now() where id=r.assignment_id;end if;
  for s in select value from jsonb_array_elements(r.schema_snapshot->'sections') loop
   for f in select value from jsonb_array_elements(s->'fields') loop
    plan:=btrim(coalesce(r.answers->(f->>'id')->>'plan',''));
    if plan<>'' then insert into public.form_action_plans(response_id,field_id,description,responsible_id,responsible_name,created_by,updated_by)
     values(r.id,f->>'id',plan,auth.uid(),r.respondent_name,auth.uid(),auth.uid()) on conflict do nothing;end if;
   end loop;
  end loop;
  for person in select value from jsonb_array_elements(r.evaluated_people) loop
   for f in select q.value from jsonb_array_elements(r.schema_snapshot->'sections') sections cross join lateral jsonb_array_elements(sections->'fields') q where q.value->>'scope'='INDIVIDUAL' loop
    person_answer:=r.answers->'__evaluations'->(person->>'id')->(f->>'id');plan:=btrim(coalesce(person_answer->>'plan',''));field_key:=(f->>'id')||'@'||(person->>'id');
    if plan<>'' then insert into public.form_action_plans(response_id,field_id,description,responsible_id,responsible_name,created_by,updated_by)
     values(r.id,field_key,plan,auth.uid(),r.respondent_name,auth.uid(),auth.uid()) on conflict do nothing;end if;
   end loop;
  end loop;
  insert into public.form_audit(form_id,response_id,action,actor_id,actor_name,details)
   values(r.form_id,r.id,'COMPLETE_RESPONSE',auth.uid(),r.respondent_name,jsonb_build_object('score',r.score,'version',r.form_version));
 end if;
 return r;
end;$$;

create or replace function public.create_form_schedule(p_form_id uuid,p_unit text,p_users uuid[],p_start date,p_end date,p_repeat text,p_weekdays integer[] default '{}') returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_date date;v_user uuid;v_total integer:=0;v_added integer;v_name text;
begin
 if not public.forms_can_access(p_form_id,'MANAGE',p_unit) then raise exception 'FORBIDDEN';end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>365 or coalesce(cardinality(p_users),0) not between 1 and 100
   or p_repeat is null or p_repeat not in ('ONCE','DAILY','WEEKLY','BIWEEKLY','MONTHLY') then raise exception 'FORM_SCHEDULE_INVALID';end if;
 if p_repeat='WEEKLY' and (coalesce(cardinality(p_weekdays),0)=0 or exists(select 1 from unnest(p_weekdays) d where d<0 or d>6)) then raise exception 'FORM_WEEKDAYS_REQUIRED';end if;
 if exists(select 1 from unnest(p_users) u where not public.forms_subject_allowed(p_form_id,u,'FILL',p_unit)) then raise exception 'FORM_SCHEDULE_USER_FORBIDDEN';end if;
 for v_date in select generate_series(p_start,p_end,interval '1 day')::date loop
  if (p_repeat='ONCE' and v_date<>p_start) or (p_repeat='WEEKLY' and not(extract(dow from v_date)::integer=any(p_weekdays)))
   or (p_repeat='BIWEEKLY' and (v_date-p_start)%15<>0)
   or (p_repeat='MONTHLY' and extract(day from v_date)<>extract(day from p_start)) then continue;end if;
  foreach v_user in array p_users loop
   select name into v_name from public.profiles where id=v_user;
   insert into public.form_assignments(form_id,unit,user_id,user_name,due_date,created_by) values(p_form_id,p_unit,v_user,v_name,v_date,auth.uid()) on conflict do nothing;
   get diagnostics v_added=row_count;v_total:=v_total+v_added;
   if v_total>5000 then raise exception 'FORM_SCHEDULE_TOO_LARGE';end if;
  end loop;
 end loop;
 insert into public.form_audit(form_id,action,actor_id,actor_name,details) select p_form_id,'CREATE_SCHEDULE',auth.uid(),name,jsonb_build_object('unit',p_unit,'count',v_total,'from',p_start,'to',p_end,'repeat',p_repeat) from public.profiles where id=auth.uid();
 return v_total;
end;$$;

create or replace function public.save_form_evaluation_plan(p_response_id uuid,p_field_id text,p_expected_revision integer,p_payload jsonb) returns public.form_action_plans
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.form_responses%rowtype;a public.form_action_plans%rowtype;f jsonb;v_user public.profiles%rowtype;v_before jsonb;person_id text;real_field text;
begin
 select * into r from public.form_responses where id=p_response_id for share;
 if r.id is null or r.status<>'COMPLETED' or not public.user_has_unit(r.unit) or not public.forms_enabled()
  or not(public.forms_can_access(r.form_id,'REPORT',r.unit) or (r.respondent_id=auth.uid() and public.has_permission('FORMS_FILL'))) then raise exception 'FORBIDDEN';end if;
 person_id:=split_part(p_field_id,'@',2);real_field:=split_part(p_field_id,'@',1);
 if person_id='' or not exists(select 1 from jsonb_array_elements(r.evaluated_people) p where p->>'id'=person_id) then raise exception 'FORM_EVALUATION_USER_INVALID';end if;
 select q.value into f from jsonb_array_elements(r.schema_snapshot->'sections') s cross join lateral jsonb_array_elements(s->'fields') q where q.value->>'id'=real_field and q.value->>'scope'='INDIVIDUAL';
 r.answers:=coalesce(r.answers->'__evaluations'->person_id,'{}');
 if f is null or not coalesce((f->>'scored')::boolean,false) or r.answers->real_field->>'value' is null
  or r.answers->real_field->>'value'=f->>'expected' or (f->>'type'='BOOLEAN' and r.answers->real_field->>'value'='NA') then raise exception 'FORM_ISSUE_INVALID';end if;
 if length(btrim(coalesce(p_payload->>'description',''))) not between 1 and 2000 or length(coalesce(p_payload->>'completion_note',''))>2000
  or coalesce(p_payload->>'status','OPEN') not in ('OPEN','DONE') or (p_payload->>'status'='DONE' and length(btrim(coalesce(p_payload->>'completion_note','')))=0) then raise exception 'FORM_PLAN_INVALID';end if;
 select * into v_user from public.profiles where id=(p_payload->>'responsible_id')::uuid and active;
 if not found or not exists(select 1 from public.user_units where user_id=v_user.id and unit_name=r.unit) then raise exception 'FORM_USER_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('form_plan:'||p_response_id::text||p_field_id,0));
 select * into a from public.form_action_plans where response_id=p_response_id and field_id=p_field_id for update;
 if a.id is not null then
  if a.revision is distinct from p_expected_revision then raise exception 'FORM_VERSION_CONFLICT';end if;
  v_before:=to_jsonb(a);
  update public.form_action_plans set description=btrim(p_payload->>'description'),responsible_id=v_user.id,responsible_name=v_user.name,
   due_date=nullif(p_payload->>'due_date','')::date,status=coalesce(p_payload->>'status','OPEN'),completion_note=coalesce(p_payload->>'completion_note',''),revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=a.id returning * into a;
 else
  if coalesce(p_expected_revision,0)<>0 then raise exception 'FORM_VERSION_CONFLICT';end if;
  insert into public.form_action_plans(response_id,field_id,description,responsible_id,responsible_name,due_date,status,completion_note,created_by,updated_by)
  values(r.id,p_field_id,btrim(p_payload->>'description'),v_user.id,v_user.name,nullif(p_payload->>'due_date','')::date,coalesce(p_payload->>'status','OPEN'),coalesce(p_payload->>'completion_note',''),auth.uid(),auth.uid()) returning * into a;
 end if;
 insert into public.form_audit(form_id,response_id,action,actor_id,actor_name,details) select r.form_id,r.id,'SAVE_ACTION_PLAN',auth.uid(),name,jsonb_build_object('before',v_before,'after',to_jsonb(a)) from public.profiles where id=auth.uid();
 return a;
end;$$;

revoke all on function public.forms_validate_response(jsonb,jsonb,jsonb,boolean),public.forms_validate_evidence(uuid,jsonb),public.forms_evidence_access(text,boolean),public.forms_evaluation_people(uuid,text),public.start_form_response_evaluated(uuid,text,uuid,uuid[],uuid),public.save_form_evaluation_plan(uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.forms_evidence_access(text,boolean),public.forms_evaluation_people(uuid,text),public.start_form_response_evaluated(uuid,text,uuid,uuid[],uuid),public.save_form_evaluation_plan(uuid,text,integer,jsonb) to authenticated;
commit;
