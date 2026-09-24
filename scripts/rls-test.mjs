/**
 * Module 3 RLS isolation test on real PostgreSQL (embedded-postgres, dev-only).
 * Proves anon / patient / doctor / branch staff / super_admin data boundaries.
 * Usage: node scripts/rls-test.mjs   (never run in parallel with scripts/db-verify.mjs)
 */
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';

const PORT = 55434;
const DB = 'medinova_rls_test';
const DATA_DIR = '.tmp/pgdata-rls';
const MIGRATIONS = 'supabase/migrations';
const SEEDS = [
  'supabase/seed_01_catalog.sql',
  'supabase/seed_02_doctors.sql',
  'supabase/seed_03_postings.sql',
];

const log = (m) => console.log(m);
let passed = 0;
const failed = [];
function check(cond, name) {
  if (cond) {
    passed += 1;
    log(`  ok   ${name}`);
  } else {
    failed.push(name);
    log(`  FAIL ${name}`);
  }
}

function readAll() {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  return [
    ['supabase/tests/local_auth_stub.sql', readFileSync('supabase/tests/local_auth_stub.sql', 'utf8')],
    ...files.map((f) => [`${MIGRATIONS}/${f}`, readFileSync(join(MIGRATIONS, f), 'utf8')]),
    ...SEEDS.map((f) => [f, readFileSync(f, 'utf8')]),
  ];
}

const portBusy = await new Promise((resolve) => {
  const sock = net.connect(PORT, '127.0.0.1');
  sock.once('connect', () => {
    sock.destroy();
    resolve(true);
  });
  sock.once('error', () => resolve(false));
});
if (portBusy) {
  console.error(`FAIL: port ${PORT} busy (another DB test running?).`);
  process.exit(1);
}
for (let attempt = 0; attempt < 3 && existsSync(DATA_DIR); attempt++) {
  try {
    rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  } catch {
    await new Promise((r) => setTimeout(r, 300));
  }
}

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C', '--lc-ctype=C'],
});

async function connect() {
  const c = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: DB });
  c.on('error', () => {
    /* teardown races can reset sockets; never crash the runner */
  });
  await c.connect();
  return c;
}

