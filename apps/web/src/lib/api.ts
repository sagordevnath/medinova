export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

/**
 * Error carrying the API's i18n key (e.g. `errors.slotTaken`) so pages can
 * render a translated message instead of a raw status string.
 */
export class ApiRequestError extends Error {
  readonly key?: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, key?: string, details?: unknown) {
    super(key ?? `API ${status}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.key = key;
    this.details = details;
  }
}

export async function apiGet<T>(path: string, token?: string | null): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; details?: unknown } | null;
    throw new ApiRequestError(res.status, body?.error, body?.details);
  }
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as { error?: string; details?: unknown } | null;
    throw new ApiRequestError(res.status, parsed?.error, parsed?.details);
  }
  return (await res.json()) as T;
}

export async function apiPatch<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as { error?: string; details?: unknown } | null;
    throw new ApiRequestError(res.status, parsed?.error, parsed?.details);
  }
  return (await res.json()) as T;
}

/** A line item on an invoice (Module 16). */
export interface InvoiceItemDto {
  id: string;
  description: string;
  kind: string;
  unitPrice: number;
  quantity: number;
  discount: number;
  lineTotal: number;
}

/** An invoice. Money is returned in taka; the API stores paisa. */
export interface InvoiceDto {
  id: string;
  number: string;
  status: string;
  patientId: string;
  appointmentId: string | null;
  branchId: string | null;
  issuedAt: string;
  dueAt: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
  notes: string | null;
  items: InvoiceItemDto[];
}

/**
 * Statement of account, as returned by
 * GET /v1/invoices/patients/:patientId/statement. Note the snake_case
 * `issued_at`: this response is not run through the row mapper.
 */
export interface StatementDto {
  patientId: string;
  invoices: Array<{
    id: string;
    number: string;
    issued_at: string;
    status: string;
    total: number;
    paid: number;
    balance: number;
  }>;
  totalOutstanding: number;
  currency: string;
}

/** A purchasable subscription tier, as returned by GET /v1/plans. */
export interface PlanDto {
  code: string;
  name: string;
  tagline: string | null;
  /** Taka per month. The API converts from the paisa stored in Postgres. */
  monthlyTaka: number;
  yearlyTaka: number;
  /** null means unlimited — the database encodes -1. */
  branchLimit: number | null;
  doctorLimit: number | null;
  staffSeatLimit: number | null;
  monthlyAppointmentLimit: number | null;
  features: string[];
}

/** Vital signs recorded during a consultation. */
export interface VitalsDto {
  id: string;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  pulse: number | null;
  temperatureC: number | null;
  weightKg: number | null;
  heightCm: number | null;
  spo2: number | null;
  respiratoryRate: number | null;
  notes: string | null;
  recordedAt: string;
}

/** A clinical encounter (Module 17). */
export interface EncounterDto {
  id: string;
  orgId: string;
  branchId: string | null;
  appointmentId: string | null;
  doctorId: string | null;
  patientId: string;
  visitType: string;
  status: string;
  chiefComplaint: string | null;
  historyOfPresentIllness: string | null;
  examination: string | null;
  diagnosisCode: string | null;
  diagnosisText: string | null;
  plan: string | null;
  advice: string | null;
  startedAt: string;
  endedAt: string | null;
  vitals: VitalsDto | null;
}

/** Shape returned by GET /v1/me. */
export interface MeDto {
  userId: string;
  profile: {
    fullName: string | null;
    phone: string | null;
    role: string;
    branchId: string | null;
    avatarUrl: string | null;
    preferredLang: string;
  } | null;
  patients: {
    id: string;
    fullName: string;
    dob: string | null;
    gender: string | null;
    phone: string | null;
    bloodGroup: string | null;
    address: string | null;
    allergies: string | null;
    chronicConditions: string | null;
  }[];
}

/** Shape returned by GET /v1/doctors/:id/slots. */
export interface SlotDto {
  slotStart: string;
  slotEnd: string;
  isAvailable: boolean;
}

export function formatBdt(amount: number, locale: string): string {
  const loc = locale === 'bn' ? 'bn-BD' : 'en-BD';
  const digits = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }).format(amount);
  return `৳${digits}`;
}

/**
 * Taka -> paisa. The database stores money as an integer paisa count (module
 * 16); the API speaks taka. Forgetting this makes a BDT 1000 bill read as
 * BDT 10 in the UI, which is the most dangerous class of bug in a clinic.
 */
export const toPaisa = (taka: number): number => Math.round(taka * 100);

/** Paisa -> taka. Inverse of {@link toPaisa}. */
export const fromPaisa = (paisa: unknown): number => Math.round(Number(paisa ?? 0)) / 100;
