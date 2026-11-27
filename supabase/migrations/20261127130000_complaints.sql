begin;

create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  source jsonb not null check (jsonb_typeof(source) = 'object'),
  treatment_date text not null default '',
  treatment text not null default '',
  status text not null default '',
  revision integer not null default 1,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.complaints enable row level security;
revoke all on public.complaints from public, anon, authenticated;
grant select on public.complaints to authenticated;

create function public.complaints_access() returns boolean
language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and exists
    (select 1 from public.profiles where id=auth.uid() and active=true);
$$;
revoke all on function public.complaints_access() from public, anon;
grant execute on function public.complaints_access() to authenticated;

create policy complaints_read on public.complaints for select to authenticated
  using (public.complaints_access());

create function public.complaints_import(p_rows jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare n integer;
begin
  if not public.complaints_access() then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)=0
     or exists (select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r)<>'object') then
    raise exception 'INVALID_INPUT';
  end if;
  insert into public.complaints(source,treatment_date,treatment,status,created_by)
  select r,coalesce(r->>'treatment_date',''),coalesce(r->>'treatment',''),coalesce(r->>'status',''),auth.uid()
  from jsonb_array_elements(p_rows) r;
  get diagnostics n = row_count;
  return n;
end;
$$;

create function public.complaints_update_treatment(p_id uuid,p_revision integer,p_date text,p_treatment text,p_status text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.complaints_access() then raise exception 'FORBIDDEN'; end if;
  if p_date is null or p_treatment is null or p_status is null then raise exception 'INVALID_INPUT'; end if;
  update public.complaints set treatment_date=p_date,treatment=p_treatment,status=p_status,
    revision=revision+1,updated_at=now() where id=p_id and revision=p_revision;
  if not found then raise exception 'COMPLAINT_VERSION_CONFLICT'; end if;
end;
$$;
revoke all on function public.complaints_import(jsonb) from public, anon;
revoke all on function public.complaints_update_treatment(uuid,integer,text,text,text) from public, anon;
grant execute on function public.complaints_import(jsonb) to authenticated;
grant execute on function public.complaints_update_treatment(uuid,integer,text,text,text) to authenticated;

commit;
