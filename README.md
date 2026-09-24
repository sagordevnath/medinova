# MediNova — Futuristic Multi-Branch Hospital Platform

> Allopathic + Homeopathic · Multi-branch · BDT (৳) · EN + BN · Asia/Dhaka · PWA + Supabase (free-tier only)

## Monorepo

```
/apps/web        React 18 + Vite + TS + Tailwind + shadcn/ui + Framer Motion + TanStack Query + Router v6 + i18n + Leaflet + Recharts
/apps/api        Node 20 + Express + TS + zod + helmet + cors + rate-limit + pino
/supabase        migrations + seed (Postgres + RLS)
/packages/shared zod schemas + types + constants
/packages/config shared eslint/prettier/ts configs
```

## Quickstart

```bash
pnpm install
pnpm --filter @medinova/shared build
pnpm dev # runs web + api in parallel
```

- Web: http://localhost:5173
- API: http://localhost:4000/health

## Env

Copy `.env.example` → `.env` in `apps/api` and `apps/web`. Never commit service-role keys.

## Conventions

- Strict TS, absolute imports `@/*`, zod env validation, i18n keys only (no hardcoded UI strings).
- Conventional commits. RLS on every table.

## Test plan (foundation)

1. `pnpm --filter @medinova/shared typecheck && build` passes.
2. `pnpm --filter @medinova/api typecheck` passes; `GET /health` returns `{ ok: true }`.
3. `pnpm --filter @medinova/web typecheck && build` passes; `/` renders without console errors in EN + BN, light + dark.
