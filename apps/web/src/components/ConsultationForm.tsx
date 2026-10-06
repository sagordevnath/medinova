import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Stethoscope } from 'lucide-react';
import { apiPost, apiPatch, ApiRequestError, type EncounterDto } from '@/lib/api';
import { useSessionToken } from '@/hooks/useAuth';
import { useToast } from '@/providers/ToastProvider';
import { Button, GlassCard } from '@/components/Button';
import { Field, Input, Textarea } from '@/components/fields';
import { errorI18nKey } from '@/lib/errorKeys';

interface Props {
  appointmentId?: string;
  patientId: string;
  doctorId?: string;
  branchId?: string;
  visitType?: string;
  /** When editing, pass the existing encounter so the form is prefilled. */
  encounter?: EncounterDto | null;
  onSaved?: () => void;
}

const EMPTY_VITALS = {
  bpSystolic: '',
  bpDiastolic: '',
  pulse: '',
  temperatureC: '',
  weightKg: '',
  heightCm: '',
  spo2: '',
  respiratoryRate: '',
};

const vitalsFromEncounter = (v: EncounterDto['vitals']) => ({
  bpSystolic: v?.bpSystolic?.toString() ?? '',
  bpDiastolic: v?.bpDiastolic?.toString() ?? '',
  pulse: v?.pulse?.toString() ?? '',
  temperatureC: v?.temperatureC?.toString() ?? '',
  weightKg: v?.weightKg?.toString() ?? '',
  heightCm: v?.heightCm?.toString() ?? '',
  spo2: v?.spo2?.toString() ?? '',
  respiratoryRate: v?.respiratoryRate?.toString() ?? '',
});

/**
 * Clinical consultation form (Module 17).
 *
 * One screen for the whole SOAP note: observations, subjective findings,
 * diagnosis with an ICD-10 code, and the plan. Creating the encounter also
 * records vitals, so the first save produces a real clinical record rather
 * than a bare appointment status change.
 */
