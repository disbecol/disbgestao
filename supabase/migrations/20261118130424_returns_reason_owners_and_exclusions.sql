-- Catálogo por código; motivos sem responsável e descartes não penalizam o cliente.
begin;
create table public.delivery_return_reason_owners (
 unit text not null references public.units(name),reason_key text not null,reason_code text not null default '',
 description text not null check(length(description) between 1 and 300),
 responsible text not null default 'SEM_RESPONSAVEL' check(responsible in ('MERCADO','LOGISTICA','VENDAS','SEM_RESPONSAVEL')),
 revision integer not null default 1,updated_by uuid references public.profiles(id),updated_by_name text not null default 'Sistema',updated_at timestamptz not null default now(),primary key(unit,reason_key)
);
create table public.delivery_return_reason_audit (
 id bigint generated always as identity primary key,unit text not null references public.units(name),reason_key text not null,
 actor_id uuid not null references public.profiles(id),actor_name text not null,previous jsonb,next jsonb not null,created_at timestamptz not null default now()
);
create index delivery_return_reason_audit_history on public.delivery_return_reason_audit(unit,reason_key,created_at desc);
create table public.delivery_return_exclusions (
 id uuid primary key default gen_random_uuid(),unit text not null references public.units(name),operation_date date not null,
 customer_code text not null,map_number text not null,
 justification text not null check(length(btrim(justification)) between 1 and 2000),
 created_by uuid not null references public.profiles(id),created_by_name text not null,created_at timestamptz not null default now(),
 unique(unit,operation_date,customer_code,map_number)
);
alter table public.delivery_return_penalties add column eligible_occurrence_count integer;
alter table public.delivery_return_penalties add column eligibility_note text not null default '';
do $$declare t text;begin
 foreach t in array array['delivery_return_reason_owners','delivery_return_reason_audit','delivery_return_exclusions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy returns_reason_read on public.%I for select to authenticated using(public.returns_can(unit,''RETURNS_VIEW''))',t);
 end loop;
end$$;
create function disb_private.return_reason_label_key(p_label text) returns text
language sql immutable set search_path='' as $$
 select case key when 'cliente canelou' then 'cliente cancelou' when 'c pedidos duplicados' then 'pedido duplicado'
 when 'pedidos duplicados' then 'pedido duplicado' when 'pdv fechado' then 'pdv fechado horario com'
 when 'pdv fechado horario comercial' then 'pdv fechado horario com' when 'sem dinheiro' then 'sem dinheiro cheque'
 when 'produto quantidade errada' then 'produto qtde errada' when 'forma de pagamento' then 'forma pagamento errada'
 when 'forma pagamento' then 'forma pagamento errada' when 'forma de pagamento errada' then 'forma pagamento errada' else key end
 from (select btrim(regexp_replace(translate(lower(coalesce(p_label,'')),'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn'),'[^a-z0-9]+',' ','g')) key)s
