import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { requireAuth, verifySupabaseJwt } from '../middleware/auth.js';
import { strictLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { h } from '../utils/async.js';
import { ApiError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';
import { handleWebhook, initPayment, type PaymentProvider } from '../services/payment.service.js';
import { assertCanAct, loadAppointment } from '../services/appointment.service.js';

const initBody = z.object({
  appointmentId: z.string().uuid(),
  provider: z.enum(['cash', 'bkash', 'nagad', 'sslcommerz']).default('cash'),
  returnUrl: z.string().url().optional(),
});

const webhookBody = z.object({
  provider: z.enum(['bkash', 'nagad', 'sslcommerz']),
  appointmentId: z.string().uuid(),
  amount: z.number().positive(),
});

/** Signature header per provider (documented sandbox contracts). */
function signatureOf(provider: PaymentProvider, headers: Record<string, unknown>): string | undefined {
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = headers[k];
      if (typeof v === 'string' && v) return v;
    }
    return undefined;
  };
  if (provider === 'bkash') return pick('x-bkash-signature');
  if (provider === 'nagad') return pick('x-nagad-signature');
  return pick('x-sslc-signature', 'x-sslcommerz-signature');
}

export function paymentsRouter(env: Env, logger: Logger): Router {
  const r: Router = Router();
  const auth = verifySupabaseJwt(env);

  /**
   * POST /payments/init — start a payment. Cash (default) marks the
   * appointment pay_at_counter; gateways return a sandbox redirect URL.
   */
  r.post(
    '/init',
    strictLimiter(env),
    auth,
    requireAuth,
    validate({ body: initBody }),
    h(async (req: Request, res: Response) => {
      const body = initBody.parse(req.body);
      // Patients may only open payments for their own appointments; staff any.
      const appt = await loadAppointment(env, body.appointmentId);
      assertCanAct(req.auth!, appt, ['staff', 'patient']);

      const result = await initPayment(env, logger, {
        appointmentId: body.appointmentId,
        provider: body.provider,
        returnUrl: body.returnUrl,
      });
      res.json({ data: result });
    }),
  );

  /**
   * POST /payments/webhook — gateway callback. Verified via provider
   * signature (HMAC) before settling; no session auth (external callers).
   */
  r.post(
    '/webhook',
    strictLimiter(env),
    h(async (req: Request, res: Response) => {
      const parsed = webhookBody.safeParse(req.body);
      if (!parsed.success) throw ApiError.badRequest('errors.validation', parsed.error.flatten());
      const provider = parsed.data.provider;
      const signature = signatureOf(provider, req.headers as Record<string, unknown>);

      const result = await handleWebhook(env, logger, provider, signature, req.body as Record<string, unknown>);
      if (!result.ok) throw ApiError.unauthorized('errors.webhookSignature');
      res.json({ data: { settled: true, paymentId: result.providerRef } });
    }),
  );

  return r;
}
