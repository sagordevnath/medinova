import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { Role } from '@medinova/shared';
import { supabase, supabaseConfigured } from '../lib/supabase';

/** Minimal profile slice the app needs for role routing (Module 3). */
export interface AuthProfile {
  role: Role;
  branchId: string | null;
  fullName: string;
}

export interface AuthResult {
  ok: boolean;
  /** i18n key (errors.*) to show when ok is false. */
  errorKey?: string;
  /** True when Supabase requires email confirmation before sign-in. */
  needsEmailConfirm?: boolean;
}

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: AuthProfile | null;
  role: Role | null;
  loading: boolean;
  configured: boolean;
  signUp: (input: { email: string; password: string; fullName: string }) => Promise<AuthResult>;
  signInWithEmail: (email: string, password: string) => Promise<AuthResult>;
  signInWithGoogle: () => Promise<AuthResult>;
  requestPhoneOtp: (phone: string) => Promise<AuthResult>;
  verifyPhoneOtp: (phone: string, token: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const ROLES: Role[] = ['patient', 'doctor', 'receptionist', 'branch_admin', 'super_admin'];

/** Translate Supabase auth errors into errors.* i18n keys. */
export function mapAuthError(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  if (msg.includes('invalid login')) return 'errors.authInvalidCredentials';
  if (msg.includes('already registered')) return 'errors.authUserExists';
  if (msg.includes('password') && (msg.includes('least') || msg.includes('weak'))) return 'errors.authWeakPassword';
  if (msg.includes('email not confirmed')) return 'errors.authEmailUnconfirmed';
  if (msg.includes('rate limit') || msg.includes('too many')) return 'errors.authRateLimited';
  if (msg.includes('otp') || msg.includes('expired')) return 'errors.authOtpExpired';
  if (msg.includes('fetch') || msg.includes('network')) return 'errors.authNetwork';
  return 'errors.authGeneric';
}

const notConfigured = (): AuthResult => ({ ok: false, errorKey: 'errors.authNotConfigured' });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);

  // Session bootstrap + auth-state subscription ------------------------------------
  useEffect(() => {
    if (!supabaseConfigured) {
      setAuthLoading(false);
      return;
    }
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session ?? null);
        setAuthLoading(false);
      })
      .catch(() => {
        if (active) setAuthLoading(false);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const userId: string | null = session?.user?.id ?? null;

  // Load the caller's role for routing (profiles row; metadata fallback) -----------
  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setProfileUserId(null);
      return;
    }
    let active = true;
    (async () => {
      try {
        const [{ data: rowRes }, { data: userRes }] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
          supabase.auth.getUser(),
        ]);
        if (!active) return;
        const row = rowRes as { role?: Role; branch_id?: string | null; full_name?: string | null } | null;
        const meta = (userRes.user?.user_metadata ?? {}) as Record<string, unknown>;
        const rawRole = (row?.role ?? meta.role ?? 'patient') as Role;
        const role: Role = ROLES.includes(rawRole) ? rawRole : 'patient';
        const fullName = row?.full_name ?? (typeof meta.name === 'string' ? meta.name : null) ?? userRes.user?.email ?? '';
        setProfile({ role, branchId: row?.branch_id ?? null, fullName });
        setProfileUserId(userId);
      } catch {
        if (!active) return;
        setProfile({ role: 'patient', branchId: null, fullName: '' });
        setProfileUserId(userId);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const run = useCallback(
    async (fn: () => Promise<{ error: { message: string } | null }>): Promise<AuthResult> => {
      if (!supabaseConfigured) return notConfigured();
      try {
        const { error } = await fn();
        if (error) return { ok: false, errorKey: mapAuthError(new Error(error.message)) };
        return { ok: true };
      } catch (e) {
        return { ok: false, errorKey: mapAuthError(e) };
      }
    },
    [],
  );

  const signUp = useCallback(
    async ({ email, password, fullName }: { email: string; password: string; fullName: string }): Promise<AuthResult> => {
      if (!supabaseConfigured) return notConfigured();
      try {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name: fullName, full_name: fullName },
            emailRedirectTo: `${window.location.origin}/login`,
          },
        });
        if (error) return { ok: false, errorKey: mapAuthError(new Error(error.message)) };
        return { ok: true, needsEmailConfirm: data.session === null };
      } catch (e) {
        return { ok: false, errorKey: mapAuthError(e) };
      }
    },
    [],
  );

  const signInWithEmail = useCallback(
    (email: string, password: string) => run(() => supabase.auth.signInWithPassword({ email, password })),
    [run],
  );

  const signInWithGoogle = useCallback(
    () =>
      run(() =>
        supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}/login` },
        }),
      ),
    [run],
  );

  const requestPhoneOtp = useCallback((phone: string) => run(() => supabase.auth.signInWithOtp({ phone })), [run]);

  const verifyPhoneOtp = useCallback(
    (phone: string, token: string) => run(() => supabase.auth.verifyOtp({ phone, token, type: 'sms' })),
    [run],
  );

  const signOut = useCallback(async () => {
    if (supabaseConfigured) {
      try {
        await supabase.auth.signOut();
      } catch {
        /* local sign-out continues */
      }
    }
    setSession(null);
    setProfile(null);
    setProfileUserId(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      role: profileUserId && userId === profileUserId ? (profile?.role ?? null) : null,
      loading: authLoading || (userId !== null && profileUserId !== userId),
      configured: supabaseConfigured,
      signUp,
      signInWithEmail,
      signInWithGoogle,
      requestPhoneOtp,
      verifyPhoneOtp,
      signOut,
    }),
    [
      session,
      userId,
      profile,
      profileUserId,
      authLoading,
      signUp,
      signInWithEmail,
      signInWithGoogle,
      requestPhoneOtp,
      verifyPhoneOtp,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}