$$;
create function disb_private.seed_return_reasons(p_unit text) returns void
language sql set search_path=public as $$
 insert into public.delivery_return_reason_owners(unit,reason_key,reason_code,description,responsible)
 select p_unit,'C:'||code,code,label,owner from (values
 ('23','(C) Pedidos duplicados','MERCADO'),('34','Pedido Duplicado','MERCADO'),('37','PDV Fechado','MERCADO'),
 ('38','Sem Dinheiro','MERCADO'),('39','Cliente Cancelou.','MERCADO'),('40','Horário de Entrega','MERCADO'),
 ('41','Sem Vasilhame.','MERCADO'),('42','Produto/Quantidade Errada','MERCADO'),('43','Forma de Pagamento','MERCADO'),
 ('50','CARGA ERRADA ARMAZEM','LOGISTICA'),('52','FALTA PRODUTO ESTOQUE','LOGISTICA'),('53','PROD PROXIMO VENCIM. COMERCIAL','LOGISTICA'),
 ('55','QUALIDADE DO PRODUTO','LOGISTICA'),('60','PREÇO ERRADO','VENDAS'),('61','PRAZO ERRADO','VENDAS'),
 ('62','FORMA PAGAMENTO ERRADA','MERCADO'),('63','PRODUTO / QTDE. ERRADA','MERCADO'),('64','SEM VASILHAME','MERCADO'),
 ('65','NÃO FEZ PEDIDO','MERCADO'),('68','TROCA (SEM SELO / QTDE. ERRADA)','VENDAS'),('70','CLIENTE CANCELOU','MERCADO'),
 ('71','SEM DINHEIRO/CHEQUE','MERCADO'),('72','PDV FECHADO (HORÁRIO COM.)','MERCADO'),('73','FALTA DE ATIVOS DE GIRO','MERCADO'),
 ('74','LOCAL ARMAZENAGEM INADEQUADO','MERCADO'),('76','Produto Proximo ao Vencimento','LOGISTICA'),('80','CAMINHÃO QUEBRADO / ACIDENTE','LOGISTICA'),
 ('81','PRODUTO DANIFICADO / FALTA','LOGISTICA'),('82','ENDEREÇO NÃO ENCONTRADO','LOGISTICA'),('83','PROPRIETÁRIO AUSENTE','MERCADO'),
 ('85','DIFÍCIL ACESSO','LOGISTICA'),('86','HORARIO DE ENTREGA','MERCADO'),('87','TEMPO INSUFICIENTE','LOGISTICA'),
 ('89','PDV FECHADO APÓS HORÁRIO','MERCADO'),('92','CAMINHÃO ASSALTADO','LOGISTICA'),('93','DEVOLUÇÃO DE COMODATO','VENDAS'),
 ('99','SUPERVISOR','LOGISTICA'),('45','Tempo Insuficiente.','LOGISTICA'),('33','Nao Fez Pedido','VENDAS'),
 ('58','Carga Errada','LOGISTICA'),('88','Refugo de vasilhame','MERCADO')) defaults(code,label,owner)
 on conflict(unit,reason_key) do nothing
$$;
create function disb_private.return_reason_key(p_unit text,p_code text,p_label text) returns text
language plpgsql stable set search_path=public as $$declare code text=btrim(coalesce(p_code,''));key text=disb_private.return_reason_label_key(p_label);found_key text;begin
 if code~'^[0-9]+$' then return 'C:'||coalesce(nullif(ltrim(code,'0'),''),'0');end if;
 if key='' then return 'T:nao informado';end if;
 if exists(select 1 from public.delivery_return_reason_owners where unit=p_unit and reason_key='T:'||key) then return 'T:'||key;end if;
 select case when count(distinct responsible)=1 then min(reason_key) else null end into found_key
 from public.delivery_return_reason_owners where unit=p_unit and disb_private.return_reason_label_key(description)=key;
 return coalesce(found_key,'T:'||key);
end$$;
create function disb_private.return_reason_parts(p_unit text,p_data jsonb) returns jsonb
language plpgsql stable set search_path=public as $$declare data jsonb=p_data;part jsonb;parts jsonb;result jsonb='[]';code text;label text;key text;owner text;source jsonb;part_index integer=0;begin
 -- Bases congeladas de versões anteriores não guardavam o código. Recupera a nota exata.
 if nullif(data->>'reason_code','') is null and nullif(data->>'invoice_number','') is not null then
  select r.data into source from public.delivery_return_records r where r.unit=p_unit and r.kind='REPORT'
  and r.operation_date=(data->>'operation_date')::date and r.data->>'customer_code'=data->>'customer_code'
  and r.data->>'map_number'=data->>'map_number' and r.data->>'invoice_number'=data->>'invoice_number'
  and coalesce(r.data->>'invoice_series','')=coalesce(data->>'invoice_series','') order by r.row_key limit 1;
  if source is not null then data=source;end if;
 end if;
 parts=case when jsonb_typeof(data->'reasons')='array' and jsonb_array_length(data->'reasons')>0 then data->'reasons' else jsonb_build_array(data) end;
 for part in select value from jsonb_array_elements(parts) loop
  part_index=part_index+1;
  label=coalesce(nullif(btrim(part->>'reason'),''),'Não informado');code=part->>'reason_code';
  if nullif(code,'') is null and (jsonb_array_length(parts)=1 or part_index=1) then code=data->>'reason_code';end if;
  key=disb_private.return_reason_key(p_unit,code,label);
  select responsible into owner from public.delivery_return_reason_owners where unit=p_unit and reason_key=key;
  result=result||jsonb_build_array(jsonb_build_object('reason_code',coalesce(code,''),'reason',label,'reason_key',key,'responsible',coalesce(owner,'SEM_RESPONSAVEL')));
 end loop;return result;
