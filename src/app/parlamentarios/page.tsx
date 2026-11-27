import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import {
  sugerirVinculos,
  type ParlamentarioParaVincular,
  type PoliticoParaVincular,
  type SugerenciaVinculo,
} from '@/lib/parliamentary-matching';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Padrón de parlamentarios — PoliCheck',
  description:
    'Padrón oficial de senadores con su PARLID. El vínculo con un político de PoliCheck se confirma manualmente para no atribuir votos a la persona equivocada.',
};

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
}

interface PoliticoRow {
  id: string;
  full_name: string;
  political_party: string | null;
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const BADGE_ESTADO: Record<string, string> = {
  vinculado:
    'border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950/50 dark:text-green-300',
  sugerencia:
    'border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300',
  sin_vincular:
    'border-border bg-muted text-muted-foreground',
};

function primerValor(valor: string | string[] | undefined): string {
  if (Array.isArray(valor)) return valor[0] ?? '';
  return valor ?? '';
}

export default async function ParlamentariosPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const camaraFiltro = primerValor(params.camara) || 'todas';
  const partidoFiltro = primerValor(params.partido) || 'todos';

  const supabase = await createClient();
  const [{ data: filasData, error: errorPadron }, { data: politicosData }] = await Promise.all([
    supabase
      .from('parliamentarians')
      .select('*')
      .order('apellido_paterno', { ascending: true }),
    supabase
      .from('politicians')
      .select('id, full_name, political_party')
      .order('full_name', { ascending: true }),
  ]);

  const filas = (filasData ?? []) as FilaParlamentario[];
  const politicos = (politicosData ?? []) as PoliticoRow[];

  const partidos = Array.from(
    new Set(filas.map((fila) => fila.partido).filter((partido): partido is string => Boolean(partido)))
  ).sort((a, b) => a.localeCompare(b, 'es'));

  const filtradas = filas.filter((fila) => {
    const coincideCamara = camaraFiltro === 'todas' || fila.camara === camaraFiltro;
    const coincidePartido = partidoFiltro === 'todos' || fila.partido === partidoFiltro;
    return coincideCamara && coincidePartido;
  });

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

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto max-w-5xl px-4 py-12 md:py-16">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Padrón de parlamentarios
          </h1>
          <p className="mt-3 text-muted-foreground">
            Identificadores oficiales del Senado para vincular votaciones con la persona
            correcta. El PARLID es el dato auditable: no se infiere del nombre.
          </p>
          <blockquote className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            El padrón viene de los servicios públicos del Senado. El vínculo con un político de
            PoliCheck se confirma manualmente para no atribuir votos a la persona equivocada.
          </blockquote>
        </header>

        <form className="mb-6 flex flex-wrap items-end gap-3" method="get">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Cámara</span>
            <select
              name="camara"
              defaultValue={camaraFiltro}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="todas">Todas</option>
              <option value="senado">Senado</option>
              <option value="diputados">Diputados</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Partido</span>
            <select
              name="partido"
              defaultValue={partidoFiltro}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="todos">Todos</option>
              {partidos.map((partido) => (
                <option key={partido} value={partido}>
                  {partido}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Filtrar
          </button>
          <Link
            href="/parlamentarios"
            className="h-9 rounded-md border border-border px-4 text-sm font-medium leading-9 hover:bg-muted"
          >
            Limpiar
          </Link>
        </form>

        {errorPadron ? (
          <div className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            No se pudo leer el padrón. Verifica que la migración
            <code className="mx-1 font-mono">20261127_parlamentarios.sql</code>
            esté aplicada.
          </div>
        ) : null}

        {filas.length === 0 ? (
          <section className="rounded-xl border border-border bg-card p-6 text-card-foreground">
            <h2 className="text-lg font-semibold">El padrón está vacío</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Sincronízalo desde el servicio público del Senado llamando al endpoint de
              mantenimiento con la cabecera de autorización:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-4 text-xs">
              {`curl -X POST https://tu-dominio/api/maintenance/parlamentarios \\
  -H "x-sweep-key: <clave>"`}
            </pre>
          </section>
        ) : filtradas.length === 0 ? (
          <section className="rounded-xl border border-border bg-card p-6 text-card-foreground">
            <p className="text-sm text-muted-foreground">
              No hay parlamentarios que coincidan con los filtros seleccionados.
            </p>
          </section>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {filtradas.map((fila) => {
              const sugerencia = sugerenciaPorParl.get(fila.parl_id);
              const estado = fila.match_confirmado
                ? 'vinculado'
                : sugerencia
                  ? 'sugerencia'
                  : 'sin_vincular';
              const etiqueta =
                estado === 'vinculado'
                  ? 'Vinculado'
                  : estado === 'sugerencia'
                    ? 'Sugerencia'
                    : 'Sin vincular';

              return (
                <article
                  key={fila.parl_id}
                  className="rounded-xl border border-border bg-card p-5 text-card-foreground"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">{fila.nombre}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {fila.partido ?? 'Sin partido'} · {fila.region ?? 'Sin región'}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${BADGE_ESTADO[estado]}`}
                    >
                      {etiqueta}
                    </span>
                  </div>

                  <p className="mt-3 text-xs text-muted-foreground">
                    Cámara: {fila.camara === 'senado' ? 'Senado' : 'Diputados'}
                  </p>

                  {sugerencia && !fila.match_confirmado ? (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                      Posible vínculo con{' '}
                      {nombrePolitico.get(sugerencia.politicianId) ?? sugerencia.politicianId} (
                      {sugerencia.confianza}). {sugerencia.motivo}
                    </p>
                  ) : null}

                  {fila.match_confirmado && fila.politician_id ? (
                    <p className="mt-2 text-xs text-green-700 dark:text-green-300">
                      Vinculado a{' '}
                      {nombrePolitico.get(fila.politician_id) ?? fila.politician_id}, con
                      confirmación manual.
                    </p>
                  ) : null}

                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-muted-foreground">Ver detalle</summary>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                      <dt className="font-medium">PARLID</dt>
                      <dd className="font-mono">{fila.parl_id}</dd>
                      <dt className="font-medium">Circunscripción</dt>
                      <dd>{fila.circunscripcion ?? 'Sin dato'}</dd>
                      <dt className="font-medium">Email</dt>
                      <dd>{fila.email ?? 'Sin dato'}</dd>
                      <dt className="font-medium">Curriculum</dt>
                      <dd>
                        {fila.curriculum_url ? (
                          <a
                            href={fila.curriculum_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline underline-offset-2"
                          >
                            Ver curriculum
                          </a>
                        ) : (
                          'Sin dato'
                        )}
                      </dd>
                    </dl>
                  </details>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
