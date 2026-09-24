import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, GlassCard, GlassStrong } from '@/components/Button';
import { Field, Input } from '@/components/fields';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { mapAuthError } from '@/providers/AuthProvider';

export function ForgotPasswordPage() {
  const { t } = useTranslation(['auth', 'errors']);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!supabaseConfigured) {
      setFormError(t('errors:authNotConfigured'));
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) {
      setFormError(t(mapAuthError(error)));
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <GlassCard className="mx-auto max-w-md">
        <GlassStrong>
          <h1 className="text-xl font-extrabold">{t('auth:resetSentTitle')}</h1>
          <p className="mt-2 text-sm opacity-80">{t('auth:resetSentBody')}</p>
        </GlassStrong>
        <div className="mt-4 grid gap-3">
          <Link to="/login" className="font-semibold underline underline-offset-4">
            {t('auth:backToLogin')}
          </Link>
          <button
            type="button"
            className="justify-self-start text-sm font-semibold underline underline-offset-4"
            onClick={() => setSent(false)}
          >
            {t('auth:requestNewLink')}
          </button>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="mx-auto max-w-md">
      <h1 className="text-2xl font-extrabold">{t('auth:forgotTitle')}</h1>
      <p className="mt-1 text-sm opacity-70">{t('auth:forgotSubtitle')}</p>

      {formError && (
        <p role="alert" className="mt-3 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-red-600 dark:text-red-300">
          {formError}
        </p>
      )}

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
        <Button type="submit" disabled={busy}>
          {t('auth:sendResetLink')}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm opacity-70">
        <Link to="/login" className="font-bold underline underline-offset-4">
          {t('auth:backToLogin')}
        </Link>
      </p>
    </GlassCard>
  );
}