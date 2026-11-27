// Adaptador de OpenRouter. La capa de enrutamiento vive en llm.ts.
import {
  executeChatCompletion,
  modelTimeoutFor,
  MODEL_TIMEOUT_MS,
  type CallFailureReason,
  type CompletionOptions,
  type CompletionOutcome,
} from './provider-http';

export { modelTimeoutFor, MODEL_TIMEOUT_MS };
export type { CallFailureReason, CompletionOptions, CompletionOutcome };

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface OpenRouterResult {
  model: string;
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export async function callOpenRouter(
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  options: CompletionOptions = {}
): Promise<CompletionOutcome> {
  return executeChatCompletion({
    url: OPENROUTER_URL,
    apiKey,
    modelId,
    systemPrompt,
    userContent,
    label: 'openrouter',
    includeReasoning: true,
    options,
  });
}

// Compatibilidad con llamadas directas al adaptador. La aplicación usa llm.ts.
export async function callModel(
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  onFailure?: (reason: CallFailureReason, latencyMs: number) => void,
  options: CompletionOptions = {}
): Promise<OpenRouterResult | null> {
  const outcome = await callOpenRouter(modelId, apiKey, systemPrompt, userContent, options);
  if (outcome.failureReason !== null) {
    onFailure?.(outcome.failureReason, outcome.latencyMs);
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
