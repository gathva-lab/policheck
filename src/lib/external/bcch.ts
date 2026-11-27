// Conector con la Base de Datos Estadísticos (BDE) del Banco Central de Chile.
// Documenta aquí las tres trampas verificadas de la API, porque cada una tiene
// su propio tratamiento más abajo:
//   1. Un token inválido responde HTTP 200 con { Codigo: -5 }. Nunca se debe
//      confiar en el status HTTP: hay que validar Codigo === 0.
//   2. Los fines de semana y feriados llegan con statusCode "ND" y value "NaN".
//      Hay que filtrar por statusCode === 'OK' y por value numérico.
//   3. La respuesta está en ISO-8859-1; los acentos llegan rotos si se usa
//      response.json(). Se decodifica con TextDecoder('iso-8859-1') sobre el
//      ArrayBuffer.

export interface BcchSeriesInfo {
  id: string;
  label: string;
  keywords: string[];
  unit: string;
  freq: 'diaria' | 'mensual';
}

// Catálogo de series verificadas en producción el 2026-11-27.
export const BCCH_SERIES: BcchSeriesInfo[] = [
  {
    id: 'F073.TCO.PRE.Z.D',
    label: 'Dólar observado',
    keywords: ['dólar', 'tipo de cambio', 'peso'],
    unit: 'CLP/USD',
    freq: 'diaria',
  },
  {
    id: 'F074.IPC.VAR.Z.EP23.C.M',
    label: 'Inflación mensual (IPC)',
    keywords: ['inflación', 'ipc', 'costo de vida', 'precios'],
    unit: '%',
    freq: 'mensual',
  },
  {
    id: 'F073.UFF.PRE.Z.D',
    label: 'UF',
    keywords: ['uf', 'unidad de fomento'],
    unit: 'CLP',
    freq: 'diaria',
  },
  {
    id: 'F073.UTR.PRE.Z.M',
    label: 'UTM',
    keywords: ['utm', 'unidad tributaria'],
    unit: 'CLP',
    freq: 'mensual',
  },
];

export interface BcchObservation {
  date: string;
  value: number;
}

export interface BcchSeries {
  seriesId: string;
  description: string;
  observations: BcchObservation[];
}

export interface BcchSearchResult {
  seriesId: string;
  description: string;
}

export interface GetSeriesParams {
  seriesId: string;
  firstDate?: string;
  lastDate?: string;
}

const BCCH_ENDPOINT = 'https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx';
export const BCCH_TIMEOUT_MS = 10000;

interface RawObservation {
  indexDateString?: unknown;
  value?: unknown;
  statusCode?: unknown;
}

interface RawSeries {
  descripEsp?: unknown;
  seriesId?: unknown;
  Obs?: unknown;
}

interface RawResponse {
  Codigo?: unknown;
  Descripcion?: unknown;
  Series?: RawSeries;
  SeriesInfos?: unknown;
}

