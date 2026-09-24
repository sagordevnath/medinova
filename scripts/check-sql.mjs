/**
 * Static SQL gate for supabase/migrations + seeds (no database required).
 * Checks: dollar-quote balance, RLS on every created table, required objects.
 * Usage: node scripts/check-sql.mjs   (exit 1 on failure)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = 'supabase';
const files = [
  ...readdirSync(join(root, 'migrations')).filter((f) => f.endsWith('.sql')).map((f) => join(root, 'migrations', f)),
  ...readdirSync(root).filter((f) => f.endsWith('.sql')).map((f) => join(root, f)),
];

const problems = [];
const createdTables = new Set();
const rlsTables = new Set();
let allSql = '';

for (const file of files.sort()) {
  const sql = readFileSync(file, 'utf8');
  allSql += `\n-- FILE ${file}\n${sql}`;

  // Dollar-quote balance ($$ and $tag$).
  const dollarTags = sql.match(/\$[A-Za-z_]*\$/g) ?? [];
  const counts = new Map();
  for (const tag of dollarTags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  for (const [tag, n] of counts) {
    if (n % 2 !== 0) problems.push(`${file}: unbalanced dollar-quote ${tag} (${n} occurrences)`);
  }

  // Parenthesis balance outside dollar quotes / string literals (rough but useful).
  const stripped = sql.replace(/\$[A-Za-z_]*\$[\s\S]*?\$[A-Za-z_]*\$/g, '');
  const open = (stripped.match(/\(/g) ?? []).length;
  const close = (stripped.match(/\)/g) ?? []).length;
  if (open !== close) problems.push(`${file}: unbalanced parentheses (${open} open vs ${close} close)`);

  for (const m of sql.matchAll(/create table(?: if not exists)? public\.([a-z_]+)/g)) createdTables.add(m[1]);
  for (const m of sql.matchAll(/alter table public\.([a-z_]+) enable row level security/g)) rlsTables.add(m[1]);
}

const requiredFunctions = [
  'get_available_slots',
  'book_appointment',
  'next_queue_number',
  'handle_new_user',
  'touch_updated_at',
  'current_role',
  'current_branch_id',
  'is_patient_owner',
];
for (const fn of requiredFunctions) {
  if (!new RegExp(`create or replace function public\\.${fn}\\b`).test(allSql)) {
    problems.push(`missing required function: public.${fn}`);
  }
}

// Storage buckets (Module 3) must be declared with policies.
for (const bucket of ['avatars', 'doctor-photos', 'medical-records', 'prescriptions']) {
  if (!allSql.includes(`'${bucket}'`)) problems.push(`missing storage bucket: ${bucket}`);
}

const requiredEnums = ['medicine_type', 'user_role', 'appt_status', 'visit_type', 'pay_status'];
for (const e of requiredEnums) {
  if (!new RegExp(`create type ${e} as enum`).test(allSql)) problems.push(`missing required enum: ${e}`);
}

if (!/appointments_no_double_book_idx/.test(allSql)) problems.push('missing partial unique index appointments_no_double_book_idx');
if (!/status not in \('cancelled', 'no_show'\)/.test(allSql)) problems.push('partial index predicate missing cancelled/no_show filter');

for (const table of createdTables) {
  if (!rlsTables.has(table)) problems.push(`RLS not enabled for table: public.${table}`);
}

// Seed sanity: expected demo volumes.
const seedDoctors = (allSql.match(/\('(?:[a-z-]+)', '[A-Z][^']*'(?: \(Homeo\))?/g) ?? []).length;
if (!/3 branches|on conflict \(slug\)/.test(allSql)) problems.push('branch seed looks missing');

console.log(`Scanned ${files.length} SQL files`);
console.log(`Tables created: ${createdTables.size} (RLS enabled: ${rlsTables.size})`);
console.log(`Seed doctor-like tuples spotted: ${seedDoctors}`);

if (problems.length) {
  console.error('\nSQL CHECK FAILED:');
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}
console.log('SQL CHECK PASSED');
