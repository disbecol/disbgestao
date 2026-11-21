-- Registros antecipados de devolução informados pelo motorista, separados da auditoria real.
begin;

create table if not exists public.delivery_return_monitoring (
 id uuid primary key,unit text not null references public.units(name),
 operation_date date not null,customer_code text not null check(length(customer_code) between 1 and 40),
 map_number text not null default '' check(length(map_number)<=40),data jsonb not null default '{}'::jsonb,
 revision integer not null default 1 check(revision>0),created_by uuid not null references public.profiles(id),
 updated_by uuid not null references public.profiles(id),updated_by_name text not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(unit,operation_date,customer_code,map_number)
);
create index if not exists delivery_return_monitoring_date
 on public.delivery_return_monitoring(unit,operation_date desc);

create table if not exists public.delivery_return_monitoring_audit (
 id bigint generated always as identity primary key,
 monitoring_id uuid not null references public.delivery_return_monitoring(id),
 unit text not null,actor_id uuid not null references public.profiles(id),actor_name text not null,
 previous jsonb,next jsonb not null,created_at timestamptz not null default now()
);
create table if not exists public.delivery_return_monitoring_operations (
 id uuid primary key,actor_id uuid not null,unit text not null,payload jsonb not null,result jsonb not null
);

do $$declare t text;begin
 foreach t in array array['delivery_return_monitoring','delivery_return_monitoring_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('drop policy if exists returns_monitoring_read on public.%I',t);
  execute format('create policy returns_monitoring_read on public.%I for select to authenticated using(public.returns_can(unit,''RETURNS_VIEW''))',t);
 end loop;
 alter table public.delivery_return_monitoring_operations enable row level security;
 revoke all on public.delivery_return_monitoring_operations from anon,authenticated;
end$$;

create or replace function public.returns_monitoring_snapshot(p_unit text,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;record_count integer;
begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'INVALID_PERIOD';end if;
 select count(*) into record_count from public.delivery_return_monitoring
 where unit=p_unit and operation_date between p_from and p_to;
 if record_count>15000 then raise exception 'REDUCE_PERIOD';end if;
 select coalesce(jsonb_agg(
  (to_jsonb(m)-'data')||m.data||jsonb_build_object('found_in_report',exists(
   select 1 from public.delivery_return_records r
   where r.unit=m.unit and r.kind='REPORT' and r.operation_date=m.operation_date
    and r.data->>'customer_code'=m.customer_code and r.data->>'map_number'=m.map_number
  )) order by m.operation_date desc,m.updated_at desc),'[]'::jsonb)
 into result from public.delivery_return_monitoring m
 where m.unit=p_unit and m.operation_date between p_from and p_to;
 return jsonb_build_object('monitoring',result,'at',now());
end$$;

create or replace function public.returns_save_monitoring(
 p_id uuid,p_unit text,p_revision integer,p_operation uuid,p_data jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare old public.delivery_return_monitoring%rowtype;v public.delivery_return_monitoring%rowtype;
 op public.delivery_return_monitoring_operations%rowtype;clean jsonb;payload jsonb;actor text;result jsonb;
begin
 if not public.returns_can(p_unit,'RETURNS_EDIT') or not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 if p_id is null or p_operation is null or p_revision is null
  or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>16000 then raise exception 'INVALID_MONITORING';end if;
 if coalesce(p_data->>'operation_date','')!~'^\d{4}-\d{2}-\d{2}$'
  or (p_data->>'operation_date')::date not between date '2000-01-01' and date '2200-12-31'
  or length(btrim(coalesce(p_data->>'customer_code',''))) not between 1 and 40
  or length(coalesce(p_data->>'map_number',''))>40
  or coalesce(p_data->>'branch','') not in ('MATRIZ','FILIAL')
  or length(btrim(coalesce(p_data->>'driver_reason',''))) not between 1 and 200 then raise exception 'INVALID_MONITORING';end if;
 if exists(select 1 from jsonb_each(p_data) where key in
  ('customer_name','city','seller','driver','driver_reason','driver_treatment')
  and jsonb_typeof(value) not in ('string','null')) then raise exception 'INVALID_MONITORING';end if;
 if length(coalesce(p_data->>'customer_name',''))>300 or length(coalesce(p_data->>'city',''))>200
  or length(coalesce(p_data->>'seller',''))>200 or length(coalesce(p_data->>'driver',''))>200
  or length(coalesce(p_data->>'driver_reason',''))>200 or length(coalesce(p_data->>'driver_treatment',''))>2000 then
  raise exception 'INVALID_MONITORING';end if;

 clean=jsonb_build_object(
  'branch',p_data->>'branch','customer_name',btrim(coalesce(p_data->>'customer_name','')),
  'city',btrim(coalesce(p_data->>'city','')),'seller',btrim(coalesce(p_data->>'seller','')),
  'driver',btrim(coalesce(p_data->>'driver','')),'driver_reason',btrim(p_data->>'driver_reason'),
  'driver_treatment',btrim(coalesce(p_data->>'driver_treatment',''))
 );
 payload=jsonb_build_object('id',p_id,'revision',p_revision,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended('returns-monitoring-operation:'||p_operation,0));
 select * into op from public.delivery_return_monitoring_operations where id=p_operation;
 if found then
  if op.unit<>p_unit or op.actor_id<>auth.uid() or op.payload<>payload then raise exception 'MONITORING_OPERATION_CONFLICT';end if;
  return op.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('returns-monitoring:'||p_id,0));
 select * into old from public.delivery_return_monitoring where id=p_id for update;
 if found and old.unit<>p_unit then raise exception 'FORBIDDEN';end if;
 if (old.id is null and p_revision<>0) or (old.id is not null and p_revision<>old.revision)
 then raise exception 'MONITORING_VERSION_CONFLICT';end if;
 select name into actor from public.profiles where id=auth.uid();
 if old.id is null then
  insert into public.delivery_return_monitoring(id,unit,operation_date,customer_code,map_number,data,created_by,updated_by,updated_by_name)
  values(p_id,p_unit,(p_data->>'operation_date')::date,btrim(p_data->>'customer_code'),
   btrim(coalesce(p_data->>'map_number','')),clean,auth.uid(),auth.uid(),actor) returning * into v;
 else
  update public.delivery_return_monitoring set operation_date=(p_data->>'operation_date')::date,
   customer_code=btrim(p_data->>'customer_code'),map_number=btrim(coalesce(p_data->>'map_number','')),
   data=clean,revision=revision+1,updated_by=auth.uid(),updated_by_name=actor,updated_at=now()
  where id=p_id returning * into v;
 end if;
 insert into public.delivery_return_monitoring_audit(monitoring_id,unit,actor_id,actor_name,previous,next)
 values(p_id,p_unit,auth.uid(),actor,case when old.id is null then null else to_jsonb(old) end,to_jsonb(v));
 result=(to_jsonb(v)-'data')||v.data;
 insert into public.delivery_return_monitoring_operations values(p_operation,auth.uid(),p_unit,payload,result);
 return result;
end$$;

revoke all on function public.returns_monitoring_snapshot(text,date,date),
 public.returns_save_monitoring(uuid,text,integer,uuid,jsonb) from public,anon;
grant execute on function public.returns_monitoring_snapshot(text,date,date),
 public.returns_save_monitoring(uuid,text,integer,uuid,jsonb) to authenticated;

do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
  and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
   and schemaname='public' and tablename='delivery_return_monitoring') then
  alter publication supabase_realtime add table public.delivery_return_monitoring;
 end if;
end$$;

notify pgrst,'reload schema';
commit;
