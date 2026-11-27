// Adaptador de NVIDIA Build (endpoint compatible con OpenAI).
// No envía el campo `reasoning`: es específico de OpenRouter.
import {
  executeChatCompletion,
  type CompletionOptions,
  type CompletionOutcome,
} from './provider-http';

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

export async function callNvidia(
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  options: CompletionOptions = {}
): Promise<CompletionOutcome> {
  return executeChatCompletion({
    url: NVIDIA_URL,
    apiKey,
    modelId,
    systemPrompt,
    userContent,
    label: 'nvidia',
    includeReasoning: false,
    options,
  });
}
