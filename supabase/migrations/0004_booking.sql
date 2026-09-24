-- MediNova Module 2: slot generation + atomic booking (part 2).
-- get_available_slots: expand weekly schedule rows for the weekday into
-- time slots, subtract overlapping time-off and active bookings, and hide
-- past times when p_date is today in Asia/Dhaka.

create or replace function public.get_available_slots(
  p_doctor_branch_id uuid,
  p_date date
)
returns table (slot_start time, slot_end time, is_available boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_weekday int := extract(dow from p_date)::int;
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_now time := (now() at time zone 'Asia/Dhaka')::time;
  r record;
  v_cursor time;
  v_end time;
  v_off boolean;
  v_booked int;
begin
  for r in
    select s.start_time, s.end_time, s.slot_minutes, s.max_per_slot
    from public.doctor_schedules s
    join public.doctor_branches db on db.id = s.doctor_branch_id
    join public.doctors d on d.id = db.doctor_id
    where s.doctor_branch_id = p_doctor_branch_id
      and s.weekday = v_weekday
      and s.is_active = true
      and db.doctor_id is not null
      and d.is_active = true
    order by s.start_time
  loop
    v_cursor := r.start_time;
    while v_cursor < r.end_time loop
      v_end := (v_cursor + (r.slot_minutes || ' minutes')::interval)::time;
      if v_end > r.end_time then
        v_end := r.end_time;
      end if;

      -- Time-off overlap (branch-scoped or doctor-wide), compared in Dhaka wall time.
      select exists (
        select 1 from public.doctor_time_off t
        join public.doctor_branches db2 on db2.id = p_doctor_branch_id
        where t.doctor_id = db2.doctor_id
          and (t.branch_id is null or t.branch_id = db2.branch_id)
          and tstzrange(t.start_at, t.end_at, '[)') @> ((p_date + v_cursor) at time zone 'Asia/Dhaka')
      ) into v_off;

      -- Active bookings overlapping this slot start.
      select count(*)::int into v_booked
      from public.appointments a
      where a.doctor_branch_id = p_doctor_branch_id
        and a.appt_date = p_date
        and a.slot_start = v_cursor
        and a.status not in ('cancelled', 'no_show');

      slot_start := v_cursor;
      slot_end := v_end;
      is_available := (not v_off)
        and (v_booked < r.max_per_slot)
        and not (p_date = v_today and v_cursor <= v_now);
      return next;

      v_cursor := v_end;
      exit when v_cursor >= r.end_time;
    end loop;
  end loop;
  return;
end $$;

-- book_appointment: atomic single-slot booking with fee resolution.
-- Raises 'SLOT_TAKEN' (SQLSTATE P0001) when the slot is unavailable.
create or replace function public.book_appointment(
  p_patient_id uuid,
  p_doctor_branch_id uuid,
  p_date date,
  p_slot_start time,
  p_visit_type visit_type,
  p_symptoms text default null,
  p_created_by uuid default null
)
returns public.appointments
language plpgsql security definer set search_path = public as $$
declare
  v_db public.doctor_branches%rowtype;
  v_doc public.doctors%rowtype;
  v_slot record;
  v_fee numeric(10, 2);
  v_queue int;
  v_code text;
  v_seq int;
  v_last_completed date;
  v_row public.appointments%rowtype;
begin
  select * into v_db from public.doctor_branches where id = p_doctor_branch_id for update;
  if not found then
    raise exception 'DOCTOR_BRANCH_NOT_FOUND';
  end if;
  select * into v_doc from public.doctors where id = v_db.doctor_id;
  if not found or v_doc.is_active = false then
    raise exception 'DOCTOR_INACTIVE';
  end if;

  if p_visit_type = 'telemedicine' and v_doc.telemedicine_enabled = false and v_db.telemedicine_fee is null then
    raise exception 'TELEMEDICINE_DISABLED';
  end if;

  -- Availability check inside the row lock on doctor_branches.
  select s.slot_start, s.slot_end, s.is_available into v_slot
  from public.get_available_slots(p_doctor_branch_id, p_date) s
  where s.slot_start = p_slot_start;
  if not found or v_slot.is_available = false then
    raise exception 'SLOT_TAKEN';
  end if;

  -- Fee: followup price applies only when the same patient saw the same
  -- doctor within followup_valid_days (completed or active history).
  if p_visit_type = 'telemedicine' then
    v_fee := coalesce(v_db.telemedicine_fee, v_db.consultation_fee);
  elsif p_visit_type = 'followup' then
    select max(a.appt_date) into v_last_completed
    from public.appointments a
    where a.patient_id = p_patient_id
      and a.doctor_id = v_db.doctor_id
      and a.status not in ('cancelled', 'no_show');
    if v_last_completed is not null and (p_date - v_last_completed) <= v_db.followup_valid_days then
      v_fee := v_db.followup_fee;
    else
      v_fee := v_db.consultation_fee;
    end if;
  else
    v_fee := v_db.consultation_fee;
  end if;

  v_queue := public.next_queue_number(p_doctor_branch_id, p_date);

  select count(*)::int + 1 into v_seq
  from public.appointments
  where appt_date = p_date;
  v_code := 'MN-' || to_char(p_date, 'YYMMDD') || '-' || lpad(v_seq::text, 4, '0');

  begin
    insert into public.appointments (
      code, patient_id, doctor_id, branch_id, doctor_branch_id,
      appt_date, slot_start, slot_end, visit_type, status,
      fee, payment_status, symptoms, queue_no, created_by
    ) values (
      v_code, p_patient_id, v_db.doctor_id, v_db.branch_id, p_doctor_branch_id,
      p_date, v_slot.slot_start, v_slot.slot_end, p_visit_type, 'pending',
      v_fee, 'unpaid', p_symptoms, v_queue, p_created_by
    )
    returning * into v_row;
  exception when unique_violation then
    raise exception 'SLOT_TAKEN';
  end;

  return v_row;
end $$;
