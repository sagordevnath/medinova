import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Footer, Header, MobileBottomNav, EmergencyFab } from './components/layout';
import { PageTransition } from './components/PageTransition';
import { ToastViewport } from './providers/ToastProvider';

export function App() {
  const { t } = useTranslation('common');
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[200] focus:rounded-lg focus:bg-card focus:px-3 focus:py-2">
        {t('skipToContent')}
      </a>
      <Header />
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-6">
        <PageTransition>
          <Outlet />
        </PageTransition>
      </main>
      <Footer />
      <MobileBottomNav />
      <EmergencyFab />
      <ToastViewport />
    </div>
  );
}

