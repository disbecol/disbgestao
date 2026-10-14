-- Checklists de saída/retorno da Puxada. Aplicar após 63_pull_invoice_kegs.sql.
begin;

alter table public.pull_trip_plans add column if not exists week_trip_type text
  check (week_trip_type in ('FIRST','ROUTINE','LAST'));
alter table public.pull_trips add column if not exists week_trip_type text
  check (week_trip_type in ('FIRST','ROUTINE','LAST'));

create table if not exists public.pull_checklist_questions (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(btrim(question)) between 5 and 300),
  critical boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_pull_checklist_questions_updated on public.pull_checklist_questions;
create trigger trg_pull_checklist_questions_updated before update on public.pull_checklist_questions
  for each row execute function public.touch_updated_at();

insert into public.pull_checklist_questions(question,critical,sort_order) values
('Habilitação do motorista está ok?',true,10),
('Documento do veículo está ok?',true,20),
('Certificado do cronotacógrafo está ok?',true,30),
('Tacógrafo está funcionando?',true,40),
('Nota fiscal e manifesto da carga estão no veículo?',false,50),
('Lanternas e luzes estão funcionando?',true,60),
('Buzina está ok?',true,70),
('Cintos de segurança estão ok?',true,80),
('Extintor está ok?',true,90),
('Triângulo está ok?',false,100),
('Pneus estão em condições de rodagem?',true,110),
('Nível de óleo do motor está ok?',false,120),
('Freios estão ok?',true,130),
('Veículo sem batidas ou arranhões?',false,140);

create table if not exists public.pull_checklist_runs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.pull_trips(id),
  checkpoint_code text not null,
  checklist_type text not null check (checklist_type in ('DEPARTURE','RETURN')),
  driver_no smallint not null check (driver_no in (1,2)),
  driver_id uuid not null references public.profiles(id),
  driver_name text not null,
  recorded_at timestamptz not null default now(),
  device_at timestamptz,
  latitude double precision,
  longitude double precision,
  gps_accuracy double precision,
  unique(trip_id,checkpoint_code)
);
create index if not exists pull_checklist_runs_trip on public.pull_checklist_runs(trip_id,recorded_at);
create table if not exists public.pull_checklist_answers (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.pull_checklist_runs(id),
  question_id uuid references public.pull_checklist_questions(id) on delete set null,
  question_snapshot text not null,
  critical_snapshot boolean not null,
  answer text not null check(answer in ('OK','NOK')),
  observation text not null default '',
  sort_order integer not null,
  unique(run_id,question_id),
  check(char_length(observation)<=1000 and (answer='OK' or char_length(btrim(observation))>=3))
);

