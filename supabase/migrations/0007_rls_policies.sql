-- MediNova Module 3: complete table policies (runs after 0006_auth_helpers.sql).
-- Matrix: public catalog reads; patients own their rows; doctors get their
-- assigned appointments + prescriptions; receptionist/branch_admin are scoped
-- to current_branch_id(); super_admin gets a uniform FOR ALL policy (part 2);
-- storage bucket policies follow in part 2 as well.

-- branches --------------------------------------------------------------------------
create policy "branches public read active" on public.branches
  for select using (is_active = true);

create policy "branches staff read own" on public.branches
  for select using (public.is_branch_staff() and id = public.current_branch_id());

create policy "branches admin update" on public.branches
  for update
  using (public.current_role() = 'branch_admin' and id = public.current_branch_id())
  with check (public.current_role() = 'branch_admin' and id = public.current_branch_id());

-- profiles --------------------------------------------------------------------------
create policy "profiles self read" on public.profiles
  for select using (id = auth.uid() or public.is_staff());

create policy "profiles self update" on public.profiles
  for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = public.current_role()
    and branch_id is not distinct from public.current_branch_id()
  );

create policy "profiles branch staff update" on public.profiles
  for update
  using (public.is_branch_staff())
  with check (
    public.is_branch_staff()
    and role = public.profile_role_of(id)
    and branch_id is not distinct from public.profile_branch_of(id)
  );

-- departments ------------------------------------------------------------------------
create policy "departments public read" on public.departments
  for select using (is_active = true or public.is_staff());

-- doctors ---------------------------------------------------------------------------
create policy "doctors public read" on public.doctors
  for select using (is_active = true or public.is_staff());

create policy "doctors self update" on public.doctors
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- doctor_branches -------------------------------------------------------------------
create policy "postings public read" on public.doctor_branches for select using (true);

create policy "postings branch staff insert" on public.doctor_branches
  for insert with check (public.is_branch_staff() and branch_id = public.current_branch_id());

create policy "postings branch staff update" on public.doctor_branches
  for update
  using (public.is_branch_staff() and branch_id = public.current_branch_id())
  with check (public.is_branch_staff() and branch_id = public.current_branch_id());

-- doctor_schedules ------------------------------------------------------------------
create policy "schedules public read" on public.doctor_schedules
  for select using (is_active = true or public.is_staff());

create policy "schedules doctor write" on public.doctor_schedules
  for all
  using (public.is_my_posting(doctor_branch_id))
  with check (public.is_my_posting(doctor_branch_id));

create policy "schedules branch staff write" on public.doctor_schedules
  for all
  using (public.is_branch_staff() and public.posting_at_my_branch(doctor_branch_id))
  with check (public.is_branch_staff() and public.posting_at_my_branch(doctor_branch_id));

-- doctor_time_off -------------------------------------------------------------------
create policy "time off related read" on public.doctor_time_off
  for select using (
    public.is_my_doctor(doctor_id)
    or (public.is_branch_staff() and (branch_id is null or branch_id = public.current_branch_id()))
  );

create policy "time off doctor write" on public.doctor_time_off
  for all
  using (public.is_my_doctor(doctor_id))
  with check (
    public.is_my_doctor(doctor_id)
    and (branch_id is null or public.doctor_posts_at(doctor_id, branch_id))
  );

create policy "time off branch staff write" on public.doctor_time_off
  for all
  using (public.is_branch_staff() and branch_id = public.current_branch_id())
  with check (public.is_branch_staff() and branch_id = public.current_branch_id());

-- patients --------------------------------------------------------------------------
create policy "patients owner read" on public.patients
  for select using (owner_id = auth.uid());

create policy "patients assigned doctor read" on public.patients
  for select using (public.is_patient_assigned_doctor(id));

create policy "patients staff read" on public.patients
  for select using (public.is_staff() and public.patient_at_my_branch(id));

create policy "patients owner insert" on public.patients
  for insert with check (owner_id = auth.uid());

create policy "patients owner update" on public.patients
  for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "patients owner delete" on public.patients
  for delete using (owner_id = auth.uid());

create policy "patients staff insert" on public.patients
  for insert with check (public.is_branch_staff() and owner_id = auth.uid());

-- appointments ---------------------------------------------------------------------
create policy "appointments patient read" on public.appointments
  for select using (public.is_appointment_owner(id));

create policy "appointments doctor read" on public.appointments
  for select using (public.is_appointment_doctor(id));

create policy "appointments branch staff read" on public.appointments
  for select using (public.is_branch_staff() and branch_id = public.current_branch_id());

create policy "appointments patient insert" on public.appointments
  for insert with check (
    public.is_patient_owner(patient_id)
    and doctor_id is not null
    and branch_id is not null
    and public.doctor_posts_at(doctor_id, branch_id)
  );

create policy "appointments branch staff insert" on public.appointments
  for insert with check (public.is_branch_staff() and branch_id = public.current_branch_id());

