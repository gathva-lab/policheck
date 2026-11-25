import { describe, it, expect } from 'vitest';
import { pickTriplet, type ModelConfigLike } from './model-selection';

function config(id: string, model_id: string, tier: string, is_active = true): ModelConfigLike {
  return { id, model_id, tier, is_active };
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
