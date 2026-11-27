// Núcleo HTTP compartido por los adaptadores de proveedores LLM.
// Cada proveedor mantiene su URL, autenticación y particularidades del cuerpo;
// aquí solo vive el manejo común de timeouts, reintentos y clasificación.

export const MODEL_TIMEOUT_MS = 75000;
export const MAX_TOKENS = 6000;
const RATE_LIMIT_BACKOFF_MS = 1500;

// Fuentes largas necesitan más tiempo de generación. Por debajo de 6000
// caracteres basta el timeout corto; desde ahí se usa el máximo.
export function modelTimeoutFor(inputChars: number): number {
  return inputChars < 6000 ? 45000 : MODEL_TIMEOUT_MS;
}

export type CallFailureReason =
  | 'timeout'
  | 'http_error'
  | 'http_429'
  | 'http_402'
  | 'http_4xx'
  | 'empty'
  // El modelo se quedó sin presupuesto de salida (finish_reason = length) y no
  // emitió contenido: distinto de un vacío sin causa conocida.
  | 'empty_por_limite'
  // El id enrutado no existe en el catálogo del proveedor configurado.
  | 'modelo_no_existe_en_proveedor'
  | 'parse_failed';

export interface CompletionOptions {
  maxTokens?: number;
  retryOn429?: boolean;
  timeoutMs?: number;
}

export interface CompletionOutcome {
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  httpStatus: number | null;
  failureReason: CallFailureReason | null;
  // Motivo de término informado por el proveedor (choices[0].finish_reason).
  finishReason: string | null;
}

export interface CompletionRequest {
  url: string;
  apiKey: string;
  modelId: string;
  systemPrompt: string;
  userContent: string;
  label: string;
  // OpenRouter permite desactivar el thinking mode; NVIDIA no conoce ese campo.
  includeReasoning: boolean;
  options?: CompletionOptions;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeChatCompletion(
  request: CompletionRequest
): Promise<CompletionOutcome> {
  const {
    url,
    apiKey,
    modelId,
    systemPrompt,
    userContent,
    label,
    includeReasoning,
    options = {},
  } = request;
  const maxTokens = options.maxTokens ?? MAX_TOKENS;
  const retryOn429 = options.retryOn429 ?? true;
  const timeoutMs = options.timeoutMs ?? MODEL_TIMEOUT_MS;
  const maxAttempts = retryOn429 ? 2 : 1;
  const start = Date.now();

  const fail = (
    reason: CallFailureReason,
    httpStatus: number | null,
    latencyMs: number,
    finishReason: string | null = null
  ): CompletionOutcome => ({
    content: '',
    inputTokens: 0,
    outputTokens: 0,
    latencyMs,
    httpStatus,
    failureReason: reason,
    finishReason,
  });

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const body: Record<string, unknown> = {
        model: modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        // Un clasificador debe ser reproducible: la creatividad no aporta y sí
        // introduce varianza entre corridas del mismo texto (mismo contenido,
        // distinto veredicto).
        temperature: 0,
        max_tokens: maxTokens,
      };
      if (includeReasoning) {
        // Desactiva el thinking mode extendido: con presupuesto corto el
        // modelo razonaba todo el max_tokens y devolvía content vacío.
        body.reasoning = { enabled: false };
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });

      const httpStatus = response.status;
      const latencyMs = Date.now() - start;

      if (httpStatus === 429) {
        if (attempt < maxAttempts - 1) {
          console.warn(
            `[${label}] ${modelId} rate limit (429); reintento en ${RATE_LIMIT_BACKOFF_MS} ms`
          );
          clearTimeout(timeout);
          await sleep(RATE_LIMIT_BACKOFF_MS);
          continue;
        }
        console.warn(`[${label}] ${modelId} falló con HTTP 429 tras el reintento`);
        return fail('http_429', httpStatus, latencyMs);
      }
      if (httpStatus === 402) {
        console.warn(`[${label}] ${modelId} sin crédito (HTTP 402)`);
        return fail('http_402', httpStatus, latencyMs);
      }
      if (httpStatus >= 400 && httpStatus < 500) {
        console.warn(`[${label}] ${modelId} HTTP ${httpStatus}`);
        return fail('http_4xx', httpStatus, latencyMs);
      }
      if (httpStatus >= 500 || !response.ok) {
        console.warn(`[${label}] ${modelId} falló con HTTP ${httpStatus}`);
        return fail('http_error', httpStatus, latencyMs);
      }

      const data = (await response.json()) as {
        choices?: Array<{
          finish_reason?: unknown;
          message?: {
            content?: unknown;
            reasoning?: unknown;
            reasoning_content?: unknown;
          };
        }>;
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      };
      const choice = data?.choices?.[0];
      const finishReason =
        typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
      const message = choice?.message;
      const content = message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        const reasoning = message?.reasoning ?? message?.reasoning_content;
        if (typeof reasoning === 'string' && reasoning.trim()) {
          console.warn(
            `[${label}] ${modelId} razonó sin emitir respuesta (${reasoning.length} caracteres de reasoning y content vacío)`
          );
        }
        // finish_reason = length con content vacío indica que el presupuesto de
        // salida (max_tokens) se agotó razonando antes de emitir la respuesta.
        return fail(
          finishReason === 'length' ? 'empty_por_limite' : 'empty',
          httpStatus,
          latencyMs,
          finishReason
        );
      }

      return {
        content,
        inputTokens: Number(data?.usage?.prompt_tokens ?? 0),
        outputTokens: Number(data?.usage?.completion_tokens ?? 0),
        latencyMs,
        httpStatus,
        failureReason: null,
        finishReason,
      };
    } catch (error) {
      const aborted = controller.signal.aborted;
      console.warn(
        `[${label}] ${modelId} error:`,
        error instanceof Error ? error.message : error
      );
      return fail(aborted ? 'timeout' : 'http_error', null, Date.now() - start);
    } finally {
      clearTimeout(timeout);
    }
  }

  return fail('http_error', null, Date.now() - start);
}
