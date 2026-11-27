import { describe, expect, it } from 'vitest';
import { calcularEstadoPadron } from './parlamentarios-estado';

describe('calcularEstadoPadron', () => {
  it('muestra el padrón vacío cuando no hay filas y el conteo es cero', () => {
    expect(calcularEstadoPadron(0, false, 0)).toEqual({ tipo: 'vacio' });
    expect(calcularEstadoPadron(0, false, null)).toEqual({ tipo: 'vacio' });
  });

  it('detecta lectura bloqueada cuando hay filas guardadas pero se leen cero', () => {
    expect(calcularEstadoPadron(0, false, 31)).toEqual({
      tipo: 'bloqueado',
      totalGuardado: 31,
    });
  });

  it('considera ok cuando hay filas leídas', () => {
    expect(calcularEstadoPadron(31, false, 31)).toEqual({
      tipo: 'ok',
      totalLeido: 31,
    });
    expect(calcularEstadoPadron(1, false, null)).toEqual({
      tipo: 'ok',
      totalLeido: 1,
    });
  });

  it('prioriza el error sobre el conteo', () => {
    expect(calcularEstadoPadron(0, true, 31)).toEqual({ tipo: 'error' });
  });
});
