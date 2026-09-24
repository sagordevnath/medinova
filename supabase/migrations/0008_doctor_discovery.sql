-- Module 6: one denormalized public doctor row avoids catalog N+1 queries.
-- Security invoker preserves the underlying doctors/departments RLS policies.
drop view if exists public.doctor_listing_view;
create view public.doctor_listing_view as
select d.id, d.profile_id, d.department_id, d.medicine_type, d.full_name, d.full_name_bn,
       d.slug, d.bio, d.qualifications, d.specialties, d.experience_years,
       d.registration_no, d.photo_url, d.languages, d.rating_avg, d.rating_count,
       d.telemedicine_enabled, d.is_active, dep.name as department_name,
       dep.name_bn as department_name_bn,
       (select min(db.consultation_fee) from public.doctor_branches db where db.doctor_id = d.id and db.branch_id is not null) as min_fee,
       (select jsonb_agg(jsonb_build_object('id', db.id, 'branchId', db.branch_id,
         'consultationFee', db.consultation_fee, 'followupFee', db.followup_fee,
         'followupValidDays', db.followup_valid_days, 'telemedicineFee', db.telemedicine_fee,
         'roomNo', db.room_no) order by db.consultation_fee)
        from public.doctor_branches db where db.doctor_id = d.id) as branches,
       (select jsonb_agg(jsonb_build_object('id', s.id, 'doctorBranchId', s.doctor_branch_id,
         'weekday', s.weekday, 'startTime', s.start_time, 'endTime', s.end_time,
         'slotMinutes', s.slot_minutes, 'maxPerSlot', s.max_per_slot)
        order by s.weekday, s.start_time)
        from public.doctor_schedules s join public.doctor_branches db2 on db2.id = s.doctor_branch_id
        where db2.doctor_id = d.id and s.is_active) as schedules
from public.doctors d
left join public.departments dep on dep.id = d.department_id;

grant select on public.doctor_listing_view to anon, authenticated;
