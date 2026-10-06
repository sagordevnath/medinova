#!/usr/bin/env node
/**
 * Pre-flight diagnostics for demo login.
 *
 * Read-only: never writes, never needs the service-role key. Checks that the
 * hosted Supabase project is actually ready for `pnpm seed:demo` + sign-in.
 *
 * Usage: node scripts/check-auth.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function loadLocalEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    if (v && process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadLocalEnv(join(here, '.env.local'));
loadLocalEnv(join(here, '..', '.env.local'));

// The web app is what the browser actually uses — read the same file.
const webEnvFile = join(root, 'apps/web/.env');
loadLocalEnv(webEnvFile);

const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon = process.env.VITE_SUPABASE_ANON_KEY;
const password = process.env.DEMO_PASSWORD ?? 'MediNovaDemo!2026';
const email = process.env.DEMO_EMAIL ?? 'patient@demo.medinova';

let failures = 0;
const ok = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const bad = (m) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`); };
const warn = (m) => console.log(`  \x1b[33mWARN\x1b[0m  ${m}`);

console.log('\nMediNova demo-login diagnostics\n');

console.log('1. Configuration');
if (url) ok(`Supabase URL: ${url}`);
else bad('No Supabase URL (set VITE_SUPABASE_URL in apps/web/.env)');
if (anon) ok('Publishable/anon key present (browser-safe)');
else bad('No anon key in apps/web/.env');
/**
 * A usable service-role key must be non-empty, not a `<placeholder>`, and not
 * the publishable/anon key (which cannot create users and silently fails).
 */
function isRealKey(v) {
  if (!v) return false;
  const t = String(v).trim();
  if (/^<.*>$/.test(t) || t.length < 20) return false;
  if (t.startsWith('sb_publishable_')) return false;
  if (anon && t === anon) return false;
  return true;
}

if (key && isRealKey(key)) ok('Service-role key present (for pnpm seed:demo)');
else {
  warn('scripts/.env.local has no usable service-role key -> `pnpm seed:demo` cannot run.');
  if (key && key.trim() === (anon ?? '')) {
    bad('SUPABASE_SERVICE_ROLE_KEY currently holds the PUBLISHABLE key (sb_publishable_/same as anon).');
  }
  console.log('           Fix: Dashboard -> Project Settings -> API Keys -> service_role,');
  console.log('           then replace the value in scripts/.env.local. Never paste the key in chat.');
}

if (!url || !anon) { console.log('\nFix the .env values first.\n'); process.exit(1); }

const headers = { apikey: anon, 'Content-Type': 'application/json' };

console.log('\n2. Auth settings');
let autoconfirm = null;
try {
  const r = await fetch(`${url}/auth/v1/settings`, { headers });
  const s = await r.json();
  autoconfirm = s.mailer_autoconfirm;
  if (s.external?.email === false) {
    bad('The Email PROVIDER itself is disabled -> every email sign-in fails.');
    console.log('           Fix: Dashboard -> Authentication -> Providers -> Email -> enable the Email provider,');
    console.log('           and separately leave "Confirm email" OFF for local testing.');
  } else ok('Email provider enabled');
  if (s.mailer_autoconfirm) ok('Email confirmation disabled ("Confirm email" is off)');
  else bad('"Confirm email" is ON -> accounts cannot sign in until confirmed.\n           Fix: Dashboard -> Authentication -> Providers -> Email -> uncheck "Confirm email".');
} catch (e) {
  bad(`Could not reach auth settings: ${e.message}`);
}

console.log('\n3. Database schema');
let schemaOk = true;
for (const table of ['profiles', 'branches', 'doctors', 'appointments']) {
  const r = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  });
  if (r.status === 404) { bad(`Table "${table}" missing`); schemaOk = false; }
  else if (!r.ok) { warn(`Table "${table}" -> HTTP ${r.status}`); }
  else ok(`Table "${table}" exists`);
}
if (!schemaOk) {
  console.log('\n           Fix: Dashboard -> SQL Editor, run supabase/migrations/0001..0012\n           then seed_01_catalog.sql, seed_02_doctors.sql, seed_03_postings.sql');
}

console.log('\n4. Demo account sign-in');
const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers, body: JSON.stringify({ email, password }),
});
const body = await r.text();
if (r.ok) {
  ok(`${email} can sign in`);
} else {
  let code = '';
  try { code = JSON.parse(body).error_code ?? ''; } catch { /* non-JSON */ }
  if (code === 'email_not_confirmed') {
    bad(`${email} exists but is NOT email-confirmed`);
    console.log('           Fix: Dashboard -> Authentication -> Users -> tick this user, or disable "Confirm email".');
  } else if (code === 'email_provider_disabled') {
    bad('The Email provider is disabled -> all email sign-ins fail.');
    console.log('           Fix: Dashboard -> Authentication -> Providers -> Email -> enable the Email provider.');
  } else if (code === 'invalid_credentials') {
    bad(`${email} does not exist yet -> run: pnpm seed:demo`);
  } else {
    bad(`Sign-in failed: ${code || r.status} ${body.slice(0, 160)}`);
  }
}

console.log(
  failures === 0
    ? '\n\x1b[32mAll checks passed - login should work.\x1b[0m\n'
    : `\n\x1b[31m${failures} check(s) failed\x1b[0m - see the fixes above.\n`,
);
process.exit(failures === 0 ? 0 : 1);
