const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_TIMEOUT_MS = 45000;
const MAX_TOKENS = 6000;
const RATE_LIMIT_BACKOFF_MS = 1500;

export type CallFailureReason =
  | 'timeout'
  | 'http_error'
  | 'http_429'
  | 'http_402'
  | 'http_4xx'
  | 'empty'
  | 'parse_failed';

export interface OpenRouterResult {
  model: string;
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface CallModelOptions {
  maxTokens?: number;
  retryOn429?: boolean;
}

export interface ModelCheckResult {
  model_id: string;
  ok: boolean;
  http_status: number | null;
  latency_ms: number;
  content_chars: number;
  error_reason: CallFailureReason | null;
}

interface CompletionOutcome {
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  httpStatus: number | null;
  failureReason: CallFailureReason | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Núcleo compartido por callModel y el diagnóstico de modelos. Devuelve también
// el HTTP y el motivo del fallo para que /api/maintenance/models-check pueda
// reportar qué modelo está caído sin adivinar.
async function executeCompletion(
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  options: CallModelOptions = {}
): Promise<CompletionOutcome> {
  const maxTokens = options.maxTokens ?? MAX_TOKENS;
  const retryOn429 = options.retryOn429 ?? true;
  const maxAttempts = retryOn429 ? 2 : 1;
  const start = Date.now();

  const fail = (
    reason: CallFailureReason,
    httpStatus: number | null,
    latencyMs: number
  ): CompletionOutcome => ({
    content: '',
    inputTokens: 0,
    outputTokens: 0,
    latencyMs,
    httpStatus,
    failureReason: reason,
  });

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

    try {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: 0.2,
          // Desactiva el thinking mode extendido: con presupuesto corto el
          // modelo razonaba todo el max_tokens y devolvía content vacío.
          reasoning: { enabled: false },
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
        cache: 'no-store',
      });

      const httpStatus = response.status;
      const latencyMs = Date.now() - start;

      if (httpStatus === 429) {
        if (attempt < maxAttempts - 1) {
          console.warn(
            `[openrouter] ${modelId} rate limit (429); reintento en ${RATE_LIMIT_BACKOFF_MS} ms`
          );
          clearTimeout(timeout);
          await sleep(RATE_LIMIT_BACKOFF_MS);
          continue;
        }
        console.warn(`[openrouter] ${modelId} falló con HTTP 429 tras el reintento`);
        return fail('http_429', httpStatus, latencyMs);
      }
      if (httpStatus === 402) {
        console.warn(`[openrouter] ${modelId} sin crédito (HTTP 402)`);
        return fail('http_402', httpStatus, latencyMs);
      }
      if (httpStatus >= 400 && httpStatus < 500) {
        console.warn(`[openrouter] ${modelId} HTTP ${httpStatus}`);
        return fail('http_4xx', httpStatus, latencyMs);
      }
      if (httpStatus >= 500 || !response.ok) {
        console.warn(`[openrouter] ${modelId} falló con HTTP ${httpStatus}`);
        return fail('http_error', httpStatus, latencyMs);
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: unknown;
            reasoning?: unknown;
            reasoning_content?: unknown;
          };
        }>;
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      };
      const message = data?.choices?.[0]?.message;
      const content = message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        const reasoning = message?.reasoning ?? message?.reasoning_content;
        if (typeof reasoning === 'string' && reasoning.trim()) {
          console.warn(
            `[openrouter] ${modelId} razonó sin emitir respuesta (${reasoning.length} caracteres de reasoning y content vacío)`
          );
        }
        return fail('empty', httpStatus, latencyMs);
      }

      return {
        content,
        inputTokens: Number(data?.usage?.prompt_tokens ?? 0),
        outputTokens: Number(data?.usage?.completion_tokens ?? 0),
        latencyMs,
        httpStatus,
        failureReason: null,
      };
    } catch (error) {
      const aborted = controller.signal.aborted;
      console.warn(
        `[openrouter] ${modelId} error:`,
        error instanceof Error ? error.message : error
      );
      return fail(aborted ? 'timeout' : 'http_error', null, Date.now() - start);
    } finally {
      clearTimeout(timeout);
    }
  }

  return fail('http_error', null, Date.now() - start);
}

export async function callModel(
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  onFailure?: (reason: CallFailureReason) => void,
  options: CallModelOptions = {}
): Promise<OpenRouterResult | null> {
  const outcome = await executeCompletion(modelId, apiKey, systemPrompt, userContent, options);

  if (outcome.failureReason !== null) {
    onFailure?.(outcome.failureReason);
    return null;
  }

  return {
    model: modelId,
    content: outcome.content,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    latencyMs: outcome.latencyMs,
  };
}

// Prueba mínima de un modelo: prompt corto y max_tokens bajo. No reintenta para
// que el diagnóstico sea rápido e informe el estado real de cada modelo.
export async function checkModel(
  modelId: string,
  apiKey: string,
  maxTokens = 60
): Promise<ModelCheckResult> {
  const outcome = await executeCompletion(
    modelId,
    apiKey,
    'Responde únicamente con la palabra OK.',
    'Responde OK',
    { maxTokens, retryOn429: false }
  );

  return {
    model_id: modelId,
    ok: outcome.failureReason === null,
    http_status: outcome.httpStatus,
    latency_ms: outcome.latencyMs,
    content_chars: outcome.content.length,
    error_reason: outcome.failureReason,
  };
}
