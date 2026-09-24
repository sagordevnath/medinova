import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { checkinSecret } from '../config/env.js';
import { requireAuth, requireRole, verifySupabaseJwt } from '../middleware/auth.js';
import { bookingLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { h } from '../utils/async.js';
import { ApiError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';
import { getSupabaseAdmin } from '../utils/supabase.js';
import { apptInstant } from '../utils/time.js';
import {
  assertCanAct,
  isStaff,
  loadAppointment,
  toSlipData,
  updateAppointment,
  type AppointmentRow,
} from '../services/appointment.service.js';
import { notify } from '../services/notification.service.js';
import { buildAppointmentSlip } from '../services/pdf.service.js';
import { checkInToken, verifyCheckIn } from '../services/qr.service.js';
import { bookSlotSchema } from '@medinova/shared';

type Envelope<T> = { data: T };

const idParam = z.object({ id: z.string().uuid() });

const reasonBody = z
  .object({ reason: z.string().max(300).optional() })
  .optional()
  .transform((v) => v ?? {});

const rescheduleBody = z.object({
  apptDate: z.string().date(),
  slotStart: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  doctorBranchId: z.string().uuid().optional(),
});

const checkInBody = z.object({
  /** Signed QR payload printed on the appointment slip. */
  qr: z.string().min(10).max(2000),
});

const NOT_FINAL = ['cancelled', 'no_show', 'completed'];

/** Patient cancel window: N hours before slot start (staff exempt). */
function withinCancelWindow(env: Env, appt: AppointmentRow, now = new Date()): boolean {
  const start = apptInstant(appt.appt_date, appt.slot_start);
  return start.getTime() - now.getTime() > env.CANCEL_WINDOW_HOURS * 3600_000;
}

export function appointmentsRouter(env: Env, logger: Logger): Router {
  const r: Router = Router();
  const auth = verifySupabaseJwt(env);

  /** POST /appointments/:id/confirm — staff confirms a pending booking. */
  r.post(
    '/:id/confirm',
    bookingLimiter(env),
    auth,
    requireRole('receptionist', 'branch_admin', 'super_admin'),
    h(async (req: Request, res: Response<Envelope<AppointmentRow>>) => {
      const { id } = idParam.parse(req.params);
      const appt = await loadAppointment(env, id);
      assertCanAct(req.auth!, appt, ['staff']);
      if (NOT_FINAL.includes(appt.status) && appt.status !== 'pending') {
        throw ApiError.conflict('errors.conflict');
      }
      await updateAppointment(env, id, { status: 'confirmed' });
      if (appt.patient) {
        await notify(env, logger, {
          userId: appt.patient.owner_id,
          title: `Appointment confirmed [${appt.code}]`,
          body: `Your appointment on ${appt.appt_date} ${String(appt.slot_start).slice(0, 5)} is confirmed.`,
        });
      }
      logger.info({ appt: appt.code, actor: req.auth!.userId }, 'appointment confirmed');
      res.json({ data: { ...appt, status: 'confirmed' } });
    }),
  );

  /** POST /appointments/:id/cancel — patient (≥ CANCEL_WINDOW_HOURS before) or staff; frees slot + notifies. */
  r.post(
    '/:id/cancel',
    bookingLimiter(env),
    auth,
    requireAuth,
    h(async (req: Request, res: Response<Envelope<AppointmentRow>>) => {
      const { id } = idParam.parse(req.params);
      const body = reasonBody.parse(req.body ?? {});
      const appt = await loadAppointment(env, id);
      assertCanAct(req.auth!, appt, ['staff', 'patient']);
      if (NOT_FINAL.includes(appt.status)) throw ApiError.conflict('errors.conflict');

      if (!isStaff(req.auth!) && !withinCancelWindow(env, appt)) {
        throw new ApiError(403, 'errors.cancelWindow');
      }

      // status='cancelled' frees the slot (partial unique index excludes it).
      await updateAppointment(env, id, {
        status: 'cancelled',
        cancelled_reason: body.reason ?? (isStaff(req.auth!) ? 'Cancelled by staff' : 'Cancelled by patient'),
      });
      if (appt.patient) {
        await notify(env, logger, {
          userId: appt.patient.owner_id,
          title: `Appointment cancelled [${appt.code}]`,
          body: body.reason ? `Reason: ${body.reason}` : 'Your appointment was cancelled. You can book a new slot anytime.',
        });
      }
      logger.info({ appt: appt.code, actor: req.auth!.userId }, 'appointment cancelled (slot freed)');
      res.json({ data: { ...appt, status: 'cancelled' } });
    }),
  );

  /**
   * POST /appointments/:id/reschedule — move a booking to a new slot.
   * Books the new slot first (atomic SLOT_TAKEN check) then cancels the old
   * one with a "rescheduled" reason, so a failure never loses the booking.
   */
  r.post(
    '/:id/reschedule',
    bookingLimiter(env),
    auth,
    requireAuth,
    h(async (req: Request, res: Response<Envelope<{ previous: AppointmentRow; appointment: unknown }>>) => {
      const { id } = idParam.parse(req.params);
      const body = rescheduleBody.parse(req.body);
      const appt = await loadAppointment(env, id);
      assertCanAct(req.auth!, appt, ['staff', 'patient']);
      if (NOT_FINAL.includes(appt.status)) throw ApiError.conflict('errors.conflict');
      if (!isStaff(req.auth!) && !withinCancelWindow(env, appt)) {
        throw new ApiError(403, 'errors.cancelWindow');
      }
      if (!appt.patient) throw ApiError.upstream();

      const targetPost = body.doctorBranchId ?? String(appt.doctor_branch_id);
      const { data: slots, error: slotErr } = await getSupabaseAdmin(env).rpc('get_available_slots', {
        p_doctor_branch_id: targetPost,
        p_date: body.apptDate,
      });
      if (slotErr) throw ApiError.upstream('errors.upstream', slotErr.message);
      const wanted = String(body.slotStart).slice(0, 5);
      const free = (slots ?? []).some(
        (s: { slot_start: string; is_available: boolean }) =>
          String(s.slot_start).slice(0, 5) === wanted && s.is_available,
      );
      if (!free) throw ApiError.conflict('errors.slotTaken');

      const { data: booked, error: bookErr } = await getSupabaseAdmin(env).rpc('book_appointment', {
        p_patient_id: appt.patient.id,
        p_doctor_branch_id: targetPost,
        p_date: body.apptDate,
        p_slot_start: wanted,
        p_visit_type: appt.visit_type,
        p_symptoms: appt.symptoms ?? null,
        p_created_by: req.auth!.userId,
      });
      if (bookErr) {
        const msg = bookErr.message ?? '';
        const key = msg.includes('SLOT_TAKEN')
          ? 'errors.slotTaken'
          : msg.includes('TELEMEDICINE_DISABLED')
            ? 'errors.telemedicineDisabled'
            : 'errors.upstream';
        throw new ApiError(key === 'errors.upstream' ? 502 : 409, key);
      }

      // New slot secured — release the old one.
      await updateAppointment(env, id, {
        status: 'cancelled',
        cancelled_reason: `Rescheduled to ${body.apptDate} ${wanted}`,
      });
      if (appt.patient) {
        await notify(env, logger, {
          userId: appt.patient.owner_id,
          title: `Appointment rescheduled [${appt.code}]`,
          body: `Moved to ${body.apptDate} ${wanted} (Asia/Dhaka). Your previous slot was released.`,
        });
      }
      logger.info({ from: appt.code, actor: req.auth!.userId, to: body.apptDate }, 'appointment rescheduled');
      res.status(201).json({ data: { previous: { ...appt, status: 'cancelled' }, appointment: booked } });
    }),
  );

  /**
   * POST /appointments/:id/check-in — validate the slip QR payload and set
   * the queue number + checked-in timestamp.
   */
  r.post(
    '/:id/check-in',
    bookingLimiter(env),
    auth,
    requireAuth,
    validate({ body: checkInBody }),
    h(async (req: Request, res: Response<Envelope<{ id: string; code: string; queueNo: number | null; checkedInAt: string }>>) => {
      const { id } = idParam.parse(req.params);
      const appt = await loadAppointment(env, id);
      assertCanAct(req.auth!, appt, ['staff', 'doctor', 'patient']);

      const payload = verifyCheckIn(String(req.body.qr), checkinSecret(env));
      if (payload.a !== appt.id || payload.c !== appt.code) throw ApiError.badRequest('errors.qrInvalid');
      if (appt.status === 'cancelled' || appt.status === 'no_show') throw ApiError.conflict('errors.conflict');
      if (appt.status === 'checked_in' || appt.status === 'in_consultation' || appt.status === 'completed') {
        throw ApiError.conflict('errors.alreadyCheckedIn');
      }

      let queueNo = appt.queue_no == null ? null : Number(appt.queue_no);
      if (queueNo == null) {
        const { data: next, error } = await getSupabaseAdmin(env).rpc('next_queue_number', {
          p_doctor_branch_id: appt.doctor_branch_id,
          p_date: appt.appt_date,
        });
        if (error) throw ApiError.upstream('errors.upstream', error.message);
        queueNo = Number(next);
      }

      const checkedInAt = new Date().toISOString();
      await updateAppointment(env, id, {
        status: 'checked_in',
        checked_in_at: checkedInAt,
        queue_no: queueNo,
      });
      logger.info({ appt: appt.code, queueNo, actor: req.auth!.userId }, 'patient checked in');
      res.json({ data: { id: appt.id, code: appt.code, queueNo, checkedInAt } });
    }),
  );

  /** GET /appointments/:id/slip.pdf — PDF slip with scannable check-in QR. */
  r.get(
    '/:id/slip.pdf',
    auth,
    requireAuth,
    h(async (req: Request, res: Response) => {
      const { id } = idParam.parse(req.params);
      const appt = await loadAppointment(env, id);
      assertCanAct(req.auth!, appt, ['staff', 'doctor', 'patient']);

      const token = checkInToken(appt.id, appt.code, apptInstant(appt.appt_date, appt.slot_end).getTime(), checkinSecret(env));
      const pdf = await buildAppointmentSlip(env, toSlipData(appt), token);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="medinova-slip-${appt.code}.pdf"`);
      res.setHeader('Content-Length', String(pdf.length));
      logger.info({ appt: appt.code, bytes: pdf.length }, 'slip pdf generated');
      res.end(pdf);
    }),
  );

  return r;
}
