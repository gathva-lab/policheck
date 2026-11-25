import { describe, it, expect } from 'vitest';
import { parseModelOutput } from './parse';

describe('parseModelOutput: campos en lenguaje ciudadano', () => {
  it('extrae plain_verdict, plain_summary, quotes y content_nature', () => {
    const content = JSON.stringify({
      verdict_label: 'verdadero_pero',
      veracity_score: 80,
      coherence_score: 75,
      summary: 'Resumen técnico',
      plain_verdict: 'Lo que dijo es cierto en general, pero omitió un dato importante.',
      plain_summary: 'El político afirmó X y la evidencia lo respalda en lo esencial. Sin embargo, dejó fuera un dato relevante.',
      quotes: [
        { text: 'Frase textual del político', assessment: 'Se confirmó con datos oficiales.' },
      ],
      content_nature: 'mixto',
    });

    const { report } = parseModelOutput('modelo/test', content);

    expect(report).not.toBeNull();
    expect(report?.plainVerdict).toBe('Lo que dijo es cierto en general, pero omitió un dato importante.');
    expect(report?.plainSummary).toContain('dejó fuera un dato relevante');
    expect(report?.quotes).toEqual([
      { text: 'Frase textual del político', assessment: 'Se confirmó con datos oficiales.' },
    ]);
    expect(report?.contentNature).toBe('mixto');
  });

  it('devuelve null en los campos nuevos cuando el modelo no los emite', () => {
    const content = JSON.stringify({
      verdict_label: 'verdadero',
      veracity_score: 90,
      coherence_score: 85,
      summary: 'Resumen técnico',
    });

    const { report } = parseModelOutput('modelo/viejo', content);

    expect(report).not.toBeNull();
    expect(report?.plainVerdict).toBeNull();
    expect(report?.plainSummary).toBeNull();
    expect(report?.quotes).toBeNull();
    expect(report?.contentNature).toBeNull();
  });

  it('tolera quotes mal formadas y content_nature desconocido', () => {
    const content = JSON.stringify({
      verdict_label: 'discutible',
      veracity_score: 65,
      coherence_score: 60,
      summary: 'Resumen',
      quotes: [{ text: 'Sin assessment' }, { assessment: 'Sin texto' }],
      content_nature: 'otra_cosa',
    });

    const { report } = parseModelOutput('modelo/test', content);

    expect(report?.quotes).toBeNull();
    expect(report?.contentNature).toBeNull();
  });
});
