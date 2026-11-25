begin;

insert into public.permissions(code,module,name,description,sort_order,active) values
  ('RATING_VIEW','Rating de Clientes','Consultar avaliações','Consultar avaliações dos clientes da unidade autorizada.',10,true),
  ('RATING_EDIT','Rating de Clientes','Editar tratativas','Editar o campo Comentário das avaliações dos clientes da unidade autorizada.',20,true)
on conflict(code) do update set
  module=excluded.module,
  name=excluded.name,
  description=excluded.description,
  sort_order=excluded.sort_order,
  active=true;

insert into public.role_permissions(role,permission_code)
select 'ADMIN',code from public.permissions where code in ('RATING_VIEW','RATING_EDIT')
on conflict do nothing;

commit;
