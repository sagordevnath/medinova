/**
 * Supabase database types (Module 2 schema).
 * Regenerate against a live project with:
 *   npx supabase gen types typescript --project-id <ref> --schema public > packages/shared/src/database.types.ts
 * The checked-in copy keeps the monorepo type-safe without a live project.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type MedicineTypeEnum = 'allopathic' | 'homeopathic';
export type UserRoleEnum = 'patient' | 'doctor' | 'receptionist' | 'branch_admin' | 'super_admin';
export type ApptStatusEnum =
  | 'pending'
  | 'confirmed'
  | 'checked_in'
  | 'in_consultation'
  | 'completed'
  | 'cancelled'
  | 'no_show';
export type VisitTypeEnum = 'new' | 'followup' | 'telemedicine';
export type PayStatusEnum = 'unpaid' | 'pay_at_counter' | 'paid' | 'refunded' | 'failed';

type UpdateOf<K extends keyof PublicTables> = Partial<PublicTables[K]['Insert']>;

interface PublicTables {
  branches: {
    Row: {
      id: string;
      name: string;
      name_bn: string;
      slug: string;
      address: string;
      address_bn: string;
      city: string;
      lat: number;
      lng: number;
      phone: string;
      emergency_phone: string;
      email: string | null;
      opening_hours: Json;
      facilities: string[];
      photo_url: string | null;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      name: string;
      name_bn: string;
      slug: string;
      address: string;
      address_bn: string;
      city: string;
      lat: number;
      lng: number;
      phone: string;
      emergency_phone: string;
      email?: string | null;
      opening_hours?: Json;
      facilities?: string[];
      photo_url?: string | null;
      is_active?: boolean;
    };
  };
  profiles: {
    Row: {
      id: string;
      full_name: string | null;
      phone: string | null;
      role: UserRoleEnum;
      branch_id: string | null;
      avatar_url: string | null;
      preferred_lang: string;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id: string;
      full_name?: string | null;
      phone?: string | null;
      role?: UserRoleEnum;
      branch_id?: string | null;
      avatar_url?: string | null;
      preferred_lang?: string;
    };
  };
  departments: {
    Row: {
      id: string;
      name: string;
      name_bn: string;
      medicine_type: MedicineTypeEnum;
      icon: string | null;
      description: string | null;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      name: string;
      name_bn: string;
      medicine_type: MedicineTypeEnum;
      icon?: string | null;
      description?: string | null;
      is_active?: boolean;
    };
  };
  doctors: {
    Row: {
      id: string;
      profile_id: string | null;
      department_id: string | null;
      medicine_type: MedicineTypeEnum;
      full_name: string;
      full_name_bn: string;
      slug: string;
      bio: string | null;
      qualifications: string[];
      specialties: string[];
      experience_years: number;
      registration_no: string | null;
      photo_url: string | null;
      languages: string[];
      rating_avg: number;
      rating_count: number;
      telemedicine_enabled: boolean;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      profile_id?: string | null;
      department_id?: string | null;
      medicine_type: MedicineTypeEnum;
      full_name: string;
      full_name_bn: string;
      slug: string;
      bio?: string | null;
      qualifications?: string[];
      specialties?: string[];
      experience_years?: number;
      registration_no?: string | null;
      photo_url?: string | null;
      languages?: string[];
      rating_avg?: number;
      rating_count?: number;
      telemedicine_enabled?: boolean;
      is_active?: boolean;
    };
  };
  doctor_branches: {
    Row: {
      id: string;
      doctor_id: string;
      branch_id: string;
      consultation_fee: number;
      followup_fee: number;
      followup_valid_days: number;
      telemedicine_fee: number | null;
      room_no: string | null;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      doctor_id: string;
      branch_id: string;
      consultation_fee: number;
      followup_fee: number;
      followup_valid_days?: number;
      telemedicine_fee?: number | null;
      room_no?: string | null;
    };
  };
  doctor_schedules: {
    Row: {
      id: string;
      doctor_branch_id: string;
      weekday: number;
      start_time: string;
      end_time: string;
      slot_minutes: number;
      max_per_slot: number;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      doctor_branch_id: string;
      weekday: number;
      start_time: string;
      end_time: string;
      slot_minutes?: number;
      max_per_slot?: number;
      is_active?: boolean;
    };
  };
  doctor_time_off: {
    Row: {
      id: string;
      doctor_id: string;
      branch_id: string | null;
      start_at: string;
      end_at: string;
      reason: string | null;
      created_at: string;
    };
    Insert: {
      id?: string;
      doctor_id: string;
      branch_id?: string | null;
      start_at: string;
      end_at: string;
      reason?: string | null;
    };
  };
  patients: {
    Row: {
      id: string;
      owner_id: string;
      full_name: string;
      dob: string | null;
      gender: string | null;
      phone: string | null;
      blood_group: string | null;
      address: string | null;
      allergies: string | null;
      chronic_conditions: string | null;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      owner_id: string;
      full_name: string;
      dob?: string | null;
      gender?: string | null;
      phone?: string | null;
      blood_group?: string | null;
      address?: string | null;
      allergies?: string | null;
      chronic_conditions?: string | null;
    };
  };
  appointments: {
    Row: {
      id: string;
      code: string;
      patient_id: string;
      doctor_id: string;
      branch_id: string;
      doctor_branch_id: string;
      appt_date: string;
      slot_start: string;
      slot_end: string;
      visit_type: VisitTypeEnum;
      status: ApptStatusEnum;
      fee: number;
      payment_status: PayStatusEnum;
      payment_method: string | null;
      symptoms: string | null;
      ai_triage: Json | null;
      queue_no: number | null;
      checked_in_at: string | null;
      cancelled_reason: string | null;
      created_by: string | null;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      code: string;
      patient_id: string;
      doctor_id: string;
      branch_id: string;
      doctor_branch_id: string;
      appt_date: string;
      slot_start: string;
      slot_end: string;
      visit_type: VisitTypeEnum;
      status?: ApptStatusEnum;
      fee: number;
      payment_status?: PayStatusEnum;
      payment_method?: string | null;
      symptoms?: string | null;
      ai_triage?: Json | null;
      queue_no?: number | null;
      checked_in_at?: string | null;
      cancelled_reason?: string | null;
      created_by?: string | null;
    };
  };
  payments: {
    Row: {
      id: string;
      appointment_id: string;
      amount: number;
      method: string;
      provider_ref: string | null;
      status: PayStatusEnum;
      paid_at: string | null;
      raw: Json | null;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      appointment_id: string;
      amount: number;
      method: string;
      provider_ref?: string | null;
      status?: PayStatusEnum;
      paid_at?: string | null;
      raw?: Json | null;
    };
  };
  prescriptions: {
    Row: {
      id: string;
      appointment_id: string;
      doctor_id: string;
      patient_id: string;
      diagnosis: string | null;
      medicines: Json;
      advice: string | null;
      next_visit_date: string | null;
      pdf_url: string | null;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      appointment_id: string;
      doctor_id: string;
      patient_id: string;
      diagnosis?: string | null;
      medicines?: Json;
      advice?: string | null;
      next_visit_date?: string | null;
      pdf_url?: string | null;
    };
  };
  medical_records: {
    Row: {
      id: string;
      patient_id: string;
      uploaded_by: string | null;
      title: string;
      type: string;
      file_path: string;
      created_at: string;
    };
    Insert: {
      id?: string;
      patient_id: string;
      uploaded_by?: string | null;
      title: string;
      type: string;
      file_path: string;
    };
  };
  reviews: {
    Row: {
      id: string;
      appointment_id: string;
      doctor_id: string;
      patient_id: string;
      rating: number;
      comment: string | null;
      is_approved: boolean;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      appointment_id: string;
      doctor_id: string;
      patient_id: string;
      rating: number;
      comment?: string | null;
      is_approved?: boolean;
    };
  };
  notifications: {
    Row: {
      id: string;
      user_id: string;
      channel: string;
      title: string;
      body: string | null;
      read_at: string | null;
      sent_at: string | null;
      created_at: string;
    };
    Insert: {
      id?: string;
      user_id: string;
      channel: string;
      title: string;
      body?: string | null;
      read_at?: string | null;
      sent_at?: string | null;
    };
  };
  services: {
    Row: {
      id: string;
      branch_id: string;
      name: string;
      name_bn: string;
      category: string;
      price: number;
      description: string | null;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      branch_id: string;
      name: string;
      name_bn: string;
      category: string;
      price: number;
      description?: string | null;
    };
  };
  announcements: {
    Row: {
      id: string;
      title: string;
      body: string | null;
      branch_id: string | null;
      starts_at: string | null;
      ends_at: string | null;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      title: string;
      body?: string | null;
      branch_id?: string | null;
      starts_at?: string | null;
      ends_at?: string | null;
    };
  };
  audit_logs: {
    Row: {
      id: string;
      actor_id: string | null;
      action: string;
      entity: string;
      entity_id: string | null;
      meta: Json | null;
      created_at: string;
    };
    Insert: {
      id?: string;
      actor_id?: string | null;
      action: string;
      entity: string;
      entity_id?: string | null;
      meta?: Json | null;
    };
  };
}

export interface Database {
  public: {
    Tables: {
      [K in keyof PublicTables]: {
        Row: PublicTables[K]['Row'];
        Insert: PublicTables[K]['Insert'];
        Update: UpdateOf<K>;
      };
    };
    Enums: {
      medicine_type: MedicineTypeEnum;
      user_role: UserRoleEnum;
      appt_status: ApptStatusEnum;
      visit_type: VisitTypeEnum;
      pay_status: PayStatusEnum;
    };
    Functions: {
      get_available_slots: {
        Args: { p_doctor_branch_id: string; p_date: string };
        Returns: { slot_start: string; slot_end: string; is_available: boolean }[];
      };
      book_appointment: {
        Args: {
          p_patient_id: string;
          p_doctor_branch_id: string;
          p_date: string;
          p_slot_start: string;
          p_visit_type: VisitTypeEnum;
          p_symptoms?: string | null;
          p_created_by?: string | null;
        };
        Returns: PublicTables['appointments']['Row'];
      };
      next_queue_number: {
        Args: { p_doctor_branch_id: string; p_date: string };
        Returns: number;
      };
    };
  };
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T];

export type BranchRow = Tables<'branches'>;
export type DoctorRow = Tables<'doctors'>;
export type DoctorBranchRow = Tables<'doctor_branches'>;
export type DoctorScheduleRow = Tables<'doctor_schedules'>;
export type AppointmentRow = Tables<'appointments'>;
export type PatientRow = Tables<'patients'>;
export type ServiceRow = Tables<'services'>;
export type AvailableSlot = Database['public']['Functions']['get_available_slots']['Returns'][number];

