import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, GlassCard, GlassStrong } from '@/components/Button';
import { useAuth } from '@/hooks/useAuth';

const TITLES: Record<string, string> = {
  '/account': 'auth:accountTitle',
  '/doctor': 'auth:doctorTitle',
  '/reception': 'auth:receptionTitle',
  '/branch-admin': 'auth:branchAdminTitle',
  '/admin': 'auth:superAdminTitle',
};

export function DashboardsPage() {
  const { t } = useTranslation(['auth', 'nav']);
  const { profile, role, user, signOut } = useAuth();
  const { pathname } = useLocation();

  const titleKey = TITLES[pathname] ?? 'auth:accountTitle';
  const displayName = profile?.fullName || user?.email || '—';

  return (
    <GlassCard className="mx-auto max-w-2xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{t(titleKey)}</h1>
          <p className="mt-1 text-sm opacity-70">{t('auth:signedInAs', { name: displayName })}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void signOut()}>
          {t('nav:logout')}
        </Button>
      </div>

      <GlassStrong className="mt-4">
        <p className="text-sm font-bold uppercase tracking-wider opacity-60">{t('auth:roleLabel')}</p>
        <p className="mt-1 text-lg font-extrabold">{role}</p>
        {profile?.branchId && <p className="mt-1 break-all text-xs opacity-70">{profile.branchId}</p>}
      </GlassStrong>

      <p className="mt-4 text-sm opacity-70">{t('auth:modulePlaceholder')}</p>
    </GlassCard>
  );
}