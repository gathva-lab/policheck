import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  askJev,
  isVerifiable,
  verifyConsensusVerdict,
  jevConsensus,
  evaluateConsensusVeto,
  jevSupportFromProbabilities,
  JEV_MODEL,
} from './jev';

// Mocks de las dependencias de la ruta /api/analyze. No afectan a JEV, que usa
// el fetch global mockeado para probar sus propias respuestas.
const h = vi.hoisted(() => {
  type Chain = Record<string, (...args: unknown[]) => unknown>;

  const inserts: Array<{ table: string; values: unknown }> = [];

  function result(table: string, methods: string[]): unknown {
    const has = (method: string) => methods.includes(method);
    if (table === 'sources') {
      if (has('insert')) {
        return { data: { id: 'source-1', url: 'https://ejemplo.cl/nota', status: 'no_verificada' }, error: null };
      }
      if (has('update')) {
        return {
          data: {
            id: 'source-1',
            status: 'verificada',
            verdict: 'inchequeable',
            verdict_score: 0,
            consensus_agreement: 1,
            requires_review: false,
          },
          error: null,
        };
      }
      if (has('gte')) return { count: 0, error: null };
      return { data: null, error: null };
    }
    if (table === 'media_outlets') {
      if (has('insert')) return { data: { id: 'outlet-1' }, error: null };
      return { data: null, error: null };
    }
    if (table === 'ai_model_config') return { data: [], error: null };
    if (table === 'ai_reports') return { data: [], error: null };
    if (table === 'ai_cost_log') return { error: null };
    return { data: null, error: null };
  }

  function chain(table: string): Chain {
    const methods: string[] = [];
    const target: Chain = {};
    for (const name of ['select', 'eq', 'gte', 'lte', 'insert', 'update', 'delete', 'order', 'limit']) {
      target[name] = (...args: unknown[]) => {
        methods.push(name);
        if (name === 'insert') inserts.push({ table, values: args[0] });
        return target;
      };
    }
    target.maybeSingle = () => Promise.resolve(result(table, methods));
    target.single = () => Promise.resolve(result(table, methods));
    target.then = (resolve: (...args: unknown[]) => unknown) => resolve(result(table, methods));
    return target;
  }

  return {
    inserts,
    chain,
    fetchMock: vi.fn(),
    callModel: vi.fn(),
    extractArticle: vi.fn(),
    extractYoutube: vi.fn(),
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

vi.mock('@/lib/ai/openrouter', () => ({
  callModel: h.callModel,
  modelTimeoutFor: (inputChars: number) => (inputChars < 6000 ? 45000 : 75000),
}));

function mockJson(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  h.fetchMock.mockReset();
  vi.stubGlobal('fetch', h.fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isVerifiable', () => {
  it('marca no verificable cuando noul es bajo (0.2)', async () => {
    h.fetchMock.mockResolvedValue(
      mockJson({ verificable: { noul: 0.2, confidence: 0.9 }, usage: { input_tokens: 120 } })
    );

    const result = await isVerifiable('texto de opinión', 'Título', 'api-key');

    expect(result?.verificable).toBe(false);
    expect(result?.probability).toBe(0.2);
  });

  it('marca verificable cuando noul es alto (0.9)', async () => {
    h.fetchMock.mockResolvedValue(
      mockJson({ verificable: { noul: 0.9, confidence: 0.95 }, usage: { input_tokens: 140 } })
    );

    const result = await isVerifiable('cifras y hechos', 'Título', 'api-key');

    expect(result?.verificable).toBe(true);
    expect(result?.probability).toBe(0.9);
  });

  it('envía solo los primeros 6000 caracteres al modelo', async () => {
    h.fetchMock.mockResolvedValue(mockJson({ verificable: { noul: 0.9 } }));

    await isVerifiable('a'.repeat(7000), 'Título', 'api-key');

    const body = JSON.parse(h.fetchMock.mock.calls[0][1].body as string) as {
      model: string;
      state: { extracto: string };
    };
    expect(body.model).toBe(JEV_MODEL);
    expect(body.state.extracto).toHaveLength(6000);
  });
});

describe('askJev', () => {
  it('devuelve null ante timeout', async () => {
    h.fetchMock.mockImplementation((_url: unknown, init: RequestInit | undefined) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('AbortError')));
      });
    });

    const result = await askJev({ verificable: { type: 'noul', instructions: 'x' } }, {}, 'api-key', 10);

    expect(result).toBeNull();
  });

  it('devuelve null ante HTTP 500', async () => {
    h.fetchMock.mockResolvedValue(mockJson({}, 500));

    const result = await askJev({ verificable: { type: 'noul', instructions: 'x' } }, {}, 'api-key');

    expect(result).toBeNull();
  });
});