export function ConsultationForm({
  appointmentId,
  patientId,
  doctorId,
  branchId,
  visitType,
  encounter,
  onSaved,
}: Props) {
  const { t } = useTranslation(['consult', 'common', 'errors']);
  const token = useSessionToken();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [field, setField] = useState({
    chiefComplaint: '',
    historyOfPresentIllness: '',
    examination: '',
    diagnosisCode: '',
    diagnosisText: '',
    plan: '',
    advice: '',
  });
  const [vitals, setVitals] = useState(EMPTY_VITALS);
  const [isFollowup, setIsFollowup] = useState(false);

  // Prefill from an encounter the doctor is returning to.
  useEffect(() => {
    if (!encounter) return;
    setField({
      chiefComplaint: encounter.chiefComplaint ?? '',
      historyOfPresentIllness: encounter.historyOfPresentIllness ?? '',
      examination: encounter.examination ?? '',
      diagnosisCode: encounter.diagnosisCode ?? '',
      diagnosisText: encounter.diagnosisText ?? '',
      plan: encounter.plan ?? '',
      advice: encounter.advice ?? '',
    });
    setVitals(vitalsFromEncounter(encounter.vitals));
  }, [encounter]);

  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const vitalsPayload = Object.fromEntries(
    Object.entries(vitals)
      .map(([k, v]) => [k, num(v as string)])
      .filter(([, v]) => v !== null && !Number.isNaN(v as number)),
  );
  const hasVitals = Object.keys(vitalsPayload).length > 0;

  const save = async (complete: boolean) => {
    setBusy(true);
    try {
      const status = complete ? 'completed' : 'open';
      if (encounter) {
        await apiPatch(
          `/v1/encounters/${encounter.id}`,
          { ...field, status, ...(hasVitals ? { vitals: vitalsPayload } : {}) },
          token,
        );
      } else {
        await apiPost(
          '/v1/encounters',
          {
            patientId,
            appointmentId: appointmentId ?? null,
            doctorId: doctorId ?? null,
            branchId: branchId ?? null,
            visitType: isFollowup ? 'followup' : (visitType ?? 'new'),
            status,
            ...field,
            ...(hasVitals ? { vitals: vitalsPayload } : {}),
          },
          token,
        );
      }
      push({
        kind: 'success',
        title: complete ? t('consult:completedTitle') : t('consult:savedTitle'),
      });
      onSaved?.();
    } catch (e) {
      const key = e instanceof ApiRequestError ? e.key : undefined;
      push({
        kind: 'error',
        title: t('common:error'),
        body: key ? t(errorI18nKey(key)) : e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const numField = (key: keyof typeof field, value: string) =>
    setField({ ...field, [key]: value });

  return (
    <GlassCard className="space-y-4">
      <h2 className="flex items-center gap-2 text-lg font-extrabold">
        <Stethoscope className="text-primary" aria-hidden="true" />
        {t('consult:title')}
      </h2>

      <fieldset className="space-y-3">
        <legend className="text-sm font-extrabold uppercase tracking-wide opacity-70">
          {t('consult:vitals')}
        </legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={`${t('consult:bp')} (S/D)`}>
            <div className="flex gap-2">
              <Input
                type="number"
                inputMode="numeric"
                aria-label={t('consult:systolic')}
                value={vitals.bpSystolic}
                onChange={(e) => setVitals({ ...vitals, bpSystolic: e.target.value })}
              />
              <Input
                type="number"
                inputMode="numeric"
                aria-label={t('consult:diastolic')}
                value={vitals.bpDiastolic}
                onChange={(e) => setVitals({ ...vitals, bpDiastolic: e.target.value })}
              />
            </div>
          </Field>
          <Field label={t('consult:pulse')}>
            <Input
              type="number"
              inputMode="numeric"
              value={vitals.pulse}
              onChange={(e) => setVitals({ ...vitals, pulse: e.target.value })}
            />
          </Field>
          <Field label={t('consult:temperature')}>
            <Input
              type="number"
              step="0.1"
              value={vitals.temperatureC}
              onChange={(e) => setVitals({ ...vitals, temperatureC: e.target.value })}
            />
          </Field>
          <Field label={t('consult:spo2')}>
            <Input
              type="number"
              inputMode="numeric"
              value={vitals.spo2}
              onChange={(e) => setVitals({ ...vitals, spo2: e.target.value })}
            />
          </Field>
          <Field label={t('consult:weight')}>
            <Input
              type="number"
              step="0.1"
              value={vitals.weightKg}
              onChange={(e) => setVitals({ ...vitals, weightKg: e.target.value })}
            />
          </Field>
          <Field label={t('consult:height')}>
            <Input
              type="number"
              step="0.1"
              value={vitals.heightCm}
              onChange={(e) => setVitals({ ...vitals, heightCm: e.target.value })}
            />
          </Field>
          <Field label={t('consult:respRate')}>
            <Input
              type="number"
              inputMode="numeric"
              value={vitals.respiratoryRate}
              onChange={(e) => setVitals({ ...vitals, respiratoryRate: e.target.value })}
            />
          </Field>
        </div>
      </fieldset>

      <Field label={t('consult:complaint')}>
        <Input
          value={field.chiefComplaint}
          onChange={(e) => numField('chiefComplaint', e.target.value)}
        />
      </Field>
      <Field label={t('consult:hpi')}>
        <Textarea
          rows={3}
          value={field.historyOfPresentIllness}
          onChange={(e) => numField('historyOfPresentIllness', e.target.value)}
        />
      </Field>
      <Field label={t('consult:examination')}>
        <Textarea
          rows={3}
          value={field.examination}
          onChange={(e) => numField('examination', e.target.value)}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('consult:icdCode')}>
          <Input
            placeholder="J06.9"
            value={field.diagnosisCode}
            onChange={(e) => numField('diagnosisCode', e.target.value)}
          />
        </Field>
        <Field label={t('consult:diagnosis')}>
          <Input
            value={field.diagnosisText}
            onChange={(e) => numField('diagnosisText', e.target.value)}
          />
        </Field>
        <Field label={t('consult:visitType')}>
          <select
            className="min-h-11 w-full rounded-xl border bg-card px-3"
            value={isFollowup ? 'followup' : (visitType ?? 'new')}
            onChange={(e) => setIsFollowup(e.target.value === 'followup')}
          >
            <option value="new">{t('consult:typeNew')}</option>
            <option value="followup">{t('consult:typeFollowup')}</option>
            <option value="telemedicine">{t('consult:typeTelemedicine')}</option>
          </select>
        </Field>
      </div>

      <Field label={t('consult:plan')}>
        <Textarea rows={2} value={field.plan} onChange={(e) => numField('plan', e.target.value)} />
      </Field>
      <Field label={t('consult:advice')}>
        <Textarea rows={2} value={field.advice} onChange={(e) => numField('advice', e.target.value)} />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void save(false)}>
          <Save size={16} aria-hidden="true" />
          {t('consult:saveDraft')}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void save(true)}>
          {t('consult:complete')}
        </Button>
      </div>
    </GlassCard>
  );
}
