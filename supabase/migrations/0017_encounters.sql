-- ============================================================================
-- Module 17: clinical encounters, vitals and structured medical history.
-- Run AFTER 0016_invoicing.sql.
--
-- Why: an appointment is a *booking*. A clinic needs a record of what actually
-- happened at the consultation - complaint, examination, observations, working
-- diagnosis and plan. Today prescriptions.diagnosis is free text and there are
-- no observations at all, so there is no defensible patient record.
--
-- Design notes:
--   * An encounter links to an appointment when one exists (walk-ins have none).
--   * Vitals are per-encounter so a trend over time is possible.
--   * History is structured rows, not one free-text column on patients.
--   * diagnosis_code holds an ICD-10 code so reporting can group conditions.
-- ============================================================================

create table if not exists public.encounters (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  -- The clinician responsible for this encounter.
  doctor_id uuid references public.doctors(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  visit_type text not null default 'new'
    check (visit_type in ('new', 'followup', 'telemedicine', 'walk_in')),
  status text not null default 'open'
    check (status in ('open', 'completed', 'cancelled')),
  -- Subjective
  chief_complaint text,
  history_of_present_illness text,
  -- Objective
  examination text,
  -- Assessment / Plan
  diagnosis_code text,          -- ICD-10, e.g. J06.9
  diagnosis_text text,
  plan text,
  advice text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One clinical encounter per booked consultation. Walk-ins (no appointment)
-- are unconstrained, so this stays unique rather than partial.
create unique index if not exists encounters_one_per_appointment_idx
  on public.encounters (appointment_id)
  where appointment_id is not null and status <> 'cancelled';

create index if not exists encounters_patient_idx on public.encounters (patient_id, started_at desc);
create index if not exists encounters_org_idx on public.encounters (org_id, started_at desc);
create index if not exists encounters_doctor_idx on public.encounters (doctor_id, started_at desc);

create table if not exists public.vitals (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete cascade,
  bp_systolic int check (bp_systolic is null or bp_systolic between 40 and 300),
  bp_diastolic int check (bp_diastolic is null or bp_diastolic between 20 and 200),
  pulse int check (pulse is null or pulse between 20 and 250),
  temperature_c numeric(4, 1) check (temperature_c is null or temperature_c between 25 and 45),
  weight_kg numeric(5, 2) check (weight_kg is null or weight_kg > 0),
  height_cm numeric(5, 1) check (height_cm is null or height_cm > 0),
  spo2 int check (spo2 is null or spo2 between 50 and 100),
  respiratory_rate int check (respiratory_rate is null or respiratory_rate between 5 and 80),
  -- Free text for anything the structured fields miss.
  notes text,
  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now()
);

create index if not exists vitals_encounter_idx on public.vitals (encounter_id);
create index if not exists vitals_patient_idx on public.vitals (patient_id, recorded_at desc);

create table if not exists public.medical_history (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  kind text not null
    check (kind in ('medical', 'surgical', 'family', 'immunization', 'obstetric', 'allergy')),
  condition text not null,
  onset_date date,
  resolved_date date,
  -- ICD-10 where the condition is a diagnosis rather than a procedure.
  code text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (resolved_date is null or onset_date is null or resolved_date >= onset_date)
);

create index if not exists medical_history_patient_idx on public.medical_history (patient_id, kind);
-- 2. Ownership predicates ----------------------------------------------------
-- Reuse the tenant rules from Module 15. Patients keep ownership-based access
-- (they are not tenant-scoped); staff need org membership.
create or replace function public.is_encounter_owner(p_encounter uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.encounters e
    join public.patients p on p.id = e.patient_id
    where e.id = p_encounter and p.owner_id = auth.uid()
  );
$$;

create or replace function public.is_vitals_owner(p_vitals uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.vitals v
    join public.patients p on p.id = v.patient_id
    where v.id = p_vitals and p.owner_id = auth.uid()
  );
$$;

-- 3. RLS --------------------------------------------------------------------
alter table public.encounters enable row level security;
alter table public.vitals enable row level security;
alter table public.medical_history enable row level security;

drop policy if exists "encounters patient read" on public.encounters;
create policy "encounters patient read" on public.encounters
  for select using (public.is_encounter_owner(id));

drop policy if exists "encounters org staff read" on public.encounters;
create policy "encounters org staff read" on public.encounters
  for select using (org_id is not null and public.is_org_member(org_id));

drop policy if exists "encounters org staff write" on public.encounters;
create policy "encounters org staff write" on public.encounters
  for insert with check (org_id is not null and public.is_org_member(org_id));

drop policy if exists "encounters org staff update" on public.encounters;
create policy "encounters org staff update" on public.encounters
  for update using (org_id is not null and public.is_org_member(org_id))
  with check (org_id is not null and public.is_org_member(org_id));

drop policy if exists "vitals patient read" on public.vitals;
create policy "vitals patient read" on public.vitals
  for select using (public.is_vitals_owner(id));

drop policy if exists "vitals org staff read" on public.vitals;
create policy "vitals org staff read" on public.vitals
  for select using (org_id is not null and public.is_org_member(org_id));

drop policy if exists "vitals org staff write" on public.vitals;
create policy "vitals org staff write" on public.vitals
  for insert with check (org_id is not null and public.is_org_member(org_id));

drop policy if exists "vitals org staff update" on public.vitals;
create policy "vitals org staff update" on public.vitals
  for update using (org_id is not null and public.is_org_member(org_id))
  with check (org_id is not null and public.is_org_member(org_id));

-- History belongs to the patient and to staff of the treating clinic.
drop policy if exists "history patient all" on public.medical_history;
create policy "history patient all" on public.medical_history
  for all using (public.is_patient_owner(patient_id))
  with check (public.is_patient_owner(patient_id));

drop policy if exists "history org staff read" on public.medical_history;
create policy "history org staff read" on public.medical_history
  for select using (exists (
    select 1 from public.encounters e
    where e.patient_id = medical_history.patient_id
      and e.org_id is not null and public.is_org_member(e.org_id)
  ));

drop policy if exists "history org staff write" on public.medical_history;
create policy "history org staff write" on public.medical_history
  for all using (exists (
    select 1 from public.encounters e
    where e.patient_id = medical_history.patient_id
      and e.org_id is not null and public.is_org_member(e.org_id)
  )) with check (exists (
    select 1 from public.encounters e
    where e.patient_id = medical_history.patient_id
      and e.org_id is not null and public.is_org_member(e.org_id)
  ));

-- 4. Keep the encounter timestamp honest -------------------------------------
create or replace function public.touch_encounter_ended_at() returns trigger
language plpgsql as $$
begin
  -- Completing an encounter stamps ended_at; reopening clears it.
  if new.status = 'completed' and new.ended_at is null then
    new.ended_at := now();
  elsif new.status <> 'completed' then
    new.ended_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_encounters_ended_at on public.encounters;
create trigger trg_encounters_ended_at
  before insert or update of status on public.encounters
  for each row execute function public.touch_encounter_ended_at();