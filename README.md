# MediNova — Multi-branch Hospital Platform

Allopathic + Homeopathic care · multi-branch · BDT · EN + BN · PWA.

## Architecture

```text
Browser / PWA ──> Vercel (apps/web SPA)
       │               │
       │ REST + JWT    │ Supabase Realtime
       ▼               ▼
Render Docker API ──> Supabase (Postgres + RLS + Auth + Storage)
       │
       ├─ Resend email
       ├─ bKash / Nagad / SSLCommerz sandbox
       └─ UptimeRobot health monitoring
```

- `apps/web`: React 18, Vite, TypeScript, Tailwind, Router, TanStack Query, i18next, Recharts.
- `apps/api`: Node 20, Express, zod, Helmet, CORS allow-list, rate limits, Pino.
- `supabase`: migrations, seed data, RLS, storage buckets, Realtime publication.
- `packages/shared`: shared schemas, database types, booking rules.

## Local setup

```bash
pnpm install
pnpm --filter @medinova/shared build
cp apps/api/.env.example apps/api/.env
pnpm dev
```

Web: `http://localhost:5173` · API health: `http://localhost:4000/health`

## Supabase

1. Create a project at supabase.com.
2. Apply migrations in order, then run the seed SQL.
3. Set Auth → URL Configuration: Site URL, redirect URLs for the deployed web origin, and `/auth/callback`.
4. Create private buckets: `medical-records`, `prescriptions`; public bucket: `doctor-photos`.
5. Configure SMTP through Resend or another provider for Auth email.
6. Realtime is enabled by `supabase/migrations/0012_realtime.sql`.

## Deploy web (Vercel)

- Import the repository in Vercel.
- Root Directory: `apps/web`
- Framework preset: Vite
- Build command: `pnpm --filter @medinova/web build`
- Output directory: `dist`
- Set `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- `vercel.json` provides SPA fallback and immutable asset caching.

## Deploy API (Render)

- Create a Docker Web Service from the repository root.
- Dockerfile: `apps/api/Dockerfile`
- Docker context: repository root
- Health check: `/health`
- Configure every variable in `render.yaml`; never use the service-role key in the web app.
- UptimeRobot should monitor `/health` every 14 minutes to reduce free-tier cold starts.

## Production checklist

- [ ] Rotate Supabase, JWT, Resend, gateway, and Turnstile keys.
- [ ] Disable demo seed accounts and placeholders.
- [ ] Replace sample doctors, fees, addresses, and photos with real data.
- [ ] Test email, SMS, PDF slip, QR check-in, and each enabled payment sandbox.
- [ ] Load-test booking and slot endpoints.
- [ ] Restore the latest database backup into staging.
- [ ] Configure analytics (Plausible/Umami) with consent.
- [ ] Verify sitemap, robots, HTTPS, custom domain, and Google Business Profile per branch.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm test:security
pnpm check:sql
pnpm build
```
