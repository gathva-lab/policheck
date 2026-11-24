import { clampScore, isVerdictLabel, type VerdictLabel } from '../veracity';
import type { ModelReport } from '../consensus';

export interface ParsedAnalysis {
  report: ModelReport | null;
  raw: unknown;
}

export function extractJsonObject(text: string): unknown | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }

  const candidate = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return clampScore(value);
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return clampScore(Number(value));
  }
  return null;
}

function toString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseModelOutput(modelName: string, content: string): ParsedAnalysis {
  const raw = extractJsonObject(content);
  if (!raw || typeof raw !== 'object') return { report: null, raw };

  const obj = raw as Record<string, unknown>;
  const verdictLabel: VerdictLabel | null = isVerdictLabel(obj.verdict_label) ? obj.verdict_label : null;

  return {
    report: {
      modelName,
      verdictLabel,
      veracityScore: toNumber(obj.veracity_score),
      coherenceScore: toNumber(obj.coherence_score),
      summary: toString(obj.summary),
    },
    raw,
  };
}
