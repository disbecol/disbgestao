-- Prioridades diárias cadastradas manualmente pelo gerente.
begin;

create table if not exists public.delivery_return_priorities (
 id uuid primary key,unit text not null references public.units(name),
 priority_date date not null,customer_code text not null check(length(customer_code) between 1 and 40),
 data jsonb not null default '{}'::jsonb,
 revision integer not null default 1 check(revision>0),created_by uuid not null references public.profiles(id),
 updated_by uuid not null references public.profiles(id),updated_by_name text not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(unit,priority_date,customer_code)
);
create index if not exists delivery_return_priorities_date
 on public.delivery_return_priorities(unit,priority_date desc);

create table if not exists public.delivery_return_priorities_audit (
 id bigint generated always as identity primary key,
 priority_id uuid not null references public.delivery_return_priorities(id),
 unit text not null,actor_id uuid not null references public.profiles(id),actor_name text not null,
 previous jsonb,next jsonb not null,created_at timestamptz not null default now()
);
create table if not exists public.delivery_return_priorities_operations (
 id uuid primary key,actor_id uuid not null,unit text not null,payload jsonb not null,result jsonb not null
);

do $$declare t text;begin
 foreach t in array array['delivery_return_priorities','delivery_return_priorities_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('drop policy if exists returns_priorities_read on public.%I',t);
  execute format('create policy returns_priorities_read on public.%I for select to authenticated using(public.returns_can(unit,''RETURNS_VIEW''))',t);
 end loop;
 alter table public.delivery_return_priorities_operations enable row level security;
 revoke all on public.delivery_return_priorities_operations from anon,authenticated;
end$$;

create or replace function public.returns_priority_snapshot(p_unit text,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;record_count integer;
begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'INVALID_PERIOD';end if;
 select count(*) into record_count from public.delivery_return_priorities
 where unit=p_unit and priority_date between p_from and p_to;
 if record_count>15000 then raise exception 'REDUCE_PERIOD';end if;
 select coalesce(jsonb_agg((to_jsonb(p)-'data')||p.data
  order by p.priority_date desc,p.updated_at desc),'[]'::jsonb)
 into result from public.delivery_return_priorities p
 where p.unit=p_unit and p.priority_date between p_from and p_to;
 return jsonb_build_object('priorities',result,'at',now());
end$$;

create or replace function public.returns_priority_lookup(p_unit text,p_date date,p_customer text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 if p_date is null or length(btrim(coalesce(p_customer,''))) not between 1 and 40 then
  raise exception 'INVALID_PRIORITY_LOOKUP';end if;
 select (to_jsonb(p)-'data')||p.data into result
 from public.delivery_return_priorities p
 where p.unit=p_unit and p.priority_date=p_date and p.customer_code=btrim(p_customer);
 return result;
end$$;

create or replace function public.returns_save_priority(
 p_id uuid,p_unit text,p_revision integer,p_operation uuid,p_data jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare old public.delivery_return_priorities%rowtype;v public.delivery_return_priorities%rowtype;
 op public.delivery_return_priorities_operations%rowtype;clean jsonb;payload jsonb;actor text;result jsonb;
begin
 if not public.returns_can(p_unit,'RETURNS_EDIT') or not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 if p_id is null or p_operation is null or p_revision is null or p_revision<0
  or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>16000 then raise exception 'INVALID_PRIORITY';end if;
 if coalesce(p_data->>'priority_date','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_PRIORITY';end if;
 if exists(select 1 from jsonb_each(p_data) where key in
  ('priority_date','customer_code','customer_name','city','seller','visit_day','reason')
  and jsonb_typeof(value) is distinct from 'string') then raise exception 'INVALID_PRIORITY';end if;
 if (p_data->>'priority_date')::date not between date '2000-01-01' and date '2200-12-31'
  or length(btrim(coalesce(p_data->>'customer_code',''))) not between 1 and 40
  or length(btrim(coalesce(p_data->>'customer_name',''))) not between 1 and 300
  or length(btrim(coalesce(p_data->>'city',''))) not between 1 and 200
  or length(btrim(coalesce(p_data->>'seller',''))) not between 1 and 200
  or length(btrim(coalesce(p_data->>'visit_day',''))) not between 1 and 40
  or length(btrim(coalesce(p_data->>'reason',''))) not between 1 and 2000
  or jsonb_typeof(p_data->'off_route') is distinct from 'boolean'
  or jsonb_typeof(p_data->'focus_client') is distinct from 'boolean'
  or not (p_data ? 'order_amount_cents')
  or jsonb_typeof(p_data->'order_amount_cents') not in ('number','null') then raise exception 'INVALID_PRIORITY';end if;
 if jsonb_typeof(p_data->'order_amount_cents')='number'
  and ((p_data->>'order_amount_cents')!~'^\d{1,13}$'
   or (p_data->>'order_amount_cents')::numeric>10000000000000) then raise exception 'INVALID_PRIORITY';end if;

 clean=jsonb_build_object(
  'customer_name',btrim(p_data->>'customer_name'),'city',btrim(p_data->>'city'),
  'seller',btrim(p_data->>'seller'),'order_amount_cents',p_data->'order_amount_cents',
  'visit_day',btrim(p_data->>'visit_day'),'off_route',(p_data->>'off_route')::boolean,
  'focus_client',(p_data->>'focus_client')::boolean,'reason',btrim(p_data->>'reason')
 );
 payload=jsonb_build_object('id',p_id,'revision',p_revision,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended('returns-priority-operation:'||p_operation,0));
 select * into op from public.delivery_return_priorities_operations where id=p_operation;
 if found then
  if op.unit<>p_unit or op.actor_id<>auth.uid() or op.payload<>payload then raise exception 'PRIORITY_OPERATION_CONFLICT';end if;
  return op.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('returns-priority:'||p_id,0));
 select * into old from public.delivery_return_priorities where id=p_id for update;
 if found and old.unit<>p_unit then raise exception 'FORBIDDEN';end if;
 if (old.id is null and p_revision<>0) or (old.id is not null and p_revision<>old.revision)
 then raise exception 'PRIORITY_VERSION_CONFLICT';end if;
 select name into actor from public.profiles where id=auth.uid();
 if old.id is null then
  insert into public.delivery_return_priorities(id,unit,priority_date,customer_code,data,created_by,updated_by,updated_by_name)
  values(p_id,p_unit,(p_data->>'priority_date')::date,btrim(p_data->>'customer_code'),clean,auth.uid(),auth.uid(),actor)
  returning * into v;
 else
  update public.delivery_return_priorities set priority_date=(p_data->>'priority_date')::date,
   customer_code=btrim(p_data->>'customer_code'),data=clean,revision=revision+1,
   updated_by=auth.uid(),updated_by_name=actor,updated_at=now()
  where id=p_id returning * into v;
 end if;
 insert into public.delivery_return_priorities_audit(priority_id,unit,actor_id,actor_name,previous,next)
 values(p_id,p_unit,auth.uid(),actor,case when old.id is null then null else to_jsonb(old) end,to_jsonb(v));
 result=(to_jsonb(v)-'data')||v.data;
 insert into public.delivery_return_priorities_operations values(p_operation,auth.uid(),p_unit,payload,result);
 return result;
end$$;

revoke all on function public.returns_priority_snapshot(text,date,date),
 public.returns_priority_lookup(text,date,text),
 public.returns_save_priority(uuid,text,integer,uuid,jsonb) from public,anon;
grant execute on function public.returns_priority_snapshot(text,date,date),
 public.returns_priority_lookup(text,date,text),
 public.returns_save_priority(uuid,text,integer,uuid,jsonb) to authenticated;

do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
  and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
   and schemaname='public' and tablename='delivery_return_priorities') then
  alter publication supabase_realtime add table public.delivery_return_priorities;
 end if;
end$$;

notify pgrst,'reload schema';
commit;
