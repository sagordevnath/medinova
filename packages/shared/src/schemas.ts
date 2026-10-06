import { z } from 'zod';
import { MEDICINE_TYPES, PAYMENT_METHODS, PAY_STATUSES, ROLES, VISIT_TYPES } from './constants.js';

export const localeSchema = z.enum(['en', 'bn']);
export const medicineTypeSchema = z.enum(MEDICINE_TYPES);
export const roleSchema = z.enum(ROLES);
export const visitTypeSchema = z.enum(VISIT_TYPES);
export const appointmentStatusSchema = z.enum([
  'pending',
  'confirmed',
  'checked_in',
  'in_consultation',
  'completed',
  'cancelled',
  'no_show',
]);
export const payStatusSchema = z.enum(PAY_STATUSES);
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

export const moneySchema = z.number().min(0).max(1000000);

export const branchSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z.string().min(2).max(80),
  name: z.string().min(2).max(120),
  nameBn: z.string().min(2).max(120),
  city: z.string().min(2).max(80),
  address: z.string().min(4).max(300),
  addressBn: z.string().min(4).max(300),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  phone: z.string().min(6).max(20),
  // Short-form national emergency numbers are valid here (999, 112, 16263),
  // so this must stay looser than the branch phone number.
  emergencyPhone: z.string().min(3).max(20),
  email: z.string().email().nullable().optional(),
  openingHours: z.record(z.string()).default({}),
  facilities: z.array(z.string()).default([]),
  photoUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().default(true),
});

export const departmentSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2).max(120),
  nameBn: z.string().min(2).max(120),
  medicineType: medicineTypeSchema,
  icon: z.string().max(60).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  isActive: z.boolean().default(true),
});

