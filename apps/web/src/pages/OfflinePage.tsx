import { useTranslation } from 'react-i18next';
import { GlassCard } from '@/components/Button';

export function OfflinePage() {
  const { t } = useTranslation('common');
  return (
    <GlassCard className="mx-auto max-w-md p-10 text-center">
      <h1 className="text-2xl font-extrabold">{t('offlineTitle')}</h1>
      <p className="mt-2 text-sm opacity-70">{t('offlineBody')}</p>
    </GlassCard>
  );
}
