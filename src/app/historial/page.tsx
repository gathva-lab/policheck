import type { Metadata } from "next";
import Link from "next/link";
import { HISTORIAL_METODOLOGIA, type CambioMetodologia } from "@/lib/wiki/historial";

export const metadata: Metadata = {
  title: "Historial de cambios de metodología — PoliCheck",
  description:
    "Registro fechado de todo cambio en cómo PoliCheck mide, incluidas las mejoras, las correcciones y los hallazgos que no cumplieron su hipótesis.",
};

type TipoCambio = CambioMetodologia["tipo"];

const BADGE_CLASSES: Record<TipoCambio, string> = {
  mejora:
    "border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950/50 dark:text-green-300",
  correccion:
    "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300",
  hallazgo:
    "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
};

const TIPO_ETIQUETA: Record<TipoCambio, string> = {
  mejora: "Mejora",
  correccion: "Corrección",
  hallazgo: "Hallazgo",
};

function formatearFecha(fecha: string): string {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(anio, mes - 1, dia)));
}

export default function HistorialPage() {
  const fechas = Array.from(new Set(HISTORIAL_METODOLOGIA.map((cambio) => cambio.fecha)));

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto max-w-3xl px-4 py-12 md:py-16">
        <header className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Historial de cambios de metodología
          </h1>
          <blockquote className="mt-4 border-l-4 border-primary/40 pl-4 text-sm italic leading-relaxed text-muted-foreground">
            Este registro incluye los cambios que mejoraron el sistema y también los que no
            cumplieron su hipótesis. Publicamos ambos porque una metodología que solo
            documenta sus aciertos no es auditable.
          </blockquote>
        </header>

        <div className="space-y-12">
          {fechas.map((fecha) => {
            const delDia = HISTORIAL_METODOLOGIA.filter((cambio) => cambio.fecha === fecha);
            const titulos = Array.from(new Set(delDia.map((cambio) => cambio.titulo)));

            return (
              <section key={fecha}>
                <h2 className="mb-5 border-b border-border pb-2 text-lg font-semibold tracking-tight">
                  {formatearFecha(fecha)}
                </h2>

                <div className="space-y-8">
                  {titulos.map((titulo) => {
                    const cambios = delDia.filter((cambio) => cambio.titulo === titulo);

                    return (
                      <div key={titulo}>
                        <h3 className="mb-3 text-base font-semibold">{titulo}</h3>

                        <div className="space-y-3">
                          {cambios.map((cambio, indice) => (
                            <article
                              key={`${cambio.fecha}-${titulo}-${indice}`}
                              className="rounded-lg border border-border bg-card p-4 text-card-foreground"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <p className="font-medium leading-relaxed">{cambio.queCambio}</p>
                                <span
                                  className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${BADGE_CLASSES[cambio.tipo]}`}
                                >
                                  {TIPO_ETIQUETA[cambio.tipo]}
                                </span>
                              </div>

                              <dl className="mt-3 space-y-2 text-sm">
                                <div>
                                  <dt className="font-medium text-foreground">Por qué</dt>
                                  <dd className="text-muted-foreground">{cambio.porQue}</dd>
                                </div>
                                <div>
                                  <dt className="font-medium text-foreground">Evidencia</dt>
                                  <dd className="text-muted-foreground">{cambio.evidencia}</dd>
                                </div>
                              </dl>
                            </article>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <section className="mt-12 border-t border-border pt-6">
          <Link href="/como-funciona" className="text-sm text-primary underline-offset-4 hover:underline">
            Leer cómo funciona el método
          </Link>
        </section>
      </main>
    </div>
  );
}
