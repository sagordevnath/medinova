import { createClient } from '@supabase/supabase-js';
import { Router, type Router as ExpressRouter, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  appointmentCreateSchema,
  bookSlotSchema,
  branchSchema,
  departmentSchema,
  doctorSchema,
} from '@medinova/shared';
import { loadEnv, type Env } from '../config/env.js';
import { getSupabaseAdmin } from '../utils/supabase.js';
import { verifySupabaseJwt } from '../middleware/auth.js';

/** Public catalog: branches, departments, doctors, slots + booking (Module 2/3 compatibility). */
export const router: ExpressRouter = Router();
const env: Env = loadEnv();

type Envelope<T> = { data: T; meta?: Record<string, unknown> };
type Row = Record<string, unknown>;

/**
 * Run a Supabase query for a public catalog route.
 *
 * Catalog data is readable with the anon/publishable key, so a failure here
 * usually means the API is misconfigured (wrong SUPABASE_URL or an invalid
 * key). Log it instead of returning [] silently, otherwise a config error
 * looks exactly like "the database is empty" in the UI.
 */
async function tryQuery<T>(
  fn: () => PromiseLike<{ data: T | null; error: { message: string } | null }>,
  label: string,
): Promise<T | null> {
  try {
    const { data, error } = await fn();
    if (error) {
      console.error(
        { msg: 'catalog query failed', route: label, error: error.message, supabaseUrl: env.SUPABASE_URL },
      );
      return null;
    }
    return data as T;
  } catch (e) {
    console.error({ msg: 'catalog query threw', route: label, error: (e as Error).message, supabaseUrl: env.SUPABASE_URL });
    return null;
  }
}

/** Dhaka wall-clock date/time for an ISO instant (booking day + slot alignment). */
function dhakaParts(iso: string): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

const toBranch = (r: Row) =>
  branchSchema.parse({
    id: r.id,
    slug: r.slug,
    name: r.name,
    nameBn: r.name_bn,
    city: r.city,
    address: r.address,
    addressBn: r.address_bn,
    lat: r.lat,
    lng: r.lng,
    phone: r.phone,
    emergencyPhone: r.emergency_phone,
    email: r.email,
    openingHours: r.opening_hours ?? {},
    facilities: r.facilities ?? [],
    photoUrl: r.photo_url,
    isActive: r.is_active,
  });

const toDepartment = (r: Row) =>
  departmentSchema.parse({
    id: r.id,
    name: r.name,
    nameBn: r.name_bn,
    medicineType: r.medicine_type,
    icon: r.icon,
    description: r.description,
    isActive: r.is_active,
  });

/**
 * GET /v1/me — the caller's profile plus the patient records they can book for.
 *
 * Booking needs a real public.patients row id, but the browser only holds an
 * auth user id. This resolves it server-side from the verified token, so the
 * client never has to invent (or hardcode) a patient id.
 */
const meAuth = verifySupabaseJwt(env);
router.get('/me', meAuth, async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
  const auth = req.auth;
  if (!auth?.userId || !auth.accessToken) return res.status(401).json({ error: 'errors.unauthorized' });
  const userId = auth.userId;

  // Query as the caller so RLS applies their own policy. The 2nd arg to
  // createClient is the apikey, so it must be the anon key — the user's access
  // token belongs in the Authorization header, which supabase-js sets for us.
  // Passing the token as the apikey made PostgREST answer "Invalid API key",
  // which surfaced as a silently empty profile.
  const userClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${auth.accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [profile, patients] = await Promise.all([
    userClient
      .from('profiles')
      .select('id, full_name, phone, role, branch_id, avatar_url, preferred_lang')
      .eq('id', userId)
      .maybeSingle(),
    userClient
      .from('patients')
      .select('id, full_name, dob, gender, phone, blood_group, address, allergies, chronic_conditions')
      .eq('owner_id', userId)
      .order('created_at'),
  ]);

  if (profile.error || patients.error) {
    console.error({
      msg: '/v1/me query failed',
      profileError: profile.error?.message,
      patientsError: patients.error?.message,
    });
  }

  res.json({
    data: {
      userId,
      profile: profile.data
        ? {
            fullName: profile.data.full_name,
            phone: profile.data.phone,
            role: profile.data.role,
            branchId: profile.data.branch_id,
            avatarUrl: profile.data.avatar_url,
            preferredLang: profile.data.preferred_lang,
          }
        : null,
      patients: (patients.data ?? []).map((p) => ({
        id: p.id,
        fullName: p.full_name,
        dob: p.dob,
        gender: p.gender,
        phone: p.phone,
        bloodGroup: p.blood_group,
        address: p.address,
        allergies: p.allergies,
        chronicConditions: p.chronic_conditions,
      })),
    },
    meta: { degraded: !profile.data && !(patients.data ?? []).length },
  });
});

