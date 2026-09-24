import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, GlassCard, GlassStrong } from '@/components/Button';
import { Field, Input } from '@/components/fields';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/providers/ToastProvider';
import { ROLE_DASHBOARD } from '@medinova/shared';

export function RegisterPage() {
  const { t } = useTranslation(['auth', 'errors']);
  const { signUp, role, session } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState<string | null>(null);

  // Session can appear instantly when email confirmation is disabled (local dev).
  useEffect(() => {
    if (session && role && !checkEmail) navigate(ROLE_DASHBOARD[role], { replace: true });
  }, [session, role, checkEmail, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (password.length < 8) {
      setFormError(t('errors:authWeakPassword'));
      return;
    }
    if (password !== confirm) {
      setFormError(t('auth:passwordMismatch'));
      return;
    }
    setBusy(true);
    const res = await signUp({ email: email.trim(), password, fullName: fullName.trim() });
    setBusy(false);
    if (!res.ok) {
      setFormError(t(res.errorKey ?? 'errors:authGeneric'));
      return;
    }
    if (res.needsEmailConfirm) {
      setCheckEmail(email.trim());
      return;
    }
    push({ kind: 'success', title: t('auth:registerTitle') });
    navigate(ROLE_DASHBOARD.patient, { replace: true });
  }

  if (checkEmail) {
    return (
      <GlassCard className="mx-auto max-w-md">
        <GlassStrong>
          <h1 className="text-xl font-extrabold">{t('auth:checkEmailTitle')}</h1>
          <p className="mt-2 text-sm opacity-80">{t('auth:checkEmailBody', { email: checkEmail })}</p>
        </GlassStrong>
        <div className="mt-4">
          <Link to="/login" className="font-semibold underline underline-offset-4">
            {t('auth:backToLogin')}
          </Link>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="mx-auto max-w-md">
      <h1 className="text-2xl font-extrabold">{t('auth:registerTitle')}</h1>
      <p className="mt-1 text-sm opacity-70">{t('auth:registerSubtitle')}</p>

      {formError && (
        <p role="alert" className="mt-3 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-red-600 dark:text-red-300">
          {formError}
        </p>
      )}

      <form className="mt-4 grid gap-4" onSubmit={onSubmit}>
        <Field label={t('auth:fullName')}>
          <Input
            autoComplete="name"
            required
            placeholder="Jane Doe"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </Field>
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
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label={t('auth:confirmPassword')}>
          <Input
            type="password"
            autoComplete="new-password"
            required
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={busy}>
          {t('auth:signUp')}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm opacity-70">
        {t('auth:haveAccount')}{' '}
        <Link to="/login" className="font-bold underline underline-offset-4">
          {t('auth:signIn')}
        </Link>
      </p>
    </GlassCard>
  );
}