end$$;
create function disb_private.discover_return_reasons(p_unit text) returns void
language plpgsql set search_path=public as $$declare r record;part jsonb;begin
 perform disb_private.seed_return_reasons(p_unit);
 for r in select data from public.delivery_return_records where unit=p_unit and kind='REPORT'
  union all select jsonb_build_object('reason',data->>'driver_reason') from public.delivery_return_cases where unit=p_unit and nullif(btrim(data->>'driver_reason'),'') is not null loop
  for part in select value from jsonb_array_elements(disb_private.return_reason_parts(p_unit,r.data)) loop
   insert into public.delivery_return_reason_owners(unit,reason_key,reason_code,description)
   values(p_unit,part->>'reason_key',coalesce(part->>'reason_code',''),left(part->>'reason',300)) on conflict(unit,reason_key) do nothing;
  end loop;
 end loop;
end$$;
create function disb_private.return_reason_owners(p_unit text,p_data jsonb) returns jsonb
language sql stable set search_path=public as $$select coalesce(jsonb_agg(distinct part->>'responsible'),'[]') from jsonb_array_elements(disb_private.return_reason_parts(p_unit,p_data)) part$$;
create function disb_private.return_penalty_eligible(p_unit text,p_data jsonb) returns boolean
language sql stable set search_path=public as $$select
 not exists(select 1 from public.delivery_return_exclusions x where x.unit=p_unit and x.operation_date=(p_data->>'operation_date')::date and x.customer_code=p_data->>'customer_code' and x.map_number=p_data->>'map_number')
 and exists(select 1 from jsonb_array_elements(disb_private.return_reason_parts(p_unit,p_data)) part where part->>'responsible'='MERCADO')$$;

create or replace function disb_private.refresh_return_penalties(p_unit text default null) returns integer
language plpgsql security definer set search_path=public as $$
declare u text;item record;old public.delivery_return_penalties%rowtype;rules jsonb;days integer;enriched jsonb;
 d date=(now() at time zone 'America/Sao_Paulo')::date;changed integer=0;begin
 -- Uma só ordem de locks para o agendador e as ações de todos os usuários.
 for u in select name from public.units where active and (p_unit is null or name=p_unit) order by name loop
  perform pg_advisory_xact_lock(hashtextextended('returns-penalties:'||u,0));
  perform disb_private.discover_return_reasons(u);
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
     'reason',data->>'reason','reason_code',data->>'reason_code','reasons',data->'reasons','responsibles',disb_private.return_reason_owners(u,data)) order by operation_date desc,row_key) basis
   from public.delivery_return_records where unit=u and kind='REPORT' and operation_date between d-60 and d
    and coalesce(data->>'customer_code','')<>'' and disb_private.return_penalty_eligible(u,data) group by data->>'customer_code'
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
   where r.unit=u and r.kind='REPORT' and r.operation_date between d-60 and d and r.data->>'customer_code'=p.customer_code and disb_private.return_penalty_eligible(u,r.data));

  -- Revê a elegibilidade da base congelada sem depender do envelhecimento da janela.
  for old in select * from public.delivery_return_penalties where unit=u and status in ('BLOQUEADO','LIBERAR') for update loop
   select count(distinct (b->>'operation_date',b->>'map_number'))::integer into days from jsonb_array_elements(old.basis) b where disb_private.return_penalty_eligible(u,b);
   if old.eligible_occurrence_count is distinct from days or (days<2 and old.status='BLOQUEADO') then
    update public.delivery_return_penalties set eligible_occurrence_count=days,
     status=case when days<2 then 'LIBERAR' else status end,
     release_at=case when days<2 then greatest(blocked_at+interval '1 microsecond',least(release_at,now())) else release_at end,
     eligibility_note=case when days<2 then 'Menos de duas ocorrências válidas de Mercado após classificação ou descarte.' else '' end,
     revision=revision+1,updated_by=null,updated_by_name='Sistema',updated_at=now() where id=old.id;
   end if;
  end loop;
 end loop;return changed;
end$$;

do $$declare body text;needle text='revision=revision+1,updated_by=auth.uid(),updated_by_name=actor,updated_at=now() where id=p_id';begin
 body=pg_get_functiondef('public.returns_set_penalty_status(text,uuid,integer,uuid,text)'::regprocedure);
 if strpos(body,needle)=0 then raise exception 'PENALTY_SETTER_SOURCE_CHANGED';end if;
 execute replace(body,needle,'eligible_occurrence_count=case when p_status=''BLOQUEADO'' then occurrence_count else eligible_occurrence_count end,'||needle);
end$$;

