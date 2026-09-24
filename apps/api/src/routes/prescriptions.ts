import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { type Env } from '../config/env.js';
import { requireAuth, verifySupabaseJwt } from '../middleware/auth.js';
import { h } from '../utils/async.js';
import { ApiError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';
import { getSupabaseAdmin, awaitOk } from '../utils/supabase.js';
import { assertCanAct, loadAppointment } from '../services/appointment.service.js';
import { buildPrescriptionPdf, type PrescriptionData } from '../services/pdf.service.js';

const idParam = z.object({ appointmentId: z.string().uuid() });

interface RxRow {
  id: string;
  diagnosis: string | null;
  medicines: unknown;
  advice: string | null;
  next_visit_date: string | null;
  pdf_url: string | null;
  created_at: string;
}

/**
 * POST /prescriptions/:appointmentId/pdf — build the prescription PDF and
 * upload it to the `prescriptions` bucket (patient-foldered path, RLS-safe),
 * then store the public URL on the row.
 *
 * Allowed: the appointment's own doctor, or staff.
 */
export function prescriptionsRouter(env: Env, logger: Logger): Router {
  const r: Router = Router();
  const auth = verifySupabaseJwt(env);

  r.post(
    '/:appointmentId/pdf',
    auth,
    requireAuth,
    h(async (req: Request, res: Response<{ data: { pdfUrl: string; prescriptionId: string } }>) => {
      const { appointmentId } = idParam.parse(req.params);
      const appt = await loadAppointment(env, appointmentId);
      assertCanAct(req.auth!, appt, ['staff', 'doctor']);
      if (!appt.patient) throw ApiError.upstream();

      const rx = await awaitOk<RxRow | null>(
        getSupabaseAdmin(env)
          .from('prescriptions')
          .select('id, diagnosis, medicines, advice, next_visit_date, pdf_url, created_at')
          .eq('appointment_id', appointmentId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      if (!rx) throw ApiError.notFound('errors.noPrescription');

      const payload: PrescriptionData = {
        appointment: {
          id: appt.id,
          code: appt.code,
          apptDate: appt.appt_date,
          slotStart: appt.slot_start,
          slotEnd: appt.slot_end,
          visitType: String(appt.visit_type),
          status: String(appt.status),
          fee: Number(appt.fee),
          paymentStatus: String(appt.payment_status),
          queueNo: appt.queue_no == null ? null : Number(appt.queue_no),
          symptoms: (appt.symptoms as string | null) ?? null,
        },
        patient: {
          fullName: appt.patient.full_name,
          phone: (appt.patient.phone as string | null) ?? null,
          gender: (appt.patient.gender as string | null) ?? null,
          bloodGroup: (appt.patient.blood_group as string | null) ?? null,
        },
        doctor: {
          fullName: String(appt.doctor?.full_name ?? '—'),
          specialties: (appt.doctor?.specialties as string[] | null) ?? null,
        },
        branch: {
          name: String(appt.branch?.name ?? 'MediNova'),
          address: String(appt.branch?.address ?? ''),
          city: String(appt.branch?.city ?? ''),
          phone: String(appt.branch?.phone ?? ''),
          emergencyPhone: String(appt.branch?.emergency_phone ?? ''),
        },
        prescription: {
          diagnosis: rx.diagnosis,
          medicines: rx.medicines,
          advice: rx.advice,
          nextVisitDate: rx.next_visit_date,
          createdAt: rx.created_at,
        },
      };

      const pdf = await buildPrescriptionPdf(env, payload);
      // Path must be `<patient_id>/<file>` for storage RLS (foldername[1] = patient).
      const path = `${appt.patient.id}/${appt.id}-${rx.id}.pdf`;
      const { error: upErr } = await getSupabaseAdmin(env)
        .storage.from(env.PRESCRIPTIONS_BUCKET)
        .upload(path, pdf, { contentType: 'application/pdf', upsert: true });
      if (upErr) throw ApiError.upstream('errors.upstream', upErr.message);

      const { data: pub } = getSupabaseAdmin(env).storage.from(env.PRESCRIPTIONS_BUCKET).getPublicUrl(path);
      const pdfUrl = pub.publicUrl;

      const { error: updErr } = await getSupabaseAdmin(env)
        .from('prescriptions')
        .update({ pdf_url: pdfUrl })
        .eq('id', rx.id);
      if (updErr) throw ApiError.upstream('errors.upstream', updErr.message);

      logger.info({ appointmentId, prescriptionId: rx.id, bytes: pdf.length }, 'prescription pdf uploaded');
      res.json({ data: { pdfUrl, prescriptionId: rx.id } });
    }),
  );

  return r;
}
