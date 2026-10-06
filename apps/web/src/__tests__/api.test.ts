import { describe, expect, it } from 'vitest';
import { formatBdt, fromPaisa, toPaisa } from '@/lib/api';
import { errorI18nKey } from '@/lib/errorKeys';
import { mapAuthError } from '@/providers/AuthProvider';

describe('currency units', () => {
  // Migration 0016 moved payments.amount from numeric taka to bigint paisa,
  // while the API keeps speaking taka. Every reader/writer has to convert, and
  // a missed conversion silently reports a BDT 1000 bill as BDT 10.
  it('converts taka to paisa without losing precision', () => {
    expect(toPaisa(1000)).toBe(100000);
    expect(toPaisa(0)).toBe(0);
    expect(toPaisa(1200.5)).toBe(120050);
  });

  it('rounds to the nearest paisa rather than truncating', () => {
    // 33.335 taka is 3333.5 paisa; truncation would lose half a paisa per line.
    expect(toPaisa(33.335)).toBe(3334);
  });

  it('converts paisa back to taka', () => {
    expect(fromPaisa(100000)).toBe(1000);
    expect(fromPaisa(120050)).toBe(1200.5);
  });

  it('treats a missing or malformed amount as zero instead of NaN', () => {
    expect(fromPaisa(null)).toBe(0);
    expect(fromPaisa(undefined)).toBe(0);
    expect(fromPaisa('120050')).toBe(1200.5);
  });

  it('round-trips a realistic consultation fee', () => {
    expect(fromPaisa(toPaisa(800))).toBe(800);
  });
});

describe('mapAuthError',()=>{
  it('maps Supabase auth failures to specific i18n keys',()=>{
    expect(mapAuthError(new Error('Invalid login credentials'))).toBe('errors.authInvalidCredentials');
    expect(mapAuthError(new Error('Email not confirmed'))).toBe('errors.authEmailUnconfirmed');
  });
  it('detects a disabled email provider instead of falling back to generic',()=>{
    expect(mapAuthError(new Error('Email logins are disabled'))).toBe('errors.authEmailProviderDisabled');
    expect(mapAuthError(new Error('email_provider_disabled'))).toBe('errors.authEmailProviderDisabled');
  });
  it('falls back to a generic key for unknown errors',()=>{
    expect(mapAuthError(new Error('something unexpected'))).toBe('errors.authGeneric');
    expect(mapAuthError(undefined)).toBe('errors.authGeneric');
  });
});
describe('errorI18nKey',()=>{
  it('converts dotted API keys into namespaced i18n keys',()=>{
    expect(errorI18nKey('errors.authInvalidCredentials')).toBe('errors:authInvalidCredentials');
    expect(errorI18nKey('errors.slotTaken')).toBe('errors:slotTaken');
  });
  it('leaves already-namespaced keys untouched',()=>{
    expect(errorI18nKey('errors:authGeneric')).toBe('errors:authGeneric');
  });
  it('falls back when no key is provided',()=>{
    expect(errorI18nKey()).toBe('errors:authGeneric');
    expect(errorI18nKey(null,'common:error')).toBe('common:error');
  });
  it('passes through non-errors keys',()=>{
    expect(errorI18nKey('booking:failed')).toBe('booking:failed');
  });
});

describe('formatters',()=>{it('formats BDT without fractional noise',()=>{expect(formatBdt(1200,'en')).toBe('৳1,200');expect(formatBdt(1200,'bn')).toContain('৳')})});
