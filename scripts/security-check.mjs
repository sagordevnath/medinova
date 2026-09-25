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
if (failures) process.exit(1); pass(`security static checks (${files.length} files scanned)`);
