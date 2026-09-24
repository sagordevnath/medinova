import { Router } from 'express';

/** GET /health — liveness/readiness. No DB dependency (checks are at gateway level). */
export const healthRouter: Router = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'medinova-api',
    timezone: 'Asia/Dhaka',
    currency: 'BDT',
    time: new Date().toISOString(),
  });
});
