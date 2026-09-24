import { Router } from 'express';
import type { Env } from '../config/env.js';
import type { Logger } from '../utils/logger.js';
import { generalLimiter, bookingLimiter } from '../middleware/rate-limit.js';
import { healthRouter } from './health.js';
import { router as catalogRouter } from './catalog.js';
import { appointmentsRouter } from './appointments.js';
import { prescriptionsRouter } from './prescriptions.js';
import { paymentsRouter } from './payments.js';
import { aiRouter } from './ai.js';
import { notifyRouter } from './notify.js';
import { adminRouter } from './admin.js';

/**
 * Build the versioned API router mounted at /api/v1 (and /v1 for the web
 * app's legacy catalog calls). Booking POST gets the stricter limiter.
 */
export function apiRouter(env: Env, logger: Logger): Router {
  const r: Router = Router();

  r.use(generalLimiter(env));
  r.use('/health', healthRouter);
  r.use('/', catalogRouter); // branches, departments, doctors, slots, POST /appointments
  r.post('/appointments', bookingLimiter(env));
  r.use('/appointments', appointmentsRouter(env, logger));
  r.use('/prescriptions', prescriptionsRouter(env, logger));
  r.use('/payments', paymentsRouter(env, logger));
  r.use('/ai', aiRouter(env, logger));
  r.use('/notify', notifyRouter(env, logger));
  r.use('/admin', adminRouter(env, logger));

  return r;
}
