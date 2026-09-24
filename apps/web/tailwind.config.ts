import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '72rem' } },
    extend: {
      colors: {
        abyss: {
          DEFAULT: '#070B1A',
          800: '#0B1226',
          700: '#111A36',
        },
        neon: { teal: '#14F1D9', blue: '#3B82F6', violet: '#8B5CF6' },
        allo: { DEFAULT: '#3B82F6', soft: '#DBEAFE' },
        homeo: { DEFAULT: '#16A34A', soft: '#DCFCE7' },
        border: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', '"Hind Siliguri"', 'system-ui', 'sans-serif'],
        bn: ['"Hind Siliguri"', '"Plus Jakarta Sans"', 'sans-serif'],
      },
      borderRadius: {
        xl: '0.9rem',
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(2, 6, 23, 0.18)',
        glow: '0 0 24px rgba(20, 241, 217, 0.35), 0 0 48px rgba(59, 130, 246, 0.25)',
        'glow-strong': '0 0 32px rgba(20, 241, 217, 0.5), 0 0 64px rgba(139, 92, 246, 0.35)',
      },
      backdropBlur: { glass: '18px' },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'none' } },
        'mesh-pan': { '0%,100%': { backgroundPosition: '0% 0%' }, '50%': { backgroundPosition: '100% 100%' } },
      },
      animation: { 'fade-up': 'fade-up 0.5s ease both' },
    },
  },
  plugins: [animate],
} satisfies Config;

