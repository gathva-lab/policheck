export type VerdictLabel =
  | 'verdadero'
  | 'verdadero_pero'
  | 'discutible'
  | 'apresurado'
  | 'exagerado'
  | 'enganoso'
  | 'insostenible'
  | 'inchequeable'
  | 'anejo';

export type VeracityColor = 'green' | 'yellow' | 'orange' | 'red' | 'gray';

export interface VeracityTier {
  label: VerdictLabel;
  display: string;
  min: number;
  max: number;
  color: VeracityColor;
  emoji: string;
}

export const VERACITY_TAXONOMY: VeracityTier[] = [
  { label: 'verdadero', display: 'Verdadero', min: 90, max: 100, color: 'green', emoji: '🟢' },
  { label: 'verdadero_pero', display: 'Verdadero, pero', min: 75, max: 89, color: 'green', emoji: '🟢' },
  { label: 'discutible', display: 'Discutible', min: 60, max: 74, color: 'yellow', emoji: '🟡' },
  { label: 'apresurado', display: 'Apresurado', min: 45, max: 59, color: 'yellow', emoji: '🟡' },
  { label: 'exagerado', display: 'Exagerado', min: 30, max: 44, color: 'orange', emoji: '🟠' },
  { label: 'enganoso', display: 'Engañoso', min: 15, max: 29, color: 'red', emoji: '🔴' },
  { label: 'insostenible', display: 'Insostenible', min: 5, max: 14, color: 'red', emoji: '🔴' },
  { label: 'inchequeable', display: 'Inchequeable', min: 0, max: 4, color: 'gray', emoji: '⚫' },
  { label: 'anejo', display: 'Añejo', min: 0, max: 4, color: 'gray', emoji: '⚫' },
];

export const VERDICT_LABELS: VerdictLabel[] = VERACITY_TAXONOMY.map((t) => t.label);

export function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

export function isVerdictLabel(value: unknown): value is VerdictLabel {
  return typeof value === 'string' && (VERDICT_LABELS as string[]).includes(value);
}

export function tierFromScore(
  score: number | null | undefined,
  label?: string | null
): VeracityTier | null {
  // `inchequeable` y `anejo` comparten a propósito el rango 0-4: son dos causas
  // distintas de "no evaluable" (falta de evidencia vs. información desactualizada).
  // Si el modelo declaró un label válido, ese label manda; si no, el tramo 0-4
  // cae por defecto en `inchequeable`.
  if (isVerdictLabel(label)) return tierFromLabel(label);
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  const s = clampScore(score);
  if (s <= 4) return tierFromLabel('inchequeable');
  return VERACITY_TAXONOMY.find((t) => s >= t.min && s <= t.max) ?? null;
}

export function tierFromLabel(label: string | null | undefined): VeracityTier | null {
  if (!label) return null;
  return VERACITY_TAXONOMY.find((t) => t.label === label) ?? null;
}

export function colorFromScore(score: number | null | undefined): VeracityColor | null {
  return tierFromScore(score)?.color ?? null;
}

export function colorFromLabel(label: string | null | undefined): VeracityColor | null {
  return tierFromLabel(label)?.color ?? null;
}

export function scoreRangeForLabel(label: string | null | undefined): { min: number; max: number } | null {
  const tier = tierFromLabel(label);
  return tier ? { min: tier.min, max: tier.max } : null;
}

export function displayLabel(label: string | null | undefined): string | null {
  return tierFromLabel(label)?.display ?? null;
}
