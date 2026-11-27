import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { maintenanceAuthFailure } from '@/lib/maintenance-auth';
import {
  fetchSenadoresVigentes,
  nombreCompleto,
  normalizarNombre,
  type ParlamentarioSenado,
} from '@/lib/external/senado';
import {
  sugerirVinculos,
  type ParlamentarioParaVincular,
  type PoliticoParaVincular,
  type SugerenciaVinculo,
} from '@/lib/parliamentary-matching';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface FilaParlamentario {
  parl_id: string;
  camara: 'senado' | 'diputados';
  nombre: string;
  nombre_normalizado: string;
  apellido_paterno: string | null;
  apellido_materno: string | null;
  region: string | null;
  circunscripcion: string | null;
  partido: string | null;
  email: string | null;
  curriculum_url: string | null;
  politician_id: string | null;
  match_confirmado: boolean;
  origen: string;
  updated_at: string;
}

interface PoliticoRow {
  id: string;
  full_name: string;
  political_party: string | null;
}

function supabaseAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function filaDesdeSenador(senador: ParlamentarioSenado): FilaParlamentario {
  const nombre = nombreCompleto(senador);
  return {
    parl_id: senador.parlId,
    camara: 'senado',
    nombre,
    nombre_normalizado: normalizarNombre(nombre),
    apellido_paterno: senador.apellidoPaterno || null,
    apellido_materno: senador.apellidoMaterno || null,
    region: senador.region || null,
    circunscripcion: senador.circunscripcion || null,
    partido: senador.partido || null,
    email: senador.email,
    curriculum_url: senador.curriculum,
    politician_id: null,
    match_confirmado: false,
    origen: 'senado_wspublico',
    updated_at: new Date().toISOString(),
  };
}

function errorDeConfiguracion() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Configuración del servidor incompleta' }, { status: 500 });
  }
  return null;
}

export async function POST(request: Request) {
  const authFailure = maintenanceAuthFailure(request);
  if (authFailure) {
    return NextResponse.json(authFailure.body, { status: authFailure.status });
  }

  const configFailure = errorDeConfiguracion();
  if (configFailure) return configFailure;

  try {
    const senadores = await fetchSenadoresVigentes();
    if (senadores.length === 0) {
      return NextResponse.json({
        ok: true,
        total: 0,
        nuevos: 0,
        actualizados: 0,
        aviso: 'El Senado devolvió un padrón vacío; no se modificó la base.',
      });
    }

    const filas = senadores.map(filaDesdeSenador);
    const db = supabaseAdmin();
    const parlIds = filas.map((fila) => fila.parl_id);

    const { data: existentes, error: errorExistentes } = await db
      .from('parliamentarians')
      .select('parl_id')
      .in('parl_id', parlIds);

    if (errorExistentes) {
      console.error('[parlamentarios] Error leyendo el padrón existente:', errorExistentes);
      return NextResponse.json(
        { error: 'No se pudo leer el padrón existente' },
        { status: 500 }
      );
    }

    const existentesSet = new Set(
      ((existentes ?? []) as Array<{ parl_id: string }>).map((fila) => fila.parl_id)
    );

    // Upsert por la clave oficial del Senado: actualiza sin duplicar y nunca
    // borra filas que no vengan en esta respuesta.
    const { error: errorUpsert } = await db
      .from('parliamentarians')
      .upsert(filas, { onConflict: 'parl_id' });

    if (errorUpsert) {
      console.error('[parlamentarios] Error en upsert:', errorUpsert);
      return NextResponse.json({ error: 'No se pudo sincronizar el padrón' }, { status: 500 });
    }

    const nuevos = filas.filter((fila) => !existentesSet.has(fila.parl_id)).length;

    return NextResponse.json({
      ok: true,
      total: filas.length,
      nuevos,
      actualizados: filas.length - nuevos,
    });
  } catch (error) {
    console.error('[parlamentarios] Error sincronizando el padrón:', error);
    const detalle = error instanceof Error ? error.message : 'Error desconocido';
    return NextResponse.json(
      {
        error: 'No se pudo sincronizar el padrón de senadores',
        detalle,
        hint: 'El servicio público del Senado puede estar en mantenimiento; reintenta más tarde.',
      },
      { status: 502 }
    );
  }
}

