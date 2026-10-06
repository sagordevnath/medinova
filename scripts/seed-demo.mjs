/**
 * MediNova UX demo seeder (idempotent).
 * Creates one test account per role and demo data for every product section.
 *
 * Credentials may be supplied as env vars or a gitignored `scripts/.env.local`:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (server-only; never commit or paste into chat)
 *   DEMO_PASSWORD               (optional, default: MediNovaDemo!2026)
 *
 * Usage: node scripts/seed-demo.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
/** Merge a simple KEY=VALUE file into process.env without overwriting real env. */
function loadLocalEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    if (value && process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadLocalEnv(join(here, '.env.local'));
loadLocalEnv(join(here, '..', '.env.local'));
// Also read the web app's env so we can detect a copy-pasted publishable key.
loadLocalEnv(join(here, '..', 'apps/web/.env'));

const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const password = process.env.DEMO_PASSWORD ?? 'MediNovaDemo!2026';
const isPublishable = (v) => {
  const t = String(v ?? '').trim();
  return t.startsWith('sb_publishable_') || (anon && t === String(anon).trim());
};
const isPlaceholder = (v) => {
  const t = String(v ?? '').trim();
  return !t || /^<.*>$/.test(t) || t.length < 20 || isPublishable(t);
};
if (isPlaceholder(url) || isPlaceholder(key)) {
  console.error(
    'Missing or placeholder SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Fill in scripts/.env.local (gitignored) with:\n' +
      '  SUPABASE_URL=https://<project-ref>.supabase.co\n' +
      '  SUPABASE_SERVICE_ROLE_KEY=<service_role key>\n' +
      'Find the service_role key in Supabase Dashboard -> Project Settings -> API Keys.\n' +
      'It starts with "eyJ". The publishable key (sb_publishable_...) cannot create users.',
  );
  process.exit(1);
}
if (key.startsWith('sb_publishable_')) {
  console.error('That is the publishable/anon key. Use the service_role key (starts with eyJ) — it bypasses RLS.');
  process.exit(1);
}

const adminHeaders = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const restHeaders = { ...adminHeaders, Prefer: 'resolution=merge-duplicates,return=representation' };
async function rest(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...restHeaders, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 404) {
      console.error(
        `\nThe schema is not applied on ${url}.\n` +
          'Run these in the Supabase SQL Editor (Dashboard -> SQL Editor), in order:\n' +
          '  supabase/migrations/0001_foundation.sql ... 0012_realtime.sql\n' +
          '  supabase/seed_01_catalog.sql\n' +
          '  supabase/seed_02_doctors.sql\n' +
          '  supabase/seed_03_postings.sql\n' +
          'Or run: supabase db push && supabase db reset\n',
      );
      process.exit(1);
    }
    throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : [];
}

const accounts = [
  { email: 'patient@demo.medinova', name: 'Demo Patient', role: 'patient', phone: '+8801700000001' },
  { email: 'doctor@demo.medinova', name: 'Dr. Tanvir Ahmed', role: 'doctor', phone: '+8801700000002' },
  { email: 'reception@demo.medinova', name: 'Demo Receptionist', role: 'receptionist', phone: '+8801700000003', branch: 'dhanmondi' },
  { email: 'admin@demo.medinova', name: 'Demo Branch Admin', role: 'branch_admin', phone: '+8801700000004', branch: 'dhanmondi' },
  { email: 'admin2@demo.medinova', name: 'Demo Chattogram Admin', role: 'branch_admin', phone: '+8801700000005', branch: 'gec-chattogram' },
  { email: 'super@demo.medinova', name: 'Demo Super Admin', role: 'super_admin', phone: '+8801700000006' },
];

