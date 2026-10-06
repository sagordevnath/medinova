-- ============================================================================
-- MediNova demo data (run ONCE in Supabase SQL Editor, AFTER bootstrap-1..3)
-- ----------------------------------------------------------------------------
-- Creates 6 real login accounts (patient, doctor, receptionist, 2 branch
-- admins, super admin) plus demo patients, appointments, prescriptions,
-- payments, records, notifications and announcements.
--
-- Password for every account: MediNovaDemo!2026
--
-- Safe to re-run: every insert is ON CONFLICT / NOT EXISTS guarded.
-- WARNING: this writes directly to auth.users. Fine for a test project.
-- ============================================================================

begin;

-- 1. Auth users ---------------------------------------------------------------
-- email_confirmed_at is set so sign-in works even if "Confirm email" is ON.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  gen_random_uuid(),
  'authenticated', 'authenticated',
  u.email,
  crypt('MediNovaDemo!2026', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name, 'preferred_lang', u.lang),
  now(), now(), '', '', '', ''
from (values
  ('patient@demo.medinova',  'Demo Patient',       'bn', '1700000001'),
  ('doctor@demo.medinova',   'Dr. Tanvir Ahmed',   'en', '1700000002'),
  ('reception@demo.medinova','Demo Receptionist',  'en', '1700000003'),
  ('admin@demo.medinova',    'Demo Admin Dhanmondi','en','1700000004'),
  ('admin2@demo.medinova',   'Demo Admin Chattogram','en','1700000005'),
  ('super@demo.medinova',    'Super Admin',        'en', '1700000006')
) as u(email, full_name, lang, phone)
where not exists (select 1 from auth.users au where au.email = u.email);

-- Identities rows (required by GoTrue for email/password sign-in).
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), au.id, au.email::text,
       jsonb_build_object('sub', au.id::text, 'email', au.email, 'email_verified', true),
       'email', now(), au.created_at, now()
from auth.users au
where au.email like '%@demo.medinova'
  and not exists (select 1 from auth.identities i where i.user_id = au.id);

-- 2. Roles and branch scope ---------------------------------------------------
-- The signup trigger created every profile as 'patient'; promote them here.
update public.profiles p set
  role = v.role::user_role,
  full_name = v.full_name,
  phone = '+880' || v.phone,
  preferred_lang = v.lang,
  branch_id = (select b.id from public.branches b where b.slug = v.branch),
  updated_at = now()
from (values
  ('patient@demo.medinova',   'patient',    'Demo Patient',         'bn', '1700000001', null),
  ('doctor@demo.medinova',    'doctor',     'Dr. Tanvir Ahmed',    'en', '1700000002', null),
  ('reception@demo.medinova', 'receptionist','Demo Receptionist',   'en', '1700000003', 'dhanmondi'),
  ('admin@demo.medinova',     'branch_admin','Demo Admin Dhanmondi','en','1700000004', 'dhanmondi'),
  ('admin2@demo.medinova',    'branch_admin','Demo Admin Chattogram','en','1700000005','gec-chattogram'),
  ('super@demo.medinova',     'super_admin','Super Admin',         'en', '1700000006', null)
) as v(email, role, full_name, lang, phone, branch)
where p.id = (select au.id from auth.users au where au.email = v.email);
-- 3. Link the doctor login to the seeded doctor record ------------------------
update public.doctors d set profile_id = p.id, updated_at = now()
from public.profiles p
where p.id = (select au.id from auth.users au where au.email = 'doctor@demo.medinova')
  and d.slug = 'tanvir-ahmed';


-- 4. Demo patients ------------------------------------------------------------
insert into public.patients (owner_id, full_name, dob, gender, phone, blood_group, address, allergies, chronic_conditions)
select p.id, x.full_name, x.dob::date, x.gender, x.phone, x.blood, x.address, x.allergies, x.chronic
from (values
  ('patient@demo.medinova', 'Ayesha Rahman',   '1994-03-12', 'female', '+8801711001001', 'B+',  'Dhanmondi, Dhaka',  'Penicillin', 'Mild asthma'),
  ('patient@demo.medinova', 'Rakib Hasan',    '1979-11-02', 'male',   '+8801711001002', 'O+',  'Uttara, Dhaka',    null,          'Type 2 diabetes'),
  ('patient@demo.medinova', 'Nusrat Jahan',   '1991-07-25', 'female', '+8801711001003', 'A+',  'Mirpur, Dhaka',   null,          null),
  ('patient@demo.medinova', 'Imran Chowdhury','2016-01-30', 'male',   '+8801711001004', 'AB+', 'Banani, Dhaka',   'Sulfa drugs', null)
) as x(email, full_name, dob, gender, phone, blood, address, allergies, chronic)
join auth.users au on au.email = x.email
join public.profiles p on p.id = au.id
where not exists (
  select 1 from public.patients pt where pt.owner_id = p.id and pt.full_name = x.full_name
);

