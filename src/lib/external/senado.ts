// Cliente del padrón público de senadores vigentes del Senado de Chile.
// El servicio entrega XML en UTF-8 (sin charset declarado) y puede incluir
// entidades HTML (&aacute;, &ntilde;, &amp;). Si el texto llega doblemente
// codificado se repara con repararDobleEncoding. No se usa una dependencia de
// parseo XML: se extraen las etiquetas con expresiones regulares, igual que se
// hace con otros servicios del proyecto.

export interface ParlamentarioSenado {
  parlId: string;
  nombre: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  region: string;
  circunscripcion: string;
  partido: string;
  email: string | null;
  curriculum: string | null;
}

export const SENADO_SENADORES_URL =
  'https://tramitacion.senado.cl/wspublico/senadores_vigentes.php';

// El WS del Senado puede tardar, pero no debe colgar una sincronización entera.
export const SENADO_TIMEOUT_MS = 15000;

// Tabla de reemplazo manual para no depender de librerías de normalización.
const REEMPLAZO_TILDES: Record<string, string> = {
  á: 'a',
  à: 'a',
  ä: 'a',
  â: 'a',
  é: 'e',
  è: 'e',
  ë: 'e',
  ê: 'e',
  í: 'i',
  ì: 'i',
  ï: 'i',
  î: 'i',
  ó: 'o',
  ò: 'o',
  ö: 'o',
  ô: 'o',
  ú: 'u',
  ù: 'u',
  ü: 'u',
  û: 'u',
  ñ: 'n',
  ç: 'c',
};

// Entidades nombradas que aparecen en el XML del Senado y en HTML básico.
const ENTIDADES: Record<string, string> = {
  aacute: 'á',
  Aacute: 'Á',
  eacute: 'é',
  Eacute: 'É',
  iacute: 'í',
  Iacute: 'Í',
  oacute: 'ó',
  Oacute: 'Ó',
  uacute: 'ú',
  Uacute: 'Ú',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  uuml: 'ü',
  Uuml: 'Ü',
  ccedil: 'ç',
  Ccedil: 'Ç',
  agrave: 'à',
  egrave: 'è',
  iexcl: '¡',
  iquest: '¿',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  laquo: '«',
  raquo: '»',
  deg: '°',
};

// Casos frecuentes de doble codificación: un texto UTF-8 interpretado como
// latin-1 deja "Ã" seguido del byte original (p. ej. "Ã¡" en vez de "á").
const REPARACION_DOBLE_ENCODING: ReadonlyArray<readonly [string, string]> = [
  ['Ã¡', 'á'],
  ['Ã©', 'é'],
  ['Ã\u00ad', 'í'],
  ['Ã³', 'ó'],
  ['Ãº', 'ú'],
  ['Ã±', 'ñ'],
  ['Ã\u0081', 'Á'],
  ['Ã\u0089', 'É'],
  ['Ã\u008d', 'Í'],
  ['Ã\u0093', 'Ó'],
  ['Ã\u009a', 'Ú'],
  ['Ã\u0091', 'Ñ'],
  ['Â\u00a0', ' '],
];

// Repara texto que sufrió doble codificación (UTF-8 leído como latin-1).
// Es idempotente: si el texto ya está correcto no cambia nada.
export function repararDobleEncoding(texto: string): string {
  let resultado = texto;
  for (const [corrupto, correcto] of REPARACION_DOBLE_ENCODING) {
    resultado = resultado.split(corrupto).join(correcto);
  }
  return resultado;
}

// Decodifica entidades nombradas y numéricas. Las entidades se reemplazan en
// una sola pasada para que "&amp;aacute;" quede como "&aacute;" y no como "á".
export function decodificarEntidadesHtml(texto: string): string {
  return texto
    .replace(/&#x([0-9a-fA-F]+);/g, (original, codigo: string) => {
      const punto = Number.parseInt(codigo, 16);
      return Number.isFinite(punto) ? String.fromCodePoint(punto) : original;
    })
    .replace(/&#(\d+);/g, (original, codigo: string) => {
      const punto = Number.parseInt(codigo, 10);
      return Number.isFinite(punto) ? String.fromCodePoint(punto) : original;
    })
    .replace(/&([a-zA-Z]+);/g, (original, nombre: string) => ENTIDADES[nombre] ?? original);
}

