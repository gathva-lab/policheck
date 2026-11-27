import { describe, it, expect } from 'vitest';
import {
  computeConsensus,
  detectInternalInconsistency,
  dominantContentNature,
  justificationContradictsVerdict,
  median,
  type ModelReport,
} from './consensus';

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
    externalEvidence: null,
    ...partial,
  };
}

describe('median', () => {
  it('con longitud impar devuelve el central sin interpolar', () => {
    expect(median([2, 3, 65])).toBe(3);
  });

  it('con longitud par interpola los dos valores centrales', () => {
    expect(median([65, 70])).toBe(67.5);
  });
});

describe('dominantContentNature', () => {
  it('devuelve opinion con mayoría estricta de dos tercios', () => {
    expect(
      dominantContentNature([
        report({ modelName: 'a', contentNature: 'opinion' }),
        report({ modelName: 'b', contentNature: 'opinion' }),
        report({ modelName: 'c', contentNature: 'factual' }),
      ])
    ).toBe('opinion');
  });

  it('devuelve null cuando solo un tercio declara opinion', () => {
    expect(
      dominantContentNature([
        report({ modelName: 'a', contentNature: 'opinion' }),
        report({ modelName: 'b', contentNature: 'factual' }),
        report({ modelName: 'c', contentNature: 'mixto' }),
      ])
    ).toBeNull();
  });
});