router.get('/settings', async (_req: Request, res: Response<Envelope<unknown>>) => {
  const row = await tryQuery<{ value: unknown }>(
    () => getSupabaseAdmin(env).from('site_settings').select('value').eq('key', 'features').maybeSingle(),
    'settings',
  );
  res.json({ data: row?.value ?? {}, meta: { degraded: row === null } });
});

/**
 * Public subscription plans.
 *
 * This is the page a clinic owner reads before deciding to buy, so it has to
 * work for anonymous visitors. Migration 0014 already grants anon SELECT on
 * plans where is_active, so no auth middleware is needed here.
 *
 * Prices are returned as taka for display even though the database stores
 * paisa; -1 encodes "unlimited" and is normalised to null so the UI never
 * renders a negative price or limit.
 */
router.get('/plans', async (_req: Request, res: Response<Envelope<Row[]>>) => {
  const rows = await tryQuery<Row[]>(
    () =>
    getSupabaseAdmin(env)
        .from('plans')
        .select(
          'code, name, tagline, price_monthly_paisa, price_yearly_paisa, branch_limit, doctor_limit, staff_seat_limit, monthly_appointment_limit, features, sort_order',
        )
        .eq('is_active', true)
        .order('sort_order'),
    'plans',
  );

  const toTaka = (paisa: unknown) => Math.round(Number(paisa ?? 0)) / 100;
  const limit = (n: unknown) => {
    const v = Number(n);
    return v < 0 ? null : v;
  };

  res.json({
    data: (rows ?? []).map((row) => ({
      code: row.code,
      name: row.name,
      tagline: row.tagline ?? null,
      monthlyTaka: toTaka(row.price_monthly_paisa),
      yearlyTaka: toTaka(row.price_yearly_paisa),
      branchLimit: limit(row.branch_limit),
      doctorLimit: limit(row.doctor_limit),
      staffSeatLimit: limit(row.staff_seat_limit),
      monthlyAppointmentLimit: limit(row.monthly_appointment_limit),
      features: Array.isArray(row.features) ? row.features : [],
    })),
  });
});

router.get('/branches', async (_req: Request, res: Response<Envelope<unknown[]>>) => {
  const rows = await tryQuery<Row[]>(() =>
    getSupabaseAdmin(env)
      .from('branches')
      .select(
        'id, name, name_bn, slug, address, address_bn, city, lat, lng, phone, emergency_phone, email, opening_hours, facilities, photo_url, is_active',
      )
      .eq('is_active', true)
      .order('name'),
    'branches',
  );
  const data = (rows ?? []).map(toBranch);
  res.json({ data, meta: { page: 1, total: data.length, degraded: rows === null } });
});

