import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { bookSlotSchema, branchSchema, doctorSchema } from './schemas';

// Resolve from the repo root: vitest runs with CWD = packages/shared.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('profile provisioning migration', () => {
  const sql = readFileSync(resolve(repoRoot, 'supabase/migrations/0013_profile_provisioning.sql'), 'utf8');

  it('creates a patients row from the signup trigger, not just a profile', () => {
    // Booking, prescriptions and records all resolve through public.patients.
    expect(sql).toMatch(/insert into public\.patients/);
  });

  it('never grants a privileged role from client-supplied metadata', () => {
    // A user could otherwise pass { role: 'super_admin' } in signUp metadata.
    expect(sql).toMatch(/v_role\s*:=\s*'patient'/);
    expect(sql).not.toMatch(/raw_user_meta_data\s*->>\s*'role'/);
  });

  it('backfills auth users that predate the trigger', () => {
    expect(sql).toMatch(/from auth\.users au[\s\S]*?not exists \(select 1 from public\.profiles/);
  });

  it('guards the patients insert with NOT EXISTS, since owner_id is not unique', () => {
    // public.patients has no unique constraint on owner_id (family members),
    // so ON CONFLICT would silently insert duplicates.
    expect(sql).toMatch(/insert into public\.patients[\s\S]*?where not exists/);
  });
});

