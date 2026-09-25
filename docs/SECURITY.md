# MediNova security operations

## Data classification
Treat patient, appointment, prescription, medical-record, payment, and notification data as sensitive health information. Do not log raw symptoms, phone numbers, or document paths.

## RLS
Run `pnpm test:rls` against an isolated PostgreSQL instance. The suite verifies anon, patient, doctor, receptionist, branch-admin, and super-admin boundaries. Add a regression case for every new table or storage bucket before merging.

## Secrets
Only `VITE_*` values may be used by the web build. `SUPABASE_SERVICE_ROLE_KEY`, JWT secrets, gateway secrets, and Turnstile secrets are API-only. `pnpm test:security` scans source and fails on secret-like literals and server-config imports in the web app.

## Headers and bot protection
The API applies Helmet CSP/HSTS/referrer policy, a strict client-origin CORS allow-list, and request limits. Configure `TURNSTILE_SECRET_KEY` in production; guest booking requires a valid `X-Turnstile-Token`. The secret is never sent to the browser.

## Privacy
Obtain consent before collecting or sharing health information. Provide export and deletion requests through the authenticated privacy workflow. Signed URLs for private files must be short-lived and scoped to the owner/branch/doctor relationship.

## Monitoring
Use Sentry for API/web errors and UptimeRobot or an equivalent uptime check against `/health`. Alert on repeated auth failures, rate-limit spikes, webhook failures, and RLS/audit anomalies.

## Incident response
Revoke affected sessions, rotate Supabase/gateway/Turnstile secrets, preserve audit logs, identify affected records by request/audit IDs, and document the breach and notification decision.
