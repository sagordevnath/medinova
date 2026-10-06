import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CreditCard, RefreshCw, Search, TrendingUp, UserPlus } from 'lucide-react';
import { apiGet, apiPost, formatBdt } from '@/lib/api';
import { useAuth, useSessionToken } from '@/hooks/useAuth';
import { useToast } from '@/providers/ToastProvider';
import { Button, GlassCard } from '@/components/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { Modal } from '@/components/overlays';

type Tab = 'overview' | 'clinics';

interface Overview {
  totalOrganizations: number;
  activeSubscriptions: number;
  trialingSubscriptions: number;
  pastDueSubscriptions: number;
  cancelledSubscriptions: number;
  totalSeats: number;
  mrrPaisa: number;
  collectedLast12mPaisa: number;
  renewalsDue30d: number;
}

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  contactEmail: string | null;
  city: string | null;
  status: string;
  branchCount: number;
  planName: string | null;
  subscriptionStatus: string;
  billingCycle: string | null;
  seats: number;
  amountTaka: number;
  renewsAt: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  trial: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  trialing: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  past_due: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  suspended: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
        STATUS_STYLES[status] ?? 'bg-slate-500/15 text-slate-600 dark:text-slate-300'
      }`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

/**
 * Platform dashboard for the MediNova owner (super_admin).
 *
 * Deliberately NOT reachable by org_admin: a subscribing clinic must never see
 * the platform's customer list or revenue. Their console lives at /manage.
 */
export function PlatformPage() {
  const { profile } = useAuth();
  const token = useSessionToken();
  const { push } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [search, setSearch] = useState('');
  const [onboardOpen, setOnboardOpen] = useState(false);

  const overview = useQuery({
    queryKey: ['platform-overview'],
    queryFn: () => apiGet<{ data: Overview }>('/v1/platform/overview', token),
    enabled: Boolean(token),
  });

  const orgs = useQuery({
    queryKey: ['platform-orgs'],
    queryFn: () => apiGet<{ data: OrgRow[] }>('/v1/platform/organizations', token),
    enabled: Boolean(token),
  });

  const refresh = () => {
    void overview.refetch();
    void orgs.refetch();
  };

  // Filter client-side for instant feedback; the API also supports ?search=.
  const rows = (orgs.data?.data ?? []).filter((o) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      o.name.toLowerCase().includes(q) ||
      o.slug.toLowerCase().includes(q) ||
      (o.contactEmail ?? '').toLowerCase().includes(q)
    );
  });

  const d = overview.data?.data;
  const mrr = (d?.mrrPaisa ?? 0) / 100;
  const collected = (d?.collectedLast12mPaisa ?? 0) / 100;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-primary">MediNova platform</p>
          <h1 className="text-3xl font-extrabold">Subscription control center</h1>
          <p className="mt-1 text-sm opacity-70">
            Signed in as {profile?.fullName ?? 'Super admin'} — every subscribing clinic
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={refresh}>
            <RefreshCw size={16} aria-hidden="true" />
            Refresh
          </Button>
          <Button onClick={() => setOnboardOpen(true)}>
            <UserPlus size={16} aria-hidden="true" />
            Onboard clinic
          </Button>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Platform sections">
        {(['overview', 'clinics'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-current={tab === t}
            className={`rounded-xl border px-4 py-2 text-sm font-bold ${tab === t ? 'btn-gradient' : 'bg-card'}`}
          >
            {t === 'overview' ? 'Overview' : 'Clinics'}
          </button>
        ))}
      </nav>

      {overview.isPending && <Skeleton className="h-40" />}
      {overview.isError && (
        <ErrorState message="Could not load the platform overview." onRetry={() => overview.refetch()} />
      )}

      {tab === 'overview' && d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Monthly recurring revenue" value={formatBdt(mrr, 'en')} icon={<TrendingUp size={16} />} />
            <Metric label="Active subscriptions" value={d.activeSubscriptions} icon={<CreditCard size={16} />} />
            <Metric label="Clinics on trial" value={d.trialingSubscriptions} icon={<Building2 size={16} />} />
            <Metric label="Past due" value={d.pastDueSubscriptions} icon={<CreditCard size={16} />} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Total clinics" value={d.totalOrganizations} />
            <Metric label="Seats sold" value={d.totalSeats} />
            <Metric label="Renewals in 30 days" value={d.renewalsDue30d} />
            <Metric label="Collected (12 months)" value={formatBdt(collected, 'en')} />
          </div>
        </>
      )}

      {tab === 'clinics' && (
        <GlassCard>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-extrabold">Subscribing clinics</h2>
            <label className="flex min-h-[44px] items-center gap-2 rounded-xl border bg-card px-3">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search clinics</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or email"
                className="min-w-[200px] bg-transparent outline-none"
              />
            </label>
          </div>

          {orgs.isPending && <Skeleton className="mt-4 h-64" />}
          {orgs.isError && <ErrorState message="Could not load clinics." onRetry={() => orgs.refetch()} />}

          {orgs.data && (rows.length === 0 ? (
            <EmptyState
              title="No clinics yet"
              body="Onboard your first customer to get started."
            />
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr>
                    <th>Clinic</th>
                    <th>Plan</th>
                    <th>Subscription</th>
                    <th>Seats</th>
                    <th>Branches</th>
                    <th>Amount</th>
                    <th>Renews</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id} className="border-t">
                      <td className="py-2">
                        <b>{o.name}</b>
                        <p className="text-xs opacity-70">{o.contactEmail ?? o.slug}</p>
                      </td>
                      <td>{o.planName ?? '—'}</td>
                      <td><StatusPill status={o.subscriptionStatus} /></td>
                      <td>{o.seats}</td>
                      <td>{o.branchCount}</td>
                      <td>
                        {formatBdt(o.amountTaka, 'en')}
                        <span className="text-xs opacity-60">
                          /{o.billingCycle === 'yearly' ? 'yr' : 'mo'}
                        </span>
                      </td>
                      <td>{o.renewsAt ? new Date(o.renewsAt).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </GlassCard>
      )}

      <OnboardModal
        open={onboardOpen}
        token={token}
        onClose={() => setOnboardOpen(false)}
        onDone={(msg) => {
          setOnboardOpen(false);
          void qc.invalidateQueries({ queryKey: ['platform-overview'] });
          void qc.invalidateQueries({ queryKey: ['platform-orgs'] });
          push({ kind: 'success', title: msg });
        }}
      />
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string | number; icon?: React.ReactNode }) {
  return (
    <GlassCard>
      <p className="flex items-center gap-2 text-sm opacity-70">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold">{value}</p>
    </GlassCard>
  );
}

function OnboardModal({
  open,
  token,
  onClose,
  onDone,
}: {
  open: boolean;
  token: string | null;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [form, setForm] = useState({
    name: '',
    contactEmail: '',
    ownerEmail: '',
    ownerName: '',
    planCode: 'professional',
    billingCycle: 'yearly' as 'monthly' | 'yearly',
    trialDays: 14,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await apiPost(
        '/v1/platform/organizations',
        {
          name: form.name.trim(),
          contactEmail: form.contactEmail.trim() || undefined,
          ownerEmail: form.ownerEmail.trim() || undefined,
          ownerName: form.ownerName.trim() || undefined,
          planCode: form.planCode,
          billingCycle: form.billingCycle,
          trialDays: form.trialDays,
        },
        token,
      );
      setForm((f) => ({ ...f, name: '', contactEmail: '', ownerEmail: '', ownerName: '' }));
      onDone('Clinic onboarded');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not onboard the clinic');
    } finally {
      setBusy(false);
    }
  };

  const input = 'min-h-11 rounded-xl border bg-card px-3 font-normal';

  return (
    <Modal open={open} onClose={onClose} title="Onboard a clinic">
      <div className="grid gap-3">
        {error && (
          <p role="alert" className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <label className="grid gap-1 text-sm font-semibold">
          Clinic name
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} className={input} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Contact email
          <input
            type="email"
            value={form.contactEmail}
            onChange={(e) => set({ contactEmail: e.target.value })}
            className={input}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Owner login email
          <input
            type="email"
            value={form.ownerEmail}
            onChange={(e) => set({ ownerEmail: e.target.value })}
            className={input}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Owner name
          <input value={form.ownerName} onChange={(e) => set({ ownerName: e.target.value })} className={input} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm font-semibold">
            Plan
            <select
              value={form.planCode}
              onChange={(e) => set({ planCode: e.target.value })}
              className="min-h-11 rounded-xl border bg-card p-2 font-normal"
            >
              <option value="starter">Starter</option>
              <option value="professional">Professional</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Billing
            <select
              value={form.billingCycle}
              onChange={(e) => set({ billingCycle: e.target.value as 'monthly' | 'yearly' })}
              className="min-h-11 rounded-xl border bg-card p-2 font-normal"
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Trial days
            <input
              type="number"
              min={0}
              max={365}
              value={form.trialDays}
              onChange={(e) => set({ trialDays: Number(e.target.value) })}
              className={input}
            />
          </label>
        </div>
        <Button disabled={busy || form.name.trim().length < 2} onClick={() => void submit()}>
          {busy ? 'Creating…' : 'Create clinic'}
        </Button>
      </div>
    </Modal>
  );
}
