import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, GlassCard } from '@/components/Button';
import { Field, Input } from '@/components/fields';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/providers/ToastProvider';
import { ROLE_DASHBOARD } from '@medinova/shared';

export function LoginPage() {
  const { t } = useTranslation(['auth', 'errors', 'nav']);
  const { session, role, loading, signInWithEmail, signInWithGoogle, requestPhoneOtp, verifyPhoneOtp } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const guestTarget = useRef<string | null>(null);

  // Already signed in → role dashboard (unless a guest flow navigates itself).
  useEffect(() => {
    if (loading || !session || !role || guestTarget.current) return;
    navigate(from ?? ROLE_DASHBOARD[role], { replace: true });
  }, [loading, session, role, from, navigate]);

  const fail = (errorKey?: string) => setFormError(t(errorKey ?? 'errors:authGeneric'));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    const res = await signInWithEmail(email.trim(), password);
    setBusy(false);
    if (!res.ok) fail(res.errorKey);
  }

  async function onGoogle() {
    setBusy(true);
    setFormError(null);
    const res = await signInWithGoogle();
    if (!res.ok) {
      setBusy(false);
      fail(res.errorKey);
    }
    // On success Supabase redirects the browser to Google.
  }

  async function onSendOtp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    const res = await requestPhoneOtp(phone.trim());
    setBusy(false);
    if (!res.ok) {
      fail(res.errorKey);
      return;
    }
    setOtpSent(true);
    push({ kind: 'info', title: t('auth:otpSent') });
  }

  async function onVerifyOtp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    const res = await verifyPhoneOtp(phone.trim(), otp.trim());
    setBusy(false);
    if (!res.ok) {
      fail(res.errorKey);
      return;
    }
    push({ kind: 'success', title: t('auth:guestVerified') });
    guestTarget.current = from ?? '/book';
    navigate(guestTarget.current, { replace: true });
  }

  return (
    <GlassCard className="mx-auto max-w-md">
      <h1 className="text-2xl font-extrabold">{t('auth:loginTitle')}</h1>
      <p className="mt-1 text-sm opacity-70">{t('auth:loginSubtitle')}</p>

      <div className="mt-4 flex gap-2" role="tablist" aria-label={t('auth:loginTitle')}>
        <Button type="button" size="sm" variant={mode === 'email' ? 'primary' : 'outline'} onClick={() => setMode('email')}>
          {t('auth:emailTab')}
        </Button>
        <Button type="button" size="sm" variant={mode === 'phone' ? 'primary' : 'outline'} onClick={() => setMode('phone')}>
          {t('auth:phoneTab')}
        </Button>
      </div>

      {formError && (
        <p role="alert" className="mt-3 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-red-600 dark:text-red-300">
          {formError}
        </p>
      )}

      {mode === 'email' ? (
        <form className="mt-4 grid gap-4" onSubmit={onSubmit}>
          <Field label={t('auth:email')}>
            <Input
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label={t('auth:password')}>
            <Input
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <div className="flex items-center justify-between gap-2 text-sm">
            <Link to="/forgot-password" className="font-semibold underline underline-offset-4">
              {t('auth:forgotPassword')}
            </Link>
          </div>
          <Button type="submit" disabled={busy}>
            {t('auth:signIn')}
          </Button>
        </form>
      ) : (
        <form className="mt-4 grid gap-4" onSubmit={otpSent ? onVerifyOtp : onSendOtp}>
          <Field label={t('auth:phone')}>
            <Input
              type="tel"
              autoComplete="tel"
              required
              placeholder={t('auth:phonePlaceholder')}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={otpSent}
            />
          </Field>
          {otpSent && (
            <Field label={t('auth:otp')}>
              <Input
                inputMode="numeric"
                required
                placeholder={t('auth:otpPlaceholder')}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
            </Field>
          )}
          <Button type="submit" disabled={busy}>
            {otpSent ? t('auth:verifyOtp') : t('auth:sendOtp')}
          </Button>
          {otpSent && (
            <button
              type="button"
              className="justify-self-start text-sm font-semibold underline underline-offset-4"
              onClick={() => {
                setOtpSent(false);
                setOtp('');
              }}
            >
              {t('auth:changePhone')}
            </button>
          )}
        </form>
      )}

      <p className="mt-4 text-center text-sm font-semibold opacity-70">{t('auth:or')}</p>
      <div className="mt-2">
        <Button type="button" variant="secondary" className="w-full" onClick={() => void onGoogle()} disabled={busy}>
          {t('auth:google')}
        </Button>
      </div>

      <p className="mt-4 text-center text-sm opacity-70">
        {t('auth:noAccount')}{' '}
        <Link to="/register" className="font-bold underline underline-offset-4">
          {t('auth:signUp')}
        </Link>
      </p>
    </GlassCard>
  );
}