create policy "appointments patient update" on public.appointments
  for update
  using (public.is_appointment_owner(id))
  with check (
    public.is_appointment_owner(id)
    and status in ('pending', 'confirmed', 'cancelled')
    and doctor_id = (select old.doctor_id from public.appointments old where old.id = appointments.id)
    and branch_id = (select old.branch_id from public.appointments old where old.id = appointments.id)
    and patient_id = (select old.patient_id from public.appointments old where old.id = appointments.id)
  );

create policy "appointments doctor update" on public.appointments
  for update
  using (public.is_appointment_doctor(id))
  with check (
    public.is_appointment_doctor(id)
    and doctor_id = (select old.doctor_id from public.appointments old where old.id = appointments.id)
    and branch_id = (select old.branch_id from public.appointments old where old.id = appointments.id)
    and patient_id = (select old.patient_id from public.appointments old where old.id = appointments.id)
  );

create policy "appointments branch staff update" on public.appointments
  for update
  using (public.is_branch_staff() and branch_id = public.current_branch_id())
  with check (public.is_branch_staff() and branch_id = public.current_branch_id());

create policy "appointments branch staff delete" on public.appointments
  for delete using (public.is_branch_staff() and branch_id = public.current_branch_id());

-- queue numbers are computed by public.next_queue_number() (counts the caller's
-- visible appointments), so no queue_counters table/policies exist by design.

-- prescriptions --------------------------------------------------------------------
create policy "prescriptions patient read" on public.prescriptions
  for select using (public.is_appointment_owner(appointment_id));

create policy "prescriptions doctor read" on public.prescriptions
  for select using (public.is_appointment_doctor(appointment_id));

create policy "prescriptions branch staff read" on public.prescriptions
  for select using (public.is_branch_staff() and public.is_appointment_at_my_branch(appointment_id));

create policy "prescriptions doctor insert" on public.prescriptions
  for insert with check (
    public.doctor_owns_prescription(appointment_id, doctor_id, patient_id)
    and public.appointment_belongs_to_patient(appointment_id, patient_id)
  );

create policy "prescriptions doctor update" on public.prescriptions
  for update
  using (public.is_appointment_doctor(appointment_id))
  with check (public.doctor_owns_prescription(appointment_id, doctor_id, patient_id));

-- medical_records ------------------------------------------------------------------
create policy "records patient read" on public.medical_records
  for select using (public.is_patient_owner(patient_id));

create policy "records assigned doctor read" on public.medical_records
  for select using (public.is_patient_assigned_doctor(patient_id));

create policy "records branch staff read" on public.medical_records
  for select using (public.is_branch_staff() and public.patient_at_my_branch(patient_id));

create policy "records patient insert" on public.medical_records
  for insert with check (public.is_patient_owner(patient_id) and uploaded_by = auth.uid());

create policy "records staff insert" on public.medical_records
  for insert with check (public.is_branch_staff() and public.patient_at_my_branch(patient_id));

create policy "records owner update" on public.medical_records
  for update
  using (uploaded_by = auth.uid() or public.is_patient_owner(patient_id))
  with check (
    patient_id = (select old.patient_id from public.medical_records old where old.id = medical_records.id)
    and uploaded_by = (select old.uploaded_by from public.medical_records old where old.id = medical_records.id)
  );

create policy "records owner delete" on public.medical_records
  for delete using (uploaded_by = auth.uid());

-- services / announcements --------------------------------------------------------
create policy "services public read" on public.services
  for select using (true);

create policy "services branch write" on public.services
  for all
  using (public.is_branch_staff() and branch_id = public.current_branch_id())
  with check (public.is_branch_staff() and branch_id = public.current_branch_id());

