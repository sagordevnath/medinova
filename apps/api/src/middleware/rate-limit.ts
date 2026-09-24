import type { RequestHandler } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import type { Env } from '../config/env.js';

function make(windowMs: number, limit: number, message: string): RequestHandler {
  const opts: Partial<Options> = {
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message },
  };
  // IPv6-safe keying; hashing keeps pino logs free of raw IPs when enabled.
  return rateLimit(opts as Options);
}

/** General API limiter: RATE_MAX requests / window per IP. */
export function generalLimiter(env: Env): RequestHandler {
  return make(env.RATE_WINDOW_MS, env.RATE_MAX, 'errors.rateLimited');
}

/** Stricter limiter for booking + auth-adjacent routes. */
export function bookingLimiter(env: Env): RequestHandler {
  return make(env.RATE_WINDOW_MS, env.RATE_BOOKING_MAX, 'errors.rateLimited');
}

/** Strict limiter for admin / notify / payment init. */
export function strictLimiter(env: Env): RequestHandler {
  return make(env.RATE_WINDOW_MS, env.RATE_STRICT_MAX, 'errors.rateLimited');
}

/** Strictest limiter for AI triage (proxy cost + safety). */
export function aiLimiter(env: Env): RequestHandler {
  return make(env.RATE_WINDOW_MS, env.RATE_AI_MAX, 'errors.rateLimited');
}
