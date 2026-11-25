import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/server';
import { extractArticle, extractYoutube, extractDomain, isYoutubeUrl } from '@/lib/ai/extract';
import { FEVER_SYSTEM_PROMPT } from '@/lib/ai/prompt';
import { callModel, type OpenRouterResult } from '@/lib/ai/openrouter';
import { parseModelOutput, type ParsedAnalysis } from '@/lib/ai/parse';
import { computeConsensus, type ModelReport } from '@/lib/consensus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DAILY_LIMIT = 5;
const MIN_VALID_MODELS = 2;

const TIER_ORDER: Record<string, number> = { free: 0, eco: 1, frontier: 2 };

const PRICE_PER_1M_TOKENS: Record<string, { input: number; output: number }> = {
  'deepseek/deepseek-v3.2': { input: 0.27, output: 0.4 },
  'qwen/qwen3-32b': { input: 0.08, output: 0.28 },
  'meta-llama/llama-3.3-70b-instruct': { input: 0.1, output: 0.32 },
};

interface ModelConfigRow {
  id: string;
  model_id: string;
  tier: string;
  fallback_id: string | null;
  is_active: boolean;
  context_window: number | null;
}

interface SuccessfulCall extends OpenRouterResult {
  tier: string;
  parsed: ParsedAnalysis;
}

function claimsToArray(raw: unknown): string[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const claims = (raw as { claims?: unknown }).claims;
  if (!Array.isArray(claims) || claims.length === 0) return null;
  const list = claims
    .map((c) => (typeof c === 'string' ? c : (c as { claim?: unknown }).claim))
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
  return list.length > 0 ? list : null;
}

function biasFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = (raw as { bias_analysis?: unknown }).bias_analysis;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function supabaseAdmin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export async function POST(request: Request) {
  let body: { url?: string; politicianId?: string; force?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const url = body?.url;
  const politicianId = body?.politicianId;
  const force = body?.force === true;

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'URL es requerida' }, { status: 400 });
  }
  if (!politicianId || typeof politicianId !== 'string') {
    return NextResponse.json({ error: 'ID del político es requerido' }, { status: 400 });
  }
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: 'URL inválida' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Debes iniciar sesión para aportar fuentes' }, { status: 401 });
  }

  // Cache: si la URL ya existe en sources, se devuelve sin re-analizar (salvo force)
  const { data: existing } = await supabase
    .from('sources')
    .select('*')
    .eq('url', url)
    .maybeSingle();
  if (existing && !force) {
    return NextResponse.json({ source: existing, cached: true });
  }

  // Rate limit: máx 5 análisis/día por usuario autenticado
  const today = new Date().toISOString().slice(0, 10);
  const { count } = await supabase
    .from('sources')
    .select('id', { count: 'exact', head: true })
    .eq('submitted_by', user.id)
    .gte('created_at', `${today}T00:00:00.000Z`);
  if ((count ?? 0) >= DAILY_LIMIT) {
    return NextResponse.json(
      { error: `Límite diario alcanzado (máximo ${DAILY_LIMIT} análisis por día)` },
      { status: 429 }
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Configuración del servidor incompleta' }, { status: 500 });
  }
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY no configurada' }, { status: 500 });
  }
  const admin = supabaseAdmin();

  // 1. Extracción de contenido (artículo o YouTube)
  let content;
  try {
    content = isYoutubeUrl(url) ? await extractYoutube(url) : await extractArticle(url);
  } catch (error) {
    console.error('[analyze] Error de extracción:', error);
    return NextResponse.json({ error: 'No se pudo acceder o procesar la URL' }, { status: 502 });
  }

  let source: Record<string, unknown>;
  let sourceId: string;

  if (existing && force) {
    // Re-análisis: borrar reportes previos y resetear el veredicto antes de volver a analizar
    source = existing;
    sourceId = existing.id;

    const { error: deleteError } = await admin.from('ai_reports').delete().eq('source_id', sourceId);
    if (deleteError) {
      console.error('[analyze] Error borrando ai_reports previos:', deleteError);
      return NextResponse.json({ error: 'No se pudieron borrar los reportes previos' }, { status: 500 });
    }

    const { error: resetError } = await admin
      .from('sources')
      .update({
        verdict: null,
        verdict_score: null,
        consensus_agreement: null,
        requires_review: false,
      })
      .eq('id', sourceId);
    if (resetError) {
      console.error('[analyze] Error reseteando veredicto:', resetError);
      return NextResponse.json({ error: 'No se pudo reiniciar el análisis de la fuente' }, { status: 500 });
    }
  } else {
    // 2. Inferir media_outlet_id desde el dominio de la URL (crear si no existe)
    const domain = extractDomain(url);
    let mediaOutletId: string | null = null;
    const { data: outlet } = await admin.from('media_outlets').select('id').eq('domain', domain).maybeSingle();
    if (outlet) {
      mediaOutletId = outlet.id;
    } else {
      const { data: newOutlet, error: outletError } = await admin
        .from('media_outlets')
        .insert({ domain, name: domain })
        .select('id')
        .single();
      if (!outletError && newOutlet) mediaOutletId = newOutlet.id;
    }

    // 3. Insertar la fuente
    const { data: insertedSource, error: sourceError } = await admin
      .from('sources')
      .insert({
        url,
        politician_id: politicianId,
        source_type: content.sourceType,
        title: content.title,
        status: 'no_verificada',
        submitted_by: user.id,
        media_outlet_id: mediaOutletId,
      })
      .select()
      .single();

    if (sourceError) {
      console.error('[analyze] Error insertando fuente:', sourceError);
      if (sourceError.code === '23505') {
        return NextResponse.json({ error: 'Esta fuente ya ha sido añadida.' }, { status: 409 });
      }
      return NextResponse.json({ error: sourceError.message || 'Error al guardar la fuente.' }, { status: 500 });
    }

    source = insertedSource;
    sourceId = insertedSource.id;
  }

  // 4. Leer el triplete activo de ai_model_config (tier free primero) con su fallback
  const { data: configs } = await admin.from('ai_model_config').select('*');
  const configRows = (configs ?? []) as ModelConfigRow[];
  const configById = new Map(configRows.map((c) => [c.id, c]));
  const activeSorted = configRows
    .filter((c) => c.is_active)
    .sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9));
  const triplet = activeSorted.slice(0, 3);

  if (triplet.length === 0) {
    await admin.from('sources').update({ status: 'requiere_revision', requires_review: true }).eq('id', sourceId);
    return NextResponse.json({ error: 'No hay modelos configurados para el análisis' }, { status: 500 });
  }

  const attempts: Array<{ modelId: string; tier: string }[]> = triplet.map((cfg) => {
    const list: Array<{ modelId: string; tier: string }> = [{ modelId: cfg.model_id, tier: cfg.tier }];
    if (cfg.fallback_id) {
      const fallback = configById.get(cfg.fallback_id);
      if (fallback?.model_id && !list.some((c) => c.modelId === fallback.model_id)) {
        list.push({ modelId: fallback.model_id, tier: fallback.tier ?? 'eco' });
      }
    }
    return list;
  });

  // 5. Llamada multi-modelo en paralelo con fallback por modelo
  const settled = await Promise.allSettled(
    attempts.map(async (candidates) => {
      for (const candidate of candidates) {
        const result = await callModel(candidate.modelId, apiKey, FEVER_SYSTEM_PROMPT, content.text);
        if (result) {
          return { ...result, tier: candidate.tier, parsed: parseModelOutput(result.model, result.content) };
        }
      }
      return null;
    })
  );

  const successes: SuccessfulCall[] = settled
    .filter((s): s is PromiseFulfilledResult<SuccessfulCall | null> => s.status === 'fulfilled')
    .map((s) => s.value)
    .filter((v): v is SuccessfulCall => v !== null);

  const parsedModels = successes.filter((s) => s.parsed.report !== null);
  const reports: ModelReport[] = parsedModels.map((s) => s.parsed.report as ModelReport);

  // 6. Persistir reportes por modelo + costos
  let reportInserts = 0;
  let reportInsertFailures = 0;

  for (const s of parsedModels) {
    const raw = s.parsed.raw;
    reportInserts += 1;
    const { error: reportError } = await admin.from('ai_reports').insert({
      source_id: sourceId,
      model_name: s.model,
      report_json: raw,
      summary: s.parsed.report?.summary,
      veracity_score: s.parsed.report?.veracityScore,
      coherence_score: s.parsed.report?.coherenceScore,
      bias_analysis: biasFromRaw(raw),
      key_claims: claimsToArray(raw),
    });
    if (reportError) {
      reportInsertFailures += 1;
      console.error('[analyze] Error insertando ai_reports:', {
        source_id: sourceId,
        model_name: s.model,
        error: reportError,
      });
    }

    const price = PRICE_PER_1M_TOKENS[s.model];
    const costUsd = price
      ? Number(((s.inputTokens / 1e6) * price.input + (s.outputTokens / 1e6) * price.output).toFixed(8))
      : null;
    const { error: costError } = await admin.from('ai_cost_log').insert({
      source_id: sourceId,
      model_id: s.model,
      input_tokens: s.inputTokens,
      output_tokens: s.outputTokens,
      cost_usd: costUsd,
      latency_ms: s.latencyMs,
      tier: s.tier,
    });
    if (costError) {
      // El cost log es telemetría: no bloquea el flujo, solo se registra.
      console.error('[analyze] Error insertando ai_cost_log:', {
        source_id: sourceId,
        model_name: s.model,
        error: costError,
      });
    }
  }

  // Si ningún reporte llegó a guardarse, no fingir éxito: marcar para revisión y fallar.
  if (reportInserts > 0 && reportInsertFailures === reportInserts) {
    const { error: reviewError } = await admin
      .from('sources')
      .update({ status: 'requiere_revision', requires_review: true })
      .eq('id', sourceId);
    if (reviewError) {
      console.error('[analyze] Error marcando fuente requires_review:', {
        source_id: sourceId,
        error: reviewError,
      });
    }
    return NextResponse.json({ error: 'No se pudo guardar ningún reporte de análisis' }, { status: 500 });
  }

  // 7. Consenso entre modelos
  const consensus = computeConsensus(reports, MIN_VALID_MODELS);

  const { data: updatedSource, error: updateError } = await admin
    .from('sources')
    .update({
      status: consensus.requiresReview ? 'requiere_revision' : 'verificada',
      verdict: consensus.verdictLabel,
      verdict_score: consensus.averageVeracity,
      consensus_agreement: consensus.consensusAgreement,
      requires_review: consensus.requiresReview,
    })
    .eq('id', sourceId)
    .select()
    .single();

  if (updateError) {
    console.error('[analyze] Error actualizando fuente:', updateError);
  }

  return NextResponse.json({
    source: updatedSource ?? source,
    consensus,
    analyzedBy: parsedModels.length,
  });
}
