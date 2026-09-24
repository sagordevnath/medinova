import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { branchSchema, doctorSchema } from '@medinova/shared';
import type { Env } from '../config/env.js';
import { requireRole, verifySupabaseJwt } from '../middleware/auth.js';
import { strictLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { h } from '../utils/async.js';
import { ApiError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';
import { getSupabaseAdmin } from '../utils/supabase.js';

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/** Create doctor + auth user (invite) and optional branch posting. */
const createDoctorBody = doctorSchema.extend({
  email: z.string().email(),
  /** Optional login password; when omitted a magic-link invite is sent. */
  password: z.string().min(8).max(72).optional(),
  /** Optional branch posting with fees. */
  branchId: z.string().uuid().optional(),
  consultationFee: z.number().min(0).max(100000).optional(),
  followupFee: z.number().min(0).max(100000).optional(),
});

const feePatchBody = z
  .object({
    consultationFee: z.number().min(0).max(100000).optional(),
    followupFee: z.number().min(0).max(100000).optional(),
    followupValidDays: z.number().int().min(0).max(365).optional(),
    telemedicineFee: z.number().min(0).max(100000).nullable().optional(),
    roomNo: z.string().max(20).nullable().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => (v as Record<string, unknown>)[k] !== undefined), {
    message: 'at least one field required',
  });

const snake = (m: Record<string, unknown>): Record<string, unknown> => ({
  medicine_type: m.medicineType,
  full_name: m.fullName,
  full_name_bn: m.fullNameBn,
  slug: m.slug,
  bio: m.bio ?? null,
  qualifications: m.qualifications ?? [],
  specialties: m.specialties ?? [],
  experience_years: m.experienceYears ?? 0,
  registration_no: m.registrationNo ?? null,
  photo_url: m.photoUrl ?? null,
  languages: m.languages ?? ['English', 'Bangla'],
  telemedicine_enabled: m.telemedicineEnabled ?? false,
  is_active: m.isActive ?? true,
  department_id: m.departmentId ?? null,
});

/**
 * Admin endpoints — super_admin only (fees also allow branch_admin for their
 * own branch). All strictly rate-limited (auth-adjacent).
 */
export function adminRouter(env: Env, logger: Logger): Router {
  const r: Router = Router();
  const auth = verifySupabaseJwt(env);

  /** POST /admin/doctors — create auth user + doctor profile (+ posting). */
  r.post(
    '/doctors',
    strictLimiter(env),
    auth,
    requireRole('super_admin'),
    validate({ body: createDoctorBody }),
    h(async (req: Request, res: Response) => {
      const body = createDoctorBody.parse(req.body);
      const admin = getSupabaseAdmin(env);

      // 1) Auth user (identities email). Existing user → 409.
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: body.email,
        password: body.password ?? `${cryptoRandom(16)}Aa1!`,
        email_confirm: true,
        user_metadata: { full_name: body.fullName, role: 'doctor' },
      });
      if (createErr || !created.user) {
        const key = /already/i.test(createErr?.message ?? '') ? 'errors.doctorExists' : 'errors.upstream';
        throw new ApiError(key === 'errors.doctorExists' ? 409 : 502, key, createErr?.message);
      }
      const userId = created.user.id;

      // 2) Flip the auto-created patient profile to doctor role.
      const { error: profErr } = await admin
        .from('profiles')
        .update({ role: 'doctor' })
        .eq('id', userId);
      if (profErr) logger.warn({ err: profErr.message, userId }, 'profile role update failed');

      // 3) Doctor row linked to the profile (slug collision → suffix with user id).
      const base = body.slug || slugify(body.fullName);
      const row = { ...snake(body as unknown as Record<string, unknown>), profile_id: userId };
      let slug = base;
      let { data: doctor, error: docErr } = await admin
        .from('doctors')
        .insert({ ...row, slug })
        .select('id')
        .single();
      if (docErr && /duplicate key/i.test(docErr.message)) {
        slug = `${base}-${userId.slice(0, 6)}`;
        const retry = await admin.from('doctors').insert({ ...row, slug }).select('id').single();
        doctor = retry.data;
        docErr = retry.error;
      }
      if (docErr || !doctor) {
        await admin.auth.admin.deleteUser(userId).catch(() => undefined);
        throw ApiError.upstream('errors.upstream', docErr?.message);
      }

      if (body.branchId) {
        const { error: postErr } = await admin.from('doctor_branches').insert({
          doctor_id: doctor.id,
          branch_id: body.branchId,
          consultation_fee: body.consultationFee ?? 1000,
          followup_fee: body.followupFee ?? Math.round((body.consultationFee ?? 1000) * 0.6),
        });
        if (postErr) logger.warn({ err: postErr.message }, 'doctor posting insert failed');
      }
      logger.info({ doctorId: doctor.id, userId, actor: req.auth!.userId }, 'doctor created');
      res.status(201).json({ data: { doctorId: doctor.id, userId, slug } });
    }),
  );

  /** POST /admin/branches — create a branch. */
  r.post(
    '/branches',
    strictLimiter(env),
    auth,
    requireRole('super_admin'),
    validate({ body: branchSchema }),
    h(async (req: Request, res: Response) => {
      const body = branchSchema.parse(req.body);
      const { data, error } = await getSupabaseAdmin(env)
        .from('branches')
        .insert({
          name: body.name,
          name_bn: body.nameBn,
          slug: body.slug,
          address: body.address,
          address_bn: body.addressBn,
          city: body.city,
          lat: body.lat,
          lng: body.lng,
          phone: body.phone,
          emergency_phone: body.emergencyPhone,
          email: body.email ?? null,
          opening_hours: body.openingHours,
          facilities: body.facilities,
          photo_url: body.photoUrl ?? null,
          is_active: body.isActive,
        })
        .select('id, slug')
        .single();
      if (error) {
        const key = /duplicate/i.test(error.message) ? 'errors.conflict' : 'errors.upstream';
        throw new ApiError(key === 'errors.conflict' ? 409 : 502, key, error.message);
      }
      logger.info({ branchId: data.id, actor: req.auth!.userId }, 'branch created');
      res.status(201).json({ data });
    }),
  );

  /**
   * PATCH /admin/doctor-branches/:id/fees — update posting fees.
   * super_admin: any posting; branch_admin: only postings of their branch.
   */
  r.patch(
    '/doctor-branches/:id/fees',
    strictLimiter(env),
    auth,
    requireRole('super_admin', 'branch_admin'),
    validate({
      params: z.object({ id: z.string().uuid() }),
      body: feePatchBody,
    }),
    h(async (req: Request, res: Response) => {
      const id = z.string().uuid().parse(req.params.id);
      const body = feePatchBody.parse(req.body);
      const admin = getSupabaseAdmin(env);

      const { data: posting, error: findErr } = await admin
        .from('doctor_branches')
        .select('id, branch_id, doctor_id')
        .eq('id', id)
        .maybeSingle();
      if (findErr) throw ApiError.upstream('errors.upstream', findErr.message);
      if (!posting) throw ApiError.notFound();
      if (req.auth!.role === 'branch_admin' && posting.branch_id !== req.auth!.branchId) {
        throw ApiError.forbidden();
      }

      const patch: Record<string, unknown> = {};
      if (body.consultationFee !== undefined) patch.consultation_fee = body.consultationFee;
      if (body.followupFee !== undefined) patch.followup_fee = body.followupFee;
      if (body.followupValidDays !== undefined) patch.followup_valid_days = body.followupValidDays;
      if (body.telemedicineFee !== undefined) patch.telemedicine_fee = body.telemedicineFee;
      if (body.roomNo !== undefined) patch.room_no = body.roomNo;

      const { data, error } = await admin
        .from('doctor_branches')
        .update(patch)
        .eq('id', id)
        .select('id, consultation_fee, followup_fee, followup_valid_days, telemedicine_fee, room_no')
        .single();
      if (error) throw ApiError.upstream('errors.upstream', error.message);
      logger.info({ postingId: id, fields: Object.keys(patch), actor: req.auth!.userId }, 'fees updated');
      res.json({ data });
    }),
  );

  return r;
}

/** URL-safe random token (invite passwords). */
function cryptoRandom(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');
}

