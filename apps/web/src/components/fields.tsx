import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const field = 'min-h-[48px] w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(field, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(field, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(field, 'min-h-[96px]', props.className)} />;
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      <span>{label}</span>
      {children}
      {error && (
        <span role="alert" className="text-xs font-medium text-red-600 dark:text-red-300">
          {error}
        </span>
      )}
    </label>
  );
}

export function DatePicker(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="datetime-local" {...props} className={cn(field, props.className)} />;
}
