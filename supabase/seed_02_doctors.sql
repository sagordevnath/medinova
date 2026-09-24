-- MediNova Module 2 seed (part 2/2): 12 doctors, postings, schedules, services.
-- Run AFTER seed_01_catalog.sql. Idempotent via slug / posting unique keys.

-- 8 allopathic doctors -------------------------------------------------------
insert into public.doctors (slug, department_id, medicine_type, full_name, full_name_bn, bio, qualifications, specialties, experience_years, registration_no, photo_url, languages, telemedicine_enabled, is_active)
select x.slug, d.id, 'allopathic'::medicine_type, x.full_name, x.full_name_bn, x.bio,
       x.qualifications::text[], x.specialties::text[], x.exp, x.reg, x.photo, '{English,Bangla}'::text[], x.tele, true
from (values
  ('tanvir-ahmed', 'Medicine', 'Dr. Tanvir Ahmed', 'ডা. তানভীর আহমেদ', 'Internal medicine, diabetes and hypertension (Dhaka Medical College).', '{MBBS,MD (Internal Medicine)}', '{Diabetes,Hypertension,Thyroid}', 12, 'BMDC A-51234', 'https://placehold.co/400x400?text=TA', true),
  ('nusrat-jahan', 'Cardiology', 'Dr. Nusrat Jahan', 'ডা. নুসরাত জাহান', 'Interventional cardiologist, echocardiography.', '{MBBS,D-Card}', '{Chest Pain,ECG,Echo}', 10, 'BMDC A-52310', 'https://placehold.co/400x400?text=NJ', true),
  ('farhana-akter', 'Gynecology', 'Dr. Farhana Akter', 'ডা. ফারহানা আক্তার', 'High-risk pregnancy and infertility counselling.', '{MBBS,MS (Obs & Gynae)}', '{Pregnancy,PCOS,Infertility}', 11, 'BMDC A-50987', 'https://placehold.co/400x400?text=FA', true),
  ('rakib-hasan', 'Pediatrics', 'Dr. Rakib Hasan', 'ডা. রাকিব হাসান', 'Newborn and child nutrition specialist.', '{MBBS,DCH}', '{Newborn,Vaccination,Nutrition}', 9, 'BMDC A-54112', 'https://placehold.co/400x400?text=RH', false),
  ('mahmudul-karim', 'Orthopedics', 'Dr. Mahmudul Karim', 'ডা. মাহমুদুল করিম', 'Fracture, arthritis and sports injury.', '{MBBS,MS (Ortho)}', '{Fracture,Back Pain,Knee}', 13, 'BMDC A-49876', 'https://placehold.co/400x400?text=MK', false),
  ('sharmin-sultana', 'ENT', 'Dr. Sharmin Sultana', 'ডা. শারমিন সুলতানা', 'Tonsil, sinus and hearing problems.', '{MBBS,DLO}', '{Sinus,Tonsil,Hearing}', 8, 'BMDC A-55621', 'https://placehold.co/400x400?text=SS', true),
  ('imran-chowdhury', 'Dermatology', 'Dr. Imran Chowdhury', 'ডা. ইমরান চৌধুরী', 'Acne, eczema and hair fall treatment.', '{MBBS,DDV}', '{Acne,Eczema,Hair}', 7, 'BMDC A-56100', 'https://placehold.co/400x400?text=IC', true),
  ('anjuman-ara', 'Neurology', 'Dr. Anjuman Ara', 'ডা. আনজুমান আরা', 'Migraine, stroke and epilepsy care.', '{MBBS,MD (Neurology)}', '{Migraine,Stroke,Epilepsy}', 12, 'BMDC A-50333', 'https://placehold.co/400x400?text=AA', true)
) as x(slug, dept, full_name, full_name_bn, bio, qualifications, specialties, exp, reg, photo, tele)
join public.departments d on d.name = x.dept and d.medicine_type = 'allopathic'
on conflict (slug) do update set
  department_id = excluded.department_id, full_name = excluded.full_name,
  full_name_bn = excluded.full_name_bn, bio = excluded.bio,
  qualifications = excluded.qualifications, specialties = excluded.specialties,
  experience_years = excluded.experience_years, telemedicine_enabled = excluded.telemedicine_enabled,
  is_active = true, updated_at = now();

-- 4 homeopathic doctors -------------------------------------------------------
insert into public.doctors (slug, department_id, medicine_type, full_name, full_name_bn, bio, qualifications, specialties, experience_years, registration_no, photo_url, languages, telemedicine_enabled, is_active)
select x.slug, d.id, 'homeopathic'::medicine_type, x.full_name, x.full_name_bn, x.bio,
       x.qualifications::text[], x.specialties::text[], x.exp, x.reg, x.photo, '{English,Bangla}'::text[], true, true
from (values
  ('kamrul-islam', 'General Homeopathy', 'Dr. Kamrul Islam (Homeo)', 'ডা. কামরুল ইসলাম (হোমিও)', 'Classical homeopathy for acute and chronic illness.', '{DHMS,BHMS}', '{Gastric,Cold,Weakness}', 14, 'BHMC H-10231', 'https://placehold.co/400x400?text=KI'),
  ('salma-begum', 'Chronic Disease', 'Dr. Salma Begum (Homeo)', 'ডা. সালমা বেগম (হোমিও)', 'Arthritis, piles and chronic skin cases.', '{BHMS}', '{Arthritis,Piles,Migraine}', 10, 'BHMC H-11002', 'https://placehold.co/400x400?text=SB'),
  ('habib-ullah', 'Pediatric Homeopathy', 'Dr. Habib Ullah (Homeo)', 'ডা. হাবিব উল্লাহ (হোমিও)', 'Teething, colic and recurrent cold in children.', '{DHMS}', '{Colic,Teething,Cold}', 9, 'BHMC H-11455', 'https://placehold.co/400x400?text=HU'),
  ('marium-khan', 'Women''s Health', 'Dr. Marium Khan (Homeo)', 'ডা. মারিয়াম খান (হোমিও)', 'PCOS, irregular cycle and anemia support.', '{BHMS}', '{PCOS,Anemia,Leucorrhoea}', 8, 'BHMC H-11890', 'https://placehold.co/400x400?text=MKH')
) as x(slug, dept, full_name, full_name_bn, bio, qualifications, specialties, exp, reg, photo)
join public.departments d on d.name = x.dept and d.medicine_type = 'homeopathic'
on conflict (slug) do update set
  department_id = excluded.department_id, full_name = excluded.full_name,
  full_name_bn = excluded.full_name_bn, bio = excluded.bio,
  qualifications = excluded.qualifications, specialties = excluded.specialties,
  experience_years = excluded.experience_years, telemedicine_enabled = true,
  is_active = true, updated_at = now();
