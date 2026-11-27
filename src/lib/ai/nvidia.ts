// Adaptador de NVIDIA Build (endpoint compatible con OpenAI).
import {
  executeChatCompletion,
  type CompletionOptions,
  type CompletionOutcome,
} from './provider-http';

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
export const NVIDIA_MODELS_URL = 'https://integrate.api.nvidia.com/v1/models';

export async function callNvidia(
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  options: CompletionOptions = {}
): Promise<CompletionOutcome> {
  const base = {
    url: NVIDIA_URL,
    apiKey,
    modelId,
    systemPrompt,
    userContent,
    label: 'nvidia',
    options,
  } as const;

  // Los modelos de razonamiento (*-reasoning, *-a3b, lightning) consumen el
  // max_tokens pensando y devuelven content vacío. Se intenta desactivar el
  // reasoning de forma optimista; si el proveedor rechaza el campo con 400 se
  // reintenta una sola vez sin él.
  const first = await executeChatCompletion({ ...base, includeReasoning: true });
  if (first.httpStatus !== 400) return first;

  console.warn(
    `[nvidia] ${modelId} rechazó el campo reasoning (HTTP 400); reintento sin ese campo`
  );
  return executeChatCompletion({ ...base, includeReasoning: false });
}

interface NvidiaModelEntry {
  id?: unknown;
}

// Catálogo de modelos publicado por NVIDIA Build. Devuelve null si la consulta
// falla: el diagnóstico no debe caerse porque el catálogo no esté disponible.
export async function fetchNvidiaModelCatalog(apiKey: string): Promise<Set<string> | null> {
  try {
    const response = await fetch(NVIDIA_MODELS_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    });
    if (!response.ok) {
      console.warn(`[nvidia] catálogo de modelos devolvió HTTP ${response.status}`);
      return null;
    }
    const data = (await response.json()) as { data?: NvidiaModelEntry[] };
    const ids = (data?.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    return new Set(ids);
  } catch (error) {
    console.warn('[nvidia] no se pudo consultar el catálogo de modelos:', {
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}
