-- Google Planilhas por unidade: publicação das bases em uma única transação.
-- Não escreve na planilha nem altera a base MAPAS ou auditorias de devolução.
-- Instalação inicial. Repetir este pacote substituiria funções incrementais.
begin;
do $$begin
 if to_regclass('public.delivery_return_google_sync') is not null then
  raise exception 'DEVOLUCOES_GOOGLE_JA_INSTALADO: use as migracoes incrementais; nao reexecute o SQL 88.';
 end if;
end$$;
create table if not exists public.delivery_return_google_sync (
 unit text primary key references public.units(name),lease_id uuid,lease_actor uuid,
 lease_until timestamptz,last_attempt_at timestamptz,last_synced_at timestamptz,
 sources jsonb not null default '{}',last_error text not null default ''
);
alter table public.delivery_return_google_sync enable row level security;
revoke all on public.delivery_return_google_sync from public,anon,authenticated;
grant select on public.delivery_return_google_sync to authenticated;
drop policy if exists returns_google_read on public.delivery_return_google_sync;
create policy returns_google_read on public.delivery_return_google_sync for select to authenticated
 using(public.returns_can(unit,'RETURNS_VIEW'));

create or replace function public.returns_finish_import(p_id uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare v public.delivery_return_imports%rowtype;n integer;begin
 select * into v from public.delivery_return_imports where id=p_id for update;
 if not found or v.created_by<>auth.uid() or not public.returns_can(v.unit,'RETURNS_IMPORT') then raise exception 'FORBIDDEN';end if;
 if v.status='COMPLETED' then return v.expected_rows;end if;
 select count(*) into n from public.delivery_return_staging where import_id=p_id;
 if n<>v.expected_rows then raise exception 'IMPORT_INCOMPLETE';end if;
 perform pg_advisory_xact_lock(hashtextextended('returns-import:'||v.unit||':'||v.kind,0));
 -- Remove somente linhas da versão anterior desta mesma origem Google.
 -- Importações por arquivo e registros de outras origens/unidades são preservados.
 if v.filename like 'Google Planilhas / %' then
  delete from public.delivery_return_records r using public.delivery_return_imports previous
   where r.import_id=previous.id and r.unit=v.unit and r.kind=v.kind
   and previous.unit=v.unit and previous.filename=v.filename
   and (v.kind='CUSTOMERS' or date_trunc('month',r.operation_date) in
    (select distinct date_trunc('month',(s.data->>'operation_date')::date) from public.delivery_return_staging s where s.import_id=p_id))
   and not exists(select 1 from public.delivery_return_staging s where s.import_id=p_id and s.row_key=r.row_key);
 end if;
 insert into public.delivery_return_records(unit,kind,row_key,operation_date,data,import_id)
 select v.unit,v.kind,row_key,(data->>'operation_date')::date,data,p_id from public.delivery_return_staging where import_id=p_id
 on conflict(unit,kind,row_key) do update set data=excluded.data,operation_date=excluded.operation_date,import_id=p_id,updated_at=now();
 update public.delivery_return_imports set status='COMPLETED',completed_at=now() where id=p_id;
 delete from public.delivery_return_staging where import_id=p_id;return n;
end$$;

create or replace function public.returns_google_sync(p_unit text,p_id uuid,p_action text,p_import_ids uuid[] default '{}',p_result jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.delivery_return_google_sync%rowtype;i uuid;begin
 if not public.returns_can(p_unit,'RETURNS_IMPORT') or not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 if p_id is null or p_action is null or p_action not in ('START','HEARTBEAT','FAIL','COMMIT') or jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>12000 then raise exception 'INVALID_SYNC';end if;
 insert into public.delivery_return_google_sync(unit) values(p_unit) on conflict do nothing;
 select * into v from public.delivery_return_google_sync where unit=p_unit for update;
 if p_action='START' then
  if v.lease_id is not null and v.lease_until>now() and (v.lease_id<>p_id or v.lease_actor<>auth.uid()) then return to_jsonb(v)-'lease_id'-'lease_actor'||jsonb_build_object('acquired',false);end if;
  update public.delivery_return_google_sync set lease_id=p_id,lease_actor=auth.uid(),lease_until=now()+interval '5 minutes',last_attempt_at=now() where unit=p_unit returning * into v;
  return to_jsonb(v)-'lease_id'-'lease_actor'||jsonb_build_object('acquired',true);
 end if;
 if v.lease_id is distinct from p_id or v.lease_actor is distinct from auth.uid() then raise exception 'SYNC_LEASE_CONFLICT';end if;
 if p_action='FAIL' then
  update public.delivery_return_google_sync set lease_id=null,lease_actor=null,lease_until=null,last_error=left(coalesce(p_result->>'error','Atualização interrompida.'),2000),sources=coalesce(p_result->'sources',sources) where unit=p_unit returning * into v;
  return to_jsonb(v)-'lease_id'-'lease_actor';
 end if;
 if v.lease_until<=now() then raise exception 'SYNC_LEASE_EXPIRED';end if;
 if p_action='HEARTBEAT' then
  update public.delivery_return_google_sync set lease_until=now()+interval '5 minutes' where unit=p_unit returning * into v;
  return to_jsonb(v)-'lease_id'-'lease_actor';
 end if;
 if cardinality(p_import_ids)>5 or p_import_ids is null then raise exception 'INVALID_SYNC_IMPORTS';end if;
 if exists(select 1 from unnest(p_import_ids) x where not exists(select 1 from public.delivery_return_imports imp where imp.id=x and imp.unit=p_unit and imp.created_by=auth.uid() and imp.filename like 'Google Planilhas / %')) then raise exception 'INVALID_SYNC_IMPORTS';end if;
 -- Todas as bases ficam visíveis juntas. Qualquer falha reverte todo o grupo.
 for i in select id from public.delivery_return_imports where id=any(p_import_ids) order by kind,id loop perform public.returns_finish_import(i);end loop;
 update public.delivery_return_google_sync set lease_id=null,lease_actor=null,lease_until=null,last_error='',sources=coalesce(p_result->'sources','{}'),
 last_synced_at=case when exists(select 1 from jsonb_each(coalesce(p_result->'sources','{}')) where value->>'state'='OK') then now() else last_synced_at end
 where unit=p_unit returning * into v;
 return to_jsonb(v)-'lease_id'-'lease_actor';
end$$;
revoke all on function public.returns_google_sync(text,uuid,text,uuid[],jsonb) from public,anon;
grant execute on function public.returns_google_sync(text,uuid,text,uuid[],jsonb) to authenticated;

create or replace function public.returns_enrich(p_unit text,p_data jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c jsonb;b jsonb;j jsonb;m jsonb;a jsonb;o jsonb;begin
 select to_jsonb(x) into b from public.customers x where x.code=p_data->>'customer_code'
 and x.branch=case p_unit when 'Matriz Caicó' then 'Caicó' when 'Filial Pau dos Ferros' then 'Pau dos Ferros' else p_unit end limit 1;
 select data into c from public.delivery_return_records where unit=p_unit and kind='CUSTOMERS' and row_key=p_data->>'customer_code';
 select jsonb_build_object('city',max(data->>'city'),'seller',string_agg(distinct nullif(data->>'seller',''),' / ')) into o
 from public.delivery_return_records where unit=p_unit and kind='ORDERS' and operation_date=(p_data->>'operation_date')::date
 and data->>'customer_code'=p_data->>'customer_code' and data->>'map_number'=p_data->>'map_number'
 and (nullif(p_data->>'invoice_number','') is null or data->>'invoice_number'=p_data->>'invoice_number')
 and (nullif(p_data->>'invoice_series','') is null or data->>'invoice_series'=p_data->>'invoice_series');
 select data into j from public.delivery_return_records where unit=p_unit and kind='JOURNEYS' and operation_date=(p_data->>'operation_date')::date and data->>'map_number'=p_data->>'map_number' limit 1;
 if j is null then
  select to_jsonb(x) into m from public.maps x where x.map_number=p_data->>'map_number' and x.map_date=(p_data->>'operation_date')::date
  and exists(select 1 from public.delivery_return_records r where r.unit=p_unit and r.kind in ('REPORT','ORDERS') and r.operation_date=x.map_date and r.data->>'map_number'=x.map_number)
  and not exists(select 1 from public.delivery_return_records r where r.unit<>p_unit and r.kind in ('REPORT','ORDERS') and r.operation_date=x.map_date and r.data->>'map_number'=x.map_number)
  and (select count(*) from public.maps y where y.map_number=x.map_number and y.map_date=x.map_date)=1;j=m;
 end if;
 select data into a from public.delivery_return_cases where unit=p_unit and operation_date=(p_data->>'operation_date')::date and customer_code=p_data->>'customer_code' and map_number=coalesce(p_data->>'map_number','');
 return p_data||jsonb_build_object('customer_name',coalesce(nullif(p_data->>'customer_name',''),nullif(c->>'customer_name',''),b->>'name',''),
 'city',coalesce(nullif(o->>'city',''),nullif(c->>'city',''),b->>'city',''),'branch',coalesce(nullif(c->>'branch',''),b->>'branch',p_unit),'seller',coalesce(nullif(o->>'seller',''),c->>'seller',''),
 'driver',coalesce(j->>'driver',''),'helper1',coalesce(j->>'helper1',''),'helper2',coalesce(j->>'helper2',''),
 'is_drop',case when jsonb_typeof(a->'is_drop')='boolean' then a->'is_drop' else j->'is_drop' end);
end$$;
revoke all on function public.returns_enrich(text,jsonb) from public,anon,authenticated;

create or replace function public.returns_snapshot(p_unit text,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;n integer;begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'INVALID_PERIOD';end if;
 select count(*) into n from public.delivery_return_records where unit=p_unit and kind='REPORT' and operation_date between least(p_from,p_to-29) and p_to;
 if n>15000 or (select count(*) from public.delivery_return_cases where unit=p_unit and operation_date between p_from and p_to)>15000 then raise exception 'REDUCE_PERIOD';end if;
 select jsonb_build_object(
 'reports',coalesce((select jsonb_agg(public.returns_enrich(p_unit,r.data)||jsonb_build_object('driver_treatment',coalesce(a.data->>'driver_treatment','')) order by r.operation_date desc,r.row_key)
 from public.delivery_return_records r left join public.delivery_return_cases a on a.unit=r.unit and a.operation_date=r.operation_date and a.customer_code=r.data->>'customer_code' and a.map_number=r.data->>'map_number'
 where r.unit=p_unit and r.kind='REPORT' and r.operation_date between least(p_from,p_to-29) and p_to),'[]'::jsonb),
 'cases',coalesce((select jsonb_agg(data||to_jsonb(c)-'data' order by updated_at desc) from public.delivery_return_cases c where unit=p_unit and operation_date between p_from and p_to),'[]'::jsonb),
 'routes',coalesce((select jsonb_agg(data order by operation_date) from public.delivery_return_records where unit=p_unit and kind='ROUTES' and operation_date between p_from and p_to),'[]'::jsonb),
 'goals',coalesce((select jsonb_agg(to_jsonb(g)) from public.delivery_return_goals g where unit=p_unit and month between date_trunc('month',p_from)::date and p_to),'[]'::jsonb),
 'imports',coalesce((select jsonb_agg(to_jsonb(i)) from(select * from public.delivery_return_imports where unit=p_unit and status='COMPLETED' order by completed_at desc limit 20)i),'[]'::jsonb),
 'google',(select to_jsonb(s)-'lease_id'-'lease_actor' from public.delivery_return_google_sync s where unit=p_unit),
 'at',now()) into result;return result;
end$$;
notify pgrst,'reload schema';
commit;
