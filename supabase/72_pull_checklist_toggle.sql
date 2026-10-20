-- Suspensão temporária do checklist da Puxada, inclusive em ciclos em andamento.
-- Perguntas, respostas e histórico permanecem intactos.
begin;

alter table public.pull_settings
  add column if not exists checklist_enabled boolean not null default true;

-- A solicitação atual é desabilitar o checklist. O administrador pode reativá-lo
-- em Puxada > Configurações quando a equipe estiver preparada.
update public.pull_settings
set checklist_enabled=false, updated_at=now()
where singleton=true;

-- A validação no banco também precisa respeitar o controle, inclusive para
-- lançamentos enviados posteriormente pela fila offline.
create or replace function public.guard_pull_checklist_step()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_required text;
begin
  if not coalesce((select checklist_enabled from public.pull_settings where singleton=true),true) then
    return new;
  end if;

  select r.checkpoint_code into v_required
  from public.pull_checklist_requirements(new.trip_id) r
  where r.gate_action=new.action_code
    and not exists(select 1 from public.pull_checklist_runs c
      where c.trip_id=new.trip_id and c.checkpoint_code=r.checkpoint_code)
  order by r.sort_order limit 1;
  if v_required is not null then raise exception 'CHECKLIST_PENDENTE:%',v_required; end if;
  return new;
end;$$;

commit;
