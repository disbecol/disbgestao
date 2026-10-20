-- O APK anterior consulta esta RPC para decidir se pode avancar uma etapa.
-- Quando o checklist esta desligado, devolvemos nenhuma exigencia para que
-- esses aparelhos liberem as etapas apos atualizar os dados da viagem.
-- A rotina interna preserva a sequencia para registros antigos na fila offline.
begin;

create or replace function public.pull_checklist_requirements_all(p_trip_id uuid)
returns table(checkpoint_code text,checklist_type text,driver_no smallint,after_action text,gate_action text,sort_order integer)
language sql stable security definer set search_path=public as $$
  select v.checkpoint_code,v.checklist_type,v.driver_no::smallint,v.after_action,v.gate_action,v.sort_order
  from public.pull_trips t
  cross join lateral (values
    ('D1_START','DEPARTURE',1,'START_TRIP','ARRIVE_SUPPORT_OUT',10,
      t.cycle_type='PULL' and t.week_trip_type='FIRST' and not t.solo_trip),
    ('D1_SUPPORT_OUT','RETURN',1,'ARRIVE_SUPPORT_OUT','DRIVER_SWAP_OUT',20,
      t.cycle_type='PULL' and t.week_trip_type is not null and not t.solo_trip),
    ('D2_SUPPORT_OUT','DEPARTURE',2,
      case when t.checklist_flow_version>=2 then 'ARRIVE_SUPPORT_OUT' else 'DRIVER_SWAP_OUT' end,
      case when t.checklist_flow_version>=2 then 'DRIVER_SWAP_OUT' else 'ARRIVE_FACTORY' end,30,
      t.cycle_type='PULL' and t.week_trip_type is not null and not t.solo_trip),
    ('D2_SUPPORT_RETURN','RETURN',2,'ARRIVE_SUPPORT_RETURN','DRIVER_SWAP_RETURN',40,
      t.cycle_type='PULL' and t.week_trip_type is not null and not t.solo_trip),
    ('D1_SUPPORT_RETURN','DEPARTURE',1,
      case when t.checklist_flow_version>=2 then 'ARRIVE_SUPPORT_RETURN' else 'DRIVER_SWAP_RETURN' end,
      case when t.checklist_flow_version>=2 then 'DRIVER_SWAP_RETURN' else 'ARRIVE_UNIT' end,50,
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

revoke all on function public.pull_checklist_requirements_all(uuid) from public,anon,authenticated;

create or replace function public.pull_checklist_requirements(p_trip_id uuid)
returns table(checkpoint_code text,checklist_type text,driver_no smallint,after_action text,gate_action text,sort_order integer)
language sql stable security definer set search_path=public as $$
  select r.checkpoint_code,r.checklist_type,r.driver_no,r.after_action,r.gate_action,r.sort_order
  from public.pull_checklist_requirements_all(p_trip_id) r
  where coalesce((select s.checklist_enabled from public.pull_settings s where s.singleton=true),true);
$$;

revoke all on function public.pull_checklist_requirements(uuid) from public,anon;
grant execute on function public.pull_checklist_requirements(uuid) to authenticated;

-- O checklist ja preenchido no aparelho antes da desativacao ainda pode estar
-- na fila offline. Valida-lo pela sequencia original evita perder esse registro.
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
  select * into v_req from public.pull_checklist_requirements_all(p_trip_id)
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

-- A assinatura sem KM continua inacessivel aos clientes (regra da migracao 65).
revoke execute on function public.submit_pull_checklist(
  uuid,text,jsonb,double precision,double precision,double precision,timestamptz
) from public,anon,authenticated;

commit;
