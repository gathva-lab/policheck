// Capa de enrutamiento por proveedor. El resto de la aplicación llama aquí y
// no necesita saber si un modelo se sirve desde NVIDIA u OpenRouter.
import { callOpenRouter } from './openrouter';
import { callNvidia } from './nvidia';
import {
  modelTimeoutFor,
  MODEL_TIMEOUT_MS,
  type CallFailureReason,
  type CompletionOptions,
  type CompletionOutcome,
} from './provider-http';

export { modelTimeoutFor, MODEL_TIMEOUT_MS };
export type { CallFailureReason, CompletionOptions };

export type LlmProvider = 'openrouter' | 'nvidia';

export interface LlmCallResult {
  model: string;
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  provider: LlmProvider;
}

export interface ModelCheckResult {
  model_id: string;
  provider: LlmProvider;
  ok: boolean;
  http_status: number | null;
  latency_ms: number;
  content_chars: number;
  error_reason: CallFailureReason | null;
}

// Tabla de enrutamiento. Las claves se normalizan sin el sufijo `:free` para
// que tanto el id de NVIDIA como el de OpenRouter caigan en la misma entrada.
const PROVIDER_BY_MODEL: Record<string, LlmProvider> = {
  'nvidia/nemotron-3-ultra-550b-a55b': 'nvidia',
  'nvidia/nemotron-3.5-lightning-30b-a3b': 'nvidia',
  // Alias con el que está guardado el modelo en OpenRouter/ai_model_config.
  'nvidia/nemotron-3.5-lightning': 'nvidia',
  'minimaxai/minimax-m3.1-flash': 'nvidia',
  'z-ai/glm-5.3-flash': 'nvidia',
};

// El id de catálogo puede no coincidir con el nombre que expone NVIDIA.
const NVIDIA_MODEL_BY_ALIAS: Record<string, string> = {
  'nvidia/nemotron-3.5-lightning': 'nvidia/nemotron-3.5-lightning-30b-a3b',
};

// Equivalente en OpenRouter para el fallback del mismo modelo. Los nemotron
// gratuitos conservan su sufijo `:free`; el resto usa el id comercial.
const OPENROUTER_MODEL_BY_NVIDIA: Record<string, string> = {
  'nvidia/nemotron-3-ultra-550b-a55b': 'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3.5-lightning-30b-a3b': 'nvidia/nemotron-3.5-lightning:free',
  'nvidia/nemotron-3.5-lightning': 'nvidia/nemotron-3.5-lightning:free',
  'minimaxai/minimax-m3.1-flash': 'minimax/minimax-m3.1-flash',
  'z-ai/glm-5.3-flash': 'z-ai/glm-4.6',
};

// Un fallo transitorio del proveedor principal se reintenta una vez con el
// mismo modelo en OpenRouter antes de descartarlo.
const PROVIDER_FALLBACK_REASONS: ReadonlySet<CallFailureReason> = new Set([
  'timeout',
  'http_error',
  'http_429',
  'http_402',
  'http_4xx',
]);

function normalizeModelId(modelId: string): string {
  return modelId.replace(/:free$/i, '');
}

export function providerForModel(modelId: string): LlmProvider {
  return PROVIDER_BY_MODEL[normalizeModelId(modelId)] ?? 'openrouter';
}

function openRouterModelFor(modelId: string, requested: LlmProvider): string {
  if (requested !== 'nvidia') return modelId;
  return OPENROUTER_MODEL_BY_NVIDIA[normalizeModelId(modelId)] ?? modelId;
}

function nvidiaModelFor(modelId: string): string {
  const normalized = normalizeModelId(modelId);
  return NVIDIA_MODEL_BY_ALIAS[normalized] ?? normalized;
}

function nvidiaKey(): string | null {
  const key = process.env.NVIDIA_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

interface RoutedOutcome {
  outcome: CompletionOutcome;
  provider: LlmProvider;
}

async function runRouted(
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  options: CompletionOptions
): Promise<RoutedOutcome> {
  const requested = providerForModel(modelId);
  const nvidiaApiKey = nvidiaKey();
  // Fail-open: sin NVIDIA_API_KEY esos modelos se sirven desde OpenRouter.
  const primary: LlmProvider = requested === 'nvidia' && nvidiaApiKey ? 'nvidia' : 'openrouter';

  const primaryOutcome =
    primary === 'nvidia'
      ? await callNvidia(
          nvidiaModelFor(modelId),
          nvidiaApiKey as string,
          systemPrompt,
          userContent,
          options
        )
      : await callOpenRouter(
          openRouterModelFor(modelId, requested),
          apiKey,
          systemPrompt,
          userContent,
          options
        );

  if (primaryOutcome.failureReason === null) {
    return { outcome: primaryOutcome, provider: primary };
  }

  if (primary === 'nvidia' && PROVIDER_FALLBACK_REASONS.has(primaryOutcome.failureReason)) {
    console.warn(
      `[llm] ${modelId} falló en NVIDIA (${primaryOutcome.failureReason}); se reintenta por OpenRouter`
    );
    const fallbackOutcome = await callOpenRouter(
      openRouterModelFor(modelId, requested),
      apiKey,
      systemPrompt,
      userContent,
      options
    );
    return { outcome: fallbackOutcome, provider: 'openrouter' };
  }

  return { outcome: primaryOutcome, provider: primary };
}

export async function callModel(
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  onFailure?: (reason: CallFailureReason, latencyMs: number, provider: LlmProvider) => void,
  options: CompletionOptions = {}
): Promise<LlmCallResult | null> {
  const { outcome, provider } = await runRouted(
    modelId,
    apiKey,
    systemPrompt,
    userContent,
    options
  );

  if (outcome.failureReason !== null) {
    // Se propaga la latencia real (incluidos los timeouts) para que el cost log
    // no registre 0 ms en fallos que sí esperaron.
    onFailure?.(outcome.failureReason, outcome.latencyMs, provider);
    return null;
  }

  return {
    model: modelId,
    content: outcome.content,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    latencyMs: outcome.latencyMs,
    provider,
  };
}

// Prueba mínima de un modelo: prompt corto y max_tokens bajo. No reintenta 429
// para que el diagnóstico sea rápido e informe el estado real de cada modelo.
export async function checkModel(
  modelId: string,
  apiKey: string,
  maxTokens = 60
): Promise<ModelCheckResult> {
  const { outcome, provider } = await runRouted(
    modelId,
    apiKey,
    'Responde únicamente con la palabra OK.',
    'Responde OK',
    { maxTokens, retryOn429: false }
  );

  return {
    model_id: modelId,
    provider,
    ok: outcome.failureReason === null,
    http_status: outcome.httpStatus,
    latency_ms: outcome.latencyMs,
    content_chars: outcome.content.length,
    error_reason: outcome.failureReason,
  };
}
