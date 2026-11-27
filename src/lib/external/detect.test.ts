import { describe, expect, it } from 'vitest';
import { detectIndicators } from './detect';

function ids(text: string): string[] {
  return detectIndicators(text).map((info) => info.id);
}

describe('detectIndicators', () => {
  it('detecta el IPC sin importar acentos ni mayúsculas', () => {
    expect(ids('La inflación llegó a 0,5%.')).toContain('F074.IPC.VAR.Z.EP23.C.M');
    expect(ids('LA INFLACION SUBIÓ')).toContain('F074.IPC.VAR.Z.EP23.C.M');
    expect(ids('el ipc de octubre')).toContain('F074.IPC.VAR.Z.EP23.C.M');
  });

  it('detecta el dólar con y sin tilde', () => {
    expect(ids('El dólar cerró alto')).toContain('F073.TCO.PRE.Z.D');
    expect(ids('El DOLAR cerró alto')).toContain('F073.TCO.PRE.Z.D');
  });

  it('devuelve como máximo 3 indicadores ordenados por apariciones', () => {
    const result = detectIndicators(
      'La UF subió. La UF es una unidad de fomento. La UTM también subió. ' +
        'El dólar y el tipo de cambio subieron. La inflación y el IPC preocuparon. La UTM y la UF otra vez.'
    );

    expect(result.length).toBeLessThanOrEqual(3);
    expect(result.map((info) => info.id)).toContain('F073.UFF.PRE.Z.D');
  });

  it('no detecta indicadores cuando el texto es ajeno al catálogo', () => {
    expect(detectIndicators('El partido ganó las elecciones municipales.')).toEqual([]);
    expect(detectIndicators('')).toEqual([]);
  });
});
