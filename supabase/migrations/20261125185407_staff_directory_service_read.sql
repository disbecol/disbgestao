begin;
-- Trusted server administration may verify the independent person before retiring
-- an imported Auth account. Browser roles retain their existing RLS permissions.
grant select on public.staff_people to service_role;
notify pgrst,'reload schema';
commit;
