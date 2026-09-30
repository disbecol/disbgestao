-- Atalhos da Home sincronizados entre dispositivos do mesmo usuário.
begin;

create table if not exists public.user_home_shortcuts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  view_ids text[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint user_home_shortcuts_limit check (coalesce(array_length(view_ids,1),0)<=80)
);

alter table public.user_home_shortcuts enable row level security;

drop policy if exists user_home_shortcuts_select on public.user_home_shortcuts;
create policy user_home_shortcuts_select on public.user_home_shortcuts
  for select to authenticated using (user_id=auth.uid());

drop policy if exists user_home_shortcuts_insert on public.user_home_shortcuts;
create policy user_home_shortcuts_insert on public.user_home_shortcuts
  for insert to authenticated with check (user_id=auth.uid());

drop policy if exists user_home_shortcuts_update on public.user_home_shortcuts;
create policy user_home_shortcuts_update on public.user_home_shortcuts
  for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

grant select,insert,update on public.user_home_shortcuts to authenticated;

commit;
