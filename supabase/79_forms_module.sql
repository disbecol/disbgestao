-- Formulários internos: modelos, aplicações, agendamentos e planos de ação.
-- Nenhum acesso público. Aplicar após a migração 78.
begin;

insert into public.permissions(code,module,name,description,sort_order,active) values
 ('FORMS_FILL','Formulários','Preencher formulários','Preencher somente os formulários e unidades autorizados no modelo.',10,true),
 ('FORMS_REPORT','Formulários','Acompanhamento','Consultar relatórios e planos somente dos formulários autorizados.',20,true),
 ('FORMS_MANAGE','Formulários','Criar e gerenciar formulários','Criar modelos, definir acessos e agendar aplicações nas unidades autorizadas.',30,true)
on conflict(code) do update set module=excluded.module,name=excluded.name,description=excluded.description,sort_order=excluded.sort_order,active=true;
insert into public.role_permissions(role,permission_code)
select r.role,p.code from unnest(array['ADMIN','COLABORADOR_ARMAZEM','CONFERENTE','COLABORADOR_ENTREGA','MOTORISTA_PUXADOR','VENDEDOR','GERENTE_VENDAS']) r(role)
cross join (values('FORMS_FILL'),('FORMS_REPORT')) p(code) on conflict do nothing;
insert into public.role_permissions(role,permission_code) values('ADMIN','FORMS_MANAGE') on conflict do nothing;
alter table public.module_settings drop constraint if exists module_settings_name_valid;
alter table public.module_settings add constraint module_settings_name_valid check(module_name in
 ('NRI','Conferência','Contagem FEFO','Ativo de Giro','Materiais','Refugo','Avarias de Entrega','Avarias de Vendas','Validade do Estoque','Escalonada Digital','Puxada','Formulários'));
insert into public.module_settings(module_name,active) values('Formulários',true) on conflict do nothing;

create table if not exists public.form_definitions (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(btrim(name)) between 1 and 200),
 description text not null default '' check(length(description)<=350),
 area text not null check(length(btrim(area)) between 1 and 100),
 form_type text not null default 'CHECKLIST' check(form_type in ('CHECKLIST','AUDIT','SURVEY','OTHER')),
 units text[] not null check(cardinality(units)>0),
 apply_everyone boolean not null default false,
 apply_roles text[] not null default '{}',apply_user_ids uuid[] not null default '{}',
 report_roles text[] not null default '{}',report_user_ids uuid[] not null default '{}',
 status text not null default 'DRAFT' check(status in ('DRAFT','PUBLISHED','ARCHIVED')),
 schema jsonb not null,version integer not null default 1 check(version>0),
 created_by uuid not null references public.profiles(id),created_by_name text not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create sequence if not exists public.form_response_number_seq;
create table if not exists public.form_responses (
 id uuid primary key default gen_random_uuid(),
 code text not null unique default ('FORM-'||lpad(nextval('public.form_response_number_seq')::text,7,'0')),
 form_id uuid not null references public.form_definitions(id) on delete restrict,
 form_name text not null,form_area text not null,form_version integer not null,
 schema_snapshot jsonb not null,
 unit text not null references public.units(name) on update cascade on delete restrict,
 respondent_id uuid not null references public.profiles(id),respondent_name text not null,respondent_role text not null,
 answers jsonb not null default '{}',status text not null default 'DRAFT' check(status in ('DRAFT','COMPLETED','CANCELLED')),
 revision integer not null default 1,started_at timestamptz not null default now(),
 completed_at timestamptz,updated_at timestamptz not null default now(),
 ok_count integer not null default 0,nok_count integer not null default 0,na_count integer not null default 0,
 score numeric(5,2),assignment_id uuid
);
create index if not exists form_responses_unit_date on public.form_responses(unit,started_at desc);
create index if not exists form_responses_form_date on public.form_responses(form_id,completed_at desc);
create index if not exists form_responses_owner on public.form_responses(respondent_id,status);
create unique index if not exists form_one_open_response on public.form_responses
 (form_id,unit,respondent_id,(coalesce(assignment_id,'00000000-0000-0000-0000-000000000000'::uuid))) where status='DRAFT';
