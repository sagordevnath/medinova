import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
describe('API smoke',()=>{it('serves health and security headers',async()=>{const {app}=buildApp();const res=await request(app).get('/health').set('Origin',process.env.CLIENT_URL??'http://localhost:5173');expect(res.status).toBe(200);expect(res.headers['x-content-type-options']).toBe('nosniff');expect(res.body.ok).toBe(true)});it('rejects an unauthenticated staff action',async()=>{const {app}=buildApp();const res=await request(app).get('/v1/audit-probe');expect([401,404]).toContain(res.status)})});