describe('criterio de veto por probabilidades', () => {
  it('soportado >= 0.5 no veta aunque no_soportado tenga algo de masa', () => {
    expect(
      evaluateConsensusVeto({ soportado: 0.5, parcial: 0.38, no_soportado: 0.12 })
    ).toEqual({ veto: false, reason: null });
  });

  it('no_soportado >= 0.5 veta de forma firme', () => {
    expect(evaluateConsensusVeto({ soportado: 0.2, parcial: 0.2, no_soportado: 0.6 })).toEqual({
      veto: true,
      reason: 'no_soportado',
    });
  });

  it('la zona ambigua (ninguna >= 0.5) veta con jev_ambiguous', () => {
    expect(
      evaluateConsensusVeto({ soportado: 0.3, parcial: 0.4, no_soportado: 0.3 })
    ).toEqual({ veto: true, reason: 'jev_ambiguous' });
  });
});

describe('jevSupportFromProbabilities', () => {
  it('convierte la probabilidad 0–1 al porcentaje 0–100', () => {
    expect(jevSupportFromProbabilities({ soportado: 0.5 })).toBe(50);
    expect(jevSupportFromProbabilities({ soportado: 0.28 })).toBe(28);
  });

  it('devuelve null si no hay probabilidad de soporte', () => {
    expect(jevSupportFromProbabilities({})).toBeNull();
    expect(jevSupportFromProbabilities(null)).toBeNull();
  });
});

describe('verifyConsensusVerdict', () => {
  it('detecta un veredicto no soportado', async () => {
    h.fetchMock.mockResolvedValue(
      mockJson({
        soporte: {
          choice: 'no_soportado',
          confidence: 0.85,
          probabilities: { soportado: 0.05, parcial: 0.1, no_soportado: 0.85 },
        },
        usage: { input_tokens: 200 },
      })
    );

    const result = await verifyConsensusVerdict('enganoso', 25, 'Justificación', 'extracto', 'api-key');

    expect(result?.choice).toBe('no_soportado');
    expect(result?.confidence).toBe(0.85);
  });

  it('evalúa coherencia razonable y no literalidad en la pregunta de soporte', async () => {
    h.fetchMock.mockResolvedValue(
      mockJson({
        soporte: {
          choice: 'soportado',
          confidence: 0.9,
          probabilities: { soportado: 0.9 },
        },
      })
    );

    await verifyConsensusVerdict('verdadero', 80, 'Justificación', 'extracto', 'api-key');

    const body = JSON.parse(h.fetchMock.mock.calls[0][1].body as string) as {
      questions: {
        soporte: { instructions: string; criteria: Record<string, string> };
      };
    };
    expect(body.questions.soporte.instructions).toContain('coherente con el contenido');
    expect(body.questions.soporte.instructions).toContain('aunque no cite cada frase');
    expect(body.questions.soporte.criteria.soportado).toContain(
      'aunque el resumen no reproduzca frases literales'
    );
  });

  it('verifica con el texto completo: 20.000 chars se trocean a 12.000 (inicio y final)', async () => {
    h.fetchMock.mockResolvedValue(
      mockJson({
        soporte: {
          choice: 'soportado',
          confidence: 0.9,
          probabilities: { soportado: 0.9, parcial: 0.05, no_soportado: 0.05 },
        },
        usage: { input_tokens: 300 },
      })
    );

    const longText = `INICIO-${'a'.repeat(19980)}-FINAL`;
    await verifyConsensusVerdict('verdadero', 80, 'Justificación', longText, 'api-key');

    const body = JSON.parse(h.fetchMock.mock.calls[0][1].body as string) as {
      state: { extracto: string };
    };
    expect(body.state.extracto).toHaveLength(12000);
    expect(body.state.extracto.startsWith('INICIO-')).toBe(true);
    expect(body.state.extracto.endsWith('-FINAL')).toBe(true);
  });
});

