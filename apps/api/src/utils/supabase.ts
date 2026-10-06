import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../config/env.js';

let adminClient: SupabaseClient | null = null;

/** Placeholder defaults from env.ts that are not usable Supabase keys. */
const isUsableKey = (k: string | undefined): k is string => {
  if (!k) return false;
  const t = k.trim();
  return t.length > 20 && !t.startsWith('dev-') && !/^<.*>$/.test(t);
};

/**
 * Read the `role` claim from a Supabase JWT without verifying it.
 *
 * Only used to fail loudly on a misconfigured key. Returns null for the new
 * `sb_publishable_` / `sb_secret_` formats, which are opaque and handled below.
 */
function jwtRoleClaim(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { role?: string };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * True when the key would actually bypass RLS.
 *
 * A length check alone is not enough: the anon key is a real 200+ char JWT, so
 * it passes any sanity check while still being subject to every policy. That
 * combination produced staff routes returning zero rows with no error anywhere,
 * which is far harder to diagnose than a hard failure.
 */
export function hasServiceRoleAccess(key: string | undefined): boolean {
  if (!isUsableKey(key)) return false;
  // sb_secret_ is the new-format equivalent of the service_role key.
  if (key!.startsWith('sb_secret_')) return true;
  if (key!.startsWith('sb_publishable_')) return false;
  const role = jwtRoleClaim(key!);
  return role === 'service_role';
}

export function getSupabaseAdmin(env: Env): SupabaseClient {
  if (!adminClient) {
    // Prefer the service-role key (bypasses RLS). Without one, fall back to the
    // anon/publishable key so public catalog reads still work — RLS then limits
    // the API to anon-readable rows, which is exactly what the catalog needs.
    // Previously this used the 'dev-service-key' placeholder, which Supabase
    // rejects with 401, so every route silently returned an empty list.
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    const hasService = hasServiceRoleAccess(serviceKey);
    const key = hasService ? serviceKey! : env.SUPABASE_ANON_KEY;

    if (!isUsableKey(key)) {
      throw new Error(
        'Supabase key missing: set SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY in apps/api/.env',
      );
    }

    if (isUsableKey(serviceKey) && !hasService) {
      // The dangerous case: a real-looking key that is not service_role. Staff
      // reads will return nothing and writes will fail policy checks, so say so
      // loudly rather than degrading to an empty dashboard.
      console.error(
        '[medinova] SUPABASE_SERVICE_ROLE_KEY is set but its JWT role claim is NOT "service_role" ' +
          `(found: ${jwtRoleClaim(serviceKey) ?? 'unreadable'}). RLS is still applied. Staff, invoice ` +
          'and encounter routes will read zero tenant rows. Copy the service_role key from ' +
          'Supabase Dashboard -> Project Settings -> API. Run: node scripts/check-service-key.mjs',
      );
    } else if (!hasService) {
      console.warn(
        '[medinova] No service-role key; using the anon key server-side (RLS applies). ' +
          'Public catalog reads work, staff/invoice/encounter routes do not.',
      );
    }

    adminClient = createClient(env.SUPABASE_URL, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

/** Reset the cached client (tests / env rotation). */
export function resetSupabaseAdmin(): void {
  adminClient = null;
}

/** Await a PostgREST builder and throw on error (route-level catch → 502). */
export async function awaitOk<T>(
  p: PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}


