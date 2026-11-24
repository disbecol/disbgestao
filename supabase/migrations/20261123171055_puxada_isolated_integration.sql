-- Puxada integrada: interface isolada, sessão compartilhada e comandos duráveis.
-- As tabelas operacionais e seus IDs continuam sendo a fonte dos registros/NRI.
begin;
alter table public.pull_trips alter column start_latitude drop not null;
alter table public.pull_trips alter column start_longitude drop not null;
alter table public.pull_events alter column latitude drop not null;
alter table public.pull_events alter column longitude drop not null;
alter table public.pull_occurrences alter column start_latitude drop not null;
alter table public.pull_occurrences alter column start_longitude drop not null;
alter table public.pull_events add column if not exists app_received_at timestamptz;
alter table public.pull_events add column if not exists app_location_status text;
alter table public.pull_events add column if not exists app_location jsonb;
alter table public.pull_occurrences add column if not exists app_start_location jsonb;
alter table public.pull_occurrences add column if not exists app_end_location jsonb;
alter table public.pull_checklist_runs add column if not exists app_received_at timestamptz;

create table public.pull_app_runtime(
 trip_id uuid primary key references public.pull_trips(id) on delete cascade,
 revision bigint not null default 1, workflow_version integer not null,
 steps jsonb not null, questions jsonb not null, requirements jsonb not null,
 checklist_required boolean not null, created_at timestamptz not null default now()
);
create table public.pull_app_plan_runtime(
 plan_id uuid primary key references public.pull_trip_plans(id) on delete cascade,
 checklist_required boolean not null, questions jsonb not null, created_at timestamptz not null default now()
);
create table public.pull_app_receipts(
 command_id uuid primary key, actor_id uuid not null references public.profiles(id),
 trip_id uuid not null references public.pull_trips(id) on delete cascade,
 payload jsonb not null, event_id uuid, committed_at timestamptz not null default now()
);
create table public.pull_app_location_audit(
 id uuid primary key default gen_random_uuid(),trip_id uuid not null references public.pull_trips(id) on delete cascade,
 event_id uuid not null references public.pull_events(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),actor_name text not null,
 original_location jsonb,new_location jsonb not null,reason text not null,
 corrected_at timestamptz not null default now()
);
create table public.pull_app_media(
 client_id uuid primary key,trip_id uuid not null references public.pull_trips(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),kind text not null check(kind in ('attachment','invoice')),
 record_id uuid not null,object_path text not null,sha256 text not null,size_bytes bigint not null check(size_bytes>0),
 created_at timestamptz not null default now()
);
create index pull_app_receipts_trip_idx on public.pull_app_receipts(trip_id);
create index pull_app_location_event_idx on public.pull_app_location_audit(event_id,corrected_at);
create index pull_app_media_trip_idx on public.pull_app_media(trip_id,kind);
do $$declare n text;begin
 foreach n in array array['pull_app_runtime','pull_app_plan_runtime','pull_app_receipts','pull_app_location_audit','pull_app_media'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on public.%I from public,anon,authenticated',n);
 end loop;
end;$$;
create function public.pull_app_validate_location(p_body jsonb) returns void language plpgsql set search_path=public as $$
declare l jsonb:=p_body->'location';begin
 if l is null or l='null'::jsonb then
  if coalesce(p_body->>'locationStatus','Unavailable') not in('TimedOut','Denied','Unavailable') then perform public.pull_app_error('INVALID_LOCATION','Informe a situação da captura da localização.');end if;return;
 end if;
 if jsonb_typeof(l)<>'object' or l->>'latitude' is null or l->>'longitude' is null
  or not ((l->>'latitude')::float8 between -90 and 90) or not ((l->>'longitude')::float8 between -180 and 180)
  or coalesce((l->>'accuracy')::float8,0)<0 or coalesce(l->>'source','GPS')<>'GPS'
  or coalesce(p_body->>'locationStatus','Captured')<>'Captured' then
  perform public.pull_app_error('INVALID_LOCATION','Coordenadas da captura inválidas.');end if;
end;$$;

create function public.pull_app_error(p_code text,p_detail text,p_status integer default 422)
returns void language plpgsql set search_path=public as $$begin
 raise exception using message='PULL_APP_ERROR',detail=jsonb_build_object('code',p_code,'detail',p_detail,'status',p_status)::text;
end;$$;
create function public.pull_app_guard(p_permission text default null)
returns public.profiles language plpgsql stable security definer set search_path=public as $$
declare p public.profiles%rowtype;begin
 select * into p from public.profiles where id=auth.uid() and active;
 if p.id is null then perform public.pull_app_error('UNAUTHORIZED','Sua sessão expirou. Entre novamente no Disb Gestão.',401);end if;
 if not exists(select 1 from public.module_settings where module_name='Puxada' and active) then
  perform public.pull_app_error('MODULE_DISABLED','A Puxada está desativada nas configurações.',403);end if;
 if p_permission is not null and not public.has_permission(p_permission) then
  perform public.pull_app_error('FORBIDDEN','Seu usuário não possui permissão para esta ação.',403);end if;
 if not (public.has_permission('PULL_TRIP') or public.has_permission('PULL_PLAN') or public.has_permission('PULL_FAROL')
  or public.has_permission('PULL_HISTORY') or public.has_permission('PULL_DASHBOARD') or public.has_permission('PULL_CONFIG') or public.has_permission('PULL_GOALS')) then
  perform public.pull_app_error('FORBIDDEN','Seu usuário não possui acesso à Puxada.',403);end if;
 return p;
end;$$;
create function public.pull_app_trip_guard(p_id uuid,p_operational boolean default false)
returns public.pull_trips language plpgsql stable security definer set search_path=public as $$
declare t public.pull_trips%rowtype;p public.profiles%rowtype;begin
 p:=public.pull_app_guard(case when p_operational then 'PULL_TRIP' else null end);
 select * into t from public.pull_trips where id=p_id;
 if t.id is null then perform public.pull_app_error('NOT_FOUND','Viagem não encontrada.',404);end if;
 perform public.assert_user_unit(t.origin_unit);
 if p_operational then
  if auth.uid() not in(t.driver1_id,t.driver2_id) then perform public.pull_app_error('FORBIDDEN','Esta viagem está atribuída a outro motorista.',403);end if;
 elsif p.role='MOTORISTA_PUXADOR' then
  if auth.uid() not in(t.driver1_id,t.driver2_id) then perform public.pull_app_error('FORBIDDEN','Você não tem acesso a esta viagem.',403);end if;
 elsif not (public.has_permission('PULL_FAROL') or public.has_permission('PULL_HISTORY') or public.has_permission('PULL_DASHBOARD') or public.has_permission('PULL_TMA_ADJUST') or auth.uid() in(t.driver1_id,t.driver2_id)) then
  perform public.pull_app_error('FORBIDDEN','Você não tem acesso a esta viagem.',403);end if;
 return t;
end;$$;
create function public.pull_app_location(p_lat double precision,p_lon double precision,p_accuracy double precision,p_at timestamptz,p_source text default 'GPS')
returns jsonb language sql immutable set search_path=public as $$
 select case when p_lat is null or p_lon is null then null else jsonb_build_object('latitude',p_lat,'longitude',p_lon,'accuracy',p_accuracy,'capturedAt',p_at,'source',p_source) end
$$;
create function public.pull_app_freeze(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare t public.pull_trips%rowtype;s jsonb;q jsonb;r jsonb;required boolean;begin
 if exists(select 1 from public.pull_app_runtime where trip_id=p_id) then return;end if;
 select * into strict t from public.pull_trips where id=p_id;
 select coalesce(jsonb_agg(jsonb_build_object('key',action_code,'label',name,'order',sort_order,'executor',case when t.solo_trip then 1 else coalesce(executor_driver,1) end,'legacyId',id) order by sort_order),'[]') into s
 from public.pull_steps where step_type='MAIN' and active and flow_type in(t.cycle_type,'BOTH') and (not t.solo_trip or not coalesce(skip_when_solo,false));
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'text',question,'critical',critical,'active',true,'order',sort_order) order by sort_order),'[]') into q from public.pull_checklist_questions where active;
 required:=coalesce((select checklist_enabled from public.pull_settings where singleton),false) and t.week_trip_type is not null;
 select coalesce(jsonb_agg(jsonb_build_object('checkpoint',checkpoint_code,'label',replace(checkpoint_code,'_',' '),'type',checklist_type,'driverNo',driver_no,'afterAction',after_action,'gateStage',gate_action,'order',sort_order) order by sort_order),'[]') into r
 from public.pull_checklist_requirements(t.id)
 where t.checklist_flow_version<3 or checkpoint_code not in('D1_START','SOLO_START','TRANSFER_START');
 insert into public.pull_app_runtime(trip_id,workflow_version,steps,questions,requirements,checklist_required)
 values(t.id,t.checklist_flow_version,s,q,case when required then r else '[]' end,required) on conflict do nothing;
