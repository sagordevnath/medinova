import type { MedicineType } from './constants.js';
import type { APPOINTMENT_STATUSES, PAY_STATUSES, VISIT_TYPES } from './constants.js';

export type VisitType = (typeof VISIT_TYPES)[number];
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export type PayStatus = (typeof PAY_STATUSES)[number];

export interface Branch {
  id: string;
  name: string;
  nameBn: string;
  slug: string;
  address: string;
  addressBn: string;
  city: string;
  lat: number;
  lng: number;
  phone: string;
  emergencyPhone: string;
  email: string | null;
  openingHours: Record<string, string>;
  facilities: string[];
  photoUrl: string | null;
  isActive: boolean;
}

export interface Profile {
  id: string;
  fullName: string | null;
  phone: string | null;
  role: string;
  branchId: string | null;
  avatarUrl: string | null;
  preferredLang: 'en' | 'bn';
}

export interface Department {
  id: string;
  name: string;
  nameBn: string;
  medicineType: MedicineType;
  icon: string | null;
  description: string | null;
  isActive: boolean;
}

export interface Doctor {
  id: string;
  profileId: string | null;
  departmentId: string | null;
  medicineType: MedicineType;
  fullName: string;
  fullNameBn: string;
  slug: string;
  bio: string | null;
  qualifications: string[];
  specialties: string[];
  experienceYears: number;
  registrationNo: string | null;
  photoUrl: string | null;
  languages: string[];
  ratingAvg: number;
  ratingCount: number;
  telemedicineEnabled: boolean;
  isActive: boolean;
}

export interface DoctorBranch {
  id: string;
  doctorId: string;
  branchId: string;
  consultationFee: number;
  followupFee: number;
  followupValidDays: number;
  telemedicineFee: number | null;
  roomNo: string | null;
}

export interface DoctorBranchFee {
  doctorId: string;
  branchId: string;
  newFeeBdt: number;
  followUpFeeBdt: number;
  followUpValidityDays: number;
  teleFeeBdt: number | null;
}

export interface DoctorSchedule {
  id: string;
  doctorBranchId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  maxPerSlot: number;
  isActive: boolean;
}

export interface Patient {
  id: string;
  ownerId: string;
  fullName: string;
  dob: string | null;
  gender: 'male' | 'female' | 'other' | null;
  phone: string | null;
  bloodGroup: string | null;
  address: string | null;
  allergies: string | null;
  chronicConditions: string | null;
}

export interface Appointment {
  id: string;
  code: string;
  patientId: string;
  doctorId: string;
  branchId: string;
  doctorBranchId: string;
  apptDate: string;
  slotStart: string;
  slotEnd: string;
  visitType: VisitType;
  status: AppointmentStatus;
  fee: number;
  paymentStatus: PayStatus;
  paymentMethod: string | null;
  symptoms: string | null;
  queueNo: number | null;
}

export interface Service {
  id: string;
  branchId: string;
  name: string;
  nameBn: string;
  category: 'lab' | 'imaging' | 'package' | 'ambulance';
  price: number;
  description: string | null;
}

