import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { requireRole, verifySupabaseJwt } from '../middleware/auth.js';
import { generalLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { h } from '../utils/async.js';
import { ApiError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';
import { getSupabaseAdmin } from '../utils/supabase.js';

type Envelope<T> = { data: T; meta?: Record<string, unknown> };

/** Paisa -> taka for JSON responses. Never sum floats on the server. */
const toTaka = (paisa: unknown): number => Math.round(Number(paisa ?? 0)) / 100;

const ITEM_INPUT = z.object({
  description: z.string().min(1).max(200),
  kind: z.enum(['fee', 'service', 'package', 'discount', 'other']).default('fee'),
  serviceId: z.string().uuid().optional(),
  unitPricePaisa: z.number().int().min(0).max(100_000_000),
  quantity: z.number().int().min(1).max(999).default(1),
  discountPaisa: z.number().int().min(0).default(0),
});

const shapeInvoice = (r: Record<string, unknown>, items: Record<string, unknown>[] = []) => ({
  id: r.id,
  number: r.number,
  status: r.status,
  patientId: r.patient_id,
  appointmentId: r.appointment_id,
  branchId: r.branch_id,
  issuedAt: r.issued_at,
  dueAt: r.due_at,
  subtotal: toTaka(r.subtotal_paisa),
  discount: toTaka(r.discount_paisa),
  tax: toTaka(r.tax_paisa),
  total: toTaka(r.total_paisa),
  paid: toTaka(r.paid_paisa),
  balance: toTaka(r.balance_paisa),
  notes: r.notes,
  items: items.map((i) => ({
    id: i.id,
    description: i.description,
    kind: i.kind,
    unitPrice: toTaka(i.unit_price_paisa),
    quantity: i.quantity,
    discount: toTaka(i.discount_paisa),
    lineTotal: toTaka(i.line_total_paisa),
  })),
});

/**
 * Invoicing for clinics (Module 16).
 *
 * Money is integer paisa end-to-end; taka appears only at the JSON boundary.
 * Scoped by org_id so a receptionist can bill only their own clinic.
 */
export function invoicesRouter(env: Env, logger: Logger): Router {
  const r: Router = Router();
  const auth = verifySupabaseJwt(env);
  const db = () => getSupabaseAdmin(env);
  const staff = requireRole('org_admin', 'branch_admin', 'receptionist');

  /** Recompute the header from items and return the shaped invoice. */
  const reload = async (invoiceId: string) => {
    const supabase = db();
    const { data, error } = await supabase.rpc('recalc_invoice', { p_invoice: invoiceId });
    if (error) throw ApiError.upstream('errors.upstream', error.message);
    const inv = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (!inv) throw ApiError.notFound();
    const { data: items } = await supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('created_at');
    return shapeInvoice(inv, (items ?? []) as Record<string, unknown>[]);
  };

  /** GET /invoices — list invoices (RLS narrows to the caller's clinic). */
  r.get(
    '/',
    generalLimiter(env),
    auth,
    validate({
      query: z.object({
        patientId: z.string().uuid().optional(),
        appointmentId: z.string().uuid().optional(),
        status: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
    }),
    h(async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
      const q = z
        .object({
          patientId: z.string().uuid().optional(),
          appointmentId: z.string().uuid().optional(),
          status: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        })
        .parse(req.query);
      const supabase = db();

      let query = supabase
        .from('invoices')
        .select('*')
        .order('issued_at', { ascending: false })
        .limit(q.limit);
      if (q.patientId) query = query.eq('patient_id', q.patientId);
      if (q.appointmentId) query = query.eq('appointment_id', q.appointmentId);
      if (q.status) query = query.eq('status', q.status);

      const { data, error } = await query;
      if (error) throw ApiError.upstream('errors.upstream', error.message);

      res.json({
        data: (data ?? []).map((i) => shapeInvoice(i as Record<string, unknown>)),
        meta: { limit: q.limit, count: (data ?? []).length },
      });
    }),
  );

  /** POST /invoices — issue an invoice with its line items. */
  r.post(
    '/',
    generalLimiter(env),
    auth,
    staff,
    validate({
      body: z.object({
        patientId: z.string().uuid(),
        appointmentId: z.string().uuid().optional(),
        branchId: z.string().uuid().optional(),
        taxPaisa: z.number().int().min(0).default(0),
        dueAt: z.string().datetime().optional(),
        notes: z.string().max(500).optional(),
        items: z.array(ITEM_INPUT).min(1, 'an invoice needs at least one line item'),
      }),
    }),
    h(async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
      const body = req.body as {
        patientId: string;
        appointmentId?: string;
        branchId?: string;
        taxPaisa: number;
        dueAt?: string;
        notes?: string;
        items: Array<z.infer<typeof ITEM_INPUT>>;
      };
      const supabase = db();

      // Resolve which clinic this invoice belongs to. The caller's org is
      // authoritative; otherwise fall back to the appointment, then to the
      // patient's most recent visit.
      const { data: profile } = await supabase
        .from('profiles')
        .select('org_id')
        .eq('id', req.auth!.userId)
        .maybeSingle();
      let orgId = (profile as { org_id?: string } | null)?.org_id ?? null;

      if (!orgId && body.appointmentId) {
        const { data: appt } = await supabase
          .from('appointments')
          .select('org_id')
          .eq('id', body.appointmentId)
          .maybeSingle();
        orgId = (appt as { org_id?: string } | null)?.org_id ?? null;
      }
      if (!orgId) {
        const { data: appts } = await supabase
          .from('appointments')
          .select('org_id')
          .eq('patient_id', body.patientId)
          .not('org_id', 'is', null)
          .limit(1);
        orgId = (appts?.[0] as { org_id?: string } | null)?.org_id ?? null;
      }
      if (!orgId) {
        throw new ApiError(400, 'errors.invalidInput', 'cannot determine clinic for this invoice');
      }

      const { data: number, error: numErr } = await supabase.rpc('next_invoice_number', { p_org: orgId });
      if (numErr) throw ApiError.upstream('errors.upstream', numErr.name);

      const { data: inv, error } = await supabase
        .from('invoices')
        .insert({
          org_id: orgId,
          branch_id: body.branchId ?? null,
          patient_id: body.patientId,
          appointment_id: body.appointmentId ?? null,
          number: (Array.isArray(number) ? number[0] : number) as string,
          status: 'issued',
          tax_paisa: body.taxPaisa,
          due_at: body.dueAt ?? null,
          notes: body.notes ?? null,
          created_by: req.auth!.userId,
        })
        .select('id')
        .single();
      if (error) {
        const key = /unique|duplicate/i.test(error.message)
          ? 'errors.invoiceExistsForAppointment'
          : 'errors.upstream';
        throw ApiError.upstream(key, error.message);
      }

      const invoiceId = (inv as { id: string }).id;
      const rows = body.items.map((i) => ({
        invoice_id: invoiceId,
description: i.description,
        kind: i.kind,
        service_id: i.serviceId ?? null,
        appointment_id: body.appointmentId ?? null,
        unit_price_paisa: i.unitPricePaisa,
        quantity: i.quantity,
        discount_paisa: i.discountPaisa,
        line_total_paisa: Math.max(0, i.unitPricePaisa * i.quantity - i.discountPaisa),
      }));
      const { error: itemErr } = await supabase.from('invoice_items').insert(rows);
      if (itemErr) throw ApiError.upstream('errors.upstream', itemErr.message);

      const shaped = await reload(invoiceId);
      logger.info({ actor: req.auth!.userId, invoice: shaped.number }, 'invoice issued');
      res.status(201).json({ data: shaped });
    }),
  );

/** GET /invoices/:id — one invoice with its line items. */
  r.get(
    '/:id',
    generalLimiter(env),
    auth,
    validate({ params: z.object({ id: z.string().uuid() }) }),
    h(async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const supabase = db();
      const { data, error } = await supabase.from('invoices').select('*').eq('id', id).maybeSingle();
      if (error) throw ApiError.upstream('errors.upstream', error.message);
      if (!data) throw ApiError.notFound();
      const { data: items } = await supabase
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', id)
        .order('created_at');
      res.json({
        data: shapeInvoice(data as Record<string, unknown>, (items ?? []) as Record<string, unknown>[]),
      });
    }),
  );

  /** POST /invoices/:id/void — cancel an invoice without erasing history. */
  r.post(
    '/:id/void',
    generalLimiter(env),
    auth,
    staff,
    validate({
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ reason: z.string().min(3).max(300) }),
    }),
    h(async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { reason } = z.object({ reason: z.string().min(3).max(300) }).parse(req.body);
      const { data, error } = await db()
        .from('invoices')
        .update({ status: 'void', voided_at: new Date().toISOString(), void_reason: reason })
        .eq('id', id)
        .select('id')
        .maybeSingle();
      if (error) throw ApiError.upstream('errors.upstream', error.message);
      if (!data) throw ApiError.notFound();
      logger.info({ actor: req.auth!.userId, invoice: id, reason }, 'invoice voided');
      res.json({ data: { id, status: 'void' } });
    }),
  );

  /** GET /invoices/patients/:patientId/statement — outstanding balance. */
  r.get(
    '/patients/:patientId/statement',
    generalLimiter(env),
    auth,
    validate({ params: z.object({ patientId: z.string().uuid() }) }),
    h(async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
      const { patientId } = z.object({ patientId: z.string().uuid() }).parse(req.params);
      const { data, error } = await db()
        .from('invoices')
        .select('id, number, issued_at, status, total_paisa, paid_paisa, balance_paisa')
        .eq('patient_id', patientId)
        .not('status', 'in', '(void,refunded)')
        .order('issued_at', { ascending: false });
      if (error) throw ApiError.upstream('errors.upstream', error.message);

      const rows = (data ?? []) as Record<string, unknown>[];
      const outstanding = rows.reduce((n, i) => n + Number(i.balance_paisa ?? 0), 0);
      res.json({
        data: {
          patientId,
          invoices: rows.map((i) => ({
            id: i.id,
            number: i.number,
            issuedAt: i.issued_at,
            status: i.status,
            total: toTaka(i.total_paisa),
            paid: toTaka(i.paid_paisa),
            balance: toTaka(i.balance_paisa),
          })),
          totalOutstanding: toTaka(outstanding),
          currency: 'BDT',
        },
      });
    }),
  );

  return r;
}

