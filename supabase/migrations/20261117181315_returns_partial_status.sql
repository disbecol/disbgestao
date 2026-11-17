-- Habilita devolução parcial, mantendo autoria, histórico, revisão e permissões.
begin;
do $$begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='public.returns_save_case(uuid,text,integer,uuid,jsonb)'::regprocedure)<>'6ae569448a3d8b927f17ae9c01d0c911' then raise exception 'RETURNS_SOURCE_CHANGED';end if;
end$$;
alter table public.delivery_return_cases drop constraint delivery_return_cases_status_check;
alter table public.delivery_return_cases add constraint delivery_return_cases_status_check check(status in ('AGUARDANDO_REPASSE','DEVOLVIDO','PARCIAL','REVERTIDO'));
create or replace function public.returns_save_case(p_id uuid,p_unit text,p_revision integer,p_operation uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare old public.delivery_return_cases%rowtype;v public.delivery_return_cases%rowtype;op public.delivery_return_operations%rowtype;
 clean jsonb;payload jsonb;actor text;begin
 if not public.returns_can(p_unit,'RETURNS_EDIT') or not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 if p_id is null or p_operation is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>20000 then raise exception 'INVALID_CASE';end if;
 payload=jsonb_build_object('id',p_id,'revision',p_revision,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended('returns-operation:'||p_operation,0));
 select * into op from public.delivery_return_operations where id=p_operation;
 if found then
  if op.unit<>p_unit or op.actor_id<>auth.uid() or op.payload<>payload then raise exception 'OPERATION_CONFLICT';end if;return op.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('returns-case:'||p_id,0));
 select * into old from public.delivery_return_cases where id=p_id for update;
 if found and old.unit<>p_unit then raise exception 'FORBIDDEN';end if;
 if p_revision is null or (old.id is null and p_revision<>0) or (old.id is not null and p_revision<>old.revision) then raise exception 'RETURN_VERSION_CONFLICT';end if;
 if coalesce(p_data->>'operation_date','')!~'^\d{4}-\d{2}-\d{2}$' or (p_data->>'operation_date')::date not between date '2000-01-01' and date '2200-12-31'
 or length(btrim(coalesce(p_data->>'customer_code',''))) not between 1 and 40 or length(coalesce(p_data->>'map_number',''))>40
 or length(btrim(coalesce(p_data->>'driver_reason',''))) not between 1 and 200
 or coalesce(p_data->>'status','') not in ('AGUARDANDO_REPASSE','DEVOLVIDO','PARCIAL','REVERTIDO') then raise exception 'INVALID_CASE';end if;
 if p_data->>'order_amount_cents' is not null and (p_data->>'order_amount_cents'!~'^\d+$' or (p_data->>'order_amount_cents')::numeric>1e13) then raise exception 'INVALID_AMOUNT';end if;
 select coalesce(jsonb_object_agg(k,case when jsonb_typeof(p_data->k)='string' then to_jsonb(btrim(p_data->>k)) else p_data->k end),'{}') into clean
 from unnest(array['customer_name','city','branch','seller','driver','helper1','helper2','order_amount_cents','driver_reason','driver_treatment','client_reason','client_statement','is_drop'])k;
 if exists(select 1 from jsonb_each(clean) where jsonb_typeof(value)='string' and length(value#>>'{}')>2000) then raise exception 'TEXT_TOO_LONG';end if;
 if clean->>'is_drop' is not null and clean->>'is_drop' not in ('true','false') then raise exception 'INVALID_DROP';end if;
 select name into actor from public.profiles where id=auth.uid();
 if old.id is null then
 insert into public.delivery_return_cases(id,unit,operation_date,customer_code,map_number,data,status,created_by,updated_by,updated_by_name)
 values(p_id,p_unit,(p_data->>'operation_date')::date,btrim(p_data->>'customer_code'),btrim(coalesce(p_data->>'map_number','')),clean,p_data->>'status',auth.uid(),auth.uid(),actor) returning * into v;
 else
 update public.delivery_return_cases set operation_date=(p_data->>'operation_date')::date,customer_code=btrim(p_data->>'customer_code'),map_number=btrim(coalesce(p_data->>'map_number','')),
 data=clean,status=p_data->>'status',revision=revision+1,updated_by=auth.uid(),updated_by_name=actor,updated_at=now() where id=p_id returning * into v;
 end if;
 insert into public.delivery_return_audit(case_id,unit,actor_id,actor_name,previous,next) values(p_id,p_unit,auth.uid(),actor,case when old.id is null then null else to_jsonb(old) end,to_jsonb(v));
 clean=v.data||to_jsonb(v)-'data';
 insert into public.delivery_return_operations values(p_operation,auth.uid(),p_unit,payload,clean);return clean;
end$$;
revoke all on function public.returns_save_case(uuid,text,integer,uuid,jsonb) from public,anon;
grant execute on function public.returns_save_case(uuid,text,integer,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