create function public.returns_reason_catalog(p_unit text) returns jsonb
language plpgsql security definer set search_path=public as $$begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('returns-penalties:'||p_unit,0));perform disb_private.discover_return_reasons(p_unit);
 return coalesce((select jsonb_agg(to_jsonb(r) order by case responsible when 'SEM_RESPONSAVEL' then 0 else 1 end,description,reason_code) from public.delivery_return_reason_owners r where unit=p_unit),'[]');
end$$;
create function public.returns_set_reason_owner(p_unit text,p_key text,p_revision integer,p_owner text,p_operation uuid) returns jsonb
language plpgsql security definer set search_path=public as $$declare old public.delivery_return_reason_owners%rowtype;v public.delivery_return_reason_owners%rowtype;op public.delivery_return_operations%rowtype;payload jsonb;actor text;begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') or not public.returns_can(p_unit,'RETURNS_EDIT') then raise exception 'FORBIDDEN';end if;
 if p_owner is null or p_owner not in ('MERCADO','LOGISTICA','VENDAS','SEM_RESPONSAVEL') or p_operation is null or p_revision is null then raise exception 'INVALID_REASON_OWNER';end if;
 payload=jsonb_build_object('kind','REASON_OWNER','key',p_key,'revision',p_revision,'owner',p_owner);
 perform pg_advisory_xact_lock(hashtextextended('returns-penalties:'||p_unit,0));perform pg_advisory_xact_lock(hashtextextended('returns-operation:'||p_operation,0));
 select * into op from public.delivery_return_operations where id=p_operation;
 if found then if op.unit<>p_unit or op.actor_id<>auth.uid() or op.payload<>payload then raise exception 'OPERATION_CONFLICT';end if;return op.result;end if;
 select * into old from public.delivery_return_reason_owners where unit=p_unit and reason_key=p_key for update;
 if old.unit is null then raise exception 'REASON_NOT_FOUND';end if;
 if old.revision<>p_revision then raise exception 'REASON_VERSION_CONFLICT';end if;
 select name into actor from public.profiles where id=auth.uid();
 update public.delivery_return_reason_owners set responsible=p_owner,revision=revision+1,updated_by=auth.uid(),updated_by_name=actor,updated_at=now()
 where unit=p_unit and reason_key=p_key returning * into v;
 insert into public.delivery_return_reason_audit(unit,reason_key,actor_id,actor_name,previous,next) values(p_unit,p_key,auth.uid(),actor,to_jsonb(old),to_jsonb(v));
 perform disb_private.refresh_return_penalties(p_unit);insert into public.delivery_return_operations values(p_operation,auth.uid(),p_unit,payload,to_jsonb(v));return to_jsonb(v);
end$$;
create function public.returns_discard_occurrence(p_unit text,p_date date,p_customer text,p_map text,p_justification text,p_operation uuid) returns jsonb
language plpgsql security definer set search_path=public as $$declare v public.delivery_return_exclusions%rowtype;op public.delivery_return_operations%rowtype;payload jsonb;actor text;begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') or not public.returns_can(p_unit,'RETURNS_EDIT') then raise exception 'FORBIDDEN';end if;
 if p_date is null or p_operation is null or length(btrim(coalesce(p_justification,''))) not between 1 and 2000 then raise exception 'JUSTIFICATION_REQUIRED';end if;
 payload=jsonb_build_object('kind','RETURN_EXCLUSION','date',p_date,'customer',p_customer,'map',p_map,'justification',btrim(p_justification));
 perform pg_advisory_xact_lock(hashtextextended('returns-penalties:'||p_unit,0));perform pg_advisory_xact_lock(hashtextextended('returns-operation:'||p_operation,0));
 select * into op from public.delivery_return_operations where id=p_operation;
 if found then if op.unit<>p_unit or op.actor_id<>auth.uid() or op.payload<>payload then raise exception 'OPERATION_CONFLICT';end if;return op.result;end if;
 if not exists(select 1 from public.delivery_return_records r where r.unit=p_unit and r.kind='REPORT' and r.operation_date=p_date and r.data->>'customer_code'=p_customer and r.data->>'map_number'=p_map)
 and not exists(select 1 from public.delivery_return_penalties p cross join lateral jsonb_array_elements(p.basis) b where p.unit=p_unit and p.customer_code=p_customer and (b->>'operation_date')::date=p_date and b->>'map_number'=p_map) then raise exception 'OCCURRENCE_NOT_FOUND';end if;
 select name into actor from public.profiles where id=auth.uid();
 insert into public.delivery_return_exclusions(unit,operation_date,customer_code,map_number,justification,created_by,created_by_name)
 values(p_unit,p_date,p_customer,p_map,btrim(p_justification),auth.uid(),actor) on conflict(unit,operation_date,customer_code,map_number) do nothing;
 select * into v from public.delivery_return_exclusions where unit=p_unit and operation_date=p_date and customer_code=p_customer and map_number=p_map;
 perform disb_private.refresh_return_penalties(p_unit);insert into public.delivery_return_operations values(p_operation,auth.uid(),p_unit,payload,to_jsonb(v));return to_jsonb(v);
