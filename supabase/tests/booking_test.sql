-- MediNova Module 2 acceptance test.
-- Run: psql "$DATABASE_URL" -f supabase/tests/booking_test.sql
-- or in Supabase SQL editor after applying migrations + seeds.
-- Asserts: slots are generated, and two bookings for one slot give 1 win + 1 SLOT_TAKEN.

\set ON_ERROR_STOP on

begin;

-- 1. pick a seeded posting + a future date that actually has a schedule --------
create temp table t_ctx on commit drop as
select db.id as doctor_branch_id,
       (current_date + 7)::date as d,
       extract(dow from (current_date + 7))::int as wd
from public.doctor_branches db
join public.doctors doc on doc.id = db.doctor_id
join public.doctor_schedules s on s.doctor_branch_id = db.id
where s.weekday = extract(dow from (current_date + 7))::int
limit 1;

do $$
declare
  v_id uuid;
  v_d date;
  v_cnt int;
begin
  select doctor_branch_id, d into v_id, v_d from t_ctx;
  if v_id is null then
    raise exception 'TEST SETUP FAILED: no doctor posting with a schedule on the target weekday (did you run the seeds?)';
  end if;

  -- 2. get_available_slots returns rows, with a mix of flags ------------------
  select count(*) into v_cnt from public.get_available_slots(v_id, v_d);
  if v_cnt = 0 then
    raise exception 'TEST FAILED: get_available_slots returned 0 rows';
  end if;
  raise notice 'OK: get_available_slots returned % slots', v_cnt;

  select count(*) into v_cnt from public.get_available_slots(v_id, v_d) where is_available;
  if v_cnt = 0 then
    raise exception 'TEST FAILED: no available slots for a future date';
  end if;
  raise notice 'OK: % slots are bookable', v_cnt;
end $$;

-- 3. two concurrent bookings for the same slot -------------------------------
-- Two real sessions (dblink) would be ideal; this deterministic check reproduces
-- the same guarantee: the partial unique index rejects the second insert.
do $$
declare
  v_id uuid;
  v_d date;
  v_doc uuid;
  v_branch uuid;
  v_slot time;
  v_p1 uuid;
  v_p2 uuid;
  v_owner uuid;
  v_first public.appointments;
  v_fee numeric(10,2);
  v_second_failed boolean := false;
begin
  select ctx.doctor_branch_id, ctx.d, db.doctor_id, db.branch_id
    into v_id, v_d, v_doc, v_branch
  from t_ctx ctx join public.doctor_branches db on db.id = ctx.doctor_branch_id;

  select slot_start into v_slot
  from public.get_available_slots(v_id, v_d) where is_available order by slot_start limit 1;

  -- Two throwaway owners (auth.users row required by the profiles FK).
  insert into auth.users (id, email) values (gen_random_uuid(), 'booking-test-1@medinova.test') returning id into v_owner;
  insert into public.patients (owner_id, full_name) values (v_owner, 'Test Patient One') returning id into v_p1;

  insert into auth.users (id, email) values (gen_random_uuid(), 'booking-test-2@medinova.test') returning id into v_owner;
  insert into public.patients (owner_id, full_name) values (v_owner, 'Test Patient Two') returning id into v_p2;

  select * into v_first from public.book_appointment(v_p1, v_id, v_d, v_slot, 'new', 'first booking');
  v_fee := v_first.fee;
  raise notice 'OK: first booking created % (queue %, fee %)', v_first.code, v_first.queue_no, v_fee;

  begin
    perform public.book_appointment(v_p2, v_id, v_d, v_slot, 'new', 'second booking');
  exception when others then
    if sqlerrm = 'SLOT_TAKEN' then
      v_second_failed := true;
      raise notice 'OK: second booking rejected with SLOT_TAKEN';
    else
      raise exception 'TEST FAILED: unexpected error on second booking: %', sqlerrm;
    end if;
  end;

  if not v_second_failed then
    raise exception 'TEST FAILED: double booking succeeded (partial unique index missing?)';
  end if;

  -- 4. follow-up pricing: same doctor within validity window ------------------
  declare
    v_fu public.appointments;
  begin
    select * into v_fu from public.book_appointment(
      v_p1, v_id, v_d + 1,
      (select slot_start from public.get_available_slots(v_id, v_d + 1) where is_available order by slot_start limit 1),
      'followup', 'follow up visit'
    );
    if v_fu.fee >= v_fee then
      raise notice 'NOTE: follow-up fee % >= new fee % (check followup_valid_days for this posting)', v_fu.fee, v_fee;
    else
      raise notice 'OK: follow-up applied cheaper fee % vs new %', v_fu.fee, v_fee;
    end if;
    if v_fu.visit_type <> 'followup' then
      raise exception 'TEST FAILED: visit_type not persisted';
    end if;
  end;
end $$;

-- 5. slot disappears from availability after booking --------------------------
do $$
declare
  v_id uuid;
  v_d date;
  v_slot time;
  v_avail boolean;
begin
  select doctor_branch_id, d into v_id, v_d from t_ctx;
  select slot_start into v_slot from public.get_available_slots(v_id, v_d) where is_available order by slot_start limit 1;
  select is_available into v_avail from public.get_available_slots(v_id, v_d) where slot_start = v_slot;
  if v_avail then
    raise exception 'TEST FAILED: booked slot still reported available';
  end if;
  raise notice 'OK: booked slot now unavailable';
end $$;

rollback;
