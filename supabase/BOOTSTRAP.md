# Applying the schema to a hosted Supabase project

The SQL editor runs **SQL only** — typing a file path like
`supabase/migrations/0001–0012` produces
`ERROR: 42601: syntax error at or near "supabase"`.

## Steps

1. Dashboard → **SQL Editor** → **New query**
2. Open `supabase/bootstrap-1.sql`, copy the **whole file**, paste, **Run**
3. Repeat for `bootstrap-2.sql`, then `bootstrap-3.sql`

Run them **in order** and **exactly once**. The `create table` statements do not
use `if not exists`, so a second run fails with "relation already exists".

| File | Contains | Size |
| --- | --- | --- |
| `bootstrap-1.sql` | `0001`–`0006` schema, functions, RLS, auth helpers | ~34 KB |
| `bootstrap-2.sql` | `0007`–`0012` RLS policies, admin, payments, realtime | ~24 KB |
| `bootstrap-3.sql` | `seed_01`–`seed_03` catalog, doctors, postings | ~13 KB |

They are plain concatenations of the originals with `-- ======== filename ========`
markers, so you can also run the source files individually in the same order.

## If a part fails midway

Postgres runs each statement in its own transaction, so a failed part leaves
earlier statements applied. The simplest fix is to reset the project and start
over:

Dashboard → **Settings → Database → Reset database** (or
`supabase db reset` locally).

## 4. Create demo accounts and data

Run **`supabase/demo_data.sql`** the same way (copy whole file → SQL Editor → Run).

It creates 6 real login accounts and demo content for every role.

| Role | Email | Scope |
| --- | --- | --- |
| Patient | `patient@demo.medinova` | 4 family patients, appointments, records |
| Doctor | `doctor@demo.medinova` | Linked to Dr. Tanvir Ahmed |
| Receptionist | `reception@demo.medinova` | Dhanmondi only |
| Branch admin | `admin@demo.medinova` | Dhanmondi only |
| Branch admin 2 | `admin2@demo.medinova` | Chattogram GEC only (isolation test) |
| Super admin | `super@demo.medinova` | All branches |

Password for all: `MediNovaDemo!2026`

Also created: 4 demo patients, 6 appointments (today → +2 days) covering
`confirmed` / `checked_in` / `pending` and new / followup / telemedicine, a
prescription, a bKash payment, a lab report, 4 notifications and an
announcement.

The file is re-runnable — every insert is guarded by `NOT EXISTS`.

> It writes directly to `auth.users` and sets `email_confirmed_at`, so sign-in
> works even while "Confirm email" is ON. Use it on a test project only.


```bash
pnpm check:auth
```

Section 3 ("Database schema") must show `PASS` for `profiles`, `branches`,
`doctors`, and `appointments`.