describe('computeConsensus', () => {
  it('usa la mediana y la mayoría de opinión en el caso real JgvC9xaUKN8', () => {
    const result = computeConsensus([
      report({
        modelName: 'nvidia/nemotron-3-ultra-550b-a55b',
        contentNature: 'opinion',
        veracityScore: 2,
        verdictLabel: 'inchequeable',
      }),
      report({
        modelName: 'tencent/hy4-flash',
        contentNature: 'opinion',
        veracityScore: 3,
        verdictLabel: 'inchequeable',
      }),
      report({
        modelName: 'deepseek/deepseek-v4.1-flash',
        contentNature: 'opinion',
        veracityScore: 65,
        verdictLabel: 'discutible',
      }),
    ]);

    expect(result.verdictScore).toBe(3);
    expect(result.meanScore).toBe(2.5);
    expect(result.outlierDetected).toBe(true);
    expect(result.outlierModel).toBe('deepseek/deepseek-v4.1-flash');
    expect(result.natureOverride).toBe(true);
    expect(result.natureOverrideReason).toBe('mayoria_opinion');
    expect(result.verdictLabel).toBe('inchequeable');
    expect(result.discardReasons['deepseek/deepseek-v4.1-flash']).toBe(
      'opinion_con_score_alto'
    );
  });

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

describe('detectInternalInconsistency', () => {
  it('marca mixto con score menor a 10', () => {
    const result = detectInternalInconsistency(
      report({ contentNature: 'mixto', veracityScore: 3, verdictLabel: 'inchequeable' })
    );
    expect(result).toBe('mixto_con_score_inchequeable');
  });

  it('marca factual con score menor a 15', () => {
    const result = detectInternalInconsistency(
      report({ contentNature: 'factual', veracityScore: 14, verdictLabel: 'insostenible' })
    );
    expect(result).toBe('factual_con_score_bajo');
  });

  it('marca opinión con score mayor a 75', () => {
    const result = detectInternalInconsistency(
      report({ contentNature: 'opinion', veracityScore: 80, verdictLabel: 'discutible' })
    );
    expect(result).toBe('opinion_con_score_alto');
  });

  it('marca opinión con score 65 como incoherente (umbral realista de 40)', () => {
    const result = detectInternalInconsistency(
      report({ contentNature: 'opinion', veracityScore: 65, verdictLabel: 'discutible' })
    );
    expect(result).toBe('opinion_con_score_alto');
  });

  it('marca opinión con veredicto verdadero o verdadero_pero', () => {
    expect(
      detectInternalInconsistency(
        report({ contentNature: 'opinion', veracityScore: 40, verdictLabel: 'verdadero' })
      )
    ).toBe('opinion_con_veredicto_positivo');
    expect(
      detectInternalInconsistency(
        report({ contentNature: 'opinion', veracityScore: 40, verdictLabel: 'verdadero_pero' })
      )
    ).toBe('opinion_con_veredicto_positivo');
  });

  it('no marca reportes coherentes', () => {
    expect(
      detectInternalInconsistency(
        report({ contentNature: 'opinion', veracityScore: 40, verdictLabel: 'discutible' })
      )
    ).toBeNull();
    expect(
      detectInternalInconsistency(
        report({ contentNature: 'factual', veracityScore: 65, verdictLabel: 'verdadero_pero' })
      )
    ).toBeNull();
    expect(detectInternalInconsistency(report({ veracityScore: null }))).toBeNull();
  });
});

describe('computeConsensus: coherencia interna', () => {
  it('descarta opinión con score 65 y no contamina el promedio', () => {
    const result = computeConsensus([
      report({
        modelName: 'deepseek-v4.1-flash',
        contentNature: 'opinion',
        veracityScore: 65,
        verdictLabel: 'discutible',
      }),
      report({
        modelName: 'nvidia/nemotron-3-ultra-550b-a55b',
        contentNature: 'factual',
        veracityScore: 80,
        verdictLabel: 'verdadero_pero',
      }),
      report({
        modelName: 'tencent/hy4-flash',
        contentNature: 'factual',
        veracityScore: 85,
        verdictLabel: 'verdadero_pero',
      }),
    ]);

    expect(result.discardedReports).toHaveLength(1);
    expect(result.discardedReports[0].modelName).toBe('deepseek-v4.1-flash');
    expect(result.discardReasons['deepseek-v4.1-flash']).toBe('opinion_con_score_alto');
    // El promedio usa solo los reportes coherentes, no el 65 descartado.
    expect(result.meanScore).toBe(82.5);
    expect(result.averageVeracity).toBe(82.5);
    expect(result.usedReports).toHaveLength(2);
    expect(result.requiresReview).toBe(false);
    expect(result.natureOverride).toBe(false);
  });

  it('si todos son incoherentes no descarta ninguno y marca revisión', () => {
    const result = computeConsensus([
      report({
        modelName: 'a',
        contentNature: 'mixto',
        veracityScore: 3,
        verdictLabel: 'inchequeable',
      }),
      report({
        modelName: 'b',
        contentNature: 'factual',
        veracityScore: 10,
        verdictLabel: 'insostenible',
      }),
      report({
        modelName: 'c',
        contentNature: 'opinion',
        veracityScore: 80,
        verdictLabel: 'verdadero',
      }),
    ]);

    expect(result.discardedReports).toHaveLength(0);
    expect(result.discardReasons).toEqual({});
    expect(result.usedReports).toHaveLength(3);
    expect(result.requiresReview).toBe(true);
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

describe('computeConsensus: external_evidence es independiente del score', () => {
  it('un dato oficial que difiere no cambia el veracity_score ni el consenso', () => {
    const evidence = [
      {
        claim: 'La inflación fue de 5%',
        officialValue: '0,5% en octubre de 2026',
        source: 'Banco Central de Chile',
        relation: 'difiere' as const,
        detail: 'La cifra oficial es menor.',
      },
    ];
    const base = computeConsensus([
      report({ modelName: 'a', verdictLabel: 'discutible', veracityScore: 65 }),
      report({ modelName: 'b', verdictLabel: 'discutible', veracityScore: 65 }),
    ]);
    const withEvidence = computeConsensus([
      report({ modelName: 'a', verdictLabel: 'discutible', veracityScore: 65, externalEvidence: evidence }),
      report({ modelName: 'b', verdictLabel: 'discutible', veracityScore: 65, externalEvidence: evidence }),
    ]);

    expect(withEvidence.averageVeracity).toBe(base.averageVeracity);
    expect(withEvidence.verdictLabel).toBe(base.verdictLabel);
    expect(withEvidence.consensusAgreement).toBe(base.consensusAgreement);
  });
});
