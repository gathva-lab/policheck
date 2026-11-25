import * as cheerio from 'cheerio';

const MAX_INPUT_CHARS = 32000;
const FETCH_TIMEOUT_MS = 15000;

export interface ExtractedContent {
  title: string;
  text: string;
  sourceType: 'articulo_noticia' | 'video_youtube';
  transcriptUsed: boolean;
  transcriptWords: number;
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

export async function extractArticle(url: string): Promise<ExtractedContent> {
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
  };
}

export async function extractYoutube(url: string): Promise<ExtractedContent> {
  let title = 'Video de YouTube';
  let description = '';

  try {
    const oembed = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (oembed.ok) {
      const data = (await oembed.json()) as { title?: string };
      if (data.title) title = data.title.trim();
    }
  } catch {
    // No bloqueante
  }

  try {
    const page = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PolicheckBot/1.0)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (page.ok) {
      const html = await page.text();
      const $ = cheerio.load(html);
      description =
        $('meta[name="description"]').attr('content')?.trim() ||
        $('meta[property="og:description"]').attr('content')?.trim() ||
        '';
    }
  } catch {
    // No bloqueante
  }

  let transcript = '';
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');
    const parts = await YoutubeTranscript.fetchTranscript(url);
    transcript = parts.map((p) => p.text).join(' ');
  } catch {
    // Transcripción opcional, no bloqueante
  }

  const transcriptUsed = transcript.trim().length > 0;
  const transcriptWords = transcriptUsed ? transcript.trim().split(/\s+/).length : 0;
  if (!transcriptUsed) {
    console.warn(`[extract] Sin transcripción para ${url}, se analiza solo la descripción`);
  }

  const combined = [description, transcript].filter(Boolean).join('\n\n');
  return {
    title,
    text: truncateToTokens(combined || `Video de YouTube: ${title}`),
    sourceType: 'video_youtube',
    transcriptUsed,
    transcriptWords,
  };
}
