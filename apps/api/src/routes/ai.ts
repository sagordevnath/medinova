import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { requireAuth, verifySupabaseJwt } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { h } from '../utils/async.js';
import type { Logger } from '../utils/logger.js';
import { triage, TRIAGE_DISCLAIMER, type TriageResult } from '../services/ai.service.js';

const triageBody = z.object({
  symptoms: z.string().min(3).max(2000),
  /** Optional: attach the structured suggestion to an appointment (never the raw text). */
  appointmentId: z.string().uuid().optional(),
  lang: z.enum(['en', 'bn']).optional(),
});

/**
 * POST /ai/triage — symptom text → department + urgency.
 * Rate-limited strictly; raw text is never persisted (see ai.service).
 * Response always carries a strict medical disclaimer.
 */
export function aiRouter(env: Env, logger: Logger): Router {
  const r: Router = Router();
  const auth = verifySupabaseJwt(env);

  r.post(
    '/triage',
    aiLimiter(env),
    auth,
    requireAuth,
    validate({ body: triageBody }),
    h(async (req: Request, res: Response<{ data: TriageResult; meta: { disclaimer: string } }>) => {
      const body = triageBody.parse(req.body);
      const result = await triage(env, logger, body.symptoms);
      logger.info(
        { urgency: result.urgency, department: result.department, chars: body.symptoms.length },
        'ai triage served',
      );
      res.json({ data: result, meta: { disclaimer: TRIAGE_DISCLAIMER } });
    }),
  );

  return r;
}