export async function GET() {
  const configFailure = errorDeConfiguracion();
  if (configFailure) return configFailure;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from('parliamentarians')
    .select('*')
    .order('apellido_paterno', { ascending: true });

  if (error) {
    console.error('[parlamentarios] Error listando el padrón:', error);
    return NextResponse.json({ error: 'No se pudo leer el padrón' }, { status: 500 });
  }

  const filas = (data ?? []) as FilaParlamentario[];

  let politicos: PoliticoRow[] = [];
  const { data: politicosData, error: errorPoliticos } = await db
    .from('politicians')
    .select('id, full_name, political_party')
    .order('full_name', { ascending: true });

  if (errorPoliticos) {
    // La lista del padrón sigue siendo útil aunque no se puedan sugerir vínculos.
    console.warn('[parlamentarios] No se pudieron leer los políticos:', errorPoliticos);
  } else {
    politicos = (politicosData ?? []) as PoliticoRow[];
  }

  const parlamentariosParaMatching: ParlamentarioParaVincular[] = filas.map((fila) => ({
    parlId: fila.parl_id,
    nombre: fila.nombre,
    nombreNormalizado: fila.nombre_normalizado,
    apellidoPaterno: fila.apellido_paterno,
    apellidoMaterno: fila.apellido_materno,
    partido: fila.partido,
  }));
  const politicosParaMatching: PoliticoParaVincular[] = politicos.map((politico) => ({
    id: politico.id,
    nombreCompleto: politico.full_name,
    partido: politico.political_party,
  }));

  const sugerencias = sugerirVinculos(parlamentariosParaMatching, politicosParaMatching);
  const sugerenciaPorParl = new Map<string, SugerenciaVinculo>();
  for (const sugerencia of sugerencias) {
    const actual = sugerenciaPorParl.get(sugerencia.parlId);
    if (!actual || (actual.confianza === 'baja' && sugerencia.confianza === 'alta')) {
      sugerenciaPorParl.set(sugerencia.parlId, sugerencia);
    }
  }
  const nombrePolitico = new Map(politicos.map((politico) => [politico.id, politico.full_name]));

  const parlamentarios = filas.map((fila) => {
    const sugerencia = sugerenciaPorParl.get(fila.parl_id);
    return {
      ...fila,
      estado: fila.match_confirmado ? 'vinculado' : 'sin_vincular',
      sugerencia: sugerencia
        ? {
            ...sugerencia,
            politicianName: nombrePolitico.get(sugerencia.politicianId) ?? null,
          }
        : null,
    };
  });

  return NextResponse.json({ ok: true, total: parlamentarios.length, parlamentarios });
}

export async function PATCH(request: Request) {
  const authFailure = maintenanceAuthFailure(request);
  if (authFailure) {
    return NextResponse.json(authFailure.body, { status: authFailure.status });
  }

  const configFailure = errorDeConfiguracion();
  if (configFailure) return configFailure;

  const body = (await request.json().catch(() => null)) as
    | { parlId?: unknown; politicianId?: unknown }
    | null;
  const parlId = typeof body?.parlId === 'string' ? body.parlId.trim() : '';
  const politicianId = typeof body?.politicianId === 'string' ? body.politicianId.trim() : '';

  if (!parlId || !politicianId) {
    return NextResponse.json(
      { error: 'Se requieren parlId y politicianId' },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();

  // Un político no puede quedar atribuido a dos parlamentarios: eso volvería a
  // mezclar votos de personas distintas.
  const { data: ocupados, error: errorOcupados } = await db
    .from('parliamentarians')
    .select('parl_id')
    .eq('politician_id', politicianId)
    .neq('parl_id', parlId);

  if (errorOcupados) {
    console.error('[parlamentarios] Error comprobando el vínculo:', errorOcupados);
    return NextResponse.json({ error: 'No se pudo comprobar el vínculo' }, { status: 500 });
  }

  if (Array.isArray(ocupados) && ocupados.length > 0) {
    return NextResponse.json(
      {
        error: 'Ese politician_id ya está vinculado a otro parl_id',
        parlId: (ocupados[0] as { parl_id: string }).parl_id,
      },
      { status: 400 }
    );
  }

  const { data: actualizado, error: errorUpdate } = await db
    .from('parliamentarians')
    .update({
      politician_id: politicianId,
      match_confirmado: true,
      updated_at: new Date().toISOString(),
    })
    .eq('parl_id', parlId)
    .select('parl_id, politician_id, match_confirmado')
    .maybeSingle();

  if (errorUpdate) {
    console.error('[parlamentarios] Error confirmando el vínculo:', errorUpdate);
    return NextResponse.json({ error: 'No se pudo confirmar el vínculo' }, { status: 500 });
  }

  if (!actualizado) {
    return NextResponse.json({ error: 'No existe un parlamentario con ese parlId' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...actualizado });
}
