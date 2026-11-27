import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callModel, checkModel, providerForModel } from './llm';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

function success(content = '{"ok":true}'): Response {
  return jsonResponse({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
}

const originalNvidiaKey = process.env.NVIDIA_API_KEY;

function fetchUrl(call: unknown[]): string {
  return String(call[0]);
}

function fetchBody(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

describe('providerForModel', () => {
  it('enruta a NVIDIA los modelos marcados y a OpenRouter el resto', () => {
    expect(providerForModel('nvidia/nemotron-3-ultra-550b-a55b:free')).toBe('nvidia');
    expect(providerForModel('nvidia/nemotron-3.5-lightning-30b-a3b')).toBe('nvidia');
    expect(providerForModel('nvidia/nemotron-3.5-lightning:free')).toBe('nvidia');
    expect(providerForModel('minimaxai/minimax-m3.1-flash')).toBe('nvidia');
    expect(providerForModel('z-ai/glm-5.3-flash')).toBe('nvidia');
    expect(providerForModel('deepseek/deepseek-v4.1-flash')).toBe('openrouter');
  });

  it('prioriza el provider configurado en ai_model_config sobre el mapa', () => {
    expect(providerForModel('deepseek/deepseek-v4.1-flash', 'nvidia')).toBe('nvidia');
    expect(providerForModel('nvidia/nemotron-3-ultra-550b-a55b:free', 'openrouter')).toBe(
      'openrouter'
    );
    expect(providerForModel('nvidia/nemotron-3-ultra-550b-a55b:free', null)).toBe('nvidia');
  });
});

describe('callModel enrutamiento por proveedor', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NVIDIA_API_KEY = 'nvidia-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (originalNvidiaKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = originalNvidiaKey;
  });

  it('usa NVIDIA con Bearer de NVIDIA_API_KEY y desactiva reasoning', async () => {
    const fetchMock = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('fetch', fetchMock);

    const result = await callModel(
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'openrouter-key',
      'sistema',
      'usuario'
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(fetchUrl(call)).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer nvidia-key');
    const body = fetchBody(call);
    expect(body.model).toBe('nvidia/nemotron-3-ultra-550b-a55b');
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.temperature).toBe(0.2);
    expect(result?.provider).toBe('nvidia');
    expect(result?.model).toBe('nvidia/nemotron-3-ultra-550b-a55b:free');
  });

  it('reintenta sin el campo reasoning si NVIDIA responde 400', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 400))
      .mockResolvedValueOnce(success());
    vi.stubGlobal('fetch', fetchMock);

    const result = await callModel(
      'nvidia/nemotron-3.5-lightning-30b-a3b',
      'openrouter-key',
      'sistema',
      'usuario'
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchUrl(fetchMock.mock.calls[0])).toBe(
      'https://integrate.api.nvidia.com/v1/chat/completions'
    );
    expect(fetchUrl(fetchMock.mock.calls[1])).toBe(
      'https://integrate.api.nvidia.com/v1/chat/completions'
    );
    expect(fetchBody(fetchMock.mock.calls[0]).reasoning).toEqual({ enabled: false });
    expect(fetchBody(fetchMock.mock.calls[1])).not.toHaveProperty('reasoning');
    expect(result?.provider).toBe('nvidia');
  });

  it('traduce el alias :free de nemotron 3.5 al id real de NVIDIA', async () => {
    const fetchMock = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('fetch', fetchMock);

    const result = await callModel(
      'nvidia/nemotron-3.5-lightning:free',
      'openrouter-key',
      'sistema',
      'usuario'
    );

    expect(fetchUrl(fetchMock.mock.calls[0])).toBe(
      'https://integrate.api.nvidia.com/v1/chat/completions'
    );
    expect(fetchBody(fetchMock.mock.calls[0]).model).toBe(
      'nvidia/nemotron-3.5-lightning-30b-a3b'
    );
    expect(result?.provider).toBe('nvidia');
  });

  it('expone finish_reason en el resultado exitoso', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ finish_reason: 'stop', message: { content: 'OK' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        })
      )
    );

    const result = await callModel(
      'deepseek/deepseek-v4.1-flash',
      'openrouter-key',
      'sistema',
      'usuario'
    );

    expect(result?.finishReason).toBe('stop');
  });

  it('usa OpenRouter y envía reasoning para el resto de modelos', async () => {
    const fetchMock = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('fetch', fetchMock);

    const result = await callModel(
      'deepseek/deepseek-v4.1-flash',
      'openrouter-key',
      'sistema',
      'usuario'
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(fetchUrl(call)).toBe('https://openrouter.ai/api/v1/chat/completions');
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer openrouter-key');
    expect(fetchBody(call).reasoning).toEqual({ enabled: false });
    expect(result?.provider).toBe('openrouter');
  });

  it('si falta NVIDIA_API_KEY cae a OpenRouter sin romper', async () => {
    delete process.env.NVIDIA_API_KEY;
    const fetchMock = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('fetch', fetchMock);

    const result = await callModel(
      'minimaxai/minimax-m3.1-flash',
      'openrouter-key',
      'sistema',
      'usuario'
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(fetchUrl(call)).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(fetchBody(call).model).toBe('minimax/minimax-m3.1-flash');
    expect(result?.provider).toBe('openrouter');
  });

  it('si NVIDIA falla con HTTP 5xx reintenta el mismo modelo por OpenRouter', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(success());
    vi.stubGlobal('fetch', fetchMock);

    const result = await callModel(
      'nvidia/nemotron-3.5-lightning-30b-a3b',
      'openrouter-key',
      'sistema',
      'usuario'
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = fetchMock.mock.calls[0];
    const second = fetchMock.mock.calls[1];
    expect(fetchUrl(first)).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(fetchUrl(second)).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(fetchBody(second).model).toBe('nvidia/nemotron-3.5-lightning:free');
    expect(result?.provider).toBe('openrouter');
  });

  it('si NVIDIA agota el timeout reintenta el mismo modelo por OpenRouter', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url: unknown, init: RequestInit | undefined) => {
      if (String(url).includes('integrate.api.nvidia.com')) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('AbortError')));
        });
      }
      return Promise.resolve(success());
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = callModel(
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'openrouter-key',
      'sistema',
      'usuario',
      undefined,
      { timeoutMs: 1000, retryOn429: false }
    );
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchUrl(fetchMock.mock.calls[1])).toBe(
      'https://openrouter.ai/api/v1/chat/completions'
    );
    expect(result?.provider).toBe('openrouter');
  });
});


