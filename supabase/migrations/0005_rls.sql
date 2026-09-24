-- MediNova Module 2: Row Level Security (part 3/3 of migrations).
-- Catalog is publicly readable; clinical + PII tables are locked down.
-- Writes go through service-role / SECURITY DEFINER functions.

-- Enable RLS on every public table ------------------------------------------
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.doctors enable row level security;
alter table public.doctor_branches enable row level security;
alter table public.doctor_schedules enable row level security;
alter table public.doctor_time_off enable row level security;
alter table public.patients enable row level security;
alter table public.appointments enable row level security;
alter table public.payments enable row level security;
alter table public.prescriptions enable row level security;
alter table public.medical_records enable row level security;
alter table public.reviews enable row level security;
alter table public.notifications enable row level security;
alter table public.services enable row level security;
alter table public.announcements enable row level security;
alter table public.audit_logs enable row level security;

-- Helper: current user's role --------------------------------------------------
create or replace function public.current_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Public catalog reads ----------------------------------------------------------
create policy "public read active branches" on public.branches
  for select using (is_active = true);

create policy "public read active departments" on public.departments
  for select using (is_active = true);

create policy "public read active doctors" on public.doctors
  for select using (is_active = true);

create policy "public read doctor postings" on public.doctor_branches
  for select using (true);

create policy "public read active schedules" on public.doctor_schedules
  for select using (is_active = true);

create policy "public read approved reviews" on public.reviews
  for select using (is_approved = true);

create policy "public read branch services" on public.services
  for select using (true);

create policy "public read live announcements" on public.announcements
  for select using (
    (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );

-- Authenticated users --------------------------------------------------------------
-- Patients own their family profiles; staff (any non-patient role) can read all.
create policy "patients owner read" on public.patients
  for select using (auth.uid() = owner_id or public.current_role() <> 'patient');

create policy "patients owner insert" on public.patients
  for insert with check (auth.uid() = owner_id);

create policy "patients owner update" on public.patients
  for update using (auth.uid() = owner_id);

-- Appointments: owners of the patient record + staff can read; booking happens
-- through book_appointment() (SECURITY DEFINER) so no direct insert policy here.
create policy "appointments read own or staff" on public.appointments
  for select using (
    exists (select 1 from public.patients p where p.id = patient_id and p.owner_id = auth.uid())
    or public.current_role() <> 'patient'
  );

-- Users read their own profile; anyone with a staff role reads all profiles.
create policy "profiles self read" on public.profiles
  for select using (id = auth.uid() or public.current_role() <> 'patient');

create policy "profiles self update" on public.profiles
  for update using (id = auth.uid());

-- Staff-only tables: no INSERT/UPDATE/DELETE policies for anon/authenticated
-- except explicit below; service_role bypasses RLS for server writes.
-- Notifications: recipient reads own; recipient marks read.
create policy "notifications own read" on public.notifications
  for select using (user_id = auth.uid());

create policy "notifications own mark read" on public.notifications
  for update using (user_id = auth.uid());

-- Payments / prescriptions / records visible to the owning patient + staff.
create policy "payments via appointment" on public.payments
  for select using (
    exists (
      select 1 from public.appointments a
      join public.patients p on p.id = a.patient_id
      where a.id = appointment_id and (p.owner_id = auth.uid() or public.current_role() <> 'patient')
    )
  );

create policy "prescriptions via patient" on public.prescriptions
  for select using (
    exists (
      select 1 from public.patients p
      where p.id = patient_id and (p.owner_id = auth.uid() or public.current_role() <> 'patient')
    )
  );

create policy "records via patient" on public.medical_records
  for select using (
    exists (
      select 1 from public.patients p
      where p.id = patient_id and (p.owner_id = auth.uid() or public.current_role() <> 'patient')
    )
  );

create policy "reviews own insert" on public.reviews
  for insert with check (
    exists (select 1 from public.patients p where p.id = patient_id and p.owner_id = auth.uid())
  );
