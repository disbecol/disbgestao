-- O ajuste de TMA já concede acesso ao histórico; inclui essa permissão na entrada do gateway.
begin;
create or replace function public.pull_app_guard(p_permission text default null)
returns public.profiles language plpgsql stable security definer set search_path=public as $$
declare p public.profiles%rowtype;begin
 select * into p from public.profiles where id=auth.uid() and active;
 if p.id is null then perform public.pull_app_error('UNAUTHORIZED','Sua sessão expirou. Entre novamente no Disb Gestão.',401);end if;
 if not exists(select 1 from public.module_settings where module_name='Puxada' and active) then
  perform public.pull_app_error('MODULE_DISABLED','A Puxada está desativada nas configurações.',403);end if;
 if p_permission is not null and not public.has_permission(p_permission) then
  perform public.pull_app_error('FORBIDDEN','Seu usuário não possui permissão para esta ação.',403);end if;
 if not (public.has_permission('PULL_TRIP') or public.has_permission('PULL_PLAN') or public.has_permission('PULL_FAROL')
  or public.has_permission('PULL_HISTORY') or public.has_permission('PULL_TMA_ADJUST') or public.has_permission('PULL_DASHBOARD') or public.has_permission('PULL_CONFIG') or public.has_permission('PULL_GOALS')) then
  perform public.pull_app_error('FORBIDDEN','Seu usuário não possui acesso à Puxada.',403);end if;
 return p;
end;$$;
revoke all on function public.pull_app_guard(text) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