function extraerEtiqueta(bloque: string, etiqueta: string): string {
  const patron = new RegExp(
    `<${etiqueta}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${etiqueta}>`,
    'i'
  );
  const coincidencia = patron.exec(bloque);
  if (!coincidencia) return '';

  const contenido = coincidencia[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
  return decodificarEntidadesHtml(contenido).replace(/\s+/g, ' ').trim();
}

function textoONulo(valor: string): string | null {
  return valor.length > 0 ? valor : null;
}

// Parsea el XML completo. Si el cuerpo no es el padrón, lanza un error
// accionable en vez de devolver una lista vacía silenciosa.
export function parsearSenadoresXml(xml: string): ParlamentarioSenado[] {
  if (!/<senadores(?:\s[^>]*)?>/i.test(xml)) {
    throw new Error(
      'El Senado no devolvió el padrón de senadores (no aparece <senadores>). ' +
        'El servicio puede estar en mantenimiento: reintenta más tarde y verifica ' +
        `${SENADO_SENADORES_URL}.`
    );
  }

  const bloques = xml.matchAll(/<senador(?:\s[^>]*)?>([\s\S]*?)<\/senador>/gi);
  const senadores: ParlamentarioSenado[] = [];

  for (const bloque of bloques) {
    const parlId = extraerEtiqueta(bloque[1], 'PARLID');
    if (!parlId) continue;

    senadores.push({
      parlId,
      nombre: repararDobleEncoding(extraerEtiqueta(bloque[1], 'PARLNOMBRE')),
      apellidoPaterno: repararDobleEncoding(extraerEtiqueta(bloque[1], 'PARLAPELLIDOPATERNO')),
      apellidoMaterno: repararDobleEncoding(extraerEtiqueta(bloque[1], 'PARLAPELLIDOMATERNO')),
      region: repararDobleEncoding(extraerEtiqueta(bloque[1], 'REGION')),
      circunscripcion: extraerEtiqueta(bloque[1], 'CIRCUNSCRIPCION'),
      partido: repararDobleEncoding(extraerEtiqueta(bloque[1], 'PARTIDO')),
      email: textoONulo(extraerEtiqueta(bloque[1], 'EMAIL')),
      curriculum: textoONulo(extraerEtiqueta(bloque[1], 'CURRICULUM')),
    });
  }

  if (senadores.length < 20) {
    console.warn(
      `[senado] El padrón devolvió solo ${senadores.length} senadores; ` +
        'puede ser una respuesta parcial del servicio.'
    );
  }

  return senadores;
}

// El WS es público y no requiere autenticación. apiKey se conserva en la firma
// por compatibilidad con el resto de conectores, pero no se envía.
export async function fetchSenadoresVigentes(apiKey?: string): Promise<ParlamentarioSenado[]> {
  void apiKey;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SENADO_TIMEOUT_MS);

  try {
    const response = await fetch(SENADO_SENADORES_URL, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/xml, text/xml, */*' },
    });

    if (!response.ok) {
      throw new Error(
        `El Senado respondió HTTP ${response.status} al pedir el padrón de senadores. ` +
          'El servicio puede estar en mantenimiento.'
      );
    }

    // El servicio devuelve application/xml sin charset, y por la especificación
    // de XML eso significa UTF-8. Se decodifica explícitamente para que los
    // acentos no lleguen rotos antes de procesar las entidades HTML.
    const xml = new TextDecoder('utf-8').decode(await response.arrayBuffer());
    return parsearSenadoresXml(xml);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `El Senado no respondió en ${SENADO_TIMEOUT_MS / 1000} s al pedir el padrón. ` +
          'Reintenta más tarde.'
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Nombre para mostrar. Conserva tildes; la comparación usa normalizarNombre.
export function nombreCompleto(p: ParlamentarioSenado): string {
  return [p.nombre, p.apellidoPaterno, p.apellidoMaterno]
    .map((parte) => parte.trim())
    .filter((parte) => parte.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalización sin dependencias: minúsculas, sin tildes, sin puntuación y con
// espacios colapsados. Se usa para comparar nombres, nunca para mostrar.
export function normalizarNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .split('')
    .map((caracter) => REEMPLAZO_TILDES[caracter] ?? caracter)
    .join('')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
