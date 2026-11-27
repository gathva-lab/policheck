import { timingSafeEqual } from 'node:crypto';

export const MAINTENANCE_KEY_HEADER = 'x-sweep-key';

export interface MaintenanceAuthFailure {
  status: number;
  body: { error: string; hint?: string };
}

// Se aceptan ambas claves de forma independiente: que SWEEP_KEY esté definida
// no debe dejar inutilizable la service role del proyecto.
export function validMaintenanceKeys(): string[] {
  return [process.env.SWEEP_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(
    (key): key is string => typeof key === 'string' && key.length > 0
  );
}

// Comparación en tiempo constante. Si las longitudes difieren se descarta sin
// comparar para que timingSafeEqual no lance una excepción.
export function isAuthorized(
  header: string | null,
  candidates: Array<string | null | undefined>
): boolean {
  if (!header) return false;
  const provided = Buffer.from(header, 'utf8');
  let authorized = false;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const expected = Buffer.from(candidate, 'utf8');
    if (expected.length !== provided.length) continue;
    if (timingSafeEqual(provided, expected)) authorized = true;
  }
  return authorized;
}

export function maintenanceAuthFailure(request: Request): MaintenanceAuthFailure | null {
  const header = request.headers.get(MAINTENANCE_KEY_HEADER);
  if (!header) {
    return {
      status: 401,
      body: {
        error: 'Falta la cabecera x-sweep-key',
        hint: 'envía la clave con -H "x-sweep-key: <clave>" sin los signos < >',
      },
    };
  }
  if (!isAuthorized(header, validMaintenanceKeys())) {
    return {
      status: 401,
      body: { error: 'La clave no coincide con SWEEP_KEY ni con SUPABASE_SERVICE_ROLE_KEY' },
    };
  }
  return null;
}
