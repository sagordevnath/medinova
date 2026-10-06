// Module 14: static security gates that run without a live Supabase project.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const files = [];
function walk(dir) { if (!existsSync(dir)) return; for (const n of readdirSync(dir)) { const p = join(dir, n); if (n === 'node_modules' || n === 'dist' || n.startsWith('.tmp')) continue; const s = statSync(p); if (s.isDirectory()) walk(p); else if (/\.(ts|tsx|js|mjs|json)$/.test(n)) files.push(p); } }
walk('apps'); walk('packages'); walk('supabase');
let failures = 0;
const fail = (m) => { console.error(`FAIL ${m}`); failures++; };
const pass = (m) => console.log(`ok   ${m}`);
for (const f of files) { const text = readFileSync(f, 'utf8'); if (/(SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|service_role_key|sk_live_|sk_test_)\s*[:=]\s*['"][^'"]+/i.test(text)) fail(`${f} contains a secret-like literal`); if (/from ['"]\.\.?\/.*(config|env)/i.test(text) && /apps[\\/]web/.test(f)) fail(`${f} imports server environment config`); }
const migrations = readdirSync('supabase/migrations').filter(x => x.endsWith('.sql')).map(x => readFileSync(join('supabase/migrations', x), 'utf8')).join('\n');
for (const table of ['patients','appointments','prescriptions','medical_records','notifications','payments','profiles']) { if (!migrations.includes(`on public.${table}`) && !migrations.includes(`alter table public.${table} enable row level security`)) fail(`missing RLS evidence for ${table}`); }
if (!migrations.includes('super all') || !migrations.includes('storage.objects')) fail('missing super-admin/storage policy evidence');
if (!existsSync('docs/SECURITY.md')) fail('missing docs/SECURITY.md');
if (!existsSync('scripts/backup-postgres.ps1')) fail('missing weekly backup script');

// Committed env templates must never carry a real key value. An anon key
// pasted into the SUPABASE_SERVICE_ROLE_KEY slot is the specific trap here: it
// is a valid 200-char JWT, so nothing rejects it, but RLS still applies and
// staff routes silently read no rows.
for (const f of ['apps/api/.env.example', 'apps/web/.env.example']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) continue;
    const value = line.slice('SUPABASE_SERVICE_ROLE_KEY='.length).trim();
    if (!value) continue; // empty placeholder is correct
    let role = null;
    if (value.split('.').length === 3) {
      try { role = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString()).role; } catch { /* ignore */ }
    }
    fail(`${f} has a SUPABASE_SERVICE_ROLE_KEY value (role=${role ?? 'unknown'}); templates must ship it empty`);
  }
  // The publishable key is browser-safe and meant to be committed.
  if (existsSync('apps/web/.env.example') && /SUPABASE_SERVICE_ROLE_KEY=/.test(readFileSync('apps/web/.env.example', 'utf8'))) {
    fail('apps/web/.env.example declares SUPABASE_SERVICE_ROLE_KEY; a server secret must never reach the browser bundle');
  }
}
if (failures) process.exit(1); pass(`security static checks (${files.length} files scanned)`);
