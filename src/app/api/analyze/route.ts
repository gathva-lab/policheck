import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/server';
import {
  extractArticle,
  extractYoutube,
  extractDomain,
  isYoutubeUrl,
  MIN_CONTENT_CHARS,
  type ExtractedContent,
} from '@/lib/ai/extract';
import { FEVER_SYSTEM_PROMPT } from '@/lib/ai/prompt';
import { callModel, type CallFailureReason, type OpenRouterResult } from '@/lib/ai/openrouter';
import { parseModelOutput, type ParsedAnalysis } from '@/lib/ai/parse';
import { computeConsensus, type ModelReport } from '@/lib/consensus';
import { pickTriplet } from '@/lib/ai/model-selection';
import { normalizeUrl } from '@/lib/url';
import {
  isVerifiable,
  verifyConsensusVerdict,
  jevCostUsd,
  JEV_MODEL,
  type ConsensusVerification,
  type JevUsage,
} from '@/lib/ai/jev';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DAILY_LIMIT = 5;
const MIN_VALID_MODELS = 2;

// Precios verificados contra la API de OpenRouter el 2026-11-25.
const PRICE_PER_1M_TOKENS: Record<string, { input: number; output: number }> = {
  // Eco (operativos)
  'deepseek/deepseek-v3.2': { input: 0.26, output: 0.38 },
  'deepseek/deepseek-v4.1-flash': { input: 0.051, output: 0.203 },
  'tencent/hy4-flash': { input: 0.035, output: 0.14 },
  'qwen/qwen3-32b': { input: 0.08, output: 0.28 },
  // Free
  'nvidia/nemotron-3-ultra-550b-a55b:free': { input: 0, output: 0 },
  'nvidia/nemotron-3.5-lightning:free': { input: 0, output: 0 },
  'google/gemma-4-31b-it:free': { input: 0, output: 0 },
  'google/gemma-4-26b-a4b-it:free': { input: 0, output: 0 },
  // Decisiones (JEV): output gratis
  'typesafe/jev-1.14': { input: 0.042, output: 0 },
  // Frontier (desactivados por defecto; precios para cuando se activen)
  'anthropic/claude-sonnet-5.5': { input: 2.0, output: 10.0 },
  'anthropic/claude-opus-5.5': { input: 4.0, output: 20.0 },
  'openai/gpt-5.2-chat': { input: 1.75, output: 14.0 },
  'google/gemini-3-flash-preview': { input: 0.5, output: 3.0 },
  'x-ai/grok-4.3': { input: 1.25, output: 2.5 },
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

interface AttemptOutcome {
  call: SuccessfulCall | null;
  failureReason: CallFailureReason | null;
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

// El costo de JEV es solo de entrada: la salida (decisiones) es gratis.
async function logJevCost(
  admin: ReturnType<typeof supabaseAdmin>,
  sourceId: string,
  usage: JevUsage,
  latencyMs: number
) {
  const { error } = await admin.from('ai_cost_log').insert({
    source_id: sourceId,
    model_id: JEV_MODEL,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cost_usd: jevCostUsd(usage.inputTokens),
    latency_ms: latencyMs,
    tier: 'eco',
  });
  if (error) {
    console.error('[analyze] Error insertando ai_cost_log de JEV:', {
      source_id: sourceId,
      error,
    });
  }
}

// Trazabilidad: se guarda la verificación de JEV en el report_json de cada modelo.
async function saveJevToReports(
  admin: ReturnType<typeof supabaseAdmin>,
  sourceId: string,
  verification: ConsensusVerification
) {
  const { data, error } = await admin
    .from('ai_reports')
    .select('id, report_json')
    .eq('source_id', sourceId);
  if (error) {
    console.error('[analyze] Error leyendo ai_reports para guardar JEV:', {
      source_id: sourceId,
      error,
    });
    return;
  }

  const rows = (data ?? []) as Array<{ id: string; report_json: unknown }>;
  for (const row of rows) {
    const reportJson =
      row.report_json && typeof row.report_json === 'object' && !Array.isArray(row.report_json)
        ? { ...(row.report_json as Record<string, unknown>), _jev: verification }
        : { _jev: verification };
    const { error: updateError } = await admin
      .from('ai_reports')
      .update({ report_json: reportJson })
      .eq('id', row.id);
    if (updateError) {
      console.error('[analyze] Error guardando JEV en ai_reports:', {
        source_id: sourceId,
        report_id: row.id,
        error: updateError,
      });
    }
  }
}

export async function POST(request: Request) {
  // Toda la petición vive dentro del try para garantizar que una fuente nunca
  // quede colgada en `no_verificada` si el análisis falla a mitad de camino.
  let sourceId: string | null = null;
  let url: string | undefined;
  let etapa = 'extraccion';
  const startedAt = Date.now();

  try {
    let body: { url?: string; politicianId?: string; force?: boolean };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
    }

    url = body?.url;
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

  const normalizedUrl = normalizeUrl(url);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Debes iniciar sesión para aportar fuentes' }, { status: 401 });
  }

  // Cache: se compara siempre contra la URL normalizada para que las variantes
  // de YouTube (youtu.be, shorts, embed, parámetros ?si=) cuenten como la misma.
  const { data: existing } = await supabase
    .from('sources')
    .select('*')
    .eq('url', normalizedUrl)
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

  // La fuente se crea o resetea antes de extraer para poder registrar el inicio
  // del análisis y marcarla aunque la extracción falle o se agote.
  const startedAtIso = new Date().toISOString();
  let source: Record<string, unknown>;

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
        status: 'procesando',
        analysis_stage: 'extraccion',
        analysis_started_at: startedAtIso,
        analysis_finished_at: null,
        analysis_error: null,
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

    // 3. Insertar la fuente en estado `procesando`
    const { data: insertedSource, error: sourceError } = await admin
      .from('sources')
      .insert({
        url: normalizedUrl,
        politician_id: politicianId,
        source_type: isYoutubeUrl(normalizedUrl) ? 'video_youtube' : 'articulo_noticia',
        title: normalizedUrl,
        status: 'procesando',
        analysis_stage: 'extraccion',
        analysis_started_at: startedAtIso,
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

  if (!sourceId) {
    throw new Error('No se pudo determinar el identificador de la fuente');
  }

  const activeSourceId = sourceId;
  const setStage = async (stage: string) => {
    const { error: stageError } = await admin
      .from('sources')
      .update({ analysis_stage: stage })
      .eq('id', activeSourceId);
    if (stageError) {
      console.error('[analyze] Error actualizando analysis_stage:', {
        source_id: activeSourceId,
        stage,
        error: stageError,
      });
    }
  };

  etapa = 'extraccion';
  // 1. Extracción de contenido (artículo o YouTube)
  let content: ExtractedContent;
  try {
    content = isYoutubeUrl(normalizedUrl) ? await extractYoutube(normalizedUrl) : await extractArticle(normalizedUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error de extracción';
    console.error('[analyze] Error de extracción:', error);
    await admin
      .from('sources')
      .update({
        status: 'requiere_revision',
        requires_review: true,
        analysis_error: message,
        analysis_finished_at: new Date().toISOString(),
      })
      .eq('id', activeSourceId);
    return NextResponse.json(
      { error: 'No se pudo acceder o procesar la URL', source_id: activeSourceId },
      { status: 502 }
    );
  }

  await admin
    .from('sources')
    .update({ title: content.title, source_type: content.sourceType })
    .eq('id', activeSourceId);

  etapa = 'contenido';
  await setStage('contenido');

  const chars = content.text.trim().length;
  if (chars < MIN_CONTENT_CHARS) {
    const errorMessage = 'No se pudo extraer contenido suficiente de la fuente';
    await admin
      .from('sources')
      .update({
        status: 'requiere_revision',
        requires_review: true,
        analysis_error: errorMessage,
        analysis_finished_at: new Date().toISOString(),
      })
      .eq('id', activeSourceId);
    return NextResponse.json({ error: errorMessage, source_id: activeSourceId, chars }, { status: 422 });
  }

  etapa = 'filtro_jev';
  await setStage('filtro_jev');
  // 4. Filtro previo de JEV: el contenido no verificable se descarta sin gastar
  // tokens de LLM. Si JEV falla (null) se continúa sin filtro (fail-open).
  const verifiable = await isVerifiable(content.text, content.title, apiKey);
  if (verifiable) {
    await logJevCost(admin, sourceId, verifiable.usage, verifiable.latencyMs);

    if (!verifiable.verificable) {
      const skippedFields = {
        status: 'verificada',
        verdict: 'inchequeable',
        verdict_score: 0,
        consensus_agreement: 1,
        requires_review: false,
        analysis_stage: 'completo',
        analysis_finished_at: new Date().toISOString(),
        analysis_error: null,
      };
      const { data: skippedSource, error: skipError } = await admin
        .from('sources')
        .update(skippedFields)
        .eq('id', sourceId)
        .select()
        .single();
      if (skipError) {
        console.error('[analyze] Error marcando fuente no verificable:', {
          source_id: sourceId,
          error: skipError,
        });
      }
      return NextResponse.json({
        source: skippedSource ?? { ...source, ...skippedFields },
        skipped_llm: true,
        reason: 'contenido_no_verificable',
      });
    }
  } else {
    console.warn('[analyze] JEV no disponible; se continúa sin filtro previo (fail-open):', {
      source_id: sourceId,
    });
  }

  etapa = 'modelos';
  await setStage('modelos');
  // 5. Componer el triplete activo: 1 free + 2 eco (familias distintas).
  // Frontier queda solo como último recurso y no está activo por defecto.
  const { data: configs } = await admin.from('ai_model_config').select('*');
  const configRows = (configs ?? []) as ModelConfigRow[];
  const configById = new Map(configRows.map((c) => [c.id, c]));
  const triplet = pickTriplet(configRows);

  if (triplet.length === 0) {
    const { error: noModelsError } = await admin
      .from('sources')
      .update({
        status: 'requiere_revision',
        requires_review: true,
        analysis_error: 'No hay modelos configurados para el análisis',
        analysis_finished_at: new Date().toISOString(),
      })
      .eq('id', sourceId);
    if (noModelsError) {
      console.error('[analyze] Error marcando fuente sin modelos:', {
        source_id: sourceId,
        error: noModelsError,
      });
    }
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

  // 5. Llamada multi-modelo en paralelo con fallback por modelo.
  // Cada intento conserva el motivo si no llega a producir un reporte.
  const settled = await Promise.allSettled(
    attempts.map(async (candidates): Promise<AttemptOutcome> => {
      let failureReason: CallFailureReason | null = null;
      for (const candidate of candidates) {
        let candidateFailure: CallFailureReason | null = null;
        const result = await callModel(
          candidate.modelId,
          apiKey,
          FEVER_SYSTEM_PROMPT,
          content.text,
          (reason) => {
            candidateFailure = reason;
          }
        );
        if (result) {
          const parsed = parseModelOutput(result.model, result.content);
          return {
            call: { ...result, tier: candidate.tier, parsed },
            failureReason: parsed.report === null ? 'parse_failed' : null,
          };
        }
        failureReason = candidateFailure ?? 'http_error';
      }
      return { call: null, failureReason };
    })
  );

  const outcomes: AttemptOutcome[] = settled.map((s) =>
    s.status === 'fulfilled' ? s.value : { call: null, failureReason: 'http_error' }
  );

  const successes: SuccessfulCall[] = outcomes
    .map((outcome) => outcome.call)
    .filter((call): call is SuccessfulCall => call !== null);

  // Visibilidad de fallos silenciosos: si el modelo respondió pero su salida no
  // se pudo parsear, se registra cuál falló y una pista del contenido recibido.
  for (const s of successes.filter((call) => call.parsed.report === null)) {
    console.error('[analyze] Falló el parseo de la salida del modelo:', {
      source_id: sourceId,
      model_name: s.model,
      reason: 'La salida no contiene un objeto JSON válido para el reporte',
      content_preview: s.content.slice(0, 200),
    });
  }

  // 5b. Diagnóstico: todo modelo del triplete que no produjo reporte deja una
  // fila en ai_cost_log con coste cero y el motivo del fallo.
  for (let index = 0; index < outcomes.length; index += 1) {
    const outcome = outcomes[index];
    if (outcome.call && outcome.call.parsed.report !== null) continue;

    const primary = attempts[index]?.[0];
    if (!primary) continue;
    const reason = outcome.failureReason ?? 'http_error';

    console.error('[analyze] Modelo sin reporte:', {
      source_id: sourceId,
      model_id: primary.modelId,
      reason,
    });

    const { error: failedCostError } = await admin.from('ai_cost_log').insert({
      source_id: sourceId,
      model_id: primary.modelId,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      latency_ms: 0,
      tier: primary.tier,
      error_reason: reason,
    });
    if (failedCostError) {
      console.error('[analyze] Error insertando ai_cost_log de modelo fallido:', {
        source_id: sourceId,
        model_id: primary.modelId,
        error: failedCostError,
      });
    }
  }

  const parsedModels = successes.filter((s) => s.parsed.report !== null);
  const reports: ModelReport[] = parsedModels.map((s) => s.parsed.report as ModelReport);

  etapa = 'persistencia';
  // 6. Persistir reportes por modelo + costos
  let reportInserts = 0;
  let reportInsertFailures = 0;

  for (const s of parsedModels) {
    const raw = s.parsed.raw;
    // Se propaga la calidad de la fuente para que la UI advierta cuando un video
    // se analizó solo con su descripción (sin transcripción).
    const reportJson =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? {
            ...(raw as Record<string, unknown>),
            source_quality: {
              transcript_used: content.transcriptUsed,
              transcript_words: content.transcriptWords,
            },
          }
        : raw;
    reportInserts += 1;
    const { error: reportError } = await admin.from('ai_reports').insert({
      source_id: sourceId,
      model_name: s.model,
      report_json: reportJson,
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
    let costUsd: number | null = null;
    if (price) {
      costUsd = Number(((s.inputTokens / 1e6) * price.input + (s.outputTokens / 1e6) * price.output).toFixed(8));
    } else {
      console.warn('[analyze] Modelo sin precio configurado, cost_usd = null:', {
        source_id: sourceId,
        model_name: s.model,
      });
    }
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

  etapa = 'consenso';
  await setStage('consenso');
  // 8. Consenso entre modelos
  const consensus = computeConsensus(reports, MIN_VALID_MODELS);

  etapa = 'verificacion_jev';
  await setStage('verificacion_jev');
  // 9. Verificación del consenso con JEV. Solo puede agravar el veredicto a
  // revisión, nunca mejorarlo.
  let finalRequiresReview = consensus.requiresReview;
  let finalStatus = consensus.requiresReview ? 'requiere_revision' : 'verificada';
  let finalAgreement = consensus.consensusAgreement;

  const consensusSummary =
    consensus.usedReports
      .map((report) => report.summary)
      .filter((summary): summary is string => typeof summary === 'string' && summary.trim().length > 0)
      .join(' ') || null;

  const jevVerification = await verifyConsensusVerdict(
    consensus.verdictLabel,
    consensus.averageVeracity,
    consensusSummary,
    content.text,
    apiKey
  );

  if (jevVerification) {
    await logJevCost(admin, sourceId, jevVerification.usage, jevVerification.latencyMs);

    if (jevVerification.choice === 'no_soportado' || jevVerification.confidence < 0.5) {
      finalRequiresReview = true;
      finalStatus = 'requiere_revision';
      const soportado = jevVerification.probabilities.soportado ?? 0;
      finalAgreement = finalAgreement === null ? soportado : Math.min(finalAgreement, soportado);
    }

    await saveJevToReports(admin, sourceId, jevVerification);
  }

  etapa = 'persistencia';
  await setStage('persistencia');
  const { data: updatedSource, error: updateError } = await admin
    .from('sources')
    .update({
      status: finalStatus,
      verdict: consensus.verdictLabel,
      verdict_score: consensus.averageVeracity,
      consensus_agreement: finalAgreement,
      requires_review: finalRequiresReview,
      analysis_stage: 'completo',
      analysis_finished_at: new Date().toISOString(),
      analysis_error: null,
    })
    .eq('id', sourceId)
    .select()
    .single();

  if (updateError) {
    console.error('[analyze] Error actualizando fuente:', {
      source_id: sourceId,
      error: updateError,
    });
  }

    return NextResponse.json({
      source: updatedSource ?? source,
      consensus,
      jevVerification,
      analyzedBy: parsedModels.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    console.error('[analyze] Error en el análisis:', {
      source_id: sourceId,
      url,
      etapa,
      error: message,
    });

    if (sourceId) {
      const { error: reviewError } = await supabaseAdmin()
        .from('sources')
        .update({
          status: 'requiere_revision',
          requires_review: true,
          analysis_error: message,
          analysis_finished_at: new Date().toISOString(),
        })
        .eq('id', sourceId);
      if (reviewError) {
        console.error('[analyze] Error marcando fuente requiere_revision en catch:', {
          source_id: sourceId,
          error: reviewError,
        });
      }
    }

    return NextResponse.json(
      { error: message || 'Error interno al analizar la fuente', source_id: sourceId },
      { status: 500 }
    );
  } finally {
    // Red de seguridad: si la fuente quedó creada sin veredicto ni reportes,
    // nunca se deja en `no_verificada`; pasa a revisión.
    if (sourceId) {
      try {
        const admin = supabaseAdmin();
        const [{ data: currentSource }, { count }] = await Promise.all([
          admin.from('sources').select('status').eq('id', sourceId).maybeSingle(),
          admin.from('ai_reports').select('id', { count: 'exact', head: true }).eq('source_id', sourceId),
        ]);
        if (
          (currentSource?.status === 'no_verificada' || currentSource?.status === 'procesando') &&
          (count ?? 0) === 0
        ) {
          const { error: reviewError } = await admin
            .from('sources')
            .update({
              status: 'requiere_revision',
              requires_review: true,
              analysis_error: 'El análisis no finalizó correctamente',
              analysis_finished_at: new Date().toISOString(),
            })
            .eq('id', sourceId);
          if (reviewError) {
            console.error('[analyze] Error marcando fuente requiere_revision en finally:', {
              source_id: sourceId,
              error: reviewError,
            });
          }
        }
      } catch (finallyError) {
        console.error('[analyze] Error en la verificación final de la fuente:', {
          source_id: sourceId,
          error: finallyError instanceof Error ? finallyError.message : finallyError,
        });
      }
    }

    console.log('[analyze] duración total', Date.now() - startedAt, 'ms');
  }
}