-- O código e a etapa que libera cada checklist são fixos; o texto das perguntas é editável.
create or replace function public.pull_checklist_requirements(p_trip_id uuid)
returns table(checkpoint_code text,checklist_type text,driver_no smallint,after_action text,gate_action text,sort_order integer)
language sql stable security definer set search_path=public as $$
  select v.checkpoint_code,v.checklist_type,v.driver_no::smallint,v.after_action,v.gate_action,v.sort_order
  from public.pull_trips t
  cross join lateral (values
    ('D1_START','DEPARTURE',1,'START_TRIP','ARRIVE_SUPPORT_OUT',10,
      t.cycle_type='PULL' and t.week_trip_type='FIRST' and not t.solo_trip),
    ('D1_SUPPORT_OUT','RETURN',1,'ARRIVE_SUPPORT_OUT','DRIVER_SWAP_OUT',20,
      t.cycle_type='PULL' and t.week_trip_type is not null and not t.solo_trip),
    ('D2_SUPPORT_OUT','DEPARTURE',2,'DRIVER_SWAP_OUT','ARRIVE_FACTORY',30,
      t.cycle_type='PULL' and t.week_trip_type is not null and not t.solo_trip),
    ('D2_SUPPORT_RETURN','RETURN',2,'ARRIVE_SUPPORT_RETURN','DRIVER_SWAP_RETURN',40,
      t.cycle_type='PULL' and t.week_trip_type is not null and not t.solo_trip),
    ('D1_SUPPORT_RETURN','DEPARTURE',1,'DRIVER_SWAP_RETURN','ARRIVE_UNIT',50,
      t.cycle_type='PULL' and t.week_trip_type is not null and not t.solo_trip),
    ('D1_UNIT_LAST','RETURN',1,'DRIVER_SWAP_RETURN','ARRIVE_UNIT',60,
      t.cycle_type='PULL' and t.week_trip_type='LAST' and not t.solo_trip),
    ('SOLO_START','DEPARTURE',1,'START_TRIP','ARRIVE_FACTORY',10,
      t.cycle_type='PULL' and t.week_trip_type is not null and t.solo_trip),
    ('SOLO_UNIT_LAST','RETURN',1,'LEAVE_FACTORY','ARRIVE_UNIT',60,
      t.cycle_type='PULL' and t.week_trip_type='LAST' and t.solo_trip),
    ('TRANSFER_START','DEPARTURE',1,'TRANSFER_START','TRANSFER_ARRIVE_BRANCH',10,
      t.cycle_type='TRANSFER' and t.week_trip_type is not null),
    ('TRANSFER_END','RETURN',1,'TRANSFER_LEAVE_BRANCH','TRANSFER_ARRIVE_MATRIX',60,
      t.cycle_type='TRANSFER' and t.week_trip_type is not null)
  ) v(checkpoint_code,checklist_type,driver_no,after_action,gate_action,sort_order,required)
  where t.id=p_trip_id and v.required;
$$;
revoke all on function public.pull_checklist_requirements(uuid) from public,anon;
grant execute on function public.pull_checklist_requirements(uuid) to authenticated;

-- Antiga assinatura permanece apenas para uso interno da nova função.
revoke execute on function public.save_pull_trip_plan(uuid,text,text,text,text,uuid,uuid,boolean,timestamptz) from authenticated;
create or replace function public.save_pull_trip_plan(
  p_plan_id uuid,p_cycle_type text,p_origin_unit text,p_plate text,p_factory text,
  p_driver1 uuid,p_driver2 uuid,p_solo_trip boolean,p_scheduled_at timestamptz,p_week_trip_type text
) returns public.pull_trip_plans language plpgsql security definer set search_path=public as $$
declare v_plan public.pull_trip_plans%rowtype;
begin
  if p_week_trip_type not in ('FIRST','ROUTINE','LAST') or p_week_trip_type is null then
    raise exception 'TIPO_SEMANA_OBRIGATORIO';
  end if;
  v_plan:=public.save_pull_trip_plan(p_plan_id,p_cycle_type,p_origin_unit,p_plate,p_factory,
    p_driver1,p_driver2,p_solo_trip,p_scheduled_at);
  update public.pull_trip_plans set week_trip_type=p_week_trip_type where id=v_plan.id returning * into v_plan;
  return v_plan;
end;$$;
revoke all on function public.save_pull_trip_plan(uuid,text,text,text,text,uuid,uuid,boolean,timestamptz,text) from public,anon;
grant execute on function public.save_pull_trip_plan(uuid,text,text,text,text,uuid,uuid,boolean,timestamptz,text) to authenticated;

