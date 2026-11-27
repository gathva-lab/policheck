import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  interface Row {
    model_id: string;
    provider?: string | null;
  }
  let rows: Row[] = [];
  return {
    setRows: (next: Row[]) => {
      rows = next;
    },
    getRows: () => rows,
  };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: h.getRows(), error: null }),
        }),
      }),
    }),
  }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

function completion(content = 'OK'): Response {
  return jsonResponse({
    choices: [{ finish_reason: 'stop', message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 1 },
  });
}

function catalog(ids: string[]): Response {
  return jsonResponse({ data: ids.map((id) => ({ id })) });
}

function isCatalogCall(call: unknown[]): boolean {
  return String(call[0]) === 'https://integrate.api.nvidia.com/v1/models';
}

function request(key = 'sweep-key'): Request {
  return new Request('http://localhost/api/maintenance/models-check', {
    method: 'POST',
    headers: { 'x-sweep-key': key },
  });
}

function requestWithoutKey(): Request {
  return new Request('http://localhost/api/maintenance/models-check', {
    method: 'POST',
  });
}

describe('/api/maintenance/models-check validación NVIDIA', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    process.env.OPENROUTER_API_KEY = 'openrouter-key';
    process.env.NVIDIA_API_KEY = 'nvidia-key';
    process.env.SWEEP_KEY = 'sweep-key';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reporta modelo_no_existe_en_proveedor con el id real y consulta el catálogo una vez', async () => {
    h.setRows([
      { model_id: 'nvidia/nemotron-3.5-lightning:free', provider: 'nvidia' },
      { model_id: 'minimaxai/minimax-m3.1-flash', provider: 'nvidia' },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(catalog(['otro/modelo']));
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('./route');
    const response = await POST(request());
    const results = (await response.json()) as Array<Record<string, unknown>>;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isCatalogCall(fetchMock.mock.calls[0])).toBe(true);
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.provider_used).toBe('nvidia');
      expect(result.fallback_used).toBe(false);
      expect(result.error_reason).toBe('modelo_no_existe_en_proveedor');
    }
    expect(results[0].routed_model_id).toBe('nvidia/nemotron-3.5-lightning-30b-a3b');
  });

  it('usa el provider de ai_model_config y reporta el proveedor realmente usado', async () => {
    h.setRows([{ model_id: 'nvidia/nemotron-3-ultra-550b-a55b:free', provider: 'nvidia' }]);
    const fetchMock = vi.fn((url: unknown) => {
      if (String(url) === 'https://integrate.api.nvidia.com/v1/models') {
        return Promise.resolve(catalog(['nvidia/nemotron-3-ultra-550b-a55b']));
      }
      return Promise.resolve(completion());
    });
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('./route');
    const response = await POST(request());
    const results = (await response.json()) as Array<Record<string, unknown>>;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results[0].provider).toBe('nvidia');
    expect(results[0].provider_used).toBe('nvidia');
    expect(results[0].fallback_used).toBe(false);
    expect(results[0].ok).toBe(true);
    expect(results[0].finish_reason).toBe('stop');
  });
});

describe('/api/maintenance/models-check autorización', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    process.env.SWEEP_KEY = 'sweep-key';
    h.setRows([]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sin cabecera devuelve un mensaje accionable y no responde 200', async () => {
    const { POST } = await import('./route');
    const response = await POST(requestWithoutKey());
    const body = (await response.json()) as { error?: string; hint?: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Falta la cabecera x-sweep-key');
    expect(body.hint).toContain('sin los signos < >');
  });

  it('acepta la clave válida enviada por SWEEP_KEY', async () => {
    const { POST } = await import('./route');
    const response = await POST(request('sweep-key'));

    expect(response.status).toBe(200);
  });

  it('acepta la clave válida enviada por SUPABASE_SERVICE_ROLE_KEY', async () => {
    delete process.env.SWEEP_KEY;
    const { POST } = await import('./route');
    const response = await POST(request('service-role'));

    expect(response.status).toBe(200);
  });

  it('con clave incorrecta distingue el error de una cabecera ausente', async () => {
    const { POST } = await import('./route');
    const response = await POST(request('clave-incorrecta'));
    const body = (await response.json()) as { error?: string; hint?: string };

    expect(response.status).toBe(401);
    expect(body.error).toContain('SWEEP_KEY');
    expect(body.error).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(body.hint).toBeUndefined();
  });
});
