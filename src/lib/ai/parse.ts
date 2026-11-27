import { clampScore, isVerdictLabel, type VerdictLabel } from '../veracity';
import {
  FALLACY_TYPES,
  type ContentNature,
  type FallacyType,
  type ModelReport,
  type ReportFallacy,
  type ReportQuote,
} from '../consensus';

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

const CONTENT_NATURES: ContentNature[] = ['opinion', 'mixto', 'factual'];

function toContentNature(value: unknown): ContentNature | null {
  const text = toString(value)?.toLowerCase();
  return CONTENT_NATURES.find((nature) => nature === text) ?? null;
}

function toQuotes(value: unknown): ReportQuote[] | null {
  if (!Array.isArray(value)) return null;

  const quotes: ReportQuote[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const text = toString(obj.text);
    const assessment = toString(obj.assessment);
    if (!text || !assessment) continue;
    quotes.push({ text, assessment });
    if (quotes.length === 5) break;
  }

  return quotes.length > 0 ? quotes : null;
}

function toFallacies(value: unknown): ReportFallacy[] | null {
  if (!Array.isArray(value)) return null;

  const fallacies: ReportFallacy[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const type = toString(obj.type)?.toLowerCase();
    if (!type || !FALLACY_TYPES.includes(type as FallacyType)) continue;
    const quote = toString(obj.quote);
    const explanation = toString(obj.explanation);
    if (!quote || !explanation) continue;
    fallacies.push({ type: type as FallacyType, quote, explanation });
    if (fallacies.length === 3) break;
  }

  return fallacies.length > 0 ? fallacies : null;
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
      plainVerdict: toString(obj.plain_verdict),
      plainSummary: toString(obj.plain_summary),
      quotes: toQuotes(obj.quotes),
      fallacies: toFallacies(obj.fallacies),
      contentNature: toContentNature(obj.content_nature),
    },
    raw,
  };
}
