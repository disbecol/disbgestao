begin;
-- Compartilhamento de conferências sem liberar a tabela MAPAS ao conferente.
create or replace function public.get_container_conference_share(p_conference_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conference public.container_conferences%rowtype;
  v_map public.maps%rowtype;
begin
  select * into v_conference from public.container_conferences where id=p_conference_id;
  if v_conference.id is null then raise exception 'CONFERENCIA_NAO_ENCONTRADA'; end if;
  if not (
    (v_conference.checker_id=auth.uid() and (public.has_permission('CONF_CREATE') or public.has_permission('CONF_OWN_HISTORY')))
    or public.has_permission('CONF_HISTORY')
    or public.has_permission('CONF_DASHBOARD')
  ) then raise exception 'FORBIDDEN'; end if;
  select * into v_map from public.maps
  where map_number=v_conference.map_number
  order by (map_date<=v_conference.conference_date) desc,map_date desc
  limit 1;
  return jsonb_build_object('conference',to_jsonb(v_conference),'map',case when v_map.id is null then null else to_jsonb(v_map) end);
end;
$$;
revoke all on function public.get_container_conference_share(uuid) from public,anon;
grant execute on function public.get_container_conference_share(uuid) to authenticated;

-- Somente o motivo "Não foi no caminhão" pode ser salvo sem foto/GPS.
alter table public.damage_items alter column photo_path drop not null;
alter table public.damage_items alter column latitude drop not null;
alter table public.damage_items alter column longitude drop not null;
alter table public.damage_items drop constraint if exists damage_items_photo_required_by_reason;
alter table public.damage_items add constraint damage_items_photo_required_by_reason
check (
  (photo_path is null and latitude is null and longitude is null and lower(btrim(reason))='não foi no caminhão')
  or (nullif(btrim(photo_path),'') is not null and latitude is not null and longitude is not null)
) not valid;

create or replace function public.create_damage_request(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_req uuid;
  v_item jsonb;
  v_item_id uuid;
  v_order integer := 0;
  v_photos jsonb;
  v_photo jsonb;
  v_first_photo jsonb;
  v_photo_order integer;
  v_unit text:=btrim(coalesce(p_payload->>'unit',''));
begin
  if not public.has_permission('DELIVERY_DAMAGE_CREATE') then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;
  perform public.assert_user_unit(v_unit);

  insert into public.damage_requests(
    occurrence_date,unit,delivery_user_id,delivery_username,delivery_name,customer_code,customer_name,city,map_number,
    signature_path,status,created_by
  ) values(
    (p_payload->>'date')::date,v_unit,auth.uid(),v_profile.username,v_profile.name,btrim(p_payload->>'customer_code'),
    btrim(p_payload->>'customer_name'),btrim(p_payload->>'city'),btrim(p_payload->>'map_number'),
    btrim(p_payload->>'signature_path'),'PENDENTE',auth.uid()
  ) returning id into v_req;

  for v_item in select value from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    v_order := v_order + 1;
    v_photos := case when jsonb_typeof(v_item->'photos')='array' then v_item->'photos' else '[]'::jsonb end;
    if jsonb_array_length(v_photos)=0 and coalesce(v_item->>'photo_path','')<>'' then
      v_photos := jsonb_build_array(jsonb_build_object(
        'photo_path',v_item->>'photo_path','latitude',v_item->>'latitude','longitude',v_item->>'longitude',
        'accuracy',v_item->>'accuracy','gps_at',v_item->>'gps_at'
      ));
    end if;
    if jsonb_array_length(v_photos)=0 and lower(btrim(coalesce(v_item->>'reason','')))<>'não foi no caminhão' then raise exception 'FOTO_OBRIGATORIA'; end if;
    if jsonb_array_length(v_photos)>5 then raise exception 'MAXIMO_5_FOTOS'; end if;
    v_first_photo := v_photos->0;

    insert into public.damage_items(
      request_id,item_order,product_text,lot,quantity,quantity_unit,reason,
      photo_path,latitude,longitude,gps_accuracy,gps_captured_at
    ) values(
      v_req,v_order,btrim(v_item->>'product'),upper(btrim(v_item->>'lot')),(v_item->>'quantity')::numeric,
      upper(v_item->>'unit'),btrim(v_item->>'reason'),btrim(v_first_photo->>'photo_path'),
      (v_first_photo->>'latitude')::double precision,(v_first_photo->>'longitude')::double precision,
      nullif(v_first_photo->>'accuracy','')::double precision,nullif(v_first_photo->>'gps_at','')::timestamptz
    ) returning id into v_item_id;

    v_photo_order := 0;
    for v_photo in select value from jsonb_array_elements(v_photos) loop
      v_photo_order := v_photo_order + 1;
      insert into public.damage_item_photos(
        item_id,photo_order,photo_path,latitude,longitude,gps_accuracy,gps_captured_at
      ) values(
        v_item_id,v_photo_order,btrim(v_photo->>'photo_path'),
        (v_photo->>'latitude')::double precision,(v_photo->>'longitude')::double precision,
        nullif(v_photo->>'accuracy','')::double precision,nullif(v_photo->>'gps_at','')::timestamptz
      );
    end loop;
  end loop;
  return v_req;
end;
$$;


revoke all on function public.create_damage_request(jsonb) from public,anon;
grant execute on function public.create_damage_request(jsonb) to authenticated;


-- Qualquer usuário com a permissão de lançamento pode confirmar a entrega.
create or replace function public.mark_damage_item_delivered(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_req uuid;
  v_status text;
begin
  if not public.has_permission('DELIVERY_DAMAGE_POST') then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;

  select request_id,status into v_req,v_status
  from public.damage_items where id=p_item_id for update;
  if v_req is null then raise exception 'ITEM_NAO_ENCONTRADO'; end if;
  if v_status<>'LANCADO' then raise exception 'ITEM_NAO_LANCADO'; end if;

  update public.damage_items
     set status='ENTREGUE',
         delivered_by=auth.uid(),
         delivered_by_name=v_profile.name,
         delivered_at=now()
   where id=p_item_id and status='LANCADO';

  perform public.refresh_damage_request_status(v_req);
  return jsonb_build_object('updated',1,'status','ENTREGUE');
end;
$$;
revoke all on function public.mark_damage_item_delivered(uuid) from public,anon;
grant execute on function public.mark_damage_item_delivered(uuid) to authenticated;


-- Qualquer usuário com a permissão de lançamento pode confirmar a entrega.
create or replace function public.mark_sales_damage_item_delivered(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_req uuid;
  v_status text;
begin
  if not public.has_permission('SALES_DAMAGE_POST') then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;

  select request_id,status into v_req,v_status
  from public.sales_damage_items where id=p_item_id for update;
  if v_req is null then raise exception 'ITEM_NAO_ENCONTRADO'; end if;
  if v_status<>'LANCADO' then raise exception 'ITEM_NAO_LANCADO'; end if;

  update public.sales_damage_items
     set status='ENTREGUE',
         delivered_by=auth.uid(),
         delivered_by_name=v_profile.name,
         delivered_at=now()
   where id=p_item_id and status='LANCADO';

  perform public.refresh_sales_damage_request_status(v_req);
  return jsonb_build_object('updated',1,'status','ENTREGUE');
end;
$$;
revoke all on function public.mark_sales_damage_item_delivered(uuid) from public,anon;
grant execute on function public.mark_sales_damage_item_delivered(uuid) to authenticated;

-- Recibos de criação para avarias de vendas e NRI: a mesma tentativa nunca gera
-- uma segunda solicitação após perda de conexão ou repetição do toque.
create or replace function public.create_sales_damage_request_once(p_operation_id uuid,p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_result jsonb;
  v_user uuid;
  v_kind text;
begin
  if auth.uid() is null or p_operation_id is null then raise exception 'UNAUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select result,user_id,operation_type into v_result,v_user,v_kind
  from public.offline_sync_receipts where operation_id=p_operation_id;
  if found then
    if v_user<>auth.uid() or v_kind<>'SALES_DAMAGE_CREATE' then raise exception 'OPERATION_ID_CONFLICT'; end if;
    return v_result || jsonb_build_object('_reused',true);
  end if;
  select to_jsonb(r) into v_result from public.create_sales_damage_request_v2(p_payload) r;
  insert into public.offline_sync_receipts(operation_id,user_id,operation_type,result)
  values(p_operation_id,auth.uid(),'SALES_DAMAGE_CREATE',v_result);
  return v_result;
end;
$$;
revoke all on function public.create_sales_damage_request_once(uuid,jsonb) from public,anon;
grant execute on function public.create_sales_damage_request_once(uuid,jsonb) to authenticated;

create or replace function public.create_nri_request_once(p_operation_id uuid,p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_result jsonb;
  v_user uuid;
  v_kind text;
begin
  if auth.uid() is null or p_operation_id is null then raise exception 'UNAUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select result,user_id,operation_type into v_result,v_user,v_kind
  from public.offline_sync_receipts where operation_id=p_operation_id;
  if found then
    if v_user<>auth.uid() or v_kind<>'NRI_CREATE' then raise exception 'OPERATION_ID_CONFLICT'; end if;
    return v_result || jsonb_build_object('_reused',true);
  end if;
  v_result := public.create_nri_request(p_payload);
  insert into public.offline_sync_receipts(operation_id,user_id,operation_type,result)
  values(p_operation_id,auth.uid(),'NRI_CREATE',v_result);
  return v_result;
end;
$$;
revoke all on function public.create_nri_request_once(uuid,jsonb) from public,anon;
grant execute on function public.create_nri_request_once(uuid,jsonb) to authenticated;

-- A mesma exceção de foto vale para paletes avariados na NRI.
create or replace function public.create_nri_request(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_req uuid;
  v_item jsonb;
  v_count integer;
  v_i integer;
  v_rows jsonb;
  v_type text;
  v_driver text;
  v_plate text;
  v_factory text;
  v_unit text;
  v_receipt_date date;
  v_receipt_time time;
  v_validity date;
  v_pull_trip uuid;
  v_pull public.pull_trips%rowtype;
  v_market_id uuid;
  v_market public.marketplace_receipts%rowtype;
  v_damage_id uuid;
  v_damaged boolean;
  v_damaged_pallets integer;
  v_reason text;
  v_invoice_number text;
  v_photos jsonb;
  v_photo jsonb;
  v_photo_order integer;
begin
  if not public.has_permission('NRI_CREATE') then raise exception 'FORBIDDEN'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'UNAUTHORIZED'; end if;

  v_type:=upper(coalesce(nullif(btrim(p_payload->>'request_type'),''),'AMBEV'));
  if v_type not in ('AMBEV','MARKETPLACE') then raise exception 'TIPO_NRI_INVALIDO'; end if;

  if coalesce(btrim(p_payload->>'pull_trip_id'),'')<>'' then
    v_pull_trip:=(p_payload->>'pull_trip_id')::uuid;
    select * into v_pull from public.pull_trips where id=v_pull_trip for update;
    if v_pull.id is null or v_pull.cycle_type<>'PULL' or v_pull.status<>'ARRIVED' or v_pull.nri_status<>'PENDING' then raise exception 'PUXADA_NAO_DISPONIVEL_PARA_NRI'; end if;
  end if;

  if coalesce(btrim(p_payload->>'marketplace_receipt_id'),'')<>'' then
    v_market_id:=(p_payload->>'marketplace_receipt_id')::uuid;
    select * into v_market from public.marketplace_receipts where id=v_market_id for update;
    if v_market.id is null or v_market.status<>'PENDING_NRI' or v_market.nri_status<>'PENDING' then raise exception 'MARKETPLACE_NAO_DISPONIVEL_PARA_NRI'; end if;
  end if;

  if v_pull_trip is not null and v_market_id is not null then raise exception 'FONTE_NRI_INVALIDA'; end if;

  if v_type='MARKETPLACE' then
    v_driver:='--';
    v_plate:='--';
    if v_market_id is not null then
      v_factory:=v_market.supplier_name;
      v_unit:=v_market.unit;
      v_receipt_date:=(v_market.ended_at at time zone 'America/Fortaleza')::date;
      v_receipt_time:=(v_market.ended_at at time zone 'America/Fortaleza')::time;
    else
      v_factory:=btrim(p_payload->>'factory');
      v_unit:=btrim(p_payload->>'unit');
      v_receipt_date:=(p_payload->>'receipt_date')::date;
      v_receipt_time:=(p_payload->>'receipt_time')::time;
      if coalesce(v_factory,'')='' then raise exception 'FORNECEDOR_MARKETPLACE_OBRIGATORIO'; end if;
    end if;
  else
    v_driver:=btrim(p_payload->>'driver');
    v_plate:=upper(btrim(p_payload->>'plate'));
    v_factory:=btrim(p_payload->>'factory');
    v_unit:=btrim(p_payload->>'unit');
    v_receipt_date:=(p_payload->>'receipt_date')::date;
    v_receipt_time:=(p_payload->>'receipt_time')::time;
    if coalesce(v_driver,'')='' or coalesce(v_plate,'')='' or coalesce(v_factory,'')='' then raise exception 'DADOS_TRANSPORTE_OBRIGATORIOS'; end if;
  end if;

  if coalesce(v_unit,'')='' or not exists(select 1 from public.units where name=v_unit and active=true) then raise exception 'UNIDADE_INVALIDA'; end if;

  insert into public.nri_requests(
    unit,request_type,receipt_date,checker_id,checker_name,receipt_time,driver,plate,factory,created_by,pull_trip_id,marketplace_receipt_id
  ) values(
    v_unit,v_type,v_receipt_date,auth.uid(),v_profile.name,v_receipt_time,
    v_driver,v_plate,v_factory,auth.uid(),v_pull_trip,v_market_id
  ) returning id into v_req;

  for v_item in select value from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    v_count:=greatest(1,coalesce((v_item->>'pallets')::integer,1));
    v_validity:=nullif(btrim(coalesce(v_item->>'validity_date','')),'')::date;
    v_damaged:=lower(coalesce(v_item->>'pallet_damaged','false')) in ('true','1','yes','sim');
    v_damaged_pallets:=coalesce(nullif(v_item->>'damaged_pallets','')::integer,0);
    v_reason:=btrim(coalesce(v_item->>'damage_reason',''));
    v_invoice_number:=btrim(coalesce(v_item->>'invoice_number',''));
    v_photos:=case when jsonb_typeof(v_item->'damage_photos')='array' then v_item->'damage_photos' else '[]'::jsonb end;

    if v_damaged then
      if v_damaged_pallets<1 or v_damaged_pallets>v_count then raise exception 'QTD_PALETE_AVARIADO_INVALIDA'; end if;
      if v_reason='' then raise exception 'MOTIVO_PALETE_AVARIADO_OBRIGATORIO'; end if;
      if v_invoice_number='' then raise exception 'NOTA_FISCAL_PALETE_AVARIADO_OBRIGATORIA'; end if;
      if jsonb_array_length(v_photos)<1 and lower(btrim(v_reason))<>'não foi no caminhão' then raise exception 'FOTO_PALETE_AVARIADO_OBRIGATORIA'; end if;
      if jsonb_array_length(v_photos)>5 then raise exception 'MAXIMO_5_FOTOS_PALETE_AVARIADO'; end if;
    end if;

    for v_i in 1..v_count loop
      insert into public.nris(
        nri,request_id,product_code,product_name,unit,request_type,validity_date,lot,receipt_date,block_date,
        checker_name,receipt_time,driver,plate,factory,quantity,status,created_by,created_by_username,created_by_name
      ) values(
        null,v_req,btrim(v_item->>'product_code'),btrim(v_item->>'product_name'),v_unit,v_type,
        v_validity,upper(btrim(v_item->>'lot')),v_receipt_date,
        case when v_validity is null then null else (v_validity-30) end,
        v_profile.name,v_receipt_time,v_driver,v_plate,v_factory,
        greatest(0,(v_item->>'quantity')::integer),'PENDENTE',auth.uid(),v_profile.username,v_profile.name
      );
    end loop;

    if v_damaged then
      insert into public.nri_damage_items(
        request_id,product_code,product_name,lot,total_pallets,damaged_pallets,reason,invoice_number,created_by
      ) values(
        v_req,btrim(v_item->>'product_code'),btrim(v_item->>'product_name'),upper(btrim(v_item->>'lot')),
        v_count,v_damaged_pallets,v_reason,v_invoice_number,auth.uid()
      ) returning id into v_damage_id;

      v_photo_order:=0;
      for v_photo in select value from jsonb_array_elements(v_photos) loop
        v_photo_order:=v_photo_order+1;
        insert into public.nri_damage_photos(damage_item_id,photo_order,photo_path)
        values(v_damage_id,v_photo_order,btrim(v_photo->>'photo_path'));
      end loop;
    end if;
  end loop;

  if v_pull_trip is not null then
    update public.pull_trips set nri_status='COMPLETED' where id=v_pull_trip;
  end if;
  if v_market_id is not null then
    update public.marketplace_receipts set status='COMPLETED',nri_status='COMPLETED' where id=v_market_id;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.nri),'[]'::jsonb) into v_rows
  from public.nris x where x.request_id=v_req;

  return jsonb_build_object('request_id',v_req,'pull_trip_id',v_pull_trip,'marketplace_receipt_id',v_market_id,'nris',v_rows);
end;
$$;
revoke all on function public.create_nri_request(jsonb) from public,anon;
grant execute on function public.create_nri_request(jsonb) to authenticated;

commit;
