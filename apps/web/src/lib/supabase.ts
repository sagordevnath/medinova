import { createClient } from '@supabase/supabase-js';

/** Accepts both the Vite (VITE_*) and Next-style (NEXT_PUBLIC_*) naming. */
const url =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
  (import.meta.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined);
const anon =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  (import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  (import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined);

/** False when env vars are missing — auth actions then fail with a friendly error. */
export const supabaseConfigured = Boolean(url && anon);

if (!supabaseConfigured) {
  console.warn('[medinova] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — running in offline mock mode.');
}

export const supabase = createClient(url ?? 'http://localhost:54321', anon ?? 'dev-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'medinova-auth',
  },
});
