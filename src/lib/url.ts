// Parámetros de tracking que no aportan identidad a una fuente y que, por tanto,
// se eliminan antes de comparar o guardar URLs.
const TRACKING_PARAMS = new Set(['si', 'feature', 't', 'start', 'pp', 'ab_channel', 'fbclid', 'gclid']);

function isTrackingParam(key: string): boolean {
  const normalized = key.toLowerCase();
  return TRACKING_PARAMS.has(normalized) || normalized.startsWith('utm_');
}

function isYoutubeHost(host: string): boolean {
  return host === 'youtube.com' || host.endsWith('.youtube.com');
}

function extractYoutubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id || null;
  }

  if (!isYoutubeHost(host)) return null;

  if (url.pathname === '/watch') {
    return url.searchParams.get('v') || null;
  }

  const match = url.pathname.match(/^\/(?:shorts|embed)\/([^/?#]+)/);
  return match ? match[1] : null;
}

/**
 * Normaliza una URL para que distintas variantes de la misma fuente converjan.
 * - YouTube (youtu.be, watch, shorts, embed) -> https://www.youtube.com/watch?v=ID
 * - Elimina parámetros de tracking y el fragmento.
 * - Fuerza https y quita la barra final redundante.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return trimmed;

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return trimmed;
  }

  const youtubeId = extractYoutubeId(parsed);
  if (youtubeId) {
    return `https://www.youtube.com/watch?v=${youtubeId}`;
  }

  parsed.protocol = 'https:';
  parsed.hash = '';

  for (const key of [...parsed.searchParams.keys()]) {
    if (isTrackingParam(key)) parsed.searchParams.delete(key);
  }

  let result = parsed.toString();
  // Quita la barra redundante tanto en la raíz como antes de la query.
  result = result.replace(/\/\?/, '?');
  if (result.endsWith('/')) result = result.slice(0, -1);
  return result;
}
