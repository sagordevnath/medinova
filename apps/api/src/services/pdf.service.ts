import PDFDocument from 'pdfkit';
import type { Env } from '../config/env.js';
import { formatDhaka, formatSlot } from '../utils/time.js';
import { qrPng } from './qr.service.js';

/** Row shapes produced by appointment.service loadAppointmentSlip(). */
export interface SlipData {
  appointment: {
    id: string;
    code: string;
    apptDate: string;
    slotStart: string;
    slotEnd: string;
    visitType: string;
    status: string;
    fee: number;
    paymentStatus: string;
    queueNo: number | null;
    symptoms: string | null;
  };
  patient: { fullName: string; phone: string | null; gender: string | null; bloodGroup: string | null };
  doctor: { fullName: string; specialties: string[] | null };
  branch: { name: string; address: string; city: string; phone: string; emergencyPhone: string };
}

export interface PrescriptionData {
  appointment: SlipData['appointment'];
  patient: SlipData['patient'];
  doctor: SlipData['doctor'];
  branch: SlipData['branch'];
  prescription: {
    diagnosis: string | null;
    medicines: unknown;
    advice: string | null;
    nextVisitDate: string | null;
    createdAt: string;
  };
}

const MARGIN = 48;

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function kv(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number, width = 220): number {
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#64748b').text(label.toUpperCase(), x, y, { width, characterSpacing: 0.5 });
  doc.font('Helvetica').fontSize(11).fillColor('#0f172a').text(value, x, y + 11, { width });
  return y + 30;
}

function header(doc: PDFKit.PDFDocument, title: string): number {
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#0f766e').text('MediNova', MARGIN, MARGIN);
  doc.font('Helvetica').fontSize(9).fillColor('#64748b').text('Multi-branch Hospital & Clinic Platform', MARGIN, MARGIN + 26);
  doc.fontSize(14).fillColor('#0f172a').text(title, MARGIN + 240, MARGIN + 4, { align: 'right', width: 280 });
  doc
    .moveTo(MARGIN, MARGIN + 46)
    .lineTo(doc.page.width - MARGIN, MARGIN + 46)
    .strokeColor('#0f766e')
    .lineWidth(1.5)
    .stroke();
  return MARGIN + 62;
}

function footer(doc: PDFKit.PDFDocument, text: string): void {
  const y = doc.page.height - MARGIN - 14;
  doc.moveTo(MARGIN, y - 8).lineTo(doc.page.width - MARGIN, y - 8).strokeColor('#e2e8f0').lineWidth(1).stroke();
  doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(text, MARGIN, y, {
    width: doc.page.width - MARGIN * 2,
    align: 'left',
  });
}

/**
 * Appointment slip A5: branch address, doctor, fee, queue no + scannable
 * QR carrying the signed check-in payload (POST /appointments/:id/check-in).
 */
