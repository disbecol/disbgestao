-- Ocorrencias da Puxada registradas no aparelho e enviadas uma vez quando o sinal voltar.
begin;

create or replace function public.offline_sync_pull_occurrence_start(
  p_operation_id uuid,p_trip_id uuid,p_step_id uuid,
  p_latitude double precision,p_longitude double precision,p_accuracy double precision,
  p_note text,p_device_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; v_row public.pull_occurrences%rowtype; v_trip public.pull_trips%rowtype;
  v_at timestamptz:=coalesce(p_device_at,now());
begin
  if p_operation_id is null then raise exception 'OFFLINE_OPERATION_ID_OBRIGATORIO'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select result into v_result from public.offline_sync_receipts
    where operation_id=p_operation_id and user_id=auth.uid();
  if found then return v_result; end if;
  select * into v_trip from public.pull_trips where id=p_trip_id;
  if v_trip.id is null or v_at<v_trip.started_at or v_at>now()+interval '5 minutes' then
    raise exception 'HORARIO_OCORRENCIA_INVALIDO'; end if;
  v_row:=public.start_pull_occurrence(p_trip_id,p_step_id,p_latitude,p_longitude,p_accuracy,p_note);
  update public.pull_occurrences set started_at=v_at,
    ended_at=case when duration_mode='POINT' then v_at else ended_at end
    where id=v_row.id returning * into v_row;
  v_result:=to_jsonb(v_row);
  insert into public.offline_sync_receipts(operation_id,user_id,operation_type,result)
    values(p_operation_id,auth.uid(),'PULL_OCC_START',v_result);
  return v_result;
end;$$;
revoke all on function public.offline_sync_pull_occurrence_start(uuid,uuid,uuid,double precision,double precision,double precision,text,timestamptz) from public,anon;
grant execute on function public.offline_sync_pull_occurrence_start(uuid,uuid,uuid,double precision,double precision,double precision,text,timestamptz) to authenticated;

create or replace function public.offline_sync_pull_occurrence_end(
  p_operation_id uuid,p_occurrence_id uuid,
  p_latitude double precision,p_longitude double precision,p_accuracy double precision,
  p_device_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; v_row public.pull_occurrences%rowtype; v_at timestamptz:=coalesce(p_device_at,now());
begin
  if p_operation_id is null then raise exception 'OFFLINE_OPERATION_ID_OBRIGATORIO'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select result into v_result from public.offline_sync_receipts
    where operation_id=p_operation_id and user_id=auth.uid();
  if found then return v_result; end if;
  select * into v_row from public.pull_occurrences where id=p_occurrence_id;
  if v_row.id is null or v_at<v_row.started_at or v_at>now()+interval '5 minutes' then
    raise exception 'HORARIO_OCORRENCIA_INVALIDO'; end if;
  v_row:=public.end_pull_occurrence(p_occurrence_id,p_latitude,p_longitude,p_accuracy);
  update public.pull_occurrences set ended_at=v_at where id=v_row.id returning * into v_row;
  v_result:=to_jsonb(v_row);
  insert into public.offline_sync_receipts(operation_id,user_id,operation_type,result)
    values(p_operation_id,auth.uid(),'PULL_OCC_END',v_result);
  return v_result;
end;$$;
revoke all on function public.offline_sync_pull_occurrence_end(uuid,uuid,double precision,double precision,double precision,timestamptz) from public,anon;
grant execute on function public.offline_sync_pull_occurrence_end(uuid,uuid,double precision,double precision,double precision,timestamptz) to authenticated;

commit;
