import { describe, it, expect } from 'vitest';
import { FEVER_SYSTEM_PROMPT } from './prompt';

describe('FEVER_SYSTEM_PROMPT: lenguaje ciudadano', () => {
  it('pide los cuatro campos nuevos sin eliminar los existentes', () => {
    expect(FEVER_SYSTEM_PROMPT).toContain('plain_verdict');
    expect(FEVER_SYSTEM_PROMPT).toContain('plain_summary');
    expect(FEVER_SYSTEM_PROMPT).toContain('"quotes"');
    expect(FEVER_SYSTEM_PROMPT).toContain('content_nature');
    expect(FEVER_SYSTEM_PROMPT).toContain('"verdict_label"');
    expect(FEVER_SYSTEM_PROMPT).toContain('"summary"');
  });

  it('incluye la instrucción anti-jerga', () => {
    expect(FEVER_SYSTEM_PROMPT).toContain('FEVER, NEI, SUPPORTED, REFUTED');
    expect(FEVER_SYSTEM_PROMPT).toContain('"veracidad"');
    expect(FEVER_SYSTEM_PROMPT).toContain('el lector no es experto');
  });

  it('incluye la regla de honestidad para opiniones', () => {
    expect(FEVER_SYSTEM_PROMPT).toContain('"opinion"');
    expect(FEVER_SYSTEM_PROMPT).toContain('inchequeable');
    expect(FEVER_SYSTEM_PROMPT).toContain('discutible');
    expect(FEVER_SYSTEM_PROMPT).toContain('no es posible verificar opiniones');
  });

  it('incluye la regla de neutralidad', () => {
    expect(FEVER_SYSTEM_PROMPT).toContain('Neutralidad');
    expect(FEVER_SYSTEM_PROMPT).toContain('solo sobre su relación con la evidencia');
  });

  it('limita quotes a 3 y pide un análisis de máximo 1200 tokens', () => {
    expect(FEVER_SYSTEM_PROMPT).toContain('entre 1 y 3');
    expect(FEVER_SYSTEM_PROMPT).toContain('máximo 3');
    expect(FEVER_SYSTEM_PROMPT).not.toContain('entre 1 y 5');
    expect(FEVER_SYSTEM_PROMPT).toContain('1 200 tokens de salida');
  });

  it('limita plain_summary a 2 frases en contenidos de más de 30 minutos', () => {
    expect(FEVER_SYSTEM_PROMPT).toContain('supera los 30 minutos');
  });
});

describe('FEVER_SYSTEM_PROMPT: detección de falacias', () => {
  it('pide el campo fallacies con type, quote y explanation', () => {
    expect(FEVER_SYSTEM_PROMPT).toContain('"fallacies"');
    expect(FEVER_SYSTEM_PROMPT).toContain('"type"');
    expect(FEVER_SYSTEM_PROMPT).toContain('"quote"');
    expect(FEVER_SYSTEM_PROMPT).toContain('"explanation"');
  });

  it('incluye el catálogo cerrado de tipos', () => {
    for (const type of [
      'asociacion',
      'hombre_de_paja',
      'falsa_dicotomia',
      'apelacion_emocional',
      'generalizacion',
      'whataboutism',
      'cherry_picking',
    ]) {
      expect(FEVER_SYSTEM_PROMPT).toContain(type);
    }
  });

  it('incluye la regla de hecho cierto con uso falaz y no bajar veracity_score', () => {
    expect(FEVER_SYSTEM_PROMPT).toContain('lo que dice es cierto, pero lo usa para');
    expect(FEVER_SYSTEM_PROMPT).toContain('No bajes el veracity_score por una falacia');
    expect(FEVER_SYSTEM_PROMPT).toContain('son señales distintas');
  });

  it('limita las falacias a 3 y pide explicación en lenguaje llano', () => {
    expect(FEVER_SYSTEM_PROMPT).toContain('máximo 3 falacias');
    expect(FEVER_SYSTEM_PROMPT).toContain('comprensible sin formación política');
  });
});

describe('FEVER_SYSTEM_PROMPT: contraste con datos oficiales', () => {
  it('pide external_evidence con el catálogo de relaciones', () => {
    expect(FEVER_SYSTEM_PROMPT).toContain('"external_evidence"');
    expect(FEVER_SYSTEM_PROMPT).toContain('"official_value"');
    expect(FEVER_SYSTEM_PROMPT).toContain('"coincide"');
    expect(FEVER_SYSTEM_PROMPT).toContain('"difiere"');
    expect(FEVER_SYSTEM_PROMPT).toContain('"no_comparable"');
  });

  it('prohíbe inventar cifras y aclara que no modifica el score', () => {
    expect(FEVER_SYSTEM_PROMPT).toContain('No inventes cifras oficiales');
    expect(FEVER_SYSTEM_PROMPT).toContain('NO modifica el veracity_score');
  });
});

describe('FEVER_SYSTEM_PROMPT: sin cifras de puntaje en el resumen ciudadano', () => {
  it('prohíbe citar números de puntaje en plain_verdict y plain_summary', () => {
    expect(FEVER_SYSTEM_PROMPT).toContain('No cites números de puntaje');
    expect(FEVER_SYSTEM_PROMPT).toContain('plain_verdict ni en plain_summary');
    expect(FEVER_SYSTEM_PROMPT).toContain('confunde al lector');
    expect(FEVER_SYSTEM_PROMPT).toContain('Explica la valoración en palabras');
  });
});