end$$;
create function public.returns_customer_occurrences(p_unit text,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$declare p public.delivery_return_penalties%rowtype;rows jsonb;begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 select * into p from public.delivery_return_penalties where id=p_id and unit=p_unit;if not found then raise exception 'FORBIDDEN';end if;
 perform disb_private.discover_return_reasons(p_unit);
 select coalesce(jsonb_agg(r.data||jsonb_build_object('responsibles',disb_private.return_reason_owners(p_unit,r.data),'penalty_eligible',disb_private.return_penalty_eligible(p_unit,r.data),'exclusion',(select to_jsonb(x) from public.delivery_return_exclusions x where x.unit=p_unit and x.operation_date=r.operation_date and x.customer_code=p.customer_code and x.map_number=r.data->>'map_number')) order by r.operation_date desc,r.row_key),'[]') into rows
 from public.delivery_return_records r where r.unit=p_unit and r.kind='REPORT' and r.operation_date between p.window_from and p.window_to and r.data->>'customer_code'=p.customer_code;
 if jsonb_array_length(rows)=0 then select coalesce(jsonb_agg(b||jsonb_build_object('responsibles',disb_private.return_reason_owners(p_unit,b),'penalty_eligible',disb_private.return_penalty_eligible(p_unit,b),'exclusion',(select to_jsonb(x) from public.delivery_return_exclusions x where x.unit=p_unit and x.operation_date=(b->>'operation_date')::date and x.customer_code=p.customer_code and x.map_number=b->>'map_number'))),'[]') into rows from jsonb_array_elements(p.basis)b;end if;
 return jsonb_build_object('penalty',to_jsonb(p),'rows',rows);
end$$;
-- Mantém a consulta anterior íntegra e acrescenta o catálogo à resposta.
do $$declare body text;begin
 body=pg_get_functiondef('public.returns_snapshot(text,date,date)'::regprocedure);
 execute replace(body,'public.returns_snapshot(','disb_private.returns_snapshot_before_reasons(');
end$$;
create or replace function public.returns_snapshot(p_unit text,p_from date,p_to date) returns jsonb
language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 result=disb_private.returns_snapshot_before_reasons(p_unit,p_from,p_to);
 return result||jsonb_build_object('reason_catalog',public.returns_reason_catalog(p_unit));
end$$;
create or replace function public.returns_penalty_snapshot(p_unit text) returns jsonb
language plpgsql security definer set search_path=public as $$declare d date=(now() at time zone 'America/Sao_Paulo')::date;begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 perform disb_private.refresh_return_penalties(p_unit);
 return jsonb_build_object('penalties',coalesce((select jsonb_agg(to_jsonb(p) order by case status when 'LIBERAR' then 0 when 'BLOQUEAR' then 1 when 'BLOQUEADO' then 2 else 3 end,release_at,customer_name)
 from public.delivery_return_penalties p where unit=p_unit and (status<>'BLOQUEAR' or occurrence_count>=2)),'[]'),
 'penalty_rules',public.returns_penalty_rules(p_unit),'reason_catalog',public.returns_reason_catalog(p_unit),'window_from',d-60,'window_to',d,'at',now());
end$$;
revoke all on all functions in schema disb_private from public,anon,authenticated;
revoke all on function public.returns_reason_catalog(text),public.returns_set_reason_owner(text,text,integer,text,uuid),public.returns_discard_occurrence(text,date,text,text,text,uuid),public.returns_customer_occurrences(text,uuid) from public,anon;
grant execute on function public.returns_reason_catalog(text),public.returns_set_reason_owner(text,text,integer,text,uuid),public.returns_discard_occurrence(text,date,text,text,text,uuid),public.returns_customer_occurrences(text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
