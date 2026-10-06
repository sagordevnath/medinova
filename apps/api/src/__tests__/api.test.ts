import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Request } from 'express';
import { buildApp } from '../app.js';
import { assertOwnsOrg } from '../middleware/auth.js';
import { hasServiceRoleAccess } from '../utils/supabase.js';

describe('hasServiceRoleAccess', () => {
  // The anon key is a real 200+ char JWT, so a length-based sanity check
  // accepts it. These tests lock in the role-claim check that actually tells
  // the two apart, which is what stops staff routes silently reading no rows.
  const jwtWithRole = (role: string) => {
    const payload = Buffer.from(JSON.stringify({ iss: 'supabase', role })).toString('base64url');
    return `header.${payload}.signature`;
  };

  it('accepts a service_role JWT', () => {
    expect(hasServiceRoleAccess(jwtWithRole('service_role'))).toBe(true);
  });

  it('accepts the new sb_secret_ format', () => {
    expect(hasServiceRoleAccess('sb_secret_abcdefghijklmnop')).toBe(true);
  });

  it('rejects the anon key, which is a valid JWT but subject to RLS', () => {
    expect(hasServiceRoleAccess(jwtWithRole('anon'))).toBe(false);
  });

  it('rejects the browser publishable key', () => {
    expect(hasServiceRoleAccess('sb_publishable_abcdefghijklmnop')).toBe(false);
  });

  it('rejects an authenticated user JWT', () => {
    expect(hasServiceRoleAccess(jwtWithRole('authenticated'))).toBe(false);
  });

  it('rejects placeholders, empty and missing values', () => {
    expect(hasServiceRoleAccess(undefined)).toBe(false);
    expect(hasServiceRoleAccess('')).toBe(false);
    expect(hasServiceRoleAccess('dev-service-key')).toBe(false);
    expect(hasServiceRoleAccess('<your-key>')).toBe(false);
  });
});

const ctx = (role: string, orgId: string | null) =>
  ({ auth: { userId: 'u1', role, profileLoaded: true, orgId } }) as unknown as Request;

describe('assertOwnsOrg', () => {
  // The service-role key bypasses RLS, so every tenant write has to prove it
  // belongs to the caller. Without this guard an org_admin could create
  // branches and staff inside any other clinic.
  it('lets super_admin act on any organisation', () => {
    expect(() => assertOwnsOrg(ctx('super_admin', null), 'org-a')).not.toThrow();
  });

  it('lets an org_admin write inside its own organisation', () => {
    expect(() => assertOwnsOrg(ctx('org_admin', 'org-a'), 'org-a')).not.toThrow();
  });

  it('blocks an org_admin from writing into another tenant', () => {
    expect(() => assertOwnsOrg(ctx('org_admin', 'org-a'), 'org-b')).toThrow();
  });

  it('blocks an org_admin with no organisation rather than defaulting to allow', () => {
    expect(() => assertOwnsOrg(ctx('org_admin', null), 'org-a')).toThrow();
  });

  it('blocks when the target row has no organisation', () => {
    expect(() => assertOwnsOrg(ctx('org_admin', 'org-a'), null)).toThrow();
    expect(() => assertOwnsOrg(ctx('org_admin', 'org-a'), undefined)).toThrow();
  });

  it('blocks every other role outright', () => {
    expect(() => assertOwnsOrg(ctx('doctor', 'org-a'), 'org-a')).toThrow();
    expect(() => assertOwnsOrg(ctx('receptionist', 'org-a'), 'org-a')).toThrow();
    expect(() => assertOwnsOrg(ctx('patient', 'org-a'), 'org-a')).toThrow();
  });

  it('rejects an unauthenticated request', () => {
    expect(() => assertOwnsOrg({} as Request, 'org-a')).toThrow();
  });
});
describe('API smoke',()=>{it('serves health and security headers',async()=>{const {app}=buildApp();const res=await request(app).get('/health').set('Origin',process.env.CLIENT_URL??'http://localhost:5173');expect(res.status).toBe(200);expect(res.headers['x-content-type-options']).toBe('nosniff');expect(res.body.ok).toBe(true)});it('rejects an unauthenticated staff action',async()=>{const {app}=buildApp();const res=await request(app).get('/v1/audit-probe');expect([401,404]).toContain(res.status)})});
