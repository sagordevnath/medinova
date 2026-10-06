import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Info, MousePointerClick } from 'lucide-react';
import { GlassCard } from '@/components/Button';

type DemoScene = {
  id: string;
  name: string;
  blurb: string;
  highlights: string[];
  points: Array<{ label: string; value: string }>;
  status: string;
  statusHint: string;
  /** Optional long-form fields, used by the consultation scene. */
  subjective?: string;
  objective?: string;
  plan?: string;
  canned?: string;
};

/**
 * Read the scene list from i18n. The demo is intentionally static sample data
 * rather than live API output: the staff-facing routes require the service-role
 * key, and a public page that silently rendered an empty workspace would look
 * like a broken product rather than a demo.
 */
function useScenes(): DemoScene[] {
  const { t } = useTranslation(['demo']);
  return t('scenes', { returnObjects: true }) as unknown as DemoScene[];
}
/** Key/value grid that mirrors the real staff screens' data density. */
function PointGrid({ points }: { points: Array<{ label: string; value: string }> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      {points.map((p) => (
        <div key={p.label}>
          <dt className="text-xs font-bold uppercase tracking-wide opacity-55">{p.label}</dt>
          <dd className="mt-0.5 text-sm font-extrabold">{p.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Optional SOAP-style long-form blocks, used by the consultation scene. */
function Notes({ scene }: { scene: DemoScene }) {
  const blocks = [
    { label: 'Symptoms', body: scene.canned },
    { label: 'Subjective', body: scene.subjective },
    { label: 'Objective', body: scene.objective },
    { label: 'Plan', body: scene.plan },
  ].filter((b) => !!b.body);

  if (!blocks.length) return null;
  return (
    <div className="mt-5 space-y-3">
      {blocks.map((b) => (
        <div className="rounded-xl bg-muted p-3" key={b.label}>
          <p className="text-xs font-bold uppercase opacity-55">{b.label}</p>
          <p className="mt-1 text-sm">{b.body}</p>
        </div>
      ))}
    </div>
  );
}

export function DemoPage() {
  const { t } = useTranslation(['demo']);
  const scenes = useScenes();
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);

  // Guard rather than assume: a missing locale file must not crash the page.
  if (!scenes.length) return null;
  const scene = scenes[Math.min(i, scenes.length - 1)];
  const last = i === scenes.length - 1;

  return (
    <div className="space-y-12">
      <Helmet>
        <title>{t('meta')}</title>
        <meta name="description" content={t('subtitle')} />
      </Helmet>

      {/* Unmissable sample-data banner. A demo that looked like a live patient
          record would actively mislead a clinic owner. */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <Info size={18} className="mt-0.5 shrink-0" />
        <p className="text-sm font-semibold">{t('sampleNotice')}</p>
      </div>

      <section className="mesh-hero grain relative overflow-hidden rounded-3xl p-8 text-center md:p-16">
        <div className="relative z-[2] mx-auto max-w-3xl">
          <motion.span
            initial={reduce ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold"
          >
            <MousePointerClick size={14} /> {t('badge')}
          </motion.span>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight md:text-5xl">
            <span className="text-gradient">{t('title')}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base opacity-80">{t('subtitle')}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/register" className="btn-gradient glow rounded-xl px-7 py-3 font-extrabold">
              {t('startTrial')}
            </Link>
            <Link to="/book" className="glass rounded-xl px-7 py-3 font-extrabold">
              {t('tryIt')}
            </Link>
          </div>
        </div>
      </section>
      {/* Step navigation */}
      <div className="flex flex-wrap items-center gap-2">
        {scenes.map((s, n) => (
          <button
            key={s.id}
            onClick={() => setI(n)}
            aria-current={n === i}
            className={`min-h-11 rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
              n === i ? 'bg-primary text-white' : 'glass hover:bg-muted'
            }`}
          >
            <span className="opacity-60">{n + 1}.</span> {s.name}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.section
          key={scene.id}
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -12 }}
          transition={{ duration: 0.3 }}
          className="grid gap-6 lg:grid-cols-[1.4fr_1fr]"
        >
          <GlassCard>
            <p className="text-xs font-extrabold uppercase tracking-wide text-primary">
              {t('step')} {i + 1} {t('of')} {scenes.length}
            </p>
            <h2 className="mt-1 text-2xl font-extrabold">{scene.name}</h2>
            <p className="mt-2 text-sm opacity-75">{scene.blurb}</p>

            <div className="my-5 h-px bg-border" />

            <PointGrid points={scene.points} />
            <Notes scene={scene} />

            <div className="mt-5 border-t pt-4">
              <p className="text-sm font-extrabold text-primary">{scene.status}</p>
              <p className="text-xs opacity-65">{scene.statusHint}</p>
            </div>
          </GlassCard>

          <GlassCard>
            <p className="text-xs font-extrabold uppercase tracking-wide opacity-55">{t('badge')}</p>
            <ul className="mt-3 space-y-3">
              {scene.highlights.map((h) => (
                <li key={h} className="flex gap-2.5 text-sm">
                  <Check size={16} className="mt-0.5 shrink-0 text-primary" />
                  {h}
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <button
                onClick={() => setI(last ? 0 : i + 1)}
                className="btn-gradient flex w-full items-center justify-center gap-2 rounded-xl py-3 font-extrabold"
              >
                {last ? t('startTrial') : t('next')}
                <ArrowRight size={16} />
              </button>
              <button
                onClick={() => setI(i === 0 ? scenes.length - 1 : i - 1)}
                className="glass mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold"
              >
                <ArrowLeft size={14} /> {t('prev')}
              </button>
            </div>
          </GlassCard>
        </motion.section>
      </AnimatePresence>

      <section className="mesh-hero grain relative overflow-hidden rounded-3xl border border-primary/30 p-8 text-center md:p-14">
        <div className="relative z-[2]">
          <h2 className="text-2xl font-extrabold md:text-3xl">
            <span className="text-gradient">{t('ctaTitle')}</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl opacity-80">{t('ctaBody')}</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link to="/register" className="btn-gradient glow rounded-xl px-8 py-3.5 font-extrabold">
              {t('startTrial')}
            </Link>
            <Link to="/pricing" className="glass rounded-xl px-8 py-3.5 font-extrabold">
              Pricing
            </Link>
          </div>
          <ul className="mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs opacity-70">
            {(['noCard', 'setupTime', 'cancelAnytime'] as const).map((k) => (
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
