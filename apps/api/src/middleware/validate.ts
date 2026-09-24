import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ApiError } from '../utils/errors.js';

type Schemas = {
  body?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
};

/**
 * Zod validation middleware. On failure responds 400 with
 * { error: 'errors.validation', details: zodError.flatten() }.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    const details: Record<string, unknown> = {};
    for (const key of ['params', 'query', 'body'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const parsed = schema.safeParse(req[key]);
      if (!parsed.success) {
        details[key] = parsed.error.flatten();
        continue;
      }
      // Replace with the coerced/parsed value (strip unknown keys).
      (req as unknown as Record<string, unknown>)[key] = parsed.data;
    }
    if (Object.keys(details).length > 0) {
      next(ApiError.badRequest('errors.validation', details));
      return;
    }
    next();
  };
}
