-- Visibilidade global dos módulos no aplicativo.
-- A área Administração permanece sempre acessível para reativação.
begin;

create table if not exists public.module_settings (
  module_name text primary key,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint module_settings_name_valid check (module_name in (
    'NRI','Conferência','Contagem FEFO','Ativo de Giro','Materiais',
    'Avarias de Entrega','Avarias de Vendas','Puxada'
  ))
);

insert into public.module_settings(module_name,active) values
  ('NRI',true),('Conferência',true),('Contagem FEFO',true),
  ('Ativo de Giro',true),('Materiais',true),
  ('Avarias de Entrega',true),('Avarias de Vendas',true),('Puxada',true)
on conflict (module_name) do nothing;

alter table public.module_settings enable row level security;
drop policy if exists module_settings_read on public.module_settings;
create policy module_settings_read on public.module_settings
  for select to authenticated using (true);
drop policy if exists module_settings_admin_update on public.module_settings;
create policy module_settings_admin_update on public.module_settings
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select,update(active,updated_at) on public.module_settings to authenticated;
commit;
