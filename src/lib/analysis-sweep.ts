import type { SupabaseClient } from '@supabase/supabase-js';

export const STUCK_ANALYSIS_AFTER_MS = 5 * 60 * 1000;
export const STUCK_STATUSES = ['procesando', 'no_verificada'] as const;

export async function sweepStuckSources(admin: SupabaseClient, now: number = Date.now()): Promise<number> {
  const cutoff = new Date(now - STUCK_ANALYSIS_AFTER_MS).toISOString();

  const { data: candidates, error: candidatesError } = await admin
    .from('sources')
    .select('id')
    .in('status', [...STUCK_STATUSES])
    .lt('analysis_started_at', cutoff);

  if (candidatesError) {
    throw new Error(`No se pudieron leer las fuentes colgadas: ${candidatesError.message}`);
  }

  const ids = ((candidates ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (ids.length === 0) return 0;

  const { data: reports, error: reportsError } = await admin
    .from('ai_reports')
    .select('source_id')
    .in('source_id', ids);

  if (reportsError) {
    throw new Error(`No se pudieron leer los reportes: ${reportsError.message}`);
  }

  const withReports = new Set(
    ((reports ?? []) as Array<{ source_id: string | null }>).map((row) => row.source_id)
  );
  const toRecover = ids.filter((id) => !withReports.has(id));
  if (toRecover.length === 0) return 0;

  const { error: updateError } = await admin
    .from('sources')
    .update({
      status: 'requiere_revision',
      requires_review: true,
      analysis_error: 'Recuperada por sweep: análisis colgado más de 5 minutos',
      analysis_finished_at: new Date(now).toISOString(),
    })
    .in('id', toRecover);

  if (updateError) {
    throw new Error(`No se pudieron recuperar las fuentes: ${updateError.message}`);
  }

  return toRecover.length;
}
