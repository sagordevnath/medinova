import type { Request, RequestHandler } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ROLES, type Role } from '@medinova/shared';
import { jwtSecret, isPlaceholderJwtSecret, type Env } from '../config/env.js';
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
 * Verify the caller's Supabase access token and populate req.auth with
 * userId/email + role (profiles table preferred, JWT app_metadata fallback).
 *
 * Two signing schemes must be supported:
 *   - ES256/RS256 via the project's JWKS (asymmetric). This is what current
 *     hosted Supabase projects issue, including those using the new
 *     `sb_publishable_` keys.
 *   - HS256 via JWT_SECRET. Used by older projects and self-hosted Supabase.
 *
 * Accepting only HS256 (the previous behaviour) made every real token fail with
 * an opaque 401, so authenticated pages appeared blank.
 */
export function verifySupabaseJwt(env: Env): RequestHandler {
  const secret = new TextEncoder().encode(jwtSecret(env));
  let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  /** Build (once) the remote JWKS for this project; jose caches the keys. */
  const jwksFor = () => {
    if (!jwks) {
      const base = env.SUPABASE_URL.replace(/\/$/, '');
      jwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`), {
        timeoutDuration: 5000,
        cooldownDuration: 30000,
        cacheMaxAge: 600000,
      });
    }
    return jwks;
  };

  return async (req, _res, next) => {
    try {
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      if (!token) throw ApiError.unauthorized();

      // Read the JWT header first so the right verification strategy is used.
      let alg: string | undefined;
      try {
        alg = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).alg;
      } catch {
        throw ApiError.unauthorized();
      }

      let payload: Record<string, unknown>;
      try {
        if (alg === 'HS256') {
          ({ payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] }));
        } else {
          // jose v5 accepts the remote JWKS directly as the key resolver: it
          // picks the JWK from the token's 'kid' header and checks 'alg' itself.
          ({ payload } = await jwtVerify(token, jwksFor(), { algorithms: ['ES256', 'RS256'] }));
        }
      } catch (e) {
        // A wrong secret or unreachable JWKS is otherwise a bare 401.
        console.error({
          msg: 'JWT verification failed',
          alg,
          reason: (e as Error).message,
          placeholderSecret: isPlaceholderJwtSecret(env),
        });
        throw ApiError.unauthorized();
      }
      const claims = payload as JwtClaims;
      if (!claims.sub) throw ApiError.unauthorized();

      req.auth = {
        userId: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : undefined,
        role: normalizeRole(claims.app_metadata?.role) ?? null,
        branchId: null,
        orgId: null,
        profileLoaded: false,
        accessToken: token,
      };

      // Enrich from public.profiles (authoritative role + branch scoping).
      try {
        const { data } = await getSupabaseAdmin(env)
          .from('profiles')
          .select('role, branch_id, org_id')
          .eq('id', claims.sub)
          .maybeSingle();
        if (data) {
          req.auth.role = normalizeRole(data.role) ?? req.auth.role;
          req.auth.branchId = (data.branch_id as string | null) ?? null;
          req.auth.orgId = (data.org_id as string | null) ?? null;
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

/**
 * Coerce an untrusted role string to the Role union.
 *
 * Derived from the shared ROLES list rather than re-typed here: a hardcoded
 * copy silently dropped org_admin, so every clinic owner resolved to a null
 * role and was rejected by requireRole with an opaque 403.
 */
function normalizeRole(r: unknown): Role | null {
  return ROLES.includes(r as Role) ? (r as Role) : null;
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

/**
 * Guard for routes that write tenant-owned data through the service-role key.
 *
 * getSupabaseAdmin() bypasses RLS, so `requireRole('org_admin')` on its own
 * would let any clinic owner create branches and staff inside a competitor's
 * organisation. These handlers must therefore verify the target row belongs to
 * the caller's own org on every write.
 *
 * super_admin is platform-level and passes through; a null orgId is never
 * treated as "unrestricted" — an org_admin with no org is a broken profile,
 * not an all-access pass.
 */
export function assertOwnsOrg(req: Request, orgId: unknown): void {
  const auth = req.auth;
  if (!auth) throw ApiError.unauthorized();
  if (auth.role === 'super_admin') return;
  if (auth.role !== 'org_admin') throw ApiError.forbidden();
  if (typeof orgId !== 'string' || !orgId) {
    throw new ApiError(403, 'errors.forbidden', 'target has no organisation');
  }
  if (!auth.orgId) {
    throw new ApiError(403, 'errors.forbidden', 'caller is not attached to an organisation');
  }
  if (orgId !== auth.orgId) throw ApiError.forbidden();
}
