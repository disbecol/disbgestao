-- Reincidência: uma ocorrência = unidade + cliente + mapa + dia, em 60 dias corridos.
-- Apenas monitora a confirmação manual do bloqueio no sistema comercial.
begin;
create schema if not exists disb_private;
revoke all on schema disb_private from public,anon,authenticated;

create table public.delivery_return_penalty_settings (
 unit text primary key references public.units(name),
 rules jsonb not null,
 revision integer not null default 1,
 updated_by uuid references public.profiles(id),updated_by_name text not null,
 updated_at timestamptz not null default now()
);
create table public.delivery_return_penalties (
 id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),
 customer_code text not null check(length(customer_code) between 1 and 40),
 customer_name text not null,city text not null default '',seller text not null default '',
 status text not null default 'BLOQUEAR' check(status in ('BLOQUEAR','BLOQUEADO','LIBERAR','LIBERADO')),
 occurrence_count integer not null check(occurrence_count>=0),penalty_days integer check(penalty_days between 1 and 3650),
 window_from date not null,window_to date not null,basis jsonb not null default '[]',
 blocked_at timestamptz,release_at timestamptz,released_at timestamptz,
 revision integer not null default 1,updated_by uuid references public.profiles(id),
 updated_by_name text not null default 'Sistema',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(unit,customer_code),
 check(window_to-window_from=60),
 check(status='BLOQUEAR' or (occurrence_count>=2 and penalty_days is not null and blocked_at is not null and release_at>blocked_at)),
 check((status='LIBERADO')=(released_at is not null))
);
create index delivery_return_penalties_due on public.delivery_return_penalties(release_at) where status='BLOQUEADO';
create table public.delivery_return_penalty_audit (
 id bigint generated always as identity primary key,
 penalty_id uuid references public.delivery_return_penalties(id),unit text not null references public.units(name),
 event text not null,actor_id uuid references public.profiles(id),actor_name text not null,
 previous jsonb,next jsonb not null,created_at timestamptz not null default now()
);
create index delivery_return_penalty_audit_history on public.delivery_return_penalty_audit(unit,penalty_id,created_at desc);
do $$declare t text;begin
 foreach t in array array['delivery_return_penalty_settings','delivery_return_penalties','delivery_return_penalty_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy returns_penalty_read on public.%I for select to authenticated using(public.returns_can(unit,''RETURNS_VIEW''))',t);
 end loop;
end$$;

