-- ============================================================================
-- Module 13: profile provisioning for every signup.
-- Run AFTER 0012_realtime.sql. Idempotent.
--
-- Gap this closes: 0003_functions.sql creates only a minimal profile row
-- (id, full_name, role, preferred_lang) and never a `patients` record.
-- Consequences before this migration:
--   * phone / avatar / language captured at signup were discarded
--   * a patient could sign in but had no public.patients row, so booking,
--     prescriptions, records and family members all resolved to nothing
--   * staff (receptionist / branch_admin / super_admin) had no supported
--     path at all - only the doctor branch in admin.ts provisioned them
--   * users who signed up before the trigger existed had no profile at all
-- ============================================================================

-- 1. Upgrade the signup trigger ----------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_full_name text;
  v_phone     text;
  v_lang      text;
  v_role      public.user_role;
begin
  v_full_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(trim(split_part(coalesce(new.email, ''), '@', 1)), ''),
    'New user'
  );
  v_phone := nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');
  -- Only 'en'/'bn' are allowed by the profiles check constraint.
  v_lang := case when new.raw_user_meta_data ->> 'preferred_lang' = 'bn' then 'bn' else 'en' end;

  -- Self-service signup is always a patient. Privileged roles are granted
  -- server-side by an admin, never from client-controlled metadata.
  v_role := 'patient';

  insert into public.profiles (id, full_name, phone, role, preferred_lang, avatar_url)
  values (new.id, v_full_name, v_phone, v_role, v_lang,
          nullif(trim(coalesce(new.raw_user_meta_data ->> 'avatar_url', '')), ''))
  on conflict (id) do update set
    full_name     = excluded.full_name,
    phone         = coalesce(excluded.phone, public.profiles.phone),
    preferred_lang= excluded.preferred_lang,
    updated_at    = now();

  -- Give every patient a public.patients row so booking and records resolve.
  -- public.patients has no unique constraint on owner_id (one account may
  -- manage several family members), so guard with NOT EXISTS; ON CONFLICT
  -- would never match and would insert duplicate rows.
  if v_role = 'patient' then
    insert into public.patients (owner_id, full_name, phone)
    select new.id, v_full_name, v_phone
    where not exists (
      select 1 from public.patients p
      where p.owner_id = new.id and p.full_name = v_full_name
    );
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Backfill every auth user that predates this trigger ----------------------
-- Without this, anyone who signed up before the trigger existed (or while it
-- was broken) has no profile and lands in AuthProvider's 'patient' fallback
-- with a blank name.

insert into public.profiles (id, full_name, phone, role, preferred_lang)
select
  au.id,
  coalesce(
    nullif(trim(au.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(au.raw_user_meta_data ->> 'name'), ''),
    nullif(trim(split_part(coalesce(au.email, ''), '@', 1)), ''),
    'New user'
  ),
  nullif(trim(coalesce(au.raw_user_meta_data ->> 'phone', '')), ''),
  -- Never elevate from client metadata: default everyone to patient.
  'patient'::public.user_role,
  case when au.raw_user_meta_data ->> 'preferred_lang' = 'bn' then 'bn' else 'en' end
from auth.users au
where not exists (select 1 from public.profiles p where p.id = au.id)
on conflict (id) do nothing;

-- 3. Backfill the missing patients rows for existing patient profiles --------
insert into public.patients (owner_id, full_name, phone)
select p.id, coalesce(p.full_name, 'New user'), p.phone
from public.profiles p
where p.role = 'patient'
  and not exists (
    select 1 from public.patients pt
    where pt.owner_id = p.id and pt.full_name = coalesce(p.full_name, 'New user')
  );
