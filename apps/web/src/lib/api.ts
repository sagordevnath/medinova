export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as T;
}

export function formatBdt(amount: number, locale: string): string {
  const loc = locale === 'bn' ? 'bn-BD' : 'en-BD';
  const digits = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }).format(amount);
  return `৳${digits}`;
}
