import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 30;
const PAGE_SIZE = 1000;

interface CostLogRow {
  model_id: string | null;
  error_reason: string | null;
  latency_ms: number | null;
}

interface ModelStats {
  model_id: string;
  llamadas: number;
  exitos: number;
  timeouts: number;
  otros_errores: number;
  latencia_media_ms: number | null;
  tasa_exito: number;
}

interface Accumulator {
  llamadas: number;
  exitos: number;
  timeouts: number;
  otros_errores: number;
  latenciaSuma: number;
  latenciaCuenta: number;
}

function supabaseAdmin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

function aggregate(rows: CostLogRow[]): ModelStats[] {
  const byModel = new Map<string, Accumulator>();

  for (const row of rows) {
    const model = row.model_id?.trim() || 'desconocido';
    let acc = byModel.get(model);
    if (!acc) {
      acc = { llamadas: 0, exitos: 0, timeouts: 0, otros_errores: 0, latenciaSuma: 0, latenciaCuenta: 0 };
      byModel.set(model, acc);
    }

    acc.llamadas += 1;
    if (row.error_reason === null || row.error_reason === undefined) {
      acc.exitos += 1;
    } else if (row.error_reason === 'timeout') {
      acc.timeouts += 1;
    } else {
      acc.otros_errores += 1;
    }

    if (typeof row.latency_ms === 'number' && Number.isFinite(row.latency_ms)) {
      acc.latenciaSuma += row.latency_ms;
      acc.latenciaCuenta += 1;
    }
  }

  return Array.from(byModel.entries())
    .map(([model_id, acc]) => ({
      model_id,
      llamadas: acc.llamadas,
      exitos: acc.exitos,
      timeouts: acc.timeouts,
      otros_errores: acc.otros_errores,
      latencia_media_ms:
        acc.latenciaCuenta > 0 ? Math.round(acc.latenciaSuma / acc.latenciaCuenta) : null,
      tasa_exito: acc.llamadas > 0 ? Number((acc.exitos / acc.llamadas).toFixed(4)) : 0,
    }))
    .sort((a, b) => b.llamadas - a.llamadas || a.model_id.localeCompare(b.model_id));
}

async function fetchRows(since: string): Promise<CostLogRow[]> {
  const rows: CostLogRow[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await supabaseAdmin()
      .from('ai_cost_log')
      .select('model_id, error_reason, latency_ms')
      .gte('created_at', since)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }

    const batch = (data ?? []) as CostLogRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

export async function GET(request: Request) {
  const expectedKey = process.env.SWEEP_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expectedKey || request.headers.get('x-sweep-key') !== expectedKey) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Configuración del servidor incompleta' }, { status: 500 });
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const rows = await fetchRows(since);
    return NextResponse.json({
      window_days: WINDOW_DAYS,
      since,
      models: aggregate(rows),
    });
  } catch (error) {
    console.error('[models-stats] Error:', error);
    return NextResponse.json({ error: 'No se pudieron calcular las estadísticas' }, { status: 500 });
  }
}
