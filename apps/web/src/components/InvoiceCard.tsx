import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileText, Receipt } from 'lucide-react';
import { apiGet, formatBdt, type InvoiceDto, type MeDto, type StatementDto } from '@/lib/api';
import { GlassCard } from '@/components/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';

const badge = (s: string) =>
  `rounded-full px-2 py-0.5 text-xs font-bold ${
    s === 'paid' ? 'bg-emerald-100 text-emerald-800' : s === 'void' ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-800'
  }`;

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="opacity-70">{label}</span>
      <span className={strong ? 'font-extrabold' : 'font-semibold'}>{value}</span>
    </div>
  );
}

/** Patient-facing invoice list plus a running statement of account. */
export function BillingPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language === 'bn' ? 'bn' : 'en';
  // /v1/me carries the patient's own record; the staff Profile type has no
  // patient id, so it has to come from here.
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiGet<{ data: MeDto }>('/v1/me') });
  const patientId = me.data?.data.patients[0]?.id;

  const statement = useQuery({
    queryKey: ['my-statement', patientId],
    queryFn: () => apiGet<{ data: StatementDto }>(`/v1/invoices/patients/${patientId}/statement`),
    enabled: !!patientId,
  });

  if (me.isPending || statement.isPending) return <Skeleton className="h-64" />;
  if (me.isError || statement.isError) return <ErrorState message="Could not load your statement." />;
  if (!patientId) return <EmptyState title="No patient record linked to this account." />;

  const s = statement.data!.data;
  const rows = s.invoices;

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-bold text-primary">Billing</p>
        <h1 className="text-3xl font-extrabold">Invoices &amp; statements</h1>
      </header>

      <GlassCard className="border-primary/30">
        <p className="text-sm opacity-70">Total outstanding</p>
        <p className="mt-1 text-4xl font-extrabold text-primary">{formatBdt(s.totalOutstanding, lang)}</p>
        {s.totalOutstanding > 0 && (
          <p className="mt-2 text-sm opacity-70">Please settle at the branch counter or by mobile banking.</p>
        )}
      </GlassCard>

      <h2 className="text-xl font-extrabold">Recent invoices</h2>
      {rows.length === 0 ? (
        <EmptyState title="No invoices yet" />
      ) : (
        <GlassCard className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left opacity-70">
                <th className="p-3">Invoice</th>
                <th className="p-3">Date</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Total</th>
                <th className="p-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="border-b last:border-0">
                  <td className="p-3 font-bold">{i.number}</td>
                  <td className="p-3">{new Date(i.issued_at).toLocaleDateString()}</td>
                  <td className="p-3">{i.status}</td>
                  <td className="p-3 text-right">{formatBdt(i.total, lang)}</td>
                  <td className="p-3 text-right font-bold">{formatBdt(i.balance, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </GlassCard>
      )}
    </div>
  );
}
export function InvoiceCard({ invoice }: { invoice: InvoiceDto }) {
  const { i18n } = useTranslation();
  const lang = i18n.language === 'bn' ? 'bn' : 'en';
  return (
    <GlassCard className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Receipt className="text-primary" size={18} />
          <div>
            <p className="font-extrabold">{invoice.number}</p>
            <p className="text-xs opacity-70">{new Date(invoice.issuedAt).toLocaleDateString()}</p>
          </div>
        </div>
        <span className={badge(invoice.status)}>{invoice.status}</span>
      </div>
      <div className="space-y-1 border-t pt-2">
        {invoice.items.map((i) => (
          <div key={i.id} className="flex justify-between text-sm">
            <span className="opacity-80">
              {i.description} ×{i.quantity}
            </span>
            <span className="font-semibold">{formatBdt(i.lineTotal, lang)}</span>
          </div>
        ))}
      </div>
      <div className="space-y-1 border-t pt-2">
        <Line label="Subtotal" value={formatBdt(invoice.subtotal, lang)} />
        <Line label="Discount" value={`- ${formatBdt(invoice.discount, lang)}`} />
        <Line label="Total" value={formatBdt(invoice.total, lang)} strong />
        <Line label="Paid" value={formatBdt(invoice.paid, lang)} />
        <Line label="Balance due" value={formatBdt(invoice.balance, lang)} strong />
      </div>
    </GlassCard>
  );
}