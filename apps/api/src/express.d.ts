import type { Role } from '@medinova/shared';

/** Authenticated request context populated by verifySupabaseJwt + loadProfile. */
export interface AuthContext {
  userId: string;
  email?: string;
  /** Role from public.profiles when resolvable, else JWT app_metadata fallback. */
  role: Role | null;
  branchId?: string | null;
  /**
   * Tenant the caller belongs to. `org_admin` manages exactly this
   * organisation and nothing else; `super_admin` is platform-level and has no
   * org. Required because staff routes read through the service-role key,
   * which bypasses RLS, so tenant scoping has to happen in the handler.
   */
  orgId?: string | null;
  /** True when role came from the profiles table (authoritative). */
  profileLoaded: boolean;
  /**
   * The caller's raw access token. Routes that must respect RLS scoping query
   * PostgREST with this token rather than the server key, so RLS applies the
   * caller's own policy instead of the anon role's.
   */
  accessToken?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
      auth?: AuthContext;
    }
  }
}

export {};
