import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sugerirVinculos, type ParlamentarioParaVincular, type PoliticoParaVincular } from './parliamentary-matching';

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}));

const PARLAMENTARIO: ParlamentarioParaVincular = {
  parlId: '101',
  nombre: 'José Pérez Muñoz',
  apellidoPaterno: 'Pérez',
  apellidoMaterno: 'Muñoz',
  partido: 'Partido Alfa',
};

beforeEach(() => {
  createClientMock.mockReset();
});

describe('sugerirVinculos', () => {
  it('sugiere confianza alta cuando el nombre normalizado es idéntico', () => {
    const politicos: PoliticoParaVincular[] = [
      { id: 'politico-1', nombreCompleto: 'JOSE PEREZ MUNOZ', partido: 'Partido Alfa' },
    ];

    const sugerencias = sugerirVinculos([PARLAMENTARIO], politicos);

    expect(sugerencias).toEqual([
      {
        parlId: '101',
        politicianId: 'politico-1',
        confianza: 'alta',
        motivo: 'El nombre normalizado coincide exactamente.',
      },
    ]);
  });

  it('sugiere confianza baja cuando coinciden apellido paterno y partido pero difiere el nombre', () => {
    const politicos: PoliticoParaVincular[] = [
      { id: 'politico-2', nombreCompleto: 'María Pérez Soto', partido: 'Partido Alfa' },
    ];

    const sugerencias = sugerirVinculos([PARLAMENTARIO], politicos);

    expect(sugerencias).toHaveLength(1);
    expect(sugerencias[0]).toMatchObject({
      parlId: '101',
      politicianId: 'politico-2',
      confianza: 'baja',
    });
    expect(sugerencias[0].motivo).toMatch(/confirmar manualmente/i);
  });

  it('no sugiere nada cuando no hay coincidencia de apellido ni partido', () => {
    const politicos: PoliticoParaVincular[] = [
      { id: 'politico-3', nombreCompleto: 'Ana Rojas Díaz', partido: 'Partido Beta' },
    ];

    expect(sugerirVinculos([PARLAMENTARIO], politicos)).toEqual([]);
  });

  it('no escribe en la base de datos ni modifica las entradas', () => {
    const politicos: PoliticoParaVincular[] = [
      { id: 'politico-1', nombreCompleto: 'José Pérez Muñoz', partido: 'Partido Alfa' },
    ];
    const parlamentarios = [{ ...PARLAMENTARIO }];
    const politicosCopia = politicos.map((politico) => ({ ...politico }));

    const sugerencias = sugerirVinculos(parlamentarios, politicos);

    expect(sugerencias).toHaveLength(1);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(parlamentarios).toEqual([PARLAMENTARIO]);
    expect(politicos).toEqual(politicosCopia);
    expect(parlamentarios[0]).not.toHaveProperty('politician_id');
    expect(parlamentarios[0]).not.toHaveProperty('match_confirmado');
  });
});
