begin;

-- The Data API exposes only invoker entry points. Privileged implementations
-- live in the non-exposed schema and retain their actor, permission and unit
-- checks. Authenticated callers cannot write to the underlying tables directly.
alter function public.escala_state(text,date) set schema escala_private;
alter function public.escala_command(text,text,uuid,integer,jsonb,uuid) set schema escala_private;
alter function public.escala_save_composition(text,date,text,text,jsonb,integer,text,uuid) set schema escala_private;

create function public.escala_state(p_unit text,p_month date) returns jsonb
language sql stable security invoker set search_path='' as $$
 select escala_private.escala_state(p_unit,p_month);
$$;

create function public.escala_command(p_unit text,p_action text,p_id uuid default null,p_revision integer default 0,p_payload jsonb default '{}',p_request_id uuid default gen_random_uuid()) returns jsonb
language sql security invoker set search_path='' as $$
 select escala_private.escala_command(p_unit,p_action,p_id,p_revision,p_payload,p_request_id);
$$;

create function public.escala_save_composition(p_unit text,p_month date,p_token text,p_seed text,p_assignments jsonb,p_helpers integer,p_area text,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select escala_private.escala_save_composition(p_unit,p_month,p_token,p_seed,p_assignments,p_helpers,p_area,p_request_id);
$$;

revoke all on function public.escala_state(text,date),public.escala_command(text,text,uuid,integer,jsonb,uuid),public.escala_save_composition(text,date,text,text,jsonb,integer,text,uuid) from public,anon,authenticated;
revoke all on function escala_private.escala_state(text,date),escala_private.escala_command(text,text,uuid,integer,jsonb,uuid),escala_private.escala_save_composition(text,date,text,text,jsonb,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.escala_state(text,date),public.escala_command(text,text,uuid,integer,jsonb,uuid),public.escala_save_composition(text,date,text,text,jsonb,integer,text,uuid) to authenticated;
-- Needed for the invoker wrappers; this schema is not exposed by PostgREST.
grant execute on function escala_private.escala_state(text,date),escala_private.escala_command(text,text,uuid,integer,jsonb,uuid),escala_private.escala_save_composition(text,date,text,text,jsonb,integer,text,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