create or replace function public.start_planned_pull_trip(
  p_plan_id uuid,p_latitude double precision,p_longitude double precision,
  p_accuracy double precision,p_device_at timestamptz
) returns public.pull_trips language plpgsql security definer set search_path=public as $$
declare v_plan public.pull_trip_plans%rowtype; v_trip public.pull_trips%rowtype;
begin
  if not public.has_permission('PULL_TRIP') then raise exception 'FORBIDDEN'; end if;
  select * into v_plan from public.pull_trip_plans where id=p_plan_id for update;
  if v_plan.id is null or v_plan.status<>'PLANNED' then raise exception 'VIAGEM_INDISPONIVEL'; end if;
  if v_plan.driver1_id<>auth.uid() then raise exception 'APENAS_MOTORISTA_1_INICIA'; end if;
  if not public.user_has_unit(v_plan.origin_unit) then raise exception 'UNIDADE_SEM_ACESSO'; end if;
  if v_plan.cycle_type='TRANSFER' then
    v_trip:=public.start_transfer_trip(v_plan.plate,p_latitude,p_longitude,p_accuracy,p_device_at);
  else
    v_trip:=public.start_pull_trip(v_plan.origin_unit,v_plan.plate,v_plan.factory,v_plan.carrier,
      v_plan.driver2_id,p_latitude,p_longitude,p_accuracy,p_device_at);
  end if;
  update public.pull_trips set appointment_at=v_plan.scheduled_at,week_trip_type=v_plan.week_trip_type
    where id=v_trip.id returning * into v_trip;
  update public.pull_trip_plans set status='STARTED',trip_id=v_trip.id,updated_by=auth.uid(),updated_at=now()
    where id=v_plan.id;
  return v_trip;
end;$$;

create or replace function public.submit_pull_checklist(
  p_trip_id uuid,p_checkpoint_code text,p_answers jsonb,p_latitude double precision,
  p_longitude double precision,p_accuracy double precision,p_device_at timestamptz
) returns public.pull_checklist_runs language plpgsql security definer set search_path=public as $$
declare v_trip public.pull_trips%rowtype; v_profile public.profiles%rowtype;
  v_req record; v_run public.pull_checklist_runs%rowtype; v_question public.pull_checklist_questions%rowtype;
  v_answer jsonb; v_count integer; v_last text;
begin
  if not public.has_permission('PULL_TRIP') then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_trip from public.pull_trips where id=p_trip_id for update;
  if v_trip.id is null or v_trip.status<>'IN_PROGRESS' then raise exception 'CICLO_NAO_ESTA_EM_ANDAMENTO'; end if;
  if not public.user_has_unit(v_trip.origin_unit) then raise exception 'UNIDADE_SEM_ACESSO'; end if;
  select * into v_req from public.pull_checklist_requirements(p_trip_id)
    where checkpoint_code=p_checkpoint_code;
  if not found then raise exception 'CHECKLIST_NAO_PREVISTO'; end if;
  if auth.uid()<>(case when v_req.driver_no=1 then v_trip.driver1_id else v_trip.driver2_id end) then
    raise exception 'CHECKLIST_MOTORISTA_INCORRETO'; end if;
  select action_code into v_last from public.pull_events where trip_id=p_trip_id
    order by step_order desc limit 1;
  if v_last<>v_req.after_action then raise exception 'CHECKLIST_FORA_DA_ETAPA'; end if;
  select * into v_run from public.pull_checklist_runs where trip_id=p_trip_id
    and checkpoint_code=p_checkpoint_code;
  if v_run.id is not null then return v_run; end if;
  if p_answers is null or jsonb_typeof(p_answers)<>'array' then raise exception 'CHECKLIST_RESPOSTAS_INVALIDAS'; end if;
  select count(*) into v_count from public.pull_checklist_questions where active;
  if v_count=0 or jsonb_array_length(p_answers)<>v_count then raise exception 'CHECKLIST_INCOMPLETO'; end if;
  if (p_latitude is null)<>(p_longitude is null)
    or (p_latitude is not null and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180)) then
    raise exception 'GPS_INVALIDO'; end if;
  if p_accuracy is not null and p_accuracy<0 then raise exception 'GPS_INVALIDO'; end if;
  insert into public.pull_checklist_runs(trip_id,checkpoint_code,checklist_type,driver_no,
    driver_id,driver_name,device_at,latitude,longitude,gps_accuracy)
  values(p_trip_id,p_checkpoint_code,v_req.checklist_type,v_req.driver_no,
    v_profile.id,v_profile.name,p_device_at,p_latitude,p_longitude,p_accuracy)
  returning * into v_run;
  for v_answer in select value from jsonb_array_elements(p_answers) loop
    select * into v_question from public.pull_checklist_questions
      where id=(v_answer->>'question_id')::uuid and active;
    if not found then raise exception 'CHECKLIST_PERGUNTA_INVALIDA'; end if;
    if v_answer->>'answer' not in ('OK','NOK') then raise exception 'CHECKLIST_RESPOSTA_OBRIGATORIA'; end if;
    if v_answer->>'answer'='NOK' and char_length(btrim(coalesce(v_answer->>'observation',''))) < 3 then
      raise exception 'CHECKLIST_OBSERVACAO_OBRIGATORIA'; end if;
    insert into public.pull_checklist_answers(run_id,question_id,question_snapshot,critical_snapshot,
      answer,observation,sort_order)
    values(v_run.id,v_question.id,v_question.question,v_question.critical,
      v_answer->>'answer',case when v_answer->>'answer'='NOK' then btrim(v_answer->>'observation') else '' end,
      v_question.sort_order);
  end loop;
  return v_run;
