-- MediNova Module 2: booking engine (part 1 - helpers + slot generation).
-- Timezone: Asia/Dhaka everywhere user-facing.

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_branches_updated on public.branches;
create trigger trg_branches_updated before update on public.branches
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_departments_updated on public.departments;
create trigger trg_departments_updated before update on public.departments
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_doctors_updated on public.doctors;
create trigger trg_doctors_updated before update on public.doctors
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_doctor_branches_updated on public.doctor_branches;
create trigger trg_doctor_branches_updated before update on public.doctor_branches
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_doctor_schedules_updated on public.doctor_schedules;
create trigger trg_doctor_schedules_updated before update on public.doctor_schedules
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_patients_updated on public.patients;
create trigger trg_patients_updated before update on public.patients
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_appointments_updated on public.appointments;
create trigger trg_appointments_updated before update on public.appointments
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_payments_updated on public.payments;
create trigger trg_payments_updated before update on public.payments
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_prescriptions_updated on public.prescriptions;
create trigger trg_prescriptions_updated before update on public.prescriptions
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_reviews_updated on public.reviews;
create trigger trg_reviews_updated before update on public.reviews
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_services_updated on public.services;
create trigger trg_services_updated before update on public.services
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_announcements_updated on public.announcements;
create trigger trg_announcements_updated before update on public.announcements
  for each row execute function public.touch_updated_at();

-- Auto-create a patient-role profile when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role, preferred_lang)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    'patient',
    coalesce(new.raw_user_meta_data ->> 'preferred_lang', 'en')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Next queue number for a posting+date (1-based, counts active bookings).
create or replace function public.next_queue_number(
  p_doctor_branch_id uuid,
  p_date date
)
returns int language plpgsql stable as $$
declare
  v_count int;
begin
  select count(*)::int into v_count
  from public.appointments a
  where a.doctor_branch_id = p_doctor_branch_id
    and a.appt_date = p_date
    and a.status not in ('cancelled', 'no_show');
  return coalesce(v_count, 0) + 1;
end $$;
