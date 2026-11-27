import * as cheerio from 'cheerio';

const MAX_INPUT_CHARS = 12000;
const FETCH_TIMEOUT_MS = 15000;

export const TRANSCRIPT_TIMEOUT_MS = 10000;
export const TRANSCRIPT_RETRY_TIMEOUT_MS = 8000;
export const CAPTION_TRACKS_TIMEOUT_MS = 12000;
export const YOUTUBE_EXTRACTION_BUDGET_MS = 65000;
export const ARTICLE_EXTRACTION_BUDGET_MS = 20000;
export const MIN_CONTENT_CHARS = 200;

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const BROWSER_ACCEPT_LANGUAGE = 'es-CL,es;q=0.9,en;q=0.8';

export type TranscriptMethod = 'youtube-transcript' | 'caption-tracks' | 'retry';

export interface ExtractedContent {
  title: string;
  text: string;
  sourceType: 'articulo_noticia' | 'video_youtube';
  transcriptUsed: boolean;
  transcriptWords: number;
  transcriptMethod: TranscriptMethod | null;
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
}

export class NoTranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoTranscriptError';
  }
}

export function isYoutubeUrl(url: string): boolean {
  return /(youtube\.com|youtu\.be)/i.test(url);
}

export function truncateToTokens(text: string, maxChars: number = MAX_INPUT_CHARS): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

export function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function youtubeVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/watch\?(?:[^#]*&)?v=|youtube\.com\/shorts\/|youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/
  );
  return match?.[1] ?? null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function unescapeJsonUrl(value: string): string {
  return value.replace(/\\u0026/gi, '&').replace(/\\\//g, '/').replace(/\\"/g, '"');
}

export function decodeHtmlEntities(text: string): string {
  const normalized = text.replace(/&amp;/gi, '&').replace(/&amp;/gi, '&');
  return normalized
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_match, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

export function parseCaptionTracks(html: string): CaptionTrack[] {
  const match =
    html.match(/"captionTracks"\s*:\s*(\[[\s\S]*?\])\s*,\s*"(?:audioTracks|translationLanguages)"/) ??
    html.match(/"captionTracks"\s*:\s*(\[[^\]]*\])/);
  const raw = match?.[1];
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const tracks: CaptionTrack[] = [];
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const obj = item as Record<string, unknown>;
        const baseUrl = typeof obj.baseUrl === 'string' ? unescapeJsonUrl(obj.baseUrl) : null;
        const languageCode = typeof obj.languageCode === 'string' ? obj.languageCode : '';
        if (baseUrl) tracks.push({ baseUrl, languageCode });
      }
      if (tracks.length > 0) return tracks;
    }
  } catch {
    // Algunos HTML traen el JSON con escapes que JSON.parse no tolera.
  }

  const tracks: CaptionTrack[] = [];
  for (const block of raw.match(/\{[^{}]*\}/g) ?? []) {
    const baseUrl = block.match(/"baseUrl"\s*:\s*"([^"]+)"/)?.[1];
    const languageCode = block.match(/"languageCode"\s*:\s*"([^"]*)"/)?.[1] ?? '';
    if (baseUrl) tracks.push({ baseUrl: unescapeJsonUrl(baseUrl), languageCode });
  }
  return tracks;
}

export function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  return tracks.find((track) => track.languageCode.toLowerCase().startsWith('es')) ?? tracks[0] ?? null;
}

export function parseTimedText(xml: string): string {
  const texts: string[] = [];
  const pattern = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const content = decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim();
    if (content) texts.push(content);
  }
  return texts.join(' ');
}

async function fetchTranscriptOnce(url: string, timeoutMs: number): Promise<string> {
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');
    const parts = await withTimeout(
      YoutubeTranscript.fetchTranscript(url),
      timeoutMs,
      'transcript timeout'
    );
    return parts.map((part) => part.text).join(' ');
  } catch {
    return '';
  }
}

export async function fetchTranscript(url: string): Promise<string> {
  const transcript = await fetchTranscriptOnce(url, TRANSCRIPT_TIMEOUT_MS);
  if (!transcript.trim()) {
    console.warn('[extract] transcripción no disponible en 10s', url);
  }
  return transcript;
}

async function fetchYoutubePage(url: string): Promise<string | null> {
  try {
    const page = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        'Accept-Language': BROWSER_ACCEPT_LANGUAGE,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!page.ok) return null;
    return await page.text();
  } catch {
    return null;
  }
}

