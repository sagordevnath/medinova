import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';

const Ctx = createContext<{ theme: Theme; effective: 'light' | 'dark'; setTheme: (t: Theme) => void }>({
  theme: 'system',
  effective: 'light',
  setTheme: () => {},
});

function resolveSystem(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const s = localStorage.getItem('medinova-theme') as Theme | null;
    return s === 'light' || s === 'dark' || s === 'system' ? s : 'system';
  });
  const [system, setSystem] = useState<'light' | 'dark'>(() => resolveSystem());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const effective = theme === 'system' ? system : theme;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', effective === 'dark');
    document.documentElement.setAttribute('data-theme', effective);
  }, [effective]);

  // Default light for trust; dark = deep navy via .dark styles.
  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem('medinova-theme', t);
    setThemeState(t);
  }, []);

  const value = useMemo(() => ({ theme, effective, setTheme }), [theme, effective, setTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
