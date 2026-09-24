import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface Toast {
  id: number;
  title: string;
  body?: string;
  kind: 'success' | 'error' | 'info';
}

const Ctx = createContext<{ toasts: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void }>({
  toasts: [],
  push: () => {},
  dismiss: () => {},
});

let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((p) => p.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = seq++;
      setToasts((p) => [...p, { ...t, id }]);
      window.setTimeout(() => dismiss(id), 4200);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useToast = () => useContext(Ctx);

export function ToastViewport() {
  const { t } = useTranslation('common');
  const { toasts, dismiss } = useToast();
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-20 right-4 z-[100] flex w-80 flex-col gap-2 md:bottom-6">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          className="glass pointer-events-auto p-3 text-sm shadow-glass"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-bold">{toast.title}</p>
            <button
              onClick={() => dismiss(toast.id)}
              aria-label={t('close')}
              className="min-h-[32px] min-w-[32px] rounded-md border px-1"
            >
              ✕
            </button>
          </div>
          {toast.body && <p className="mt-1 opacity-80">{toast.body}</p>}
        </div>
      ))}
    </div>
  );
}
