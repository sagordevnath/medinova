import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { requireRole, verifySupabaseJwt } from '../middleware/auth.js';
import { strictLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { h } from '../utils/async.js';
import type { Logger } from '../utils/logger.js';
import { notify, type NotifyResult } from '../services/notification.service.js';

const testBody = z.object({
  /** Target user (defaults to the caller — usually a staff test account). */
  userId: z.string().uuid().optional(),
  title: z.string().min(1).max(120).default('MediNova test notification'),
  body: z.string().max(500).optional(),
  email: z.boolean().default(true),
  sms: z.boolean().default(false),
});

/**
 * POST /notify/test — staff-only smoke test for the notification pipeline
 * (in-app row + Resend email + BD SMS gateway stub).
 */
export function notifyRouter(env: Env, logger: Logger): Router {
  const r: Router = Router();
  const auth = verifySupabaseJwt(env);

  r.post(
    '/test',
    strictLimiter(env),
    auth,
    requireRole('receptionist', 'branch_admin', 'super_admin'),
    validate({ body: testBody }),
    h(async (req: Request, res: Response<{ data: NotifyResult }>) => {
      const body = testBody.parse(req.body);
      const userId = body.userId ?? req.auth!.userId;
      const result = await notify(env, logger, {
        userId,
        title: body.title,
        body: body.body ?? `Test from ${req.auth!.userId} at ${new Date().toISOString()}`,
        email: body.email,
        sms: body.sms,
      });
      res.json({ data: result });
    }),
  );

  return r;
}
