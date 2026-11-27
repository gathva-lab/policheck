import { beforeEach, describe, it, expect, vi } from 'vitest';
import { JEV_MODEL } from '@/lib/ai/jev';

const h = vi.hoisted(() => {
  type Chain = Record<string, (...args: unknown[]) => unknown>;

  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];

  interface TestModelConfig {
    id: string;
    model_id: string;
    tier: string;
    is_active: boolean;
    priority?: number;
    fallback_id?: string | null;
  }

  const defaultModels: TestModelConfig[] = [
    { id: 'free', model_id: 'nvidia/nemotron-3-ultra-550b-a55b:free', tier: 'free', is_active: true, priority: 50, fallback_id: null },
    { id: 'deepseek', model_id: 'deepseek/deepseek-v4.1-flash', tier: 'eco', is_active: true, priority: 10, fallback_id: null },
    { id: 'tencent', model_id: 'tencent/hy4-flash', tier: 'eco', is_active: true, priority: 10, fallback_id: null },
  ];
  let modelConfigs = defaultModels;

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
      return { data: modelConfigs, error: null };
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

  class MockNoTranscriptError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NoTranscriptError';
    }
  }

  return {
    updates,
    inserts,
    chain,
    setModelConfigs: (rows: TestModelConfig[]) => {
      modelConfigs = rows;
    },
    resetModelConfigs: () => {
      modelConfigs = defaultModels;
    },
    NoTranscriptError: MockNoTranscriptError,
    extractArticle: vi.fn(),
    extractYoutube: vi.fn(),
    isYoutubeUrl: (url: string) => /(youtube\.com|youtu\.be)/i.test(url),
    callModel: vi.fn(),
    isVerifiable: vi.fn(),
    verifyConsensusVerdict: vi.fn(),
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
  extractYoutube: h.extractYoutube,
  extractDomain: () => 'ejemplo.cl',
  isYoutubeUrl: h.isYoutubeUrl,
  NoTranscriptError: h.NoTranscriptError,
  MIN_CONTENT_CHARS: 200,
}));

vi.mock('@/lib/ai/llm', () => ({
  callModel: h.callModel,
  modelTimeoutFor: (inputChars: number) => (inputChars < 6000 ? 45000 : 75000),
}));

vi.mock('@/lib/ai/jev', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/jev')>();
  return {
    ...actual,
    isVerifiable: h.isVerifiable,
    verifyConsensusVerdict: h.jevConsensus,
    jevConsensus: h.jevConsensus,
    jevCostUsd: () => 0,
  };
});

beforeEach(() => {
  h.resetModelConfigs();
  h.inserts.length = 0;
  h.updates.length = 0;
  h.jevConsensus.mockReset();
  h.jevConsensus.mockResolvedValue(null);
});

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
    const json = (await response.json()) as {
      error?: string;
      source_id?: string;
      chars?: number;
      reason?: string;
    };

    expect(response.status).toBe(422);
    expect(json.source_id).toBe('source-1');
    expect(json.chars).toBe('22 de octubre de 2017'.length);
    expect(json.reason).toBe('contenido_insuficiente');
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

describe('/api/analyze transcripción ausente', () => {
  it('responde 422 con reason sin_transcripcion cuando los tres intentos fallan', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';

    h.updates.length = 0;
    h.callModel.mockReset();
    h.isVerifiable.mockReset();
    h.extractYoutube.mockReset();
    h.extractArticle.mockReset();
    h.extractYoutube.mockRejectedValue(
      new h.NoTranscriptError(
        'No se pudo obtener la transcripción del video. YouTube puede estar limitando las peticiones; intenta de nuevo en unos minutos.'
      )
    );

    const { POST } = await import('@/app/api/analyze/route');
    const request = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://www.youtube.com/watch?v=JgvC9xaUKN8',
        politicianId: 'politico-1',
      }),
    });

    const response = await POST(request);
    const json = (await response.json()) as { error?: string; source_id?: string; reason?: string };

    expect(response.status).toBe(422);
    expect(json.source_id).toBe('source-1');
    expect(json.reason).toBe('sin_transcripcion');
    expect(json.error).toContain('No se pudo obtener la transcripción de este video');
    expect(h.isVerifiable).not.toHaveBeenCalled();
    expect(h.callModel).not.toHaveBeenCalled();
  });
});

