import type { Role } from '@medinova/shared';
import type { Env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
import { getSupabaseAdmin, awaitOk } from '../utils/supabase.js';
import type { AuthContext } from '../express.js';
import type { SlipData } from './pdf.service.js';

type Row = Record<string, unknown>;

export const STAFF_ROLES: Role[] = ['receptionist', 'branch_admin', 'super_admin'];

const APPT_SELECT = [
  'id, code, patient_id, doctor_id, branch_id, doctor_branch_id, appt_date, slot_start, slot_end,',
  'visit_type, status, fee, payment_status, payment_method, symptoms, queue_no, checked_in_at,',
  'cancelled_reason, created_by, created_at,',
  'patient:patients(id, full_name, phone, gender, blood_group, owner_id),',
  'doctor:doctors(id, full_name, specialties, profile_id, is_active),',
  'branch:branches(id, name, address, city, phone, emergency_phone, slug)',
].join(' ');

export interface AppointmentRow extends Row {
  id: string;
  code: string;
  appt_date: string;
  slot_start: string;
  slot_end: string;
  status: string;
  fee: number;
  payment_status: string;
  queue_no: number | null;
  patient: (Row & { owner_id: string; full_name: string }) | null;
  doctor: (Row & { profile_id: string | null }) | null;
  branch: Row | null;
}

/** Load an appointment with embedded patient/doctor/branch (throws 404 if missing). */
export async function loadAppointment(env: Env, id: string): Promise<AppointmentRow> {
  const row = await awaitOk<AppointmentRow | null>(
    getSupabaseAdmin(env).from('appointments').select(APPT_SELECT).eq('id', id).maybeSingle(),
  );
  if (!row) throw ApiError.notFound('errors.notFound');
  return row;
}

/**
 * Role rules for appointment actions:
 * - staff (receptionist/branch_admin/super_admin): any action on any appointment;
 * - the appointment's own doctor: clinical actions (check-in, confirm, prescription);
 * - the owning patient: cancel/reschedule within the allowed window, slip download.
 * Branch scoping: branch_admin may only touch appointments of their own branch.
 */
export function assertCanAct(auth: AuthContext, appt: AppointmentRow, allow: Array<'staff' | 'doctor' | 'patient'>): void {
  const role = auth.role;
  if (!role) throw ApiError.forbidden();

  if (allow.includes('staff') && STAFF_ROLES.includes(role)) {
    if (role === 'branch_admin') {
      const branchOk = appt.branch && auth.branchId === appt.branch.id;
      if (!branchOk) throw ApiError.forbidden();
    }
    return;
  }
  if (allow.includes('doctor') && role === 'doctor' && appt.doctor?.profile_id === auth.userId) return;
  if (allow.includes('patient') && appt.patient?.owner_id === auth.userId) return;

  throw ApiError.forbidden();
}

/** True when the caller is acting as staff (not the patient/doctor owner). */
export function isStaff(auth: AuthContext): boolean {
  return !!auth.role && STAFF_ROLES.includes(auth.role);
}

export function toSlipData(appt: AppointmentRow): SlipData {
  if (!appt.patient || !appt.doctor || !appt.branch) {
    throw ApiError.upstream('errors.upstream', 'appointment missing related rows');
  }
  return {
    appointment: {
      id: appt.id,
      code: appt.code,
      apptDate: appt.appt_date,
      slotStart: appt.slot_start,
      slotEnd: appt.slot_end,
      visitType: String(appt.visit_type),
      status: String(appt.status),
      fee: Number(appt.fee),
      paymentStatus: String(appt.payment_status),
      queueNo: appt.queue_no == null ? null : Number(appt.queue_no),
      symptoms: (appt.symptoms as string | null) ?? null,
    },
    patient: {
      fullName: appt.patient.full_name,
      phone: (appt.patient.phone as string | null) ?? null,
      gender: (appt.patient.gender as string | null) ?? null,
      bloodGroup: (appt.patient.blood_group as string | null) ?? null,
    },
    doctor: {
      fullName: (appt.doctor.full_name as string) ?? '—',
      specialties: (appt.doctor.specialties as string[] | null) ?? null,
    },
    branch: {
      name: String(appt.branch.name),
      address: String(appt.branch.address),
      city: String(appt.branch.city),
      phone: String(appt.branch.phone),
      emergencyPhone: String(appt.branch.emergency_phone),
    },
  };
}

/** Update appointment status + optional fields; throws 502 on failure. */
export async function updateAppointment(
  env: Env,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await getSupabaseAdmin(env).from('appointments').update(patch).eq('id', id);
  if (error) throw ApiError.upstream('errors.upstream', error.message);
}

/** Active statuses that occupy a slot (mirrors appointments_no_double_book_idx). */
export function isSlotOccupying(status: string): boolean {
  return status !== 'cancelled' && status !== 'no_show';
}