create table if not exists public.form_assignments (
 id uuid primary key default gen_random_uuid(),form_id uuid not null references public.form_definitions(id) on delete restrict,
 unit text not null references public.units(name) on update cascade on delete restrict,
 user_id uuid not null references public.profiles(id),user_name text not null,
 due_date date not null,status text not null default 'PENDING' check(status in ('PENDING','COMPLETED','CANCELLED')),
 response_id uuid unique references public.form_responses(id) on delete restrict,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),unique(form_id,unit,user_id,due_date)
);
alter table public.form_responses drop constraint if exists form_responses_assignment_fk;
alter table public.form_responses add constraint form_responses_assignment_fk foreign key(assignment_id) references public.form_assignments(id) on delete restrict;
create index if not exists form_assignments_unit_date on public.form_assignments(unit,due_date);
create table if not exists public.form_action_plans (
 id uuid primary key default gen_random_uuid(),response_id uuid not null references public.form_responses(id) on delete restrict,
 field_id text not null,description text not null check(length(btrim(description)) between 1 and 2000),
 responsible_id uuid not null references public.profiles(id),responsible_name text not null,due_date date,
 status text not null default 'OPEN' check(status in ('OPEN','DONE')),
 completion_note text not null default '' check(length(completion_note)<=2000),revision integer not null default 1,
 created_by uuid not null references public.profiles(id),updated_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(response_id,field_id)
);
create table if not exists public.form_audit (
 id bigint generated always as identity primary key,form_id uuid references public.form_definitions(id),
 response_id uuid references public.form_responses(id),action text not null,
 actor_id uuid not null references public.profiles(id),actor_name text not null,
 details jsonb not null default '{}',created_at timestamptz not null default now()
);

create or replace function public.forms_enabled() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and active)
 and coalesce((select active from public.module_settings where module_name='Formulários'),false);
$$;
-- Helper interno: não é exposto a authenticated; evita consultar acesso de terceiros.
create or replace function public.forms_subject_allowed(p_form_id uuid,p_user_id uuid,p_action text,p_unit text default null)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare f public.form_definitions%rowtype;p public.profiles%rowtype;v_code text;v_perm boolean;
begin
 select * into f from public.form_definitions where id=p_form_id;
 if not found then return false;end if;
 select * into p from public.profiles where id=p_user_id and active;
 if not found then return false;end if;
 if p_unit is not null and not(p_unit=any(f.units)) then return false;end if;
 if not exists(select 1 from public.user_units uu join public.units u on u.name=uu.unit_name and u.active
   where uu.user_id=p.id and uu.unit_name=any(f.units) and (p_unit is null or uu.unit_name=p_unit)) then return false;end if;
 v_code:=case p_action when 'MANAGE' then 'FORMS_MANAGE' when 'REPORT' then 'FORMS_REPORT' else 'FORMS_FILL' end;
 select coalesce(case when p.role='ADMIN' then true when up.allowed is not null then up.allowed
   else exists(select 1 from public.role_permissions rp where rp.role=p.role and rp.permission_code=v_code) end,false)
 into v_perm from public.permissions pm left join public.user_permissions up on up.user_id=p.id and up.permission_code=pm.code
 where pm.code=v_code and pm.active;
 if not coalesce(v_perm,false) then return false;end if;
 if p_action='MANAGE' then
   return not exists(select 1 from unnest(f.units) x(unit) where not exists
    (select 1 from public.user_units uu join public.units u on u.name=uu.unit_name and u.active where uu.user_id=p.id and uu.unit_name=x.unit));
 elsif p_action='FILL' then
   return f.status='PUBLISHED' and (p.role='ADMIN' or f.apply_everyone or p.role=any(f.apply_roles) or p.id=any(f.apply_user_ids));
 elsif p_action='REPORT' then
   return p.role='ADMIN' or p.role=any(f.report_roles) or p.id=any(f.report_user_ids)
     or public.forms_subject_allowed(f.id,p.id,'MANAGE',p_unit);
 end if;
 return false;
