import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { Role } from '@medinova/shared';
import { supabase, supabaseConfigured } from '../lib/supabase';

/** Minimal profile slice the app needs for role routing (Module 3). */
export interface AuthProfile {
  role: Role;
  branchId: string | null;
  fullName: string;
  phone?: string | null;
  /** Avatar shown in the header account menu; null falls back to initials. */
  avatarUrl?: string | null;
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
  signUp: (input: {
    email: string;
    password: string;
    fullName: string;
    phone?: string;
    preferredLang?: 'en' | 'bn';
  }) => Promise<AuthResult>;
  signInWithEmail: (email: string, password: string) => Promise<AuthResult>;
  signInWithGoogle: () => Promise<AuthResult>;
  requestPhoneOtp: (phone: string) => Promise<AuthResult>;
  verifyPhoneOtp: (phone: string, token: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const ROLES: Role[] = ['patient', 'doctor', 'receptionist', 'branch_admin', 'org_admin', 'super_admin'];

/** Translate Supabase auth errors into errors.* i18n keys. */
export function mapAuthError(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  if (msg.includes('invalid login')) return 'errors.authInvalidCredentials';
  if (msg.includes('already registered')) return 'errors.authUserExists';
  if (msg.includes('password') && (msg.includes('least') || msg.includes('weak'))) return 'errors.authWeakPassword';
  if (msg.includes('email not confirmed')) return 'errors.authEmailUnconfirmed';
  if (msg.includes('email logins are disabled') || msg.includes('email_provider_disabled'))
    return 'errors.authEmailProviderDisabled';
  if (msg.includes('signups not allowed') || msg.includes('signup is disabled')) return 'errors.authSignupDisabled';
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
        const row = rowRes as { role?: Role; branch_id?: string | null; full_name?: string | null; phone?: string | null; avatar_url?: string | null } | null;
        const meta = (userRes.user?.user_metadata ?? {}) as Record<string, unknown>;
        const rawRole = (row?.role ?? meta.role ?? 'patient') as Role;
        const role: Role = ROLES.includes(rawRole) ? rawRole : 'patient';
        const fullName = row?.full_name ?? (typeof meta.name === 'string' ? meta.name : null) ?? userRes.user?.email ?? '';
        setProfile({ role, branchId: row?.branch_id ?? null, fullName, phone: row?.phone ?? null, avatarUrl: row?.avatar_url ?? null });
        setProfileUserId(userId);
      } catch (e) {
        // A missing profile means the signup trigger did not run for this
        // user. Falling back to a blank 'patient' profile silently hid that
        // bug behind a working-looking dashboard, so log it loudly instead.
        console.error('[medinova] profile lookup failed; signup trigger may be missing', e);
        if (active) {
          setProfile({ role: 'patient', branchId: null, fullName: session?.user?.email ?? '' });
          setProfileUserId(userId);
        }
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
    async ({
      email,
      password,
      fullName,
      phone,
      preferredLang,
    }: {
      email: string;
      password: string;
      fullName: string;
      phone?: string;
      preferredLang?: 'en' | 'bn';
    }): Promise<AuthResult> => {
      if (!supabaseConfigured) return notConfigured();
      try {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            // handle_new_user() (migration 0013) reads these keys to build the
            // profile + patients rows. Do not send a role: it is always patient.
            data: {
              full_name: fullName,
              name: fullName,
              ...(phone ? { phone } : {}),
              ...(preferredLang ? { preferred_lang: preferredLang } : {}),
            },
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