/**
 * Local end-to-end verification of the Module 2 database on real PostgreSQL
 * (embedded-postgres, dev-only, no Docker required).
 *
 * Verifies: migrations + seeds apply, get_available_slots() returns slots,
 * two concurrent book_appointment() calls -> 1 success + SLOT_TAKEN, fee/queue.
 *
 * Usage: node scripts/db-verify.mjs
 */
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';

const PORT = 55433;
const DB = 'medinova_test';
const DATA_DIR = '.tmp/pgdata';
const MIGRATIONS = 'supabase/migrations';
const SEEDS = [
  'supabase/seed_01_catalog.sql',
  'supabase/seed_02_doctors.sql',
  'supabase/seed_03_postings.sql',
];

const log = (m) => console.log(m);
const fail = (m) => {
  console.error(`FAIL: ${m}`);
  process.exitCode = 1;
};

function readAll() {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  return [
    ['supabase/tests/local_auth_stub.sql', readFileSync('supabase/tests/local_auth_stub.sql', 'utf8')],
    ...files.map((f) => [`${MIGRATIONS}/${f}`, readFileSync(join(MIGRATIONS, f), 'utf8')]),
    ...SEEDS.map((f) => [f, readFileSync(f, 'utf8')]),
  ];
}

// Fail fast with a clear message when a stale postgres still holds the port
// (Windows: leftover `--forkchild` processes cause confusing initdb FATALs).
const portBusy = await new Promise((resolve) => {
  const sock = net.connect(PORT, '127.0.0.1');
  sock.once('connect', () => {
    sock.destroy();
    resolve(true);
  });
  sock.once('error', () => resolve(false));
});
if (portBusy) {
  console.error(
    `FAIL: port ${PORT} is already in use (stale postgres from a previous run?). ` +
      'Kill leftover postgres.exe processes and delete .tmp, then retry.',
  );
  process.exit(1);
}

if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C', '--lc-ctype=C'],
});

async function connect() {
  const client = new Client({
    host: '127.0.0.1',
    port: PORT,
    user: 'postgres',
    password: 'postgres',
    database: DB,
  });
  await client.connect();
  return client;
}

