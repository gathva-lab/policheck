import { describe, expect, it } from 'vitest';
import { detectUnstableModels, type StabilityReport } from './stability';

function run(
  modelName: string,
  veracityScore: number | null,
  contentNature: StabilityReport['contentNature']
): StabilityReport {
  return { modelName, veracityScore, contentNature };
}

describe('detectUnstableModels', () => {
  it('marca hy4 por pasar de 3 a 68 y de opinion a mixto', () => {
    const unstable = detectUnstableModels(
      [run('tencent/hy4-flash', 68, 'mixto'), run('nvidia/nemotron-3-ultra', 2, 'opinion')],
      [run('tencent/hy4-flash', 3, 'opinion'), run('nvidia/nemotron-3-ultra', 2, 'opinion')]
    );

    expect(unstable).toHaveLength(1);
    expect(unstable[0].modelName).toBe('tencent/hy4-flash');
    expect(unstable[0].veracityDelta).toBe(65);
    expect(unstable[0].reasons).toEqual(['veracity_delta', 'content_nature_changed']);
    expect(unstable.some((model) => model.modelName === 'nvidia/nemotron-3-ultra')).toBe(false);
  });

  it('marca un cambio de naturaleza aunque la veracidad no varíe 30 puntos', () => {
    const unstable = detectUnstableModels(
      [run('modelo', 50, 'factual')],
      [run('modelo', 50, 'opinion')]
    );

    expect(unstable).toHaveLength(1);
    expect(unstable[0].veracityDelta).toBe(0);
    expect(unstable[0].reasons).toEqual(['content_nature_changed']);
  });

  it('marca una diferencia de veracidad de exactamente 30 sin cambio de naturaleza', () => {
    const unstable = detectUnstableModels(
      [run('modelo', 60, 'mixto')],
      [run('modelo', 30, 'mixto')]
    );

    expect(unstable).toHaveLength(1);
    expect(unstable[0].reasons).toEqual(['veracity_delta']);
    expect(unstable[0].natureChanged).toBe(false);
  });

  it('ignora modelos que solo existen en una de las corridas', () => {
    const unstable = detectUnstableModels(
      [run('nuevo', 90, 'factual')],
      [run('viejo', 5, 'opinion')]
    );

    expect(unstable).toEqual([]);
  });
});
