-- MediNova Module 2 seed (part 3/3): postings with per-branch fees, schedules, services.
-- Fees in BDT: 500-1500, different per branch. Run AFTER seed_02_doctors.sql.

-- Postings: every doctor practises at Uttara + Dhanmondi; leads also at GEC.
insert into public.doctor_branches (doctor_id, branch_id, consultation_fee, followup_fee, followup_valid_days, telemedicine_fee, room_no)
select d.id, b.id, f.fee, f.follow, 14, f.tele, f.room
from public.doctors d
join (values
  ('tanvir-ahmed', 'uttara', 1000, 600, 800, '304'),
  ('tanvir-ahmed', 'dhanmondi', 1200, 700, 900, '205'),
  ('tanvir-ahmed', 'gec-chattogram', 800, 500, 700, '101'),
  ('nusrat-jahan', 'uttara', 1200, 700, 1000, '305'),
  ('nusrat-jahan', 'dhanmondi', 1500, 800, 1200, '206'),
  ('farhana-akter', 'uttara', 1000, 600, 800, '306'),
  ('farhana-akter', 'dhanmondi', 1200, 700, 900, '207'),
  ('rakib-hasan', 'uttara', 800, 500, null, '307'),
  ('rakib-hasan', 'dhanmondi', 1000, 600, null, '208'),
  ('mahmudul-karim', 'uttara', 1200, 700, null, '308'),
  ('mahmudul-karim', 'gec-chattogram', 1000, 600, null, '102'),
  ('sharmin-sultana', 'dhanmondi', 800, 500, 600, '209'),
  ('sharmin-sultana', 'uttara', 700, 400, 500, '309'),
  ('imran-chowdhury', 'uttara', 800, 500, 600, '310'),
  ('imran-chowdhury', 'dhanmondi', 1000, 600, 700, '210'),
  ('anjuman-ara', 'dhanmondi', 1200, 700, 1000, '211'),
  ('anjuman-ara', 'uttara', 1000, 600, 800, '311'),
  ('kamrul-islam', 'uttara', 600, 400, 500, 'H-01'),
  ('kamrul-islam', 'dhanmondi', 700, 400, 500, 'H-02'),
  ('kamrul-islam', 'gec-chattogram', 500, 300, 400, 'H-01'),
  ('salma-begum', 'uttara', 600, 350, 500, 'H-02'),
  ('salma-begum', 'dhanmondi', 700, 400, 500, 'H-03'),
  ('habib-ullah', 'dhanmondi', 500, 300, 400, 'H-04'),
  ('habib-ullah', 'uttara', 500, 300, 400, 'H-03'),
  ('marium-khan', 'uttara', 600, 350, 500, 'H-04'),
  ('marium-khan', 'gec-chattogram', 500, 300, 400, 'H-02')
) as f(slug, branch, fee, follow, tele, room)
  on d.slug = f.slug
join public.branches b on b.slug = f.branch
on conflict (doctor_id, branch_id) do update set
  consultation_fee = excluded.consultation_fee, followup_fee = excluded.followup_fee,
  telemedicine_fee = excluded.telemedicine_fee, room_no = excluded.room_no,
  updated_at = now();

-- Schedules: Sat-Thu (weekday 6,0-4) morning 10:00-13:00 + evening 17:00-21:00.
-- weekday: 0=Sunday .. 6=Saturday (Postgres extract(dow)).
insert into public.doctor_schedules (doctor_branch_id, weekday, start_time, end_time, slot_minutes, max_per_slot, is_active)
select db.id, w.wd, w.s, w.e, 15, 1, true
from public.doctor_branches db
cross join (values
  (6, '10:00'::time, '13:00'::time), (6, '17:00'::time, '21:00'::time),
  (0, '10:00'::time, '13:00'::time), (0, '17:00'::time, '21:00'::time),
  (1, '10:00'::time, '13:00'::time), (1, '17:00'::time, '21:00'::time),
  (2, '10:00'::time, '13:00'::time), (2, '17:00'::time, '21:00'::time),
  (3, '10:00'::time, '13:00'::time), (3, '17:00'::time, '21:00'::time),
  (4, '10:00'::time, '13:00'::time), (4, '17:00'::time, '21:00'::time)
) as w(wd, s, e)
on conflict do nothing;

-- 6 services per branch (lab + imaging + packages/ambulance mix).
insert into public.services (branch_id, name, name_bn, category, price, description)
select b.id, s.name, s.name_bn, s.cat::text, s.price, s.descr
from public.branches b
cross join (values
  ('CBC Blood Test', 'সিবিসি রক্ত পরীক্ষা', 'lab', 400, 'Complete blood count with ESR'),
  ('HbA1c (Diabetes)', 'এইচবিএ১সি (ডায়াবেটিস)', 'lab', 900, '3-month sugar average'),
  ('ECG', 'ইসিজি', 'imaging', 500, '12-lead ECG with report'),
  ('Ultrasonography', 'আল্ট্রাসনোগ্রাম', 'imaging', 1200, 'Whole abdomen USG'),
  ('Executive Health Package', 'এক্সিকিউটিভ হেলথ প্যাকেজ', 'package', 4500, 'CBC, lipid, liver, kidney, ECG + consult'),
  ('Ambulance (City)', 'অ্যাম্বুলেন্স (শহর)', 'ambulance', 1500, 'AC ambulance inside city, oxygen support')
) as s(name, name_bn, cat, price, descr)
on conflict do nothing;