try {
  log('starting embedded postgres...');
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB);
  const admin = await connect();

  for (const [file, sql] of readAll()) {
    process.stdout.write(`  applying ${file} ... `);
    await admin.query(sql);
    log('ok');
  }

  // ---- 1. catalog seeded -------------------------------------------------
  const ctx = await admin.query(`
    select db.id as doctor_branch_id, db.branch_id, db.doctor_id,
           (current_date + 7)::date as appt_date
    from public.doctor_branches db
    join public.doctor_schedules s2 on s2.doctor_branch_id = db.id
    where s2.weekday = extract(dow from (current_date + 7))::int
    limit 1`);
  if (ctx.rowCount === 0) throw new Error('no seeded posting with a schedule on the target weekday');
  const dbId = ctx.rows[0].doctor_branch_id;
  const apptDate = ctx.rows[0].appt_date;
  log(`  context: posting=${dbId} date=${apptDate}`);

  const counts = await admin.query(`
    select (select count(*) from public.branches) branches,
           (select count(*) from public.departments) departments,
           (select count(*) from public.doctors) doctors,
           (select count(*) from public.doctor_branches) postings,
           (select count(*) from public.doctor_schedules) schedules,
           (select count(*) from public.services) services`);
  log(`  seeded: ${JSON.stringify(counts.rows[0])}`);

  // ---- 2. slots ----------------------------------------------------------
  const slots = await admin.query('select * from public.get_available_slots($1, $2)', [dbId, apptDate]);
  if (slots.rowCount === 0) throw new Error('get_available_slots returned 0 rows');
  const available = slots.rows.filter((r) => r.is_available);
  if (available.length === 0) throw new Error('no available slots for a future date');
  log(`PASS: get_available_slots -> ${slots.rowCount} slots (${available.length} available)`);

  // ---- 3. concurrent booking --------------------------------------------
  const owner1 = await admin.query(`insert into auth.users (email) values ('p1@medinova.test') returning id`);
  const owner2 = await admin.query(`insert into auth.users (email) values ('p2@medinova.test') returning id`);
  const patient1 = (
    await admin.query('insert into public.patients (owner_id, full_name) values ($1,$2) returning id', [
      owner1.rows[0].id,
      'Test Patient One',
    ])
  ).rows[0].id;
  const patient2 = (
    await admin.query('insert into public.patients (owner_id, full_name) values ($1,$2) returning id', [
      owner2.rows[0].id,
      'Test Patient Two',
    ])
  ).rows[0].id;

  const slot = available[0].slot_start;
  const c1 = await connect();
  const c2 = await connect();
  const book = (c, patientId) =>
    c.query('select * from public.book_appointment($1,$2,$3,$4,$5,$6)', [
      patientId,
      dbId,
      apptDate,
      slot,
      'new',
      'concurrency test',
    ]);

  const results = await Promise.allSettled([book(c1, patient1), book(c2, patient2)]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const errs = results.filter((r) => r.status === 'rejected');
  log(`  slot=${slot} ok=${ok.length} rejected=${errs.length}`);
  if (ok.length !== 1) fail(`expected exactly 1 successful booking, got ${ok.length}`);
  if (errs.length !== 1) fail(`expected exactly 1 rejected booking, got ${errs.length}`);
  else if (errs[0].reason?.message !== 'SLOT_TAKEN') fail(`expected SLOT_TAKEN, got ${errs[0].reason?.message}`);
  else log('PASS: concurrent double-book -> 1 success + SLOT_TAKEN');

  const booked = ok[0]?.value.rows[0];
  if (booked) log(`  booked: code=${booked.code} queue=${booked.queue_no} fee=${booked.fee} status=${booked.status}`);
  await c1.end();
  await c2.end();

  // ---- 4. booked slot hidden --------------------------------------------
  const again = await admin.query('select * from public.get_available_slots($1,$2) where slot_start = $3', [
    dbId,
    apptDate,
    slot,
  ]);
  if (again.rows[0]?.is_available !== false) fail('booked slot still reported available');
  else log('PASS: booked slot now unavailable');



  // ---- 5. follow-up fee + queue numbering --------------------------------
  const fuDateRow = await admin.query(
    `select (current_date + 14)::date as d,
            (select count(*)::int from public.doctor_schedules s
              where s.doctor_branch_id = $1
                and s.weekday = extract(dow from (current_date + 14))::int) as scheds`,
    [dbId],
  );
  const fuDate = fuDateRow.rows[0].d;
  const daysApart = 14 - 7;
  const winnerPatient = booked?.patient_id === patient1 ? patient1 : patient2;
  if (fuDateRow.rows[0].scheds > 0) {
    const fuSlot = await admin.query(
      'select slot_start from public.get_available_slots($1,$2) where is_available order by slot_start limit 1',
      [dbId, fuDate],
    );
    const fu = await admin.query('select * from public.book_appointment($1,$2,$3,$4,$5,$6)', [
      winnerPatient,
      dbId,
      fuDate,
      fuSlot.rows[0].slot_start,
      'followup',
      'follow up',
    ]);
    const fuRow = fu.rows[0];
    const fees = await admin.query(
      'select consultation_fee, followup_fee, followup_valid_days from public.doctor_branches where id = $1',
      [dbId],
    );
    const { consultation_fee: newFee, followup_fee: fuFee, followup_valid_days: validDays } = fees.rows[0];
    log(
      `  follow-up: fee=${fuRow.fee} newFee=${newFee} fuFee=${fuFee} validDays=${validDays} daysApart=${daysApart}`,
    );
    if (daysApart <= Number(validDays) && Number(fuFee) < Number(newFee)) {
      if (Number(fuRow.fee) !== Number(fuFee)) {
        fail(`follow-up fee should be ${fuFee}, got ${fuRow.fee}`);
      } else {
        log('PASS: follow-up fee resolution honours followup_valid_days');
      }
    } else if (Number(fuRow.fee) !== Number(newFee)) {
      fail('expected consultation fee outside the follow-up window');
    } else {
      log('  NOTE: outside follow-up window -> consultation fee applied (correct)');
    }
    if (fuRow.visit_type !== 'followup') fail('visit_type not persisted as followup');
    const q = await admin.query('select public.next_queue_number($1,$2) as n', [dbId, fuDate]);
    if (Number(q.rows[0].n) !== Number(fuRow.queue_no) + 1) {
      fail(`next_queue_number mismatch: ${q.rows[0].n} vs expected ${Number(fuRow.queue_no) + 1}`);
    } else {
      log(`PASS: next_queue_number -> ${q.rows[0].n}`);
    }
  } else {
    log('  NOTE: no schedule 14 days out; skipped follow-up fee check');
  }

  // ---- 6. structural guarantees ------------------------------------------
  const idx = await admin.query(
    `select indexname from pg_indexes where schemaname='public' and indexname='appointments_no_double_book_idx'`,
  );
  if (idx.rowCount !== 1) fail('partial unique index missing');
  else log('PASS: partial unique index present');

  const rls = await admin.query(
    `select count(*)::int as missing from pg_tables where schemaname='public' and rowsecurity = false`,
  );
  if (rls.rows[0].missing !== 0) fail(`RLS missing on ${rls.rows[0].missing} public tables`);
  else log('PASS: RLS enabled on all public tables');

  const trg = await admin.query(
    `select count(*)::int as n from pg_trigger where tgname = 'on_auth_user_created' and not tgisinternal`,
  );
  if (trg.rows[0].n !== 1) fail('handle_new_user trigger missing'); else log('PASS: handle_new_user trigger present');

  const prof = await admin.query(
    `select count(*)::int as n from public.profiles where id = $1`,
    [owner1.rows[0].id],
  );
  if (prof.rows[0].n !== 1) fail('handle_new_user did not create a profile'); else log('PASS: signup created profile');

  await admin.end();
} catch (e) {
  fail(e.message);
} finally {
  try {
    // pg.stop() can hang forever on Windows when a forkchild process lingers;
    // never let teardown block the verdict.
    await Promise.race([
      pg.stop(),
      new Promise((r) => setTimeout(r, 8000)),
    ]);
  } catch {
    /* ignore */
  }
  // Windows keeps file handles briefly; clean up best-effort without failing the run.
  for (let attempt = 0; attempt < 5 && existsSync(DATA_DIR); attempt++) {
    try {
      rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  log(process.exitCode ? 'DB VERIFY FAILED' : 'DB VERIFY PASSED');
  // Force exit: lingering postgres child handles on Windows otherwise keep the
  // event loop alive after a successful run.
  process.exit(process.exitCode ?? 0);
}
