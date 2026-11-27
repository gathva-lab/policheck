import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConsensusVerdictScore } from './ConsensusVerdictScore';

describe('ConsensusVerdictScore', () => {
  it('sin veredicto no renderiza porcentaje de veracidad ni barra', () => {
    const html = renderToStaticMarkup(
      createElement(ConsensusVerdictScore, {
        verdict: null,
        verdictScore: 65,
        agreement: 50,
        outlierModel: 'tencent/hy4-flash',
        outlierScore: 68,
        candidateMedian: 65,
      })
    );

    expect(html).toContain('Sin consenso');
    expect(html).toContain(
      'Los modelos no coincidieron lo suficiente como para emitir un veredicto'
    );
    expect(html).toContain('Acuerdo entre modelos: 50%');
    expect(html).toContain('tencent/hy4-flash');
    // El 65 es solo diagnóstico, nunca la veracidad mostrada.
    expect(html).not.toContain('65%');
    expect(html).not.toContain('data-testid="veracidad"');
  });

  it('con veredicto sí muestra el porcentaje y la barra', () => {
    const html = renderToStaticMarkup(
      createElement(ConsensusVerdictScore, {
        verdict: 'discutible',
        verdictScore: 72,
        agreement: 100,
      })
    );

    expect(html).toContain('72%');
    expect(html).toContain('data-testid="veracidad"');
    expect(html).toContain('data-slot="progress"');
  });
});