export async function fetchCaptionTracksTranscript(html: string): Promise<string> {
  const track = pickCaptionTrack(parseCaptionTracks(html));
  if (!track) return '';

  try {
    const response = await withTimeout(
      fetch(track.baseUrl, {
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          'Accept-Language': BROWSER_ACCEPT_LANGUAGE,
          Accept: 'text/xml,application/xml',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(CAPTION_TRACKS_TIMEOUT_MS),
      }),
      CAPTION_TRACKS_TIMEOUT_MS,
      'caption-tracks timeout'
    );
    if (!response.ok) return '';
    return parseTimedText(await response.text());
  } catch {
    console.warn('[extract] fallback captionTracks no disponible');
    return '';
  }
}

async function extractArticleInner(url: string): Promise<ExtractedContent> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; PolicheckBot/1.0; +https://policheck.cl)',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();
  const $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').first().text().trim() ||
    $('h1').first().text().trim() ||
    'Sin título';

  const paragraphs: string[] = [];
  $('article p, main p, p').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.length > 40) paragraphs.push(text);
  });

  const bodyText = paragraphs.length > 0 ? paragraphs.join('\n\n') : $('body').text().replace(/\s+/g, ' ').trim();
  // En artículos no aplica transcripción; se marca como usada para no advertir
  // un análisis parcial que no corresponde.
  return {
    title,
    text: truncateToTokens(bodyText),
    sourceType: 'articulo_noticia',
    transcriptUsed: true,
    transcriptWords: 0,
    transcriptMethod: null,
  };
}

export async function extractArticle(url: string): Promise<ExtractedContent> {
  return withTimeout(extractArticleInner(url), ARTICLE_EXTRACTION_BUDGET_MS, 'extraccion_timeout');
}

async function extractYoutubeInner(url: string): Promise<ExtractedContent> {
  let title = 'Video de YouTube';
  let description = '';

  try {
    const oembed = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (oembed.ok) {
      const data = (await oembed.json()) as { title?: string };
      if (data.title) title = data.title.trim();
    }
  } catch {
    // No bloqueante
  }

  const videoId = youtubeVideoId(url);
  const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : url;
  const pageHtml = await fetchYoutubePage(watchUrl);
  if (pageHtml) {
    const $ = cheerio.load(pageHtml);
    description =
      $('meta[name="description"]').attr('content')?.trim() ||
      $('meta[property="og:description"]').attr('content')?.trim() ||
      '';
  }

  let transcript = await fetchTranscript(url);
  let transcriptMethod: TranscriptMethod | null = transcript.trim() ? 'youtube-transcript' : null;

  if (!transcriptMethod) {
    const captionHtml = pageHtml ?? (await fetchYoutubePage(watchUrl));
    if (captionHtml) transcript = await fetchCaptionTracksTranscript(captionHtml);
    if (transcript.trim()) transcriptMethod = 'caption-tracks';
  }

  if (!transcriptMethod) {
    transcript = await fetchTranscriptOnce(url, TRANSCRIPT_RETRY_TIMEOUT_MS);
    if (transcript.trim()) transcriptMethod = 'retry';
  }

  if (transcriptMethod) {
    console.log(`[extract] transcripción vía ${transcriptMethod}`);
  } else {
    console.warn(`[extract] Sin transcripción para ${url}, se analiza solo la descripción`);
    if (description.trim().length < MIN_CONTENT_CHARS) {
      throw new NoTranscriptError(
        'No se pudo obtener la transcripción del video. YouTube puede estar limitando las peticiones; intenta de nuevo en unos minutos.'
      );
    }
  }

  const transcriptUsed = transcriptMethod !== null;
  const transcriptWords = transcriptUsed ? transcript.trim().split(/\s+/).length : 0;

  const combined = [description, transcript].filter(Boolean).join('\n\n');
  return {
    title,
    text: truncateToTokens(combined || `Video de YouTube: ${title}`),
    sourceType: 'video_youtube',
    transcriptUsed,
    transcriptWords,
    transcriptMethod,
  };
}

export async function extractYoutube(url: string): Promise<ExtractedContent> {
  return withTimeout(extractYoutubeInner(url), YOUTUBE_EXTRACTION_BUDGET_MS, 'extraccion_timeout');
}
