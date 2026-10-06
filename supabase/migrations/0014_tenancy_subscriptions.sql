-- ============================================================================
-- Module 14: multi-tenancy + subscriptions (commercial platform).
-- Run AFTER 0013_profile_provisioning.sql. Idempotent.
--
-- Why this exists: the app was single-tenant — one Supabase project served one
-- hospital, so there was no way to sell the product to many clinics. Each
-- subscribing clinic/hospital becomes an `organizations` row; every staff
-- profile and branch is scoped to one via org_id, and RLS keeps tenants apart.
--
-- Roles after this migration:
--   super_admin  platform owner (MediNova). Sees ALL organisations plus the
--                subscription dashboard. Not a tenant member.
--   org_admin    owner/admin of ONE organisation (the subscribing clinic). Full
--                management of its doctors, branches, schedules and fees, but
--                no access to the platform subscription dashboard.
--   branch_admin admin of one branch within an organisation.
--   receptionist / doctor / patient  as before.
-- ============================================================================

-- 1. New roles ----------------------------------------------------------------
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so grow the
-- enum in its own statement rather than inside the DO block below.
alter type public.user_role add value if not exists 'org_admin';

-- 2. Plans --------------------------------------------------------------------
-- The catalogue of purchasable tiers. Features/limits are JSON so a plan can
-- be reshaped without a migration.
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  tagline text,
  -- Prices in BDT paisa (integer) to avoid float rounding on money.
  price_monthly_paisa bigint not null default 0 check (price_monthly_paisa >= 0),
  price_yearly_paisa  bigint not null default 0 check (price_yearly_paisa  >= 0),
  branch_limit int not null default 1 check (branch_limit = -1 or branch_limit >= 1),
  doctor_limit int not null default 1 check (doctor_limit = -1 or doctor_limit >= 1),
  staff_seat_limit int not null default 2 check (staff_seat_limit = -1 or staff_seat_limit >= 1),
  -- Per-month appointment ceiling; -1 means unlimited.
  monthly_appointment_limit int not null default -1,
  features jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.plans
  (code, name, tagline, price_monthly_paisa, price_yearly_paisa,
   branch_limit, doctor_limit, staff_seat_limit, features, sort_order)
values
  ('starter', 'Starter', 'Single-branch clinic getting online booking',
   499900, 4999000, 1, 5, 3,
   '["Online booking","Doctor directory","Appointment reminders","Basic reports"]'::jsonb, 1),
  ('professional', 'Professional', 'Multi-branch clinic with staff and payments',
   1499000, 14990000, 5, 40, 15,
   '["Online booking","Doctor directory","Appointment reminders","Basic reports","Payments","SMS/Email notifications","Queue management","QR check-in"]'::jsonb, 2),
  ('enterprise', 'Enterprise', 'Hospital group with unlimited branches and API access',
   3999000, 39990000, -1, -1, -1,
   '["Online booking","Doctor directory","Appointment reminders","Basic reports","Payments","SMS/Email notifications","Queue management","QR check-in","Telemedicine","AI symptom helper","Custom branding","Priority support"]'::jsonb, 3)
on conflict (code) do update set
  name = excluded.name, tagline = excluded.tagline,
  price_monthly_paisa = excluded.price_monthly_paisa,
  price_yearly_paisa = excluded.price_yearly_paisa,
  branch_limit = excluded.branch_limit, doctor_limit = excluded.doctor_limit,
  staff_seat_limit = excluded.staff_seat_limit, features = excluded.features,
  updated_at = now();

-- 3. Organisations (tenants) --------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  legal_name text,
  contact_email text,
  contact_phone text,
  logo_url text,
  address text,
  city text,
  country text not null default 'Bangladesh',
  timezone text not null default 'Asia/Dhaka',
  currency text not null default 'BDT',
  status text not null default 'active'
    check (status in ('trial', 'active', 'past_due', 'suspended', 'cancelled')),
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 4. Subscriptions ------------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'yearly')),
  -- Price snapshot so historical invoices stay correct after a price change.
  unit_price_paisa bigint not null default 0 check (unit_price_paisa >= 0),
  seats int not null default 1 check (seats >= 1),
  trial_ends_at timestamptz,
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live subscription per organisation (cancelled rows are kept for history).
create unique index if not exists subscriptions_one_live_per_org_idx
  on public.subscriptions (org_id)
  where status in ('trialing', 'active', 'past_due');

