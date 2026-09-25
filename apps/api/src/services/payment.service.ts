import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';
import { getSupabaseAdmin, awaitOk } from '../utils/supabase.js';
import { notify } from './notification.service.js';

export type PaymentProvider = 'cash' | 'bkash' | 'nagad' | 'sslcommerz';

export interface InitInput {
  appointmentId: string;
  provider: PaymentProvider;
  returnUrl?: string;
}

export interface InitResult {
  provider: PaymentProvider;
  status: 'pay_at_counter' | 'pending' | 'paid';
  redirectUrl: string | null;
  instructions: string;
  providerRef: string;
}

export interface WebhookVerification {
  ok: boolean;
  providerRef?: string;
  appointmentId?: string;
  reason?: string;
}

const COUNTER_MSG = 'Pay the fee at the branch counter before your visit.';

function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Provider adapters.
 *
 * cash — fully implemented: no gateway, marks pay_at_counter immediately.
 * bkash / nagad / sslcommerz — documented sandbox adapters: init() returns the
 * config-driven sandbox redirect; verifyWebhook() validates the signature with
 * the configured secret before settling. Swap sandbox URLs + secrets for
 * production credentials to go live. Documented contracts:
 *  - bkash:      HMAC-SHA256(body, BKASH_SECRET) == X-Bkash-Signature
 *  - nagad:      HMAC-SHA256(tran_id + amount, NAGAD_SALT) == X-Nagad-Signature
 *  - sslcommerz: HMAC-SHA256(store_id + amount + status + salt) == X-SSLC-Signature
 */
interface Adapter {
  init(env: Env, ref: string, amount: number, input: InitInput): InitResult;
  verify(env: Env, signature: string | undefined, body: Record<string, unknown>, amount?: number): WebhookVerification;
}

const cashAdapter: Adapter = {
  init: (_env, ref) => ({
    provider: 'cash',
    status: 'pay_at_counter',
    redirectUrl: null,
    instructions: COUNTER_MSG,
    providerRef: ref,
  }),
  verify: () => ({ ok: false, reason: 'cash has no webhook' }),
};

const bkashAdapter: Adapter = {
  init: (env, ref, _amount, input) => ({
    provider: 'bkash',
    status: 'pending',
    redirectUrl: `${env.BKASH_SANDBOX_URL}?paymentID=${encodeURIComponent(ref)}&return_url=${encodeURIComponent(input.returnUrl ?? env.CLIENT_URL)}`,
    instructions: 'You will be redirected to the bKash sandbox to complete payment.',
    providerRef: ref,
  }),
  verify: (env, signature, body) => {
    if (!env.BKASH_SECRET) return { ok: false, reason: 'bkash not configured' };
    if (!signature) return { ok: false, reason: 'missing X-Bkash-Signature' };
    const expected = hmacHex(env.BKASH_SECRET, JSON.stringify(body));
    if (!safeEqual(signature.toLowerCase(), expected)) return { ok: false, reason: 'signature mismatch' };
    return { ok: true, providerRef: String(body.paymentID ?? body.trxId ?? '') };
  },
};

const nagadAdapter: Adapter = {
  init: (env, ref, amount, input) => ({
    provider: 'nagad',
    status: 'pending',
    redirectUrl: `${env.NAGAD_SANDBOX_URL}/check-out?tran_id=${encodeURIComponent(ref)}&amount=${amount}&return_url=${encodeURIComponent(input.returnUrl ?? env.CLIENT_URL)}`,
    instructions: 'You will be redirected to the Nagad sandbox to complete payment.',
    providerRef: ref,
  }),
  verify: (env, signature, body, amount) => {
    if (!env.NAGAD_SALT) return { ok: false, reason: 'nagad not configured' };
    if (!signature) return { ok: false, reason: 'missing X-Nagad-Signature' };
    const payload = `${String(body.tran_id ?? body.paymentID ?? '')}${amount ?? body.amount ?? ''}`;
    const expected = hmacHex(env.NAGAD_SALT, payload);
    if (!safeEqual(signature.toLowerCase(), expected)) return { ok: false, reason: 'signature mismatch' };
    return { ok: true, providerRef: String(body.tran_id ?? body.paymentID ?? '') };
  },
};

