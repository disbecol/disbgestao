-- Dashboard somente leitura; usa as avarias existentes e respeita as políticas RLS.
begin;
create index if not exists damage_requests_dashboard_period on public.damage_requests(unit,occurrence_date);
create function public.delivery_damage_dashboard(p_unit text,p_from date,p_to date) returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare current_rows jsonb;previous_rows jsonb;n integer;from_previous date;to_previous date;begin
 if auth.uid() is null or not public.user_has_unit(p_unit)
 or not(public.has_permission('DELIVERY_DAMAGE_VIEW_ALL') or public.has_permission('DELIVERY_DAMAGE_REVIEW') or public.has_permission('DELIVERY_DAMAGE_POST'))
 or not exists(select 1 from public.module_settings where module_name='Avarias de Entrega' and active)
 then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 then raise exception 'INVALID_PERIOD';end if;
 from_previous:=(p_from-interval '1 year')::date;to_previous:=(p_to-interval '1 year')::date;
 with selected as (
  select r.id,r.occurrence_date,r.created_at,r.delivery_user_id,r.delivery_name,r.customer_code,r.customer_name,r.city,r.map_number,
  (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'product_text',i.product_text,'lot',i.lot,'quantity',i.quantity,'quantity_unit',i.quantity_unit,
   'reason',i.reason,'status',i.status,'created_at',i.created_at,'reviewed_at',i.reviewed_at,'launched_at',i.launched_at,'delivered_at',i.delivered_at) order by i.item_order,i.id),'[]'::jsonb)
   from public.damage_items i where i.request_id=r.id) items
  from public.damage_requests r where r.unit=p_unit and r.occurrence_date between p_from and p_to order by r.occurrence_date desc,r.id limit 10001
 ) select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb),count(*) into current_rows,n from selected s;
 if n>10000 then raise exception 'REDUCE_PERIOD';end if;
 with selected as (
  select r.id,r.occurrence_date,r.created_at,r.delivery_user_id,r.delivery_name,r.customer_code,r.customer_name,r.city,r.map_number,
  (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'product_text',i.product_text,'lot',i.lot,'quantity',i.quantity,'quantity_unit',i.quantity_unit,
   'reason',i.reason,'status',i.status,'created_at',i.created_at,'reviewed_at',i.reviewed_at,'launched_at',i.launched_at,'delivered_at',i.delivered_at) order by i.item_order,i.id),'[]'::jsonb)
   from public.damage_items i where i.request_id=r.id) items
  from public.damage_requests r where r.unit=p_unit and r.occurrence_date between from_previous and to_previous order by r.occurrence_date desc,r.id limit 10001
 ) select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb),count(*) into previous_rows,n from selected s;
 if n>10000 then raise exception 'REDUCE_PERIOD';end if;
 return jsonb_build_object('requests',current_rows,'previous',previous_rows,'previous_from',from_previous,'previous_to',to_previous,'server_now',now());
end$$;
revoke all on function public.delivery_damage_dashboard(text,date,date) from public,anon;
grant execute on function public.delivery_damage_dashboard(text,date,date) to authenticated;
commit;