describe('checkModel', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NVIDIA_API_KEY = 'nvidia-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalNvidiaKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = originalNvidiaKey;
  });

  it('reporta el provider real de ai_model_config, sin fallback y con 200 tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(success('OK'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkModel('z-ai/glm-5.3-flash', 'openrouter-key', {
      maxTokens: 200,
      provider: 'nvidia',
    });

    expect(fetchUrl(fetchMock.mock.calls[0])).toBe(
      'https://integrate.api.nvidia.com/v1/chat/completions'
    );
    expect(fetchBody(fetchMock.mock.calls[0]).max_tokens).toBe(200);
    expect(result.provider).toBe('nvidia');
    expect(result.provider_used).toBe('nvidia');
    expect(result.fallback_used).toBe(false);
    expect(result.routed_model_id).toBe('z-ai/glm-5.3-flash');
  });

  it('marca fallback_used y reporta OpenRouter cuando NVIDIA falla y se reintenta', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(success('OK'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkModel('nvidia/nemotron-3.5-lightning-30b-a3b', 'openrouter-key', {
      provider: 'nvidia',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe('openrouter');
    expect(result.provider_used).toBe('openrouter');
    expect(result.fallback_used).toBe(true);
    expect(result.routed_model_id).toBe('nvidia/nemotron-3.5-lightning:free');
  });
});
