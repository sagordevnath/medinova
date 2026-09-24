import { Button, GlassCard } from '@/components/Button';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const { t } = useTranslation('errors');
  return (
    <GlassCard className="mx-auto max-w-md p-10 text-center">
      <p className="text-gradient text-6xl font-extrabold" aria-hidden="true">
        404
      </p>
      <h1 className="mt-2 text-2xl font-extrabold">{t('notFound')}</h1>
      <Link to="/" className="mt-6 inline-block">
        <Button>{t('backHome')}</Button>
      </Link>
    </GlassCard>
  );
}


