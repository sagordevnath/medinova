import { Moon, Sun, Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/providers/ThemeProvider';
import { cn } from '@/lib/cn';

export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation('common');
  const { theme, setTheme } = useTheme();
  const order: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(theme) + 1) % order.length] ?? 'system';
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <button
      onClick={() => setTheme(next)}
      aria-label={`${t('toggleTheme')}: ${t(theme)}`}
      title={`${t('toggleTheme')} (${t(theme)} → ${t(next)})`}
      className={cn(
        'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-border bg-card px-2 hover:bg-muted',
        className,
      )}
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation('common');
  const isBn = i18n.language === 'bn';
  return (
    <button
      onClick={() => void i18n.changeLanguage(isBn ? 'en' : 'bn')}
      aria-label={t('toggleLanguage')}
      className={cn(
        'inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-border bg-card px-3 text-sm font-bold hover:bg-muted',
        className,
      )}
    >
      <span aria-hidden="true">{isBn ? 'EN' : 'বাং'}</span>
      <span className="sr-only">{isBn ? 'English' : 'বাংলা'}</span>
      <span aria-hidden="true" className="opacity-60">
        {isBn ? 'English' : 'বাংলা'}
      </span>
    </button>
  );
}

