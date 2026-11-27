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

describe('parseModelOutput: falacias retóricas', () => {
  it('extrae fallacias válidas del catálogo', () => {
    const content = JSON.stringify({
      verdict_label: 'verdadero',
      veracity_score: 90,
      coherence_score: 85,
      summary: 'Resumen',
      fallacies: [
        {
          type: 'asociacion',
          quote: 'Está vinculado a ese grupo',
          explanation: 'Se descalifica por un vínculo que no se prueba.',
        },
        {
          type: 'cherry_picking',
          quote: 'Solo muestran ese dato',
          explanation: 'Se eligen solo los datos que convienen a la tesis.',
        },
      ],
    });

    const { report } = parseModelOutput('modelo/test', content);

    expect(report?.fallacies).toEqual([
      {
        type: 'asociacion',
        quote: 'Está vinculado a ese grupo',
        explanation: 'Se descalifica por un vínculo que no se prueba.',
      },
      {
        type: 'cherry_picking',
        quote: 'Solo muestran ese dato',
        explanation: 'Se eligen solo los datos que convienen a la tesis.',
      },
    ]);
  });

  it('descarta los tipos desconocidos sin romper el resto', () => {
    const content = JSON.stringify({
      verdict_label: 'discutible',
      veracity_score: 65,
      coherence_score: 60,
      summary: 'Resumen',
      fallacies: [
        {
          type: 'ad_hominem',
          quote: 'Frase con tipo fuera del catálogo',
          explanation: 'Este elemento debe descartarse.',
        },
        {
          type: 'falsa_dicotomia',
          quote: 'O estás conmigo o contra mí',
          explanation: 'Presenta solo dos opciones cuando hay más.',
        },
      ],
    });

    const { report } = parseModelOutput('modelo/test', content);

    expect(report?.fallacies).toEqual([
      {
        type: 'falsa_dicotomia',
        quote: 'O estás conmigo o contra mí',
        explanation: 'Presenta solo dos opciones cuando hay más.',
      },
    ]);
  });

  it('devuelve null cuando el campo fallacies está ausente', () => {
    const content = JSON.stringify({
      verdict_label: 'verdadero',
      veracity_score: 90,
      coherence_score: 85,
      summary: 'Resumen',
    });

    const { report } = parseModelOutput('modelo/test', content);

    expect(report?.fallacies).toBeNull();
  });

  it('devuelve null cuando fallacies es un arreglo vacío', () => {
    const content = JSON.stringify({
      verdict_label: 'verdadero',
      veracity_score: 90,
      coherence_score: 85,
      summary: 'Resumen',
      fallacies: [],
    });

    const { report } = parseModelOutput('modelo/test', content);

    expect(report?.fallacies).toBeNull();
  });

  it('tolera fallacies malformadas o con elementos incompletos', () => {
    const content = JSON.stringify({
      verdict_label: 'verdadero',
      veracity_score: 90,
      coherence_score: 85,
      summary: 'Resumen',
      fallacies: 'no es un arreglo',
    });

    expect(parseModelOutput('modelo/test', content).report?.fallacies).toBeNull();

    const conElementosInvalidos = JSON.stringify({
      verdict_label: 'verdadero',
      veracity_score: 90,
      coherence_score: 85,
      summary: 'Resumen',
      fallacies: [
        null,
        { type: 'asociacion', quote: 'Sin explicación' },
        { type: 'asociacion', explanation: 'Sin cita' },
      ],
    });

    expect(parseModelOutput('modelo/test', conElementosInvalidos).report?.fallacies).toBeNull();
  });

  it('limita las falacias a un máximo de 3', () => {
    const content = JSON.stringify({
      verdict_label: 'verdadero',
      veracity_score: 90,
      coherence_score: 85,
      summary: 'Resumen',
      fallacies: [
        { type: 'asociacion', quote: 'a', explanation: 'a' },
        { type: 'hombre_de_paja', quote: 'b', explanation: 'b' },
        { type: 'falsa_dicotomia', quote: 'c', explanation: 'c' },
        { type: 'generalizacion', quote: 'd', explanation: 'd' },
      ],
    });

    const { report } = parseModelOutput('modelo/test', content);

    expect(report?.fallacies).toHaveLength(3);
    expect(report?.fallacies?.map((fallacy) => fallacy.type)).toEqual([
      'asociacion',
      'hombre_de_paja',
      'falsa_dicotomia',
    ]);
  });
});
