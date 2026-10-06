import { z } from 'zod';

/** Parse an env-var boolean: unset â†’ default; 'false|0|no|off' â†’ false. */
const envBool = (def: boolean) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? def : !['false', '0', 'no', 'off'].includes(String(v).toLowerCase())),
    z.boolean(),
  );

/**
 * `.env` files always define a key, often as an empty string. Treat `''` as
 * undefined so `.optional()` behaves as expected instead of failing URL
 * validation (e.g. `SMS_GATEWAY_URL=` in a local dev file).
 */
const emptyToUndefined = (schema: z.ZodTypeAny) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  SUPABASE_URL: z.string().url().default('http://localhost:54321'),
  SUPABASE_ANON_KEY: z.string().default('dev-anon-key'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default('dev-service-key'),
  /** HS256 secret for Supabase access tokens (Supabase project JWT secret). */
  JWT_SECRET: z.string().min(16).default('dev-only-change-me-min-32-chars'),
  /** Dedicated secret for appointment check-in QR tokens (defaults to JWT_SECRET). */
  CHECKIN_SECRET: emptyToUndefined(z.string().optional()),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Rate limits (per window, per IP).
  RATE_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_MAX: z.coerce.number().default(120),
  RATE_BOOKING_MAX: z.coerce.number().default(30),
  RATE_STRICT_MAX: z.coerce.number().default(20),
  RATE_AI_MAX: z.coerce.number().default(6),

  // Domain rules.
  CANCEL_WINDOW_HOURS: z.coerce.number().min(0).max(168).default(2),
  NO_SHOW_GRACE_MINUTES: z.coerce.number().default(30),
  UNPAID_HOLD_HOURS: z.coerce.number().default(24),

  // Cron.
  CRON_ENABLED: envBool(true),

  // Notifications.
  RESEND_API_KEY: emptyToUndefined(z.string().optional()),
  EMAIL_FROM: z.string().default('MediNova <onboarding@resend.dev>'),
  /** BD SMS gateway stub (local/dev): POST {to, text} with X-Api-Key. */
  SMS_GATEWAY_URL: emptyToUndefined(z.string().url().optional()),
  SMS_API_KEY: emptyToUndefined(z.string().optional()),
  SMS_SENDER_ID: emptyToUndefined(z.string().optional()),

  // AI triage.
  AI_PROVIDER: z.enum(['heuristic', 'gemini', 'claude']).default('heuristic'),
  GEMINI_API_KEY: emptyToUndefined(z.string().optional()),
  GEMINI_MODEL: z.string().default('gemini-1.5-flash'),
  CLAUDE_API_KEY: emptyToUndefined(z.string().optional()),
  CLAUDE_MODEL: z.string().default('claude-3-5-sonnet-latest'),

  // Storage.
  PRESCRIPTIONS_BUCKET: z.string().default('prescriptions'),

  // Payment adapters (sandbox configs; cash works with none of these).
  TURNSTILE_SECRET_KEY: emptyToUndefined(z.string().optional()),
  TURNSTILE_SITE_KEY: emptyToUndefined(z.string().optional()),
  TURNSTILE_VERIFY_URL: z.string().url().default('https://challenges.cloudflare.com/turnstile/v0/siteverify'),
  PAYMENT_SANDBOX: envBool(true),
  BKASH_SANDBOX_URL: z.string().url().default('https://sandbox.bka.sh/v1.2.0-beta/checkout/pay'),
  BKASH_APP_KEY: emptyToUndefined(z.string().optional()),
  BKASH_SECRET: emptyToUndefined(z.string().optional()),
  NAGAD_SANDBOX_URL: z.string().url().default('https://sandbox.mynagad.com:8443/remote-payment-gateway-1.0/api/dfs'),
  NAGAD_MERCHANT_ID: emptyToUndefined(z.string().optional()),
  NAGAD_SALT: emptyToUndefined(z.string().optional()),
  SSLCOMMERZ_SANDBOX_URL: z.string().url().default('https://sandbox.sslcommerz.com/gwprocess/v4/api.php'),
  SSLCOMMERZ_STORE_ID: emptyToUndefined(z.string().optional()),
  SSLCOMMERZ_SALT: emptyToUndefined(z.string().optional()),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid API env:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid API environment variables');
  }
  cached = parsed.data;
  return cached;
}

/** HS256 secret used to verify Supabase access tokens. */
export function jwtSecret(env: Env): string {
  return env.JWT_SECRET;
}

/**
 * True when JWT_SECRET is still the placeholder default. Verification against
 * it rejects every real Supabase token with a bare 401, which is very hard to
 * diagnose from the browser, so callers can warn instead of failing silently.
 */
export function isPlaceholderJwtSecret(env: Env): boolean {
  return env.JWT_SECRET.startsWith('dev-only-change-me');
}

/** Secret used to sign/verify appointment check-in QR payloads. */
export function checkinSecret(env: Env): string {
  return env.CHECKIN_SECRET ?? env.JWT_SECRET;
}
