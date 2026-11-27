// Sugerencia de vínculos entre el padrón oficial y los políticos de Policheck.
// Esta capa es deliberadamente pura: compara nombres y devuelve candidatos,
// pero NUNCA escribe politician_id ni match_confirmado en la base de datos.
// La confirmación es un paso humano porque un mapeo erróneo atribuiría votos a
// la persona equivocada.

import { normalizarNombre } from '@/lib/external/senado';

export interface ParlamentarioParaVincular {
  parlId: string;
  nombre: string;
  nombreNormalizado?: string;
  apellidoPaterno?: string | null;
  apellidoMaterno?: string | null;
  partido?: string | null;
}

export interface PoliticoParaVincular {
  id: string;
  nombreCompleto: string;
  partido?: string | null;
}

export interface SugerenciaVinculo {
  parlId: string;
  politicianId: string;
  confianza: 'alta' | 'baja';
  motivo: string;
}

interface PoliticoNormalizado {
  id: string;
  nombreNormalizado: string;
  tokens: string[];
  partidoNormalizado: string;
}

function normalizarOpcional(valor: string | null | undefined): string {
  return normalizarNombre(valor ?? '');
}

export function sugerirVinculos(
  parlamentarios: ParlamentarioParaVincular[],
  politicos: PoliticoParaVincular[]
): SugerenciaVinculo[] {
  const politicosNormalizados: PoliticoNormalizado[] = politicos.map((politico) => {
    const nombreNormalizado = normalizarNombre(politico.nombreCompleto);
    return {
      id: politico.id,
      nombreNormalizado,
      tokens: nombreNormalizado.split(' ').filter((token) => token.length > 0),
      partidoNormalizado: normalizarOpcional(politico.partido),
    };
  });

  const sugerencias: SugerenciaVinculo[] = [];

  for (const parlamentario of parlamentarios) {
    const nombreParlamentario =
      parlamentario.nombreNormalizado ?? normalizarNombre(parlamentario.nombre);
    const partidoParlamentario = normalizarOpcional(parlamentario.partido);
    const apellidos = [
      normalizarOpcional(parlamentario.apellidoPaterno),
      normalizarOpcional(parlamentario.apellidoMaterno),
    ].filter((apellido) => apellido.length > 0);

    for (const politico of politicosNormalizados) {
      if (nombreParlamentario.length === 0) continue;

      // Confianza alta: el nombre completo normalizado es idéntico.
      if (nombreParlamentario === politico.nombreNormalizado) {
        sugerencias.push({
          parlId: parlamentario.parlId,
          politicianId: politico.id,
          confianza: 'alta',
          motivo: 'El nombre normalizado coincide exactamente.',
        });
        continue;
      }

      // Confianza baja: apellido paterno y partido coinciden, pero el nombre
      // difiere o falta uno de los apellidos. Sirve solo para revisión humana.
      const apellidoPaterno = apellidos[0];
      const apellidoPaternoCoincide =
        Boolean(apellidoPaterno) && politico.tokens.includes(apellidoPaterno);
      const partidoCoincide =
        partidoParlamentario.length > 0 &&
        partidoParlamentario === politico.partidoNormalizado;

      if (!apellidoPaternoCoincide || !partidoCoincide) continue;

      const apellidoMaterno = apellidos[1];
      const faltaApellido =
        apellidos.length < 2 ||
        !apellidoMaterno ||
        !politico.tokens.includes(apellidoMaterno);

      sugerencias.push({
        parlId: parlamentario.parlId,
        politicianId: politico.id,
        confianza: 'baja',
        motivo: faltaApellido
          ? 'Coinciden el apellido paterno y el partido, pero falta o difiere un apellido; confirmar manualmente.'
          : 'Coinciden los apellidos y el partido, pero difiere el nombre; confirmar manualmente.',
      });
    }
  }

  return sugerencias;
}
