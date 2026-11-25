import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => {
  type Chain = Record<string, (...args: unknown[]) => unknown>;

  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];

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
    if (table === 'ai_model_config') return { data: [], error: null };
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
    chain,
    extractArticle: vi.fn(),
    extractYoutube: vi.fn(),
    callModel: vi.fn(),
    isVerifiable: vi.fn(),
    verifyConsensusVerdict: vi.fn(),
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
  extractYoutube: h.extractYoutube,
  extractDomain: () => 'ejemplo.cl',
  isYoutubeUrl: () => false,
  MIN_CONTENT_CHARS: 200,
}));

vi.mock('@/lib/ai/openrouter', () => ({ callModel: h.callModel }));

vi.mock('@/lib/ai/jev', () => ({
  isVerifiable: h.isVerifiable,
  verifyConsensusVerdict: h.verifyConsensusVerdict,
  jevCostUsd: () => 0,
  JEV_MODEL: 'typesafe/jev-1.14',
}));

describe('/api/analyze validación de contenido mínimo', () => {
  it('devuelve 422, marca requiere_revision y no llama a JEV ni a modelos', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';

    h.updates.length = 0;
    h.callModel.mockReset();
    h.isVerifiable.mockReset();
    h.extractYoutube.mockReset();
    h.extractArticle.mockReset();
    h.extractArticle.mockResolvedValue({
      title: 'Video corto',
      text: '22 de octubre de 2017',
      sourceType: 'video_youtube',
      transcriptUsed: false,
      transcriptWords: 0,
    });

    const { POST } = await import('@/app/api/analyze/route');
    const request = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://ejemplo.cl/nota', politicianId: 'politico-1' }),
    });

    const response = await POST(request);
    const json = (await response.json()) as { error?: string; source_id?: string; chars?: number };

    expect(response.status).toBe(422);
    expect(json.source_id).toBe('source-1');
    expect(json.chars).toBe('22 de octubre de 2017'.length);
    expect(h.isVerifiable).not.toHaveBeenCalled();
    expect(h.callModel).not.toHaveBeenCalled();
    expect(
      h.updates.some(
        (update) =>
          update.table === 'sources' &&
          update.values.status === 'requiere_revision' &&
          update.values.requires_review === true
      )
    ).toBe(true);
  });
});