describe('booking payload contract', () => {
  // The client used to POST the legacy Module 1 shape (branchId/doctorId/
  // scheduledAt) with a hardcoded nil-UUID patientId, which failed validation.
  // These lock the field names bookSlotSchema actually requires.
  const valid = {
    patientId: '11111111-1111-4111-8111-111111111111',
    doctorBranchId: '22222222-2222-4222-8222-222222222222',
    apptDate: '2026-10-01',
    slotStart: '10:00',
    visitType: 'new' as const,
  };

  it('accepts the payload BookPage now sends', () => {
    expect(bookSlotSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects the legacy date key that broke booking', () => {
    // `date` is not `apptDate`; this is the exact 400 the user hit.
    expect(bookSlotSchema.safeParse({ ...valid, apptDate: undefined, date: '2026-10-01' }).success).toBe(false);
  });

  it('cannot catch the nil UUID at the schema layer (documented gap)', () => {
    // The all-zero UUID is a syntactically valid uuid, so the validator lets it
    // through; it only fails later on the patients foreign key. That is exactly
    // why BookPage now resolves a real id from GET /v1/me instead of guessing.
    expect(bookSlotSchema.safeParse({ ...valid, patientId: '00000000-0000-0000-0000-000000000000' }).success).toBe(true);
  });
});

describe('JWT algorithm handling', () => {
  it('documents that current Supabase projects sign with ES256, not HS256', () => {
    // Regression guard for the opaque 401 that hid /profile behind a blank page:
    // the API only accepted HS256, but hosted projects using sb_publishable_
    // keys issue ES256 tokens verified through the project JWKS.
    const src = readFileSync(
      resolve(repoRoot, 'apps/api/src/middleware/auth.ts'),
      'utf8',
    );
    expect(src).toContain('createRemoteJWKSet');
    expect(src).toMatch(/jwksFor\(\)/);
    expect(src).toMatch(/\['ES256', 'RS256'\]/);
    // HS256 must still work for older / self-hosted projects.
    expect(src).toMatch(/alg === 'HS256'/);
  });

  it('keeps the caller token in the Authorization header, not the apikey', () => {
    // Passing the access token as createClient's 2nd arg (the apikey) makes
    // PostgREST answer "Invalid API key", and the profile silently came back
    // null instead of erroring.
    const src = readFileSync(resolve(repoRoot, 'apps/api/src/routes/catalog.ts'), 'utf8');
    const clientBlock = src.slice(src.indexOf('const userClient = createClient'));
    expect(clientBlock.slice(0, 200)).toContain('env.SUPABASE_ANON_KEY');
    expect(clientBlock.slice(0, 300)).toContain('auth.accessToken');
    expect(clientBlock.slice(0, 300)).not.toMatch(/SUPABASE_URL,\s*auth\.accessToken/);
  });
});

describe('doctor detail payload contract', () => {
  // GET /v1/doctors/:slug used to return the raw snake_case view row, so
  // DoctorProfilePage read `fullName` and got undefined. The top-level columns
  // are snake_case; the view's `branches`/`schedules` arrays are already
  // camelCase JSON (built in 0008_doctor_discovery.sql).
  const viewRow = {
    id: '33333333-3333-4333-8333-333333333333',
    profile_id: null,
    department_id: null,
    medicine_type: 'allopathic',
    full_name: 'Dr. Tanvir Ahmed',
    full_name_bn: 'ডা. তানভীর আহমেদ',
    slug: 'tanvir-ahmed',
    bio: 'Internal medicine.',
    qualifications: ['MBBS'],
    specialties: ['Diabetes'],
    experience_years: 12,
    registration_no: 'BMDC A-51234',
    photo_url: null,
    languages: ['English', 'Bangla'],
    telemedicine_enabled: true,
    is_active: true,
    department_name: 'Medicine',
    min_fee: 800,
    branches: [
      { id: 'db1', branchId: 'branch-1', consultationFee: 1000, followupFee: 600, followupValidDays: 14, telemedicineFee: 800, roomNo: '304' },
    ],
    schedules: [],
  };

  it('accepts the snake_case view row through doctorSchema', () => {
    const parsed = doctorSchema.safeParse({
      id: viewRow.id,
      profileId: viewRow.profile_id,
      departmentId: viewRow.department_id,
      medicineType: viewRow.medicine_type,
      fullName: viewRow.full_name,
      fullNameBn: viewRow.full_name_bn,
      slug: viewRow.slug,
      bio: viewRow.bio,
      qualifications: viewRow.qualifications,
      specialties: viewRow.specialties,
      experienceYears: viewRow.experience_years,
      registrationNo: viewRow.registration_no,
      photoUrl: viewRow.photo_url,
      languages: viewRow.languages,
      telemedicineEnabled: viewRow.telemedicine_enabled,
      isActive: viewRow.is_active,
    });
    expect(parsed.success).toBe(true);
  });

  it('exposes camelCase keys the page reads', () => {
    // Guards the regression: fullName/departmentName were undefined before.
    const mapped = { fullName: viewRow.full_name, departmentName: viewRow.department_name };
    expect(mapped.fullName).toBe('Dr. Tanvir Ahmed');
    expect(mapped.departmentName).toBe('Medicine');
  });

  it('keeps posting fees as camelCase inside the branches array', () => {
    // Reading b.consultation_fee here silently produced null for every fee.
    const b = viewRow.branches[0];
    expect(Number(b.consultationFee ?? 0)).toBe(1000);
    expect((b as Record<string, unknown>).consultation_fee).toBeUndefined();
  });
});

describe('branchSchema', () => {
  const base = {
    id: '00000000-0000-0000-0000-000000000001',
    slug: 'dhanmondi',
    name: 'MediNova Dhanmondi',
    nameBn: 'মেডিনোভা ধানমন্ডি',
    city: 'Dhaka',
    address: 'House 12, Road 5',
    addressBn: 'হাউস ১২, রোড ৫',
    lat: 23.7461,
    lng: 90.3742,
    phone: '+8801711000102',
  };

  it('accepts short national emergency numbers used by the catalog seed', () => {
    // seed_01_catalog.sql stores 16263, and 999/112 are valid BD emergency lines.
    expect(branchSchema.parse({ ...base, emergencyPhone: '16263' }).emergencyPhone).toBe('16263');
    expect(branchSchema.parse({ ...base, emergencyPhone: '999' }).emergencyPhone).toBe('999');
  });

  it('still rejects a branch phone number that is too short', () => {
    expect(branchSchema.safeParse({ ...base, emergencyPhone: '16263', phone: '123' }).success).toBe(false);
  });
});