/**
 * Sweep every .env* file in the repo and report where the service-role key
 * is (and is not) configured, without printing any secret.
 *
 * Usage:
 *   node scripts/check-service-key.mjs            check apps/api/.env only
 *   node scripts/check-service-key.mjs --sweep    check every .env* file
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Agent worktrees mirror the whole repo; scanning them duplicates results and
// reads stale copies of files that may already be fixed.
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.kilo']);
const sweep = process.argv.includes('--sweep');

/** Collect candidate env files, skipping dependency/build directories. */
function findEnvFiles(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findEnvFiles(full, found);
    else if (/^\.env/.test(entry)) found.push(full);
  }
  return found;
}

/** Classify a raw key value without revealing it. */
function classifyKey(key) {
  if (!key) return { ok: false, detail: 'not set' };
  if (key.startsWith('sb_secret_')) return { ok: true, detail: 'sb_secret_ (new-style secret key)' };
  if (key.startsWith('sb_publishable_')) {
    return { ok: false, detail: 'sb_publishable_ - browser-safe key, cannot bypass RLS' };
  }
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const role = JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role;
      if (role === 'service_role') return { ok: true, detail: 'service_role' };
      return { ok: false, detail: `JWT role claim is "${role}", not "service_role"` };
    } catch {
      return { ok: false, detail: 'not a decodable JWT' };
    }
  }
  if (key.startsWith('dev-') || /^<.*>$/.test(key)) {
    return { ok: false, detail: 'placeholder value' };
  }
  // Catch near-misses: a transposed prefix (`ssb_publishable_...`) is a
  // mistyped publishable key, not a service-role key, and is just as useless.
  const typo = key.match(/^s?sb_([a-z]+)_/);
  if (typo) {
    return {
      ok: false,
      detail: `near-miss key "${typo[0]}" - looks like a mistyped sb_${typo[1]}_ key, not service_role`,
    };
  }
  return { ok: false, detail: 'unrecognised key format' };
}

const readVar = (src, name) => {
  const line = src.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : undefined;
};

if (sweep) {
  console.log('Scanning repo for .env* files...\n');
  let found = 0;
  for (const file of findEnvFiles('.')) {
    found++;
    const rel = relative('.', file);
    const src = readFileSync(file, 'utf8');
    const line = src.split(/\r?\n/).find((l) => l.startsWith('SUPABASE_SERVICE_ROLE_KEY='));
    const verdict = line ? classifyKey(line.slice(line.indexOf('=') + 1).trim()) : { ok: false, detail: 'variable absent' };
    const mark = verdict.ok ? 'OK  ' : 'FAIL';
    console.log(`  ${mark} ${rel.padEnd(28)} ${verdict.detail}`);
  }
  console.log(`\n(${found} env file(s) scanned — no secret values printed)`);
  process.exit(0);
}

const envPath = process.argv.find((a) => a.endsWith('.env')) ?? 'apps/api/.env';
const problems = [];

if (!existsSync(envPath)) {
  problems.push(`${envPath} not found. Copy apps/api/.env.example and fill it in.`);
} else {
  const src = readFileSync(envPath, 'utf8');
  const url = readVar(src, 'SUPABASE_URL');
  const verdict = classifyKey(readVar(src, 'SUPABASE_SERVICE_ROLE_KEY'));

  console.log(`env file      : ${envPath}`);
  console.log(`SUPABASE_URL  : ${url ? url : 'NOT SET'}`);
  console.log(`service key   : ${verdict.detail}`);

  if (!url) problems.push('SUPABASE_URL is not set.');
  if (!verdict.ok) {
    problems.push(
      verdict.detail === 'not set'
        ? 'SUPABASE_SERVICE_ROLE_KEY is not set.\n' +
            '  Staff, invoice and encounter routes will read zero tenant rows.\n' +
            '  Supabase Dashboard -> Project Settings -> API -> service_role key.'
        : `SUPABASE_SERVICE_ROLE_KEY is unusable: ${verdict.detail}\n` +
            '  RLS will still apply, so staff routes return no rows.',
    );
  }
}

if (problems.length) {
  console.error('\nSERVICE KEY CHECK FAILED:');
  for (const p of problems) console.error(` - ${p}`);
  process.exitCode = 1;
} else {
  console.log('\nOK: service-role key present, RLS will be bypassed.');
}