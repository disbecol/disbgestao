-- New operational jobs retain the legacy permissions of their job family.
-- This does not confer administrative access or change unit isolation.
create or replace function public.app_role_parent_role(p_role text) returns text
language sql immutable set search_path=public,pg_temp as $$
 select coalesce((select r->>'baseRole' from jsonb_array_elements(public.app_role_catalog()) r where r->>'code'=p_role),p_role);
$$;
create or replace function public.has_role(allowed text[]) returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce(public.current_role()=any(allowed)
   or public.app_role_parent_role(public.current_role())=any(allowed),false);
$$;
-- Include the primary department even when an older client changes it without
-- updating the additional departments in the form schema.
create or replace function public.forms_evaluation_areas(p_config jsonb) returns text[]
language sql immutable set search_path=public,pg_temp as $$
 select coalesce(array_agg(distinct public.forms_area_key(a.value)) filter(where length(btrim(a.value))>0),'{}')
 from jsonb_array_elements_text(jsonb_build_array(coalesce(p_config->>'area','')) ||
   case when jsonb_typeof(p_config->'areas')='array' then p_config->'areas' else '[]'::jsonb end) a;
$$;
notify pgrst, 'reload schema';
