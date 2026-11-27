import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  checkModel,
  providerForModel,
  routedModelIdFor,
  type LlmProvider,
  type ModelCheckResult,
} from '@/lib/ai/llm';
import { fetchNvidiaModelCatalog } from '@/lib/ai/nvidia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// El diagnóstico usa prompts mínimos: 200 tokens dejan margen a los modelos de
// razonamiento para emitir contenido en vez de gastarlo pensando.
const CHECK_MAX_TOKENS = 200;

function supabaseAdmin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

interface ModelRow {
  model_id: string;
  provider?: string | null;
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
      .select('model_id, provider')
      .eq('is_active', true)
      .order('model_id');

    if (error) {
      console.error('[models-check] Error leyendo ai_model_config:', error);
      return NextResponse.json({ error: 'No se pudo leer el catálogo de modelos' }, { status: 500 });
    }

    const nvidiaApiKey = process.env.NVIDIA_API_KEY?.trim();
    // El catálogo de NVIDIA se consulta una sola vez por ejecución, no por modelo.
    let nvidiaCatalogPromise: Promise<Set<string> | null> | null = null;
    const getNvidiaCatalog = (): Promise<Set<string> | null> => {
      if (!nvidiaCatalogPromise) {
        nvidiaCatalogPromise = fetchNvidiaModelCatalog(nvidiaApiKey as string);
      }
      return nvidiaCatalogPromise;
    };

    const results: ModelCheckResult[] = [];
    for (const row of (data ?? []) as ModelRow[]) {
      const provider = providerForModel(row.model_id, row.provider);
      const routedModelId = routedModelIdFor(row.model_id, provider);

      try {
        // Con proveedor NVIDIA se valida que el id enrutado exista en su
        // catálogo: así un alias desalineado no falla de forma silenciosa.
        if (provider === 'nvidia' && nvidiaApiKey) {
          const catalog = await getNvidiaCatalog();
          if (catalog && !catalog.has(routedModelId)) {
            results.push({
              model_id: row.model_id,
              provider: 'nvidia',
              provider_used: 'nvidia',
              fallback_used: false,
              routed_model_id: routedModelId,
              ok: false,
              http_status: null,
              latency_ms: 0,
              content_chars: 0,
              error_reason: 'modelo_no_existe_en_proveedor',
              finish_reason: null,
            });
            continue;
          }
        }

        results.push(
          await checkModel(row.model_id, apiKey, {
            maxTokens: CHECK_MAX_TOKENS,
            provider,
          })
        );
      } catch (modelError) {
        // checkModel no debería lanzar, pero un fallo aislado no debe abortar
        // el diagnóstico del resto de modelos.
        console.error('[models-check] Error comprobando modelo:', {
          model_id: row.model_id,
          error: modelError instanceof Error ? modelError.message : modelError,
        });
        const usedProvider: LlmProvider = provider;
        results.push({
          model_id: row.model_id,
          provider: usedProvider,
          provider_used: usedProvider,
          fallback_used: false,
          routed_model_id: routedModelId,
          ok: false,
          http_status: null,
          latency_ms: 0,
          content_chars: 0,
          error_reason: 'http_error',
          finish_reason: null,
        });
      }
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error('[models-check] Error:', error);
    return NextResponse.json({ error: 'No se pudo ejecutar el diagnóstico' }, { status: 500 });
  }
}
