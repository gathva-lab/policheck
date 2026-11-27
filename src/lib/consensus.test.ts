import { describe, it, expect } from 'vitest';
import { computeConsensus, justificationContradictsVerdict, type ModelReport } from './consensus';

function report(partial: Partial<ModelReport>): ModelReport {
  return {
    modelName: 'modelo',
    verdictLabel: null,
    veracityScore: null,
    coherenceScore: null,
    summary: null,
    plainVerdict: null,
    plainSummary: null,
    quotes: null,
    fallacies: null,
    contentNature: null,
    ...partial,
  };
}

describe('computeConsensus', () => {
  it('publica veredicto cuando al menos 2 de 3 modelos coinciden en la etiqueta', () => {
    const result = computeConsensus([
      report({ modelName: 'a', verdictLabel: 'exagerado', veracityScore: 40 }),
      report({ modelName: 'b', verdictLabel: 'exagerado', veracityScore: 38 }),
      report({ modelName: 'c', verdictLabel: 'discutible', veracityScore: 65 }),
    ]);

    expect(result.requiresReview).toBe(false);
    expect(result.verdictLabel).toBe('exagerado');
    expect(result.consensusAgreement).toBeGreaterThanOrEqual(60);
    expect(result.averageVeracity).toBeCloseTo(47.67, 0);
  });

  it('requiere revisión cuando el acuerdo es menor a 60%', () => {
    const result = computeConsensus([
      report({ modelName: 'a', verdictLabel: 'exagerado', veracityScore: 40 }),
      report({ modelName: 'b', verdictLabel: 'discutible', veracityScore: 65 }),
      report({ modelName: 'c', verdictLabel: 'apresurado', veracityScore: 50 }),
    ]);

    expect(result.requiresReview).toBe(true);
    expect(result.verdictLabel).toBeNull();
    expect(result.consensusAgreement).toBeLessThan(60);
  });

  it('calcula el consenso con 2 modelos cuando 1 falla (fallback)', () => {
    const result = computeConsensus([
      report({ modelName: 'a', verdictLabel: 'verdadero_pero', veracityScore: 80 }),
      report({ modelName: 'b', verdictLabel: 'verdadero_pero', veracityScore: 78 }),
    ]);

    expect(result.requiresReview).toBe(false);
    expect(result.verdictLabel).toBe('verdadero_pero');
    expect(result.consensusAgreement).toBe(100);
    expect(result.averageVeracity).toBe(79);
  });

  it('con un solo reporte conserva su veredicto como parcial y exige revisión', () => {
    const result = computeConsensus([
      report({ modelName: 'a', verdictLabel: 'verdadero', veracityScore: 95 }),
      report({ modelName: 'b', verdictLabel: null, veracityScore: null }),
    ]);

    expect(result.requiresReview).toBe(true);
    expect(result.verdictLabel).toBe('verdadero');
    expect(result.consensusAgreement).toBe(0);
    expect(result.partial).toBe(true);
  });

  it('con dos reportes coincidentes no marca el resultado como parcial', () => {
    const result = computeConsensus([
      report({ modelName: 'a', verdictLabel: 'verdadero', veracityScore: 95 }),
      report({ modelName: 'b', verdictLabel: 'verdadero', veracityScore: 90 }),
    ]);

    expect(result.requiresReview).toBe(false);
    expect(result.partial).toBe(false);
  });

  it('sin reportes válidos no inventa veredicto ni marca parcial', () => {
    const result = computeConsensus([]);

    expect(result.requiresReview).toBe(true);
    expect(result.verdictLabel).toBeNull();
    expect(result.consensusAgreement).toBeNull();
    expect(result.partial).toBe(false);
  });

  it('descarta del consenso modelos cuya justificación contradice su veredicto', () => {
    const result = computeConsensus([
      report({ modelName: 'a', verdictLabel: 'verdadero', veracityScore: 95, summary: 'La afirmación es correcta.' }),
      report({ modelName: 'b', verdictLabel: 'verdadero', veracityScore: 90, summary: 'Esto es falso, una mentira.' }),
      report({ modelName: 'c', verdictLabel: 'verdadero', veracityScore: 92, summary: 'Confirmado por fuentes oficiales.' }),
    ]);

    expect(result.discardedReports).toHaveLength(1);
    expect(result.usedReports).toHaveLength(2);
    expect(result.verdictLabel).toBe('verdadero');
    expect(result.consensusAgreement).toBe(100);
  });
});

describe('justificationContradictsVerdict', () => {
  it('detecta contradicción en veredictos positivos', () => {
    expect(justificationContradictsVerdict('verdadero', 'Esto es falso')).toBe(true);
    expect(justificationContradictsVerdict('verdadero', 'Confirmado por fuentes oficiales')).toBe(false);
  });

  it('detecta contradicción en veredictos negativos', () => {
    expect(justificationContradictsVerdict('enganoso', 'Es totalmente verdadero y correcto')).toBe(true);
    expect(justificationContradictsVerdict('insostenible', 'La evidencia lo desmiente')).toBe(false);
  });

  it('no descarta veredictos neutros', () => {
    expect(justificationContradictsVerdict('discutible', 'Hay evidencia mixta')).toBe(false);
    expect(justificationContradictsVerdict('inchequeable', 'No hay datos')).toBe(false);
  });
});
