import type { RequestHandler } from 'express';
import { jwtVerify } from 'jose';
import type { Role } from '@medinova/shared';
import { jwtSecret, type Env } from '../config/env.js';
import { getSupabaseAdmin } from '../utils/supabase.js';
import { ApiError } from '../utils/errors.js';

interface JwtClaims {
  sub?: string;
  email?: string;
  role?: string;
  app_metadata?: { role?: string; [k: string]: unknown };
  [k: string]: unknown;
}

/**
 * Verify the caller's Supabase access token (HS256, project JWT secret).
 * Populates req.auth with userId/email + role (profiles table preferred,
 * JWT app_metadata fallback for offline/dev).
 */
export function verifySupabaseJwt(env: Env): RequestHandler {
  const secret = new TextEncoder().encode(jwtSecret(env));
  return async (req, _res, next) => {
    try {
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      if (!token) throw ApiError.unauthorized();

      const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
      const claims = payload as JwtClaims;
      if (!claims.sub) throw ApiError.unauthorized();

      req.auth = {
        userId: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : undefined,
        role: normalizeRole(claims.app_metadata?.role) ?? null,
        branchId: null,
        profileLoaded: false,
      };

      // Enrich from public.profiles (authoritative role + branch scoping).
      try {
        const { data } = await getSupabaseAdmin(env)
          .from('profiles')
          .select('role, branch_id')
          .eq('id', claims.sub)
          .maybeSingle();
        if (data) {
          req.auth.role = normalizeRole(data.role) ?? req.auth.role;
          req.auth.branchId = (data.branch_id as string | null) ?? null;
          req.auth.profileLoaded = true;
        }
      } catch {
        // Offline/dev: keep JWT fallback role.
      }
      next();
    } catch (err) {
      next(err instanceof ApiError ? err : ApiError.unauthorized());
    }
  };
}

function normalizeRole(r: unknown): Role | null {
  const allowed: Role[] = ['patient', 'doctor', 'receptionist', 'branch_admin', 'super_admin'];
  return allowed.includes(r as Role) ? (r as Role) : null;
}

/** 401 when unauthenticated, 403 when the resolved role is not allowed. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) return next(ApiError.unauthorized());
    const role = auth.role;
    if (!role || !roles.includes(role)) return next(ApiError.forbidden());
    next();
  };
}

/** 401 when unauthenticated (any signed-in role passes). */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(ApiError.unauthorized());
  next();
};
