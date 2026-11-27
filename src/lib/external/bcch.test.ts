import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BCCH_SERIES,
  buildOfficialContext,
  getSeries,
  normalizeDate,
  searchSeries,
} from './bcch';

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Codifica un texto como bytes ISO-8859-1 para simular la respuesta real del BCCh.
function latin1Response(text: string): Response {
  const bytes = Uint8Array.from(text, (char) => char.charCodeAt(0));
  return new Response(bytes, { status: 200 });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getSeries: trampas de la API del Banco Central', () => {
  it('devuelve null cuando Codigo es distinto de 0 aunque el HTTP sea 200', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ Codigo: -5, Descripcion: 'Invalid username or password' })
    );

    const result = await getSeries({ seriesId: 'F073.TCO.PRE.Z.D' }, 'token-invalido');

    expect(result).toBeNull();
  });

  it('filtra observaciones con statusCode ND y value NaN', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        Codigo: 0,
        Descripcion: 'Success',
        Series: {
          descripEsp: 'Dólar observado',
          seriesId: 'F073.TCO.PRE.Z.D',
          Obs: [
            { indexDateString: '20-11-2026', value: '1008.79', statusCode: 'OK' },
            { indexDateString: '21-11-2026', value: 'NaN', statusCode: 'ND' },
            { indexDateString: '22-11-2026', value: 'NaN', statusCode: 'OK' },
            { indexDateString: '23-11-2026', value: '1010.50', statusCode: 'OK' },
          ],
        },
      })
    );

    const result = await getSeries({ seriesId: 'F073.TCO.PRE.Z.D' }, 'token');

    expect(result?.observations).toEqual([
      { date: '2026-11-20', value: 1008.79 },
      { date: '2026-11-23', value: 1010.5 },
    ]);
  });

  it('decodifica ISO-8859-1 para que los acentos no lleguen rotos', async () => {
    fetchMock.mockResolvedValue(
      latin1Response(
        JSON.stringify({
          Codigo: 0,
          Descripcion: 'Success',
          Series: {
            descripEsp: 'Variación mensual del IPC',
            seriesId: 'F074.IPC.VAR.Z.EP23.C.M',
            Obs: [{ indexDateString: '31-10-2026', value: '0.5', statusCode: 'OK' }],
          },
        })
      )
    );

    const result = await getSeries({ seriesId: 'F074.IPC.VAR.Z.EP23.C.M' }, 'token');

    expect(result?.description).toBe('Variación mensual del IPC');
  });

  it('normaliza las fechas de dd-MM-yyyy a yyyy-mm-dd', () => {
    expect(normalizeDate('20-11-2026')).toBe('2026-11-20');
    expect(normalizeDate('2026-11-20')).toBe('2026-11-20');
    expect(normalizeDate('fecha inválida')).toBeNull();
  });

  it('sin apiKey no llama a la API y devuelve null', async () => {
    const result = await getSeries({ seriesId: 'F073.TCO.PRE.Z.D' }, '');

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('searchSeries', () => {
  it('tolera un Codigo de error y devuelve un catálogo vacío', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ Codigo: -5, Descripcion: 'invalid' }));

    await expect(searchSeries('dólar', 'token')).resolves.toEqual([]);
  });

  it('mapea los resultados de SeriesInfos', async () => {
    fetchMock.mockResolvedValue(
      latin1Response(
        JSON.stringify({
          Codigo: 0,
          SeriesInfos: [
            { seriesId: 'F073.TCO.PRE.Z.D', descripEsp: 'Dólar observado' },
          ],
        })
      )
    );

    await expect(searchSeries('dólar', 'token')).resolves.toEqual([
      { seriesId: 'F073.TCO.PRE.Z.D', description: 'Dólar observado' },
    ]);
  });
});

describe('buildOfficialContext', () => {
  it('antepone el bloque solo cuando hay observaciones', () => {
    const context = buildOfficialContext(
      [
        {
          info: BCCH_SERIES[1],
          series: {
            seriesId: BCCH_SERIES[1].id,
            description: 'IPC',
            observations: [
              { date: '2026-07-31', value: 0.1 },
              { date: '2026-10-31', value: 0.5 },
            ],
          },
        },
        { info: BCCH_SERIES[0], series: null },
      ],
      new Date('2026-11-27T12:00:00Z')
    );

    expect(context).toContain('DATOS OFICIALES DEL BANCO CENTRAL DE CHILE');
    expect(context).toContain('jul-2026 0.1');
    expect(context).toContain('oct-2026 0.5');
    expect(context).not.toContain('Dólar observado');
  });

  it('devuelve null si no hay datos oficiales', () => {
    expect(buildOfficialContext([], new Date('2026-11-27T12:00:00Z'))).toBeNull();
  });
});