end;$$;
revoke all on function public.submit_pull_checklist(uuid,text,jsonb,double precision,double precision,double precision,timestamptz) from public,anon;
grant execute on function public.submit_pull_checklist(uuid,text,jsonb,double precision,double precision,double precision,timestamptz) to authenticated;

-- Bloqueio no banco, inclusive para etapas enviadas pela fila offline ou RPCs antigos.
create or replace function public.guard_pull_checklist_step()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_required text;
begin
  select r.checkpoint_code into v_required
  from public.pull_checklist_requirements(new.trip_id) r
  where r.gate_action=new.action_code
    and not exists(select 1 from public.pull_checklist_runs c
      where c.trip_id=new.trip_id and c.checkpoint_code=r.checkpoint_code)
  order by r.sort_order limit 1;
  if v_required is not null then raise exception 'CHECKLIST_PENDENTE:%',v_required; end if;
  return new;
end;$$;
drop trigger if exists trg_guard_pull_checklist_step on public.pull_events;
create trigger trg_guard_pull_checklist_step before insert on public.pull_events
  for each row execute function public.guard_pull_checklist_step();

alter table public.pull_checklist_questions enable row level security;
alter table public.pull_checklist_runs enable row level security;
alter table public.pull_checklist_answers enable row level security;
create policy pull_checklist_questions_read on public.pull_checklist_questions for select to authenticated
  using(public.has_permission('PULL_TRIP') or public.has_permission('PULL_CONFIG') or public.has_permission('PULL_HISTORY'));
create policy pull_checklist_questions_config on public.pull_checklist_questions for all to authenticated
  using(public.has_permission('PULL_CONFIG')) with check(public.has_permission('PULL_CONFIG'));
create policy pull_checklist_runs_read on public.pull_checklist_runs for select to authenticated
  using(exists(select 1 from public.pull_trips t where t.id=trip_id and public.user_has_unit(t.origin_unit)
    and (auth.uid() in (t.driver1_id,t.driver2_id) or public.has_permission('PULL_HISTORY'))));
create policy pull_checklist_answers_read on public.pull_checklist_answers for select to authenticated
  using(exists(select 1 from public.pull_checklist_runs r join public.pull_trips t on t.id=r.trip_id
    where r.id=run_id and public.user_has_unit(t.origin_unit)
      and (auth.uid() in (t.driver1_id,t.driver2_id) or public.has_permission('PULL_HISTORY'))));
grant select,insert,update on public.pull_checklist_questions to authenticated;
grant select on public.pull_checklist_runs,public.pull_checklist_answers to authenticated;
commit;
