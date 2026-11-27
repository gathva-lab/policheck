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
  finishReason: string | null;
}

// El check usa una entrada mínima (dos palabras). La latencia no representa el
// análisis real de una transcripción larga, por eso el nombre lo explicita.
export const MODEL_CHECK_LATENCY_NOTE =
  'latencia con una entrada mínima; el análisis real con transcripciones largas tarda más';

export interface ModelCheckResult {
  model_id: string;
  // `provider` se conserva por compatibilidad y siempre refleja el usado.
  provider: LlmProvider;
  provider_used: LlmProvider;
  fallback_used: boolean;
  // Id real enviado al proveedor (puede diferir del alias del catálogo).
  routed_model_id: string;
  ok: boolean;
  http_status: number | null;
  // Latencia medida con una entrada mínima, no con una transcripción real.
  latency_ms_min: number;
  nota: string;
  content_chars: number;
  error_reason: CallFailureReason | null;
  finish_reason: string | null;
}

export interface CheckModelOptions {
  maxTokens?: number;
  // Proveedor configurado en ai_model_config; si falta se usa el enrutador.
  provider?: LlmProvider;
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
  'empty_por_limite',
]);

function normalizeModelId(modelId: string): string {
  return modelId.replace(/:free$/i, '');
}

export function providerForModel(
  modelId: string,
  configuredProvider?: string | null
): LlmProvider {
  // La configuración de la base de datos manda; el mapa es el respaldo para
  // llamadas que no traen provider (por ejemplo, desde el análisis).
  if (configuredProvider === 'nvidia' || configuredProvider === 'openrouter') {
    return configuredProvider;
  }
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

// Id real que se enviará al proveedor, incluida la traducción de alias.
export function routedModelIdFor(modelId: string, provider: LlmProvider): string {
  return provider === 'nvidia'
    ? nvidiaModelFor(modelId)
    : openRouterModelFor(modelId, providerForModel(modelId));
}

function nvidiaKey(): string | null {
  const key = process.env.NVIDIA_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

interface RoutedOutcome {
  outcome: CompletionOutcome;
  provider: LlmProvider;
  fallbackUsed: boolean;
  routedModelId: string;
}

async function runRouted(
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  options: CompletionOptions,
  providerOverride?: LlmProvider
): Promise<RoutedOutcome> {
  const requested = providerOverride ?? providerForModel(modelId);
  const nvidiaApiKey = nvidiaKey();
  // Fail-open: sin NVIDIA_API_KEY esos modelos se sirven desde OpenRouter.
  const primary: LlmProvider = requested === 'nvidia' && nvidiaApiKey ? 'nvidia' : 'openrouter';
  const primaryModelId =
    primary === 'nvidia' ? nvidiaModelFor(modelId) : openRouterModelFor(modelId, requested);

  const primaryOutcome =
    primary === 'nvidia'
      ? await callNvidia(
          primaryModelId,
          nvidiaApiKey as string,
          systemPrompt,
          userContent,
          options
        )
      : await callOpenRouter(
          primaryModelId,
          apiKey,
          systemPrompt,
          userContent,
          options
        );

  if (primaryOutcome.failureReason === null) {
    return {
      outcome: primaryOutcome,
      provider: primary,
      fallbackUsed: false,
      routedModelId: primaryModelId,
    };
  }

  if (primary === 'nvidia' && PROVIDER_FALLBACK_REASONS.has(primaryOutcome.failureReason)) {
    console.warn(
      `[llm] ${modelId} falló en NVIDIA (${primaryOutcome.failureReason}); se reintenta por OpenRouter`
    );
    const fallbackModelId = openRouterModelFor(modelId, requested);
    const fallbackOutcome = await callOpenRouter(
      fallbackModelId,
      apiKey,
      systemPrompt,
      userContent,
      options
    );
    return {
      outcome: fallbackOutcome,
      provider: 'openrouter',
      fallbackUsed: true,
      routedModelId: fallbackModelId,
    };
  }

  return {
    outcome: primaryOutcome,
    provider: primary,
    fallbackUsed: false,
    routedModelId: primaryModelId,
  };
}

export async function callModel(
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  onFailure?: (
    reason: CallFailureReason,
    latencyMs: number,
    provider: LlmProvider,
    finishReason: string | null
  ) => void,
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
    onFailure?.(outcome.failureReason, outcome.latencyMs, provider, outcome.finishReason);
    return null;
  }

  return {
    model: modelId,
    content: outcome.content,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    latencyMs: outcome.latencyMs,
    provider,
    finishReason: outcome.finishReason,
  };
}

// Prueba mínima de un modelo: prompt corto y max_tokens acotado. No reintenta
// 429 para que el diagnóstico sea rápido e informe el estado real de cada modelo.
export async function checkModel(
  modelId: string,
  apiKey: string,
  maxTokensOrOptions: number | CheckModelOptions = 200
): Promise<ModelCheckResult> {
  const options =
    typeof maxTokensOrOptions === 'number'
      ? { maxTokens: maxTokensOrOptions }
      : maxTokensOrOptions;
  const maxTokens = options.maxTokens ?? 200;
  const { outcome, provider, fallbackUsed, routedModelId } = await runRouted(
    modelId,
    apiKey,
    'Responde únicamente con la palabra OK.',
    'Responde OK',
    { maxTokens, retryOn429: false },
    options.provider
  );

  return {
    model_id: modelId,
    provider,
    provider_used: provider,
    fallback_used: fallbackUsed,
    routed_model_id: routedModelId,
    ok: outcome.failureReason === null,
    http_status: outcome.httpStatus,
    latency_ms_min: outcome.latencyMs,
    nota: MODEL_CHECK_LATENCY_NOTE,
    content_chars: outcome.content.length,
    error_reason: outcome.failureReason,
    finish_reason: outcome.finishReason,
  };
}