// La API entrega dd-MM-yyyy; el resto del sistema usa yyyy-mm-dd.
export function normalizeDate(raw: string): string | null {
  const value = raw.trim();
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

async function fetchBcch(
  params: URLSearchParams,
  apiKey: string
): Promise<RawResponse | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BCCH_TIMEOUT_MS);
  try {
    params.set('token', apiKey);
    const response = await fetch(`${BCCH_ENDPOINT}?${params.toString()}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    // Trampa 3: ISO-8859-1. Se lee el ArrayBuffer y se decodifica explícitamente.
    const text = new TextDecoder('iso-8859-1').decode(await response.arrayBuffer());
    return JSON.parse(text) as RawResponse;
  } catch (error) {
    console.error('[bcch] Error consultando la API:', {
      error: error instanceof Error ? error.message : error,
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getSeries(
  params: GetSeriesParams,
  apiKey: string
): Promise<BcchSeries | null> {
  if (!apiKey) return null;

  const search = new URLSearchParams();
  search.set('function', 'GetSeries');
  search.set('timeseries', params.seriesId);
  if (params.firstDate) search.set('firstdate', params.firstDate);
  if (params.lastDate) search.set('lastdate', params.lastDate);

  const data = await fetchBcch(search, apiKey);
  if (!data) return null;

  // Trampa 1: token inválido llega con HTTP 200 y Codigo -5. Validar siempre.
  if (data.Codigo !== 0) {
    console.error('[bcch] La API rechazó la consulta:', {
      codigo: data.Codigo,
      descripcion: data.Descripcion,
      seriesId: params.seriesId,
    });
    return null;
  }

  const series = data.Series;
  if (!series || !Array.isArray(series.Obs)) return null;

  const observations: BcchObservation[] = [];
  for (const raw of series.Obs as RawObservation[]) {
    if (!raw || typeof raw !== 'object') continue;
    // Trampa 2: "ND" en fines de semana/feriados y value "NaN".
    if (raw.statusCode !== 'OK') continue;
    const value = typeof raw.value === 'number' ? raw.value : Number(raw.value);
    if (!Number.isFinite(value)) continue;
    const rawDate = typeof raw.indexDateString === 'string' ? raw.indexDateString : '';
    const date = normalizeDate(rawDate);
    if (!date) continue;
    observations.push({ date, value });
  }

  return {
    seriesId: typeof series.seriesId === 'string' ? series.seriesId : params.seriesId,
    description: typeof series.descripEsp === 'string' ? series.descripEsp : '',
    observations,
  };
}

// SearchSeries permite descubrir IDs de series por texto. La forma exacta de la
// respuesta puede variar, así que se tolera tanto SeriesInfos como Series.
export async function searchSeries(
  query: string,
  apiKey: string
): Promise<BcchSearchResult[]> {
  if (!apiKey) return [];

  const search = new URLSearchParams();
  search.set('function', 'SearchSeries');
  search.set('search', query);

  const data = await fetchBcch(search, apiKey);
  if (!data) return [];

  if (data.Codigo !== 0) {
    console.error('[bcch] SearchSeries rechazado:', {
      codigo: data.Codigo,
      descripcion: data.Descripcion,
    });
    return [];
  }

  const rawList = Array.isArray(data.SeriesInfos)
    ? data.SeriesInfos
    : Array.isArray(data.Series)
      ? data.Series
      : [];

  const results: BcchSearchResult[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const seriesId = obj.seriesId ?? obj.SeriesId ?? obj.id;
    if (typeof seriesId !== 'string' || !seriesId.trim()) continue;
    const description = obj.descripEsp ?? obj.Descripcion ?? obj.description ?? '';
    results.push({
      seriesId: seriesId.trim(),
      description: typeof description === 'string' ? description : '',
    });
  }
  return results;
}

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatObservationDate(date: string, freq: BcchSeriesInfo['freq']): string {
  const [year, month, day] = date.split('-');
  if (freq === 'mensual') {
    const index = Number(month) - 1;
    return `${MONTHS_ES[index] ?? month}-${year}`;
  }
  return `${day}-${month}-${year}`;
}

export interface BcchContextEntry {
  info: BcchSeriesInfo;
  series: BcchSeries | null;
}

// Construye el bloque que se antepone al contenido de usuario de cada modelo.
// Devuelve null si no hay ninguna observación real que inyectar.
export function buildOfficialContext(
  entries: BcchContextEntry[],
  consultedAt: Date = new Date()
): string | null {
  const lines: string[] = [];
  for (const { info, series } of entries) {
    if (!series || series.observations.length === 0) continue;
    const values = series.observations
      .map((obs) => `${formatObservationDate(obs.date, info.freq)} ${obs.value}`)
      .join(' · ');
    lines.push(`- ${info.label} (${info.unit}): ${values}`);
  }

  if (lines.length === 0) return null;

  const day = consultedAt.toISOString().slice(0, 10);
  return [
    `DATOS OFICIALES DEL BANCO CENTRAL DE CHILE (consultados el ${day}):`,
    ...lines,
    'Fuente oficial: Banco Central de Chile, Base de Datos Estadísticos (si3.bcentral.cl).',
    'Usa SOLO estos datos para contrastar cifras. Si el político cita un dato que difiere,',
    'indícalo en external_evidence con la cifra oficial y su fecha.',
  ].join('\n');
}
