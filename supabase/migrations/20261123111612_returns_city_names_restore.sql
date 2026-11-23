-- Restaura nomes de cidade na leitura, sem alterar bases ou auditorias.
-- Recupera tambem a data de cadastro para a analise de clientes novos.
begin;
do $$begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='public.returns_enrich(text,jsonb)'::regprocedure)
 not in ('caf0561be283797dabbed09e6c9e6d72','3916a8ec83dc204cbcb11f4dac42f256','03ddfa9c3471f2d1b1bca8c9b2737e82') then
  raise exception 'RETURNS_CITY_SOURCE_CHANGED: revise a funcao atual antes de aplicar esta correcao.';
 end if;
end$$;
create or replace function public.returns_city_value(p_values text[]) returns text
language sql immutable set search_path='' as $$
 select coalesce((select btrim(value) from unnest(p_values) with ordinality input(value,position)
  where nullif(btrim(value),'') is not null and value~'[[:alpha:]]'
   and btrim(value)!~*'^[a-z]{2}[- ]?[0-9]{4,}$' order by position limit 1),'');
$$;
revoke all on function public.returns_city_value(text[]) from public,anon,authenticated;
create or replace function public.returns_enrich(p_unit text,p_data jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c jsonb;b jsonb;j jsonb;m jsonb;a jsonb;o jsonb;city_name text;city_code text;begin
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
 city_name=public.returns_city_value(array[o->>'city',c->>'city',b->>'city',p_data->>'city']);
 if city_name='' then
  select btrim(value) into city_code from unnest(array[o->>'city',c->>'city',b->>'city',p_data->>'city']) with ordinality input(value,position)
   where btrim(value)~*'^([a-z]{2}[- ]?[0-9]{4,}|[0-9]+)$' order by position limit 1;
  -- Somente uma associação inequívoca entre o código importado e nomes do
  -- cadastro da mesma unidade pode completar um PDV ainda não cadastrado.
  if city_code is not null then
   select case when count(distinct translate(lower(btrim(x.city)),'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn'))=1 then min(btrim(x.city)) else '' end into city_name
   from public.delivery_return_records r join public.customers x on x.code=r.row_key
    and x.branch=case p_unit when 'Matriz Caicó' then 'Caicó' when 'Filial Pau dos Ferros' then 'Pau dos Ferros' else p_unit end
   where r.unit=p_unit and r.kind='CUSTOMERS' and upper(btrim(r.data->>'city'))=upper(city_code)
    and public.returns_city_value(array[x.city])<>'';
  end if;
 end if;
 return p_data||jsonb_build_object('customer_name',coalesce(nullif(p_data->>'customer_name',''),nullif(c->>'customer_name',''),b->>'name',''),
 'registration_date',b->>'registration_date','city',coalesce(city_name,''),'branch',coalesce(nullif(c->>'branch',''),b->>'branch',p_unit),'seller',coalesce(nullif(o->>'seller',''),c->>'seller',''),
 'driver',coalesce(j->>'driver',''),'helper1',coalesce(j->>'helper1',''),'helper2',coalesce(j->>'helper2',''),
 'is_drop',case when jsonb_typeof(a->'is_drop')='boolean' then a->'is_drop' else j->'is_drop' end);
end$$;
revoke all on function public.returns_enrich(text,jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
