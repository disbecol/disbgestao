-- Evita vincular uma contagem FEFO offline a uma unidade diferente da solicitada.
-- Executar depois da migracao 36_security_unit_scope.sql.

begin;

create or replace function public.offline_sync_fefo_start(
  p_operation_id uuid,
  p_unit text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_result jsonb;
  v_open public.fefo_counts%rowtype;
  v_unit text := btrim(coalesce(p_unit,''));
begin
  if p_operation_id is null then
    raise exception 'OFFLINE_OPERATION_ID_OBRIGATORIO';
  end if;
  if not public.has_permission('FEFO_CREATE') then
    raise exception 'FORBIDDEN';
  end if;
  perform public.assert_user_unit(v_unit);

  -- Serializa tentativas do mesmo usuario, mesmo com operation_id diferente.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));

  select result into v_result
  from public.offline_sync_receipts
  where operation_id=p_operation_id and user_id=auth.uid();
  if found then return v_result; end if;

  select * into v_open
  from public.fefo_counts
  where counter_id=auth.uid() and status='IN_PROGRESS'
  order by started_at desc
  limit 1;

  if v_open.id is not null then
    if v_open.unit <> v_unit then
      raise exception 'FEFO_CONTAGEM_EM_OUTRA_UNIDADE:%',v_open.unit;
    end if;
    v_result := to_jsonb(v_open);
  else
    select to_jsonb(x) into v_result
    from public.start_fefo_count(v_unit) x;
  end if;

  insert into public.offline_sync_receipts(operation_id,user_id,operation_type,result)
  values(p_operation_id,auth.uid(),'FEFO_START',v_result);

  return v_result;
end;
$$;

grant execute on function public.offline_sync_fefo_start(uuid,text) to authenticated;

commit;
