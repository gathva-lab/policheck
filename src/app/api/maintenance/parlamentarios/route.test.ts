import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  type Fila = Record<string, unknown>;

  const tablas: Record<string, Fila[]> = {
    parliamentarians: [],
    politicians: [],
  };

  class Consulta {
    private tabla: string;
    private modo: 'select' | 'update' = 'select';
    private filtros: Array<{ operacion: 'eq' | 'neq' | 'in'; columna: string; valor: unknown }> = [];
    private valores: Fila | null = null;
    private orden: { columna: string; ascendente: boolean } | null = null;
    private soloUno = false;

    constructor(tabla: string) {
      this.tabla = tabla;
    }

    select(_columnas?: string) {
      void _columnas;
      return this;
    }

    eq(columna: string, valor: unknown) {
      this.filtros.push({ operacion: 'eq', columna, valor });
      return this;
    }

    neq(columna: string, valor: unknown) {
      this.filtros.push({ operacion: 'neq', columna, valor });
      return this;
    }

    in(columna: string, valor: unknown[]) {
      this.filtros.push({ operacion: 'in', columna, valor });
      return this;
    }

    order(columna: string, opciones?: { ascending?: boolean }) {
      this.orden = { columna, ascendente: opciones?.ascending ?? true };
      return this;
    }

    update(valores: Fila) {
      this.modo = 'update';
      this.valores = valores;
      return this;
    }

    maybeSingle() {
      this.soloUno = true;
      return this;
    }

    single() {
      this.soloUno = true;
      return this;
    }

    async upsert(filas: Fila[], opciones?: { onConflict?: string }) {
      const conflicto = opciones?.onConflict ?? 'id';
      for (const fila of filas) {
        const existente = tablas[this.tabla].find(
          (actual) => actual[conflicto] === fila[conflicto]
        );
        if (existente) {
          Object.assign(existente, fila);
        } else {
          tablas[this.tabla].push({ ...fila });
        }
      }
      return { data: null, error: null };
    }

    private coincide(fila: Fila): boolean {
      return this.filtros.every(({ operacion, columna, valor }) => {
        if (operacion === 'eq') return fila[columna] === valor;
        if (operacion === 'neq') return fila[columna] !== valor;
        return Array.isArray(valor) && valor.includes(fila[columna]);
      });
    }

    private ejecutar() {
      const filas = tablas[this.tabla] ?? [];

      if (this.modo === 'update') {
        const afectadas = filas.filter((fila) => this.coincide(fila));
        if (this.valores) {
          for (const fila of afectadas) Object.assign(fila, this.valores);
        }
        return { data: this.soloUno ? (afectadas[0] ?? null) : afectadas, error: null };
      }

      let resultado = filas.filter((fila) => this.coincide(fila));
      if (this.orden) {
        const { columna, ascendente } = this.orden;
        resultado = [...resultado].sort((a, b) => {
          const textoA = String(a[columna] ?? '');
          const textoB = String(b[columna] ?? '');
          return ascendente ? textoA.localeCompare(textoB) : textoB.localeCompare(textoA);
        });
      }

      return { data: this.soloUno ? (resultado[0] ?? null) : resultado, error: null };
    }

    then(
      resolver: (valor: { data: unknown; error: null }) => unknown,
      rechazar?: (motivo: unknown) => unknown
    ) {
      try {
        resolver(this.ejecutar());
      } catch (error) {
        rechazar?.(error);
      }
    }
  }

  return {
    tablas,
    from: (tabla: string) => new Consulta(tabla),
    reset: () => {
      tablas.parliamentarians.length = 0;
      tablas.politicians.length = 0;
    },
  };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: h.from }),
}));

