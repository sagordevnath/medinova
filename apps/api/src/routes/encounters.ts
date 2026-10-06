import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { encounterCreateSchema, encounterUpdateSchema, medicalHistorySchema } from '@medinova/shared';
import type { Env } from '../config/env.js';
import { requireRole, verifySupabaseJwt } from '../middleware/auth.js';
import { generalLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { h } from '../utils/async.js';
import { ApiError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';
import { getSupabaseAdmin } from '../utils/supabase.js';

type Envelope<T> = { data: T; meta?: Record<string, unknown> };

type VitalsIn = Partial<Record<string, number | string | null>>;

/** camelCase vitals -> snake_case columns, dropping anything not supplied. */
function vitalsRow(v: VitalsIn): Record<string, number | string | null> {
  const map: Record<string, string> = {
    bpSystolic: 'bp_systolic',
    bpDiastolic: 'bp_diastolic',
    pulse: 'pulse',
    temperatureC: 'temperature_c',
    weightKg: 'weight_kg',
    heightCm: 'height_cm',
    spo2: 'spo2',
    respiratoryRate: 'respiratory_rate',
    notes: 'notes',
  };
  const row: Record<string, number | string | null> = {};
  for (const [k, col] of Object.entries(map)) {
    const val = v[k];
    if (val !== undefined && val !== null && val !== '') row[col] = val as number | string;
  }
  return row;
}

const shapeVitals = (r: Record<string, unknown> | null | undefined) =>
  r
    ? {
        id: r.id,
        bpSystolic: r.bp_systolic,
        bpDiastolic: r.bp_diastolic,
        pulse: r.pulse,
        temperatureC: r.temperature_c,
        weightKg: r.weight_kg,
        heightCm: r.height_cm,
        spo2: r.spo2,
        respiratoryRate: r.respiratory_rate,
        notes: r.notes,
        recordedAt: r.recorded_at,
      }
    : null;

const shapeEncounter = (r: Record<string, unknown>, vitals?: Record<string, unknown> | null) => ({
  id: r.id,
  orgId: r.org_id,
  branchId: r.branch_id,
  appointmentId: r.appointment_id,
  doctorId: r.doctor_id,
  patientId: r.patient_id,
  visitType: r.visit_type,
  status: r.status,
  chiefComplaint: r.chief_complaint,
  historyOfPresentIllness: r.history_of_present_illness,
  examination: r.examination,
  diagnosisCode: r.diagnosis_code,
  diagnosisText: r.diagnosis_text,
  plan: r.plan,
  advice: r.advice,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  vitals: shapeVitals(vitals ?? undefined),
});

const shapeHistory = (r: Record<string, unknown>) => ({
  id: r.id,
  patientId: r.patient_id,
  kind: r.kind,
  condition: r.condition,
  onsetDate: r.onset_date,
  resolvedDate: r.resolved_date,
  code: r.code,
  notes: r.notes,
});

/**
 * Clinical encounters (Module 17).
 *
 * An encounter records what a doctor actually did during a consultation. It is
 * tenant-scoped, and patients may read their own record so the portal can show
 * history, prescriptions and reports together.
 */
export function encountersRouter(env: Env, logger: Logger): Router {
  const r: Router = Router();
  const auth = verifySupabaseJwt(env);
  const db = () => getSupabaseAdmin(env);
  const clinician = requireRole('doctor', 'org_admin', 'branch_admin', 'receptionist');

  /** Resolve which clinic this work belongs to. */
  const resolveOrg = async (userId: string, appointmentId?: string, patientId?: string) => {
    const supabase = db();
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', userId)
      .maybeSingle();
    let orgId = (profile as { org_id?: string } | null)?.org_id ?? null;
    if (!orgId && appointmentId) {
      const { data } = await supabase
        .from('appointments')
        .select('org_id')
        .eq('id', appointmentId)
        .maybeSingle();
      orgId = (data as { org_id?: string } | null)?.org_id ?? null;
    }
    if (!orgId && patientId) {
      const { data } = await supabase
        .from('appointments')
        .select('org_id')
        .eq('patient_id', patientId)
        .not('org_id', 'is', null)
        .limit(1);
      orgId = (data?.[0] as { org_id?: string } | null)?.org_id ?? null;
    }
    return orgId;
  };

  const loadVitals = async (encounterId: string) => {
    const { data } = await db()
      .from('vitals')
      .select('*')
      .eq('encounter_id', encounterId)
      .order('recorded_at', { ascending: false })
      .limit(1);
    return (data?.[0] as Record<string, unknown> | null) ?? null;
  };

/** POST /encounters — open a consultation, optionally recording vitals. */
  r.post(
    '/',
    generalLimiter(env),
    auth,
    clinician,
    validate({ body: encounterCreateSchema }),
    h(async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
      const body = encounterCreateSchema.parse(req.body);
      const supabase = db();

      const orgId = await resolveOrg(req.auth!.userId, body.appointmentId ?? undefined, body.patientId);
      if (!orgId) throw new ApiError(400, 'errors.invalidInput', 'cannot determine clinic for this encounter');

      const { data: enc, error } = await supabase
        .from('encounters')
        .insert({
          org_id: orgId,
          branch_id: body.branchId ?? null,
          appointment_id: body.appointmentId ?? null,
          doctor_id: body.doctorId ?? null,
          patient_id: body.patientId,
          visit_type: body.visitType,
          status: body.status,
          chief_complaint: body.chiefComplaint ?? null,
          history_of_present_illness: body.historyOfPresentIllness ?? null,
          examination: body.examination ?? null,
          diagnosis_code: body.diagnosisCode ?? null,
          diagnosis_text: body.diagnosisText ?? null,
          plan: body.plan ?? null,
          advice: body.advice ?? null,
          created_by: req.auth!.userId,
        })
        .select('*')
        .single();
      if (error) {
        const key = /unique|duplicate/i.test(error.message)
          ? 'errors.encounterExistsForAppointment'
          : 'errors.upstream';
        throw ApiError.upstream(key, error.message);
      }

      const encounterId = (enc as { id: string }).id;
      let vitals: Record<string, unknown> | null = null;
      if (body.vitals && Object.keys(vitalsRow(body.vitals)).length > 0) {
        const { data: v, error: vErr } = await supabase
          .from('vitals')
          .insert({
            encounter_id: encounterId,
            patient_id: body.patientId,
            org_id: orgId,
            recorded_by: req.auth!.userId,
            ...vitalsRow(body.vitals),
          })
          .select('*')
          .single();
        if (vErr) throw ApiError.upstream('errors.upstream', vErr.message);
        vitals = v as Record<string, unknown>;
      }

      logger.info({ actor: req.auth!.userId, encounter: encounterId }, 'encounter opened');
      res.status(201).json({ data: shapeEncounter(enc as Record<string, unknown>, vitals) });
    }),
  );

  /** GET /encounters — list encounters (RLS narrows to clinic or own record). */
  r.get(
    '/',
    generalLimiter(env),
    auth,
    validate({
      query: z.object({
        patientId: z.string().uuid().optional(),
        doctorId: z.string().uuid().optional(),
        status: z.string().optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
    }),
    h(async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
      const q = z
        .object({
          patientId: z.string().uuid().optional(),
          doctorId: z.string().uuid().optional(),
          status: z.string().optional(),
          from: z.string().date().optional(),
          to: z.string().date().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        })
        .parse(req.query);
      const supabase = db();

      let query = supabase
        .from('encounters')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(q.limit);
      if (q.patientId) query = query.eq('patient_id', q.patientId);
      if (q.doctorId) query = query.eq('doctor_id', q.doctorId);
      if (q.status) query = query.eq('status', q.status);
      if (q.from) query = query.gte('started_at', `${q.from}T00:00:00Z`);
      if (q.to) query = query.lte('started_at', `${q.to}T23:59:59Z`);

      const { data, error } = await query;
      if (error) throw ApiError.upstream('errors.upstream', error.message);

      const rows = (data ?? []) as Record<string, unknown>[];
      const shaped = await Promise.all(
        rows.map(async (e) => shapeEncounter(e, await loadVitals(e.id as string))),
      );
      res.json({ data: shaped, meta: { count: shaped.length, limit: q.limit } });
    }),
  );

/** GET /encounters/:id — one encounter with its latest vitals. */
  r.get(
    '/:id',
    generalLimiter(env),
    auth,
    validate({ params: z.object({ id: z.string().uuid() }) }),
    h(async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { data, error } = await db().from('encounters').select('*').eq('id', id).maybeSingle();
      if (error) throw ApiError.upstream('errors.upstream', error.message);
      if (!data) throw ApiError.notFound();
      const vitals = await loadVitals(id);
      res.json({ data: shapeEncounter(data as Record<string, unknown>, vitals) });
    }),
  );

  /** PATCH /encounters/:id — update notes, or complete the consultation. */
  r.patch(
    '/:id',
    generalLimiter(env),
    auth,
    clinician,
    validate({
      params: z.object({ id: z.string().uuid() }),
      body: encounterUpdateSchema,
    }),
    h(async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = encounterUpdateSchema.parse(req.body);
      const supabase = db();

      const { data: current, error: curErr } = await supabase
        .from('encounters')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (curErr) throw ApiError.upstream('errors.upstream', curErr.message);
      if (!current) throw ApiError.notFound();
      const cur = current as Record<string, unknown>;

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.status !== undefined) patch.status = body.status;
      if (body.chiefComplaint !== undefined) patch.chief_complaint = body.chiefComplaint;
      if (body.historyOfPresentIllness !== undefined)
        patch.history_of_present_illness = body.historyOfPresentIllness;
      if (body.examination !== undefined) patch.examination = body.examination;
      if (body.diagnosisCode !== undefined) patch.diagnosis_code = body.diagnosisCode;
      if (body.diagnosisText !== undefined) patch.diagnosis_text = body.diagnosisText;
      if (body.plan !== undefined) patch.plan = body.plan;
      if (body.advice !== undefined) patch.advice = body.advice;

      const { data: enc, error } = await supabase
        .from('encounters')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw ApiError.upstream('errors.upstream', error.message);

      // Vitals are append-only readings: overwrite the same encounter's latest
      // set rather than rewriting history, so a trend over time still holds.
      let vitals = await loadVitals(id);
      if (body.vitals && Object.keys(vitalsRow(body.vitals)).length > 0) {
        const patchV = {
          ...vitalsRow(body.vitals),
          recorded_by: req.auth!.userId,
          recorded_at: new Date().toISOString(),
        };
        if (vitals) {
          const { data: v } = await supabase
            .from('vitals')
            .update(patchV)
            .eq('id', vitals.id as string)
            .select('*')
            .single();
          vitals = v as Record<string, unknown> | null;
        } else {
          const { data: v } = await supabase
            .from('vitals')
            .insert({
              encounter_id: id,
              patient_id: cur.patient_id,
              org_id: cur.org_id,
              ...patchV,
            })
            .select('*')
            .single();
          vitals = v as Record<string, unknown> | null;
        }
      }

      logger.info(
        { actor: req.auth!.userId, encounter: id, status: patch.status ?? cur.status },
        'encounter updated',
      );
      res.json({ data: shapeEncounter(enc as Record<string, unknown>, vitals) });
    }),
  );

