# Demo accounts & data (UX testing only)

## 0. Apply the schema (required first)

A hosted Supabase project starts empty. Until the migrations run, every API
call returns 404 and no account can be created.

In the **Supabase Dashboard → SQL Editor**, run in this order:

1. `supabase/migrations/0001_foundation.sql`
2. `supabase/migrations/0002_clinical.sql`
3. `supabase/migrations/0003_functions.sql`
4. `supabase/migrations/0004_booking.sql`
5. `supabase/migrations/0005_rls.sql`
6. `supabase/migrations/0006_auth_helpers.sql`
7. `supabase/migrations/0007_rls_policies.sql`
8. `supabase/migrations/0008_doctor_discovery.sql`
9. `supabase/migrations/0009_admin_control.sql`
10. `supabase/migrations/0010_payments.sql`
11. `supabase/migrations/0011_wow_features.sql`
12. `supabase/migrations/0012_realtime.sql`
13. `supabase/seed_01_catalog.sql`
14. `supabase/seed_02_doctors.sql`
15. `supabase/seed_03_postings.sql`

Locally you can use `supabase db push && supabase db reset` instead.

## 1. Create the accounts

Put the **service_role** key (not the publishable key) in a gitignored
`scripts/.env.local`. The seeder reads it automatically, so the key never needs
to be pasted into a terminal or committed:

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
# optional
DEMO_PASSWORD=MediNovaDemo!2026
```

Get the key from **Dashboard → Project Settings → API Keys**. The
`service_role` key starts with `eyJ`; the publishable key starts with
`sb_publishable_` and cannot create users (the seeder rejects it explicitly).

Then run:

```bash
pnpm seed:demo
```

The script is idempotent and prints a credentials table at the end.

> **Still failing after seeding?** Supabase may require email confirmation.
> In **Authentication → Providers → Email**, disable "Confirm email". The
> seeder already sets `email_confirm: true` on every user it creates.

## Create the data

1. Apply `supabase/seed_01_catalog.sql`, `seed_02_doctors.sql`, `seed_03_postings.sql`, then all migrations.
2. Provide server-side environment values (never commit them):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Run:
   ```bash
   pnpm seed:demo
   ```
   The script is idempotent and prints a credentials table at the end.

## Test accounts

Default password: `MediNovaDemo!2026` (override with `DEMO_PASSWORD`).

| Role | Email | Scope |
| --- | --- | --- |
| Patient | patient@demo.medinova | Own data only (default language BN) |
| Doctor | doctor@demo.medinova | Linked to Dr. Tanvir Ahmed |
| Receptionist | reception@demo.medinova | Dhanmondi only |
| Branch admin | admin@demo.medinova | Dhanmondi only |
| Branch admin 2 | admin2@demo.medinova | Chattogram GEC only (isolation test) |
| Super admin | super@demo.medinova | All branches |

## Demo content created

- Patient: Ayesha Rahman (B+, penicillin allergy, mild asthma)
- Family member: Arif Rahman
- 3 live queue appointments today (in consultation / checked in / confirmed)
- 1 completed follow-up yesterday with prescription + approved review
- 1 unpaid homeopathy appointment tomorrow
- Cash payment with receipt number
- Medical record row
- E-queue notification
- Branch announcement
- CMS health tip (EN + BN)
- Audit log entry

## Suggested walkthrough

1. Sign in as patient → Overview, appointments, family, prescription, records, payment, notifications.
2. Sign in as doctor → Today timeline, live queue, call next, prescription builder.
3. Sign in as reception → today table, confirm/check-in, collect payment, print slip, queue display.
4. Sign in as both branch admins to verify branch isolation.
5. Sign in as super admin → overview, doctor onboarding, departments, settings, CMS, audit.

> These accounts are for local/staging only. Never run `pnpm seed:demo` on a production project.