const XML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<senadores>
  <senador>
    <PARLID>101</PARLID>
    <PARLAPELLIDOPATERNO>P&eacute;rez</PARLAPELLIDOPATERNO>
    <PARLAPELLIDOMATERNO>Mu&ntilde;oz</PARLAPELLIDOMATERNO>
    <PARLNOMBRE>Jos&eacute;</PARLNOMBRE>
    <REGION>Valpara&iacute;so</REGION>
    <CIRCUNSCRIPCION>Circunscripci&oacute;n 6</CIRCUNSCRIPCION>
    <PARTIDO>Partido Alfa</PARTIDO>
    <EMAIL>jose@senado.cl</EMAIL>
    <CURRICULUM>https://www.senado.cl/jose</CURRICULUM>
  </senador>
  <senador>
    <PARLID>202</PARLID>
    <PARLAPELLIDOPATERNO>Gonz&aacute;lez</PARLAPELLIDOPATERNO>
    <PARLAPELLIDOMATERNO>Rojas</PARLAPELLIDOMATERNO>
    <PARLNOMBRE>Mar&iacute;a</PARLNOMBRE>
    <REGION>Metropolitana</REGION>
    <CIRCUNSCRIPCION>Circunscripci&oacute;n 7</CIRCUNSCRIPCION>
    <PARTIDO>Partido Beta</PARTIDO>
    <EMAIL></EMAIL>
    <CURRICULUM></CURRICULUM>
  </senador>
</senadores>`;

function solicitud(method: string, body?: unknown): Request {
  return new Request('http://localhost/api/maintenance/parlamentarios', {
    method,
    headers: {
      'x-sweep-key': 'sweep-key',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  h.reset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.SWEEP_KEY = 'sweep-key';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/maintenance/parlamentarios', () => {
  it('hace upsert idempotente por parl_id: dos llamadas no duplican filas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(new Response(XML, { status: 200 })))
    );
    const { POST } = await import('./route');

    const primera = await POST(solicitud('POST'));
    const primerBody = (await primera.json()) as Record<string, unknown>;

    expect(primera.status).toBe(200);
    expect(primerBody).toMatchObject({ ok: true, total: 2, nuevos: 2, actualizados: 0 });
    expect(h.tablas.parliamentarians).toHaveLength(2);

    const segunda = await POST(solicitud('POST'));
    const segundoBody = (await segunda.json()) as Record<string, unknown>;

    expect(segunda.status).toBe(200);
    expect(segundoBody).toMatchObject({ ok: true, total: 2, nuevos: 0, actualizados: 2 });
    expect(h.tablas.parliamentarians).toHaveLength(2);
    expect(h.tablas.parliamentarians.map((fila) => fila.parl_id).sort()).toEqual(['101', '202']);
  });
});

describe('PATCH /api/maintenance/parlamentarios', () => {
  it('rechaza con 400 un politician_id ya vinculado a otro parl_id', async () => {
    h.tablas.parliamentarians.push(
      { parl_id: '101', politician_id: 'politico-1', match_confirmado: true },
      { parl_id: '202', politician_id: null, match_confirmado: false }
    );
    const { PATCH } = await import('./route');

    const response = await PATCH(
      solicitud('PATCH', { parlId: '202', politicianId: 'politico-1' })
    );
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('ya está vinculado');
    expect(h.tablas.parliamentarians[1].politician_id).toBeNull();
    expect(h.tablas.parliamentarians[1].match_confirmado).toBe(false);
  });

  it('confirma un vínculo libre y marca match_confirmado', async () => {
    h.tablas.parliamentarians.push({
      parl_id: '202',
      politician_id: null,
      match_confirmado: false,
    });
    const { PATCH } = await import('./route');

    const response = await PATCH(
      solicitud('PATCH', { parlId: '202', politicianId: 'politico-2' })
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      parl_id: '202',
      politician_id: 'politico-2',
      match_confirmado: true,
    });
    expect(h.tablas.parliamentarians[0].politician_id).toBe('politico-2');
    expect(h.tablas.parliamentarians[0].match_confirmado).toBe(true);
  });
});
