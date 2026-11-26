// Cliente del modelo de decisiones JEV de TypeSafe.
// JEV no genera texto: devuelve decisiones tipadas con probabilidades.
// Es opcional: si falla (timeout, 500, etc.) el análisis continúa sin él.

const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
export const JEV_MODEL = 'typesafe/jev-1.14';
export const JEV_PRICE_PER_1M_INPUT = 0.042;
export const JEV_OUTPUT_FREE = true;

const JEV_TIMEOUT_MS = 8000;
const JEV_VERIFIABLE_THRESHOLD = 0.35;
// Constante histórica: el veto ya NO depende de `confidence` sino de las
// probabilidades (`evaluateConsensusVeto`). Se conserva exportada por
// compatibilidad, pero no debe usarse para vetar.
export const JEV_VETO_CONFIDENCE = 0.4;
const JEV_EXCERPT_CHARS = 6000;
// La verificación post-consenso usa el texto completo que vieron los modelos,
// recortado a este máximo. Fuentes más largas se trocean (inicio y final).
export const JEV_VERIFICATION_MAX_CHARS = 12000;

const OMITTED_MARKER = '\n\n[...contenido omitido...]\n\n';

/**
 * Prepara el texto de verificación: si supera el máximo, conserva el inicio y el
 * final en lugar de truncar solo el comienzo, para no perder la conclusión.
 */
export function buildVerificationText(text: string, maxChars = JEV_VERIFICATION_MAX_CHARS): string {
  const clean = text ?? '';
  if (clean.length <= maxChars) return clean;

  const budget = Math.max(0, maxChars - OMITTED_MARKER.length);
  const headLength = Math.ceil(budget / 2);
  const tailLength = budget - headLength;
  return clean.slice(0, headLength) + OMITTED_MARKER + clean.slice(clean.length - tailLength);
}

export type JevQuestionType = 'noul' | 'choice' | 'score' | 'box';

export interface JevQuestion {
  type: JevQuestionType;
  instructions: string;
  criteria?: Record<string, string> | string[];
}

export interface JevUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface JevNoulAnswer {
  noul: number;
  confidence?: number;
}

