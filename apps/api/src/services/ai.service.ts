import type { Env } from '../config/env.js';
import type { Logger } from '../utils/logger.js';

/**
 * AI triage proxy (symptoms → department + urgency).
 *
 * Privacy: raw symptom text is NEVER persisted — it goes only to the upstream
 * provider (Gemini/Claude) and is logged at length only. The response carries
 * a strict medical disclaimer that must be surfaced to the user.
 */
export interface TriageResult {
  department: string;
  medicine_type_suggestion: 'allopathic' | 'homeopathic';
  urgency: 'routine' | 'soon' | 'emergency';
  reasoning_short: string;
  disclaimer: string;
}

export const TRIAGE_DISCLAIMER =
  'This is an AI-generated suggestion for routing only, not a medical diagnosis or advice. ' +
  'MediNova doctors make the final decision. If this is an emergency (chest pain, bleeding, ' +
  'breathing difficulty, unconsciousness), call 999 or visit the nearest emergency department immediately.';

const SYSTEM_PROMPT = `You are a hospital triage routing assistant for MediNova (Bangladesh).
Given the patient's symptom text, reply with STRICT JSON only:
{"department": "<one of: Medicine, Cardiology, Gynecology, Pediatrics, Orthopedics, ENT, Dermatology, Neurology, General Homeopathy, Chronic Disease, Pediatric Homeopathy, Skin & Allergy, Women's Health>",
 "medicine_type_suggestion": "allopathic" | "homeopathic",
 "urgency": "routine" | "soon" | "emergency",
 "reasoning_short": "<max 120 chars, plain English>"}
Rules: urgency "emergency" for life-threatening signs (chest pain, stroke signs, severe bleeding, breathing difficulty, unconsciousness, high fever in newborn); "soon" for worsening/persistent symptoms; otherwise "routine". Never add prose outside the JSON.`;

const LIMITS: Record<string, number> = { routine: 0, soon: 1, emergency: 2 };

function clampResult(parsed: Record<string, unknown>): TriageResult {
  const urgency = ['routine', 'soon', 'emergency'].includes(String(parsed.urgency))
    ? (parsed.urgency as TriageResult['urgency'])
    : 'routine';
  const med = parsed.medicine_type_suggestion === 'homeopathic' ? 'homeopathic' : 'allopathic';
  return {
    department: typeof parsed.department === 'string' && parsed.department ? parsed.department : 'Medicine',
    medicine_type_suggestion: med,
    urgency,
    reasoning_short: String(parsed.reasoning_short ?? '').slice(0, 160) || 'Routed by symptom keywords.',
    disclaimer: TRIAGE_DISCLAIMER,
  };
}

/** Keyword fallback used when no provider is configured (and on upstream failure). */
export function heuristicTriage(text: string): TriageResult {
  const t = text.toLowerCase();
  const emergency =
    /(chest pain|can'?t breathe|difficulty breathing|unconscious|seizure|stroke|slurred speech|heavy bleeding|severe bleeding|suicid)/.test(t);
  const soon =
    !emergency &&
    /(persistent|worsening|days|fever|swollen|infection|vomiting|dizziness|blurred vision|severe)/.test(t);

  let department = 'Medicine';
  if (/(heart|palpitation|blood pressure|hypertension)/.test(t)) department = 'Cardiology';
  else if (/(child|kid|infant|baby|newborn)/.test(t)) department = 'Pediatrics';
  else if (/(pregnan|menstru|vaginal|gynec)/.test(t)) department = 'Gynecology';
  else if (/(bone|joint|back pain|fracture|sprain|knee)/.test(t)) department = 'Orthopedics';
  else if (/(skin|rash|itch|hair|eczema)/.test(t)) department = 'Dermatology';
  else if (/(ear|nose|throat|tonsil|sinus)/.test(t)) department = 'ENT';
  else if (/(headache|migraine|numbness|weakness|memory|seizure)/.test(t)) department = 'Neurology';
  else if (/(homeopath|constitutional|chronic)/.test(t)) department = 'General Homeopathy';

  return clampResult({
    department,
    medicine_type_suggestion: /homeopath/.test(t) ? 'homeopathic' : 'allopathic',
    urgency: emergency ? 'emergency' : soon ? 'soon' : 'routine',
    reasoning_short: 'Local keyword routing (no AI provider configured).',
  });
}

/** Call Gemini generateContent; returns parsed JSON object or throws. */
async function callGemini(env: Env, symptoms: string): Promise<Record<string, unknown>> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\nSymptoms:\n${symptoms}` }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return JSON.parse(text) as Record<string, unknown>;
}

/** Call Anthropic Messages API; returns parsed JSON object or throws. */
async function callClaude(env: Env, symptoms: string): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.CLAUDE_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Symptoms:\n${symptoms}` }],
    }),
  });
  if (!res.ok) throw new Error(`claude ${res.status}`);
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  const text = data.content?.[0]?.text ?? '';
  return JSON.parse(text) as Record<string, unknown>;
}

/**
 * Run triage for symptom text. Never stores the raw text (memory-only pass
 * through to the provider). Falls back to heuristic routing when no provider
 * is configured or the upstream call fails.
 */
export async function triage(env: Env, logger: Logger, symptoms: string): Promise<TriageResult> {
  const text = symptoms.trim().slice(0, 2000); // hard cap; raw text never persisted
  try {
    if (env.AI_PROVIDER === 'gemini' && env.GEMINI_API_KEY) {
      return clampResult(await callGemini(env, text));
    }
    if (env.AI_PROVIDER === 'claude' && env.CLAUDE_API_KEY) {
      return clampResult(await callClaude(env, text));
    }
  } catch (err) {
    logger.warn({ err: String(err), chars: text.length }, 'ai triage upstream failed; using heuristic');
  }
  return heuristicTriage(text);
}

/** True when urgency must never be downgraded vs. a previous assessment. */
export function urgencyAtLeast(a: string, b: string): boolean {
  return (LIMITS[a] ?? 0) >= (LIMITS[b] ?? 0);
}

