import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callModel, modelTimeoutFor } from './openrouter';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

describe('modelTimeoutFor', () => {
  it('usa 45 s para fuentes cortas y 75 s para fuentes largas', () => {
    expect(modelTimeoutFor(3000)).toBe(45000);
    expect(modelTimeoutFor(12000)).toBe(75000);
  });
});

describe('callModel', () => {
  it('envía temperature 0 para que el clasificador sea reproducible', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
        usage: { prompt_tokens: 10, completion_tokens: 1 },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await callModel('deepseek/deepseek-v4.1-flash', 'key', 'sistema', 'usuario');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(body.temperature).toBe(0);
  });

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('desactiva reasoning, usa max_tokens 6000 y marca empty si solo hubo reasoning', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: '', reasoning: 'razonamiento interno' } }],
        usage: { prompt_tokens: 10, completion_tokens: 0 },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const onFailure = vi.fn();
    const result = await callModel('deepseek/deepseek-v4.1-flash', 'key', 'sistema', 'usuario', onFailure);

    expect(result).toBeNull();
    expect(onFailure).toHaveBeenCalledWith('empty', expect.any(Number));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.max_tokens).toBe(6000);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('razonó sin emitir respuesta'));
  });

  it('clasifica empty_por_limite cuando finish_reason es length y no hay content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ finish_reason: 'length', message: { content: '' } }],
          usage: { prompt_tokens: 10, completion_tokens: 60 },
        })
      )
    );

    const onFailure = vi.fn();
    const result = await callModel('modelo/x', 'key', 'sistema', 'usuario', onFailure);

    expect(result).toBeNull();
    expect(onFailure).toHaveBeenCalledWith('empty_por_limite', expect.any(Number));
  });

  it('clasifica HTTP 402 como falta de crédito', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 402)));

    const onFailure = vi.fn();
    const result = await callModel('modelo/x', 'key', 'sistema', 'usuario', onFailure);

    expect(result).toBeNull();
    expect(onFailure).toHaveBeenCalledWith('http_402', expect.any(Number));
  });

  it('propaga la latencia real (>0) cuando se dispara el timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init: RequestInit | undefined) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('AbortError')));
        });
      })
    );

    const onFailure = vi.fn();
    const promise = callModel('modelo/x', 'key', 'sistema', 'usuario', onFailure, {
      timeoutMs: 1000,
      retryOn429: false,
    });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toBeNull();
    expect(onFailure).toHaveBeenCalledWith('timeout', expect.any(Number));
    const latencyMs = onFailure.mock.calls[0][1] as number;
    expect(latencyMs).toBeGreaterThanOrEqual(1000);
  });

  it('clasifica otros 4xx como http_4xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 404)));

    const onFailure = vi.fn();
    const result = await callModel('modelo/x', 'key', 'sistema', 'usuario', onFailure);

    expect(result).toBeNull();
    expect(onFailure).toHaveBeenCalledWith('http_4xx', expect.any(Number));
  });

  it('reintenta una sola vez con backoff en HTTP 429', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const promise = callModel('modelo/x', 'key', 'sistema', 'usuario');
    await vi.advanceTimersByTimeAsync(1500);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result?.content).toBe('{"ok":true}');
  });

  it('si el reintento de 429 también falla, usa http_429', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 429));
    vi.stubGlobal('fetch', fetchMock);

    const onFailure = vi.fn();
    const promise = callModel('modelo/x', 'key', 'sistema', 'usuario', onFailure);
    await vi.advanceTimersByTimeAsync(1500);
    const result = await promise;

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledWith('http_429', expect.any(Number));
  });
});
