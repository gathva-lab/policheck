'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ShieldCheck, Activity, BrainCircuit, RefreshCw } from 'lucide-react';
import { displayLabel, colorFromLabel, type VeracityColor } from '@/lib/veracity';

interface AIReport {
    id: string;
    source_id: string;
    model_name: string;
    veracity_score: number | null;
    coherence_score: number | null;
    bias_analysis: string | null;
    summary: string | null;
    key_claims: string[] | null;
    [key: string]: unknown;
}

interface SourceVerdict {
    verdict: string | null;
    verdict_score: number | null;
    requires_review: boolean;
}

interface AnalysisResultsProps {
    sourceId: string;
    politicianId: string;
    sourceUrl: string;
}

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 24;

const BADGE_CLASS: Record<VeracityColor, string> = {
    green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    yellow: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    orange: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
    red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    gray: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

function ReanalyzeButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
    return (
        <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={loading}>
            <RefreshCw className={loading ? 'animate-spin' : ''} />
            {loading ? 'Re-analizando...' : 'Re-analizar'}
        </Button>
    );
}

export function AnalysisResults({ sourceId, politicianId, sourceUrl }: AnalysisResultsProps) {
    const router = useRouter();
    const [reports, setReports] = useState<AIReport[]>([]);
    const [verdict, setVerdict] = useState<SourceVerdict | null>(null);
    const [loading, setLoading] = useState(true);
    const [timedOut, setTimedOut] = useState(false);
    const [reanalyzing, setReanalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchReports = useCallback(async () => {
        const supabase = createClient();
        const [reportsRes, sourceRes] = await Promise.all([
            supabase.from('ai_reports').select('*').eq('source_id', sourceId),
            supabase.from('sources').select('verdict, verdict_score, requires_review').eq('id', sourceId).maybeSingle(),
        ]);

        if (reportsRes.error) {
            console.error("Error fetching reports:", reportsRes.error);
        }

        const fetchedReports = reportsRes.data ?? [];
        const sourceVerdict: SourceVerdict | null = sourceRes.data
            ? {
                verdict: sourceRes.data.verdict ?? null,
                verdict_score: sourceRes.data.verdict_score ?? null,
                requires_review: sourceRes.data.requires_review ?? false,
            }
            : null;

        if (fetchedReports.length > 0) {
            setReports(fetchedReports);
            setLoading(false);
        }
        if (sourceVerdict) {
            setVerdict(sourceVerdict);
        }

        const done = fetchedReports.length > 0 || (sourceVerdict?.verdict ?? null) !== null;
        return { done, verdict: sourceVerdict };
    }, [sourceId]);

    useEffect(() => {
        let cancelled = false;
        let interval: ReturnType<typeof setInterval> | undefined;
        let attempts = 0;

        const stopPolling = () => {
            if (interval) {
                clearInterval(interval);
                interval = undefined;
            }
        };

        const poll = async () => {
            attempts += 1;
            const result = await fetchReports();
            if (cancelled) return;
            if (result.done) {
                stopPolling();
                setLoading(false);
                return;
            }
            if (attempts >= MAX_POLL_ATTEMPTS) {
                stopPolling();
                setTimedOut(true);
                setLoading(false);
            }
        };

        setLoading(true);
        setTimedOut(false);

        void fetchReports().then((result) => {
            if (cancelled) return;
            if (result.done) {
                setLoading(false);
                return;
            }
            interval = setInterval(() => {
                void poll();
            }, POLL_INTERVAL_MS);
        });

        return () => {
            cancelled = true;
            stopPolling();
        };
    }, [fetchReports]);

    const handleReanalyze = async () => {
        setReanalyzing(true);
        setError(null);
        try {
            const res = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: sourceUrl, politicianId, force: true }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                setError(data?.error ?? 'No se pudo re-analizar la fuente.');
                return;
            }
            await fetchReports();
            setTimedOut(false);
            router.refresh();
        } catch {
            setError('No se pudo re-analizar la fuente.');
        } finally {
            setReanalyzing(false);
        }
    };

    const verdictColor = colorFromLabel(verdict?.verdict ?? null);

    const renderVerdictBadge = () => {
        if (verdict?.requires_review || !verdict?.verdict) {
            return (
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-sm font-semibold">
                    <Activity className="h-4 w-4" />
                    En revisión
                </span>
            );
        }
        const display = displayLabel(verdict.verdict);
        const cls = BADGE_CLASS[verdictColor ?? "gray"];
        return (
            <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${cls} text-sm font-semibold`}>
                {display ?? verdict.verdict}
            </span>
        );
    };

    const renderConsensusBadge = (label: string) => {
        const display = displayLabel(label) ?? label;
        const cls = BADGE_CLASS[colorFromLabel(label) ?? "gray"];
        return (
            <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${cls} text-sm font-semibold`}>
                {display}
            </span>
        );
    };

    if (reports.length === 0) {
        if (reanalyzing) {
            return (
                <div className="mt-4 text-sm text-yellow-700 bg-yellow-50 p-4 rounded-xl border border-yellow-200 shadow-sm animate-pulse">
                    <div className="flex items-center gap-3">
                        <Activity className="h-5 w-5 animate-spin text-yellow-600" />
                        <span className="font-semibold">Re-analizando fuente con Múltiples Motores de IA... (Esto puede tardar hasta 1 minuto)</span>
                    </div>
                </div>
            );
        }

        if (loading && !timedOut) {
            return (
                <div className="mt-4 text-sm text-yellow-700 bg-yellow-50 p-4 rounded-xl border border-yellow-200 shadow-sm animate-pulse">
                    <div className="flex items-center gap-3">
                        <Activity className="h-5 w-5 animate-spin text-yellow-600" />
                        <span className="font-semibold">Analizando fuente con Múltiples Motores de IA... (Esto puede tardar hasta 1 minuto)</span>
                    </div>
                </div>
            );
        }

        if (verdict?.verdict) {
            return (
                <div className="mt-4 p-5 md:p-6 border rounded-2xl bg-white dark:bg-slate-950 shadow-sm space-y-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <h4 className="font-bold text-xl flex items-center gap-2">
                            <BrainCircuit className="h-6 w-6 text-primary" />
                            Veredicto del consenso
                        </h4>
                        <div className="flex items-center gap-2 flex-wrap">
                            {renderConsensusBadge(verdict.verdict)}
                            {verdict.verdict_score !== null && (
                                <span className="text-sm font-semibold text-muted-foreground">{verdict.verdict_score}% de veracidad</span>
                            )}
                            {verdict.requires_review && (
                                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-sm font-semibold">
                                    <Activity className="h-4 w-4" />
                                    En revisión
                                </span>
                            )}
                        </div>
                    </div>

                    {verdict.requires_review && (
                        <p className="text-sm text-amber-700 dark:text-amber-300">
                            Los modelos no alcanzaron un acuerdo suficiente (acuerdo menor al 60%), por lo que el veredicto requiere revisión.
                        </p>
                    )}

                    <p className="text-sm text-slate-600 dark:text-slate-400">
                        El detalle por modelo no está disponible para esta fuente. Puedes re-analizarla.
                    </p>

                    {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

                    <ReanalyzeButton onClick={handleReanalyze} loading={reanalyzing} />
                </div>
            );
        }

        return (
            <div className="mt-4 p-5 border rounded-2xl bg-slate-50 dark:bg-slate-900/50 space-y-4">
                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <AlertTriangle className="h-4 w-4" />
                    <p className="text-sm">No se pudo completar el análisis. Intenta re-analizar.</p>
                </div>
                {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                <ReanalyzeButton onClick={handleReanalyze} loading={reanalyzing} />
            </div>
        );
    }

    const validReports = reports.filter(r => r.veracity_score !== null);
    if (validReports.length === 0) {
        return (
            <div className="mt-4 p-4 border rounded-xl bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-400">
                <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    <p>Análisis en proceso o fuente sin suficiente contexto para evaluar.</p>
                </div>
            </div>
        );
    }

    // Calcular promedios combinados
    const avgVeracity = Math.round(
        validReports.reduce((acc, r) => acc + (r.veracity_score || 0), 0) / validReports.length
    );
    const avgCoherence = Math.round(
        validReports.reduce((acc, r) => acc + (r.coherence_score || 0), 0) / validReports.length
    );

    // Obtener un resumen y puntos clave (tomamos el primero válido, idealmente los modelos más potentes suelen venir primero o ultimo)
    const mainSummary = validReports.find(r => r.summary)?.summary;
    const keyClaims = validReports.find(r => r.key_claims && Array.isArray(r.key_claims) && r.key_claims.length > 0)?.key_claims || [];

    // Alertas de sesgo relevantes (filtramos las nulas y vacías, o donde dice "no se detecta gran sesgo")
    const biases = validReports.map(r => r.bias_analysis).filter(b => b && b.length > 20) as string[];

    const getScoreColor = (score: number) => {
        if (score >= 70) return "bg-emerald-500";
        if (score >= 40) return "bg-amber-500";
        return "bg-red-500";
    };

    const getScoreTextClass = (score: number) => {
        if (score >= 70) return "text-emerald-600 dark:text-emerald-400";
        if (score >= 40) return "text-amber-600 dark:text-amber-400";
        return "text-red-600 dark:text-red-400";
    };

    return (
        <div className="mt-5 p-5 md:p-6 border rounded-2xl bg-white dark:bg-slate-950 shadow-sm space-y-6">
            {reanalyzing && (
                <div className="text-sm text-yellow-700 bg-yellow-50 p-4 rounded-xl border border-yellow-200 animate-pulse">
                    <div className="flex items-center gap-3">
                        <Activity className="h-5 w-5 animate-spin text-yellow-600" />
                        <span className="font-semibold">Re-analizando fuente con Múltiples Motores de IA... (Esto puede tardar hasta 1 minuto)</span>
                    </div>
                </div>
            )}

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            {/* Cabecera y Promedios */}
            <div>
                <h4 className="font-bold text-xl flex items-center gap-2 mb-5">
                    <BrainCircuit className="h-6 w-6 text-primary" />
                    Consenso Inteligencia Artificial
                    <span className="ml-auto flex items-center gap-3">
                        {renderVerdictBadge()}
                        <ReanalyzeButton onClick={handleReanalyze} loading={reanalyzing} />
                    </span>
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
                    {/* Veracidad */}
                    <div className="space-y-3">
                        <div className="flex justify-between items-end">
                            <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Veracidad</span>
                            <span className={`text-3xl font-black leading-none ${getScoreTextClass(avgVeracity)}`}>{avgVeracity}%</span>
                        </div>
                        <Progress value={avgVeracity} className={`h-3 bg-slate-100 dark:bg-slate-800`} indicatorClassName={getScoreColor(avgVeracity)} />
                    </div>

                    {/* Coherencia */}
                    <div className="space-y-3">
                        <div className="flex justify-between items-end">
                            <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Coherencia</span>
                            <span className={`text-3xl font-black leading-none ${getScoreTextClass(avgCoherence)}`}>{avgCoherence}%</span>
                        </div>
                        <Progress value={avgCoherence} className={`h-3 bg-slate-100 dark:bg-slate-800`} indicatorClassName={getScoreColor(avgCoherence)} />
                    </div>
                </div>
            </div>

            {/* Sesgo */}
            {biases.length > 0 && (
                <Alert variant="default" className="bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/50">
                    <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500" />
                    <AlertTitle className="text-amber-800 dark:text-amber-400 font-bold ml-1">Observación de Sesgo</AlertTitle>
                    <AlertDescription className="text-amber-700 dark:text-amber-300 text-sm mt-2 ml-1 leading-relaxed">
                        {biases[0]} {/* Mostramos el primer análisis de sesgo relevante */}
                    </AlertDescription>
                </Alert>
            )}

            {/* Resumen y Puntos Clave */}
            <div className="space-y-4">
                {mainSummary && (
                    <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border">
                        <h5 className="font-bold text-xs uppercase tracking-wider text-muted-foreground mb-2">Síntesis</h5>
                        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{mainSummary}</p>
                    </div>
                )}

                {keyClaims.length > 0 && (
                    <div className="bg-indigo-50/50 dark:bg-indigo-950/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/50">
                        <h5 className="font-bold text-xs uppercase tracking-wider text-indigo-800 dark:text-indigo-400 mb-3">Puntos Clave Extraídos</h5>
                        <ul className="space-y-3">
                            {keyClaims.map((claim, idx) => (
                                <li key={idx} className="flex gap-3 items-start text-sm text-indigo-950 dark:text-indigo-200">
                                    <ShieldCheck className="h-5 w-5 text-indigo-500 shrink-0 mt-0.5" />
                                    <span className="leading-relaxed">{claim}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {/* Detalles por Modelo */}
            <div className="pt-2">
                <Accordion type="single" collapsible className="w-full bg-slate-50 dark:bg-slate-900/30 rounded-xl border px-5">
                    {validReports.map((report, index) => (
                        <AccordionItem key={report.id} value={`item-${index}`} className="border-b-0 border-t border-slate-200 dark:border-slate-800 last:border-b-0 first:border-t-0">
                            <AccordionTrigger className="hover:no-underline py-4">
                                <div className="flex justify-between w-full pr-4 items-center">
                                    <span className="font-semibold text-sm">{report.model_name.split('/').pop()}</span>
                                    <div className="flex gap-4">
                                        <span className={`text-sm font-bold ${getScoreTextClass(report.veracity_score || 0)}`}>
                                            V: {report.veracity_score}%
                                        </span>
                                    </div>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="text-sm text-slate-600 dark:text-slate-400 pb-5 space-y-4">
                                {report.summary && (
                                    <div>
                                        <strong className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-500 block mb-1">Resumen</strong>
                                        <p className="leading-relaxed">{report.summary}</p>
                                    </div>
                                )}
                                {report.bias_analysis && (
                                    <div>
                                        <strong className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-500 block mb-1">Sesgo</strong>
                                        <p className="leading-relaxed">{report.bias_analysis}</p>
                                    </div>
                                )}
                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
            </div>
        </div>
    );
}
