export type EstadoPadron =
  | { tipo: 'error' }
  | { tipo: 'vacio' }
  | { tipo: 'bloqueado'; totalGuardado: number }
  | { tipo: 'ok'; totalLeido: number };

// Distingue un padrón realmente vacío de una lectura bloqueada por RLS: si la
// consulta pública no devuelve filas pero el conteo con la clave de servicio
// (o el conteo exacto de la tabla) ve registros, falta la política de lectura.
export function calcularEstadoPadron(
  filasLeidas: number,
  hayError: boolean,
  totalGuardado: number | null
): EstadoPadron {
  if (hayError) return { tipo: 'error' };
  if (filasLeidas > 0) return { tipo: 'ok', totalLeido: filasLeidas };
  if (totalGuardado !== null && totalGuardado > 0) {
    return { tipo: 'bloqueado', totalGuardado };
  }
  return { tipo: 'vacio' };
}
