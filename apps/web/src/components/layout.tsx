import { Link, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, Home, MapPin, PhoneCall, Search, Menu } from 'lucide-react';
import { ThemeToggle, LanguageSwitcher } from './toggles';
import { useState } from 'react';
import { Drawer } from './overlays';
import { ROLE_DASHBOARD } from '@medinova/shared';
import { useAuth } from '@/hooks/useAuth';
import { Link as RouterLink } from 'react-router-dom';

const EMERGENCY_TEL = 'tel:16263';

function DashboardLink() {
  const { t } = useTranslation(['nav']);
  const { session, role, loading } = useAuth();
  if (loading) return null;
  if (session && role) {
    return (
      <RouterLink
        to={ROLE_DASHBOARD[role]}
        className="hidden min-h-[44px] items-center rounded-xl border border-border px-4 text-sm font-bold sm:inline-flex"
      >
        {t('nav:dashboard')}
      </RouterLink>
    );
  }
  return (
    <Link to="/login" className="hidden min-h-[44px] items-center rounded-xl border border-border px-4 text-sm font-bold sm:inline-flex">
      {t('nav:login')}
    </Link>
  );
}

export function Header() {
  const { t } = useTranslation(['nav', 'common']);
  const { session, role } = useAuth();
  const [menu, setMenu] = useState(false);
  const links = [
    { to: '/doctors', label: t('nav:findDoctor') },
    { to: '/departments', label: t('nav:departments') },
    { to: '/branches', label: t('nav:branches') },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-glass">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-2">
          <button
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-border md:hidden"
            aria-label="Menu"
            aria-expanded={menu}
            onClick={() => setMenu(true)}
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <Link to="/" className="text-xl font-extrabold tracking-tight" aria-label="MediNova home">
            <span className="text-gradient">MediNova</span>
          </Link>
        </div>
        <nav className="hidden items-center gap-5 text-sm font-semibold md:flex" aria-label="Primary">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'underline underline-offset-4' : 'hover:underline')}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
          <DashboardLink />
          <Link to="/book" className="btn-gradient glow hidden min-h-[44px] items-center rounded-xl px-4 text-sm sm:inline-flex">
            {t('nav:book')}
          </Link>
        </div>
      </div>
      <Drawer open={menu} onClose={() => setMenu(false)} title="MediNova">
        <nav className="grid gap-2 text-base font-semibold" aria-label="Mobile">
          {[{ to: '/', label: t('nav:home') }, ...links, { to: '/book', label: t('nav:book') }, { to: session && role ? ROLE_DASHBOARD[role] : '/login', label: session && role ? t('nav:dashboard') : t('nav:login') }].map(
            (l) => (
              <Link key={l.to} to={l.to} onClick={() => setMenu(false)} className="rounded-xl border border-border p-3">
                {l.label}
              </Link>
            ),
          )}
        </nav>
      </Drawer>
    </header>
  );
}

export function MobileBottomNav() {
  const { t } = useTranslation(['nav']);
  const items = [
    { to: '/', label: t('nav:home'), Icon: Home },
    { to: '/doctors', label: t('nav:findDoctor'), Icon: Search },
    { to: '/book', label: t('nav:book'), Icon: CalendarPlus },
    { to: '/branches', label: t('nav:branches'), Icon: MapPin },
  ];
  return (
    <nav aria-label="Bottom" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/85 backdrop-blur-glass md:hidden">
      <div className="grid grid-cols-4">
        {items.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-bold ${isActive ? 'text-primary' : 'opacity-70'}`
            }
          >
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export function Footer() {
  const { t } = useTranslation(['common']);
  const branches = ['Dhanmondi · Dhaka', 'Chattogram · GEC', 'Sylhet · Zindabazar'];
  return (
    <footer className="mt-16 border-t border-border pb-24 md:pb-8">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 md:grid-cols-3">
        <div>
          <p className="text-lg font-extrabold">
            <span className="text-gradient">MediNova</span>
          </p>
          <p className="mt-1 text-sm opacity-70">{t('common:tagline')}</p>
          <p className="mt-2 text-sm font-bold">{t('common:hotline')}</p>
        </div>
        <nav aria-label="Branches">
          <p className="text-sm font-extrabold uppercase tracking-wider opacity-60">Branches</p>
          <ul className="mt-2 space-y-1 text-sm">
            {branches.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </nav>
        <div>
          <p className="text-sm opacity-70">Asia/Dhaka · BDT (৳) · EN + BN · PWA</p>
        </div>
      </div>
    </footer>
  );
}

export function EmergencyFab() {
  const { t } = useTranslation('common');
  return (
    <a
      href={EMERGENCY_TEL}
      aria-label={`${t('emergency')} — ${t('callNow')}`}
      className="btn-gradient glow-strong fixed bottom-20 right-4 z-40 inline-flex min-h-[56px] min-w-[56px] items-center justify-center gap-2 rounded-full px-4 font-extrabold md:bottom-6"
    >
      <PhoneCall size={20} aria-hidden="true" />
      <span className="hidden sm:inline">{t('emergency')}</span>
    </a>
  );
}


