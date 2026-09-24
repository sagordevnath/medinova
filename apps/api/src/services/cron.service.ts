import cron, { type ScheduledTask } from 'node-cron';
import type { Env } from '../config/env.js';
import type { Logger } from '../utils/logger.js';
import { getSupabaseAdmin } from '../utils/supabase.js';
import { apptInstant, dhakaDateKey } from '../utils/time.js';
import { notify } from './notification.service.js';

interface ReminderRow {
  id: string;
  code: string;
  appt_date: string;
  slot_start: string;
  status: string;
  patient: { owner_id: string; full_name: string } | null;
  doctor: { full_name: string } | null;
  branch: { name: string } | null;
}

const REMINDER_SELECT =
  'id, code, appt_date, slot_start, status, patient:patients(owner_id, full_name), doctor:doctors(full_name), branch:branches(name)';

/** Idempotency: skip when this reminder window already sent (title marker). */
async function alreadySent(env: Env, userId: string, marker: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin(env)
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .eq('channel', 'inapp')
    .like('title', `%${marker}%`)
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

/**
 * Appointment reminders 24h and 2h before the slot (Asia/Dhaka).
 * Runs every 15 minutes; each reminder is idempotent per appointment+window.
 */
export async function sendUpcomingReminders(env: Env, logger: Logger, now = new Date()): Promise<number> {
  const today = dhakaDateKey(now);
  const tomorrowDate = dhakaDateKey(new Date(now.getTime() + 24 * 3600_000));
  const { data, error } = await getSupabaseAdmin(env)
    .from('appointments')
    .select(REMINDER_SELECT)
    .in('status', ['pending', 'confirmed'])
    .in('appt_date', [...new Set([today, tomorrowDate])])
    .order('slot_start');
  if (error) {
    logger.error({ err: error.message }, 'reminder query failed');
    return 0;
  }

  let sent = 0;
  for (const row of (data ?? []) as unknown as ReminderRow[]) {
    if (!row.patient) continue;
    const start = apptInstant(row.appt_date, row.slot_start);
    const hoursUntil = (start.getTime() - now.getTime()) / 3600_000;

    for (const [windowH, marker] of [
      [24, 'reminder-24h'],
      [2, 'reminder-2h'],
    ] as const) {
      // Fire inside a ±30 min tolerance around the window boundary.
      if (Math.abs(hoursUntil - windowH) > 0.5) continue;
      if (await alreadySent(env, row.patient.owner_id, `${marker}:${row.code}`)) continue;

      const when = `${row.appt_date} ${row.slot_start.slice(0, 5)} (Asia/Dhaka)`;
      await notify(env, logger, {
        userId: row.patient.owner_id,
        title: `Appointment reminder [${marker}:${row.code}]`,
        body: `Your appointment with ${row.doctor?.full_name ?? 'your doctor'} at ${row.branch?.name ?? 'MediNova'} is in ${windowH}h — ${when}. Code ${row.code}.`,
      });
      logger.info({ appt: row.code, window: windowH, to: row.patient.owner_id }, `sending reminder (${windowH}h)`);
      sent += 1;
    }
  }
  if (sent === 0) logger.debug('reminders: nothing due');
  return sent;
}

/** Auto-mark no_show when the slot ended > grace minutes ago and not checked in. */
export async function markNoShows(env: Env, logger: Logger, now = new Date()): Promise<number> {
  const graceMs = env.NO_SHOW_GRACE_MINUTES * 60_000;
  const today = dhakaDateKey(now);
  const yesterday = dhakaDateKey(new Date(now.getTime() - 86_400_000));
  const { data, error } = await getSupabaseAdmin(env)
    .from('appointments')
    .select('id, code, appt_date, slot_end, checked_in_at')
    .in('status', ['pending', 'confirmed'])
    .in('appt_date', [...new Set([today, yesterday])]);
  if (error) {
    logger.error({ err: error.message }, 'no-show query failed');
    return 0;
  }

  let marked = 0;
  const rows = (data ?? []) as Array<{
    id: string;
    code: string;
    appt_date: string;
    slot_end: string;
    checked_in_at: string | null;
  }>;
  for (const row of rows) {
    if (row.checked_in_at) continue;
    const end = apptInstant(row.appt_date, row.slot_end);
    if (now.getTime() - end.getTime() < graceMs) continue;
    const { error: updErr } = await getSupabaseAdmin(env)
      .from('appointments')
      .update({ status: 'no_show' })
      .eq('id', row.id)
      .in('status', ['pending', 'confirmed']); // race-safe re-check
    if (updErr) logger.error({ err: updErr.message, appt: row.code }, 'no-show update failed');
    else {
      marked += 1;
      logger.info({ appt: row.code }, 'marked no-show');
    }
  }
  return marked;
}

/**
 * Nightly cleanup (03:00 Dhaka): cancel unpaid pending holds older than
 * UNPAID_HOLD_HOURS so their slots free up.
 */
export async function cleanupUnpaidHolds(env: Env, logger: Logger, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - env.UNPAID_HOLD_HOURS * 3600_000).toISOString();
  const { data, error } = await getSupabaseAdmin(env)
    .from('appointments')
    .select('id, code, created_at, patient:patients(owner_id)')
    .eq('status', 'pending')
    .eq('payment_status', 'unpaid')
    .lt('created_at', cutoff)
    .limit(200);
  if (error) {
    logger.error({ err: error.message }, 'cleanup query failed');
    return 0;
  }

  let cancelled = 0;
  const rows = (data ?? []) as unknown as Array<{ id: string; code: string; patient: { owner_id: string } | null }>;
  for (const row of rows) {
    const { error: updErr } = await getSupabaseAdmin(env)
      .from('appointments')
      .update({ status: 'cancelled', cancelled_reason: 'Unpaid hold expired' })
      .eq('id', row.id)
      .eq('status', 'pending');
    if (updErr) {
      logger.error({ err: updErr.message, appt: row.code }, 'cleanup cancel failed');
      continue;
    }
    cancelled += 1;
    logger.info({ appt: row.code }, 'cancelled unpaid hold');
    if (row.patient) {
      await notify(env, logger, {
        userId: row.patient.owner_id,
        title: `Booking released [${row.code}]`,
        body: 'Your appointment was not paid within the hold window and the slot was released. You can book again anytime.',
      });
    }
  }
  return cancelled;
}

/** Register all cron jobs (Asia/Dhaka semantics via UTC-shifted schedules). */
export function startCronJobs(env: Env, logger: Logger): ScheduledTask[] {
  const tasks: ScheduledTask[] = [];

  // Reminders: every 15 min.
  tasks.push(
    cron.schedule('*/15 * * * *', () => {
      void sendUpcomingReminders(env, logger).catch((err) => logger.error({ err }, 'reminder job crashed'));
    }),
  );

  // No-show sweep: every 5 minutes.
  tasks.push(
    cron.schedule('*/5 * * * *', () => {
      void markNoShows(env, logger).catch((err) => logger.error({ err }, 'no-show job crashed'));
    }),
  );

  // Nightly cleanup at 03:00 Asia/Dhaka = 21:00 UTC (Bangladesh has no DST).
  tasks.push(
    cron.schedule('0 21 * * *', () => {
      void cleanupUnpaidHolds(env, logger).catch((err) => logger.error({ err }, 'cleanup job crashed'));
    }),
  );

  logger.info('cron jobs started: reminders */15, no-show */5, cleanup 03:00 Dhaka');
  return tasks;
}