// --- Structured medical history --------------------------------------------

  /** GET /encounters/patients/:patientId/history */
  r.get(
    '/patients/:patientId/history',
    generalLimiter(env),
    auth,
    validate({ params: z.object({ patientId: z.string().uuid() }) }),
    h(async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
      const { patientId } = z.object({ patientId: z.string().uuid() }).parse(req.params);
      const { data, error } = await db()
        .from('medical_history')
        .select('*')
        .eq('patient_id', patientId)
        .order('kind');
      if (error) throw ApiError.upstream('errors.upstream', error.message);
      res.json({ data: (data ?? []).map((x) => shapeHistory(x as Record<string, unknown>)) });
    }),
  );

  /** POST /encounters/history — record one structured history entry. */
  r.post(
    '/history',
    generalLimiter(env),
    auth,
    clinician,
    validate({ body: medicalHistorySchema }),
    h(async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
      const body = medicalHistorySchema.parse(req.body);
      const { data, error } = await db()
        .from('medical_history')
        .insert({
          patient_id: body.patientId,
          kind: body.kind,
          condition: body.condition,
          onset_date: body.onsetDate ?? null,
          resolved_date: body.resolvedDate ?? null,
          code: body.code ?? null,
          notes: body.notes ?? null,
        })
        .select('*')
        .single();
      if (error) throw ApiError.upstream('errors.upstream', error.message);
      res.status(201).json({ data: shapeHistory(data as Record<string, unknown>) });
    }),
  );

  /** DELETE /encounters/history/:id — remove a history entry. */
  r.delete(
    '/history/:id',
    generalLimiter(env),
    auth,
    clinician,
    validate({ params: z.object({ id: z.string().uuid() }) }),
    h(async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { data, error } = await db().from('medical_history').delete().eq('id', id).select('id').maybeSingle();
      if (error) throw ApiError.upstream('errors.upstream', error.message);
      if (!data) throw ApiError.notFound();
      res.json({ data: { id, deleted: true } });
    }),
  );

  return r;
}
