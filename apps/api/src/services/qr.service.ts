import { createHmac, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { ApiError } from '../utils/errors.js';

/** Signed check-in payload embedded as QR content on appointment slips. */
export interface CheckInPayload {
  v: 1;
  /** appointment id */
  a: string;
  /** appointment code (human-readable fallback) */
  c: string;
  /** expiry epoch seconds (slot end + grace) */
  exp: number;
}

const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString('base64url');

function hmac(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Sign a check-in payload: `<b64url(json)>.<b64url(hmac)>`. */
export function signCheckIn(payload: CheckInPayload, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(body, secret)}`;
}

/** Verify token integrity + expiry. Throws 400 errors.qrInvalid / errors.qrExpired. */
export function verifyCheckIn(token: string, secret: string, now = Date.now()): CheckInPayload {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) throw ApiError.badRequest('errors.qrInvalid');
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw ApiError.badRequest('errors.qrInvalid');
  }
  let payload: CheckInPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CheckInPayload;
  } catch {
    throw ApiError.badRequest('errors.qrInvalid');
  }
  if (payload?.v !== 1 || !payload.a || !payload.c || typeof payload.exp !== 'number') {
    throw ApiError.badRequest('errors.qrInvalid');
  }
  if (payload.exp * 1000 < now) throw ApiError.badRequest('errors.qrExpired');
  return payload;
}

/** Token for an appointment: valid until 6h after the slot ends. */
export function checkInToken(appointmentId: string, code: string, slotEndMs: number, secret: string): string {
  return signCheckIn(
    { v: 1, a: appointmentId, c: code, exp: Math.floor((slotEndMs + 6 * 3600_000) / 1000) },
    secret,
  );
}

/** Render the token as a scannable QR PNG buffer (error-correction M, ~10cm print). */
export function qrPng(token: string, width = 240): Promise<Buffer> {
  return QRCode.toBuffer(token, { type: 'png', width, margin: 1, errorCorrectionLevel: 'M' });
}