router.get('/departments', async (req: Request, res: Response<Envelope<unknown[]> | { error: string }>) => {
  const query = z.object({ medicineType: z.enum(['allopathic', 'homeopathic']).optional() }).safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: 'errors.invalidQuery' });
  let q = getSupabaseAdmin(env)
    .from('departments')
    .select('id, name, name_bn, medicine_type, icon, description, is_active')
    .eq('is_active', true)
    .order('name');
  if (query.data.medicineType) q = q.eq('medicine_type', query.data.medicineType);
  const rows = await tryQuery<Row[]>(() => q, 'departments');
  const data = (rows ?? []).map(toDepartment);
  res.json({ data, meta: { medicineType: query.data.medicineType ?? 'all', degraded: rows === null } });
});

router.get('/doctors', async (req: Request, res: Response<Envelope<unknown[]> | { error: string }>) => {
  const query = z
    .object({
      branchId: z.string().uuid().optional(),
      medicineType: z.enum(['allopathic', 'homeopathic']).optional(),
    })
    .safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: 'errors.invalidQuery' });

  const admin = getSupabaseAdmin(env);
  let q = admin
    .from('doctors')
    .select(
      'id, profile_id, department_id, medicine_type, full_name, full_name_bn, slug, bio, qualifications, specialties, experience_years, registration_no, photo_url, languages, rating_avg, rating_count, telemedicine_enabled, is_active, doctor_branches(id, branch_id, consultation_fee, followup_fee, followup_valid_days, telemedicine_fee, room_no)',
    )
    .eq('is_active', true)
    .order('full_name');
  if (query.data.medicineType) q = q.eq('medicine_type', query.data.medicineType);
  const rows = await tryQuery<Row[]>(() => q, 'doctors');

  const data = (rows ?? [])
    .map((row) => {
      const parsed = doctorSchema.safeParse({
        id: row.id,
        profileId: row.profile_id,
        departmentId: row.department_id,
        medicineType: row.medicine_type,
        fullName: row.full_name,
        fullNameBn: row.full_name_bn,
        slug: row.slug,
        bio: row.bio,
        qualifications: row.qualifications,
        specialties: row.specialties,
        experienceYears: row.experience_years,
        registrationNo: row.registration_no,
        photoUrl: row.photo_url,
        languages: row.languages,
        telemedicineEnabled: row.telemedicine_enabled,
        isActive: row.is_active,
      });
      if (!parsed.success) return null;
      const postings = Array.isArray(row.doctor_branches) ? (row.doctor_branches as Row[]) : [];
      return {
        ...parsed.data,
        ratingAvg: Number(row.rating_avg ?? 0),
        ratingCount: Number(row.rating_count ?? 0),
        fees: postings.map((b) => ({
          id: b.id,
          doctorId: parsed.data.id,
          branchId: b.branch_id,
          consultationFee: Number(b.consultation_fee),
          followupFee: Number(b.followup_fee),
          followupValidDays: Number(b.followup_valid_days),
          telemedicineFee: b.telemedicine_fee == null ? null : Number(b.telemedicine_fee),
          roomNo: b.room_no,
        })),
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .filter((d) =>
      query.data.branchId ? d.fees.some((f) => f.branchId === query.data.branchId) : true,
    );
  res.json({ data, meta: { ...query.data, degraded: rows === null } });
});

router.get('/doctors/:slug', async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
  const slug = z.string().min(2).safeParse(req.params.slug);
  if (!slug.success) return res.status(400).json({ error: 'errors.invalidParams' });
  const row = await tryQuery<Row>(
    () => getSupabaseAdmin(env).from('doctor_listing_view').select('*').eq('slug', slug.data).eq('is_active', true).maybeSingle(),
    'doctor-detail',
  );
  if (!row) return res.status(404).json({ error: 'errors.notFound' });

  // doctor_listing_view returns raw snake_case columns. The list route maps
  // them through doctorSchema, but this route was returning the row as-is, so
  // DoctorProfilePage read `fullName` and got undefined. Map it the same way.
  const parsed = doctorSchema.safeParse({
    id: row.id,
    profileId: row.profile_id,
    departmentId: row.department_id,
    medicineType: row.medicine_type,
    fullName: row.full_name,
    fullNameBn: row.full_name_bn,
    slug: row.slug,
    bio: row.bio,
    qualifications: row.qualifications,
    specialties: row.specialties,
    experienceYears: row.experience_years,
    registrationNo: row.registration_no,
    photoUrl: row.photo_url,
    languages: row.languages,
    telemedicineEnabled: row.telemedicine_enabled,
    isActive: row.is_active,
  });
  if (!parsed.success) {
    console.error({ msg: 'doctor detail failed schema', slug: slug.data, issues: parsed.error.issues });
    return res.status(502).json({ error: 'errors.upstream' });
  }

  // doctor_listing_view already builds the `branches` and `schedules` arrays as
  // camelCase JSON (see 0008_doctor_discovery.sql), so pass them through rather
  // than re-mapping snake_case keys that do not exist there.
  const postings = Array.isArray(row.branches) ? (row.branches as Row[]) : [];
  res.json({
    data: {
      ...parsed.data,
      ratingAvg: Number(row.rating_avg ?? 0),
      ratingCount: Number(row.rating_count ?? 0),
      departmentName: row.department_name ?? null,
      departmentNameBn: row.department_name_bn ?? null,
      minFee: row.min_fee == null ? null : Number(row.min_fee),
      schedules: row.schedules ?? [],
      fees: postings.map((b) => ({
        id: b.id,
        doctorId: parsed.data.id,
        branchId: b.branchId,
        consultationFee: Number(b.consultationFee ?? 0),
        followupFee: Number(b.followupFee ?? 0),
        followupValidDays: Number(b.followupValidDays ?? 0),
        telemedicineFee: b.telemedicineFee == null ? null : Number(b.telemedicineFee),
        roomNo: b.roomNo ?? null,
      })),
    },
    meta: { source: 'doctor_listing_view' },
  });
});

