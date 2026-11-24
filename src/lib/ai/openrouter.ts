const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_TIMEOUT_MS = 90000;

export interface OpenRouterResult {
  model: string;
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export async function callModel(
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userContent: string
): Promise<OpenRouterResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  const start = Date.now();

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
        max_tokens: 2048,
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    const latencyMs = Date.now() - start;

    if (response.status === 429 || response.status >= 500) {
      console.warn(`[openrouter] ${modelId} falló con HTTP ${response.status}`);
      return null;
    }
    if (!response.ok) {
      console.warn(`[openrouter] ${modelId} HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) return null;

    return {
      model: modelId,
      content,
      inputTokens: Number(data?.usage?.prompt_tokens ?? 0),
      outputTokens: Number(data?.usage?.completion_tokens ?? 0),
      latencyMs,
    };
  } catch (error) {
    console.warn(`[openrouter] ${modelId} error:`, error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