describe('/api/analyze telemetría de transcripción', () => {
  it('persiste transcript_method en source_quality del report_json', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';

    h.inserts.length = 0;
    h.callModel.mockReset();
    h.isVerifiable.mockReset();
    h.jevConsensus.mockReset();
    h.extractYoutube.mockReset();
    h.extractYoutube.mockResolvedValue({
      title: 'Video',
      text: 'contenido factual suficiente '.repeat(20),
      sourceType: 'video_youtube',
      transcriptUsed: true,
      transcriptWords: 120,
      transcriptMethod: 'caption-tracks',
    });
    h.isVerifiable.mockResolvedValue(null);
    h.jevConsensus.mockResolvedValue(null);
    h.callModel.mockImplementation(async (modelId: string) => ({
      model: modelId,
      content:
        '{"verdict_label":"discutible","veracity_score":65,"coherence_score":70,"summary":"ok"}',
      inputTokens: 20,
      outputTokens: 10,
      latencyMs: 5,
    }));

    const { POST } = await import('@/app/api/analyze/route');
    const request = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://www.youtube.com/watch?v=JgvC9xaUKN8',
        politicianId: 'politico-1',
      }),
    });

    await POST(request);

    const reportRows = h.inserts
      .filter((insert) => insert.table === 'ai_reports')
      .map((insert) => insert.values);

    expect(reportRows.length).toBeGreaterThan(0);
    const firstReport = reportRows[0] as { report_json?: { source_quality?: { transcript_method?: unknown } } };
    expect(firstReport.report_json?.source_quality?.transcript_method).toBe('caption-tracks');
  });
});

describe('/api/analyze diagnóstico de modelos sin reporte', () => {
  it('registra error_reason timeout, empty y parse_failed con coste cero', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';

    h.inserts.length = 0;
    h.callModel.mockReset();
    h.isVerifiable.mockReset();
    h.jevConsensus.mockReset();
    h.extractArticle.mockReset();
    h.extractArticle.mockResolvedValue({
      title: 'Nota',
      text: 'contenido factual suficiente '.repeat(20),
      sourceType: 'articulo_noticia',
      transcriptUsed: false,
      transcriptWords: 0,
    });
    h.isVerifiable.mockResolvedValue(null);
    h.jevConsensus.mockResolvedValue(null);
    h.callModel.mockImplementation(async (
      modelId: string,
      _apiKey: string,
      _prompt: string,
      _content: string,
      onFailure?: (reason: string) => void
    ) => {
      if (modelId === 'nvidia/nemotron-3-ultra-550b-a55b:free') {
        onFailure?.('timeout');
        return null;
      }
      if (modelId === 'deepseek/deepseek-v4.1-flash') {
        onFailure?.('empty');
        return null;
      }
      return { model: modelId, content: 'esto no es JSON', inputTokens: 10, outputTokens: 5, latencyMs: 1 };
    });

    const { POST } = await import('@/app/api/analyze/route');
    const request = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://ejemplo.cl/nota', politicianId: 'politico-1' }),
    });

    await POST(request);

    const failureRows = h.inserts
      .filter((insert) => insert.table === 'ai_cost_log')
      .map((insert) => insert.values)
      .filter((values) => typeof values.error_reason === 'string');

    expect(failureRows).toHaveLength(3);
    expect(failureRows.map((row) => row.error_reason).sort()).toEqual(['empty', 'parse_failed', 'timeout']);
    expect(failureRows.every((row) => row.cost_usd === 0)).toBe(true);
    expect(failureRows.every((row) => row.input_tokens === 0 && row.output_tokens === 0)).toBe(true);
  });
});