create policy "announcements public read active" on public.announcements
  for select using (
    (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );

create policy "announcements staff read" on public.announcements
  for select using (public.is_staff() and (branch_id is null or branch_id = public.current_branch_id()));

create policy "announcements branch staff write" on public.announcements
  for all
  using (public.is_branch_staff() and branch_id = public.current_branch_id())
  with check (public.is_branch_staff() and branch_id = public.current_branch_id());

-- notifications (patient owns their inbox; staff write within branch) -------------
create policy "notifications owner read" on public.notifications
  for select using (user_id = auth.uid());

create policy "notifications branch staff insert" on public.notifications
  for insert with check (public.is_branch_staff());

create policy "notifications owner update" on public.notifications
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "notifications owner delete" on public.notifications
  for delete using (user_id = auth.uid());

-- reviews --------------------------------------------------------------------------
create policy "reviews public read approved" on public.reviews
  for select using (is_approved = true);

create policy "reviews author read" on public.reviews
  for select using (public.is_patient_owner(patient_id));

create policy "reviews patient insert" on public.reviews
  for insert with check (public.is_patient_owner(patient_id) and public.is_appointment_owner(appointment_id));

create policy "reviews author update" on public.reviews
  for update
  using (public.is_patient_owner(patient_id))
  with check (public.is_patient_owner(patient_id) and is_approved = false);

create policy "reviews staff approve" on public.reviews
  for update
  using (public.is_staff())
  with check (
    public.is_staff()
    and patient_id = (select old.patient_id from public.reviews old where old.id = reviews.id)
    and appointment_id = (select old.appointment_id from public.reviews old where old.id = reviews.id)
  );

-- payments (Razorpay: patients see their own; staff manage at branch) ------------
create policy "payments patient read" on public.payments
  for select using (public.is_appointment_owner(appointment_id));

create policy "payments branch staff read" on public.payments
  for select using (public.is_branch_staff() and public.is_appointment_at_my_branch(appointment_id));

create policy "payments branch staff insert" on public.payments
  for insert
  with check (
    public.is_branch_staff()
    and public.is_appointment_at_my_branch(appointment_id)
    and status in ('unpaid', 'paid')
  );

create policy "payments branch staff update" on public.payments
  for update
  using (public.is_branch_staff() and public.is_appointment_at_my_branch(appointment_id))
  with check (public.is_branch_staff() and public.is_appointment_at_my_branch(appointment_id));

-- audit_logs (written by the postgres/service role; only super_admin reads) -------
create policy "audit super read" on public.audit_logs
  for select using (public.current_role() = 'super_admin');

create policy "audit super insert" on public.audit_logs
  for insert with check (public.current_role() = 'super_admin');

-- super_admin: full access on every table ----------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'branches', 'profiles', 'departments', 'doctors', 'doctor_branches',
    'patients', 'appointments', 'prescriptions',
    'medical_records', 'doctor_schedules', 'doctor_time_off', 'services',
    'announcements', 'notifications', 'reviews', 'payments', 'audit_logs'
  ]
  loop
    execute format(
      'create policy "super all" on public.%I for all using (public.current_role() = ''super_admin'') with check (public.current_role() = ''super_admin'')',
      t
    );
  end loop;
end $$;

-- Storage buckets + object policies (Module 3) -------------------------------------
do $$
begin
  if to_regnamespace('storage') is null then
    raise notice 'storage schema not present (pure Postgres test) — skipping bucket policies';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('avatars', 'avatars', false, 5242880, array['image/png', 'image/jpeg', 'image/webp']),
    ('doctor-photos', 'doctor-photos', true, 5242880, array['image/png', 'image/jpeg', 'image/webp']),
    ('medical-records', 'medical-records', false, 20971520, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
    ('prescriptions', 'prescriptions', false, 20971520, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
  on conflict (id) do nothing;

  -- avatars: everyone may read; only the owner may write inside their own folder.
  drop policy if exists "avatars public read" on storage.objects;
  create policy "avatars public read" on storage.objects
    for select using (bucket_id = 'avatars');

  drop policy if exists "avatars owner write" on storage.objects;
  create policy "avatars owner write" on storage.objects
    for all
    using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1])
    with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

  -- doctor-photos: public catalog reads; owning doctor or staff may write.
  drop policy if exists "doctor photos read" on storage.objects;
  create policy "doctor photos read" on storage.objects
    for select using (bucket_id = 'doctor-photos');

  drop policy if exists "doctor photos write" on storage.objects;
  create policy "doctor photos write" on storage.objects
    for all
    using (
      bucket_id = 'doctor-photos'
      and (
        public.is_staff()
        or exists (
          select 1 from public.doctors d
          where d.profile_id = auth.uid() and d.id::text = (storage.foldername(name))[1]
        )
      )
    )
    with check (
      bucket_id = 'doctor-photos'
      and (
        public.is_staff()
        or exists (
          select 1 from public.doctors d
          where d.profile_id = auth.uid() and d.id::text = (storage.foldername(name))[1]
        )
      )
    );

  -- medical-records / prescriptions: private, patient-foldered via helper predicate.
  drop policy if exists "records folder read" on storage.objects;
  create policy "records folder read" on storage.objects
    for select using (bucket_id = 'medical-records' and public.storage_patient_access((storage.foldername(name))[1]));

  drop policy if exists "records folder write" on storage.objects;
  create policy "records folder write" on storage.objects
    for all
    using (bucket_id = 'medical-records' and public.storage_patient_access((storage.foldername(name))[1]))
    with check (bucket_id = 'medical-records' and public.storage_patient_access((storage.foldername(name))[1]));

  drop policy if exists "prescriptions folder read" on storage.objects;
  create policy "prescriptions folder read" on storage.objects
    for select using (bucket_id = 'prescriptions' and public.storage_patient_access((storage.foldername(name))[1]));

  drop policy if exists "prescriptions folder write" on storage.objects;
  create policy "prescriptions folder write" on storage.objects
    for all
    using (bucket_id = 'prescriptions' and public.storage_patient_access((storage.foldername(name))[1]))
    with check (bucket_id = 'prescriptions' and public.storage_patient_access((storage.foldername(name))[1]));
end $$;