const sslcommerzAdapter: Adapter = {
  init: (env, ref, amount, input) => ({
    provider: 'sslcommerz',
    status: 'pending',
    redirectUrl: `${env.SSLCOMMERZ_SANDBOX_URL}?sessionkey=${encodeURIComponent(ref)}&amount=${amount}&currency=BDT&success_url=${encodeURIComponent(input.returnUrl ?? `${env.CLIENT_URL}/payments/status`)}`,
    instructions: 'You will be redirected to the SSLCommerz sandbox to complete payment.',
    providerRef: ref,
  }),
  verify: (env, signature, body, amount) => {
    if (!env.SSLCOMMERZ_SALT || !env.SSLCOMMERZ_STORE_ID) return { ok: false, reason: 'sslcommerz not configured' };
    if (!signature) return { ok: false, reason: 'missing X-SSLC-Signature' };
    const payload = `${env.SSLCOMMERZ_STORE_ID}${amount ?? body.amount}${String(body.status ?? 'VALID')}${env.SSLCOMMERZ_SALT}`;
    const expected = hmacHex(env.SSLCOMMERZ_SALT, payload);
    if (!safeEqual(signature.toLowerCase(), expected)) return { ok: false, reason: 'signature mismatch' };
    return { ok: true, providerRef: String(body.val_id ?? body.tran_id ?? '') };
  },
};

const ADAPTERS: Record<PaymentProvider, Adapter> = {
  cash: cashAdapter,
  bkash: bkashAdapter,
  nagad: nagadAdapter,
  sslcommerz: sslcommerzAdapter,
};

/** Load appointment fee + owner for payment init (404 when unknown). */
async function loadPaymentTarget(
  env: Env,
  appointmentId: string,
): Promise<{ fee: number; ownerId: string; code: string }> {
  const appt = await awaitOk<{ fee: number; code: string; patient: { owner_id: string } | null } | null>(
    getSupabaseAdmin(env)
      .from('appointments')
      .select('fee, code, patient:patients(owner_id)')
      .eq('id', appointmentId)
      .maybeSingle(),
  );
  if (!appt || !appt.patient) throw ApiError.notFound();
  return { fee: Number(appt.fee), ownerId: appt.patient.owner_id, code: appt.code };
}

async function setAppointmentPayment(env: Env, appointmentId: string, status: string, method: string): Promise<void> {
  const { error } = await getSupabaseAdmin(env)
    .from('appointments')
    .update({ payment_status: status, payment_method: method })
    .eq('id', appointmentId);
  if (error) throw ApiError.upstream('errors.upstream', error.message);
}

/**
 * POST /payments/init — create (or reuse) the pending payment row and return
 * provider-specific instructions/redirect.
 */
export async function initPayment(env: Env, logger: Logger, input: InitInput): Promise<InitResult> {
  const target = await loadPaymentTarget(env, input.appointmentId);
  const adapter = ADAPTERS[input.provider];

  const existing = await awaitOk<Array<{ id: string; provider_ref: string | null }>>(
    getSupabaseAdmin(env)
      .from('payments')
      .select('id, provider_ref')
      .eq('appointment_id', input.appointmentId)
      .eq('method', input.provider)
      .in('status', ['unpaid', 'failed'])
      .limit(1),
  );

  const providerRef =
    existing[0]?.provider_ref ?? `${input.provider}_${Date.now()}_${input.appointmentId.slice(0, 8)}`;

  if (!existing[0]) {
    const { error } = await getSupabaseAdmin(env).from('payments').insert({
      appointment_id: input.appointmentId,
      amount: target.fee,
      method: input.provider,
      provider_ref: providerRef,
      status: 'unpaid',
    });
    if (error) throw ApiError.upstream('errors.upstream', error.message);
    if (input.provider === 'cash') {
      await getSupabaseAdmin(env).from('payments').update({ status: 'pay_at_counter', receipt_number: `RCPT-${Date.now()}` }).eq('appointment_id', input.appointmentId).eq('method', 'cash');
    }
  }

  const result = adapter.init(env, providerRef, target.fee, input);
  logger.info({ appointmentId: input.appointmentId, provider: input.provider, providerRef }, 'payment init');

  // Cash = pay at counter: reflect immediately on the appointment.
  if (input.provider === 'cash') {
    await setAppointmentPayment(env, input.appointmentId, 'pay_at_counter', 'cash');
    await notify(env, logger, {
      userId: target.ownerId,
      title: `Payment due for ${target.code}`,
      body: `${COUNTER_MSG} Fee: BDT ${target.fee.toFixed(2)}`,
    });
  }
  return result;
}

