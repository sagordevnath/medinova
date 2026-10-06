-- ============================================================================
-- Module 15: tenant isolation (RLS) for the commercial multi-tenant build.
-- Run AFTER 0014_tenancy_subscriptions.sql.
--
-- Why: every clinical policy was scoped to auth.uid() or current_branch_id(),
-- but nothing scoped it to the *organisation*. With two or more clinics on one
-- deployment, a receptionist could read another clinic's patients, appointments
-- and prescriptions. That is a cross-customer data leak, not a feature gap.
--
-- Model:
--   patient  — NOT tenant-scoped. A person books across clinics, so access is
--              ownership-based (owner_id = auth.uid()) exactly as before.
--   staff    — scoped to their organisation via org_id.
--   super_admin — uniform FOR ALL, unchanged.
--
-- The public catalog (active branches, doctors, departments) stays readable by
-- anon so the booking site keeps working, like any public directory.
-- ============================================================================

-- 1. Denormalise org_id onto the tables a clinic actually owns ---------------
-- Scoping a child table through a join is fragile in a USING clause; storing
-- org_id directly keeps every predicate a simple equality check.

do $$ begin
  alter table public.doctors add column if not exists org_id uuid references public.organizations(id) on delete set null;
exception when others then null;
end $$;

do $$ begin
  alter table public.doctor_branches add column if not exists org_id uuid references public.organizations(id) on delete set null;
exception when others then null;
end $$;

do $$ begin
  alter table public.appointments add column if not exists org_id uuid references public.organizations(id) on delete set null;
exception when others then null;
end $$;

create index if not exists doctors_org_idx on public.doctors (org_id);
create index if not exists doctor_branches_org_idx on public.doctor_branches (org_id);
create index if not exists appointments_org_idx on public.appointments (org_id);

-- 2. Backfill org_id from the owning branch ---------------------------------
update public.branches b set org_id = d.id
from public.organizations d
where b.org_id is null and d.slug = 'medinova-demo';

update public.doctors doc set org_id = sub.org_id
from (
  select distinct db.doctor_id, db.org_id from public.doctor_branches db where db.org_id is not null
) sub
where doc.org_id is null and sub.doctor_id = doc.id;

update public.doctor_branches db set org_id = b.org_id
from public.branches b
where db.org_id is null and db.branch_id = b.id and b.org_id is not null;

update public.appointments a set org_id = b.org_id
from public.branches b
where a.org_id is null and a.branch_id = b.id and b.org_id is not null;

-- Keep the denormalised value correct going forward.
create or replace function public.sync_doctor_org_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.org_id is null then
    select b.org_id into new.org_id from public.branches b where b.id = new.branch_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_doctor_branches_org on public.doctor_branches;
create trigger trg_doctor_branches_org
  before insert or update of branch_id on public.doctor_branches
  for each row execute function public.sync_doctor_org_id();

-- Same treatment for appointments: every new booking inherits its branch's org,
-- which is what makes tenant policies match on rows created after this migration.
create or replace function public.sync_appointment_org_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.org_id is null then
    select b.org_id into new.org_id from public.branches b where b.id = new.branch_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_appointments_org on public.appointments;
create trigger trg_appointments_org
  before insert or update of branch_id on public.appointments
  for each row execute function public.sync_appointment_org_id();

-- 3. Tenant predicates used by the policies below ----------------------------
-- "Is the caller staff of organisation p_org?"
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_org is not null
     and exists (
       select 1 from public.profiles
       where id = auth.uid()
         and org_id = p_org
         and role in ('org_admin', 'branch_admin', 'receptionist', 'doctor')
     );
$$;

-- 4. Lock the clinical tables to their tenant --------------------------------
-- Appointments: a patient sees only their own; staff see only their org's.
drop policy if exists "appointments patient read" on public.appointments;
create policy "appointments patient read" on public.appointments
  for select using (public.is_patient_owner(patient_id));

drop policy if exists "appointments org staff read" on public.appointments;
create policy "appointments org staff read" on public.appointments
  for select using (org_id is not null and public.is_org_member(org_id));

-- Prescriptions reach their tenant through the linked appointment.
drop policy if exists "prescriptions patient read" on public.prescriptions;
create policy "prescriptions patient read" on public.prescriptions
  for select using (
    public.is_patient_owner(patient_id)
    or exists (
      select 1 from public.appointments a
      where a.id = prescriptions.appointment_id and public.is_patient_owner(a.patient_id)
    )
  );

drop policy if exists "prescriptions org staff read" on public.prescriptions;
create policy "prescriptions org staff read" on public.prescriptions
  for select using (exists (
    select 1 from public.appointments a
    where a.id = prescriptions.appointment_id and a.org_id is not null
      and public.is_org_member(a.org_id)
  ));

-- Patients: owner, or staff of the clinic that actually treats them. A
-- patient's own row stays readable to them even though they have no org.
drop policy if exists "patients owner read" on public.patients;
create policy "patients owner read" on public.patients
  for select using (owner_id = auth.uid());

drop policy if exists "patients org staff read" on public.patients;
create policy "patients org staff read" on public.patients
  for select using (exists (
    select 1 from public.appointments a
    where a.patient_id = patients.id and a.org_id is not null
      and public.is_org_member(a.org_id)
  ));

-- Medical records follow the patient.
drop policy if exists "records patient read" on public.medical_records;
create policy "records patient read" on public.medical_records
  for select using (public.is_patient_owner(patient_id));

drop policy if exists "records org staff read" on public.medical_records;
create policy "records org staff read" on public.medical_records
  for select using (exists (
    select 1 from public.appointments a
    where a.patient_id = medical_records.patient_id and a.org_id is not null
      and public.is_org_member(a.org_id)
  ));

-- Payments follow the appointment.
drop policy if exists "payments patient read" on public.payments;
create policy "payments patient read" on public.payments
  for select using (exists (
    select 1 from public.appointments a
    where a.id = payments.appointment_id and public.is_patient_owner(a.patient_id)
  ));

drop policy if exists "payments org staff read" on public.payments;
create policy "payments org staff read" on public.payments
  for select using (exists (
    select 1 from public.appointments a
    where a.id = payments.appointment_id and a.org_id is not null
      and public.is_org_member(a.org_id)
  ));

-- Notifications are strictly personal - never shared across a tenant.
drop policy if exists "notifications own read" on public.notifications;
create policy "notifications own read" on public.notifications
  for select using (user_id = auth.uid());

-- 5. Staff must not read other clinics' profiles -----------------------------
-- "profiles staff read" previously let any staff read ANY profile.
drop policy if exists "profiles staff read" on public.profiles;
create policy "profiles staff read" on public.profiles
  for select using (
    (org_id is not null and org_id = public.current_org_id() and public.is_tenant_staff())
    or (public.is_tenant_staff() and exists (
      select 1 from public.patients pt
      where pt.owner_id = profiles.id
        and exists (
          select 1 from public.appointments a
          where a.patient_id = pt.id and a.org_id is not null
            and public.is_org_member(a.org_id)
        )
    ))
  );

-- "Is the caller staff anywhere?" (staff cross-branch reads)
create or replace function public.is_tenant_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('org_admin', 'branch_admin', 'receptionist', 'doctor')
  );
$$;