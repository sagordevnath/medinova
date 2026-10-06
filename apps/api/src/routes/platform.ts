import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { requireRole, verifySupabaseJwt } from '../middleware/auth.js';
import { strictLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { h } from '../utils/async.js';
import { ApiError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';
import { getSupabaseAdmin } from '../utils/supabase.js';

type Envelope<T> = { data: T; meta?: Record<string, unknown> };

const slugify = (s: string): string =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** BDT paisa -> taka for display. Money is stored as integers, never floats. */
const toTaka = (paisa: unknown): number => Math.round(Number(paisa ?? 0)) / 100;

const NO_ORG = ['00000000-0000-0000-0000-000000000000'];

/**
 * Platform administration for the MediNova owner (super_admin).
 *
 * Everything here is cross-tenant by design: it lists and manages the clinics
 * that subscribe to the product. An `org_admin` (a clinic's own administrator)
 * must NOT reach these routes — they get their own tenant-scoped console.
 */
export function platformRouter(env: Env, logger: Logger): Router {
  const r: Router = Router();
  const auth = verifySupabaseJwt(env);
  const superOnly = requireRole('super_admin');
  const db = () => getSupabaseAdmin(env);

  /** GET /platform/overview — headline numbers for the subscription dashboard. */
  r.get(
    '/overview',
    strictLimiter(env),
    auth,
    superOnly,
    h(async (_req: Request, res: Response<Envelope<unknown>>) => {
      const supabase = db();
      const [orgs, subs, events] = await Promise.all([
        supabase.from('organizations').select('id, status'),
        supabase.from('subscriptions').select('org_id, status, unit_price_paisa, billing_cycle, seats, current_period_end'),
        supabase.from('subscription_events')
          .select('amount_paisa, event_type')
          .in('event_type', ['payment_succeeded', 'activated', 'renewed', 'upgraded'])
          .gte('created_at', new Date(Date.now() - 365 * 864e5).toISOString()),
      ]);

      const live = (subs.data ?? []).filter((s) => ['trialing', 'active', 'past_due'].includes(s.status));
      const statusCounts = (orgs.data ?? []).reduce<Record<string, number>>((acc, o) => {
        acc[o.status] = (acc[o.status] ?? 0) + 1;
        return acc;
      }, {});
      const now = Date.now();

      res.json({
        data: {
          totalOrganizations: (orgs.data ?? []).length,
          activeSubscriptions: live.filter((s) => s.status === 'active').length,
          trialingSubscriptions: live.filter((s) => s.status === 'trialing').length,
          pastDueSubscriptions: live.filter((s) => s.status === 'past_due').length,
          cancelledSubscriptions: (subs.data ?? []).filter((s) => s.status === 'cancelled').length,
          statusCounts,
          totalSeats: live.reduce((n, s) => n + Number(s.seats ?? 0), 0),
          // MRR from LIVE subscriptions only — cancelled rows must never count.
          mrrPaisa: live
            .filter((s) => s.status === 'active')
            .reduce((n, s) => n + Number(s.unit_price_paisa ?? 0) / (s.billing_cycle === 'yearly' ? 12 : 1), 0),
          collectedLast12mPaisa: (events.data ?? []).reduce((n, e) => n + Number(e.amount_paisa ?? 0), 0),
          renewalsDue30d: live.filter((s) => {
            const d = new Date(s.current_period_end).getTime();
            return d > now && d < now + 30 * 864e5;
          }).length,
        },
      });
    }),
  );

  /** GET /platform/organizations — every subscribing clinic, with its plan. */
  r.get(
    '/organizations',
    strictLimiter(env),
    auth,
    superOnly,
    h(async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
      const q = z
        .object({
          search: z.string().optional(),
          status: z.string().optional(),
          plan: z.string().optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(25),
        })
        .safeParse(req.query);
      if (!q.success) return res.status(400).json({ error: 'errors.invalidQuery' });

      const supabase = db();
      const { data: orgs, error } = await supabase
        .from('organizations')
        .select('id, name, slug, contact_email, contact_phone, city, status, created_at, onboarded_at')
        .order('created_at', { ascending: false });
      if (error) throw ApiError.upstream('errors.upstream', error.message);

      const ids = (orgs ?? []).map((o) => o.id as string);
      const lookup = ids.length ? ids : NO_ORG;
      const [subsRes, plansRes, branchRes] = await Promise.all([
        supabase
          .from('subscriptions')
          .select('org_id, plan_id, status, billing_cycle, unit_price_paisa, seats, current_period_end')
          .in('org_id', lookup),
        supabase.from('plans').select('id, code, name'),
        supabase.from('branches').select('org_id').in('org_id', lookup),
      ]);

      const planById = new Map((plansRes.data ?? []).map((p) => [p.id as string, p]));
      const subByOrg = new Map((subsRes.data ?? []).map((s) => [s.org_id as string, s]));
      const branchCounts = (branchRes.data ?? []).reduce<Record<string, number>>((acc, b) => {
        acc[b.org_id as string] = (acc[b.org_id as string] ?? 0) + 1;
        return acc;
      }, {});

      const search = q.data.search?.toLowerCase();
      let rows = (orgs ?? []).map((o) => {
        const sub = subByOrg.get(o.id as string) ?? null;
        const plan = sub ? planById.get(sub.plan_id as string) : null;
        return {
          id: o.id,
          name: o.name,
          slug: o.slug,
          contactEmail: o.contact_email,
          contactPhone: o.contact_phone,
          city: o.city,
          status: o.status,
          branchCount: branchCounts[o.id as string] ?? 0,
          planCode: plan?.code ?? null,
          planName: plan?.name ?? null,
          subscriptionStatus: sub?.status ?? 'none',
          billingCycle: sub?.billing_cycle ?? null,
          seats: sub?.seats ?? 0,
          amountTaka: toTaka(sub?.unit_price_paisa ?? 0),
          renewsAt: sub?.current_period_end ?? null,
          createdAt: o.created_at,
        };
      });

      if (q.data.status) rows = rows.filter((x) => x.status === q.data.status);
      if (q.data.plan) rows = rows.filter((x) => x.planCode === q.data.plan);
      if (search) {
        rows = rows.filter(
          (x) =>
            x.name.toLowerCase().includes(search) ||
            x.slug.toLowerCase().includes(search) ||
            (x.contactEmail ?? '').toLowerCase().includes(search),
        );
      }

      const total = rows.length;
      const start = (q.data.page - 1) * q.data.pageSize;
      res.json({
        data: rows.slice(start, start + q.data.pageSize),
        meta: { page: q.data.page, pageSize: q.data.pageSize, total, plans: plansRes.data ?? [] },
      });
    }),
  );

  /** POST /platform/organizations — onboard a new clinic and start its trial. */
  r.post(
    '/organizations',
    strictLimiter(env),
    auth,
    superOnly,
    validate({
      body: z.object({
        name: z.string().min(2).max(120),
        contactEmail: z.string().email().optional(),
        contactPhone: z.string().max(20).optional(),
        city: z.string().max(80).optional(),
        address: z.string().max(300).optional(),
        planCode: z.string().min(2).default('professional'),
        billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
        trialDays: z.number().int().min(0).max(365).default(14),
        ownerEmail: z.string().email().optional(),
        ownerName: z.string().min(2).max(120).optional(),
      }),
    }),
    h(async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
      const body = req.body as {
        name: string;
        contactEmail?: string;
        contactPhone?: string;
        city?: string;
        address?: string;
        planCode: string;
        billingCycle: 'monthly' | 'yearly';
        trialDays: number;
        ownerEmail?: string;
        ownerName?: string;
      };
      const supabase = db();

      const { data: plan, error: planErr } = await supabase
        .from('plans')
        .select('id, code, price_monthly_paisa, price_yearly_paisa')
        .eq('code', body.planCode)
        .maybeSingle();
      if (planErr) throw ApiError.upstream('errors.upstream', planErr.message);
      if (!plan) throw new ApiError(400, 'errors.invalidInput', `unknown plan ${body.planCode}`);

      const slug = `${slugify(body.name)}-${Math.random().toString(36).slice(2, 6)}`;
      const { data: org, error: orgErr } = await supabase
        .from('organizations')
        .insert({
          name: body.name,
          slug,
          contact_email: body.contactEmail ?? null,
          contact_phone: body.contactPhone ?? null,
          city: body.city ?? null,
          address: body.address ?? null,
          status: body.trialDays > 0 ? 'trial' : 'active',
          onboarded_at: new Date().toISOString(),
        })
        .select('id, name, slug')
        .single();
      if (orgErr) throw ApiError.upstream('errors.upstream', orgErr.message);

      const unitPrice = body.billingCycle === 'yearly' ? plan.price_yearly_paisa : plan.price_monthly_paisa;
      const periodEnd = new Date();
      if (body.trialDays > 0) periodEnd.setDate(periodEnd.getDate() + body.trialDays);
      else periodEnd.setMonth(periodEnd.getMonth() + (body.billingCycle === 'yearly' ? 12 : 1));

      const { data: sub, error: subErr } = await supabase
        .from('subscriptions')
        .insert({
          org_id: org.id,
          plan_id: plan.id,
          status: body.trialDays > 0 ? 'trialing' : 'active',
          billing_cycle: body.billingCycle,
          unit_price_paisa: unitPrice,
          seats: 5,
          trial_ends_at: body.trialDays > 0 ? periodEnd.toISOString() : null,
          current_period_start: new Date().toISOString(),
          current_period_end: periodEnd.toISOString(),
        })
        .select('id')
        .single();
      if (subErr) throw ApiError.upstream('errors.upstream', subErr.message);

      await supabase.from('subscription_events').insert({
        org_id: org.id,
        subscription_id: sub.id,
        event_type: 'created',
        amount_paisa: 0,
        provider: 'manual',
        note: `Onboarded on ${plan.code} (${body.billingCycle})`,
        actor_id: req.auth!.userId,
      });

      // Optionally create the clinic's first org_admin so the tenant is usable.
      let ownerUserId: string | null = null;
      let ownerWarning: string | null = null;
      if (body.ownerEmail) {
        const { data: created, error: authErr } = await supabase.auth.admin.createUser({
          email: body.ownerEmail,
          email_confirm: true,
          user_metadata: { full_name: body.ownerName ?? 'Clinic Admin' },
        });
        if (authErr) {
          ownerWarning = authErr.message;
        } else if (created.user) {
          ownerUserId = created.user.id;
          // The signup trigger already created a patient profile; upgrade it
          // in place rather than upserting, which supabase-js types poorly here.
          const { error: profErr } = await supabase
            .from('profiles')
            .update({ role: 'org_admin', org_id: org.id })
            .eq('id', created.user.id);
          if (profErr) {
            // No profile row (trigger missing): create the org_admin directly.
            await supabase.from('profiles').insert({
              id: created.user.id,
              full_name: body.ownerName ?? 'Clinic Admin',
              role: 'org_admin',
              org_id: org.id,
              preferred_lang: 'en',
            });
          }
        }
      }

      logger.info({ actor: req.auth!.userId, orgId: org.id, plan: plan.code }, 'organization onboarded');
      res.status(201).json({
        data: {
          organization: org,
          subscriptionId: sub.id,
          ownerUserId,
          ownerWarning,
          planCode: plan.code,
          trialEndsAt: body.trialDays > 0 ? periodEnd.toISOString() : null,
        },
      });
    }),
  );

  /** GET /platform/organizations/:id/events — billing history for one clinic. */
  r.get(
    '/organizations/:id/events',
    strictLimiter(env),
    auth,
    superOnly,
    validate({ params: z.object({ id: z.string().uuid() }) }),
    h(async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { data, error } = await db()
        .from('subscription_events')
        .select('id, event_type, amount_paisa, currency, provider, note, created_at')
        .eq('org_id', id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw ApiError.upstream('errors.upstream', error.message);
      res.json({ data: (data ?? []).map((e) => ({ ...e, amountTaka: toTaka(e.amount_paisa) })) });
    }),
  );

  /** PATCH /platform/subscriptions/:id — change plan, cycle, seats or status. */
  r.patch(
    '/subscriptions/:id',
    strictLimiter(env),
    auth,
    superOnly,
    validate({
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        planCode: z.string().min(2).optional(),
        billingCycle: z.enum(['monthly', 'yearly']).optional(),
        seats: z.number().int().min(1).max(10000).optional(),
        status: z.enum(['trialing', 'active', 'past_due', 'cancelled', 'expired']).optional(),
        orgStatus: z.enum(['trial', 'active', 'past_due', 'suspended', 'cancelled']).optional(),
        renewNow: z.boolean().optional(),
        note: z.string().max(300).optional(),
      }),
    }),
    h(async (req: Request, res: Response<Envelope<unknown> | { error: string }>) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = req.body as {
        planCode?: string;
        billingCycle?: 'monthly' | 'yearly';
        seats?: number;
        status?: string;
        orgStatus?: string;
        renewNow?: boolean;
        note?: string;
      };
      const supabase = db();

      const { data: current, error: curErr } = await supabase
        .from('subscriptions')
        .select('id, org_id, plan_id, status, billing_cycle, unit_price_paisa, seats')
        .eq('id', id)
        .maybeSingle();
      if (curErr) throw ApiError.upstream('errors.upstream', curErr.message);
      if (!current) throw ApiError.notFound();

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      let eventType = 'activated';
      let nextPlanId: string = current.plan_id;

      if (body.planCode) {
        const { data: plan } = await supabase.from('plans').select('*').eq('code', body.planCode).maybeSingle();
        if (!plan) throw new ApiError(400, 'errors.invalidInput', `unknown plan ${body.planCode}`);
        const { data: prevPlan } = await supabase.from('plans').select('code').eq('id', current.plan_id).maybeSingle();
        eventType = (prevPlan?.code === 'starter' && plan.code !== 'starter') ? 'upgraded' : 'downgraded';
        nextPlanId = plan.id as string;
        patch.plan_id = nextPlanId;
      }
      if (body.seats !== undefined) patch.seats = body.seats;
      if (body.status !== undefined) {
        patch.status = body.status;
        if (body.status === 'cancelled') patch.cancelled_at = new Date().toISOString();
        eventType = body.status === 'cancelled' ? 'cancelled' : 'reactivated';
      }

      // Cycle change re-prices from the (possibly new) plan.
      const cycle = body.billingCycle ?? current.billing_cycle;
      if (body.billingCycle || body.planCode) {
        const { data: plan } = await supabase.from('plans').select('*').eq('id', nextPlanId).maybeSingle();
        patch.billing_cycle = cycle;
        patch.unit_price_paisa = cycle === 'yearly' ? plan?.price_yearly_paisa : plan?.price_monthly_paisa;
      }

      if (body.renewNow) {
        const end = new Date();
        end.setMonth(end.getMonth() + (cycle === 'yearly' ? 12 : 1));
        patch.current_period_start = new Date().toISOString();
        patch.current_period_end = end.toISOString();
        eventType = 'renewed';
      }

      const { data: updated, error: updErr } = await supabase
        .from('subscriptions')
        .update(patch)
        .eq('id', id)
        .select('id, status, billing_cycle, seats, unit_price_paisa, current_period_end')
        .single();
      if (updErr) throw ApiError.upstream('errors.upstream', updErr.message);

      if (body.orgStatus) {
        await supabase.from('organizations').update({ status: body.orgStatus }).eq('id', current.org_id);
        if (body.orgStatus === 'suspended') {
          await supabase.from('subscription_events').insert({
            org_id: current.org_id, subscription_id: id, event_type: 'suspended',
            provider: 'manual', note: body.note ?? null, actor_id: req.auth!.userId,
          });
        }
      }

      await supabase.from('subscription_events').insert({
        org_id: current.org_id,
        subscription_id: id,
        event_type: eventType,
        amount_paisa: Number(updated.unit_price_paisa ?? 0),
        provider: 'manual',
        note: body.note ?? null,
        actor_id: req.auth!.userId,
      });

      logger.info({ actor: req.auth!.userId, subId: id, event: eventType }, 'subscription updated');
      res.json({ data: updated });
    }),
  );

  return r;
}