export async function buildAppointmentSlip(env: Env, data: SlipData, qrToken: string): Promise<Buffer> {
  void env;
  const doc = new PDFDocument({
    size: 'A5',
    margin: MARGIN,
    info: { Title: `MediNova slip ${data.appointment.code}`, Author: 'MediNova' },
  });
  const qr = await qrPng(qrToken);

  let y = header(doc, 'Appointment Slip');

  y = kv(doc, 'Appointment code', data.appointment.code, MARGIN, y, 200);
  kv(doc, 'Queue no.', data.appointment.queueNo != null ? `#${data.appointment.queueNo}` : '—', MARGIN + 240, y - 30, 120);

  y = kv(doc, 'Date & time (Dhaka)', formatSlot(data.appointment.apptDate, data.appointment.slotStart), MARGIN, y, 340);
  y = kv(doc, 'Patient', `${data.patient.fullName}${data.patient.gender ? ` · ${data.patient.gender}` : ''}`, MARGIN, y, 340);
  y = kv(
    doc,
    'Doctor',
    data.doctor.fullName + (data.doctor.specialties?.length ? ` (${data.doctor.specialties.join(', ')})` : ''),
    MARGIN,
    y,
    340,
  );
  y = kv(doc, 'Visit type', `${data.appointment.visitType}${data.appointment.status !== 'pending' ? ` · ${data.appointment.status}` : ''}`, MARGIN, y, 200);
  kv(doc, 'Fee (BDT)', `${data.appointment.fee.toFixed(2)} · ${data.appointment.paymentStatus}`, MARGIN + 240, y - 30, 140);


  y += 6;
  doc.moveTo(MARGIN, y).lineTo(doc.page.width - MARGIN, y).strokeColor('#e2e8f0').lineWidth(1).stroke();
  y += 12;

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text('Branch', MARGIN, y);
  doc.font('Helvetica').fontSize(10).fillColor('#334155').text(
    `${data.branch.name}\n${data.branch.address}, ${data.branch.city}\nPhone: ${data.branch.phone} · Emergency: ${data.branch.emergencyPhone}`,
    MARGIN,
    y + 14,
    { width: 240, lineGap: 2 },
  );

  const qrX = doc.page.width - MARGIN - 110;
  doc.image(qr, qrX, y - 4, { width: 110 });
  doc.font('Helvetica').fontSize(7).fillColor('#64748b').text('Scan at reception to check in', qrX, y + 110, { width: 110, align: 'center' });

  const when = formatDhaka(new Date(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  footer(doc, `Generated ${when} (Asia/Dhaka) · Keep this slip for your visit · medinova.example`);
  return collect(doc);
}

function asRows(medicines: unknown): string[][] {
  if (!Array.isArray(medicines)) return [];
  return medicines.map((m) => {
    if (m && typeof m === 'object') {
      const o = m as Record<string, unknown>;
      const name = String(o.name ?? o.medicine ?? 'Medicine');
      const notes = [o.dose ?? o.dosage ?? '', o.frequency ?? o.freq ?? '', o.duration ?? '']
        .filter(Boolean)
        .join(', ');
      return [name, notes];
    }
    return [String(m), ''];
  });
}

/** Prescription A5 PDF: letterhead, diagnosis, medicine table, advice. */
export function buildPrescriptionPdf(env: Env, data: PrescriptionData): Promise<Buffer> {
  void env;
  const doc = new PDFDocument({
    size: 'A5',
    margin: MARGIN,
    info: { Title: `MediNova prescription ${data.appointment.code}`, Author: data.doctor.fullName },
  });

  let y = header(doc, 'Prescription');

  y = kv(doc, 'Prescription for', `${data.patient.fullName} · ${data.patient.bloodGroup ?? '—'}`, MARGIN, y, 340);
  y = kv(doc, 'Appointment', `${data.appointment.code} · ${formatSlot(data.appointment.apptDate, data.appointment.slotStart)}`, MARGIN, y, 340);
  y = kv(
    doc,
    'Prescriber',
    `${data.doctor.fullName}${data.doctor.specialties?.length ? ` · ${data.doctor.specialties.join(', ')}` : ''}`,
    MARGIN,
    y,
    340,
  );
  if (data.prescription.diagnosis) y = kv(doc, 'Diagnosis', data.prescription.diagnosis, MARGIN, y, 340);

  y += 4;
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text('Medicines', MARGIN, y);
  y += 18;

  const rows = asRows(data.prescription.medicines);
  if (rows.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor('#64748b').text('—', MARGIN, y);
    y += 16;
  } else {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b').text('MEDICINE', MARGIN, y, { width: 160 });
    doc.text('DOSAGE', MARGIN + 170, y, { width: 170 });
    y += 13;
    doc.moveTo(MARGIN, y).lineTo(doc.page.width - MARGIN, y).strokeColor('#cbd5e1').lineWidth(0.75).stroke();
    y += 6;
    doc.font('Helvetica').fontSize(10).fillColor('#0f172a');
    for (const [name, notes] of rows) {
      const h = Math.max(doc.heightOfString(name, { width: 160 }), doc.heightOfString(notes || '—', { width: 170 }));
      if (y + h + 8 > doc.page.height - MARGIN - 40) {
        doc.addPage();
        y = MARGIN;
      }
      doc.text(name, MARGIN, y, { width: 160 });
      doc.text(notes || '—', MARGIN + 170, y, { width: 170 });
      y += h + 8;
    }
  }

  if (data.prescription.advice) {
    y += 6;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text('Advice', MARGIN, y);
    doc.font('Helvetica').fontSize(10).fillColor('#334155').text(data.prescription.advice, MARGIN, y + 16, {
      width: doc.page.width - MARGIN * 2,
      lineGap: 2,
    });
    y += 16 + doc.heightOfString(data.prescription.advice, { width: doc.page.width - MARGIN * 2 }) + 8;
  }

  if (data.prescription.nextVisitDate) {
    const at = Math.min(y, doc.page.height - MARGIN - 60);
    doc.font('Helvetica').fontSize(10).fillColor('#0f172a').text(`Next visit: ${data.prescription.nextVisitDate}`, MARGIN, at);
  }

  const when = formatDhaka(new Date(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  footer(doc, `Issued ${when} (Asia/Dhaka) · Not a substitute for an in-person emergency consultation`);
  return collect(doc);
}

