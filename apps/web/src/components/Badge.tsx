import { cn } from '@/lib/cn';

export function Badge({
  kind,
  children,
  className,
}: {
  kind: 'allopathic' | 'homeopathic' | 'neutral' | 'warning' | 'success';
  children: React.ReactNode;
  className?: string;
}) {
  const map: Record<string, string> = {
    allopathic: 'bg-allo-soft text-blue-800 dark:bg-blue-500/20 dark:text-blue-200 border-blue-300/50',
    homeopathic: 'bg-homeo-soft text-green-800 dark:bg-green-500/20 dark:text-green-200 border-green-300/50',
    neutral: 'bg-muted text-muted-foreground',
    warning: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
    success: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
  };
  return (
    <span
      className={cn(
        'inline-flex min-h-[28px] items-center rounded-full border px-3 py-0.5 text-xs font-bold',
        map[kind],
        className,
      )}
    >
      {children}
    </span>
  );
}
