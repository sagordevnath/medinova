import { useRef, type ReactNode } from 'react';
import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const btn = cva(
  'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition focus-visible:outline-none',
  {
    variants: {
      variant: {
        primary: 'btn-gradient glow hover:shadow-glow-strong',
        secondary: 'border border-border bg-card hover:bg-muted',
        ghost: 'hover:bg-muted',
        outline: 'border border-border hover:bg-muted',
        danger: 'bg-red-600 font-bold text-white hover:bg-red-700',
      },
      size: { sm: 'min-h-[36px] px-3 text-xs', md: '', lg: 'min-h-[52px] px-7 text-base' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children' | 'ref'>, VariantProps<typeof btn> {
  magnetic?: boolean;
  children: ReactNode;
}

export function Button({ variant, size, magnetic = true, children, className, type, ...rest }: ButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();
  return (
    <motion.button
      ref={ref}
      type={type ?? 'button'}
      whileTap={reduce ? undefined : { scale: 0.97 }}
      whileHover={reduce || !magnetic ? undefined : { scale: 1.03, y: -1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 18 }}
      className={cn(btn({ variant, size }), className)}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

export function GlassCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('glass grain p-5', className)}>{children}</div>;
}

export function GlassStrong({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('glass-strong grain p-5', className)}>{children}</div>;
}
