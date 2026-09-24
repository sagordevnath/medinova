import type { Env } from '../config/env.js';

/**
 * OpenAPI 3.1 document served at /docs (Swagger UI) and /docs.json (raw).
 * Hand-written to stay dependency-light (no decorators/reflection).
 */
export const openApiDoc = {
  openapi: '3.1.0',
  info: {
    title: 'MediNova API',
    version: '4.0.0',
    description:
      'Multi-branch hospital platform API. Responses use `{ data }` envelopes; errors `{ error: <i18n key> }`. ' +
      'Auth: `Authorization: Bearer <supabase access token>`.',
  },
  servers: [
    { url: '/api/v1', description: 'Versioned API' },
    { url: '/v1', description: 'Legacy alias (catalog + booking)' },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'string' }, details: {} }, required: ['error'] },
      Health: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          service: { type: 'string' },
          timezone: { type: 'string' },
          currency: { type: 'string' },
          time: { type: 'string', format: 'date-time' },
        },
      },
      TriageResult: {
        type: 'object',
        properties: {
          department: { type: 'string' },
          medicine_type_suggestion: { type: 'string', enum: ['allopathic', 'homeopathic'] },
          urgency: { type: 'string', enum: ['routine', 'soon', 'emergency'] },
          reasoning_short: { type: 'string' },
          disclaimer: { type: 'string' },
        },
        required: ['department', 'medicine_type_suggestion', 'urgency', 'reasoning_short', 'disclaimer'],
      },
      PaymentInit: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['cash', 'bkash', 'nagad', 'sslcommerz'] },
          status: { type: 'string', enum: ['pay_at_counter', 'pending', 'paid'] },
          redirectUrl: { type: ['string', 'null'], format: 'uri' },
          instructions: { type: 'string' },
          providerRef: { type: 'string' },
        },
      },
    },
    responses: {
      Unauthorized: { description: '401 invalid/missing JWT' },
      Forbidden: { description: '403 wrong role' },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/health': {
      get: { tags: ['system'], summary: 'Liveness/health check', security: [], responses: { '200': { description: 'OK' } } },
    },
    '/branches': { get: { tags: ['catalog'], summary: 'List active branches', security: [], responses: { '200': { description: 'OK' } } } },
    '/departments': { get: { tags: ['catalog'], summary: 'List departments (?medicineType=)', security: [], responses: { '200': { description: 'OK' } } } },
    '/doctors': { get: { tags: ['catalog'], summary: 'List doctors with fees (?branchId=&medicineType=)', security: [], responses: { '200': { description: 'OK' } } } },
    '/doctors/{id}/slots': {
      get: {
        tags: ['catalog'],
        summary: 'Available slots for doctor@branch on date',
        security: [],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'branchId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/appointments': {
      post: {
        tags: ['booking'],
        summary: 'Book an appointment (atomic SLOT_TAKEN check)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['patientId', 'doctorBranchId', 'apptDate', 'slotStart', 'visitType'],
                properties: {
                  patientId: { type: 'string', format: 'uuid' },
                  doctorBranchId: { type: 'string', format: 'uuid' },
                  apptDate: { type: 'string', format: 'date' },
                  slotStart: { type: 'string', example: '10:30:00' },
                  visitType: { type: 'string', enum: ['new', 'followup', 'telemedicine'] },
                  symptoms: { type: 'string', maxLength: 1000 },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Created' }, '409': { description: 'Slot taken' } },
      },
    },
    '/appointments/{id}/confirm': {
      post: {
        tags: ['appointments'],
        summary: 'Staff confirms a pending appointment',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Confirmed' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' } },
      },
    },
    '/appointments/{id}/cancel': {
      post: {
        tags: ['appointments'],
        summary: 'Cancel (patient within CANCEL_WINDOW_HOURS, or staff); frees slot + notifies',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string', maxLength: 300 } } } } } },
        responses: { '200': { description: 'Cancelled' }, '403': { $ref: '#/components/responses/Forbidden' } },
      },
    },
    '/appointments/{id}/reschedule': {
      post: {
        tags: ['appointments'],
        summary: 'Move to a new slot (books new, then releases old)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['apptDate', 'slotStart'],
                properties: { apptDate: { type: 'string', format: 'date' }, slotStart: { type: 'string', example: '11:00:00' }, doctorBranchId: { type: 'string', format: 'uuid' } },
              },
            },
          },
        },
        responses: { '201': { description: 'Rescheduled' }, '409': { description: 'Slot taken / final state' } },
      },
    },
    '/appointments/{id}/check-in': {
      post: {
        tags: ['appointments'],
        summary: 'Check in via slip QR payload; sets queue number',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['qr'], properties: { qr: { type: 'string' } } } } } },
        responses: { '200': { description: 'Checked in with queue number' }, '400': { description: 'Invalid/expired QR' } },
      },
    },
    '/appointments/{id}/slip.pdf': {
      get: {
        tags: ['appointments'],
        summary: 'Download slip PDF (branch address, doctor, fee, queue no, scannable QR)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } } },
      },
    },
    '/prescriptions/{appointmentId}/pdf': {
      post: {
        tags: ['prescriptions'],
        summary: 'Build prescription PDF + upload to Storage; returns public URL',
        parameters: [{ name: 'appointmentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: '{ pdfUrl, prescriptionId }' }, '404': { description: 'No prescription yet' } },
      },
    },
    '/payments/init': {
      post: {
        tags: ['payments'],
        summary: 'Start payment (cash = counter; others = sandbox redirect)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['appointmentId'],
                properties: {
                  appointmentId: { type: 'string', format: 'uuid' },
                  provider: { type: 'string', enum: ['cash', 'bkash', 'nagad', 'sslcommerz'], default: 'cash' },
                  returnUrl: { type: 'string', format: 'uri' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Init result' } },
      },
    },
    '/payments/webhook': {
      post: {
        tags: ['payments'],
        summary: 'Gateway callback (HMAC signature verified per provider)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['provider', 'appointmentId', 'amount'],
                properties: { provider: { type: 'string', enum: ['bkash', 'nagad', 'sslcommerz'] }, appointmentId: { type: 'string', format: 'uuid' }, amount: { type: 'number' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Settled' }, '401': { description: 'Bad signature' } },
      },
    },
    '/ai/triage': {
      post: {
        tags: ['ai'],
        summary: 'Symptom text → department + urgency (rate-limited; raw text never stored)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['symptoms'],
                properties: { symptoms: { type: 'string', minLength: 3, maxLength: 2000 }, appointmentId: { type: 'string', format: 'uuid' }, lang: { type: 'string', enum: ['en', 'bn'] } },
              },
            },
          },
        },
        responses: { '200': { description: 'Triage suggestion' } },
      },
    },
    '/notify/test': {
      post: {
        tags: ['notifications'],
        summary: 'Staff-only test: in-app row + Resend email + SMS stub',
        responses: { '200': { description: 'Per-channel results' }, '403': { $ref: '#/components/responses/Forbidden' } },
      },
    },
    '/admin/doctors': {
      post: { tags: ['admin'], summary: 'Create doctor + auth user (super_admin)', responses: { '201': { description: '{ doctorId, userId, slug }' }, '403': { $ref: '#/components/responses/Forbidden' } } },
    },
    '/admin/branches': {
      post: { tags: ['admin'], summary: 'Create branch (super_admin)', responses: { '201': { description: '{ id, slug }' }, '403': { $ref: '#/components/responses/Forbidden' } } },
    },
    '/admin/doctor-branches/{id}/fees': {
      patch: {
        tags: ['admin'],
        summary: 'Patch posting fees (super_admin; branch_admin scoped to own branch)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Updated fees' }, '403': { $ref: '#/components/responses/Forbidden' } },
      },
    },


  },
} as const;

/** Swagger UI options incl. resolved server URL for try-outs. */
export function swaggerOptions(env: Env) {
  return {
    customSiteTitle: 'MediNova API Docs',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list' as const,
      tryItOutEnabled: true,
      servers: [{ url: env.PUBLIC_API_URL.replace(/\/$/, '') + '/api/v1' }],
    },
  };
}
