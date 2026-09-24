-- MediNova Module 3: policy reset + RLS helper functions.
-- Drops every Module 2 stub policy (idempotent), then recreates the helpers
-- used by 0007_rls_policies.sql. All helpers are SECURITY DEFINER so policy
-- subqueries never re-enter RLS (no policy recursion) and evaluate cheaply.

-- Drop all existing policies in public ------------------------------------------
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Role / branch helpers ----------------------------------------------------------
create or replace function public.current_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_branch_id()
returns uuid language sql stable security definer set search_path = public as $$
  select branch_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role() in ('receptionist', 'branch_admin', 'super_admin');
$$;

create or replace function public.is_branch_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role() in ('receptionist', 'branch_admin');
$$;

-- Old-value readers for WITH CHECK clauses (a policy cannot see the pre-update row).
create or replace function public.profile_role_of(p_id uuid)
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = p_id;
$$;

create or replace function public.profile_branch_of(p_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select branch_id from public.profiles where id = p_id;
$$;

-- Ownership predicates ------------------------------------------------------------
create or replace function public.is_patient_owner(p_patient_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.patients where id = p_patient_id and owner_id = auth.uid());
$$;

create or replace function public.is_appointment_owner(p_appointment_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.appointments a
    join public.patients p on p.id = a.patient_id
    where a.id = p_appointment_id and p.owner_id = auth.uid()
  );
$$;

create or replace function public.is_appointment_doctor(p_appointment_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.appointments a
    join public.doctors d on d.id = a.doctor_id
    where a.id = p_appointment_id and d.profile_id = auth.uid()
  );
$$;

create or replace function public.is_patient_assigned_doctor(p_patient_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.appointments a
    join public.doctors d on d.id = a.doctor_id
    where a.patient_id = p_patient_id and d.profile_id = auth.uid()
  );
$$;

create or replace function public.is_my_doctor(p_doctor_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.doctors where id = p_doctor_id and profile_id = auth.uid());
$$;

create or replace function public.is_my_posting(p_doctor_branch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.doctor_branches db
    join public.doctors d on d.id = db.doctor_id
    where db.id = p_doctor_branch_id and d.profile_id = auth.uid()
  );
$$;

-- Branch predicates ----------------------------------------------------------------
create or replace function public.posting_at_my_branch(p_doctor_branch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.doctor_branches
    where id = p_doctor_branch_id and branch_id = public.current_branch_id()
  );
$$;

create or replace function public.doctor_posts_at(p_doctor_id uuid, p_branch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.doctor_branches
    where doctor_id = p_doctor_id and branch_id = p_branch_id
  );
$$;

create or replace function public.is_appointment_at_my_branch(p_appointment_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.appointments
    where id = p_appointment_id and branch_id = public.current_branch_id()
  );
$$;

create or replace function public.patient_at_my_branch(p_patient_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.appointments
    where patient_id = p_patient_id and branch_id = public.current_branch_id()
  );
$$;

create or replace function public.doctor_at_my_branch(p_doctor_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.doctor_branches
    where doctor_id = p_doctor_id and branch_id = public.current_branch_id()
  );
$$;

-- Clinical integrity predicates ------------------------------------------------------
create or replace function public.doctor_owns_prescription(p_appointment_id uuid, p_doctor_id uuid, p_patient_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.appointments a
    join public.doctors d on d.id = a.doctor_id
    where a.id = p_appointment_id
      and a.doctor_id = p_doctor_id
      and a.patient_id = p_patient_id
      and d.profile_id = auth.uid()
  );
$$;

create or replace function public.appointment_belongs_to_patient(p_appointment_id uuid, p_patient_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.appointments
    where id = p_appointment_id and patient_id = p_patient_id
  );
$$;

-- Private storage predicate: records/prescriptions buckets are patient-foldered.
-- p_folder is the first path segment as TEXT so malformed names deny cleanly
-- instead of raising a uuid cast error inside the policy.
create or replace function public.storage_patient_access(p_folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (
      select 1 from public.patients p
      where p.id::text = p_folder and p.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.appointments a
      join public.doctors d on d.id = a.doctor_id
      where a.patient_id::text = p_folder and d.profile_id = auth.uid()
    )
    or (
      public.is_branch_staff()
      and exists (
        select 1 from public.appointments a
        where a.patient_id::text = p_folder
          and a.branch_id = public.current_branch_id()
      )
    );
$$;