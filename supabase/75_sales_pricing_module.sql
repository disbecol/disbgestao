-- Vendas > Escalonada Digital. A fonte de precos continua no Google Sheets
-- por meio do Apps Script existente; esta migracao so habilita o modulo no app.
begin;

insert into public.permissions(code,module,name,description,sort_order,active) values
  ('SALES_PRICING_VIEW','Escalonada Digital','Consultar preços',
   'Consultar preços TTC e TTV por segmento na planilha Escalonada Digital.',10,true)
on conflict(code) do update set module=excluded.module,name=excluded.name,
  description=excluded.description,sort_order=excluded.sort_order,active=true;

insert into public.role_permissions(role,permission_code) values
  ('ADMIN','SALES_PRICING_VIEW'),
  ('VENDEDOR','SALES_PRICING_VIEW'),
  ('GERENTE_VENDAS','SALES_PRICING_VIEW')
on conflict do nothing;

alter table public.module_settings drop constraint if exists module_settings_name_valid;
alter table public.module_settings add constraint module_settings_name_valid check (module_name in (
  'NRI','Conferência','Contagem FEFO','Ativo de Giro','Materiais','Refugo',
  'Avarias de Entrega','Avarias de Vendas','Validade do Estoque',
  'Escalonada Digital','Puxada'
));

insert into public.module_settings(module_name,active)
values ('Escalonada Digital',true)
on conflict(module_name) do nothing;

commit;
