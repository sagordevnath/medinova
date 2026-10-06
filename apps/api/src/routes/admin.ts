import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { branchSchema, doctorSchema } from '@medinova/shared';
import type { Env } from '../config/env.js';
import { assertOwnsOrg, requireRole, verifySupabaseJwt } from '../middleware/auth.js';
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
  branchAssignments: z.array(z.object({ branchId: z.string().uuid(), consultationFee: z.number().min(0).max(100000), followupFee: z.number().min(0).max(100000), roomNo: z.string().max(20).optional(), schedules: z.array(z.object({ weekday: z.number().int().min(0).max(6), startTime: z.string(), endTime: z.string(), slotMinutes: z.number().int().min(1).max(480) })).default([]) })).default([]),
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
 * Resolve which organisation a branch belongs to.
 *
 * Admin routes read through the service-role key, which bypasses RLS, so every
 * cross-tenant check has to be explicit here rather than left to the database.
 */
async function branchOrgId(admin: ReturnType<typeof getSupabaseAdmin>, branchId: string) {
  const { data, error } = await admin.from('branches').select('id, org_id').eq('id', branchId).maybeSingle();
  if (error) throw ApiError.upstream('errors.upstream', error.message);
  return data; // null when the branch does not exist
}

/**
 * Admin endpoints — super_admin for the whole platform, org_admin for their
 * own organisation only. All strictly rate-limited (auth-adjacent).
 */