router.get('/doctors/:id/slots', async (req: Request, res: Response<Envelope<unknown[]> | { error: string }>) => {
  const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
  const query = z.object({ date: z.string().date(), branchId: z.string().uuid() }).safeParse(req.query);
  if (!params.success) return res.status(400).json({ error: 'errors.invalidParams' });
  if (!query.success) return res.status(400).json({ error: 'errors.invalidQuery' });

  const posting = await tryQuery<{ id: string } | null>(() =>
    getSupabaseAdmin(env)
      .from('doctor_branches')
      .select('id')
      .eq('doctor_id', params.data.id)
      .eq('branch_id', query.data.branchId)
      .maybeSingle(),
    'doctor-posting',
  );
  if (!posting) return res.status(404).json({ error: 'errors.notFound' });

  const rows = await tryQuery<Row[]>(
    () =>
      getSupabaseAdmin(env).rpc('get_available_slots', {
        p_doctor_branch_id: posting.id,
        p_date: query.data.date,
      }),
    'slots',
  );
  res.json({
    data: (rows ?? []).map((s) => ({
      slotStart: s.slot_start,
      slotEnd: s.slot_end,
      isAvailable: s.is_available,
    })),
    meta: { date: query.data.date, degraded: rows === null },
  });
});

/**
 * Resolve a doctor_branch posting; used by both booking payload shapes.
 * Returns null when the doctor does not practice at the branch.
 */
async function findPosting(doctorId: string, branchId: string): Promise<{ id: string } | null> {
  const row = await tryQuery<{ id: string } | null>(() =>
    getSupabaseAdmin(env)
      .from('doctor_branches')
      .select('id')
      .eq('doctor_id', doctorId)
      .eq('branch_id', branchId)
      .maybeSingle(),
    'find-posting',
  );
  return row ?? null;
}

/** Map book_appointment() errors to HTTP status codes. */
function bookingError(error: { message: string }): number {
  const msg = error.message ?? '';
  if (msg.includes('SLOT_TAKEN')) return 409;
  if (msg.includes('DOCTOR_BRANCH_NOT_FOUND') || msg.includes('DOCTOR_INACTIVE')) return 404;
  if (msg.includes('TELEMEDICINE_DISABLED')) return 422;
  if (/patients.*foreign key|violates foreign key constraint/i.test(msg)) return 404;
  return 502;
}

