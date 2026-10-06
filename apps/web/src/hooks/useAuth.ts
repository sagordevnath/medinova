import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Current Supabase access token, or null when signed out.
 *
 * Authenticated API calls (GET /v1/me, booking) are authorised by verifying
 * this token, so it has to be read from the live Supabase session rather
 * than mirrored in app state.
 */
export function useSessionToken(): string | null {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setToken(data.session?.access_token ?? null);
      })
      .catch(() => {
        if (active) setToken(null);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setToken(next?.access_token ?? null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return token;
}

import { useContext } from 'react';
import { AuthContext } from '../providers/AuthProvider';

/** Access the auth session, role profile and auth actions. */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

