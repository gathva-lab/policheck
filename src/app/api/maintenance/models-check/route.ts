import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { checkModel, type ModelCheckResult } from '@/lib/ai/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function supabaseAdmin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

interface ModelRow {
  model_id: string;
}

export async function POST(request: Request) {
  const expectedKey = process.env.SWEEP_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expectedKey || request.headers.get('x-sweep-key') !== expectedKey) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Configuración del servidor incompleta' }, { status: 500 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY no configurada' }, { status: 500 });
  }

  try {
    const { data, error } = await supabaseAdmin()
      .from('ai_model_config')
      .select('model_id')
      .eq('is_active', true)
      .order('model_id');

    if (error) {
      console.error('[models-check] Error leyendo ai_model_config:', error);
      return NextResponse.json({ error: 'No se pudo leer el catálogo de modelos' }, { status: 500 });
    }

    const results: ModelCheckResult[] = [];
    for (const row of (data ?? []) as ModelRow[]) {
      try {
        results.push(await checkModel(row.model_id, apiKey, 60));
      } catch (modelError) {
        // checkModel no debería lanzar, pero un fallo aislado no debe abortar
        // el diagnóstico del resto de modelos.
        console.error('[models-check] Error comprobando modelo:', {
          model_id: row.model_id,
          error: modelError instanceof Error ? modelError.message : modelError,
        });
        results.push({
          model_id: row.model_id,
          provider: 'openrouter',
          ok: false,
          http_status: null,
          latency_ms: 0,
          content_chars: 0,
          error_reason: 'http_error',
        });
      }
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error('[models-check] Error:', error);
    return NextResponse.json({ error: 'No se pudo ejecutar el diagnóstico' }, { status: 500 });
  }
}
