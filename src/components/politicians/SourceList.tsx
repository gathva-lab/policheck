import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { displayLabel, colorFromLabel, type VeracityColor } from "@/lib/veracity";
import { AnalysisResults } from "./AnalysisResults";

interface SourceListProps {
  politicianId: string;
}

const STATUS_LABEL: Record<string, string> = {
  no_verificada: "Sin analizar",
  procesando: "Analizando…",
  verificada: "Verificada",
  requiere_revision: "En revisión",
};

const SOURCE_TYPE_LABEL: Record<string, string> = {
  articulo_noticia: "Artículo",
  video_youtube: "Video de YouTube",
};

const BADGE_CLASS: Record<VeracityColor, string> = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  yellow: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  gray: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export async function SourceList({ politicianId }: SourceListProps) {
  const { data: sources, error } = await supabase
    .from("sources")
    .select("*")
    .eq("politician_id", politicianId)
    .order("created_at", { ascending: false });

  if (error) {
    return <p className="text-red-500">Error al cargar las fuentes.</p>;
  }

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>Fuentes de Información</CardTitle>
      </CardHeader>
      <CardContent>
        {sources.length === 0 ? (
          <p>No hay fuentes para este político todavía.</p>
        ) : (
          <ul className="space-y-6">
            {sources.map((source) => (
              <li key={source.id} className="p-4 border rounded-lg shadow-sm">
                <div className="flex justify-between items-start">
                  <div>
                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 font-medium hover:underline">
                      {source.title || source.url}
                    </a>
                    <p className="text-xs text-muted-foreground mt-1">
                      {SOURCE_TYPE_LABEL[source.source_type] ?? "Fuente"}
                      {source.created_at
                        ? ` · ${new Date(source.created_at).toLocaleDateString("es-CL", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <span className="text-xs font-semibold px-2 py-1 bg-slate-100 rounded-full">
                      {STATUS_LABEL[source.status] ?? "Sin analizar"}
                    </span>
                    {source.verdict && (
                      <span
                        className={`text-xs font-semibold px-2 py-1 rounded-full ${BADGE_CLASS[colorFromLabel(source.verdict) ?? "gray"]}`}
                      >
                        {displayLabel(source.verdict) ?? source.verdict}
                        {typeof source.verdict_score === "number" ? ` · ${source.verdict_score}%` : ""}
                      </span>
                    )}
                  </div>
                </div>

                {/* Visualizador de Reportes IA en tiempo real */}
                <AnalysisResults sourceId={source.id} politicianId={politicianId} sourceUrl={source.url} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
