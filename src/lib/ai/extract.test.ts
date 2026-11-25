import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  transcript: vi.fn(),
}));

vi.mock('youtube-transcript', () => ({
  YoutubeTranscript: { fetchTranscript: h.transcript },
}));

import { fetchTranscript, TRANSCRIPT_TIMEOUT_MS } from './extract';

beforeEach(() => {
  h.transcript.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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