describe('/api/analyze señales separadas (acuerdo vs respaldo JEV)', () => {
  it('3 modelos coincidentes con soportado 0.50 guardan agreement 100 y jev_support 50', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';

    h.updates.length = 0;
    h.callModel.mockReset();
    h.isVerifiable.mockReset();
    h.jevConsensus.mockReset();
    h.extractArticle.mockReset();
    h.extractArticle.mockResolvedValue({
      title: 'Nota',
      text: 'contenido factual suficiente '.repeat(20),
      sourceType: 'articulo_noticia',
      transcriptUsed: false,
      transcriptWords: 0,
    });
    h.isVerifiable.mockResolvedValue(null);
    h.jevConsensus.mockResolvedValue({
      choice: 'soportado',
      confidence: 0.25,
      probabilities: { soportado: 0.5, parcial: 0.38, no_soportado: 0.12 },
      usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
      latencyMs: 1,
    });
    h.callModel.mockImplementation(async (modelId: string) => ({
      model: modelId,
      content:
        '{"verdict_label":"discutible","veracity_score":65,"coherence_score":70,"summary":"ok"}',
      inputTokens: 20,
      outputTokens: 10,
      latencyMs: 5,
    }));

    const { POST } = await import('@/app/api/analyze/route');
    const request = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://ejemplo.cl/nota', politicianId: 'politico-1' }),
    });

    await POST(request);

    const finalUpdate = h.updates.find(
      (update) => update.table === 'sources' && 'consensus_agreement' in update.values
    );
    // El acuerdo entre modelos es unánime (100) y no se mezcla con JEV.
    expect(finalUpdate?.values.consensus_agreement).toBe(100);
    // El respaldo de JEV se guarda aparte en escala 0–100: 0.50 → 50.
    expect(finalUpdate?.values.jev_support).toBe(50);
    // soportado >= 0.5 no veta aunque la confidence sea baja (0.25).
    expect(finalUpdate?.values.requires_review).toBe(false);
    expect(finalUpdate?.values.analysis_error).toBeNull();
  });

  it('el atajo de contenido no verificable guarda consensus_agreement 100', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';

    h.updates.length = 0;
    h.callModel.mockReset();
    h.isVerifiable.mockReset();
    h.extractArticle.mockReset();
    h.extractArticle.mockResolvedValue({
      title: 'Opinión',
      text: 'texto de opinión '.repeat(20),
      sourceType: 'articulo_noticia',
      transcriptUsed: false,
      transcriptWords: 0,
    });
    h.isVerifiable.mockResolvedValue({
      verificable: false,
      probability: 0.2,
      usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
      latencyMs: 1,
    });

    const { POST } = await import('@/app/api/analyze/route');
    const request = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://ejemplo.cl/nota', politicianId: 'politico-1' }),
    });

    await POST(request);

    const skippedUpdate = h.updates.find(
      (update) =>
        update.table === 'sources' && update.values.status === 'verificada' && 'consensus_agreement' in update.values
    );
    expect(skippedUpdate?.values.consensus_agreement).toBe(100);
    expect(skippedUpdate?.values.jev_support).toBeNull();
  });

  it('la zona ambigua veta con la nota jev_ambiguous', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';

    h.updates.length = 0;
    h.callModel.mockReset();
    h.isVerifiable.mockReset();
    h.jevConsensus.mockReset();
    h.extractArticle.mockReset();
    h.extractArticle.mockResolvedValue({
      title: 'Nota',
      text: 'contenido factual suficiente '.repeat(20),
      sourceType: 'articulo_noticia',
      transcriptUsed: false,
      transcriptWords: 0,
    });
    h.isVerifiable.mockResolvedValue(null);
    h.jevConsensus.mockResolvedValue({
      choice: 'parcial',
      confidence: 0.9,
      probabilities: { soportado: 0.3, parcial: 0.4, no_soportado: 0.3 },
      usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
      latencyMs: 1,
    });
    h.callModel.mockImplementation(async (modelId: string) => ({
      model: modelId,
      content:
        '{"verdict_label":"discutible","veracity_score":65,"coherence_score":70,"summary":"ok"}',
      inputTokens: 20,
      outputTokens: 10,
      latencyMs: 5,
    }));

    const { POST } = await import('@/app/api/analyze/route');
    const request = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://ejemplo.cl/nota', politicianId: 'politico-1' }),
    });

    await POST(request);

    const finalUpdate = h.updates.find(
      (update) => update.table === 'sources' && 'consensus_agreement' in update.values
    );
    expect(finalUpdate?.values.consensus_agreement).toBe(100);
    expect(finalUpdate?.values.jev_support).toBe(30);
    expect(finalUpdate?.values.requires_review).toBe(true);
    expect(finalUpdate?.values.analysis_error).toBe('jev_ambiguous');
  });

  it('marca jev_degraded cuando el consenso tuvo menos de 3 corridas', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';

    h.updates.length = 0;
    h.callModel.mockReset();
    h.isVerifiable.mockReset();
    h.jevConsensus.mockReset();
    h.extractArticle.mockReset();
    h.extractArticle.mockResolvedValue({
      title: 'Nota',
      text: 'contenido factual suficiente '.repeat(20),
      sourceType: 'articulo_noticia',
      transcriptUsed: false,
      transcriptWords: 0,
    });
    h.isVerifiable.mockResolvedValue(null);
    h.jevConsensus.mockResolvedValue({
      choice: 'soportado',
      confidence: 0.8,
      probabilities: { soportado: 0.5, parcial: 0.1, no_soportado: 0.4 },
      usage: { inputTokens: 300, outputTokens: 0, totalTokens: 300 },
      latencyMs: 30,
      runs: 3,
      degraded: true,
      spread: 0.4,
      perRun: [
        { choice: 'soportado', soportado: 0.3, confidence: 0.8 },
        { choice: 'soportado', soportado: 0.7, confidence: 0.8 },
      ],
    });
    h.callModel.mockImplementation(async (modelId: string) => ({
      model: modelId,
      content:
        '{"verdict_label":"discutible","veracity_score":65,"coherence_score":70,"summary":"ok"}',
      inputTokens: 20,
      outputTokens: 10,
      latencyMs: 5,
    }));

    const { POST } = await import('@/app/api/analyze/route');
    const request = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://ejemplo.cl/nota', politicianId: 'politico-1' }),
    });

    await POST(request);

    const finalUpdate = h.updates.find(
      (update) => update.table === 'sources' && 'consensus_agreement' in update.values
    );
    expect(finalUpdate?.values.requires_review).toBe(true);
    expect(finalUpdate?.values.status).toBe('requiere_revision');
    expect(finalUpdate?.values.analysis_error).toBe('jev_degraded');
  });

  it('registra el coste de las 3 corridas sumado en una sola fila', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';

    h.inserts.length = 0;
    h.callModel.mockReset();
    h.isVerifiable.mockReset();
    h.jevConsensus.mockReset();
    h.extractArticle.mockReset();
    h.extractArticle.mockResolvedValue({
      title: 'Nota',
      text: 'contenido factual suficiente '.repeat(20),
      sourceType: 'articulo_noticia',
      transcriptUsed: false,
      transcriptWords: 0,
    });
    h.isVerifiable.mockResolvedValue(null);
    h.jevConsensus.mockResolvedValue({
      choice: 'soportado',
      confidence: 0.8,
      probabilities: { soportado: 0.5, parcial: 0.1, no_soportado: 0.4 },
      usage: { inputTokens: 600, outputTokens: 0, totalTokens: 600 },
      latencyMs: 30,
      runs: 3,
      degraded: false,
      spread: 0.1,
      perRun: [
        { choice: 'soportado', soportado: 0.5, confidence: 0.8 },
        { choice: 'soportado', soportado: 0.5, confidence: 0.8 },
        { choice: 'soportado', soportado: 0.5, confidence: 0.8 },
      ],
    });
    h.callModel.mockImplementation(async (modelId: string) => ({
      model: modelId,
      content:
        '{"verdict_label":"discutible","veracity_score":65,"coherence_score":70,"summary":"ok"}',
      inputTokens: 20,
      outputTokens: 10,
      latencyMs: 5,
    }));

    const { POST } = await import('@/app/api/analyze/route');
    const request = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://ejemplo.cl/nota', politicianId: 'politico-1' }),
    });

    await POST(request);

    const jevRows = h.inserts
      .filter((insert) => insert.table === 'ai_cost_log')
      .map((insert) => insert.values)
      .filter((values) => values.model_id === JEV_MODEL);

    expect(jevRows).toHaveLength(1);
    expect(jevRows[0].input_tokens).toBe(600);
    expect(jevRows[0].output_tokens).toBe(0);
  });
});