-- 5. Appointments (today + upcoming) ------------------------------------------
insert into public.appointments (
  code, patient_id, doctor_id, branch_id, doctor_branch_id, appt_date,
  slot_start, slot_end, visit_type, status, fee, payment_status, symptoms,
  queue_no, created_by
)
select
  'MN-' || to_char(x.day, 'YYMMDD') || '-' || lpad(x.n::text, 4, '0'),
  pt.id, d.id, b.id, db.id, x.day::date,
  x.slot::time, (x.slot::time + interval '15 minutes')::time,
  x.visit::visit_type, x.status::appt_status, db.consultation_fee,
  x.pay::pay_status, x.symptoms,
  public.next_queue_number(db.id, x.day::date),
  (select au.id from auth.users au where au.email = 'patient@demo.medinova')
from (values
  (1, current_date,     '10:00', 'new',         'confirmed',     'paid',          'Fever and headache for 3 days'),
  (2, current_date,     '10:15', 'followup',     'checked_in',    'pay_at_counter','Diabetes follow-up'),
  (3, current_date,     '11:00', 'new',         'pending',       'unpaid',        'Chest pain on exertion'),
  (4, current_date + 1, '09:30', 'new',         'pending',       'unpaid',        'Antenatal checkup'),
  (5, current_date + 1, '09:45', 'telemedicine','pending',       'unpaid',        'Recurring migraine'),
  (6, current_date + 2, '16:00', 'new',         'pending',       'unpaid',        'Child vaccination')
) as x(n, day, slot, visit, status, pay, symptoms)
join public.doctors d on d.slug = 'tanvir-ahmed'
join public.branches b on b.slug = 'dhanmondi'
join public.doctor_branches db on db.doctor_id = d.id and db.branch_id = b.id
join public.patients pt on pt.full_name = (case x.n
    when 1 then 'Ayesha Rahman' when 2 then 'Rakib Hasan'
    when 3 then 'Nusrat Jahan' when 4 then 'Ayesha Rahman'
    when 5 then 'Nusrat Jahan' else 'Imran Chowdhury' end)
where not exists (
  select 1 from public.appointments a
  where a.doctor_branch_id = db.id and a.appt_date = x.day::date and a.slot_start = x.slot::time
);

-- 6. Prescription ------------------------------------------------------------
insert into public.prescriptions (appointment_id, doctor_id, patient_id, diagnosis, medicines, advice, next_visit_date)
select a.id, a.doctor_id, a.patient_id, 'Acute viral fever',
       '[{"name":"Paracetamol 500mg","dose":"1 tab after food","days":5,"frequency":"8 hourly"},
         {"name":"ORS","dose":"1 sachet","days":3,"frequency":"as needed"}]'::jsonb,
       'Rest and hydrate. Return if fever exceeds 39C for more than 2 days.',
       current_date + 7
from public.appointments a
where a.symptoms = 'Fever and headache for 3 days'
  and not exists (select 1 from public.prescriptions pr where pr.appointment_id = a.id);

-- 7. Payment record -----------------------------------------------------------
insert into public.payments (appointment_id, amount, method, provider_ref, status, paid_at)
select a.id, round(a.fee * 100)::bigint, 'bkash', 'BKASH-DEMO-0001', 'paid', now()
from public.appointments a
where a.payment_status = 'paid'
  and not exists (select 1 from public.payments py where py.appointment_id = a.id);

-- 8. Medical record -----------------------------------------------------------
insert into public.medical_records (patient_id, uploaded_by, title, type, file_path)
select pt.id,
       (select au.id from auth.users au where au.email = 'reception@demo.medinova'),
       'Complete blood count', 'lab',
       pt.id::text || '/cbc-' || to_char(current_date, 'YYYYMMDD') || '.pdf'
from public.patients pt
where pt.full_name = 'Ayesha Rahman'
  and not exists (select 1 from public.medical_records mr where mr.patient_id = pt.id);

-- 9. Notifications ------------------------------------------------------------
insert into public.notifications (user_id, channel, title, body, read_at, sent_at)
select p.id, 'inapp', x.title, x.body,
       case when x.read then now() else null end, now()
from (values
  ('patient@demo.medinova', true,  'Appointment confirmed', 'Your visit with Dr. Tanvir Ahmed is confirmed for today at 10:00 AM.'),
  ('patient@demo.medinova', false, 'Prescription ready',     'A new prescription is available for your recent visit.'),
  ('patient@demo.medinova', false, 'Reminder',              'Please arrive 15 minutes before your appointment.'),
  ('doctor@demo.medinova',  false, 'New appointment',       'You have a new appointment booked for today.')
) as x(email, read, title, body)
join auth.users au on au.email = x.email
join public.profiles p on p.id = au.id
where not exists (
  select 1 from public.notifications n
  where n.user_id = p.id and n.title = x.title and n.body = x.body
);

-- 10. Announcement ------------------------------------------------------------
insert into public.announcements (title, body, starts_at, ends_at)
select 'Free health screening camp',
       'Free blood pressure and sugar screening at all branches this Friday.',
       current_date, current_date + 7
where not exists (
  select 1 from public.announcements a where a.title = 'Free health screening camp'
);

commit;

-- 11. Summary -----------------------------------------------------------------
select p.role::text as role, au.email, p.full_name, b.slug as branch
from public.profiles p
join auth.users au on au.id = p.id
left join public.branches b on b.id = p.branch_id
where au.email like '%@demo.medinova'
order by p.role;
