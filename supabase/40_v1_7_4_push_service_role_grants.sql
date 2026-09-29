-- Hotfix das notificacoes de avarias: a Edge Function push-notifications
-- consulta estas tabelas com a chave service_role. Neste projeto, service_role
-- nao herdou todos os GRANTs de tabela; a primeira falha foi em public.units.
-- Execute uma vez no Supabase SQL Editor. GRANTs repetidos sao seguros.

begin;

grant usage on schema public to service_role;

grant select on table
  public.damage_requests,
  public.sales_damage_requests,
  public.push_devices,
  public.units,
  public.user_units,
  public.profiles,
  public.role_permissions,
  public.user_permissions
to service_role;

-- A funcao desativa apenas dispositivos cujo token FCM ou subscription Web
-- foi rejeitado pelo provedor. Nenhuma outra coluna precisa de UPDATE.
grant update(active, updated_at) on table public.push_devices to service_role;

commit;

-- Todas as colunas abaixo devem retornar true.
select
  has_table_privilege('service_role','public.damage_requests','SELECT') as avarias_entrega,
  has_table_privilege('service_role','public.sales_damage_requests','SELECT') as avarias_vendas,
  has_table_privilege('service_role','public.push_devices','SELECT') as dispositivos,
  has_table_privilege('service_role','public.units','SELECT') as unidades,
  has_table_privilege('service_role','public.user_units','SELECT') as acesso_unidades,
  has_table_privilege('service_role','public.profiles','SELECT') as perfis,
  has_table_privilege('service_role','public.role_permissions','SELECT') as permissoes_papel,
  has_table_privilege('service_role','public.user_permissions','SELECT') as permissoes_usuario,
  has_column_privilege('service_role','public.push_devices','active','UPDATE') as desativar_dispositivo,
  has_column_privilege('service_role','public.push_devices','updated_at','UPDATE') as atualizar_data_dispositivo;
