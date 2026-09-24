import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../config/env.js';

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(env: Env): SupabaseClient {
  if (!adminClient) {
    // Service-role key lives ONLY on the server. Never expose to the client.
    adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
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


