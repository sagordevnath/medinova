-- MediNova Module 2: full database schema (part 1/2 - enums + core tables).
-- Applies cleanly on a fresh DB. Run with: supabase db push

create extension if not exists "pgcrypto";

do $$ begin
  create type medicine_type as enum ('allopathic', 'homeopathic');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type user_role as enum ('patient', 'doctor', 'receptionist', 'branch_admin', 'super_admin');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type appt_status as enum ('pending', 'confirmed', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type visit_type as enum ('new', 'followup', 'telemedicine');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type pay_status as enum ('unpaid', 'pay_at_counter', 'paid', 'refunded', 'failed');
exception when duplicate_object then null;
end $$;

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_bn text not null,
  slug text unique not null,
  address text not null,
  address_bn text not null,
  city text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  phone text not null,
  emergency_phone text not null,
  email text,
  opening_hours jsonb not null default '{}'::jsonb,
  facilities text[] not null default '{}',
  photo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role user_role not null default 'patient',
  branch_id uuid references public.branches(id) on delete set null,
  avatar_url text,
  preferred_lang text not null default 'en' check (preferred_lang in ('en', 'bn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_bn text not null,
  medicine_type medicine_type not null,
  icon text,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, medicine_type)
);

create table public.doctors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  medicine_type medicine_type not null,
  full_name text not null,
  full_name_bn text not null,
  slug text unique not null,
  bio text,
  qualifications text[] not null default '{}',
  specialties text[] not null default '{}',
  experience_years int not null default 0 check (experience_years >= 0),
  registration_no text,
  photo_url text,
  languages text[] not null default '{English,Bangla}',
  rating_avg numeric(3, 2) not null default 0 check (rating_avg >= 0 and rating_avg <= 5),
  rating_count int not null default 0 check (rating_count >= 0),
  telemedicine_enabled boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.doctor_branches (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  consultation_fee numeric(10, 2) not null check (consultation_fee >= 0),
  followup_fee numeric(10, 2) not null check (followup_fee >= 0),
  followup_valid_days int not null default 14 check (followup_valid_days >= 0),
  telemedicine_fee numeric(10, 2) check (telemedicine_fee is null or telemedicine_fee >= 0),
  room_no text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (doctor_id, branch_id)
);

create table public.doctor_schedules (
  id uuid primary key default gen_random_uuid(),
  doctor_branch_id uuid not null references public.doctor_branches(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  slot_minutes int not null default 15 check (slot_minutes > 0 and slot_minutes <= 480),
  max_per_slot int not null default 1 check (max_per_slot > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (doctor_branch_id, weekday, start_time, end_time),
  check (start_time < end_time)
);

create table public.doctor_time_off (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (start_at < end_at)
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null,
  dob date,
  gender text check (gender is null or gender in ('male', 'female', 'other')),
  phone text,
  blood_group text,
  address text,
  allergies text,
  chronic_conditions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