-- 5. Subscription events (invoice / payment audit trail) -----------------------
create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  event_type text not null
    check (event_type in ('created', 'activated', 'renewed', 'upgraded', 'downgraded',
                          'cancelled', 'payment_failed', 'payment_succeeded', 'suspended', 'reactivated')),
  amount_paisa bigint not null default 0,
  currency text not null default 'BDT',
  provider text not null default 'manual',
  provider_ref text,
  note text,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists subscription_events_org_idx on public.subscription_events (org_id, created_at desc);

-- 6. Link profiles and branches to an organisation ----------------------------
do $$ begin
  alter table public.profiles add column if not exists org_id uuid references public.organizations(id) on delete set null;
exception when others then null;
end $$;

do $$ begin
  alter table public.branches add column if not exists org_id uuid references public.organizations(id) on delete set null;
exception when others then null;
end $$;

create index if not exists profiles_org_idx on public.profiles (org_id);
create index if not exists branches_org_idx on public.branches (org_id);

-- 7. Backfill: fold the existing seeded branches into one demo organisation so
--    multi-tenant scoping has a tenant to work with on an existing database.
do $$
declare
  v_org_id uuid;
begin
  if exists (select 1 from public.branches where org_id is null limit 1) then
    insert into public.organizations (name, slug, contact_email, status, onboarded_at)
    values ('MediNova Demo Hospital', 'medinova-demo', 'demo@medinova.example', 'active', now())
    on conflict (slug) do update set updated_at = now()
    returning id into v_org_id;

    update public.branches set org_id = v_org_id where org_id is null;

    -- Staff belong to the demo org. Patients stay org-less: they book across
    -- tenants and must not be tenant-scoped.
    update public.profiles set org_id = v_org_id where org_id is null and role not in ('patient', 'super_admin');

    insert into public.subscriptions (org_id, plan_id, status, billing_cycle, unit_price_paisa, seats, current_period_end)
    select v_org_id, p.id, 'active', 'yearly', p.price_yearly_paisa, 15, now() + interval '1 year'
    from public.plans p where p.code = 'professional'
    on conflict do nothing;
  end if;
end $$;

-- 8. Tenant helpers used by RLS ----------------------------------------------
create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_org_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('org_admin', 'branch_admin', 'receptionist')
  );
$$;

create or replace function public.is_org_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'org_admin');
$$;

-- 9. RLS: platform data stays super-admin only --------------------------------
alter table public.organizations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_events enable row level security;
alter table public.plans enable row level security;

-- Plans are readable publicly (pricing page); the rest is platform-private.
drop policy if exists "plans public read" on public.plans;
create policy "plans public read" on public.plans for select
  using (is_active = true or public.current_role() = 'super_admin');

drop policy if exists "orgs super all" on public.organizations;
create policy "orgs super all" on public.organizations for all
  using (public.current_role() = 'super_admin') with check (public.current_role() = 'super_admin');

drop policy if exists "orgs own read" on public.organizations;
create policy "orgs own read" on public.organizations for select using (id = public.current_org_id());

drop policy if exists "subs super all" on public.subscriptions;
create policy "subs super all" on public.subscriptions for all
  using (public.current_role() = 'super_admin') with check (public.current_role() = 'super_admin');

drop policy if exists "subs own read" on public.subscriptions;
create policy "subs own read" on public.subscriptions for select using (org_id = public.current_org_id());

drop policy if exists "events super all" on public.subscription_events;
create policy "events super all" on public.subscription_events for all
  using (public.current_role() = 'super_admin') with check (public.current_role() = 'super_admin');

drop policy if exists "events own read" on public.subscription_events;
create policy "events own read" on public.subscription_events for select using (org_id = public.current_org_id());