export interface JevChoiceAnswer {
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

export interface JevAnswer<T> {
  answers: T;
  usage: JevUsage;
  latencyMs: number;
}

export interface VerifiableResult {
  verificable: boolean;
  probability: number;
  usage: JevUsage;
  latencyMs: number;
}

export interface ConsensusVerification {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
  usage: JevUsage;
  latencyMs: number;
}

export type JevVetoReason = 'no_soportado' | 'jev_ambiguous';

export interface JevVetoDecision {
  veto: boolean;
  reason: JevVetoReason | null;
}

// Respaldo de JEV en porcentaje 0–100 para la columna `jev_support`.
// Devuelve null cuando la probabilidad no viene o no es un número válido.
export function jevSupportFromProbabilities(
  probabilities: Record<string, number> | null | undefined
): number | null {
  const value = Number(probabilities?.soportado);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

// Criterio de veto por probabilidades (más robusto que por `confidence`):
// - no_soportado >= 0.5: veto firme.
// - soportado >= 0.5: no veta, aunque la confidence sea baja.
// - cualquier otro caso: zona ambigua, veta con la nota `jev_ambiguous`.
export function evaluateConsensusVeto(
  probabilities: Record<string, number> | null | undefined
): JevVetoDecision {
  const soportado = Number(probabilities?.soportado);
  const noSoportado = Number(probabilities?.no_soportado);

  if (Number.isFinite(noSoportado) && noSoportado >= 0.5) {
    return { veto: true, reason: 'no_soportado' };
  }
  if (Number.isFinite(soportado) && soportado >= 0.5) {
    return { veto: false, reason: null };
  }
  return { veto: true, reason: 'jev_ambiguous' };
}

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function parseUsage(raw: unknown): JevUsage {
  if (!raw || typeof raw !== 'object') {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
  const usage = raw as Record<string, unknown>;
  const inputTokens = toNumber(usage.input_tokens ?? usage.prompt_tokens ?? usage.input);
  const outputTokens = toNumber(usage.output_tokens ?? usage.completion_tokens ?? usage.output);
  const totalTokens = toNumber(usage.total_tokens) || inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

export function jevCostUsd(inputTokens: number): number {
  return Number(((inputTokens / 1e6) * JEV_PRICE_PER_1M_INPUT).toFixed(8));
}

export async function askJev<T extends Record<string, unknown> = Record<string, unknown>>(
  questions: Record<string, JevQuestion>,
  state: Record<string, unknown>,
  apiKey: string,
  timeoutMs: number = JEV_TIMEOUT_MS
): Promise<JevAnswer<T> | null> {
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const response = await fetch(JEV_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      console.warn(`[jev] HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const rawAnswers = (data.answers ?? data) as Record<string, unknown>;

    return {
      answers: rawAnswers as T,
      usage: parseUsage(data.usage),
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    console.warn('[jev] error:', error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function isVerifiable(
  extracto: string,
  titulo: string,
  apiKey: string,
  timeoutMs: number = JEV_TIMEOUT_MS
): Promise<VerifiableResult | null> {
  const result = await askJev<{ verificable?: JevNoulAnswer }>(
    {
      verificable: {
        type: 'noul',
        instructions:
          'El contenido incluye afirmaciones factuales concretas (cifras, hechos, políticas, declaraciones atribuibles) que pueden contrastarse con evidencia pública, y NO es únicamente opinión, consigna o promesa sin hecho verificable.',
        criteria: {
          true: 'Contiene afirmaciones factuales concretas (cifras, hechos, políticas o declaraciones atribuibles) contrastables con evidencia pública.',
          false: 'Es únicamente opinión, consigna, promesa o comentario general sin hechos concretos que puedan contrastarse.',
        },
      },
    },
    {
      titulo,
      extracto: (extracto ?? '').slice(0, JEV_EXCERPT_CHARS),
    },
    apiKey,
    timeoutMs
  );

  if (!result) return null;

  const answer = result.answers.verificable;
  // Respuesta malformada: se trata como fallo de JEV (fail-open).
  if (typeof answer?.noul !== 'number') return null;
  const probability = answer.noul;

  return {
    verificable: probability >= JEV_VERIFIABLE_THRESHOLD,
    probability,
    usage: result.usage,
    latencyMs: result.latencyMs,
  };
}

export async function verifyConsensusVerdict(
  verdictLabel: string | null,
  verdictScore: number | null,
  summary: string | null,
  verificationText: string,
  apiKey: string,
  timeoutMs: number = JEV_TIMEOUT_MS
): Promise<ConsensusVerification | null> {
  const result = await askJev<{ soporte?: JevChoiceAnswer }>(
    {
      soporte: {
        type: 'choice',
        instructions:
          '¿La justificación del veredicto es coherente con el contenido de la fuente? Responde soportado si la conclusión se desprende razonablemente de lo dicho, aunque no cite cada frase. parcial si solo una parte se apoya en el contenido. no_soportado si contradice lo dicho o atribuye afirmaciones que no aparecen.',
        criteria: {
          soportado:
            'La justificación se sostiene con el contenido de la fuente y no inventa ni contradice hechos. La conclusión se sigue del contenido aunque el resumen no reproduzca frases literales.',
          parcial: 'La justificación se sostiene solo en parte: algunos elementos tienen respaldo en la fuente y otros no.',
          no_soportado: 'La justificación contradice el contenido de la fuente o inventa hechos que no aparecen en ella.',
        },
      },
    },
    {
      extracto: buildVerificationText(verificationText),
      veredicto: verdictLabel ?? 'desconocido',
      puntaje: verdictScore,
      justificacion: summary ?? '',
    },
    apiKey,
    timeoutMs
  );

  if (!result) return null;

  const answer = result.answers.soporte;
  if (!answer || typeof answer.choice !== 'string') return null;

  return {
    choice: answer.choice,
    confidence: toNumber(answer.confidence),
    probabilities: answer.probabilities ?? {},
    usage: result.usage,
    latencyMs: result.latencyMs,
  };
}
