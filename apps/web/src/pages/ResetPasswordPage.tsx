import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, GlassCard } from '@/components/Button';
import { Field, Input } from '@/components/fields';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/providers/ToastProvider';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { mapAuthError } from '@/providers/AuthProvider';
import { ROLE_DASHBOARD } from '@medinova/shared';

export function ResetPasswordPage() {
  const { t } = useTranslation(['auth', 'errors']);
  const { session, role } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
    if (!supabaseConfigured) {
      setFormError(t('errors:authNotConfigured'));
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setFormError(t(mapAuthError(error)));
      return;
    }
    push({ kind: 'success', title: t('auth:passwordUpdated') });
    navigate(role ? ROLE_DASHBOARD[role] : '/login', { replace: true });
  }

  // Recovery link not opened yet (no session) → ask for a fresh link.
  if (!session) {
    return (
      <GlassCard className="mx-auto max-w-md">
        <h1 className="text-2xl font-extrabold">{t('auth:resetTitle')}</h1>
        <p className="mt-1 text-sm opacity-70">{t('errors:authSessionExpired')}</p>
        <div className="mt-4 grid gap-3">
          <Link to="/forgot-password" className="font-semibold underline underline-offset-4">
            {t('auth:requestNewLink')}
          </Link>
          <Link to="/login" className="text-sm opacity-70 underline underline-offset-4">
            {t('auth:backToLogin')}
          </Link>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="mx-auto max-w-md">
      <h1 className="text-2xl font-extrabold">{t('auth:resetTitle')}</h1>
      <p className="mt-1 text-sm opacity-70">{t('auth:resetSubtitle')}</p>

      {formError && (
        <p role="alert" className="mt-3 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-red-600 dark:text-red-300">
          {formError}
        </p>
      )}

      <form className="mt-4 grid gap-4" onSubmit={onSubmit}>
        <Field label={t('auth:newPassword')}>
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
          {t('auth:updatePassword')}
        </Button>
      </form>
    </GlassCard>
  );
}