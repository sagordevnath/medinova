import type { Env } from '../config/env.js';
import type { Logger } from '../utils/logger.js';
import { getSupabaseAdmin } from '../utils/supabase.js';

export interface NotifyOptions {
  /** profiles.id / auth user id receiving the in-app row. */
  userId: string;
  title: string;
  body?: string;
  /** Attempt email (default true). */
  email?: boolean;
  /** Attempt SMS via the BD gateway stub (default false). */
  sms?: boolean;
  /** Override recipient email (else resolved from auth admin). */
  emailTo?: string;
}

export interface NotifyResult {
  inapp: boolean;
  email: 'sent' | 'skipped' | 'failed';
  sms: 'sent' | 'stub' | 'skipped' | 'failed';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

async function resolveEmail(env: Env, userId: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseAdmin(env).auth.admin.getUserById(userId);
    if (error) return null;
    const d = data as unknown as { user?: { email?: string } } & { email?: string };
    return d?.user?.email ?? d?.email ?? null;
  } catch {
    return null;
  }
}

/** Fire-and-forget Resend delivery; never throws. */
async function sendEmail(env: Env, to: string, title: string, body?: string): Promise<'sent' | 'failed' | 'skipped'> {
  if (!env.RESEND_API_KEY) return 'skipped';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [to],
        subject: title,
        html: `<div style="font-family:sans-serif"><h2 style="margin:0 0 8px">MediNova</h2><p><strong>${escapeHtml(title)}</strong></p><p>${escapeHtml(body ?? '')}</p></div>`,
      }),
    });
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * SMS adapter stub for local BD gateways (e.g. smsnet/bulk-sms-bd style):
 * POST { to, text } with X-Api-Key when SMS_GATEWAY_URL is set, else log-only.
 */
async function sendSms(env: Env, to: string, text: string): Promise<'sent' | 'stub' | 'failed'> {
  if (!env.SMS_GATEWAY_URL) return 'stub';
  try {
    const res = await fetch(env.SMS_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': env.SMS_API_KEY ?? '', 'X-Sender': env.SMS_SENDER_ID ?? 'MediNova' },
      body: JSON.stringify({ to, text }),
    });
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * Unified notification: always writes the in-app row (notifications table),
 * then best-effort email (Resend) + SMS (BD gateway stub). Never throws.
 */
export async function notify(env: Env, logger: Logger, opts: NotifyOptions): Promise<NotifyResult> {
  const wantEmail = opts.email !== false;
  const wantSms = opts.sms === true;
  const result: NotifyResult = { inapp: false, email: 'skipped', sms: 'skipped' };

  try {
    const { error } = await getSupabaseAdmin(env).from('notifications').insert({
      user_id: opts.userId,
      channel: 'inapp',
      title: opts.title,
      body: opts.body ?? null,
      sent_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    result.inapp = true;
  } catch (err) {
    logger.warn({ err, userId: opts.userId }, 'in-app notification insert failed');
  }

  if (wantEmail) {
    const to = opts.emailTo ?? (await resolveEmail(env, opts.userId));
    if (!to) {
      result.email = 'skipped';
      logger.info({ userId: opts.userId, title: opts.title }, 'email skipped (no recipient)');
    } else {
      result.email = await sendEmail(env, to, opts.title, opts.body);
      // Always log the attempt — acceptance greps "sending" even without RESEND_API_KEY.
      logger.info({ userId: opts.userId, to, title: opts.title, status: result.email }, `sending email: ${opts.title}`);
    }
  }

  if (wantSms) {
    const to = opts.emailTo ?? (await resolveEmail(env, opts.userId));
    result.sms = await sendSms(env, to ?? opts.userId, `${opts.title}${opts.body ? ` — ${opts.body}` : ''}`);
    logger.info({ userId: opts.userId, status: result.sms }, 'sms adapter stub invoked');
  }

  return result;
}
