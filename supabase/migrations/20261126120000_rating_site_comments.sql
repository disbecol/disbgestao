begin;

insert into public.permissions(code,module,name,description,sort_order,active) values
  ('RATING_VIEW','Rating de Clientes','Consultar avaliações','Consultar avaliações dos clientes da unidade autorizada.',10,true),
  ('RATING_EDIT','Rating de Clientes','Editar tratativas','Editar tratativas das avaliações no sistema.',20,true)
on conflict(code) do update set
  module=excluded.module, name=excluded.name, description=excluded.description,
  sort_order=excluded.sort_order, active=true;

insert into public.role_permissions(role,permission_code)
select 'ADMIN',code from public.permissions where code in ('RATING_VIEW','RATING_EDIT')
on conflict do nothing;

create table if not exists public.rating_comments (
  unit text not null references public.units(name),
  row_key text not null check (length(row_key) between 1 and 500),
  comment text not null check (length(comment) <= 5000),
  revision integer not null check (revision > 0),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (unit,row_key)
);

alter table public.rating_comments enable row level security;
revoke all on public.rating_comments from public,anon,authenticated;
grant select on public.rating_comments to authenticated;
drop policy if exists rating_comments_read on public.rating_comments;
create policy rating_comments_read on public.rating_comments for select to authenticated
using (public.user_has_unit(unit) and (public.has_permission('RATING_VIEW') or public.has_permission('RATING_EDIT')));

create or replace function public.rating_save_comment(p_unit text,p_row_key text,p_revision integer,p_comment text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare saved public.rating_comments;
begin
  if not public.user_has_unit(p_unit) or not public.has_permission('RATING_EDIT') then
    raise exception 'FORBIDDEN';
  end if;
  if p_unit not in ('Matriz Caicó','Filial Pau dos Ferros') or p_row_key is null
     or length(p_row_key) not between 1 and 500 or p_revision is null or p_revision < 0
     or p_comment is null or length(p_comment) > 5000 then
    raise exception 'INVALID_INPUT';
  end if;
  if p_revision=0 then
    insert into public.rating_comments(unit,row_key,comment,revision,updated_by)
    values(p_unit,p_row_key,p_comment,1,auth.uid())
    on conflict(unit,row_key) do nothing returning * into saved;
  else
    update public.rating_comments set comment=p_comment,revision=revision+1,updated_by=auth.uid(),updated_at=now()
    where unit=p_unit and row_key=p_row_key and revision=p_revision returning * into saved;
  end if;
  if saved.unit is null then raise exception 'RATING_VERSION_CONFLICT'; end if;
  return jsonb_build_object('comment',saved.comment,'revision',saved.revision);
end;
$$;
revoke all on function public.rating_save_comment(text,text,integer,text) from public,anon;
grant execute on function public.rating_save_comment(text,text,integer,text) to authenticated;

commit;
