import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Droplet, Phone, ShieldAlert, User, Users } from 'lucide-react';
import { apiGet, type MeDto } from '@/lib/api';
import { GlassCard } from '@/components/Button';
import { ErrorState, Skeleton } from '@/components/feedback';
import { useAuth, useSessionToken } from '@/hooks/useAuth';

const ROLE_LABEL: Record<string, string> = {
  patient: 'Patient',
  doctor: 'Doctor',
  receptionist: 'Receptionist',
  branch_admin: 'Branch admin',
  super_admin: 'Super admin',
};

/**
 * GET /v1/me — the signed-in user's profile plus the patient records they can
 * book for. Scoped server-side by the verified access token, so this shows
 * only the caller's own data.
 */
export function ProfilePage() {
  const { t } = useTranslation(['profile', 'common', 'errors']);
  const { role } = useAuth();
  const token = useSessionToken();

  const me = useQuery({
    queryKey: ['me', token],
    queryFn: () => apiGet<{ data: MeDto }>('/v1/me', token),
    enabled: Boolean(token),
    retry: false,
  });

  if (!token) {
    return (
      <GlassCard className="mx-auto max-w-lg p-10 text-center">
        <h1 className="text-2xl font-extrabold">{t('profile:signInRequired')}</h1>
        <p className="mt-2 text-sm opacity-70">{t('profile:signInBody')}</p>
        <Link className="mt-4 inline-block font-semibold underline underline-offset-4" to="/login">
          {t('common:login')}
        </Link>
      </GlassCard>
    );
  }

  if (me.isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (me.isError) {
    return <ErrorState message={t('profile:loadFailed')} onRetry={() => me.refetch()} />;
  }

  const { profile, patients } = me.data.data;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Helmet>
        <title>{t('profile:title')} — MediNova</title>
      </Helmet>

      <GlassCard>
        <div className="flex items-start gap-4">
          <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary/10">
            <User className="text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-extrabold">{profile?.fullName ?? '—'}</h1>
            <p className="mt-1 text-sm opacity-70">{ROLE_LABEL[role ?? 'patient'] ?? role}</p>
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="opacity-60">{t('profile:userId')}</dt>
                <dd className="truncate font-mono text-xs">{me.data.data.userId}</dd>
              </div>
              <div>
                <dt className="opacity-60">{t('profile:phone')}</dt>
                <dd className="font-semibold">{profile?.phone ?? '—'}</dd>
              </div>
              <div>
                <dt className="opacity-60">{t('profile:language')}</dt>
                <dd className="font-semibold uppercase">{profile?.preferredLang ?? 'en'}</dd>
              </div>
              <div>
                <dt className="opacity-60">{t('profile:branch')}</dt>
                <dd className="truncate font-semibold">
                  {profile?.branchId ?? t('profile:allBranches')}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Users className="text-primary" />
          {t('profile:familyTitle')}
        </h2>
        <p className="mt-1 text-sm opacity-70">{t('profile:familyBody')}</p>

        {patients.length === 0 ? (
          <p className="mt-4 rounded-xl border border-border bg-card px-3 py-4 text-sm">
            {t('profile:noPatients')}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {patients.map((p) => (
              <li key={p.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b className="text-base">{p.fullName}</b>
                  {p.bloodGroup && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold">
                      <Droplet size={12} />
                      {p.bloodGroup}
                    </span>
                  )}
                </div>
                <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                  <div className="flex items-center gap-1 opacity-80">
                    <Phone size={13} />
                    <span>{p.phone ?? '—'}</span>
                  </div>
                  <div>
                    {t('profile:dob')}: {p.dob ?? '—'}
                  </div>
                </dl>
                {p.allergies && (
                  <p className="mt-2 inline-flex items-center gap-1 rounded-lg bg-red-500/10 px-2 py-1 text-xs font-semibold text-red-600 dark:text-red-300">
                    <ShieldAlert size={13} />
                    {t('profile:allergies')}: {p.allergies}
                  </p>
                )}
                {p.chronicConditions && (
                  <p className="mt-1 text-xs opacity-80">
                    {t('profile:chronic')}: {p.chronicConditions}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <Link
          className="mt-5 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
          to="/book"
        >
          {t('profile:bookNow')}
        </Link>
      </GlassCard>
    </div>
  );
}
