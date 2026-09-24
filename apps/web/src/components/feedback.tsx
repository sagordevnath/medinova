import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-xl bg-muted', className)} />;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="glass p-10 text-center">
      <p className="text-lg font-extrabold">{title}</p>
      {body && <p className="mt-1 text-sm opacity-70">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation('common');
  return (
    <div className="glass p-8 text-center" role="alert">
      <p className="font-bold text-red-600 dark:text-red-300">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="mt-3">
          {t('retry')}
        </Button>
      )}
    </div>
  );
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="progress">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span
            aria-current={i === current ? 'step' : undefined}
            className={cn(
              'flex min-h-[36px] min-w-[36px] items-center justify-center rounded-full text-sm font-extrabold',
              i < current ? 'bg-emerald-500 text-white' : i === current ? 'btn-gradient glow' : 'bg-muted text-muted-foreground',
            )}
          >
            {i + 1}
          </span>
          <span className={cn('text-sm', i === current ? 'font-bold' : 'opacity-70')}>{s}</span>
          {i < steps.length - 1 && <span aria-hidden className="mx-1 opacity-40">→</span>}
        </li>
      ))}
    </ol>
  );
}

export function AnimatedCounter({ value, locale }: { value: number; locale?: string }) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);
  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const dur = 900;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      setDisplay(Math.round(value * (0.2 + 0.8 * p)));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduce]);
  return (
    <motion.span initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="text-3xl font-extrabold tabular-nums">
      {display.toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD')}
    </motion.span>
  );
}
