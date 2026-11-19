-- Horário de pedidos obrigatório para todos os perfis, inclusive Admin.
-- Papel do solicitante congelado para o ranking de vendedores (RN/GV).
begin;
alter table public.order_requests add column requester_role text;
update public.order_requests r set requester_role=p.role from public.profiles p where p.id=r.created_by;
create or replace function public.orders_settings(p_unit text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v jsonb;begin
 if not(public.orders_can(p_unit,'ORDERS_CONFIG') or public.orders_can(p_unit,'ORDERS_CREATE') or public.orders_can(p_unit,'ORDERS_OWN')
 or public.orders_can(p_unit,'ORDERS_REVIEW') or public.orders_can(p_unit,'ORDERS_MANAGE') or public.orders_can(p_unit,'ORDERS_VIEW_ALL')
 or public.orders_can(p_unit,'ORDERS_DASHBOARD') or public.orders_can(p_unit,'ORDERS_AUDIT')) then raise exception 'FORBIDDEN';end if;
 select to_jsonb(s) into v from public.order_request_settings s where unit=p_unit;
 return coalesce(v,jsonb_build_object('unit',p_unit,'revision',0,'restricted_hours',true,'morning_start',510,'morning_end',690,
 'afternoon_start',840,'afternoon_end',960,'route_sla',30,'bypass_sla',2880)) || jsonb_build_object('server_now',statement_timestamp());
end$$;

create or replace function public.orders_create(p_unit text,p_operation uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare payload jsonb:=jsonb_build_object('op','CREATE','unit',p_unit,'data',p_data);prior public.order_request_operations%rowtype;
 v public.order_requests%rowtype;s jsonb;kind text;v_code text;name text;city text:='';days integer[];d date;minute integer;today date;actor text;actor_role text;
begin
 if not public.orders_can(p_unit,'ORDERS_CREATE') then raise exception 'FORBIDDEN';end if;
 if p_operation is null then raise exception 'INVALID_OPERATION';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_operation::text,0));
 select * into prior from public.order_request_operations where actor_id=auth.uid() and operation_id=p_operation;
 if found then if prior.payload<>payload then raise exception 'OPERATION_CONFLICT';end if;return prior.result;end if;
 s:=public.orders_settings(p_unit);kind:=p_data->>'kind';v_code:=btrim(p_data->>'customer_code');
 today:=(now() at time zone 'America/Sao_Paulo')::date;
 minute:=extract(hour from now() at time zone 'America/Sao_Paulo')::int*60+extract(minute from now() at time zone 'America/Sao_Paulo')::int;
 if (s->>'restricted_hours')::boolean
 and not(minute between (s->>'morning_start')::int and (s->>'morning_end')::int or minute between (s->>'afternoon_start')::int and (s->>'afternoon_end')::int)
 then raise exception 'OUTSIDE_REQUEST_WINDOW';end if;
 if kind is null or kind not in ('FORA_ROTA','BIPASSE','CLIENTE_NOVO') or coalesce(v_code,'')='' then raise exception 'INVALID_REQUEST';end if;
 if kind='CLIENTE_NOVO' then name:=btrim(p_data->>'customer_name');else
 select c.name,c.city into name,city from public.customers c where c.code=v_code and c.branch=case p_unit when 'Matriz Caicó' then 'Caicó' when 'Filial Pau dos Ferros' then 'Pau dos Ferros' else p_unit end limit 1;
 if not found then raise exception 'CUSTOMER_NOT_FOUND';end if;end if;
 if coalesce(name,'')='' or coalesce(btrim(p_data->>'reason'),'')='' or coalesce(btrim(p_data->>'notes'),'')='' then raise exception 'INVALID_REQUEST';end if;
 if kind='BIPASSE' then
 if jsonb_typeof(p_data->'weekdays') is distinct from 'array' then raise exception 'INVALID_WEEKDAYS';end if;
 select array_agg(distinct value::int order by value::int) into days from jsonb_array_elements_text(p_data->'weekdays');
 if coalesce(cardinality(days),0)=0 or not days<@array[1,2,3,4,5] then raise exception 'INVALID_WEEKDAYS';end if;
 else days:='{}';d:=(p_data->>'desired_date')::date;if d is null or d<today then raise exception 'INVALID_DATE';end if;end if;
 select pr.name,pr.role into actor,actor_role from public.profiles pr where pr.id=auth.uid();
 insert into public.order_requests(unit,kind,customer_code,customer_name,city,desired_date,weekdays,reason,notes,created_by,created_by_name,requester_role,sla_minutes)
 values(p_unit,kind,v_code,name,coalesce(city,''),d,days,btrim(p_data->>'reason'),btrim(p_data->>'notes'),auth.uid(),actor,actor_role,
 case when kind='BIPASSE' then (s->>'bypass_sla')::int else (s->>'route_sla')::int end) returning * into v;
 insert into public.order_request_audit(request_id,unit,event,actor_id,actor_name,next) values(v.id,p_unit,'CREATED',auth.uid(),actor,to_jsonb(v));
 insert into public.order_request_operations values(auth.uid(),p_operation,payload,to_jsonb(v));return to_jsonb(v);
end$$;
revoke all on function public.orders_settings(text),public.orders_create(text,uuid,jsonb) from public,anon;
grant execute on function public.orders_settings(text),public.orders_create(text,uuid,jsonb) to authenticated;
commit;
