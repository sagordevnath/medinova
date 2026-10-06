import { useState, type PointerEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ShieldCheck, Sparkles } from 'lucide-react';
import { apiGet, formatBdt, type PlanDto } from '@/lib/api';
import { GlassCard } from '@/components/Button';
import { Skeleton } from '@/components/feedback';

/** Middle tier is the one clinics usually pick, so mark it visually. */
const FEATURED = 'professional';

const limitLabel = (n: number | null, unit: string) => (n === null ? '∞' : `${n} ${unit}`);

/**
 * Track the pointer so the card's radial highlight follows it. Kept in a CSS
 * variable instead of React state — this fires on every mousemove and must not
 * trigger a re-render of the card's subtree.
 */
function trackPointer(e: PointerEvent<HTMLDivElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
}

function PlanCard({ plan, yearly, lang }: { plan: PlanDto; yearly: boolean; lang: string }) {
  const { t } = useTranslation(['pricing']);
  const featured = plan.code === FEATURED;
  const price = yearly ? plan.yearlyTaka / 12 : plan.monthlyTaka;

  return (
    <GlassCard
      className="pricing-card flex flex-col"
      {...({ 'data-featured': featured } as Record<string, unknown>)}
    >
      <div onPointerMove={trackPointer} className="contents">
        {featured && (
          <span className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-[#14f1d9] via-[#3b82f6] to-[#8b5cf6] px-4 py-1 text-xs font-extrabold text-[#070B1A]">
            {t('mostPopular')}
          </span>
        )}
        <h3 className="text-xl font-extrabold">{plan.name}</h3>
        {plan.tagline && <p className="mt-1 min-h-[2.5rem] text-sm opacity-70">{plan.tagline}</p>}

        <p className="mt-4 flex items-baseline gap-1">
          <span className="text-4xl font-extrabold tabular-nums">{formatBdt(price, lang)}</span>
          <span className="opacity-70">{t('perMonth')}</span>
        </p>
        {yearly ? (
          <p className="mt-1 text-sm font-bold text-primary">
            {formatBdt(plan.yearlyTaka, lang)} {t('billedYearly')} · {t('saveTwoMonths')}
          </p>
        ) : (
          <p className="mt-1 text-sm opacity-60">{t('cancelAnytime')}</p>
        )}

        <div className="my-5 h-px bg-border" />

        <p className="text-xs font-extrabold uppercase tracking-wide opacity-60">{t('includes')}</p>
        <ul className="mt-3 flex-1 space-y-2.5 text-sm">
          <li className="flex gap-2">
            <Check size={16} className="mt-0.5 shrink-0 text-primary" />
            {limitLabel(plan.branchLimit, t('branch').toLowerCase())}
          </li>
          <li className="flex gap-2">
            <Check size={16} className="mt-0.5 shrink-0 text-primary" />
            {limitLabel(plan.doctorLimit, t('doctors').toLowerCase())}
          </li>
          <li className="flex gap-2">
            <Check size={16} className="mt-0.5 shrink-0 text-primary" />
            {limitLabel(plan.staffSeatLimit, t('seats').toLowerCase())}
          </li>
          <li className="flex gap-2">
            <Check size={16} className="mt-0.5 shrink-0 text-primary" />
            {plan.monthlyAppointmentLimit === null
              ? t('unlimited')
              : `${plan.monthlyAppointmentLimit} ${t('appointments').toLowerCase()}`}
          </li>
          {plan.features.map((f) => (
            <li key={f} className="flex gap-2">
              <Check size={16} className="mt-0.5 shrink-0 text-primary" />
              {f}
            </li>
          ))}
        </ul>

        <Link
          to="/register"
          className={`mt-7 block rounded-xl py-3 text-center font-extrabold transition-transform hover:scale-[1.02] active:scale-[0.99] ${featured ? 'btn-gradient glow' : 'glass'}`}
        >
          {featured ? t('ctaFeatured') : t('cta')}
        </Link>
      </div>
    </GlassCard>
  );
}

export function PricingPage() {
  const { t, i18n } = useTranslation(['pricing']);
  const lang = i18n.language === 'bn' ? 'bn' : 'en';
  const [yearly, setYearly] = useState(true);
  const [open, setOpen] = useState(0);
  const reduce = useReducedMotion();

  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: () => apiGet<{ data: PlanDto[] }>('/v1/plans'),
    // Prices change rarely; a stale price beats a loading flash on the one
    // page a prospective buyer is guaranteed to read.
    staleTime: 5 * 60_000,
  });

  const list = plans.data?.data ?? [];

  return (
    <div className="space-y-12">
      <Helmet>
        <title>{t('meta')}</title>
        <meta name="description" content={t('subtitle')} />
      </Helmet>

      <section className="mesh-hero grain relative overflow-hidden rounded-3xl p-8 text-center md:p-16">
        <div className="relative z-[2] mx-auto max-w-3xl">
          <motion.span
            initial={reduce ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="glass inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold"
          >
            <Sparkles size={14} /> {t('trustTitle')}
          </motion.span>

          <motion.h1
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight md:text-6xl"
          >
            <span className="text-gradient">{t('title')}</span>
          </motion.h1>

          <motion.p
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12 }}
            className="mx-auto mt-4 max-w-2xl text-base opacity-80 md:text-lg"
          >
            {t('subtitle')}
          </motion.p>

          <motion.div
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-9 inline-flex flex-col items-center gap-3"
          >
            {/* Segmented control. The sliding thumb is positioned by the active
                button so the two labels never need fixed pixel widths. */}
            <div className="billing-toggle relative inline-grid grid-cols-2 rounded-full border p-1">
              <motion.div
                className="billing-toggle__thumb"
                aria-hidden
                animate={
                  reduce
                    ? undefined
                    : { left: yearly ? '50%' : '0%', width: '50%' }
                }
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
              <button
                onClick={() => setYearly(false)}
                aria-pressed={!yearly}
                className={`relative z-[1] whitespace-nowrap rounded-full px-5 py-2 text-sm font-bold transition-colors ${!yearly ? 'text-[#070B1A]' : 'opacity-70'}`}
              >
                {t('perMonth')}
              </button>
              <button
                onClick={() => setYearly(true)}
                aria-pressed={yearly}
                className={`relative z-[1] whitespace-nowrap rounded-full px-5 py-2 text-sm font-bold transition-colors ${yearly ? 'text-[#070B1A]' : 'opacity-70'}`}
              >
                {t('perYear')}
              </button>
            </div>
            <p className="text-xs font-bold text-primary">{t('saveTwoMonths')}</p>
          </motion.div>
        </div>
      </section>

      <section>
        {plans.isPending ? (
          <div className="grid gap-4 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton className="h-96" key={i} />
            ))}
          </div>
        ) : list.length === 0 ? (
          // A missing migration or a misconfigured key must not read as "we
          // have no plans" — that silently removes the entire buying surface.
          <GlassCard className="text-center">
            <p className="font-extrabold">Pricing is unavailable right now</p>
            <p className="mt-1 text-sm opacity-70">
              Please contact us directly and we will send you the current plan details.
            </p>
          </GlassCard>
        ) : (
          <div className="grid gap-5 md:grid-cols-3">
            {list.map((p, i) => (
              <motion.div
                key={p.code}
                initial={reduce ? false : { opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.55, delay: reduce ? 0 : i * 0.08 }}
              >
                <PlanCard plan={p} yearly={yearly} lang={lang} />
              </motion.div>
            ))}
          </div>
        )}
        <p className="mt-6 text-center text-sm opacity-70">
          {t('ctaSecondary')} ·{' '}
          <Link to="/register" className="font-bold text-primary">
            {t('cta')}
          </Link>
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-extrabold">{t('trustTitle')}</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {(t('trust', { returnObjects: true }) as Array<{ title: string; body: string }>).map((f, i) => (
            <motion.div
              key={f.title}
              initial={reduce ? false : { opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: reduce ? 0 : (i % 3) * 0.07 }}
            >
              <GlassCard className="h-full transition-colors hover:border-primary/50">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <ShieldCheck className="text-primary" size={20} />
                </div>
                <p className="mt-4 font-extrabold">{f.title}</p>
                <p className="mt-1.5 text-sm opacity-70">{f.body}</p>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-extrabold">{t('faqTitle')}</h2>
        <div className="mt-4 space-y-2">
          {(t('faqs', { returnObjects: true }) as Array<{ q: string; a: string }>).map((f, i) => (
            <div className="glass p-4" key={f.q}>
              <button
                className="flex w-full items-center justify-between gap-4 text-left font-bold"
                onClick={() => setOpen(open === i ? -1 : i)}
                aria-expanded={open === i}
              >
                {f.q}
                <motion.span animate={{ rotate: open === i ? 180 : 0 }} transition={{ duration: 0.25 }}>
                  <ChevronDown size={18} />
                </motion.span>
              </button>
              {/* AnimatePresence so the answer slides instead of popping. */}
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div
                    key="a"
                    initial={reduce ? false : { height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={reduce ? undefined : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <p className="pt-2.5 text-sm opacity-75">{f.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </section>

      <section className="mesh-hero grain relative overflow-hidden rounded-3xl border border-primary/30 p-8 text-center md:p-16">
        <div className="relative z-[2]">
          <h2 className="text-3xl font-extrabold md:text-4xl">
            <span className="text-gradient">{t('ctaTitle')}</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl opacity-80">{t('ctaBody')}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/register" className="btn-gradient glow rounded-xl px-8 py-3.5 font-extrabold transition-transform hover:scale-[1.03] active:scale-[0.99]">
              {t('cta')}
            </Link>
            <a href={`mailto:sales@medinova.example?subject=${encodeURIComponent(t('meta'))}`} className="glass rounded-xl px-8 py-3.5 font-extrabold">
              {t('ctaSecondary')}
            </a>
          </div>
          <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs opacity-70">
            {['noCard', 'setupTime', 'cancelAnytime'].map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <Check size={13} className="text-primary" />
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}