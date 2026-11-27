import type { Metadata } from "next";
import Link from "next/link";
import { VERACITY_TAXONOMY, type VeracityTier } from "@/lib/veracity";

export const metadata: Metadata = {
  title: "Cómo funciona PoliCheck — Metodología",
  description:
    "Qué mide PoliCheck, qué no mide, cómo se combinan tres modelos de IA con la mediana y de dónde salen las cifras oficiales que cita.",
};

const COLOR_DOT: Record<VeracityTier["color"], string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  gray: "bg-gray-400",
};

const EJEMPLOS: Record<string, string> = {
  verdadero: "La cifra citada coincide con el dato oficial y se presenta en su contexto.",
  verdadero_pero: "El dato es correcto, aunque omite una condición que cambia su lectura.",
  discutible: "La afirmación mezcla un dato comprobable con una interpretación que no se puede confirmar.",
  apresurado: "La conclusión se adelanta a lo que la evidencia disponible permite sostener.",
  exagerado: "El dato existe, pero se amplifica por encima de lo que muestra la fuente.",
  enganoso: "Se usa un dato cierto de forma que induce a una idea equivocada.",
  insostenible: "La afirmación contradice la evidencia disponible.",
  inchequeable: "No hay datos verificables que permitan comprobar lo afirmado.",
  anejo: "El dato pudo ser cierto en su momento, pero la información disponible está desactualizada.",
};

export default function ComoFuncionaPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto max-w-3xl px-4 py-12 md:py-16">
        <header className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Cómo funciona PoliCheck
          </h1>
          <p className="mt-3 text-muted-foreground">
            Esta página explica el método con el que se evalúa el discurso político:
            qué mide, qué no mide, cómo se combinan los modelos y qué límites tiene.
          </p>
        </header>

        <div className="space-y-12">
          <section>
            <h2 className="text-xl font-semibold md:text-2xl">Qué mide PoliCheck</h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              PoliCheck mide la solidez de la justificación de lo que se afirma y si el
              contenido aporta datos verificables. El resultado describe el respaldo
              disponible para una afirmación, no la persona que la pronuncia.
            </p>
          </section>

          <section className="rounded-lg border border-amber-300 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/40">
            <h2 className="text-xl font-semibold text-amber-900 md:text-2xl dark:text-amber-200">
              Qué NO mide
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-amber-900 dark:text-amber-100">
              <li>No determina si un político miente.</li>
              <li>
                No verifica contra la realidad, salvo las cifras del Banco Central que se
                usan para contrastar montos y fechas.
              </li>
              <li>No mide intención ni honestidad personal.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold md:text-2xl">Cómo se analiza</h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              Una misma transcripción se analiza con tres modelos de inteligencia
              artificial de familias distintas. El resultado final es la mediana de sus
              puntajes, no el promedio. Si los modelos no coinciden lo suficiente, el
              sistema no emite un veredicto.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold md:text-2xl">La escala 0–100</h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              El puntaje se expresa de 0 a 100 y se agrupa en nueve niveles. Los rangos
              siguientes corresponden a los que usa el sistema.
            </p>
            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[28rem] border-collapse text-sm">
                <thead className="bg-muted/60 text-left">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Nivel</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Rango</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Ejemplo</th>
                  </tr>
                </thead>
                <tbody>
                  {VERACITY_TAXONOMY.map((tier) => (
                    <tr key={tier.label} className="border-t border-border">
                      <td className="whitespace-nowrap px-4 py-2.5 font-medium">
                        <span className="flex items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${COLOR_DOT[tier.color]}`}
                            aria-hidden="true"
                          />
                          {tier.display}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                        {tier.min}–{tier.max}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {EJEMPLOS[tier.label]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Los niveles «Inchequeable» y «Añejo» comparten el rango 0–4 porque son dos
              causas distintas de «no evaluable»: falta de evidencia en un caso e
              información desactualizada en el otro.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold md:text-2xl">Por qué la mediana y no el promedio</h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              El promedio es sensible a un solo valor extremo. En un caso real, tres
              modelos puntuaron una misma transcripción con 2, 65 y 3.
            </p>
            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[20rem] border-collapse text-sm">
                <thead className="bg-muted/60 text-left">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Cálculo</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <td className="px-4 py-2.5">Promedio de 2, 65 y 3</td>
                    <td className="px-4 py-2.5 text-muted-foreground">23,3</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-4 py-2.5">Mediana de 2, 65 y 3</td>
                    <td className="px-4 py-2.5 text-muted-foreground">3</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              El promedio se aleja hacia el valor alto y sugiere un respaldo que la
              mayoría no vio. La mediana refleja lo que decían dos de los tres modelos:
              no había datos verificables. Por eso el veredicto usa la mediana.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold md:text-2xl">Qué papel juega JEV</h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              JEV es una capa externa de decisión. Actúa como filtro previo —si el
              contenido es verificable— y como verificación posterior —si el veredicto se
              sostiene—. Su única facultad sobre el resultado es agravarlo: puede bajar un
              veredicto, nunca mejorarlo. Si JEV falla, el análisis continúa.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold md:text-2xl">Fuentes oficiales</h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              Para dólar, UF, UTM e IPC, la referencia es el Banco Central de Chile. Cada
              cifra citada lleva su fuente, su fecha y su enlace. La responsabilidad del
              dato es de la fuente; la de citarlo bien es de PoliCheck.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold md:text-2xl">Límites conocidos</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-muted-foreground">
              <li>La inteligencia artificial se equivoca.</li>
              <li>El consenso entre modelos no garantiza que una afirmación sea verdadera.</li>
              <li>La ausencia de contradicción no es prueba de veracidad.</li>
              <li>
                Los modelos pueden variar entre corridas. Por eso la temperatura del
                análisis es 0, para reducir esa variación.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold md:text-2xl">Cómo reportar un error</h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              Si detectas un error en un análisis, en una cifra o en esta metodología,
              puedes escribirnos.
            </p>
            {/* TODO: reemplazar href="#" por el correo o formulario oficial de reportes cuando exista. */}
            <Link
              href="#"
              className="mt-3 inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              Reportar un error
            </Link>
          </section>

          <section className="border-t border-border pt-6">
            <Link href="/historial" className="text-sm text-primary underline-offset-4 hover:underline">
              Ver el historial de cambios de metodología
            </Link>
          </section>
        </div>
      </main>
    </div>
  );
}
