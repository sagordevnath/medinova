import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from '../utils/logger.js';
import { ApiError, isApiError } from '../utils/errors.js';

/** 404 for unknown API paths (mounted after all routers). */
export const notFound: RequestHandler = (_req, _res, next) => {
  next(ApiError.notFound());
};

/** Central error handler → { error: i18nKey, details? }. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, _res, next) => {
    if (err instanceof ZodError) {
      _res.status(400).json({ error: 'errors.validation', details: err.flatten() });
      return;
    }
    if (isApiError(err)) {
      if (err.status >= 500) logger.error({ err, reqId: req.id }, 'request failed');
      else logger.warn({ err: err.key, reqId: req.id, status: err.status }, 'request rejected');
      _res.status(err.status).json({ error: err.key, details: err.details });
      return;
    }
    logger.error({ err, reqId: req.id }, 'unhandled error');
    _res.status(500).json({ error: 'errors.internal' });
    void next;
  };
}
