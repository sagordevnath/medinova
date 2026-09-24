export const APP_TIMEZONE = 'Asia/Dhaka' as const;
export const APP_CURRENCY = 'BDT' as const;
export const CURRENCY_SYMBOL = '৳' as const;
export const DEFAULT_LOCALE = 'en' as const;
export const SUPPORTED_LOCALES = ['en', 'bn'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const MEDICINE_TYPES = ['allopathic', 'homeopathic'] as const;
export type MedicineType = (typeof MEDICINE_TYPES)[number];

export const ROLES = [
  'patient',
  'doctor',
  'receptionist',
  'branch_admin',
  'super_admin',
] as const;
export type Role = (typeof ROLES)[number];

export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'checked_in',
  'in_consultation',
  'completed',
  'cancelled',
  'no_show',
] as const;

export const VISIT_TYPES = ['new', 'followup', 'telemedicine'] as const;

export const PAY_STATUSES = ['unpaid', 'pay_at_counter', 'paid', 'refunded', 'failed'] as const;
export type PayStatus = (typeof PAY_STATUSES)[number];

export const PAYMENT_METHODS = ['cash', 'bkash', 'nagad', 'card'] as const;

export const BRANCH_STATUS = ['active', 'inactive'] as const;

/** Default dashboard route per role after login (Module 3 role-based redirects). */
export const ROLE_DASHBOARD: Record<Role, string> = {
  patient: '/account',
  doctor: '/doctor',
  receptionist: '/reception',
  branch_admin: '/branch-admin',
  super_admin: '/admin',
};

