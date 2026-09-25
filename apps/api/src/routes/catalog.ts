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

/** Public catalog: branches, departments, doctors, slots + booking (Module 2/3 compatibility). */
export const router: ExpressRouter = Router();
const env: Env = loadEnv();

type Envelope<T> = { data: T; meta?: Record<string, unknown> };
type Row = Record<string, unknown>;

/** Run a Supabase query; return null on error so catalog routes degrade to [] offline. */
async function tryQuery<T>(
  fn: () => PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<T | null> {
  try {
    const { data, error } = await fn();
    return error ? null : (data as T);
  } catch {
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

router.get('/branches', async (_req: Request, res: Response<Envelope<unknown[]>>) => {
  const rows = await tryQuery<Row[]>(() =>
    getSupabaseAdmin(env)
      .from('branches')
      .select(
        'id, name, name_bn, slug, address, address_bn, city, lat, lng, phone, emergency_phone, email, opening_hours, facilities, photo_url, is_active',
      )
      .eq('is_active', true)
      .order('name'),
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
  const rows = await tryQuery<Row[]>(() => q);
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
  const rows = await tryQuery<Row[]>(() => q);

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
  const row = await tryQuery<Row>(() => getSupabaseAdmin(env).from('doctor_listing_view').select('*').eq('slug', slug.data).eq('is_active', true).maybeSingle());
  if (!row) return res.status(404).json({ error: 'errors.notFound' });
  res.json({ data: row, meta: { source: 'doctor_listing_view' } });
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
  );
  if (!posting) return res.status(404).json({ error: 'errors.notFound' });

  const rows = await tryQuery<Row[]>(() =>
    getSupabaseAdmin(env).rpc('get_available_slots', {
      p_doctor_branch_id: posting.id,
      p_date: query.data.date,
    }),
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
  );
  return row ?? null;
}

/** Map book_appointment() errors to HTTP status codes. */
function bookingError(error: { message: string }): number {
  const msg = error.message ?? '';
  if (msg.includes('SLOT_TAKEN')) return 409;
  if (msg.includes('DOCTOR_BRANCH_NOT_FOUND') || msg.includes('DOCTOR_INACTIVE')) return 404;
  if (msg.includes('TELEMEDICINE_DISABLED')) return 422;
  return 502;
}

router.post(
  '/appointments',
  async (req: Request, res: Response<Envelope<unknown> | { error: string; details?: unknown }>) => {
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
      if (error) return res.status(bookingError(error)).json({ error: errorKey(error) });
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
      const slots = await tryQuery<Row[]>(() =>
        admin.rpc('get_available_slots', { p_doctor_branch_id: posting.id, p_date: date }),
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
      if (error) return res.status(bookingError(error)).json({ error: errorKey(error) });
      return res.status(201).json({ data });
    }

    res.status(400).json({ error: 'errors.validation', details: parsed.error.flatten() });
  },
);

function errorKey(error: { message: string }): string {
  const msg = error.message ?? '';
  if (msg.includes('SLOT_TAKEN')) return 'errors.slotTaken';
  if (msg.includes('TELEMEDICINE_DISABLED')) return 'errors.telemedicineDisabled';
  return 'errors.upstream';
}

export const _schemas = { branchSchema, departmentSchema, doctorSchema };
