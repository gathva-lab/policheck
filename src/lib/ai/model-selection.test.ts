import { describe, it, expect } from 'vitest';
import { buildAttempts, pickTriplet, type ModelConfigLike } from './model-selection';

function config(
  id: string,
  model_id: string,
  tier: string,
  is_active = true,
  priority?: number
): ModelConfigLike {
  return { id, model_id, tier, is_active, priority };
}

describe('pickTriplet', () => {
  it('solo free: usa 3 free cuando no hay eco ni frontera', () => {
    const triplet = pickTriplet([
      config('1', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'free'),
      config('2', 'nvidia/nemotron-3.5-lightning:free', 'free'),
      config('3', 'google/gemma-4-31b-it:free', 'free'),
    ]);

    expect(triplet).toHaveLength(3);
    expect(triplet.every((c) => c.tier === 'free')).toBe(true);
  });

  it('free + eco: garantiza 1 free y completa con 2 eco de familias distintas', () => {
    const triplet = pickTriplet([
      config('f', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'free'),
      config('d', 'deepseek/deepseek-v3.2', 'eco'),
      config('q', 'qwen/qwen3-32b', 'eco'),
      config('l', 'meta-llama/llama-3.3-70b-instruct', 'eco'),
      config('x', 'anthropic/claude-opus-5.5', 'frontier'),
    ]);

    expect(triplet).toHaveLength(3);
    expect(triplet.filter((c) => c.tier === 'free')).toHaveLength(1);
    expect(triplet.filter((c) => c.tier === 'eco')).toHaveLength(2);
    expect(triplet.some((c) => c.tier === 'frontier')).toBe(false);

    const ecoFamilies = triplet
      .filter((c) => c.tier === 'eco')
      .map((c) => c.model_id.split('/')[0]);
    expect(new Set(ecoFamilies).size).toBe(2);
  });

  it('con frontera activa: la usa solo si free + eco no alcanzan 3', () => {
    const triplet = pickTriplet([
      config('f', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'free'),
      config('d', 'deepseek/deepseek-v3.2', 'eco'),
      config('x', 'anthropic/claude-sonnet-5.5', 'frontier'),
    ]);

    expect(triplet).toHaveLength(3);
    expect(triplet.map((c) => c.tier).sort()).toEqual(['eco', 'free', 'frontier']);
  });

  it('ordena los eco por prioridad: elige deepseek-v4.1-flash y no deepseek-v3.2', () => {
    const triplet = pickTriplet([
      config('f', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'free', true, 50),
      config('v3', 'deepseek/deepseek-v3.2', 'eco', true, 100),
      config('v41', 'deepseek/deepseek-v4.1-flash', 'eco', true, 10),
      config('hy', 'tencent/hy4-flash', 'eco', true, 10),
    ]);

    const ecoIds = triplet.filter((c) => c.tier === 'eco').map((c) => c.model_id);
    expect(ecoIds).toContain('deepseek/deepseek-v4.1-flash');
    expect(ecoIds).not.toContain('deepseek/deepseek-v3.2');
  });

  it('usa la prioridad ascendente y luego la familia de forma determinista', () => {
    const triplet = pickTriplet([
      config('q', 'qwen/qwen3-32b', 'eco', true, 20),
      config('d', 'deepseek/deepseek-v4.1-flash', 'eco', true, 10),
      config('f', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'free', true, 50),
    ]);

    expect(triplet.map((c) => c.model_id)).toEqual([
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'deepseek/deepseek-v4.1-flash',
      'qwen/qwen3-32b',
    ]);
  });

  it('ignora modelos inactivos', () => {
    const triplet = pickTriplet([
      config('f', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'free'),
      config('d', 'deepseek/deepseek-v3.2', 'eco'),
      config('q', 'qwen/qwen3-32b', 'eco'),
      config('x', 'anthropic/claude-opus-5.5', 'frontier', false),
    ]);

    expect(triplet).toHaveLength(3);
    expect(triplet.some((c) => c.tier === 'frontier')).toBe(false);
  });
});

describe('buildAttempts', () => {
  it('descarta un fallback inactivo y usa el siguiente activo del mismo tier', () => {
    const configs: ModelConfigLike[] = [
      config('free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'free', true, 50),
      config('active-a', 'deepseek/deepseek-v4.1-flash', 'eco', true, 10),
      config('active-b', 'tencent/hy4-flash', 'eco', true, 10),
      config('inactive', 'deepseek/deepseek-v3.2', 'eco', false, 5),
      config('next', 'qwen/qwen3-32b', 'eco', true, 20),
    ];

    const triplet = [
      configs[0],
      configs[1],
      configs[2],
    ];
    const tripletWithInactiveFallback = [
      { ...triplet[0], fallback_id: 'inactive' },
      triplet[1],
      triplet[2],
    ];

    const attempts = buildAttempts(tripletWithInactiveFallback, configs);
    const attemptedIds = attempts.flat().map((candidate) => candidate.modelId);

    expect(attemptedIds).not.toContain('deepseek/deepseek-v3.2');
    expect(attempts[0].map((candidate) => candidate.modelId)).toEqual([
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'qwen/qwen3-32b',
    ]);
  });

  it('nunca añade un fallback que ya forma parte del triplete', () => {
    const configs: ModelConfigLike[] = [
      { ...config('free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'free', true, 50), fallback_id: 'active-a' },
      config('active-a', 'deepseek/deepseek-v4.1-flash', 'eco', true, 10),
      config('active-b', 'tencent/hy4-flash', 'eco', true, 10),
    ];

    const attempts = buildAttempts(configs, configs);

    expect(attempts[0].map((candidate) => candidate.modelId)).toEqual([
      'nvidia/nemotron-3-ultra-550b-a55b:free',
    ]);
  });
});