async function findOrCreateUser(a) {
  const listRes = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1000`, { headers: adminHeaders });
  if (!listRes.ok) throw new Error(`list users: ${listRes.status}`);
  const list = await listRes.json();
  let user = list.users?.find((u) => u.email?.toLowerCase() === a.email);
  if (!user) {
    const res = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ email: a.email, password, email_confirm: true, user_metadata: { full_name: a.name, role: a.role } }) });
    if (!res.ok) throw new Error(`create user ${a.email}: ${res.status} ${await res.text()}`);
    user = (await res.json()).user;
  } else {
    await fetch(`${url}/auth/v1/admin/users/${user.id}`, { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ password, email_confirm: true, user_metadata: { full_name: a.name, role: a.role } }) });
  }
  return user;
}

const branches = await rest('branches?select=*');
const branch = Object.fromEntries(branches.map((b) => [b.slug, b]));
const doctors = await rest('doctors?select=*');
const doctor = doctors.find((d) => d.slug === 'tanvir-ahmed');
const homeo = doctors.find((d) => d.slug === 'kamrul-islam');
if (!branch.dhanmondi || !branch.uttara || !branch['gec-chattogram'] || !doctor) throw new Error('Run catalog seeds 01-03 before the UX demo seeder.');

const users = {};
for (const a of accounts) {
  const u = await findOrCreateUser(a);
  users[a.role + (a.branch ?? '')] = u;
  let branchId = a.branch ? branch[a.branch].id : null;
  if (a.role === 'doctor') branchId = null;
  await rest(`profiles?id=eq.${u.id}`, { method: 'PATCH', body: JSON.stringify({ full_name: a.name, phone: a.phone, role: a.role, branch_id: branchId, preferred_lang: a.email.startsWith('patient') ? 'bn' : 'en' }) });
  if (a.role === 'doctor') await rest(`doctors?slug=eq.${doctor.slug}`, { method: 'PATCH', body: JSON.stringify({ profile_id: u.id }) });
}

const patientOwner = users.patient;
const patients = await rest(`patients?owner_id=eq.${patientOwner.id}&select=*`);
let patient = patients[0];
if (!patient) [patient] = await rest('patients', { method: 'POST', body: JSON.stringify({ owner_id: patientOwner.id, full_name: 'Ayesha Rahman', dob: '1994-05-18', gender: 'female', phone: '+8801700000001', blood_group: 'B+', allergies: 'Penicillin', chronic_conditions: 'Mild asthma', address: 'Dhanmondi, Dhaka' }) });
let [family] = await rest(`patients?owner_id=eq.${patientOwner.id}&full_name=eq.Arif%20Rahman&select=*`);
if (!family) [family] = await rest('patients', { method: 'POST', body: JSON.stringify({ owner_id: patientOwner.id, full_name: 'Arif Rahman', dob: '2016-09-02', gender: 'male', phone: '+8801700000011', blood_group: 'O+' }) });

const postings = await rest(`doctor_branches?doctor_id=eq.${doctor.id}&branch_id=eq.${branch.dhanmondi.id}&select=*`);
const posting = postings[0];
const homeoPosting = (await rest(`doctor_branches?doctor_id=eq.${homeo.id}&branch_id=eq.${branch.uttara.id}&select=*`))[0];
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const appts = [
  { code: 'MN-DEMO-Q1', patient_id: patient.id, doctor_id: doctor.id, branch_id: branch.dhanmondi.id, doctor_branch_id: posting.id, appt_date: today, slot_start: '10:00', slot_end: '10:15', visit_type: 'new', status: 'in_consultation', fee: posting.consultation_fee, payment_status: 'paid', payment_method: 'cash', symptoms: 'Fever and sore throat for two days', queue_no: 1, created_by: patientOwner.id },
  { code: 'MN-DEMO-Q2', patient_id: family.id, doctor_id: doctor.id, branch_id: branch.dhanmondi.id, doctor_branch_id: posting.id, appt_date: today, slot_start: '10:15', slot_end: '10:30', visit_type: 'new', status: 'checked_in', fee: posting.consultation_fee, payment_status: 'pay_at_counter', payment_method: 'cash', symptoms: 'Cough and cold', queue_no: 2, created_by: patientOwner.id },
  { code: 'MN-DEMO-Q3', patient_id: patient.id, doctor_id: doctor.id, branch_id: branch.dhanmondi.id, doctor_branch_id: posting.id, appt_date: today, slot_start: '10:30', slot_end: '10:45', visit_type: 'new', status: 'confirmed', fee: posting.consultation_fee, payment_status: 'paid', payment_method: 'bkash', symptoms: 'Follow-up blood pressure review', queue_no: 3, created_by: patientOwner.id },
  { code: 'MN-DEMO-P1', patient_id: patient.id, doctor_id: doctor.id, branch_id: branch.dhanmondi.id, doctor_branch_id: posting.id, appt_date: yesterday, slot_start: '17:00', slot_end: '17:15', visit_type: 'followup', status: 'completed', fee: posting.followup_fee, payment_status: 'paid', payment_method: 'cash', symptoms: 'Diabetes review', queue_no: 1, created_by: patientOwner.id },
  { code: 'MN-DEMO-F1', patient_id: family.id, doctor_id: homeo.id, branch_id: branch.uttara.id, doctor_branch_id: homeoPosting.id, appt_date: tomorrow, slot_start: '17:00', slot_end: '17:15', visit_type: 'new', status: 'pending', fee: homeoPosting.consultation_fee, payment_status: 'unpaid', symptoms: 'Seasonal allergy', queue_no: 1, created_by: patientOwner.id },
];
await rest('appointments?on_conflict=code', { method: 'POST', body: JSON.stringify(appts) });
const allDemo = await rest('appointments?code=like.MN-DEMO-*&select=*');
const completed = allDemo.find((a) => a.code === 'MN-DEMO-P1');
const live = allDemo.find((a) => a.code === 'MN-DEMO-Q1');

if (completed) {
  const hasRx = (await rest(`prescriptions?appointment_id=eq.${completed.id}&select=id`)).length;
  if (!hasRx) await rest('prescriptions', { method: 'POST', body: JSON.stringify({ appointment_id: completed.id, doctor_id: completed.doctor_id, patient_id: completed.patient_id, diagnosis: 'Type 2 Diabetes - stable', medicines: [{ name: 'Metformin', dosage: '500 mg', frequency: 'Twice daily after meals', duration: '30 days' }], advice: 'Walk 30 minutes daily and recheck fasting sugar after two weeks.', next_visit_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) }) });
  const hasReview = (await rest(`reviews?appointment_id=eq.${completed.id}&select=id`)).length;
  if (!hasReview) await rest('reviews', { method: 'POST', body: JSON.stringify({ appointment_id: completed.id, doctor_id: completed.doctor_id, patient_id: completed.patient_id, rating: 5, comment: 'Clear explanation and helpful staff.', is_approved: true }) });
}
if (live) {
  const hasPay = (await rest(`payments?appointment_id=eq.${live.id}&method=eq.cash&select=id`)).length;
  if (!hasPay) await rest('payments', { method: 'POST', body: JSON.stringify({ appointment_id: live.id, amount: Math.round(live.fee * 100), method: 'cash', status: 'paid', paid_at: new Date().toISOString(), receipt_number: 'RCPT-DEMO-1001' }) });
  const hasFile = (await rest(`medical_records?patient_id=eq.${patient.id}&title=eq.Demo%20CBC%20Report&select=id`)).length;
  if (!hasFile) await rest('medical_records', { method: 'POST', body: JSON.stringify({ patient_id: patient.id, uploaded_by: patientOwner.id, title: 'Demo CBC Report', type: 'lab', file_path: `${patient.id}/demo-cbc-report.pdf` }) });
}
const hasNote = (await rest(`notifications?user_id=eq.${patientOwner.id}&title=eq.Your%20turn%20is%20in%202%20patients&select=id`)).length;
if (!hasNote) await rest('notifications', { method: 'POST', body: JSON.stringify({ user_id: patientOwner.id, channel: 'inapp', title: 'Your turn is in 2 patients', body: 'Please stay near the Dhanmondi reception desk.' }) });
const hasNotice = (await rest(`announcements?branch_id=eq.${branch.dhanmondi.id}&title=eq.Demo%20branch%20notice&select=id`)).length;
if (!hasNotice) await rest('announcements', { method: 'POST', body: JSON.stringify({ branch_id: branch.dhanmondi.id, title: 'Demo branch notice', body: 'Lab reports are now available digitally from the patient portal.' }) });
await rest('content_pages?on_conflict=slug', { method: 'POST', body: JSON.stringify({ slug: 'demo-health-tip', kind: 'health_tip', title: '5 heart-healthy habits', title_bn: 'হৃদযক্ষের জন্য ৫টি অভ্যাস', body: 'Walk daily, sleep well, limit salt, manage stress, and attend follow-ups.', body_bn: 'প্রতিদিন হাঁটুন, ভালো ঘুমান, লবণ কমান, মানসিক চাপ নিয়ন্ত্রণ করুন এবং ফলো-আপে আসুন।' }) });
const hasAudit = (await rest(`audit_logs?action=eq.demo_seed&select=id`)).length;
if (!hasAudit) await rest('audit_logs', { method: 'POST', body: JSON.stringify({ actor_id: users.super.id, action: 'demo_seed', entity: 'platform', meta: { purpose: 'UX testing' } }) });
console.log('MediNova demo data created.');
console.table(accounts.map((a) => ({ role: a.role, branch: a.branch ?? 'all', email: a.email, password })));
console.log('Patient: Ayesha Rahman + family member Arif Rahman');
console.log('Queue: 1 in consultation, 1 checked in, 1 confirmed, plus past and homeopathy appointments.');
