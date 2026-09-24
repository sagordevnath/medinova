-- MediNova Module 2 seed (part 1/2): branches + departments.
-- Idempotent: safe to re-run (upserts on slug / name+medicine_type).

insert into public.branches (slug, name, name_bn, address, address_bn, city, lat, lng, phone, emergency_phone, email, opening_hours, facilities, photo_url, is_active)
values
  ('uttara', 'MediNova Uttara', 'মেডিনোভা উত্তরা', 'House 7, Road 11, Sector 4, Uttara, Dhaka 1230', 'হাউস ৭, রোড ১১, সেক্টর ৪, উত্তরা, ঢাকা ১২৩০', 'Dhaka', 23.8759, 90.3795, '+8801711000101', '16263', 'uttara@medinova.example', '{"sat-thu": "09:00-22:00", "fri": "15:00-22:00"}', '{Pharmacy,Emergency,Lab,Imaging,Cafeteria,Parking}', null, true),
  ('dhanmondi', 'MediNova Dhanmondi', 'মেডিনোভা ধানমন্ডি', 'House 12, Road 5, Dhanmondi, Dhaka 1205', 'হাউস ১২, রোড ৫, ধানমন্ডি, ঢাকা ১২০৫', 'Dhaka', 23.7461, 90.3742, '+8801711000102', '16263', 'dhanmondi@medinova.example', '{"sat-thu": "09:00-22:00", "fri": "15:00-22:00"}', '{Pharmacy,Emergency,Lab,Cabin,ICU}', null, true),
  ('gec-chattogram', 'MediNova Chattogram GEC', 'মেডিনোভা চট্টগ্রাম জিইসি', 'GEC Circle, Chattogram 4000', 'জিইসি সার্কেল, চট্টগ্রাম ৪০০০', 'Chattogram', 22.3569, 91.7832, '+8801711000103', '16263', 'gec@medinova.example', '{"sat-thu": "09:00-21:00", "fri": "15:00-21:00"}', '{Pharmacy,Emergency,Lab,Imaging}', null, true)
on conflict (slug) do update set
  name = excluded.name, name_bn = excluded.name_bn, address = excluded.address,
  address_bn = excluded.address_bn, city = excluded.city, lat = excluded.lat, lng = excluded.lng,
  phone = excluded.phone, emergency_phone = excluded.emergency_phone, email = excluded.email,
  opening_hours = excluded.opening_hours, facilities = excluded.facilities, is_active = true,
  updated_at = now();

-- 8 allopathic departments
insert into public.departments (name, name_bn, medicine_type, icon, description, is_active)
values
  ('Medicine', 'মেডিসিন', 'allopathic', 'stethoscope', 'General internal medicine', true),
  ('Cardiology', 'কার্ডিওলজি', 'allopathic', 'heart-pulse', 'Heart and hypertension care', true),
  ('Gynecology', 'গাইনী', 'allopathic', 'baby', 'Women health and pregnancy', true),
  ('Pediatrics', 'শিশুরোগ', 'allopathic', 'baby', 'Child health and immunization', true),
  ('Orthopedics', 'অর্থোপেডিক্স', 'allopathic', 'bone', 'Bones, joints and trauma', true),
  ('ENT', 'নাক-কান-গলা', 'allopathic', 'ear', 'Ear, nose and throat', true),
  ('Dermatology', 'চর্মরোগ', 'allopathic', 'sparkles', 'Skin, hair and nails', true),
  ('Neurology', 'নিউরোলজি', 'allopathic', 'brain', 'Brain, nerves and migraine', true)
on conflict (name, medicine_type) do update set
  name_bn = excluded.name_bn, icon = excluded.icon, description = excluded.description,
  is_active = true, updated_at = now();

-- 5 homeopathic departments
insert into public.departments (name, name_bn, medicine_type, icon, description, is_active)
values
  ('General Homeopathy', 'জেনারেল হোমিওপ্যাথি', 'homeopathic', 'leaf', 'Classical homeopathic consults', true),
  ('Chronic Disease', 'দীর্ঘমেয়াদি রোগ', 'homeopathic', 'activity', 'Long-term constitutional care', true),
  ('Pediatric Homeopathy', 'শিশু হোমিওপ্যাথি', 'homeopathic', 'baby', 'Gentle care for children', true),
  ('Skin & Allergy', 'চর্ম ও অ্যালার্জি', 'homeopathic', 'sparkles', 'Eczema, allergy and hair', true),
  ('Women''s Health', 'নারী স্বাস্থ্য', 'homeopathic', 'heart', 'Hormonal and cycle care', true)
on conflict (name, medicine_type) do update set
  name_bn = excluded.name_bn, icon = excluded.icon, description = excluded.description,
  is_active = true, updated_at = now();
