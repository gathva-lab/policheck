import { describe, it, expect } from 'vitest';
import { normalizeUrl } from './url';

const CANONICAL = 'https://www.youtube.com/watch?v=p8V6lIu12Vg';

describe('normalizeUrl', () => {
  it('convierte youtu.be al canónico', () => {
    expect(normalizeUrl('https://youtu.be/p8V6lIu12Vg')).toBe(CANONICAL);
  });

  it('convierte youtube.com/watch al canónico', () => {
    expect(normalizeUrl('https://www.youtube.com/watch?v=p8V6lIu12Vg&feature=share')).toBe(CANONICAL);
  });

  it('convierte youtube.com/shorts al canónico', () => {
    expect(normalizeUrl('https://youtube.com/shorts/p8V6lIu12Vg?feature=share')).toBe(CANONICAL);
  });

  it('convierte youtube.com/embed al canónico', () => {
    expect(normalizeUrl('https://www.youtube.com/embed/p8V6lIu12Vg')).toBe(CANONICAL);
  });

  it('dos URLs que solo difieren en ?si= producen el mismo resultado', () => {
    const a = normalizeUrl('https://youtu.be/p8V6lIu12Vg?si=_-kocu05N--Lf89L');
    const b = normalizeUrl('https://youtu.be/p8V6lIu12Vg?si=OFmLQyPzC1e0JHOR');
    expect(a).toBe(b);
    expect(a).toBe(CANONICAL);
  });

  it('elimina parámetros de tracking y el fragmento en URLs no YouTube', () => {
    expect(
      normalizeUrl('http://www.ejemplo.cl/nota/?utm_source=x&utm_medium=y&id=7&fbclid=abc#seccion')
    ).toBe('https://www.ejemplo.cl/nota?id=7');
  });

  it('conserva la query relevante y quita la barra final', () => {
    expect(normalizeUrl('https://ejemplo.cl/nota/')).toBe('https://ejemplo.cl/nota');
  });
});