end;$$;
-- Congela somente metadados: não altera horários nem registros anteriores.
select public.pull_app_freeze(id) from public.pull_trips;
insert into public.pull_app_plan_runtime(plan_id,checklist_required,questions)
 select id,coalesce((select checklist_enabled from public.pull_settings where singleton),false) and week_trip_type is not null,
 coalesce((select jsonb_agg(jsonb_build_object('id',id,'text',question,'critical',critical,'active',true,'order',sort_order) order by sort_order) from public.pull_checklist_questions where active),'[]')
 from public.pull_trip_plans;

create function public.pull_app_revision() returns trigger language plpgsql security definer set search_path=public as $$
declare tid uuid;begin
 if tg_table_name='pull_trips' then tid:=coalesce(new.id,old.id);else tid:=coalesce(new.trip_id,old.trip_id);end if;
 if tg_op='INSERT' and tg_table_name='pull_trips' then perform public.pull_app_freeze(tid);
 else update public.pull_app_runtime set revision=revision+1 where trip_id=tid;end if;
 return coalesce(new,old);
end;$$;
do $$declare n text;begin
 foreach n in array array['pull_trips','pull_events','pull_occurrences','pull_checklist_runs','pull_trip_attachments','pull_trip_invoices'] loop
  execute format('create trigger pull_app_revision after insert or update or delete on public.%I for each row execute function public.pull_app_revision()',n);
 end loop;
end;$$;
-- Todas as versões do aplicativo passam pela mesma exclusão de placa/motoristas.
create function public.pull_app_start_lock() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='IN_PROGRESS' and (tg_op='INSERT' or (new.status,new.plate,new.driver1_id,new.driver2_id) is distinct from (old.status,old.plate,old.driver1_id,old.driver2_id)) then
  perform pg_advisory_xact_lock(72940117);
  if exists(select 1 from public.pull_trips t where t.id<>new.id and t.status='IN_PROGRESS'
   and (t.plate=new.plate or t.driver1_id in(new.driver1_id,new.driver2_id) or t.driver2_id in(new.driver1_id,new.driver2_id))) then
   perform public.pull_app_error('ACTIVE_TRIP_CONFLICT','A placa ou um dos motoristas já possui viagem em andamento.',409);end if;
  if tg_op='INSERT' and exists(select 1 from public.pull_trips where trip_code=new.trip_code) then
   select regexp_replace(new.trip_code,'[0-9]+$','')||lpad((coalesce(max(nullif(regexp_replace(trip_code,'[^0-9]','','g'),'')::bigint),0)+1)::text,6,'0') into new.trip_code from public.pull_trips;
  end if;
 end if;
 return new;
end;$$;
create trigger pull_app_start_lock before insert or update on public.pull_trips for each row execute function public.pull_app_start_lock();

create function public.pull_app_snapshot(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare t public.pull_trips%rowtype;r public.pull_app_runtime%rowtype;e jsonb;c jsonb;o jsonb;n jsonb;g jsonb;last_key text;applies boolean;begin
 t:=public.pull_app_trip_guard(p_id);select * into strict r from public.pull_app_runtime where trip_id=p_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'stageKey',v.action_code,'label',v.step_name,'order',v.step_order,'userId',v.user_id,'userName',v.user_name,'occurredAt',v.recorded_at,'receivedAt',coalesce(v.app_received_at,v.recorded_at),
 'location',coalesce((select new_location from public.pull_app_location_audit where event_id=v.id order by corrected_at desc,id desc limit 1),nullif(v.app_location,'null'),public.pull_app_location(v.latitude,v.longitude,v.gps_accuracy,v.recorded_at)),
 'locationStatus',coalesce(v.app_location_status,case when v.latitude is null then 'Unavailable' else 'Captured' end),
 'locationCorrections',coalesce((select jsonb_agg(jsonb_build_object('actorName',actor_name,'at',corrected_at,'reason',reason,'before',original_location,'after',new_location) order by corrected_at) from public.pull_app_location_audit where event_id=v.id),'[]')) order by v.step_order,v.recorded_at),'[]') into e from public.pull_events v where trip_id=p_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'checkpoint',v.checkpoint_code,'driverNo',v.driver_no,'userId',v.driver_id,'userName',v.driver_name,'occurredAt',v.recorded_at,'receivedAt',coalesce(v.app_received_at,v.recorded_at),'odometerKm',v.odometer_km,'odometerPreviousKm',v.odometer_previous_km,'odometerDeltaKm',v.odometer_delta_km,'odometerAlert',v.odometer_alert,
 'answers',coalesce((select jsonb_agg(jsonb_build_object('questionId',a.question_id,'question',a.question_snapshot,'critical',a.critical_snapshot,'answer',a.answer,'observation',a.observation) order by a.sort_order) from public.pull_checklist_answers a where run_id=v.id),'[]')) order by v.recorded_at),'[]') into c from public.pull_checklist_runs v where trip_id=p_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'type',case action_code when 'OCC_REFEICAO' then 'MEAL' else replace(action_code,'OCC_','') end,'label',occurrence_name,'note',note,'status',status,'userId',started_by,'userName',started_by_name,'startedAt',started_at,'endedAt',ended_at,
 'startLocation',coalesce(nullif(app_start_location,'null'),public.pull_app_location(start_latitude,start_longitude,start_accuracy,started_at)),'endLocation',coalesce(nullif(app_end_location,'null'),public.pull_app_location(end_latitude,end_longitude,end_accuracy,ended_at))) order by started_at),'[]') into o from public.pull_occurrences where trip_id=p_id;
 if t.status='IN_PROGRESS' then
  select s into n from jsonb_array_elements(r.steps) s where not exists(select 1 from public.pull_events where trip_id=p_id and action_code=s->>'key') order by (s->>'order')::int limit 1;
  if n is not null then n:=n||jsonb_build_object('responsibleUserId',case when n->>'executor'='2' then t.driver2_id else t.driver1_id end,'responsibleName',case when n->>'executor'='2' then t.driver2_name else t.driver1_name end);end if;
 end if;
 applies:=r.checklist_required and coalesce((select checklist_enabled from public.pull_settings where singleton),false);
 select action_code into last_key from public.pull_events where trip_id=p_id order by step_order desc limit 1;
 if applies and n is not null then select x into g from jsonb_array_elements(r.requirements) x where x->>'gateStage'=n->>'key' and x->>'afterAction'=last_key and not exists(select 1 from public.pull_checklist_runs where trip_id=p_id and checkpoint_code=x->>'checkpoint') order by (x->>'order')::int limit 1;end if;
 return jsonb_build_object('id',t.id,'code',t.trip_code,'unitId',t.origin_unit,'unitName',t.origin_unit,'type',t.cycle_type,'status',t.status,'plate',t.plate,'carrier',t.carrier,'destination',t.factory,'driver1Id',t.driver1_id,'driver1Name',t.driver1_name,'driver2Id',case when t.solo_trip then null else t.driver2_id end,'driver2Name',case when t.solo_trip then null else t.driver2_name end,
 'solo',t.solo_trip,'revision',r.revision,'workflowVersion',r.workflow_version,'steps',r.steps,'events',e,'occurrences',o,'checklists',c,'nextStep',n,'pendingChecklist',g,'checklistRequired',r.checklist_required,'checklistApplies',applies,'checklistQuestions',r.questions,'checklistRequirements',case when applies then r.requirements else '[]' end,'weekPosition',t.week_trip_type,'startedAt',t.started_at,'endedAt',t.ended_at,'nextStartedAt',t.next_started_at,'arrivedFactoryAt',t.arrived_factory_at,'leftFactoryAt',t.left_factory_at,'appointmentAt',t.appointment_at,'tmaAdjustmentMinutes',t.tma_adjust_minutes,'imported',false,
 'lastOdometerKm',(select k.odometer_km from public.pull_checklist_runs k join public.pull_trips v on v.id=k.trip_id where v.plate=t.plate and k.odometer_km is not null order by k.recorded_at desc limit 1),
 'attachments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name','Foto da viagem','path',photo_path,'createdAt',created_at,'observation',observation) order by created_at) from public.pull_trip_attachments where trip_id=p_id),'[]'),
 'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name','Nota fiscal','number',invoice_number,'path',pdf_path,'createdAt',created_at,'items',items) order by created_at) from public.pull_trip_invoices where trip_id=p_id),'[]'),'routePoints','[]'::jsonb);