export function adminRouter(env: Env, logger: Logger): Router {
  const r: Router = Router();
  const auth = verifySupabaseJwt(env);

  /** POST /admin/doctors — create auth user + doctor profile (+ posting). */
  r.post(
    '/doctors',
    strictLimiter(env),
    auth,
    requireRole('super_admin', 'org_admin'),
    validate({ body: createDoctorBody }),
    h(async (req: Request, res: Response) => {
      const body = createDoctorBody.parse(req.body);
      const admin = getSupabaseAdmin(env);

      // Every target branch must sit inside the caller's own organisation.
      // Done before the auth user is created so a rejected request leaves no
      // orphaned account behind.
      const targetBranches = [
        ...body.branchAssignments.map((a) => a.branchId),
        ...(body.branchId ? [body.branchId] : []),
      ];
      for (const branchId of new Set(targetBranches)) {
        const branch = await branchOrgId(admin, branchId);
        if (!branch) throw new ApiError(400, 'errors.invalidInput', 'unknown branchId');
        assertOwnsOrg(req, branch.org_id);
      }
      const orgId = req.auth!.role === 'org_admin' ? req.auth!.orgId! : null;

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

      // 2) Flip the auto-created patient profile to doctor role. The profile
      //    carries org_id so RLS tenant scoping applies to the new doctor.
      const { error: profErr } = await admin
        .from('profiles')
        .update({ role: 'doctor', ...(orgId ? { org_id: orgId } : {}) })
        .eq('id', userId);
      if (profErr) logger.warn({ err: profErr.message, userId }, 'profile role update failed');

      // 3) Doctor row linked to the profile (slug collision → suffix with user id).
      const base = body.slug || slugify(body.fullName);
      const row = { ...snake(body as unknown as Record<string, unknown>), profile_id: userId, org_id: orgId };
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

      const assignments = body.branchAssignments.length > 0 ? body.branchAssignments : body.branchId ? [{ branchId: body.branchId, consultationFee: body.consultationFee ?? 1000, followupFee: body.followupFee ?? Math.round((body.consultationFee ?? 1000) * 0.6), schedules: [] }] : [];
      for (const assignment of assignments) {
        const { data: posting, error: postErr } = await admin.from('doctor_branches').insert({ doctor_id: doctor.id, branch_id: assignment.branchId, consultation_fee: assignment.consultationFee, followup_fee: assignment.followupFee, room_no: assignment.roomNo ?? null }).select('id').single();
        if (postErr) throw new ApiError(502, 'errors.upstream', postErr.message);
        if (assignment.schedules.length) await admin.from('doctor_schedules').insert(assignment.schedules.map((s) => ({ doctor_branch_id: posting.id, weekday: s.weekday, start_time: s.startTime, end_time: s.endTime, slot_minutes: s.slotMinutes, max_per_slot: 1, is_active: true })));
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
    requireRole('super_admin', 'org_admin'),
    validate({ body: branchSchema }),
    h(async (req: Request, res: Response) => {
      const body = branchSchema.parse(req.body);
      // An org_admin can only add branches to their own organisation; the row
      // must be stamped with it or tenant RLS would never match it.
      const orgId = req.auth!.role === 'org_admin' ? req.auth!.orgId! : null;
      if (orgId) assertOwnsOrg(req, orgId);
      const { data, error } = await getSupabaseAdmin(env)
        .from('branches')
        .insert({
          org_id: orgId,
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
   * POST /admin/staff — create a staff account (receptionist, branch_admin,
   * super_admin) with a matching profile row.
   *
   * Signup always provisions a patient (see handle_new_user in migration
   * 0013). Privileged roles must be granted server-side, so this is the only
   * supported way to create them — client-supplied role metadata is ignored
   * by the trigger on purpose.
   */
  r.post(
    '/staff',
    strictLimiter(env),
    auth,
    requireRole('super_admin', 'org_admin'),
    validate({
      body: z.object({
        email: z.string().email(),
        fullName: z.string().min(2).max(120),
        role: z.enum(['receptionist', 'branch_admin', 'super_admin']),
        branchId: z.string().uuid().optional(),
        phone: z.string().min(6).max(20).optional(),
        preferredLang: z.enum(['en', 'bn']).optional(),
        password: z.string().min(8).max(200).optional(),
      }),
    }),
    h(async (req: Request, res: Response) => {
      const body = req.body as {
        email: string;
        fullName: string;
        role: 'receptionist' | 'branch_admin' | 'super_admin';
        branchId?: string;
        phone?: string;
        preferredLang?: 'en' | 'bn';
        password?: string;
      };
      const admin = getSupabaseAdmin(env);

      // Privilege escalation guard: an org_admin may hire staff for their own
      // clinic but must never mint a platform super_admin. Only the platform
      // owner grants that role.
      if (req.auth!.role === 'org_admin' && body.role === 'super_admin') {
        throw ApiError.forbidden();
      }
      if (req.auth!.role === 'org_admin' && !req.auth!.orgId) {
        throw new ApiError(403, 'errors.forbidden', 'caller is not attached to an organisation');
      }

      // Branch scope is mandatory for branch-scoped roles: without it every
      // RLS predicate using current_branch_id() would deny the new user.
      if (body.role !== 'super_admin' && !body.branchId) {
        throw new ApiError(400, 'errors.invalidInput', 'branchId is required for branch-scoped roles');
      }
      if (body.branchId) {
        const branch = await branchOrgId(admin, body.branchId);
        if (!branch) throw new ApiError(400, 'errors.invalidInput', 'unknown branchId');
        // A clinic owner may only staff their own branches.
        if (req.auth!.role === 'org_admin') assertOwnsOrg(req, branch.org_id);
      }

      // 1) Auth user. The trigger creates a patient profile; we overwrite the
      //    role below. No `role` is passed in metadata — the trigger ignores it.
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: body.email,
        password: body.password ?? `${cryptoRandom(16)}Aa1!`,
        email_confirm: true,
        user_metadata: {
          full_name: body.fullName,
          ...(body.phone ? { phone: body.phone } : {}),
          ...(body.preferredLang ? { preferred_lang: body.preferredLang } : {}),
        },
      });
      if (createErr || !created.user) {
        const key = /already|registered|exists/i.test(createErr?.message ?? '') ? 'errors.conflict' : 'errors.upstream';
        throw new ApiError(key === 'errors.conflict' ? 409 : 502, key, createErr?.message);
      }
      const userId = created.user.id;

      // 2) Promote the auto-created profile to the requested staff role.
      const { error: profErr } = await admin
        .from('profiles')
        .update({
          role: body.role,
          branch_id: body.role === 'super_admin' ? null : body.branchId,
          // Staff inherit the branch's tenant so RLS scopes them correctly.
          org_id: body.role === 'super_admin' ? null : (await branchOrgId(admin, body.branchId!))?.org_id ?? null,
          full_name: body.fullName,
          ...(body.phone ? { phone: body.phone } : {}),
          ...(body.preferredLang ? { preferred_lang: body.preferredLang } : {}),
        })
        .eq('id', userId);
      if (profErr) {
        // Leaving a patient role behind would grant unintended self-service access.
        await admin.auth.admin.deleteUser(userId);
        throw ApiError.upstream('errors.upstream', profErr.message);
      }

      // 3) Staff are not patients — drop the row the trigger created.
      await admin.from('patients').delete().eq('owner_id', userId);

      logger.info({ actor: req.auth!.userId, userId, role: body.role }, 'staff account created');
      res.status(201).json({
        data: { userId, email: body.email, role: body.role, branchId: body.branchId ?? null },
      });
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
    requireRole('super_admin', 'branch_admin', 'org_admin'),
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
      // Fees belong to the branch's tenant: an org_admin may reprice only their
      // own clinics' doctors.
      if (req.auth!.role === 'org_admin') {
        const branch = await branchOrgId(admin, posting.branch_id);
        if (!branch) throw ApiError.notFound();
        assertOwnsOrg(req, branch.org_id);
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