end;$$;
revoke all on function public.forms_subject_allowed(uuid,uuid,text,text) from public,anon,authenticated;
create or replace function public.forms_can_access(p_form_id uuid,p_action text,p_unit text default null) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select public.forms_enabled() and public.forms_subject_allowed(p_form_id,auth.uid(),p_action,p_unit);
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
    or coalesce(f->>'type','') not in ('BOOLEAN','TEXT','LONG_TEXT','NUMBER','DATE','SINGLE_CHOICE','MULTIPLE_CHOICE')
    then raise exception 'FORM_FIELD_INVALID';end if;
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
declare s jsonb;f jsonb;a jsonb;v jsonb;v_text text;note text;plan text;out_answers jsonb:='{}';notes jsonb:='{}';ok integer:=0;nok integer:=0;na integer:=0;is_negative boolean;
begin
 if jsonb_typeof(p_answers) is distinct from 'object' or pg_column_size(p_answers)>1500000 then raise exception 'FORM_ANSWERS_INVALID';end if;
 for s in select value from jsonb_array_elements(p_schema->'sections') loop
  note:=coalesce(p_answers->'__sections'->>(s->>'id'),'');
  if length(note)>2000 then raise exception 'FORM_NOTE_TOO_LONG';end if;
  if note<>'' then notes:=notes||jsonb_build_object(s->>'id',note);end if;
  for f in select value from jsonb_array_elements(s->'fields') loop
   a:=p_answers->(f->>'id');v:=a->'value';v_text:=v#>>'{}';note:=btrim(coalesce(a->>'observation',''));plan:=btrim(coalesce(a->>'plan',''));
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
   out_answers:=out_answers||jsonb_build_object(f->>'id',jsonb_build_object('value',v,'observation',note,'plan',case when is_negative then plan else '' end));
  end loop;
 end loop;
 out_answers:=out_answers||jsonb_build_object('__sections',notes);
 return jsonb_build_object('answers',out_answers,'ok',ok,'nok',nok,'na',na,'score',case when ok+nok>0 then round(ok::numeric/(ok+nok)*100,2) else null end);
end;$$;

create or replace function public.start_form_response(p_form_id uuid,p_unit text,p_id uuid,p_assignment_id uuid default null) returns public.form_responses
language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.form_definitions%rowtype;r public.form_responses%rowtype;p public.profiles%rowtype;a public.form_assignments%rowtype;
begin
 if not public.forms_can_access(p_form_id,'FILL',p_unit) then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('form:'||auth.uid()::text||p_form_id::text||p_unit||coalesce(p_assignment_id::text,''),0));
 select * into r from public.form_responses where id=p_id;
 if found then
  if r.respondent_id<>auth.uid() or r.form_id<>p_form_id or r.unit<>p_unit or r.assignment_id is distinct from p_assignment_id then raise exception 'FORBIDDEN';end if;
  return r;
 end if;
 if p_assignment_id is not null then
  select * into a from public.form_assignments where id=p_assignment_id for update;
  if not found or a.user_id<>auth.uid() or a.form_id<>p_form_id or a.unit<>p_unit or a.status='CANCELLED' then raise exception 'FORM_ASSIGNMENT_INVALID';end if;
  if a.status='COMPLETED' then select * into r from public.form_responses where id=a.response_id;return r;end if;
 end if;
 select * into r from public.form_responses where form_id=p_form_id and unit=p_unit and respondent_id=auth.uid() and status='DRAFT' and assignment_id is not distinct from p_assignment_id;
 if found then return r;end if;
 select * into f from public.form_definitions where id=p_form_id for share;
 select * into p from public.profiles where id=auth.uid() and active;
 insert into public.form_responses(id,form_id,form_name,form_area,form_version,schema_snapshot,unit,respondent_id,respondent_name,respondent_role,assignment_id)
 values(p_id,f.id,f.name,f.area,f.version,f.schema,p_unit,p.id,p.name,p.role,p_assignment_id) returning * into r;
 return r;
end;$$;

