begin;
alter function public.escala_issues(text,date) rename to escala_issues_with_vehicle_checks;
revoke all on function public.escala_issues_with_vehicle_checks(text,date) from public,anon,authenticated;
create function public.escala_issues(p_unit text,p_month date) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(issue),'[]'::jsonb)
 from jsonb_array_elements(public.escala_issues_with_vehicle_checks(p_unit,p_month)) issue
 where issue->>'code' not in ('TRUCK','DUPLICATE_TRUCK');
$$;
revoke all on function public.escala_issues(text,date) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
