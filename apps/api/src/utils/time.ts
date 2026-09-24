/**
 * Asia/Dhaka time helpers. Bangladesh has no DST, so the offset is a fixed
 * +06:00 — appointment dates/times are stored as Dhaka wall-clock and are
 * converted to UTC instants here for comparisons and cron windows.
 */
export const DHAKA_OFFSET = '+06:00';

/** Dhaka wall-clock instant for an appointment date (YYYY-MM-DD) + slot (HH:MM[:SS]). */
export function apptInstant(apptDate: string, slotTime: string): Date {
  const time = slotTime.length === 5 ? `${slotTime}:00` : slotTime;
  return new Date(`${apptDate}T${time}${DHAKA_OFFSET}`);
}

/** YYYY-MM-DD for an instant in Asia/Dhaka. */
export function dhakaDateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Localized (English) Dhaka formatting for PDFs. */
export function formatDhaka(d: Date, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', ...opts }).format(d);
}

/** Human slot label like "Tue, 24 Sep 2026 · 10:30" (Dhaka). */
export function formatSlot(apptDate: string, slotTime: string): string {
  return `${formatDhaka(apptInstant(apptDate, slotTime), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })} · ${slotTime.length === 5 ? slotTime : slotTime.slice(0, 5)}`;
}
