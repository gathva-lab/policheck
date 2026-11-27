import { BCCH_SERIES, type BcchSeriesInfo } from './bcch';

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Cuenta apariciones de una keyword como palabra (admite plural simple).
function countKeyword(haystack: string, keyword: string): number {
  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escapeRegExp(normalize(keyword))}(?:s|es)?(?=$|[^\\p{L}\\p{N}])`,
    'gu'
  );
  let count = 0;
  const matches = haystack.match(pattern);
  if (matches) count = matches.length;
  return count;
}

const MAX_INDICATORS = 3;

// Detecta de qué indicadores habla el texto, sin intentar extraer ni comparar
// cifras. La búsqueda ignora acentos y mayúsculas y devuelve como máximo 3.
export function detectIndicators(text: string): BcchSeriesInfo[] {
  if (!text || !text.trim()) return [];
  const normalized = normalize(text);

  const scored = BCCH_SERIES.map((info, order) => {
    const score = info.keywords.reduce(
      (total, keyword) => total + countKeyword(normalized, keyword),
      0
    );
    return { info, score, order };
  }).filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score || a.order - b.order);

  return scored.slice(0, MAX_INDICATORS).map((entry) => entry.info);
}