async function verifyTurnstile(env: Env, req: Request): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  const token = req.header('x-turnstile-token');
  if (!token) return false;
  try {
    const res = await fetch(env.TURNSTILE_VERIFY_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token }) });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

router.post(
  '/appointments',
  async (req: Request, res: Response<Envelope<unknown> | { error: string; details?: unknown }>) => {
    if (!(await verifyTurnstile(env, req))) return res.status(403).json({ error: 'errors.turnstileRequired' });
    const admin = getSupabaseAdmin(env);

    // Preferred Module 2 payload: explicit patient + doctor_branch + slot.
    const parsed = bookSlotSchema.safeParse(req.body);
    if (parsed.success) {
      const { patientId, doctorBranchId, apptDate, slotStart, visitType, symptoms } = parsed.data;
      const { data, error } = await admin.rpc('book_appointment', {
        p_patient_id: patientId,
        p_doctor_branch_id: doctorBranchId,
        p_date: apptDate,
        p_slot_start: slotStart,
        p_visit_type: visitType,
        p_symptoms: symptoms ?? null,
      });
      if (error) { logBookingError(error); return res.status(bookingError(error)).json({ error: errorKey(error) }); }
      return res.status(201).json({ data });
    }

    // Legacy Module 1 payload (branchId/doctorId/scheduledAt): book the first
    // available slot that Dhaka day so the demo BookPage keeps working.
    const legacy = appointmentCreateSchema.safeParse(req.body);
    const legacyPatient = z.string().uuid().safeParse(req.body?.patientId);
    if (legacy.success && legacyPatient.success) {
      const { branchId, doctorId, visitType, scheduledAt, notes } = legacy.data;
      const posting = await findPosting(doctorId, branchId);
      if (!posting) return res.status(404).json({ error: 'errors.doctorBranchNotFound' });
      const { date } = dhakaParts(scheduledAt);
      const slots = await tryQuery<Row[]>(
        () => admin.rpc('get_available_slots', { p_doctor_branch_id: posting.id, p_date: date }),
        'legacy-slots',
      );
      const wanted = String(scheduledAt).slice(11, 16);
      const first = (slots ?? []).find((s) => s.is_available === true && (!wanted || String(s.slot_start).slice(0, 5) === wanted));
      if (!first) return res.status(409).json({ error: 'errors.slotTaken' });
      const { data, error } = await admin.rpc('book_appointment', {
        p_patient_id: legacyPatient.data,
        p_doctor_branch_id: posting.id,
        p_date: date,
        p_slot_start: first.slot_start,
        p_visit_type: visitType,
        p_symptoms: notes ?? null,
      });
      if (error) { logBookingError(error); return res.status(bookingError(error)).json({ error: errorKey(error) }); }
      return res.status(201).json({ data });
    }

    res.status(400).json({ error: 'errors.validation', details: parsed.error.flatten() });
  },
);

function errorKey(error: { message: string }): string {
  const msg = error.message ?? '';
  if (msg.includes('SLOT_TAKEN')) return 'errors.slotTaken';
  if (msg.includes('TELEMEDICINE_DISABLED')) return 'errors.telemedicineDisabled';
  // A patient_id with no matching public.patients row. The client used to send
  // a hardcoded nil UUID here, which fails the FK rather than validation.
  if (/patients.*foreign key|violates foreign key constraint/i.test(msg)) return 'errors.patientNotFound';
  return 'errors.upstream';
}

/** Log the raw DB error so an unmapped failure is diagnosable, not just a 502. */
function logBookingError(error: { message: string }): void {
  console.error({ msg: 'book_appointment failed', error: error.message, supabaseUrl: env.SUPABASE_URL });
}

export const _schemas = { branchSchema, departmentSchema, doctorSchema };
