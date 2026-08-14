import { describe, it, expect } from 'vitest';
import {
  tierFromScore,
  tierFromLabel,
  scoreRangeForLabel,
  colorFromScore,
  colorFromLabel,
  clampScore,
  isVerdictLabel,
} from './veracity';

describe('tierFromScore (taxonomía 0-100)', () => {
  const cases: Array<[number, string]> = [
    [100, 'verdadero'],
    [95, 'verdadero'],
    [90, 'verdadero'],
    [89, 'verdadero_pero'],
    [80, 'verdadero_pero'],
    [75, 'verdadero_pero'],
    [74, 'discutible'],
    [65, 'discutible'],
    [60, 'discutible'],
    [59, 'apresurado'],
    [50, 'apresurado'],
    [45, 'apresurado'],
    [44, 'exagerado'],
    [35, 'exagerado'],
    [30, 'exagerado'],
    [29, 'enganoso'],
    [20, 'enganoso'],
    [15, 'enganoso'],
    [14, 'insostenible'],
    [10, 'insostenible'],
    [5, 'insostenible'],
    [4, 'inchequeable'],
    [2, 'inchequeable'],
    [0, 'inchequeable'],
  ];

  cases.forEach(([score, label]) => {
    it(`${score} → ${label}`, () => {
      expect(tierFromScore(score)?.label).toBe(label);
    });
  });

  it('mapea scores fuera de 0-100 al borde más cercano', () => {
    expect(tierFromScore(150)?.label).toBe('verdadero');
    expect(tierFromScore(-5)?.label).toBe('inchequeable');
  });

  it('devuelve null para valores nulos/NaN', () => {
    expect(tierFromScore(null)).toBeNull();
    expect(tierFromScore(undefined)).toBeNull();
    expect(tierFromScore(Number.NaN)).toBeNull();
  });
});

describe('colores de la taxonomía', () => {
  it('mapea color por score', () => {
    expect(colorFromScore(95)).toBe('green');
    expect(colorFromScore(65)).toBe('yellow');
    expect(colorFromScore(35)).toBe('orange');
    expect(colorFromScore(20)).toBe('red');
    expect(colorFromScore(2)).toBe('gray');
  });

  it('mapea color por label', () => {
    expect(colorFromLabel('verdadero')).toBe('green');
    expect(colorFromLabel('verdadero_pero')).toBe('green');
    expect(colorFromLabel('apresurado')).toBe('yellow');
    expect(colorFromLabel('exagerado')).toBe('orange');
    expect(colorFromLabel('insostenible')).toBe('red');
    expect(colorFromLabel('anejo')).toBe('gray');
  });

  it('maneja labels inválidos', () => {
    expect(colorFromLabel(null)).toBeNull();
    expect(colorFromLabel('falso')).toBeNull();
  });
});

describe('scoreRangeForLabel', () => {
  it('inchequeable y anejo comparten el rango 0-4', () => {
    expect(scoreRangeForLabel('inchequeable')).toEqual({ min: 0, max: 4 });
    expect(scoreRangeForLabel('anejo')).toEqual({ min: 0, max: 4 });
  });

  it('verdadero ocupa 90-100', () => {
    expect(scoreRangeForLabel('verdadero')).toEqual({ min: 90, max: 100 });
  });
});

describe('helpers', () => {
  it('clampScore limita entre 0 y 100', () => {
    expect(clampScore(-10)).toBe(0);
    expect(clampScore(150)).toBe(100);
    expect(clampScore(42)).toBe(42);
    expect(clampScore(Number.NaN)).toBe(0);
  });

  it('isVerdictLabel reconoce solo las 9 etiquetas válidas', () => {
    expect(isVerdictLabel('verdadero')).toBe(true);
    expect(isVerdictLabel('anejo')).toBe(true);
    expect(isVerdictLabel('falso')).toBe(false);
  });

  it('tierFromLabel reconoce todas las etiquetas', () => {
    for (const label of ['verdadero', 'verdadero_pero', 'discutible', 'apresurado', 'exagerado', 'enganoso', 'insostenible', 'inchequeable', 'anejo']) {
      expect(tierFromLabel(label)).not.toBeNull();
    }
  });
});