export async function refundPayment(env: Env, appointmentId: string, providerRef?: string): Promise<{ id: string; status: string }> {
  const admin = getSupabaseAdmin(env);
  const query = admin.from('payments').update({ status: 'refunded' }).eq('appointment_id', appointmentId).in('status', ['paid', 'pay_at_counter']).select('id, status');
  const { data, error } = providerRef ? await query.eq('provider_ref', providerRef) : await query;
  if (error) throw ApiError.upstream('errors.upstream', error.message);
  const row = data?.[0];
  if (!row) throw ApiError.notFound();
  await setAppointmentPayment(env, appointmentId, 'refunded', 'refund');
  return row;
}

/** POST /payments/webhook — verify provider signature, settle payment, notify.
 * Body must include provider, appointmentId, amount (BDT), plus provider fields.
 */
export async function handleWebhook(
  env: Env,
  logger: Logger,
  provider: PaymentProvider,
  signature: string | undefined,
  body: Record<string, unknown>,
): Promise<WebhookVerification> {
  const adapter = ADAPTERS[provider];
  if (provider === 'cash') return { ok: false, reason: 'cash has no webhook' };

  const amount = Number(body.amount ?? NaN);
  const check = adapter.verify(env, signature, body, Number.isFinite(amount) ? amount : undefined);
  if (!check.ok) {
    logger.warn({ provider, reason: check.reason }, 'payment webhook rejected');
    return check;
  }

  const appointmentId = String(body.appointmentId ?? '');
  const target = await loadPaymentTarget(env, appointmentId);
  if (Number.isFinite(amount) && Math.abs(amount - target.fee) > 0.009) {
    logger.warn({ provider, appointmentId, receivedAmount: amount, expectedAmount: target.fee }, 'payment amount mismatch rejected');
    return { ok: false, reason: 'amount mismatch' };
  }
  const payment = await awaitOk<Array<{ id: string; appointment_id: string; status: string }>>(
    getSupabaseAdmin(env)
      .from('payments')
      .select('id, appointment_id, status')
      .eq('appointment_id', appointmentId)
      .eq('method', provider)
      .limit(1),
  );
  const row = payment[0];
  if (!row) return { ok: false, reason: 'payment not found' };
  if (row.status === 'paid') return { ok: true, providerRef: check.providerRef, appointmentId: row.appointment_id };
  if (row.status === 'refunded') return { ok: false, reason: 'payment refunded' };

  const { error } = await getSupabaseAdmin(env)
    .from('payments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      provider_ref: String(check.providerRef ?? body.val_id ?? body.trxId ?? ''),
      raw: body,
    })
    .eq('id', row.id);
  if (error) throw ApiError.upstream('errors.upstream', error.message);

  await setAppointmentPayment(env, row.appointment_id, 'paid', provider);

  await notify(env, logger, {
    userId: target.ownerId,
    title: `Payment received for ${target.code}`,
    body: `Your ${provider} payment was received. Fee: BDT ${amount.toFixed(2)}`,
  });
  logger.info({ provider, appointmentId: row.appointment_id, providerRef: check.providerRef }, 'payment settled');
  return { ok: true, providerRef: check.providerRef, appointmentId: row.appointment_id };
}

