-- Corrige SEND_LOG_FAILED (42501) ao registrar o envio de comprovantes.
-- A Edge Function usa service_role; BYPASSRLS não substitui os privilégios SQL.
-- Não envia mensagens, não altera registros nem amplia o acesso dos usuários.
begin;

grant usage on schema public to service_role;
grant select, insert on table public.damage_receipt_sends to service_role;
grant update(status, provider_message_id, provider_error_code, updated_at)
  on table public.damage_receipt_sends to service_role;

commit;

-- Todas as verificações devem retornar true.
select
  has_table_privilege('service_role', 'public.damage_receipt_sends', 'SELECT') as servidor_consulta,
  has_table_privilege('service_role', 'public.damage_receipt_sends', 'INSERT') as servidor_registra,
  has_column_privilege('service_role', 'public.damage_receipt_sends', 'status', 'UPDATE') as servidor_atualiza_status,
  has_column_privilege('service_role', 'public.damage_receipt_sends', 'provider_message_id', 'UPDATE') as servidor_grava_protocolo,
  has_column_privilege('service_role', 'public.damage_receipt_sends', 'provider_error_code', 'UPDATE') as servidor_grava_erro,
  has_column_privilege('service_role', 'public.damage_receipt_sends', 'updated_at', 'UPDATE') as servidor_atualiza_data,
  not has_table_privilege('authenticated', 'public.damage_receipt_sends', 'INSERT') as aplicativo_sem_insercao_direta,
  not has_any_column_privilege('authenticated', 'public.damage_receipt_sends', 'UPDATE') as aplicativo_sem_edicao_direta,
  not has_table_privilege('anon', 'public.damage_receipt_sends', 'SELECT') as anonimo_sem_consulta,
  (select relrowsecurity from pg_class where oid = 'public.damage_receipt_sends'::regclass) as rls_preservada;
