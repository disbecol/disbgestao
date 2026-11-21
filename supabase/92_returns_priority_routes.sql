-- Consult all daily priorities with their date- and unit-scoped route matches.
begin;

create or replace function public.returns_priority_routes(p_unit text,p_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;record_count integer;
begin
 if not public.returns_can(p_unit,'RETURNS_VIEW') then raise exception 'FORBIDDEN';end if;
 if p_date is null then raise exception 'INVALID_PRIORITY_DATE';end if;
 select count(*) into record_count from public.delivery_return_priorities
 where unit=p_unit and priority_date=p_date;
 if record_count>15000 then raise exception 'REDUCE_PERIOD';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'priority',(to_jsonb(p)-'data')||p.data,
  'routes',public.returns_lookup(p_unit,p.customer_code,p.priority_date)
 ) order by p.customer_code),'[]'::jsonb)
 into result from public.delivery_return_priorities p
 where p.unit=p_unit and p.priority_date=p_date;
 return result;
end$$;

revoke all on function public.returns_priority_routes(text,date) from public,anon;
grant execute on function public.returns_priority_routes(text,date) to authenticated;

commit;
