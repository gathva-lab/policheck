import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/server';
import { maintenanceAuthFailure } from '@/lib/maintenance-auth';
import { extractYoutube, isYoutubeUrl, NoTranscriptError } from '@/lib/ai/extract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SourceRow {
  id: string;
  url: string | null;
  submitted_by: string | null;
}

function supabaseAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ ok: false, reason: 'Falta el identificador de la fuente' }, { status: 400 });
  }

  // El endpoint está protegido para mantenimiento. La UI del dueño de la fuente
  // también puede invocarlo con su sesión, sin exponer la clave en el navegador.
  const authFailure = maintenanceAuthFailure(request);
  let sessionUserId: string | null = null;
  if (authFailure) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    sessionUserId = user?.id ?? null;
    if (!sessionUserId) {
      return NextResponse.json(authFailure.body, { status: authFailure.status });
    }
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { ok: false, reason: 'Configuración del servidor incompleta' },
      { status: 500 }
    );
  }

  const admin = supabaseAdmin();
  const { data: source, error: sourceError } = await admin
    .from('sources')
    .select('id, url, submitted_by')
    .eq('id', id)
    .maybeSingle();

  if (sourceError) {
    console.error('[transcript] Error leyendo la fuente:', { source_id: id, error: sourceError });
    return NextResponse.json({ ok: false, reason: 'No se pudo leer la fuente' }, { status: 500 });
  }

  const row = source as SourceRow | null;
  if (!row) {
    return NextResponse.json({ ok: false, reason: 'Fuente no encontrada' }, { status: 404 });
  }

  if (sessionUserId && row.submitted_by !== sessionUserId) {
    return NextResponse.json(
      { ok: false, reason: 'No tienes permiso para re-extraer esta transcripción' },
      { status: 403 }
    );
  }

  if (!row.url || !isYoutubeUrl(row.url)) {
    return NextResponse.json(
      { ok: false, reason: 'La fuente no es un video de YouTube' },
      { status: 400 }
    );
  }

  try {
    const content = await extractYoutube(row.url);
    if (!content.transcriptUsed || !content.transcriptText) {
      return NextResponse.json(
        {
          ok: false,
          reason: 'No se obtuvo una transcripción; el video solo tiene descripción.',
          retryable: false,
        },
        { status: 422 }
      );
    }

    const words = content.transcriptWords || countWords(content.transcriptText);
    const { error: updateError } = await admin
      .from('sources')
      .update({
        transcript_text: content.transcriptText,
        transcript_method: content.transcriptMethod,
        transcript_words: words,
        transcript_fetched_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      console.error('[transcript] Error guardando la transcripción:', {
        source_id: id,
        error: updateError,
      });
      return NextResponse.json(
        { ok: false, reason: 'No se pudo guardar la transcripción' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, method: content.transcriptMethod, words });
  } catch (error) {
    if (error instanceof NoTranscriptError) {
      return NextResponse.json(
        { ok: false, reason: error.message, retryable: error.retryable },
        { status: 422 }
      );
    }

    const reason = error instanceof Error ? error.message : 'Error desconocido';
    console.error('[transcript] Error re-extrayendo la transcripción:', {
      source_id: id,
      error: reason,
    });
    return NextResponse.json({ ok: false, reason }, { status: 500 });
  }
}