describe('/api/analyze fallbacks', () => {
  it('descarta un fallback inactivo y no lo llama', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';

    h.setModelConfigs([
      { id: 'free', model_id: 'nvidia/nemotron-3-ultra-550b-a55b:free', tier: 'free', is_active: true, priority: 50, fallback_id: 'inactive' },
      { id: 'deepseek', model_id: 'deepseek/deepseek-v4.1-flash', tier: 'eco', is_active: true, priority: 10, fallback_id: null },
      { id: 'tencent', model_id: 'tencent/hy4-flash', tier: 'eco', is_active: true, priority: 10, fallback_id: null },
      { id: 'inactive', model_id: 'deepseek/deepseek-v3.2', tier: 'eco', is_active: false, priority: 5, fallback_id: null },
    ]);

    h.callModel.mockReset();
    h.isVerifiable.mockReset();
    h.jevConsensus.mockReset();
    h.extractArticle.mockReset();
    h.extractArticle.mockResolvedValue({
      title: 'Nota',
      text: 'contenido factual suficiente '.repeat(20),
      sourceType: 'articulo_noticia',
      transcriptUsed: false,
      transcriptWords: 0,
    });
    h.isVerifiable.mockResolvedValue(null);
    h.jevConsensus.mockResolvedValue(null);
    h.callModel.mockImplementation(async (
      _modelId: string,
      _apiKey: string,
      _prompt: string,
      _content: string,
      onFailure?: (reason: string) => void
    ) => {
      onFailure?.('empty');
      return null;
    });

    const { POST } = await import('@/app/api/analyze/route');
    const request = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://ejemplo.cl/nota', politicianId: 'politico-1' }),
    });

    await POST(request);

    const called = h.callModel.mock.calls.map((call) => call[0]);
    expect(called).not.toContain('deepseek/deepseek-v3.2');
    expect(called).toHaveLength(3);
  });

  it('registra dos filas con el mismo source_id cuando se usa un fallback', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';

    const fallbackModel = 'deepseek/deepseek-v4.1-fallback';
    h.setModelConfigs([
      { id: 'free', model_id: 'nvidia/nemotron-3-ultra-550b-a55b:free', tier: 'free', is_active: true, priority: 50, fallback_id: 'fb' },
      { id: 'deepseek', model_id: 'deepseek/deepseek-v4.1-flash', tier: 'eco', is_active: true, priority: 10, fallback_id: null },
      { id: 'tencent', model_id: 'tencent/hy4-flash', tier: 'eco', is_active: true, priority: 10, fallback_id: null },
      { id: 'fb', model_id: fallbackModel, tier: 'eco', is_active: true, priority: 99, fallback_id: null },
    ]);

    h.callModel.mockReset();
    h.isVerifiable.mockReset();
    h.jevConsensus.mockReset();
    h.extractArticle.mockReset();
    h.extractArticle.mockResolvedValue({
      title: 'Nota',
      text: 'contenido factual suficiente '.repeat(20),
      sourceType: 'articulo_noticia',
      transcriptUsed: false,
      transcriptWords: 0,
    });
    h.isVerifiable.mockResolvedValue(null);
    h.jevConsensus.mockResolvedValue(null);
    h.callModel.mockImplementation(async (
      modelId: string,
      _apiKey: string,
      _prompt: string,
      _content: string,
      onFailure?: (reason: string) => void
    ) => {
      if (modelId === fallbackModel) {
        return {
          model: modelId,
          content: '{"verdict_label":"verdadero","veracity_score":80,"coherence_score":80,"summary":"ok"}',
          inputTokens: 20,
          outputTokens: 10,
          latencyMs: 5,
        };
      }
      onFailure?.('empty');
      return null;
    });

    const { POST } = await import('@/app/api/analyze/route');
    const request = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://ejemplo.cl/nota', politicianId: 'politico-1' }),
    });

    await POST(request);

    const costRows = h.inserts
      .filter((insert) => insert.table === 'ai_cost_log')
      .map((insert) => insert.values);

    const primaryRow = costRows.find((row) => row.model_id === 'nvidia/nemotron-3-ultra-550b-a55b:free');
    const fallbackRow = costRows.find((row) => row.model_id === fallbackModel);

    expect(primaryRow?.error_reason).toBe('empty');
    expect(fallbackRow).toBeDefined();
    expect(fallbackRow?.error_reason).toBeUndefined();
    expect(primaryRow?.source_id).toBe('source-1');
    expect(fallbackRow?.source_id).toBe('source-1');
    expect(
      costRows.filter((row) => row.model_id === 'nvidia/nemotron-3-ultra-550b-a55b:free')
    ).toHaveLength(1);
  });
});

