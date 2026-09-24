import type { Role } from '@medinova/shared';

/** Authenticated request context populated by verifySupabaseJwt + loadProfile. */
export interface AuthContext {
  userId: string;
  email?: string;
  /** Role from public.profiles when resolvable, else JWT app_metadata fallback. */
  role: Role | null;
  branchId?: string | null;
  /** True when role came from the profiles table (authoritative). */
  profileLoaded: boolean;
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