export const doctorSchema = z.object({
  id: z.string().uuid().optional(),
  profileId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  medicineType: medicineTypeSchema,
  fullName: z.string().min(2).max(120),
  fullNameBn: z.string().min(2).max(120),
  slug: z.string().min(2).max(120),
  bio: z.string().max(2000).nullable().optional(),
  qualifications: z.array(z.string()).default([]),
  specialties: z.array(z.string()).default([]),
  experienceYears: z.number().int().min(0).max(80).default(0),
  registrationNo: z.string().max(40).nullable().optional(),
  photoUrl: z.string().url().nullable().optional(),
  languages: z.array(z.string()).default(['English', 'Bangla']),
  telemedicineEnabled: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const doctorBranchSchema = z.object({
  id: z.string().uuid().optional(),
  doctorId: z.string().uuid(),
  branchId: z.string().uuid(),
  consultationFee: moneySchema,
  followupFee: moneySchema,
  followupValidDays: z.number().int().min(0).max(365).default(14),
  telemedicineFee: moneySchema.nullable().optional(),
  roomNo: z.string().max(20).nullable().optional(),
});

export const doctorBranchFeeSchema = z.object({
  doctorId: z.string().uuid(),
  branchId: z.string().uuid(),
  newFeeBdt: z.number().int().min(0).max(100000),
  followUpFeeBdt: z.number().int().min(0).max(100000),
  followUpValidityDays: z.number().int().min(0).max(365),
  teleFeeBdt: z.number().int().min(0).max(100000).nullable().optional(),
});

export const doctorScheduleSchema = z.object({
  id: z.string().uuid().optional(),
  doctorBranchId: z.string().uuid(),
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  slotMinutes: z.number().int().min(1).max(480).default(15),
  maxPerSlot: z.number().int().min(1).max(50).default(1),
  isActive: z.boolean().default(true),
});

export const doctorTimeOffSchema = z.object({
  id: z.string().uuid().optional(),
  doctorId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  reason: z.string().max(300).nullable().optional(),
});

export const patientSchema = z.object({
  id: z.string().uuid().optional(),
  ownerId: z.string().uuid(),
  fullName: z.string().min(2).max(120),
  dob: z.string().date().nullable().optional(),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  phone: z.string().min(6).max(20).nullable().optional(),
  bloodGroup: z.string().max(5).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  allergies: z.string().max(500).nullable().optional(),
  chronicConditions: z.string().max(500).nullable().optional(),
});

// --- Module 17: clinical encounters, vitals, structured history ---------------

export const encounterVisitTypeSchema = z.enum(['new', 'followup', 'telemedicine', 'walk_in']);
export const encounterStatusSchema = z.enum(['open', 'completed', 'cancelled']);
export const historyKindSchema = z.enum(['medical', 'surgical', 'family', 'immunization', 'obstetric', 'allergy']);

export const vitalsSchema = z.object({
  bpSystolic: z.number().int().min(40).max(300).nullable().optional(),
  bpDiastolic: z.number().int().min(20).max(200).nullable().optional(),
  pulse: z.number().int().min(20).max(250).nullable().optional(),
  temperatureC: z.number().min(25).max(45).nullable().optional(),
  weightKg: z.number().positive().max(500).nullable().optional(),
  heightCm: z.number().positive().max(260).nullable().optional(),
  spo2: z.number().int().min(50).max(100).nullable().optional(),
  respiratoryRate: z.number().int().min(5).max(80).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const encounterCreateSchema = z
  .object({
    patientId: z.string().uuid(),
    appointmentId: z.string().uuid().nullable().optional(),
    doctorId: z.string().uuid().nullable().optional(),
    branchId: z.string().uuid().nullable().optional(),
    visitType: encounterVisitTypeSchema.default('new'),
    status: encounterStatusSchema.default('open'),
    chiefComplaint: z.string().max(500).nullable().optional(),
    historyOfPresentIllness: z.string().max(4000).nullable().optional(),
    examination: z.string().max(4000).nullable().optional(),
    diagnosisCode: z.string().max(16).nullable().optional(),
    diagnosisText: z.string().max(500).nullable().optional(),
    plan: z.string().max(4000).nullable().optional(),
    advice: z.string().max(2000).nullable().optional(),
    vitals: vitalsSchema.partial().optional(),
  })
  .refine((v) => !v.appointmentId || !!v.doctorId, {
    message: 'doctorId is required when linking an encounter to an appointment',
    path: ['doctorId'],
  });

export const encounterUpdateSchema = z.object({
  status: encounterStatusSchema.optional(),
  chiefComplaint: z.string().max(500).nullable().optional(),
  historyOfPresentIllness: z.string().max(4000).nullable().optional(),
  examination: z.string().max(4000).nullable().optional(),
  diagnosisCode: z.string().max(16).nullable().optional(),
  diagnosisText: z.string().max(500).nullable().optional(),
  plan: z.string().max(4000).nullable().optional(),
  advice: z.string().max(2000).nullable().optional(),
  vitals: vitalsSchema.partial().optional(),
});

export const medicalHistorySchema = z.object({
  patientId: z.string().uuid(),
  kind: historyKindSchema,
  condition: z.string().min(1).max(200),
  onsetDate: z.string().date().nullable().optional(),
  resolvedDate: z.string().date().nullable().optional(),
  code: z.string().max(16).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const bookSlotSchema = z.object({
  patientId: z.string().uuid(),
  doctorBranchId: z.string().uuid(),
  apptDate: z.string().date(),
  slotStart: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  visitType: visitTypeSchema,
  symptoms: z.string().max(1000).nullable().optional(),
});

export const appointmentCreateSchema = z.object({
  branchId: z.string().uuid(),
  doctorId: z.string().uuid(),
  departmentId: z.string().uuid().nullable().optional(),
  visitType: visitTypeSchema,
  scheduledAt: z.string().datetime({ offset: true }),
  notes: z.string().max(1000).optional(),
});

export const paymentSchema = z.object({
  appointmentId: z.string().uuid(),
  amount: moneySchema,
  method: paymentMethodSchema,
  providerRef: z.string().max(120).nullable().optional(),
});

export const reviewSchema = z.object({
  appointmentId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).nullable().optional(),
});

export const serviceSchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().uuid(),
  name: z.string().min(2).max(120),
  nameBn: z.string().min(2).max(120),
  category: z.enum(['lab', 'imaging', 'package', 'ambulance']),
  price: moneySchema,
  description: z.string().max(1000).nullable().optional(),
});

export const slotSchema = z.object({
  slotStart: z.string(),
  slotEnd: z.string(),
  isAvailable: z.boolean(),
});

export type BranchInput = z.infer<typeof branchSchema>;
export type DepartmentInput = z.infer<typeof departmentSchema>;
export type DoctorInput = z.infer<typeof doctorSchema>;
export type DoctorBranchInput = z.infer<typeof doctorBranchSchema>;
export type DoctorBranchFeeInput = z.infer<typeof doctorBranchFeeSchema>;
export type DoctorScheduleInput = z.infer<typeof doctorScheduleSchema>;
export type PatientInput = z.infer<typeof patientSchema>;
export type BookSlotInput = z.infer<typeof bookSlotSchema>;
export type AppointmentCreateInput = z.infer<typeof appointmentCreateSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type ReviewInput = z.infer<typeof reviewSchema>;
export type ServiceInput = z.infer<typeof serviceSchema>;
export type SlotDto = z.infer<typeof slotSchema>;