create or replace function public.save_form_response(p_id uuid,p_expected_revision integer,p_answers jsonb,p_finalize boolean default false) returns public.form_responses
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.form_responses%rowtype;v jsonb;s jsonb;f jsonb;plan text;
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
 v:=public.forms_validate_answers(r.schema_snapshot,p_answers,p_finalize);
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
  insert into public.form_audit(form_id,response_id,action,actor_id,actor_name,details)
   values(r.form_id,r.id,'COMPLETE_RESPONSE',auth.uid(),r.respondent_name,jsonb_build_object('score',r.score,'version',r.form_version));
 end if;
 return r;
end;$$;

create or replace function public.cancel_form_response(p_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.form_responses%rowtype;
begin
 select * into r from public.form_responses where id=p_id for update;
 if not public.forms_enabled() or r.id is null or r.respondent_id<>auth.uid() or not public.user_has_unit(r.unit) or not public.has_permission('FORMS_FILL') then raise exception 'FORBIDDEN';end if;
 if r.status<>'DRAFT' then raise exception 'FORM_RESPONSE_CLOSED';end if;
 update public.form_responses set status='CANCELLED',revision=revision+1,updated_at=now() where id=p_id;
 insert into public.form_audit(form_id,response_id,action,actor_id,actor_name) values(r.form_id,r.id,'CANCEL_DRAFT',auth.uid(),r.respondent_name);
end;$$;

create or replace function public.create_form_schedule(p_form_id uuid,p_unit text,p_users uuid[],p_start date,p_end date,p_repeat text,p_weekdays integer[] default '{}') returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_date date;v_user uuid;v_total integer:=0;v_added integer;v_name text;
begin
 if not public.forms_can_access(p_form_id,'MANAGE',p_unit) then raise exception 'FORBIDDEN';end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>365 or coalesce(cardinality(p_users),0) not between 1 and 100
   or p_repeat is null or p_repeat not in ('ONCE','DAILY','WEEKLY','MONTHLY') then raise exception 'FORM_SCHEDULE_INVALID';end if;
 if p_repeat='WEEKLY' and (coalesce(cardinality(p_weekdays),0)=0 or exists(select 1 from unnest(p_weekdays) d where d<0 or d>6)) then raise exception 'FORM_WEEKDAYS_REQUIRED';end if;
 if exists(select 1 from unnest(p_users) u where not public.forms_subject_allowed(p_form_id,u,'FILL',p_unit)) then raise exception 'FORM_SCHEDULE_USER_FORBIDDEN';end if;
 for v_date in select generate_series(p_start,p_end,interval '1 day')::date loop
  if (p_repeat='ONCE' and v_date<>p_start) or (p_repeat='WEEKLY' and not(extract(dow from v_date)::integer=any(p_weekdays)))
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
create or replace function public.cancel_form_assignment(p_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.form_assignments%rowtype;
begin
 select * into a from public.form_assignments where id=p_id for update;
 if a.id is null or not public.forms_can_access(a.form_id,'MANAGE',a.unit) then raise exception 'FORBIDDEN';end if;
 if a.status<>'PENDING' then raise exception 'FORM_ASSIGNMENT_CLOSED';end if;
 update public.form_assignments set status='CANCELLED',updated_at=now() where id=p_id;
 insert into public.form_audit(form_id,action,actor_id,actor_name,details) select a.form_id,'CANCEL_ASSIGNMENT',auth.uid(),name,jsonb_build_object('assignment_id',a.id) from public.profiles where id=auth.uid();
end;$$;

create or replace function public.save_form_action_plan(p_response_id uuid,p_field_id text,p_expected_revision integer,p_payload jsonb) returns public.form_action_plans
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.form_responses%rowtype;a public.form_action_plans%rowtype;f jsonb;v_user public.profiles%rowtype;v_before jsonb;
begin
 select * into r from public.form_responses where id=p_response_id for share;
 if r.id is null or r.status<>'COMPLETED' or not public.user_has_unit(r.unit) or not public.forms_enabled()
  or not(public.forms_can_access(r.form_id,'REPORT',r.unit) or (r.respondent_id=auth.uid() and public.has_permission('FORMS_FILL'))) then raise exception 'FORBIDDEN';end if;
 select q.value into f from jsonb_array_elements(r.schema_snapshot->'sections') s cross join lateral jsonb_array_elements(s->'fields') q where q.value->>'id'=p_field_id;
 if f is null or not coalesce((f->>'scored')::boolean,false) or r.answers->p_field_id->>'value' is null
  or r.answers->p_field_id->>'value'=f->>'expected' or (f->>'type'='BOOLEAN' and r.answers->p_field_id->>'value'='NA') then raise exception 'FORM_ISSUE_INVALID';end if;
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

-- Lista mínima de colaboradores: somente quem compartilha uma unidade acessível.
create or replace function public.forms_people() returns table(id uuid,name text,role text,units text[])
language sql stable security definer set search_path=public,pg_temp as $$
 select p.id,p.name,p.role,array_agg(uu.unit_name order by uu.unit_name) from public.profiles p
 join public.user_units uu on uu.user_id=p.id
 where p.active and public.forms_enabled() and public.user_has_unit(uu.unit_name)
  and (public.has_permission('FORMS_MANAGE') or public.has_permission('FORMS_REPORT'))
 group by p.id,p.name,p.role order by p.name;
$$;

alter table public.form_definitions enable row level security;
alter table public.form_responses enable row level security;
alter table public.form_assignments enable row level security;
alter table public.form_action_plans enable row level security;
alter table public.form_audit enable row level security;
drop policy if exists forms_definition_read on public.form_definitions;
create policy forms_definition_read on public.form_definitions for select to authenticated using
 (public.forms_can_access(id,'MANAGE') or public.forms_can_access(id,'FILL') or public.forms_can_access(id,'REPORT'));
drop policy if exists forms_response_read on public.form_responses;
create policy forms_response_read on public.form_responses for select to authenticated using
 (public.forms_enabled() and public.user_has_unit(unit) and ((respondent_id=auth.uid() and public.has_permission('FORMS_FILL')) or public.forms_can_access(form_id,'REPORT',unit)));
drop policy if exists forms_assignment_read on public.form_assignments;
create policy forms_assignment_read on public.form_assignments for select to authenticated using
 (public.forms_enabled() and public.user_has_unit(unit) and ((user_id=auth.uid() and public.has_permission('FORMS_FILL')) or public.forms_can_access(form_id,'REPORT',unit) or public.forms_can_access(form_id,'MANAGE',unit)));
drop policy if exists forms_plan_read on public.form_action_plans;
create policy forms_plan_read on public.form_action_plans for select to authenticated using
 (exists(select 1 from public.form_responses r where r.id=response_id));
drop policy if exists forms_audit_read on public.form_audit;
create policy forms_audit_read on public.form_audit for select to authenticated using(public.forms_can_access(form_id,'MANAGE'));
revoke all on public.form_definitions,public.form_responses,public.form_assignments,public.form_action_plans,public.form_audit from anon,authenticated;
grant select on public.form_definitions,public.form_responses,public.form_assignments,public.form_action_plans,public.form_audit to authenticated;

revoke all on function public.forms_enabled(),public.forms_can_access(uuid,text,text),public.forms_validate_schema(jsonb),public.forms_validate_answers(jsonb,jsonb,boolean),
 public.save_form_definition(uuid,integer,jsonb),public.start_form_response(uuid,text,uuid,uuid),public.save_form_response(uuid,integer,jsonb,boolean),public.cancel_form_response(uuid),
 public.create_form_schedule(uuid,text,uuid[],date,date,text,integer[]),public.cancel_form_assignment(uuid),public.save_form_action_plan(uuid,text,integer,jsonb),public.forms_people() from public,anon,authenticated;
grant execute on function public.forms_enabled(),public.forms_can_access(uuid,text,text),public.save_form_definition(uuid,integer,jsonb),
 public.start_form_response(uuid,text,uuid,uuid),public.save_form_response(uuid,integer,jsonb,boolean),public.cancel_form_response(uuid),
 public.create_form_schedule(uuid,text,uuid[],date,date,text,integer[]),public.cancel_form_assignment(uuid),public.save_form_action_plan(uuid,text,integer,jsonb),public.forms_people() to authenticated;
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
 and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='form_definitions') then
  alter publication supabase_realtime add table public.form_definitions;
 end if;
end;$$;
commit;
