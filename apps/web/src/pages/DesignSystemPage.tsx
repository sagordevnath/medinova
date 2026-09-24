import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button, GlassCard, GlassStrong } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Input, Select, Textarea, Field, DatePicker } from '@/components/fields';
import { Modal, Drawer, Tabs } from '@/components/overlays';
import { Skeleton, EmptyState, ErrorState, Stepper, AnimatedCounter } from '@/components/feedback';
import { ThemeToggle, LanguageSwitcher } from '@/components/toggles';
import { useToast } from '@/providers/ToastProvider';
import { useTranslation } from 'react-i18next';

export function DesignSystemPage() {
  const { i18n } = useTranslation();
  const { push } = useToast();
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState<'allopathic' | 'homeopathic'>('allopathic');
  const bn = i18n.language === 'bn';

  return (
    <div className="grid gap-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-extrabold">
          <span className="text-gradient">Design System</span>
        </h1>
        <p className="mt-1 text-sm opacity-70">Light + dark tokens · glass · glow · primitives (locale: {i18n.language})</p>
        <div className="mt-3 flex gap-2">
          <ThemeToggle />
          <LanguageSwitcher />
        </div>
      </motion.div>

      <section aria-label="buttons" className="grid gap-3">
        <h2 className="text-xl font-extrabold">Buttons (magnetic)</h2>
        <div className="flex flex-wrap gap-2">
          <Button>Primary gradient</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
        </div>
      </section>

      <section aria-label="cards" className="grid gap-3 md:grid-cols-2">
        <GlassCard>
          <h3 className="font-extrabold">.glass</h3>
          <p className="text-sm opacity-70">backdrop-blur 18px · translucent border · soft shadow</p>
          <div className="mt-2 flex gap-2">
            <Badge kind="allopathic">Allopathic · blue</Badge>
            <Badge kind="homeopathic">Homeopathic · green</Badge>
          </div>
        </GlassCard>
        <GlassStrong>
          <h3 className="font-extrabold">.glass-strong + .glow</h3>
          <p className="text-sm opacity-70">glow / glow-strong utilities for CTAs + emergency</p>
          <AnimatedCounter value={bn ? 25000 : 25000} locale={i18n.language} />
        </GlassStrong>
      </section>

      <section aria-label="form" className="grid gap-3">
        <h2 className="text-xl font-extrabold">Inputs / Select / DatePicker</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Input"><Input placeholder="Search doctor" /></Field>
          <Field label="Select">
            <Select defaultValue="dhanmondi">
              <option value="dhanmondi">Dhanmondi</option>
              <option value="chattogram">Chattogram</option>
            </Select>
          </Field>
          <Field label="DatePicker"><DatePicker /></Field>
          <Field label="Textarea"><Textarea placeholder="Notes" /></Field>
        </div>
      </section>

      <section aria-label="overlays" className="grid gap-3">
        <h2 className="text-xl font-extrabold">Modal / Drawer / Tabs / Toast</h2>
        <Tabs value={tab} onChange={setTab} label="medicine" options={[{ value: 'allopathic', label: 'Allopathic' }, { value: 'homeopathic', label: 'Homeopathic' }]} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setModal(true)}>Open modal</Button>
          <Button variant="outline" onClick={() => setDrawer(true)}>Open drawer</Button>
          <Button variant="secondary" onClick={() => push({ title: 'Toast ok', body: 'EN+BN safe', kind: 'success' })}>Push toast</Button>
        </div>
        <Modal open={modal} onClose={() => setModal(false)} title="Glass modal">
          <p className="text-sm opacity-70">Escape closes · click outside closes · focus-visible ring.</p>
        </Modal>
        <Drawer open={drawer} onClose={() => setDrawer(false)} title="Glass drawer">
          <p className="text-sm opacity-70">Mobile-first drawer.</p>
        </Drawer>
      </section>

      <section aria-label="states" className="grid gap-3">
        <h2 className="text-xl font-extrabold">Skeleton / Empty / Error / Stepper</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-24" />
          <EmptyState title="No results" body="Try another branch" />
          <ErrorState message="Failed to load" onRetry={() => push({ title: 'Retry', kind: 'info' })} />
        </div>
        <Stepper steps={['Branch', 'Doctor', 'Time', 'Confirm']} current={1} />
      </section>
    </div>
  );
}
