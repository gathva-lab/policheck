import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  type Chain = Record<string, (...args: unknown[]) => unknown>;

  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];
  const callModel = vi.fn();

  function result(table: string, methods: string[]): unknown {
    const has = (method: string) => methods.includes(method);
    if (table === 'sources') {
      if (has('insert')) {
        return { data: { id: 'source-1', url: 'https://ejemplo.cl/nota', status: 'procesando' }, error: null };
      }
      if (has('update')) return { data: { id: 'source-1' }, error: null };
      if (has('gte')) return { count: 0, error: null };
      return { data: null, error: null };
    }
    if (table === 'media_outlets') return { data: { id: 'outlet-1' }, error: null };
    if (table === 'ai_model_config') {
      return {
        data: [
          { id: 'free', model_id: 'nvidia/nemotron-3-ultra-550b-a55b:free', tier: 'free', is_active: true, priority: 50, fallback_id: null },
          { id: 'deepseek', model_id: 'deepseek/deepseek-v4.1-flash', tier: 'eco', is_active: true, priority: 10, fallback_id: null },
          { id: 'tencent', model_id: 'tencent/hy4-flash', tier: 'eco', is_active: true, priority: 10, fallback_id: null },
        ],
        error: null,
      };
    }
    if (table === 'ai_reports') return { data: [], error: null, count: 0 };
    if (table === 'ai_cost_log') return { error: null };
    return { data: null, error: null };
  }

  function chain(table: string): Chain {
    const methods: string[] = [];
    const target: Chain = {};
    for (const name of ['select', 'eq', 'gte', 'lt', 'in', 'insert', 'update', 'delete', 'order', 'limit']) {
      target[name] = (...args: unknown[]) => {
        methods.push(name);
        if (name === 'update') updates.push({ table, values: args[0] as Record<string, unknown> });
        if (name === 'insert') inserts.push({ table, values: args[0] as Record<string, unknown> });
        return target;
      };
    }
    target.maybeSingle = () => Promise.resolve(result(table, methods));
    target.single = () => Promise.resolve(result(table, methods));
    target.then = (resolve: (...args: unknown[]) => unknown) => resolve(result(table, methods));
    return target;
  }

  return {
    updates,
    inserts,
    chain,
    callModel,
    extractArticle: vi.fn(),
    isVerifiable: vi.fn(),
    jevConsensus: vi.fn(),
  };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => h.chain(table) }),
}));

vi.mock('@/utils/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => h.chain(table),
  }),
}));

vi.mock('@/lib/ai/extract', () => ({
  extractArticle: h.extractArticle,
  extractYoutube: h.extractArticle,
  extractDomain: () => 'ejemplo.cl',
  isYoutubeUrl: () => false,
  MIN_CONTENT_CHARS: 200,
}));

vi.mock('@/lib/ai/llm', () => ({
  callModel: h.callModel,
  modelTimeoutFor: () => 45000,
}));

vi.mock('@/lib/ai/jev', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/jev')>();
  return {
    ...actual,
    isVerifiable: h.isVerifiable,
    jevConsensus: h.jevConsensus,
    jevCostUsd: () => 0,
  };
});

function bcchPayload(): Response {
  return new Response(
    JSON.stringify({
      Codigo: 0,
      Descripcion: 'Success',
      Series: {
        descripEsp: 'Variación mensual del IPC',
        seriesId: 'F074.IPC.VAR.Z.EP23.C.M',
        Obs: [{ indexDateString: '31-10-2026', value: '0.5', statusCode: 'OK' }],
      },
    }),
    { status: 200 }
  );
}

async function runAnalysis(contentText: string) {
  h.extractArticle.mockResolvedValue({
    title: 'Nota',
    text: contentText,
    sourceType: 'articulo_noticia',
    transcriptUsed: false,
    transcriptWords: 0,
  });
  h.callModel.mockResolvedValue({
    model: 'deepseek/deepseek-v4.1-flash',
    content: '{"verdict_label":"discutible","veracity_score":65,"coherence_score":70,"summary":"ok"}',
    inputTokens: 20,
    outputTokens: 10,
    latencyMs: 5,
  });

  const { POST } = await import('@/app/api/analyze/route');
  const request = new Request('http://localhost/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://ejemplo.cl/nota', politicianId: 'politico-1' }),
  });
  await POST(request);
}

beforeEach(() => {
  vi.resetModules();
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';
  process.env.BCCH_API_KEY = 'test-bcch-key';
  h.inserts.length = 0;
  h.updates.length = 0;
  h.callModel.mockReset();
  h.extractArticle.mockReset();
  h.isVerifiable.mockReset();
  h.jevConsensus.mockReset();
  h.isVerifiable.mockResolvedValue(null);
  h.jevConsensus.mockResolvedValue(null);
});

describe('/api/analyze contraste con el Banco Central', () => {
  it('antepone el bloque oficial y registra bcch:bde cuando hay indicadores', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bcchPayload());
    vi.stubGlobal('fetch', fetchMock);

    try {
      await runAnalysis('La inflación mensual fue de 0,5% según el político. '.repeat(6));

      const userContent = h.callModel.mock.calls[0]?.[3] as string;
      expect(userContent).toContain('DATOS OFICIALES DEL BANCO CENTRAL DE CHILE');
      expect(userContent).toContain('oct-2026 0.5');

      const externalRows = h.inserts
        .filter((insert) => insert.table === 'ai_cost_log')
        .map((insert) => insert.values)
        .filter((values) => values.model_id === 'bcch:bde');
      expect(externalRows).toHaveLength(1);
      expect(externalRows[0].cost_usd).toBe(0);
      expect(externalRows[0].tier).toBe('external');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('no inyecta el bloque ni llama a la API cuando no detecta indicadores', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    try {
      await runAnalysis('El partido ganó las elecciones municipales. '.repeat(8));

      const userContent = h.callModel.mock.calls[0]?.[3] as string;
      expect(userContent).not.toContain('DATOS OFICIALES DEL BANCO CENTRAL');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(
        h.inserts.some((insert) => insert.table === 'ai_cost_log' && insert.values.model_id === 'bcch:bde')
      ).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('continúa el análisis (fail-open) si la API externa falla', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    try {
      await runAnalysis('La inflación y el IPC fueron el tema central. '.repeat(8));

      expect(h.callModel).toHaveBeenCalledTimes(3);
      const userContent = h.callModel.mock.calls[0]?.[3] as string;
      expect(userContent).not.toContain('DATOS OFICIALES DEL BANCO CENTRAL');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