async function teardown(admin, code) {
  try {
    if (admin) await admin.end();
  } catch {
    /* ignore */
  }
  try {
    await Promise.race([pg.stop(), new Promise((r) => setTimeout(r, 8000))]);
  } catch {
    /* ignore */
  }
  for (let attempt = 0; attempt < 5 && existsSync(DATA_DIR); attempt++) {
    try {
      rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  log(failed.length || code ? `RLS TEST FAILED (${failed.length} failing)` : `RLS TEST PASSED (${passed} checks)`);
  process.exit(code ?? (failed.length ? 1 : 0));
}

try {
  log('starting embedded postgres (port ' + PORT + ')...');
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB);

  // ---- apply schema ---------------------------------------------------------
  const db = await connect();
  for (const [file, sql] of readAll()) {
    console.log(`  applying ${file} ...`);
    await db.query(sql);
    console.log('    ok');
  }

  // Roles + grants (Supabase does this automatically; plain Postgres does not).
  await db.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema auth to anon, authenticated, service_role;
    grant select on all tables in schema public to anon, authenticated, service_role;
    grant insert, update, delete on all tables in schema public to authenticated, service_role;
    grant execute on all functions in schema public to anon, authenticated, service_role;
  `);

  // ---- fixtures -------------------------------------------------------------
  const uid = () => randomUUID();
  const PAT_A = uid();
  const PAT_B = uid();
  const DOC_PROFILE = uid();
  const REC_PROFILE = uid();
  const SUPER_PROFILE = uid();
  const PA = uid();
  const PB = uid();
  const APPT_A = uid();
  const APPT_B = uid();
  const RX_A = uid();
  const RX_B = uid();
  const RECROW_A = uid();
  const RECROW_B = uid();
  const NOTE_A = uid();
  const NOTE_B = uid();
  const REV_A = uid();
  const REV_B = uid();

  const posts = await db.query(
    'select db.id, db.branch_id, db.doctor_id from public.doctor_branches db order by db.created_at',
  );
  const postA = posts.rows[0];
  const postB = posts.rows.find((r) => r.branch_id !== postA.branch_id && r.doctor_id !== postA.doctor_id);
  if (!postB) throw new Error('seed must provide postings at >=2 branches with different doctors');
  log(`  fixtures: branchA=${postA.branch_id} branchB=${postB.branch_id}`);

  // auth.users rows fire handle_new_user -> profiles (role patient).
  await db.query(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${PAT_A}', 'pat-a@test.local', '{"full_name":"Patient A"}'),
      ('${PAT_B}', 'pat-b@test.local', '{"full_name":"Patient B"}'),
      ('${DOC_PROFILE}', 'doc@test.local', '{"full_name":"Dr Test"}'),
      ('${REC_PROFILE}', 'rec@test.local', '{"full_name":"Reception Test"}'),
      ('${SUPER_PROFILE}', 'super@test.local', '{"full_name":"Super Test"}')
    on conflict (id) do nothing;
    update public.profiles set role = 'doctor', full_name = 'Dr Test' where id = '${DOC_PROFILE}';
    update public.profiles set role = 'receptionist', branch_id = '${postA.branch_id}' where id = '${REC_PROFILE}';
    update public.profiles set role = 'super_admin' where id = '${SUPER_PROFILE}';
    update public.doctors set profile_id = '${DOC_PROFILE}' where id = '${postA.doctor_id}';
    insert into public.patients (id, owner_id, full_name) values
      ('${PA}', '${PAT_A}', 'Patient A'),
      ('${PB}', '${PAT_B}', 'Patient B');
    insert into public.appointments (id, code, patient_id, doctor_id, branch_id, doctor_branch_id, appt_date, slot_start, slot_end, visit_type, status, fee) values
      ('${APPT_A}', 'MN-RLS-A', '${PA}', '${postA.doctor_id}', '${postA.branch_id}', '${postA.id}', (current_date + 7)::date, '10:00', '10:15', 'new', 'pending', 800),
      ('${APPT_B}', 'MN-RLS-B', '${PB}', '${postB.doctor_id}', '${postB.branch_id}', '${postB.id}', (current_date + 7)::date, '11:00', '11:15', 'new', 'pending', 800);
    insert into public.prescriptions (id, appointment_id, doctor_id, patient_id, diagnosis) values
      ('${RX_A}', '${APPT_A}', '${postA.doctor_id}', '${PA}', 'dx A'),
      ('${RX_B}', '${APPT_B}', '${postB.doctor_id}', '${PB}', 'dx B');
    insert into public.medical_records (id, patient_id, uploaded_by, title, type, file_path) values
      ('${RECROW_A}', '${PA}', '${PAT_A}', 'lab A', 'lab', 'a.pdf'),
      ('${RECROW_B}', '${PB}', '${PAT_B}', 'lab B', 'lab', 'b.pdf');
    insert into public.notifications (id, user_id, channel, title) values
      ('${NOTE_A}', '${PAT_A}', 'inapp', 'note A'),
      ('${NOTE_B}', '${PAT_B}', 'inapp', 'note B');
    insert into public.reviews (id, appointment_id, doctor_id, patient_id, rating, is_approved) values
      ('${REV_A}', '${APPT_A}', '${postA.doctor_id}', '${PA}', 5, false),
      ('${REV_B}', '${APPT_B}', '${postB.doctor_id}', '${PB}', 4, true);
    insert into public.audit_logs (actor_id, action, entity) values ('${PAT_A}', 'rls_test', 'appointments');
  `);

  // Run as a Supabase-style principal; RLS denials surface as error/rowCount 0.
  async function as(role, sub, sql, params) {
    const c = await connect();
    try {
      await c.query('begin');
      if (role === 'anon') {
        await c.query('set local role anon');
        await c.query(`select set_config('request.jwt.claim.sub', '', true)`);
        await c.query(`select set_config('request.jwt.claim.role', 'anon', true)`);
      } else if (role === 'service_role') {
        await c.query('set local role service_role');
        await c.query(`select set_config('request.jwt.claim.sub', '', true)`);
        await c.query(`select set_config('request.jwt.claim.role', 'service_role', true)`);
      } else {
        await c.query('set local role authenticated');
        await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub ?? '']);
        await c.query(`select set_config('request.jwt.claim.role', 'authenticated', true)`);
      }
      const r = await c.query(sql, params);
      await c.query('commit');
      return { rowCount: r.rowCount, rows: r.rows, error: null };
    } catch (e) {
      try {
        await c.query('rollback');
      } catch {
        /* ignore */
      }
      return { rowCount: 0, rows: [], error: e.message };
    } finally {
      try {
        await c.end();
      } catch {
        /* ignore */
      }
    }
  }

  const FIX = {
    PAT_A, PAT_B, DOC_PROFILE, REC_PROFILE, SUPER_PROFILE,
    PA, PB, APPT_A, APPT_B, RX_A, RX_B, RECROW_A, RECROW_B, NOTE_A, NOTE_B, REV_A, REV_B,
    postA, postB, as,
  };

  // ---- assertions: anonymous ------------------------------------------------
  log('anonymous:');
  let r = await as('anon', null, 'select id from public.appointments');
  check(!r.error && r.rowCount === 0, 'anon sees zero appointments');
  r = await as('anon', null, 'select id from public.patients');
  check(!r.error && r.rowCount === 0, 'anon sees zero patients');
  r = await as('anon', null, 'select id from public.prescriptions');
  check(!r.error && r.rowCount === 0, 'anon sees zero prescriptions');
  r = await as('anon', null, 'select id from public.medical_records');
  check(!r.error && r.rowCount === 0, 'anon sees zero medical records');
  r = await as('anon', null, 'select id from public.notifications');
  check(!r.error && r.rowCount === 0, 'anon sees zero notifications');
  r = await as('anon', null, 'select id from public.profiles');
  check(!r.error && r.rowCount === 0, 'anon sees zero profiles');
  r = await as('anon', null, 'select id from public.audit_logs');
  check(!r.error && r.rowCount === 0, 'anon sees zero audit logs');
  r = await as('anon', null, 'select id from public.branches');
  check(!r.error && r.rowCount >= 3, 'anon reads public branch catalog');
  r = await as('anon', null, 'select id from public.doctors');
  check(!r.error && r.rowCount >= 10, 'anon reads public doctor catalog');
  r = await as('anon', null, 'select id from public.reviews');
  check(!r.error && r.rowCount === 1, 'anon sees only the approved review');
  r = await as('anon', null, `update public.appointments set status = 'confirmed' where id = '${FIX.APPT_A}'`);
  check(Boolean(r.error), 'anon cannot update appointments');

  // ---- assertions: patient A vs patient B ----------------------------------
  log('patient A vs patient B:');
  r = await as('auth', FIX.PAT_A, 'select id from public.patients');
  check(!r.error && r.rowCount === 1 && r.rows[0].id === FIX.PA, 'patient A sees only their own patient row');
  r = await as('auth', FIX.PAT_A, `select id from public.patients where id = '${FIX.PB}'`);
  check(!r.error && r.rowCount === 0, 'patient A cannot read patient B');
  r = await as('auth', FIX.PAT_A, 'select id from public.appointments');
  check(!r.error && r.rowCount === 1 && r.rows[0].id === FIX.APPT_A, 'patient A sees only their appointment');
  r = await as('auth', FIX.PAT_A, `select id from public.appointments where id = '${FIX.APPT_B}'`);
  check(!r.error && r.rowCount === 0, 'patient A cannot read patient B appointment');
  r = await as('auth', FIX.PAT_A, 'select id from public.prescriptions');
  check(!r.error && r.rowCount === 1 && r.rows[0].id === FIX.RX_A, 'patient A sees only their prescriptions');
  r = await as('auth', FIX.PAT_A, 'select id from public.medical_records');
  check(!r.error && r.rowCount === 1, 'patient A sees only their medical records');
  r = await as('auth', FIX.PAT_A, 'select id from public.notifications');
  check(!r.error && r.rowCount === 1, 'patient A sees only their notifications');
  r = await as('auth', FIX.PAT_A, 'select id from public.profiles');
  check(!r.error && r.rowCount === 1, 'patient A sees only their profile');
  r = await as('auth', FIX.PAT_A, 'select id from public.reviews');
  check(!r.error && r.rowCount === 2, 'patient A sees approved review + own pending review');
  r = await as('auth', FIX.PAT_A, `update public.profiles set role = 'super_admin' where id = '${FIX.PAT_A}'`);
  check(Boolean(r.error), 'patient A cannot escalate their own role');
  r = await as(
    'auth',
    FIX.PAT_A,
    `insert into public.medical_records (patient_id, uploaded_by, title, type, file_path) values ('${FIX.PB}', '${FIX.PAT_A}', 'x', 'lab', 'x.pdf')`,
  );
  check(Boolean(r.error), 'patient A cannot upload into patient B record');
  r = await as(
    'auth',
    FIX.PAT_A,
    `insert into public.medical_records (patient_id, uploaded_by, title, type, file_path) values ('${FIX.PA}', '${FIX.PAT_A}', 'own', 'lab', 'own.pdf')`,
  );
  check(!r.error && r.rowCount === 1, 'patient A can upload their own record');
  r = await as('auth', FIX.PAT_A, `update public.appointments set status = 'cancelled' where id = '${FIX.APPT_A}'`);
  check(!r.error && r.rowCount === 1, 'patient A can cancel their own appointment');
  r = await as('auth', FIX.PAT_A, `update public.appointments set doctor_id = '${FIX.postB.doctor_id}' where id = '${FIX.APPT_A}'`);
  check(Boolean(r.error) || r.rowCount === 0, 'patient A cannot reassign their appointment doctor');

  // ---- assertions: doctor ---------------------------------------------------
  log('doctor:');
  r = await as('auth', FIX.DOC_PROFILE, 'select id from public.appointments');
  check(!r.error && r.rowCount === 1 && r.rows[0].id === FIX.APPT_A, 'doctor sees only assigned appointments');
  r = await as('auth', FIX.DOC_PROFILE, `select id from public.appointments where id = '${FIX.APPT_B}'`);
  check(!r.error && r.rowCount === 0, 'doctor cannot read foreign appointment');
  r = await as('auth', FIX.DOC_PROFILE, 'select id from public.patients');
  check(!r.error && r.rowCount === 1 && r.rows[0].id === FIX.PA, 'doctor sees only assigned patients');
  r = await as('auth', FIX.DOC_PROFILE, 'select id from public.prescriptions');
  check(!r.error && r.rowCount === 1 && r.rows[0].id === FIX.RX_A, 'doctor sees only own prescriptions');
  r = await as(
    'auth',
    FIX.DOC_PROFILE,
    `insert into public.prescriptions (appointment_id, doctor_id, patient_id, diagnosis) values ('${FIX.APPT_A}', '${FIX.postA.doctor_id}', '${FIX.PA}', 'new dx')`,
  );
  check(!r.error && r.rowCount === 1, 'doctor can prescribe for own appointment');
  r = await as(
    'auth',
    FIX.DOC_PROFILE,
    `insert into public.prescriptions (appointment_id, doctor_id, patient_id, diagnosis) values ('${FIX.APPT_B}', '${FIX.postA.doctor_id}', '${FIX.PB}', 'forged')`,
  );
  check(Boolean(r.error), 'doctor cannot prescribe for foreign appointment');
  r = await as('auth', FIX.DOC_PROFILE, `update public.appointments set status = 'confirmed' where id = '${FIX.APPT_B}'`);
  check(Boolean(r.error) || r.rowCount === 0, 'doctor cannot update foreign appointment');
  r = await as('auth', FIX.DOC_PROFILE, `update public.appointments set status = 'confirmed' where id = '${FIX.APPT_A}'`);
  check(!r.error && r.rowCount === 1, 'doctor can confirm own appointment');

  // ---- assertions: receptionist (branch A) ---------------------------------
  log('receptionist (branch A):');
  r = await as('auth', FIX.REC_PROFILE, 'select id from public.appointments');
  check(!r.error && r.rowCount === 1 && r.rows[0].id === FIX.APPT_A, 'receptionist sees only branch-A appointments');
  r = await as('auth', FIX.REC_PROFILE, `update public.appointments set status = 'confirmed' where id = '${FIX.APPT_B}'`);
  check(Boolean(r.error) || r.rowCount === 0, 'receptionist cannot update branch-B appointment');
  r = await as('auth', FIX.REC_PROFILE, `update public.appointments set status = 'confirmed' where id = '${FIX.APPT_A}'`);
  check(!r.error && r.rowCount === 1, 'receptionist can update branch-A appointment');
  r = await as('auth', FIX.REC_PROFILE, 'select public.current_role()::text as role, public.current_branch_id()::text as branch');
  check(
    !r.error && r.rows[0] && r.rows[0].role === 'receptionist' && r.rows[0].branch === FIX.postA.branch_id,
    'helper functions resolve role + branch',
  );
  r = await as('auth', FIX.REC_PROFILE, 'select id from public.audit_logs');
  check(!r.error && r.rowCount === 0, 'receptionist cannot read audit logs');
  r = await as('auth', FIX.REC_PROFILE, 'select id from public.profiles');
  check(!r.error && r.rowCount >= 5, 'branch staff can read profiles');
  r = await as('auth', FIX.REC_PROFILE, `select id from public.patients where id = '${FIX.PB}'`);
  check(Boolean(r.error) || r.rowCount === 0, 'receptionist cannot read patient outside own branch');

  // ---- assertions: super_admin + service_role ------------------------------
  log('super_admin + service_role:');
  r = await as('auth', FIX.SUPER_PROFILE, 'select id from public.appointments');
  check(!r.error && r.rowCount === 2, 'super_admin reads all appointments');
  r = await as('auth', FIX.SUPER_PROFILE, 'select id from public.patients');
  check(!r.error && r.rowCount === 2, 'super_admin reads all patients');
  r = await as('auth', FIX.SUPER_PROFILE, 'select id from public.audit_logs');
  check(!r.error && r.rowCount === 1, 'super_admin reads audit logs');
  r = await as('auth', FIX.SUPER_PROFILE, 'select id from public.profiles');
  check(!r.error && r.rowCount >= 5, 'super_admin reads all profiles');
  r = await as('service_role', null, 'select id from public.appointments');
  check(!r.error && r.rowCount === 2, 'service_role bypasses RLS');
  await teardown(db, 0);
} catch (e) {
  console.error('FAIL:', e && e.message);
  await teardown(null, 1);
}