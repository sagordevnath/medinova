import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, LogOut, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_DASHBOARD } from '@medinova/shared';

const initials = (name?: string | null, email?: string | null): string => {
  const source = (name ?? '').trim() || (email ?? '').split('@')[0] || '?';
  return source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
};

/**
 * Header account control: avatar button that opens a dropdown with the user's
 * profile and sign out. Hidden until a session exists, so signed-out visitors
 * keep seeing the Login link.
 */
export function AccountMenu() {
  const { t } = useTranslation(['nav', 'common', 'profile']);
  const { session, role, profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Close on outside click and on Escape so the menu behaves like a dialog.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!session) return null;

  const name = profile?.fullName ?? session.user?.email ?? '';
  const dashboard = role ? ROLE_DASHBOARD[role] : null;

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    navigate('/');
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('common:profile')}
        className="grid size-10 min-h-[44px] min-w-[44px] place-items-center overflow-hidden rounded-full border border-border bg-primary/10 text-sm font-extrabold text-primary transition hover:bg-primary/20"
      >
        {profile?.avatarUrl ? (
          <img src={profile.avatarUrl} alt="" className="size-full object-cover" />
        ) : (
          initials(profile?.fullName, session.user?.email)
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-50 w-60 overflow-hidden rounded-2xl border border-border bg-card shadow-lg"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-extrabold">{name}</p>
            <p className="truncate text-xs opacity-70">{session.user?.email}</p>
          </div>

          <Link
            to="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex min-h-[44px] items-center gap-2 px-4 py-2 text-sm font-semibold hover:bg-muted"
          >
            <User size={16} aria-hidden="true" />
            {t('common:profile')}
          </Link>

          {dashboard && (
            <Link
              to={dashboard}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-[44px] items-center gap-2 px-4 py-2 text-sm font-semibold hover:bg-muted"
            >
              <LayoutDashboard size={16} aria-hidden="true" />
              {t('nav:dashboard')}
            </Link>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="flex min-h-[44px] w-full items-center gap-2 px-4 py-2 text-left text-sm font-semibold text-red-600 hover:bg-muted dark:text-red-400"
          >
            <LogOut size={16} aria-hidden="true" />
            {t('nav:signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
