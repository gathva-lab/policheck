import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  transcript: vi.fn(),
}));

vi.mock('youtube-transcript', () => ({
  YoutubeTranscript: { fetchTranscript: h.transcript },
}));

import {
  decodeHtmlEntities,
  extractYoutube,
  fetchTranscript,
  NoTranscriptError,
  parseTimedText,
  TRANSCRIPT_TIMEOUT_MS,
} from './extract';

beforeEach(() => {
  h.transcript.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function youtubePageWithCaptions(): string {
  const description = 'Descripción suficientemente larga '.repeat(10);
  return `<html><head><meta name="description" content="${description}"></head><body>
    <script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{
      "captionTracks":[
        {"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&lang=en","languageCode":"en"},
        {"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&lang=es","languageCode":"es"}
      ],"audioTracks":[]}}};</script>
  </body></html>`;
}

function mockYoutubeFetch(html: string, timedText: string) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/oembed')) {
      return new Response(JSON.stringify({ title: 'Video de prueba' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/timedtext')) {
      return new Response(timedText, { status: 200 });
    }
    return new Response(html, { status: 200 });
  });
}

describe('fetchTranscript', () => {
  it('devuelve cadena vacía y avisa si la promesa no resuelve en 10s', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.transcript.mockReturnValue(new Promise(() => {}));

    const pending = fetchTranscript('https://www.youtube.com/watch?v=abc');
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TIMEOUT_MS);

    await expect(pending).resolves.toBe('');
    expect(warn).toHaveBeenCalledWith(
      '[extract] transcripción no disponible en 10s',
      'https://www.youtube.com/watch?v=abc'
    );
  });

  it('une los segmentos cuando la transcripción resuelve', async () => {
    h.transcript.mockResolvedValue([{ text: 'hola' }, { text: 'mundo' }]);

    await expect(fetchTranscript('https://www.youtube.com/watch?v=abc')).resolves.toBe('hola mundo');
  });
});

describe('extractYoutube fallback por captionTracks', () => {
  it('recupera la transcripción del HTML y prefiere la pista en español', async () => {
    h.transcript.mockResolvedValue([]);
    const fetchMock = mockYoutubeFetch(
      youtubePageWithCaptions(),
      '<transcript><text start="0" dur="1">Hola &amp;#39;mundo&amp;#39;</text><text start="1" dur="1">segundo</text></transcript>'
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await extractYoutube('https://www.youtube.com/watch?v=abc');

    expect(result.transcriptUsed).toBe(true);
    expect(result.transcriptMethod).toBe('caption-tracks');
    expect(result.text).toContain("Hola 'mundo' segundo");
    const timedTextCalls = fetchMock.mock.calls
      .map(([input]) => (typeof input === 'string' ? input : input.toString()))
      .filter((url) => url.includes('/api/timedtext'));
    expect(timedTextCalls).toHaveLength(1);
    expect(timedTextCalls[0]).toContain('lang=es');
    expect(timedTextCalls[0]).not.toContain('lang=en');
  });

  it('decodifica entidades HTML del XML de timedtext', () => {
    expect(decodeHtmlEntities('&amp;#39;hola&amp;quot;')).toBe("'hola\"");
    expect(decodeHtmlEntities('&amp;amp; &lt;texto&gt;')).toBe('& <texto>');
    expect(parseTimedText('<text>a &amp;#39;b&amp;#39;</text>')).toBe("a 'b'");
  });

  it('lanza NoTranscriptError cuando los tres intentos fallan y la descripción es corta', async () => {
    h.transcript.mockResolvedValue([]);
    const fetchMock = mockYoutubeFetch('<html><head></head><body></body></html>', '');
    vi.stubGlobal('fetch', fetchMock);

    await expect(extractYoutube('https://www.youtube.com/watch?v=abc')).rejects.toBeInstanceOf(
      NoTranscriptError
    );
    expect(h.transcript).toHaveBeenCalledTimes(2);
  });

  it('usa el reintento cuando falla youtube-transcript y no hay captionTracks', async () => {
    h.transcript.mockResolvedValueOnce([]).mockResolvedValueOnce([{ text: 'desde reintento' }]);
    const fetchMock = mockYoutubeFetch('<html><head></head><body></body></html>', '');
    vi.stubGlobal('fetch', fetchMock);

    const result = await extractYoutube('https://www.youtube.com/watch?v=abc');

    expect(result.transcriptMethod).toBe('retry');
    expect(result.text).toContain('desde reintento');
    expect(h.transcript).toHaveBeenCalledTimes(2);
  });
});
