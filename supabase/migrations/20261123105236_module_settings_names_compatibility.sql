-- Correção isolada para ERROR 23514 em module_settings_name_valid.
-- Não reexecute o SQL 87 em bancos que já possuem Devoluções.
-- Preserva as linhas, os estados ativo/inativo e os módulos já permitidos.
begin;
do $module_names$
declare
 rule text;
 compatible boolean;
begin
 select pg_get_expr(conbin,conrelid) into rule
 from pg_constraint
 where conrelid='public.module_settings'::regclass
 and conname='module_settings_name_valid' and contype='c';

 if rule is null then
  alter table public.module_settings add constraint module_settings_name_valid
  check(module_name in ('NRI','Conferência','Contagem FEFO','Ativo de Giro',
   'Materiais','Refugo','Avarias de Entrega','Avarias de Vendas','Validade do Estoque',
   'Escalonada Digital','Puxada','Formulários','Devoluções','Pedidos'));
 else
  execute format('select coalesce(bool_and(%s),false) from (values (%L),(%L)) as candidate(module_name)',
   rule,'Devoluções','Pedidos') into compatible;
  if not compatible then
   alter table public.module_settings drop constraint module_settings_name_valid;
   execute format('alter table public.module_settings add constraint module_settings_name_valid check ((%s) or module_name in (%L,%L))',
    rule,'Devoluções','Pedidos');
  end if;
 end if;
end
$module_names$;
commit;