describe('/api/analyze cortacircuitos de timeout', () => {
  it('un timeout no dispara el fallback del modelo', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';

    const fallbackModel = 'deepseek/deepseek-v4.1-fallback';
    h.setModelConfigs([
      { id: 'free', model_id: 'nvidia/nemotron-3-ultra-550b-a55b:free', tier: 'free', is_active: true, priority: 50, fallback_id: 'fb' },
      { id: 'deepseek', model_id: 'deepseek/deepseek-v4.1-flash', tier: 'eco', is_active: true, priority: 10, fallback_id: null },
      { id: 'tencent', model_id: 'tencent/hy4-flash', tier: 'eco', is_active: true, priority: 10, fallback_id: null },
      { id: 'fb', model_id: fallbackModel, tier: 'eco', is_active: true, priority: 99, fallback_id: null },
    ]);

    h.inserts.length = 0;
    h.callModel.mockReset();
    h.isVerifiable.mockReset();
    h.jevConsensus.mockReset();
    h.extractArticle.mockReset();
    h.extractArticle.mockResolvedValue({
      title: 'Nota',
      text: 'contenido factual suficiente '.repeat(20),
      sourceType: 'articulo_noticia',
      transcriptUsed: false,
      transcriptWords: 0,
    });
    h.isVerifiable.mockResolvedValue(null);
    h.jevConsensus.mockResolvedValue(null);
    h.callModel.mockImplementation(async (
      modelId: string,
      _apiKey: string,
      _prompt: string,
      _content: string,
      onFailure?: (reason: string) => void
    ) => {
      if (modelId === 'nvidia/nemotron-3-ultra-550b-a55b:free') {
        onFailure?.('timeout');
        return null;
      }
      return {
        model: modelId,
        content:
          '{"verdict_label":"discutible","veracity_score":65,"coherence_score":70,"summary":"ok"}',
        inputTokens: 20,
        outputTokens: 10,
        latencyMs: 5,
      };
    });

    const { POST } = await import('@/app/api/analyze/route');
    const request = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://ejemplo.cl/nota', politicianId: 'politico-1' }),
    });

    await POST(request);

    const called = h.callModel.mock.calls.map((call) => call[0]);
    expect(called).not.toContain(fallbackModel);
    expect(called.filter((modelId) => modelId === 'nvidia/nemotron-3-ultra-550b-a55b:free')).toHaveLength(1);

    const timeoutRows = h.inserts
      .filter((insert) => insert.table === 'ai_cost_log')
      .map((insert) => insert.values)
      .filter((values) => values.error_reason === 'timeout');
    expect(timeoutRows).toHaveLength(1);
  });
});
