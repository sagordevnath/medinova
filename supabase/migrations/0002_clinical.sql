-- MediNova Module 2: appointments, payments, clinical, engagement (part 2/2).
-- Depends on 0001_foundation.sql.

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  doctor_id uuid not null references public.doctors(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  doctor_branch_id uuid not null references public.doctor_branches(id) on delete restrict,
  appt_date date not null,
  slot_start time not null,
  slot_end time not null,
  visit_type visit_type not null,
  status appt_status not null default 'pending',
  fee numeric(10, 2) not null check (fee >= 0),
  payment_status pay_status not null default 'unpaid',
  payment_method text,
  symptoms text,
  ai_triage jsonb,
  queue_no int,
  checked_in_at timestamptz,
  cancelled_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slot_start < slot_end)
);

create unique index appointments_no_double_book_idx
  on public.appointments (doctor_branch_id, appt_date, slot_start)
  where status not in ('cancelled', 'no_show');

create index appointments_lookup_idx on public.appointments (doctor_id, branch_id, appt_date, status);
create index appointments_patient_idx on public.appointments (patient_id, appt_date desc);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  amount numeric(10, 2) not null check (amount >= 0),
  method text not null check (method in ('cash', 'bkash', 'nagad', 'card')),
  provider_ref text,
  status pay_status not null default 'unpaid',
  paid_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  doctor_id uuid not null references public.doctors(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  diagnosis text,
  medicines jsonb not null default '[]'::jsonb,
  advice text,
  next_visit_date date,
  pdf_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.medical_records (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  title text not null,
  type text not null check (type in ('lab', 'xray', 'report')),
  file_path text not null,
  created_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid unique not null references public.appointments(id) on delete cascade,
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  is_approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms', 'push', 'inapp')),
  title text not null,
  body text,
  read_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  name_bn text not null,
  category text not null check (category in ('lab', 'imaging', 'package', 'ambulance')),
  price numeric(10, 2) not null check (price >= 0),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, name)
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  branch_id uuid references public.branches(id) on delete cascade,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or starts_at <= ends_at)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  meta jsonb,
  created_at timestamptz not null default now()
);