end;$$;

create or replace function public.guard_pull_checklist_step()
returns trigger language plpgsql security definer set search_path=public as $$
declare r public.pull_app_runtime%rowtype;checkpoint text;begin
 if not coalesce((select checklist_enabled from public.pull_settings where singleton),false) then return new;end if;
 select * into r from public.pull_app_runtime where trip_id=new.trip_id;
 if found then
  if not r.checklist_required then return new;end if;
  select x->>'checkpoint' into checkpoint from jsonb_array_elements(r.requirements) x where x->>'gateStage'=new.action_code
   and not exists(select 1 from public.pull_checklist_runs where trip_id=new.trip_id and checkpoint_code=x->>'checkpoint') order by (x->>'order')::int limit 1;
 else
  select q.checkpoint_code into checkpoint from public.pull_checklist_requirements(new.trip_id) q where q.gate_action=new.action_code
   and not exists(select 1 from public.pull_checklist_runs where trip_id=new.trip_id and checkpoint_code=q.checkpoint_code) order by q.sort_order limit 1;
 end if;
 if checkpoint is not null then perform public.pull_app_error('CHECKLIST_PENDING','Conclua o checklist antes de registrar esta etapa.',409);end if;
 return new;
end;$$;
create function public.pull_app_receipt(p_id uuid,p_duplicate boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r public.pull_app_receipts%rowtype;s jsonb;begin
 perform public.pull_app_guard();select * into r from public.pull_app_receipts where command_id=p_id;
 if r.command_id is null then perform public.pull_app_error('NOT_FOUND','Registro ainda não confirmado no servidor.',404);end if;
 if r.actor_id<>auth.uid() then perform public.pull_app_error('COMMAND_ID_REUSED','Este identificador pertence a outro registro.',409);end if;
 s:=public.pull_app_snapshot(r.trip_id);
 return jsonb_build_object('commandId',r.command_id,'tripId',r.trip_id,'revision',s->'revision','eventId',r.event_id,'duplicate',p_duplicate,'state',s);
end;$$;
create function public.pull_app_checklist(p_trip uuid,p_body jsonb,p_gate jsonb,p_at timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$
declare t public.pull_trips%rowtype;r public.pull_app_runtime%rowtype;p public.profiles%rowtype;
 run public.pull_checklist_runs%rowtype;q jsonb;a jsonb;km int;prev int;answers jsonb:=p_body->'answers';d int;rid uuid;begin
 t:=public.pull_app_trip_guard(p_trip,true);select * into strict r from public.pull_app_runtime where trip_id=p_trip;
 p:=public.pull_app_guard('PULL_TRIP');d:=(p_gate->>'driverNo')::int;
 if auth.uid()<>(case when d=2 then t.driver2_id else t.driver1_id end) then perform public.pull_app_error('WRONG_DRIVER','Este checklist deve ser preenchido pelo motorista indicado.',403);end if;
 km:=(p_body->>'odometerKm')::int;
 if km is null or km not between 0 and 9999999 then perform public.pull_app_error('INVALID_ODOMETER','Informe a quilometragem atual do veículo.');end if;
 if jsonb_typeof(answers) is distinct from 'array' or jsonb_array_length(answers)<>jsonb_array_length(r.questions) or jsonb_array_length(r.questions)=0 then
  perform public.pull_app_error('INVALID_CHECKLIST','Responda todas as perguntas deste checklist.');end if;
 for q in select value from jsonb_array_elements(r.questions) loop
  if (select count(*) from jsonb_array_elements(answers) x where x->>'questionId'=q->>'id')<>1 then perform public.pull_app_error('INVALID_CHECKLIST','Cada pergunta precisa de uma única resposta.');end if;
  select x into a from jsonb_array_elements(answers) x where x->>'questionId'=q->>'id';
  if coalesce(a->>'answer','') not in('OK','NOK') or length(coalesce(a->>'observation',''))>1000 or (a->>'answer'='NOK' and length(btrim(coalesce(a->>'observation','')))<3) then
   perform public.pull_app_error('INVALID_CHECKLIST','Responda OK ou NOK e justifique os itens NOK.');end if;
 end loop;
 select * into run from public.pull_checklist_runs where trip_id=p_trip and checkpoint_code=p_gate->>'checkpoint';
 if found then perform public.pull_app_error('CHECKLIST_ALREADY_RECORDED','Este checklist já foi confirmado. Atualize a viagem.',409);end if;
 select k.odometer_km into prev from public.pull_checklist_runs k join public.pull_trips v on v.id=k.trip_id where v.plate=t.plate and k.odometer_km is not null order by k.recorded_at desc limit 1;
 insert into public.pull_checklist_runs(trip_id,checkpoint_code,checklist_type,driver_no,driver_id,driver_name,recorded_at,device_at,latitude,longitude,gps_accuracy,odometer_km,odometer_previous_km,odometer_delta_km,odometer_alert,app_received_at)
 values(p_trip,p_gate->>'checkpoint',coalesce(p_gate->>'type','RETURN'),d,p.id,p.name,p_at,p_at,(p_body#>>'{location,latitude}')::float8,(p_body#>>'{location,longitude}')::float8,(p_body#>>'{location,accuracy}')::float8,km,prev,km-prev,case when km<prev then 'LOWER' when km-prev>5000 then 'JUMP' end,clock_timestamp()) returning id into rid;
 insert into public.pull_checklist_answers(run_id,question_id,question_snapshot,critical_snapshot,answer,observation,sort_order)
 select rid,(xq->>'id')::uuid,xq->>'text',(xq->>'critical')::boolean,xa->>'answer',coalesce(xa->>'observation',''),(xq->>'order')::int
 from jsonb_array_elements(r.questions) xq join jsonb_array_elements(answers) xa on xa->>'questionId'=xq->>'id';
 return rid;
end;$$;
create function public.pull_app_command(p_trip uuid,p_body jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.pull_trips%rowtype;p public.profiles%rowtype;prior public.pull_app_receipts%rowtype;
 s jsonb;n jsonb;g jsonb;step public.pull_steps%rowtype;occ public.pull_occurrences%rowtype;
 cid uuid:=(p_body->>'commandId')::uuid;at_time timestamptz:=(p_body->>'occurredAt')::timestamptz;
 kind text:=p_body->>'kind';result_id uuid;dep text;last_at timestamptz;lat float8;lon float8;acc float8;action text;begin
 p:=public.pull_app_guard('PULL_TRIP');if cid is null then perform public.pull_app_error('INVALID_COMMAND','O registro precisa de um identificador.');end if;
 perform pg_advisory_xact_lock(hashtextextended('pull-command:'||cid::text,0));
 t:=public.pull_app_trip_guard(p_trip,true);select * into strict t from public.pull_trips where id=p_trip for update;
 select * into prior from public.pull_app_receipts where command_id=cid;
 if found then
  if prior.actor_id<>p.id or prior.trip_id<>p_trip or prior.payload<>p_body then perform public.pull_app_error('COMMAND_ID_REUSED','Este identificador já foi usado com outro conteúdo.',409);end if;
  return public.pull_app_receipt(cid,true);
 end if;
 if t.status<>'IN_PROGRESS' then perform public.pull_app_error('TRIP_CLOSED','Esta viagem já foi encerrada.',409);end if;
 if at_time is null or at_time>now()+interval '5 minutes' or at_time<t.started_at then perform public.pull_app_error('INVALID_TIME','O horário do registro é incompatível com esta viagem.');end if;
 if coalesce(jsonb_typeof(p_body->'dependsOnCommandIds'),'array')<>'array' then perform public.pull_app_error('INVALID_COMMAND','Dependências inválidas.');end if;
 for dep in select jsonb_array_elements_text(coalesce(p_body->'dependsOnCommandIds','[]')) loop
  if not exists(select 1 from public.pull_app_receipts where command_id=dep::uuid and trip_id=p_trip and actor_id=p.id) then perform public.pull_app_error('DEPENDENCY_PENDING','Aguarde a confirmação do registro anterior.',409);end if;
 end loop;
 perform public.pull_app_validate_location(p_body);lat:=(p_body#>>'{location,latitude}')::float8;lon:=(p_body#>>'{location,longitude}')::float8;acc:=(p_body#>>'{location,accuracy}')::float8;
 s:=public.pull_app_snapshot(p_trip);n:=s->'nextStep';g:=s->'pendingChecklist';
 if kind='RECORD_STEP' then
  action:=p_body->>'stageKey';
  select id into result_id from public.pull_events where trip_id=p_trip and action_code=action and user_id=p.id;
  if result_id is null then
   if n is null or n='null' or n->>'key' is distinct from action then perform public.pull_app_error('STEP_OUT_OF_SEQUENCE','Atualize a viagem e registre a próxima etapa indicada.',409);end if;
   if n->>'responsibleUserId'<>p.id::text then perform public.pull_app_error('WRONG_DRIVER','Esta etapa pertence ao motorista indicado.',403);end if;
   if exists(select 1 from public.pull_occurrences where trip_id=p_trip and status='OPEN') then perform public.pull_app_error('OCCURRENCE_OPEN','Encerre a ocorrência antes de continuar.',409);end if;
   if g is not null and g<>'null' then perform public.pull_app_error('CHECKLIST_PENDING','Preencha o checklist antes de continuar.',409);end if;
   select max(z.at_time) into last_at from (select recorded_at at_time from public.pull_events where trip_id=p_trip union all select ended_at from public.pull_occurrences where trip_id=p_trip union all select recorded_at from public.pull_checklist_runs where trip_id=p_trip) z;
   if at_time<last_at then perform public.pull_app_error('INVALID_TIME','Este registro é anterior à última etapa confirmada.');end if;
   insert into public.pull_events(trip_id,step_id,step_name,action_code,step_order,user_id,user_name,recorded_at,device_at,latitude,longitude,gps_accuracy,geofence_status,app_received_at,app_location_status,app_location)
   values(p_trip,(n->>'legacyId')::uuid,n->>'label',action,(n->>'order')::int,p.id,p.name,at_time,at_time,lat,lon,acc,'NOT_APPLICABLE',clock_timestamp(),coalesce(p_body->>'locationStatus','Unavailable'),p_body->'location') returning id into result_id;
   if action='ARRIVE_FACTORY' then update public.pull_trips set arrived_factory_at=at_time where id=p_trip;
   elsif action='LEAVE_FACTORY' then update public.pull_trips set left_factory_at=at_time where id=p_trip;
   elsif action in('ARRIVE_UNIT','TRANSFER_ARRIVE_MATRIX') then
    update public.pull_trips set ended_at=at_time,ended_by_id=p.id,ended_by_name=p.name,end_latitude=lat,end_longitude=lon,end_accuracy=acc,status='ARRIVED',
     kpi_status=case when cycle_type='TRANSFER' then 'CLOSED' else 'WAITING_NEXT_START' end,nri_status=case when cycle_type='TRANSFER' then 'NOT_READY' else 'PENDING' end,
     next_started_at=case when cycle_type='TRANSFER' then at_time end where id=p_trip;
   end if;
   s:=public.pull_app_snapshot(p_trip);n:=s->'nextStep';
   update public.pull_trips set active_driver_id=coalesce((n->>'responsibleUserId')::uuid,p.id),active_driver_name=coalesce(n->>'responsibleName',p.name) where id=p_trip;
  end if;
 elsif kind='START_OCCURRENCE' then
  if n->>'responsibleUserId' is distinct from p.id::text then perform public.pull_app_error('WRONG_DRIVER','A ocorrência deve ser registrada pelo motorista ativo.',403);end if;
  if exists(select 1 from public.pull_occurrences where trip_id=p_trip and status='OPEN') then perform public.pull_app_error('OCCURRENCE_OPEN','Já existe uma ocorrência em andamento.',409);end if;
  action:=case p_body->>'occurrenceType' when 'MEAL' then 'OCC_REFEICAO' else 'OCC_'||(p_body->>'occurrenceType') end;
  select * into step from public.pull_steps where step_type='OCCURRENCE' and active and action_code=action;
  if step.id is null then perform public.pull_app_error('INVALID_OCCURRENCE','Selecione um tipo de ocorrência disponível.');end if;
  select max(recorded_at) into last_at from public.pull_events where trip_id=p_trip;
  if at_time<last_at or length(coalesce(p_body->>'note',''))>1000 then perform public.pull_app_error('INVALID_OCCURRENCE','Confira o horário e a observação da ocorrência.');end if;
  result_id:=(p_body->>'occurrenceId')::uuid;if result_id is null then perform public.pull_app_error('INVALID_COMMAND','Identificador de ocorrência obrigatório.');end if;
  insert into public.pull_occurrences(id,trip_id,step_id,occurrence_name,action_code,duration_mode,suggest_tma_discount,started_by,started_by_name,started_at,start_latitude,start_longitude,start_accuracy,note,status)
   values(result_id,p_trip,step.id,step.name,step.action_code,'INTERVAL',step.suggest_tma_discount,p.id,p.name,at_time,lat,lon,acc,coalesce(p_body->>'note',''),'OPEN');
  update public.pull_occurrences set app_start_location=p_body->'location' where id=result_id;
 elsif kind='END_OCCURRENCE' then
  select * into occ from public.pull_occurrences where id=(p_body->>'occurrenceId')::uuid and trip_id=p_trip for update;
  if occ.id is null then perform public.pull_app_error('NOT_FOUND','Ocorrência não encontrada.',404);end if;
  if occ.started_by<>p.id then perform public.pull_app_error('WRONG_DRIVER','A ocorrência deve ser encerrada pelo motorista que a iniciou.',403);end if;
  if at_time<occ.started_at then perform public.pull_app_error('INVALID_TIME','O encerramento não pode ser anterior ao início.');end if;
  if occ.status='OPEN' then update public.pull_occurrences set ended_at=at_time,ended_by=p.id,ended_by_name=p.name,end_latitude=lat,end_longitude=lon,end_accuracy=acc,status='CLOSED' where id=occ.id;end if;
  if occ.status='OPEN' then update public.pull_occurrences set app_end_location=p_body->'location' where id=occ.id;end if;
  result_id:=occ.id;
 elsif kind='SUBMIT_CHECKLIST' then
  if g is null or g='null' or g->>'checkpoint' is distinct from p_body->>'checkpoint' then perform public.pull_app_error('CHECKLIST_NOT_PENDING','Este checklist não está pendente. Atualize a viagem.',409);end if;
  select max(recorded_at) into last_at from public.pull_events where trip_id=p_trip;
  if at_time<last_at then perform public.pull_app_error('INVALID_TIME','O checklist não pode ser anterior à etapa que o liberou.');end if;
  result_id:=public.pull_app_checklist(p_trip,p_body,g,at_time);
 else perform public.pull_app_error('INVALID_COMMAND','Tipo de registro inválido.');end if;
 insert into public.pull_app_receipts(command_id,actor_id,trip_id,payload,event_id) values(cid,p.id,p_trip,p_body,result_id);
 return public.pull_app_receipt(cid);
end;$$;

create function public.pull_app_start(p_plan uuid,p_body jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.profiles%rowtype;plan public.pull_trip_plans%rowtype;meta public.pull_app_plan_runtime%rowtype;
 prior public.pull_app_receipts%rowtype;t public.pull_trips%rowtype;prev public.pull_trips%rowtype;r public.pull_app_runtime%rowtype;
 cid uuid:=(p_body->>'commandId')::uuid;payload jsonb:=p_body||jsonb_build_object('_planId',p_plan);
 at_time timestamptz:=(p_body->>'occurredAt')::timestamptz;first_step jsonb;n jsonb;event_id uuid;code text;required boolean;checkpoint text;begin
 p:=public.pull_app_guard('PULL_TRIP');if cid is null then perform public.pull_app_error('INVALID_COMMAND','Identificador de início obrigatório.');end if;
 perform pg_advisory_xact_lock(hashtextextended('pull-command:'||cid::text,0));
 select * into prior from public.pull_app_receipts where command_id=cid;
 if found then
  if prior.actor_id<>p.id or prior.payload<>payload then perform public.pull_app_error('COMMAND_ID_REUSED','Este identificador já foi usado com outro conteúdo.',409);end if;
  return public.pull_app_receipt(cid,true);
 end if;
 perform pg_advisory_xact_lock(72940117);
 select * into plan from public.pull_trip_plans where id=p_plan for update;
 if plan.id is null then perform public.pull_app_error('NOT_FOUND','Programação não encontrada.',404);end if;
 perform public.assert_user_unit(plan.origin_unit);
 if plan.driver1_id<>p.id then perform public.pull_app_error('WRONG_DRIVER','O motorista de saída deve iniciar a viagem.',403);end if;
 if plan.status<>'PLANNED' then perform public.pull_app_error('PLAN_NOT_AVAILABLE','Esta programação já foi iniciada ou cancelada.',409);end if;
 if at_time is null or at_time<now()-interval '5 minutes' or at_time>now()+interval '5 minutes' then perform public.pull_app_error('START_REQUEST_EXPIRED','Atualize a programação e tente iniciar novamente.',422);end if;
 perform public.pull_app_validate_location(p_body);
 if not exists(select 1 from public.units where name=plan.origin_unit and active) or not exists(select 1 from public.pull_vehicles where plate=plan.plate and active)
  or not exists(select 1 from public.profiles where id=plan.driver1_id and active and role='MOTORISTA_PUXADOR')
  or not exists(select 1 from public.user_units where user_id=plan.driver1_id and unit_name=plan.origin_unit)
  or (not plan.solo_trip and (not exists(select 1 from public.profiles where id=plan.driver2_id and active and role='MOTORISTA_PUXADOR') or not exists(select 1 from public.user_units where user_id=plan.driver2_id and unit_name=plan.origin_unit))) then
  perform public.pull_app_error('INVALID_PLAN','Confira a placa, os motoristas e o acesso à unidade desta programação.');end if;
 select * into meta from public.pull_app_plan_runtime where plan_id=p_plan;
 required:=coalesce(meta.checklist_required,false) and coalesce((select checklist_enabled from public.pull_settings where singleton),false);
 select * into prev from public.pull_trips where plate=plan.plate and status='ARRIVED' and next_started_at is null and ended_at is not null order by ended_at desc limit 1 for update;
 if prev.id is not null and prev.ended_at>at_time then perform public.pull_app_error('INVALID_TIME','O início não pode ser anterior à chegada da viagem anterior.');end if;
 select 'PUX-'||lpad((coalesce(max(nullif(regexp_replace(trip_code,'[^0-9]','','g'),'')::bigint),0)+1)::text,6,'0') into code from public.pull_trips;
 insert into public.pull_trips(trip_code,origin_unit,plate,carrier,factory,driver1_id,driver1_name,driver2_id,driver2_name,active_driver_id,active_driver_name,started_at,start_latitude,start_longitude,start_accuracy,cycle_type,solo_trip,appointment_at,week_trip_type,checklist_flow_version)
 values(code,plan.origin_unit,plan.plate,plan.carrier,plan.factory,plan.driver1_id,plan.driver1_name,coalesce(plan.driver2_id,plan.driver1_id),coalesce(plan.driver2_name,plan.driver1_name),p.id,p.name,at_time,(p_body#>>'{location,latitude}')::float8,(p_body#>>'{location,longitude}')::float8,(p_body#>>'{location,accuracy}')::float8,plan.cycle_type,plan.solo_trip,plan.scheduled_at,case when required then coalesce(plan.week_trip_type,'ROUTINE') end,3) returning * into t;
 if required then update public.pull_app_runtime set questions=meta.questions where trip_id=t.id;end if;
 select * into strict r from public.pull_app_runtime where trip_id=t.id;
 select s into first_step from jsonb_array_elements(r.steps) s order by (s->>'order')::int limit 1;
 if first_step->>'key' is distinct from (case when t.cycle_type='TRANSFER' then 'TRANSFER_START' else 'START_TRIP' end) then perform public.pull_app_error('INVALID_WORKFLOW','A etapa de saída não está configurada corretamente.');end if;
 if required and (t.cycle_type='TRANSFER' or t.solo_trip or t.week_trip_type='FIRST') then
  checkpoint:=case when t.cycle_type='TRANSFER' then 'TRANSFER_START' when t.solo_trip then 'SOLO_START' else 'D1_START' end;
  perform public.pull_app_checklist(t.id,p_body,jsonb_build_object('checkpoint',checkpoint,'type','DEPARTURE','driverNo',1),at_time);
 end if;
 insert into public.pull_events(trip_id,step_id,step_name,action_code,step_order,user_id,user_name,recorded_at,device_at,latitude,longitude,gps_accuracy,geofence_status,app_received_at,app_location_status,app_location)
 values(t.id,(first_step->>'legacyId')::uuid,first_step->>'label',first_step->>'key',(first_step->>'order')::int,p.id,p.name,at_time,at_time,t.start_latitude,t.start_longitude,t.start_accuracy,'NOT_APPLICABLE',clock_timestamp(),coalesce(p_body->>'locationStatus','Unavailable'),p_body->'location') returning id into event_id;
 if prev.id is not null then update public.pull_trips set next_started_at=at_time,kpi_status='CLOSED' where id=prev.id;end if;
 update public.pull_trip_plans set status='STARTED',trip_id=t.id,updated_by=p.id,updated_at=now() where id=plan.id;
 n:=public.pull_app_snapshot(t.id)->'nextStep';
 update public.pull_trips set active_driver_id=coalesce((n->>'responsibleUserId')::uuid,p.id),active_driver_name=coalesce(n->>'responsibleName',p.name) where id=t.id;
 insert into public.pull_app_receipts(command_id,actor_id,trip_id,payload,event_id) values(cid,p.id,t.id,payload,event_id);
 return public.pull_app_receipt(cid);
end;$$;

create function public.pull_app_user(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',id,'username',username,'name',name,'active',active,'role',case role when 'ADMIN' then 'ADMIN' when 'MOTORISTA_PUXADOR' then 'DRIVER' else 'ANALYST' end,
 'unitIds',coalesce((select jsonb_agg(unit_name order by unit_name) from public.user_units where user_id=p_id and public.user_has_unit(unit_name)),'[]')) from public.profiles where id=p_id
$$;
create function public.pull_app_plan_json(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',p.id,'code',p.plate,'type',p.cycle_type,'unitId',p.origin_unit,'unitName',p.origin_unit,'plate',p.plate,'carrier',p.carrier,'vehicleId',(select id from public.pull_vehicles where plate=p.plate limit 1),'factoryId',case when p.cycle_type='PULL' then p.factory end,'destination',p.factory,'driver1Id',p.driver1_id,'driver1Name',p.driver1_name,'driver2Id',p.driver2_id,'driver2Name',p.driver2_name,'solo',p.solo_trip,'appointmentAt',p.scheduled_at,'status',p.status,'tripId',p.trip_id,'weekPosition',p.week_trip_type,'checklistRequired',coalesce(m.checklist_required,false),'checklistQuestions',coalesce(m.questions,'[]'))
 from public.pull_trip_plans p left join public.pull_app_plan_runtime m on m.plan_id=p.id where p.id=p_id
$$;
create function public.pull_app_settings() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('checklistEnabled',checklist_enabled,'gpsMaxAccuracyM',gps_max_accuracy_m,'trackIntervalSeconds',track_interval_seconds,'trackMinDistanceM',track_min_distance_m)
 from public.pull_settings where singleton
$$;
create function public.pull_app_catalog() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare p public.profiles%rowtype;begin p:=public.pull_app_guard();return jsonb_build_object(
 'units',coalesce((select jsonb_agg(jsonb_build_object('id',name,'name',name,'active',active) order by name) from public.units where active and public.user_has_unit(name)),'[]'),
 'users',coalesce((select jsonb_agg(public.pull_app_user(v.id) order by v.name) from public.profiles v where v.active and v.role='MOTORISTA_PUXADOR' and (v.id=p.id or p.role<>'MOTORISTA_PUXADOR') and exists(select 1 from public.user_units where user_id=v.id and public.user_has_unit(unit_name))),'[]'),
 'vehicles',coalesce((select jsonb_agg(jsonb_build_object('id',id,'plate',plate,'carrier',carrier,'active',active) order by plate) from public.pull_vehicles where active or public.has_permission('PULL_CONFIG')),'[]'),
 'factories',coalesce((select jsonb_agg(jsonb_build_object('id',name,'name',name,'active',active,'latitude',latitude,'longitude',longitude,'radiusMeters',radius_meters) order by name) from public.factories where active or public.has_permission('PULL_CONFIG')),'[]'),
 'settings',public.pull_app_settings(),
 'questions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'text',question,'critical',critical,'active',active,'order',sort_order) order by sort_order) from public.pull_checklist_questions where active or public.has_permission('PULL_CONFIG')),'[]'));
end;$$;

create function public.pull_app_request(p_method text,p_path text,p_query jsonb default '{}',p_body jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.profiles%rowtype;t public.pull_trips%rowtype;plan public.pull_trip_plans%rowtype;v public.pull_vehicles%rowtype;
 method text:=upper(p_method);parts text[]:=string_to_array(trim(both '/' from p_path),'/');resource text;
 trip_uuid uuid;record_id uuid;result jsonb;row jsonb;questions jsonb;unit_name text;kind text;object_path text;bucket text;at_time timestamptz;
 r public.pull_app_receipts%rowtype;media public.pull_app_media%rowtype;event public.pull_events%rowtype;
 required boolean;year_no int;checkpoint text;point jsonb;goal public.pull_goals%rowtype;begin
 p:=public.pull_app_guard();resource:=parts[1];
 if method not in('GET','POST','PUT','DELETE') then perform public.pull_app_error('METHOD_NOT_ALLOWED','Método não permitido.',405);end if;
 if resource='auth' and parts[2]='session' and method='GET' then
  return jsonb_build_object('user',public.pull_app_user(p.id)||jsonb_build_object('allowedPages',
   (case when public.has_permission('PULL_TRIP') then '["operations"]'::jsonb else '[]' end)||
   (case when public.has_permission('PULL_PLAN') then '["plans"]'::jsonb else '[]' end)||
   (case when public.has_permission('PULL_FAROL') then '["control"]'::jsonb else '[]' end)||
   (case when public.has_permission('PULL_HISTORY') or public.has_permission('PULL_TMA_ADJUST') or public.has_permission('PULL_TRIP') then '["history"]'::jsonb else '[]' end)||
   (case when public.has_permission('PULL_DASHBOARD') then '["dashboard"]'::jsonb else '[]' end)||
   (case when public.has_permission('PULL_CONFIG') or public.has_permission('PULL_GOALS') then '["settings"]'::jsonb else '[]' end),
   'canConfigure',public.has_permission('PULL_CONFIG'),'canEditGoals',public.has_permission('PULL_GOALS'),'canAdjustTma',public.has_permission('PULL_TMA_ADJUST'),'canPlan',public.has_permission('PULL_PLAN'),'canCorrectLocation',public.has_permission('PULL_FAROL')));
 elsif resource='catalog' and method='GET' then return public.pull_app_catalog();
 elsif resource='commands' and method='GET' and cardinality(parts)=2 then return public.pull_app_receipt(parts[2]::uuid,true);
 elsif resource='plans' then
  if method='GET' then
   if not public.has_permission('PULL_PLAN') and not public.has_permission('PULL_TRIP') then perform public.pull_app_error('FORBIDDEN','Sem acesso às programações.',403);end if;
   return coalesce((select jsonb_agg(public.pull_app_plan_json(q.id) order by q.scheduled_at,q.created_at) from public.pull_trip_plans q
    where public.user_has_unit(q.origin_unit) and (public.has_permission('PULL_PLAN') or p.id in(q.driver1_id,q.driver2_id))
    and (nullif(p_query->>'unitId','') is null or q.origin_unit=p_query->>'unitId')
    and (nullif(p_query->>'from','') is null or (coalesce(q.scheduled_at,q.created_at) at time zone 'America/Sao_Paulo')::date >= (p_query->>'from')::date)
    and (nullif(p_query->>'to','') is null or (coalesce(q.scheduled_at,q.created_at) at time zone 'America/Sao_Paulo')::date <= (p_query->>'to')::date)),'[]');
  elsif cardinality(parts)=3 and parts[3]='start' and method='POST' then return public.pull_app_start(parts[2]::uuid,p_body);
  elsif cardinality(parts)=3 and parts[3]='cancel' and method='POST' then
   perform public.pull_app_guard('PULL_PLAN');perform public.cancel_pull_trip_plan(parts[2]::uuid);return jsonb_build_object('saved',true);
  elsif method in('POST','PUT') and cardinality(parts)<=2 then
   perform public.pull_app_guard('PULL_PLAN');select * into v from public.pull_vehicles where id=(p_body->>'vehicleId')::uuid and active;
   if v.id is null then perform public.pull_app_error('INVALID_VEHICLE','Selecione uma placa ativa.');end if;
   plan:=public.save_pull_trip_plan(case when method='PUT' then parts[2]::uuid end,p_body->>'type',p_body->>'unitId',v.plate,
    case when p_body->>'type'='PULL' then p_body->>'factoryId' else p_body->>'destination' end,(p_body->>'driver1Id')::uuid,nullif(p_body->>'driver2Id','')::uuid,
    coalesce((p_body->>'solo')::boolean,false),(p_body->>'appointmentAt')::timestamptz,nullif(p_body->>'weekPosition',''));
   required:=coalesce((select checklist_enabled from public.pull_settings where singleton),false);
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'text',question,'critical',critical,'active',true,'order',sort_order) order by sort_order),'[]') into questions from public.pull_checklist_questions where active;
   insert into public.pull_app_plan_runtime(plan_id,checklist_required,questions) values(plan.id,required,questions)
    on conflict(plan_id) do update set checklist_required=excluded.checklist_required,questions=excluded.questions;
   return public.pull_app_plan_json(plan.id);
  end if;
 elsif resource='trips' then
  if cardinality(parts)=1 and method='GET' then
   kind:=coalesce(p_query->>'scope','active');
   if kind not in('mine','active','history') then perform public.pull_app_error('INVALID_FILTER','Filtro de viagens inválido.');end if;
   if kind='active' then perform public.pull_app_guard('PULL_FAROL');
   elsif kind='mine' then perform public.pull_app_guard('PULL_TRIP');
   elsif not public.has_permission('PULL_HISTORY') and not public.has_permission('PULL_TMA_ADJUST') then perform public.pull_app_guard('PULL_TRIP');end if;
   return coalesce((select jsonb_agg(public.pull_app_snapshot(q.id) order by q.started_at desc) from public.pull_trips q
    where public.user_has_unit(q.origin_unit) and ((p.role<>'MOTORISTA_PUXADOR' and (public.has_permission('PULL_HISTORY') or public.has_permission('PULL_TMA_ADJUST') or kind='active')) or p.id in(q.driver1_id,q.driver2_id))
    and (kind<>'mine' or p.id in(q.driver1_id,q.driver2_id)) and (kind<>'active' or q.status='IN_PROGRESS')
    and (nullif(p_query->>'unitId','') is null or q.origin_unit=p_query->>'unitId')
    and (nullif(p_query->>'from','') is null or (q.started_at at time zone 'America/Sao_Paulo')::date >= (p_query->>'from')::date)
    and (nullif(p_query->>'to','') is null or (q.started_at at time zone 'America/Sao_Paulo')::date <= (p_query->>'to')::date)),'[]');
  end if;
  trip_uuid:=parts[2]::uuid;
  if cardinality(parts)=2 and method='GET' then return public.pull_app_snapshot(trip_uuid);
  elsif cardinality(parts)=3 and parts[3]='commands' and method='POST' then return public.pull_app_command(trip_uuid,p_body);
  end if;
  t:=public.pull_app_trip_guard(trip_uuid);
  if cardinality(parts)=2 and method='DELETE' then
   if p.role<>'ADMIN' then perform public.pull_app_error('FORBIDDEN','Somente administradores podem excluir ciclos.',403);end if;
   perform public.delete_pull_cycle(trip_uuid,p_query->>'confirmation');return jsonb_build_object('deleted',true);
  elsif parts[3]='appointment' and method='POST' then
   perform public.pull_app_guard('PULL_PLAN');perform public.change_pull_trip_appointment(trip_uuid,(p_body->>'appointmentAt')::timestamptz,p_body->>'reason');return public.pull_app_snapshot(trip_uuid);
  elsif parts[3]='tma-adjustment' and method='POST' then
   perform public.pull_app_guard('PULL_TMA_ADJUST');perform public.adjust_pull_tma(trip_uuid,(p_body->>'minutes')::int,p_body->>'reason');return public.pull_app_snapshot(trip_uuid);
  elsif parts[3]='route' and method='GET' then
   return jsonb_build_object('points',coalesce((select jsonb_agg(jsonb_build_object('latitude',latitude,'longitude',longitude,'capturedAt',coalesce(device_at,recorded_at),'source','GPS') order by coalesce(device_at,recorded_at)) from public.pull_track_points where trip_id=trip_uuid),'[]'),
    'archivedPoints',coalesce((select route_points from public.pull_trip_route_snapshots where trip_id=trip_uuid),'[]'),
    'stagePoints',public.pull_app_snapshot(trip_uuid)->'events');
  elsif parts[3]='tracks' and method='POST' then
   t:=public.pull_app_trip_guard(trip_uuid,true);
   if jsonb_typeof(p_body->'points') is distinct from 'array' or jsonb_array_length(p_body->'points')>500 then perform public.pull_app_error('INVALID_TRACKS','Envie até 500 posições por lote.');end if;
   for point in select value from jsonb_array_elements(p_body->'points') loop
    perform pg_advisory_xact_lock(hashtextextended('pull-track:'||coalesce(point->>'id',''),0));
    perform public.pull_app_validate_location(jsonb_build_object('location',point,'locationStatus','Captured'));
    at_time:=(point->>'capturedAt')::timestamptz;
    if at_time is null or at_time<t.started_at-interval '1 minute' or at_time>coalesce(t.ended_at,now())+interval '5 minutes' then perform public.pull_app_error('INVALID_TIME','Horário de posição inválido.');end if;
    if (point->>'id') is null then perform public.pull_app_error('INVALID_TRACKS','Identificador de posição obrigatório.');end if;
    if exists(select 1 from public.pull_track_points z where z.ingest_key=point->>'id' and (z.trip_id<>trip_uuid or z.user_id<>p.id or z.latitude<>(point->>'latitude')::float8 or z.longitude<>(point->>'longitude')::float8)) then perform public.pull_app_error('TRACK_ID_REUSED','Uma posição já usa este identificador.',409);end if;
    insert into public.pull_track_points(trip_id,user_id,device_at,latitude,longitude,gps_accuracy,ingest_key,source)
    select trip_uuid,p.id,at_time,(point->>'latitude')::float8,(point->>'longitude')::float8,(point->>'accuracy')::float8,point->>'id','WEB'
    where not exists(select 1 from public.pull_track_points z where z.trip_id=trip_uuid and z.user_id=p.id and z.ingest_key=point->>'id');
   end loop;return jsonb_build_object('saved',jsonb_array_length(p_body->'points'));
  elsif parts[3] in('attachments','invoices') and method='POST' then
   if not public.has_permission('PULL_PLAN') then t:=public.pull_app_trip_guard(trip_uuid,true);end if;
   perform 1 from public.pull_trips where pull_trips.id=trip_uuid for update;
   kind:=case when parts[3]='invoices' then 'invoice' else 'attachment' end;bucket:=case when kind='invoice' then 'puxada-notas' else 'puxada-anexos' end;
   select * into media from public.pull_app_media where client_id=(p_body->>'clientId')::uuid;
   if found then
    if media.actor_id<>p.id or media.trip_id<>trip_uuid or media.sha256<>p_body->>'sha256' or media.kind<>kind then perform public.pull_app_error('MEDIA_ID_REUSED','Identificador de arquivo já utilizado.',409);end if;
    return jsonb_build_object('id',media.record_id,'saved',true);
   end if;
   object_path:=p_body->>'path';
   if object_path is null or object_path not like trip_uuid::text||'/'||p.id::text||'/'||(p_body->>'clientId')||'.%' or object_path like '%..%' or length(object_path)>250
    or coalesce(p_body->>'sha256','') !~ '^[0-9a-f]{64}$' or coalesce((p_body->>'size')::bigint,0)<=0 or (p_body->>'size')::bigint>(case when kind='invoice' then 20000000 else 10000000 end)
    or not exists(select 1 from storage.objects where bucket_id=bucket and name=object_path and coalesce((metadata->>'size')::bigint,0)=(p_body->>'size')::bigint) then perform public.pull_app_error('INVALID_MEDIA','Envie um arquivo válido antes de concluir o registro.');end if;
   if kind='attachment' then
    if (select count(*) from public.pull_trip_attachments where trip_id=trip_uuid)>=10 then perform public.pull_app_error('PHOTO_LIMIT','Cada viagem pode ter até dez fotos.');end if;
    insert into public.pull_trip_attachments(trip_id,photo_path,observation,uploaded_by) values(trip_uuid,object_path,'',p.id) returning pull_trip_attachments.id into record_id;
   else
    insert into public.pull_trip_invoices(trip_id,pdf_path,invoice_number,items,uploaded_by) values(trip_uuid,object_path,coalesce(p_body->>'number',''),'[]',p.id) returning pull_trip_invoices.id into record_id;
   end if;
   insert into public.pull_app_media(client_id,trip_id,actor_id,kind,record_id,object_path,sha256,size_bytes) values((p_body->>'clientId')::uuid,trip_uuid,p.id,kind,record_id,object_path,p_body->>'sha256',(p_body->>'size')::bigint);
   return jsonb_build_object('id',record_id,'saved',true);
  end if;
 elsif resource='events' and parts[3]='location' and method='POST' then
  perform public.pull_app_guard('PULL_FAROL');select * into event from public.pull_events where pull_events.id=parts[2]::uuid;
  if event.id is null then perform public.pull_app_error('NOT_FOUND','Etapa não encontrada.',404);end if;
  t:=public.pull_app_trip_guard(event.trip_id);perform 1 from public.pull_trips where pull_trips.id=t.id for update;
  perform public.pull_app_validate_location(jsonb_build_object('location',jsonb_build_object('latitude',p_body->'latitude','longitude',p_body->'longitude'),'locationStatus','Captured'));
  if length(btrim(coalesce(p_body->>'reason','')))<3 or length(p_body->>'reason')>1000 then perform public.pull_app_error('REASON_REQUIRED','Informe o motivo do complemento da localização.');end if;
  result:=coalesce((select new_location from public.pull_app_location_audit where event_id=event.id order by corrected_at desc,id desc limit 1),nullif(event.app_location,'null'),public.pull_app_location(event.latitude,event.longitude,event.gps_accuracy,event.recorded_at));
  insert into public.pull_app_location_audit(trip_id,event_id,actor_id,actor_name,original_location,new_location,reason)
   values(t.id,event.id,p.id,p.name,result,public.pull_app_location((p_body->>'latitude')::float8,(p_body->>'longitude')::float8,null,now(),'Manual'),btrim(p_body->>'reason'));
  update public.pull_app_runtime set revision=revision+1 where trip_id=t.id;return public.pull_app_snapshot(t.id);
 elsif resource='settings' then
  perform public.pull_app_guard('PULL_CONFIG');if method='GET' then return public.pull_app_settings();end if;
  if method='PUT' then
   perform 1 from public.pull_settings where singleton for update;
   if coalesce((p_body->>'gpsMaxAccuracyM')::int,200) not between 5 and 500 or coalesce((p_body->>'trackIntervalSeconds')::int,60) not between 10 and 600 or coalesce((p_body->>'trackMinDistanceM')::int,20) not between 0 and 5000 then perform public.pull_app_error('INVALID_SETTINGS','Confira os limites de precisão e rastreamento.');end if;
   if coalesce((p_body->>'checklistEnabled')::boolean,false) and not exists(select 1 from public.pull_checklist_questions where active) then perform public.pull_app_error('NO_QUESTIONS','Cadastre ao menos uma pergunta ativa antes de habilitar o checklist.');end if;
   update public.pull_settings set checklist_enabled=coalesce((p_body->>'checklistEnabled')::boolean,false),gps_max_accuracy_m=coalesce((p_body->>'gpsMaxAccuracyM')::int,gps_max_accuracy_m),track_interval_seconds=coalesce((p_body->>'trackIntervalSeconds')::int,track_interval_seconds),track_min_distance_m=coalesce((p_body->>'trackMinDistanceM')::int,track_min_distance_m),updated_by=p.id,updated_at=now() where singleton;
   return public.pull_app_settings();
  end if;
 elsif resource='questions' and method='PUT' then
  perform public.pull_app_guard('PULL_CONFIG');
  perform 1 from public.pull_settings where singleton for update;
  if jsonb_typeof(p_body) is distinct from 'array' or jsonb_array_length(p_body)>100 then perform public.pull_app_error('INVALID_QUESTIONS','Lista de perguntas inválida.');end if;
  if (select count(distinct q->>'id') from jsonb_array_elements(p_body) q)<>jsonb_array_length(p_body) then perform public.pull_app_error('INVALID_QUESTIONS','Cada pergunta precisa de um identificador exclusivo.');end if;
  for row in select value from jsonb_array_elements(p_body) loop
   if length(btrim(coalesce(row->>'text',''))) not between 5 and 300 then perform public.pull_app_error('INVALID_QUESTIONS','As perguntas devem ter de 5 a 300 caracteres.');end if;
   insert into public.pull_checklist_questions(id,question,critical,active,sort_order) values(coalesce((row->>'id')::uuid,gen_random_uuid()),btrim(row->>'text'),coalesce((row->>'critical')::boolean,false),coalesce((row->>'active')::boolean,true),(row->>'order')::int)
    on conflict(id) do update set question=excluded.question,critical=excluded.critical,active=excluded.active,sort_order=excluded.sort_order;
  end loop;
  update public.pull_checklist_questions set active=false where id not in(select (q->>'id')::uuid from jsonb_array_elements(p_body) q);
  if coalesce((select checklist_enabled from public.pull_settings where singleton),false) and not exists(select 1 from public.pull_checklist_questions where active) then perform public.pull_app_error('NO_QUESTIONS','Mantenha ao menos uma pergunta ativa enquanto o checklist estiver habilitado.');end if;
  return jsonb_build_object('saved',true);
 elsif resource in('vehicles','factories') and method in('POST','PUT') then
  perform public.pull_app_guard('PULL_CONFIG');
  if resource='vehicles' then
   if upper(regexp_replace(coalesce(p_body->>'plate',''),'[^A-Za-z0-9]','','g')) !~ '^[A-Z0-9]{7}$' or length(coalesce(p_body->>'carrier',''))>200 then perform public.pull_app_error('INVALID_VEHICLE','Informe placa e transportadora válidas.');end if;
   if method='POST' then insert into public.pull_vehicles(plate,carrier,active) values(upper(regexp_replace(p_body->>'plate','[^A-Za-z0-9]','','g')),coalesce(p_body->>'carrier',''),coalesce((p_body->>'active')::boolean,true));
   else update public.pull_vehicles set plate=upper(regexp_replace(p_body->>'plate','[^A-Za-z0-9]','','g')),carrier=coalesce(p_body->>'carrier',''),active=coalesce((p_body->>'active')::boolean,true) where pull_vehicles.id=parts[2]::uuid;end if;
  else
   if length(btrim(coalesce(p_body->>'name',''))) not between 2 and 150 or ((p_body->>'latitude') is null)<>((p_body->>'longitude') is null) or ((p_body->>'latitude') is not null and (not ((p_body->>'latitude')::float8 between -90 and 90) or not ((p_body->>'longitude')::float8 between -180 and 180))) or coalesce((p_body->>'radiusMeters')::int,100) not between 1 and 100000 then perform public.pull_app_error('INVALID_FACTORY','Confira o nome e as coordenadas da fábrica.');end if;
   if method='POST' then insert into public.factories(name,active,latitude,longitude,radius_meters) values(btrim(p_body->>'name'),coalesce((p_body->>'active')::boolean,true),(p_body->>'latitude')::float8,(p_body->>'longitude')::float8,(p_body->>'radiusMeters')::int);
   else
    if btrim(p_body->>'name') is distinct from p_query->>'resourceId' then perform public.pull_app_error('FACTORY_NAME_IMMUTABLE','Para outro nome de fábrica, cadastre uma nova e inative a anterior.');end if;
    update public.factories set active=coalesce((p_body->>'active')::boolean,true),latitude=(p_body->>'latitude')::float8,longitude=(p_body->>'longitude')::float8,radius_meters=(p_body->>'radiusMeters')::int where name=p_query->>'resourceId';
   end if;
  end if;return jsonb_build_object('saved',true);
 elsif resource='goals' and method in('GET','PUT') then
  year_no:=parts[2]::int;if year_no not between 1900 and 2100 then perform public.pull_app_error('INVALID_YEAR','Selecione um ano válido.');end if;
  if method='PUT' then
   perform public.pull_app_guard('PULL_GOALS');
   for row in select to_jsonb(x) from jsonb_each_text(p_body) x loop
    if row->>'key' ~ 'TargetMinutes$' and (row->>'value')::numeric not between 0 and 525600 then perform public.pull_app_error('INVALID_GOAL','A meta de tempo está fora do limite.');end if;
    if row->>'key' ~ 'Adherence$' and (row->>'value')::numeric not between 0 and 100 then perform public.pull_app_error('INVALID_GOAL','A meta de aderência deve ficar entre 0 e 100%.');end if;
   end loop;
   insert into public.pull_goals(year,tmv_out_target_minutes,factory_target_minutes,tmv_return_target_minutes,unit_target_minutes,cycle_target_minutes,tmv_out_adherence,factory_adherence,tmv_return_adherence,unit_adherence,cycle_adherence,updated_by)
   values(year_no,coalesce((p_body->>'tmvOutTargetMinutes')::int,0),coalesce((p_body->>'factoryTargetMinutes')::int,0),coalesce((p_body->>'tmvReturnTargetMinutes')::int,0),coalesce((p_body->>'unitTargetMinutes')::int,0),coalesce((p_body->>'cycleTargetMinutes')::int,0),coalesce((p_body->>'tmvOutAdherence')::numeric,0),coalesce((p_body->>'factoryAdherence')::numeric,0),coalesce((p_body->>'tmvReturnAdherence')::numeric,0),coalesce((p_body->>'unitAdherence')::numeric,0),coalesce((p_body->>'cycleAdherence')::numeric,0),p.id)
    on conflict(year) do update set tmv_out_target_minutes=excluded.tmv_out_target_minutes,factory_target_minutes=excluded.factory_target_minutes,tmv_return_target_minutes=excluded.tmv_return_target_minutes,unit_target_minutes=excluded.unit_target_minutes,cycle_target_minutes=excluded.cycle_target_minutes,tmv_out_adherence=excluded.tmv_out_adherence,factory_adherence=excluded.factory_adherence,tmv_return_adherence=excluded.tmv_return_adherence,unit_adherence=excluded.unit_adherence,cycle_adherence=excluded.cycle_adherence,updated_by=p.id,updated_at=now();
  elsif not public.has_permission('PULL_DASHBOARD') and not public.has_permission('PULL_GOALS') then perform public.pull_app_error('FORBIDDEN','Sem acesso às metas.',403);end if;
  select * into goal from public.pull_goals where year=year_no;
  return jsonb_build_object('year',year_no,'tmvOutTargetMinutes',coalesce(goal.tmv_out_target_minutes,0),'factoryTargetMinutes',coalesce(goal.factory_target_minutes,0),'tmvReturnTargetMinutes',coalesce(goal.tmv_return_target_minutes,0),'unitTargetMinutes',coalesce(goal.unit_target_minutes,0),'cycleTargetMinutes',coalesce(goal.cycle_target_minutes,0),'tmvOutAdherence',coalesce(goal.tmv_out_adherence,0),'factoryAdherence',coalesce(goal.factory_adherence,0),'tmvReturnAdherence',coalesce(goal.tmv_return_adherence,0),'unitAdherence',coalesce(goal.unit_adherence,0),'cycleAdherence',coalesce(goal.cycle_adherence,0));
 elsif resource='_analytics' and method='GET' then
  perform public.pull_app_guard('PULL_DASHBOARD');
  return coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'code',q.trip_code,'unitId',q.origin_unit,'unitName',q.origin_unit,'type',q.cycle_type,'status',q.status,'plate',q.plate,'carrier',q.carrier,'destination',q.factory,'driver1Id',q.driver1_id,'driver1Name',q.driver1_name,'driver2Id',case when q.solo_trip then null else q.driver2_id end,'driver2Name',case when q.solo_trip then null else q.driver2_name end,'startedAt',q.started_at,'endedAt',q.ended_at,'nextStartedAt',q.next_started_at,'arrivedFactoryAt',q.arrived_factory_at,'leftFactoryAt',q.left_factory_at,'tmaAdjustmentMinutes',q.tma_adjust_minutes,'imported',false) order by q.started_at desc) from public.pull_trips q where public.user_has_unit(q.origin_unit) and (p.role<>'MOTORISTA_PUXADOR' or p.id in(q.driver1_id,q.driver2_id))),'[]');
 end if;
 perform public.pull_app_error('NOT_FOUND','Esta função não está disponível.',404);return null;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
 perform public.pull_app_error('INVALID_ARGUMENT','Confira os valores informados.',400);return null;
end;$$;

-- Somente o gateway é chamável pelo cliente; auxiliares não são uma API paralela.
do $$declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'pull_app_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
end;$$;
grant execute on function public.pull_app_request(text,text,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