create function disb_private.return_penalty_defaults() returns jsonb
language sql immutable set search_path=public as $$select '{"2":7,"3":10,"4":20,"5":30,"6":35,"7":40}'::jsonb$$;
create function disb_private.crew_key(p_name text) returns text
language sql immutable set search_path='' as $$select regexp_replace(translate(lower(btrim(coalesce(p_name,''))),'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn'),'\s+',' ','g')$$;
create function disb_private.resolve_return_crew(p_unit text,p_data jsonb,p_crew jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare crew jsonb=coalesce(p_crew,'{}');ref jsonb;chosen text;candidates text[];remaining text[];field text;begin
 foreach field in array array['driver','helper1','helper2'] loop
  if disb_private.crew_key(crew->>field) in ('','0','-','na','n/a','#n/a','nao informado','sem motorista') then crew=jsonb_set(crew,array[field],'""');end if;
 end loop;
 if nullif(crew->>'driver','') is not null then return crew;end if;
 -- MAPAS é apenas consultada. Data exata, mapa único e vínculo inequívoco à unidade.
 select to_jsonb(m) into ref from public.maps m where m.map_number=p_data->>'map_number' and m.map_date=(p_data->>'operation_date')::date
  and (select count(*) from public.maps x where x.map_number=m.map_number and x.map_date=m.map_date)=1
  and exists(select 1 from public.delivery_return_records r where r.unit=p_unit and r.kind in ('REPORT','ORDERS') and r.operation_date=m.map_date and r.data->>'map_number'=m.map_number)
  and not exists(select 1 from public.delivery_return_records r where r.unit<>p_unit and r.kind in ('REPORT','ORDERS') and r.operation_date=m.map_date and r.data->>'map_number'=m.map_number);
 if disb_private.crew_key(ref->>'driver') not in ('','0','-','na','n/a','#n/a','nao informado','sem motorista') then
  select array_agg(label order by position) into remaining from (
   select (array_agg(name order by position))[1] label,min(position) position
   from unnest(array[crew->>'helper1',crew->>'helper2',ref->>'helper1',ref->>'helper2']) with ordinality names(name,position)
   where disb_private.crew_key(name) not in ('','0','-','na','n/a','#n/a','nao informado','sem motorista',disb_private.crew_key(ref->>'driver'))
   group by disb_private.crew_key(name)) unique_helpers;
  return crew||jsonb_build_object('driver',ref->>'driver','helper1',coalesce(remaining[1],''),'helper2',coalesce(remaining[2],''));
 end if;
 -- Só move um ajudante quando o nome identifica inequivocamente um motorista conhecido.
 select array_agg(distinct name) into candidates from unnest(array[crew->>'helper1',crew->>'helper2']) names(name)
 where nullif(name,'') is not null and (
  exists(select 1 from public.drivers d where disb_private.crew_key(d.name)=disb_private.crew_key(names.name))
  or exists(select 1 from public.delivery_return_records j where j.unit=p_unit and j.kind='JOURNEYS' and disb_private.crew_key(j.data->>'driver')=disb_private.crew_key(names.name)));
 if cardinality(candidates)=1 then
  chosen=candidates[1];select array_agg(name order by position) into remaining from unnest(array[crew->>'helper1',crew->>'helper2']) with ordinality names(name,position)
   where nullif(name,'') is not null and disb_private.crew_key(name)<>disb_private.crew_key(chosen);
  crew=crew||jsonb_build_object('driver',chosen,'helper1',coalesce(remaining[1],''),'helper2',coalesce(remaining[2],''));
 end if;return crew;
end$$;
do $$declare body text;needle text=' return p_data||jsonb_build_object(';begin
 body=pg_get_functiondef('public.returns_enrich(text,jsonb)'::regprocedure);
 if strpos(body,needle)=0 then raise exception 'RETURNS_ENRICH_SOURCE_CHANGED';end if;
 execute replace(body,needle,E' j=disb_private.resolve_return_crew(p_unit,p_data,j);\n'||needle);
end$$;
create function disb_private.log_return_penalty() returns trigger
language plpgsql set search_path=public as $$begin
 if TG_OP='INSERT' or new.status is distinct from old.status then
  insert into public.delivery_return_penalty_audit(penalty_id,unit,event,actor_id,actor_name,previous,next)
  values(new.id,new.unit,new.status,new.updated_by,new.updated_by_name,case when TG_OP='INSERT' then null else to_jsonb(old) end,to_jsonb(new));
 end if;return new;
end$$;
create trigger return_penalty_history after insert or update on public.delivery_return_penalties
for each row execute function disb_private.log_return_penalty();

create function disb_private.refresh_return_penalties(p_unit text default null) returns integer
language plpgsql security definer set search_path=public as $$
declare u text;item record;old public.delivery_return_penalties%rowtype;rules jsonb;days integer;enriched jsonb;
 d date=(now() at time zone 'America/Sao_Paulo')::date;changed integer=0;begin
 -- Uma só ordem de locks para o agendador e as ações de todos os usuários.
 for u in select name from public.units where active and (p_unit is null or name=p_unit) order by name loop
  perform pg_advisory_xact_lock(hashtextextended('returns-penalties:'||u,0));
  update public.delivery_return_penalties set status='LIBERAR',revision=revision+1,updated_by=null,updated_by_name='Sistema',updated_at=now()
  where unit=u and status='BLOQUEADO' and release_at<=now();
  select coalesce((select s.rules from public.delivery_return_penalty_settings s where s.unit=u),disb_private.return_penalty_defaults()) into rules;
  -- A base fiscal permanece intacta. Notas são somadas, ocorrências são distintas por mapa/dia.
  for item in
   select data->>'customer_code' code,count(distinct (operation_date,data->>'map_number'))::integer occurrences,
    max(operation_date) last_date,
    (array_agg(data order by operation_date desc,row_key desc))[1] latest,
    jsonb_agg(jsonb_build_object('operation_date',operation_date,'customer_code',data->>'customer_code',
     'customer_name',data->>'customer_name','map_number',data->>'map_number','invoice_number',data->>'invoice_number',
     'invoice_series',data->>'invoice_series','amount_cents',data->'amount_cents','volume_hl',data->'volume_hl',
     'reason',data->>'reason','reasons',data->'reasons') order by operation_date desc,row_key) basis
   from public.delivery_return_records where unit=u and kind='REPORT' and operation_date between d-60 and d
    and coalesce(data->>'customer_code','')<>'' group by data->>'customer_code'
  loop
   select * into old from public.delivery_return_penalties where unit=u and customer_code=item.code for update;
   if old.id is null and item.occurrences<2 then continue;end if;
   if old.status in ('BLOQUEADO','LIBERAR') then continue;end if;
   if old.status='LIBERADO' and (item.occurrences<2 or item.last_date<=(old.released_at at time zone 'America/Sao_Paulo')::date) then continue;end if;
   days=case when item.occurrences>=2 then (rules->>least(item.occurrences,7)::text)::integer else null end;
   enriched=public.returns_enrich(u,item.latest);
   if old.id is null then
    insert into public.delivery_return_penalties(unit,customer_code,customer_name,city,seller,occurrence_count,penalty_days,window_from,window_to,basis)
    values(u,item.code,coalesce(enriched->>'customer_name',item.code),coalesce(enriched->>'city',''),coalesce(enriched->>'seller',''),item.occurrences,days,d-60,d,item.basis);
    changed=changed+1;
   elsif old.status='LIBERADO' or (old.occurrence_count,old.penalty_days,old.window_to,old.basis) is distinct from (item.occurrences,days,d,item.basis) then
    update public.delivery_return_penalties set status='BLOQUEAR',customer_name=coalesce(enriched->>'customer_name',item.code),city=coalesce(enriched->>'city',''),seller=coalesce(enriched->>'seller',''),
     occurrence_count=item.occurrences,penalty_days=days,window_from=d-60,window_to=d,basis=item.basis,
     blocked_at=null,release_at=null,released_at=null,revision=revision+1,updated_by=null,updated_by_name='Sistema',updated_at=now() where id=old.id;
    changed=changed+1;
   end if;
  end loop;
  update public.delivery_return_penalties p set occurrence_count=0,penalty_days=null,basis='[]',window_from=d-60,window_to=d,
   revision=revision+1,updated_by=null,updated_by_name='Sistema',updated_at=now()
  where p.unit=u and p.status='BLOQUEAR' and p.occurrence_count<>0 and not exists(select 1 from public.delivery_return_records r
   where r.unit=u and r.kind='REPORT' and r.operation_date between d-60 and d and r.data->>'customer_code'=p.customer_code);
 end loop;return changed;
end$$;

create function public.returns_penalty_rules(p_unit text) returns jsonb
language plpgsql stable security definer set search_path=public as $$declare result jsonb;begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 select to_jsonb(s) into result from public.delivery_return_penalty_settings s where unit=p_unit;
 return coalesce(result,jsonb_build_object('unit',p_unit,'rules',disb_private.return_penalty_defaults(),'revision',0));
end$$;
create function public.returns_save_penalty_rules(p_unit text,p_revision integer,p_rules jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$declare old public.delivery_return_penalty_settings%rowtype;v public.delivery_return_penalty_settings%rowtype;actor text;begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') or not public.returns_can(p_unit,'RETURNS_EDIT') then raise exception 'FORBIDDEN';end if;
 if jsonb_typeof(p_rules) is distinct from 'object' or p_revision is null or octet_length(p_rules::text)>2000 then raise exception 'INVALID_PENALTY_RULES';end if;
 if (select count(*) from jsonb_each(p_rules))<>6 or exists(select 1 from jsonb_each(p_rules) where key not in ('2','3','4','5','6','7')
  or jsonb_typeof(value)<>'number' or (value#>>'{}')!~'^[1-9][0-9]{0,3}$' or (value#>>'{}')::numeric>3650) then raise exception 'INVALID_PENALTY_RULES';end if;
 perform pg_advisory_xact_lock(hashtextextended('returns-penalties:'||p_unit,0));
 select * into old from public.delivery_return_penalty_settings where unit=p_unit for update;
 if (old.unit is null and p_revision<>0) or (old.unit is not null and p_revision<>old.revision) then raise exception 'PENALTY_VERSION_CONFLICT';end if;
 select name into actor from public.profiles where id=auth.uid();
 insert into public.delivery_return_penalty_settings(unit,rules,updated_by,updated_by_name) values(p_unit,p_rules,auth.uid(),actor)
 on conflict(unit) do update set rules=excluded.rules,revision=delivery_return_penalty_settings.revision+1,updated_by=auth.uid(),updated_by_name=actor,updated_at=now() returning * into v;
 insert into public.delivery_return_penalty_audit(unit,event,actor_id,actor_name,previous,next)
 values(p_unit,'REGRAS',auth.uid(),actor,case when old.unit is null then null else to_jsonb(old) end,to_jsonb(v));
 perform disb_private.refresh_return_penalties(p_unit);return to_jsonb(v);
end$$;

create function public.returns_penalty_snapshot(p_unit text) returns jsonb
language plpgsql security definer set search_path=public as $$declare d date=(now() at time zone 'America/Sao_Paulo')::date;begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 perform disb_private.refresh_return_penalties(p_unit);
 return jsonb_build_object('penalties',coalesce((select jsonb_agg(to_jsonb(p) order by case status when 'LIBERAR' then 0 when 'BLOQUEAR' then 1 when 'BLOQUEADO' then 2 else 3 end,release_at,customer_name)
  from public.delivery_return_penalties p where unit=p_unit and (status<>'BLOQUEAR' or occurrence_count>=2)),'[]'::jsonb),
  'penalty_rules',public.returns_penalty_rules(p_unit),'window_from',d-60,'window_to',d,'at',now());
end$$;
create function public.returns_set_penalty_status(p_unit text,p_id uuid,p_revision integer,p_operation uuid,p_status text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare old public.delivery_return_penalties%rowtype;v public.delivery_return_penalties%rowtype;op public.delivery_return_operations%rowtype;payload jsonb;actor text;begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') or not public.returns_can(p_unit,'RETURNS_EDIT') then raise exception 'FORBIDDEN';end if;
 if p_id is null or p_operation is null or p_revision is null or p_status is null or p_status not in ('BLOQUEADO','LIBERADO') then raise exception 'INVALID_PENALTY_TRANSITION';end if;
 payload=jsonb_build_object('kind','PENALTY','id',p_id,'revision',p_revision,'status',p_status);
 perform pg_advisory_xact_lock(hashtextextended('returns-penalties:'||p_unit,0));
 perform pg_advisory_xact_lock(hashtextextended('returns-operation:'||p_operation,0));
 select * into op from public.delivery_return_operations where id=p_operation;
 if found then
  if op.unit<>p_unit or op.actor_id<>auth.uid() or op.payload<>payload then raise exception 'OPERATION_CONFLICT';end if;return op.result;
 end if;
 perform disb_private.refresh_return_penalties(p_unit);
 select * into old from public.delivery_return_penalties where id=p_id for update;
 if old.id is null or old.unit<>p_unit then raise exception 'FORBIDDEN';end if;
 if old.revision<>p_revision then raise exception 'PENALTY_VERSION_CONFLICT';end if;
 if not ((old.status='BLOQUEAR' and p_status='BLOQUEADO' and old.occurrence_count>=2 and old.penalty_days is not null)
  or (old.status='LIBERAR' and p_status='LIBERADO')) then raise exception 'INVALID_PENALTY_TRANSITION';end if;
 select name into actor from public.profiles where id=auth.uid();
 update public.delivery_return_penalties set status=p_status,
  blocked_at=case when p_status='BLOQUEADO' then now() else blocked_at end,
  release_at=case when p_status='BLOQUEADO' then now()+make_interval(days=>penalty_days) else release_at end,
  released_at=case when p_status='LIBERADO' then now() else null end,
  revision=revision+1,updated_by=auth.uid(),updated_by_name=actor,updated_at=now() where id=p_id returning * into v;
 insert into public.delivery_return_operations values(p_operation,auth.uid(),p_unit,payload,to_jsonb(v));return to_jsonb(v);
end$$;

revoke all on all functions in schema disb_private from public,anon,authenticated;
revoke all on function public.returns_penalty_rules(text),public.returns_save_penalty_rules(text,integer,jsonb),
 public.returns_penalty_snapshot(text),public.returns_set_penalty_status(text,uuid,integer,uuid,text) from public,anon;
grant execute on function public.returns_penalty_rules(text),public.returns_save_penalty_rules(text,integer,jsonb),
 public.returns_penalty_snapshot(text),public.returns_set_penalty_status(text,uuid,integer,uuid,text) to authenticated;
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.delivery_return_penalties;
 end if;
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('refresh-return-penalties','*/5 * * * *','select disb_private.refresh_return_penalties();');
 end if;
end$$;
notify pgrst,'reload schema';
commit;
