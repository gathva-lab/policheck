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
});