describe('jevConsensus', () => {
  function soporteResponse(soportado: number, confidence = 0.8, choice = 'soportado') {
    return mockJson({
      soporte: {
        choice,
        confidence,
        probabilities: {
          soportado,
          parcial: 0.1,
          no_soportado: Math.max(0, 1 - soportado - 0.1),
        },
      },
      usage: { input_tokens: 100 },
    });
  }

  it('3 corridas 0.5 / 0.2 / 0.5 → mediana 0.5 y no veta', async () => {
    h.fetchMock
      .mockResolvedValueOnce(soporteResponse(0.5))
      .mockResolvedValueOnce(soporteResponse(0.2))
      .mockResolvedValueOnce(soporteResponse(0.5));

    const result = await jevConsensus('verdadero', 80, 'Justificación', 'extracto', 'api-key');

    expect(result?.probabilities.soportado).toBe(0.5);
    expect(evaluateConsensusVeto(result?.probabilities).veto).toBe(false);
    expect(result?.degraded).toBe(false);
    expect(result?.runs).toBe(3);
    expect(result?.perRun).toHaveLength(3);
    // spread = max(0.5) - min(0.2)
    expect(result?.spread).toBeCloseTo(0.3, 5);
  });

  it('3 corridas 0.2 / 0.2 / 0.6 → mediana 0.2 y veta', async () => {
    h.fetchMock
      .mockResolvedValueOnce(soporteResponse(0.2, 0.8, 'no_soportado'))
      .mockResolvedValueOnce(soporteResponse(0.2, 0.8, 'no_soportado'))
      .mockResolvedValueOnce(soporteResponse(0.6, 0.8, 'soportado'));

    const result = await jevConsensus('discutible', 60, 'Justificación', 'extracto', 'api-key');

    expect(result?.probabilities.soportado).toBe(0.2);
    expect(evaluateConsensusVeto(result?.probabilities)).toEqual({
      veto: true,
      reason: 'no_soportado',
    });
  });

  it('1 de 3 falla → usa 2 corridas y marca degraded', async () => {
    h.fetchMock
      .mockResolvedValueOnce(soporteResponse(0.4))
      .mockResolvedValueOnce(mockJson({}, 500))
      .mockResolvedValueOnce(soporteResponse(0.6));

    const result = await jevConsensus('verdadero', 80, 'Justificación', 'extracto', 'api-key');

    expect(result).not.toBeNull();
    expect(result?.degraded).toBe(true);
    expect(result?.runs).toBe(3);
    expect(result?.perRun).toHaveLength(2);
    expect(result?.probabilities.soportado).toBe(0.5);
  });

  it('3 de 3 fallan → null', async () => {
    h.fetchMock
      .mockResolvedValueOnce(mockJson({}, 500))
      .mockResolvedValueOnce(mockJson({}, 500))
      .mockResolvedValueOnce(mockJson({}, 500));

    const result = await jevConsensus('verdadero', 80, 'Justificación', 'extracto', 'api-key');

    expect(result).toBeNull();
  });

  it('suma el coste de las 3 corridas', async () => {
    const withUsage = (inputTokens: number) =>
      mockJson({
        soporte: {
          choice: 'soportado',
          confidence: 0.8,
          probabilities: { soportado: 0.6, parcial: 0.2, no_soportado: 0.2 },
        },
        usage: { input_tokens: inputTokens },
      });
    h.fetchMock
      .mockResolvedValueOnce(withUsage(100))
      .mockResolvedValueOnce(withUsage(200))
      .mockResolvedValueOnce(withUsage(300));

    const result = await jevConsensus('verdadero', 80, 'Justificación', 'extracto', 'api-key');

    expect(result?.usage.inputTokens).toBe(600);
    expect(result?.usage.totalTokens).toBe(600);
  });

  it('la moda desempata por mayor confidence', async () => {
    h.fetchMock
      .mockResolvedValueOnce(soporteResponse(0.5, 0.4, 'parcial'))
      .mockResolvedValueOnce(soporteResponse(0.5, 0.9, 'soportado'));

    const result = await jevConsensus('verdadero', 80, 'Justificación', 'extracto', 'api-key', 2);

    expect(result?.choice).toBe('soportado');
    expect(result?.confidence).toBeCloseTo(0.65, 5);
  });
});

describe('/api/analyze con filtro JEV', () => {
  it('no llama a ningún LLM cuando el contenido no es verificable', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';

    h.inserts.length = 0;
    h.callModel.mockReset();
    h.extractArticle.mockReset();
    h.extractArticle.mockResolvedValue({
      title: 'Opinión sin hechos',
      text: 'texto de opinión '.repeat(20),
      sourceType: 'articulo_noticia',
      transcriptUsed: false,
      transcriptWords: 0,
    });
    h.fetchMock.mockResolvedValue(
      mockJson({ verificable: { noul: 0.2 }, usage: { input_tokens: 150 } })
    );

    const { POST } = await import('@/app/api/analyze/route');
    const request = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://ejemplo.cl/nota', politicianId: 'politico-1' }),
    });

    const response = await POST(request);
    const json = (await response.json()) as { skipped_llm?: boolean; reason?: string };

    expect(json.skipped_llm).toBe(true);
    expect(json.reason).toBe('contenido_no_verificable');
    expect(h.callModel).not.toHaveBeenCalled();
    expect(
      h.inserts.some(
        (insert) =>
          insert.table === 'ai_cost_log' &&
          typeof insert.values === 'object' &&
          insert.values !== null &&
          (insert.values as { model_id?: string }).model_id === JEV_MODEL
      )
    ).toBe(true);
  });
});
