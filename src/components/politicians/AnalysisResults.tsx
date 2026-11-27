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
import {
    EXTERNAL_RELATIONS,
    FALLACY_TYPES,
    median,
    type ContentNature,
    type ExternalRelation,
    type FallacyType,
    type ReportExternalEvidence,
    type ReportFallacy,
    type ReportQuote,
} from '@/lib/consensus';

interface AIReport {
    id: string;
    source_id: string;
    model_name: string;
    veracity_score: number | null;
    coherence_score: number | null;
    bias_analysis: string | null;
    summary: string | null;
    key_claims: string[] | null;
    report_json?: unknown;
    [key: string]: unknown;
}

interface JevVerification {
    choice: string;
    confidence: number;
    // Probabilidad 0–1 de que la justificación esté respaldada. Null si JEV no la envió.
    soportado: number | null;
    // Consenso de JEV: corridas solicitadas, corridas válidas y variación del soportado.
    runs: number | null;
    degraded: boolean;
    spread: number | null;
    validRuns: number;
}

interface SourceVerdict {
    verdict: string | null;
    verdict_score: number | null;
    mean_score: number | null;
    nature_override: boolean;
    consensus_agreement: number | null;
    jev_support: number | null;
    requires_review: boolean;
    status: string | null;
    analysis_error: string | null;
}

interface AnalysisDiagnostics {
    modelsAttempted: number;
    modelsResponded: number;
    timeouts: number;
}

interface SourceQuality {
    transcriptUsed: boolean | null;
    transcriptWords: number | null;
    transcriptMethod: string | null;
    fromCache: boolean;
}

interface AnalysisResultsProps {
    sourceId: string;
    politicianId: string;
    sourceUrl: string;
}

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 24;
const EXPECTED_MODELS = 3;

const JEV_LABEL: Record<string, string> = {
    soportado: "Justificación verificada",
    parcial: "Justificación parcialmente respaldada",
    no_soportado: "La verificación no confirmó la justificación",
};

function getJevVerification(reports: AIReport[]): JevVerification | null {
    for (const report of reports) {
        const raw = report.report_json;
        if (!raw || typeof raw !== "object") continue;
        const jev = (raw as { _jev?: unknown })._jev;
        if (!jev || typeof jev !== "object") continue;
        const choice = (jev as { choice?: unknown }).choice;
        if (typeof choice !== "string") continue;
        const probabilities = (jev as { probabilities?: Record<string, unknown> }).probabilities;
        const soportadoRaw = probabilities?.soportado;
        const soportado = Number(soportadoRaw);
        const perRun = (jev as { perRun?: unknown }).perRun;
        const runsRaw = Number((jev as { runs?: unknown }).runs);
        const spreadRaw = Number((jev as { spread?: unknown }).spread);
        return {
            choice,
            confidence: Number((jev as { confidence?: unknown }).confidence ?? 0),
            soportado: Number.isFinite(soportado) ? soportado : null,
            runs: Number.isFinite(runsRaw) && runsRaw > 0 ? runsRaw : null,
            degraded: (jev as { degraded?: unknown }).degraded === true,
            spread: Number.isFinite(spreadRaw) ? spreadRaw : null,
            validRuns: Array.isArray(perRun) ? perRun.length : 1,
        };
    }
    return null;
}

function getAnalysisDiagnostics(reports: AIReport[]): AnalysisDiagnostics | null {
    for (const report of reports) {
        const raw = report.report_json;
        if (!raw || typeof raw !== "object") continue;
        const analysis = (raw as { _analysis?: unknown })._analysis;
        if (!analysis || typeof analysis !== "object") continue;
        const obj = analysis as Record<string, unknown>;
        const modelsAttempted = Number(obj.modelsAttempted);
        const modelsResponded = Number(obj.modelsResponded);
        if (!Number.isFinite(modelsAttempted) || !Number.isFinite(modelsResponded)) continue;
        const timeouts = Number(obj.timeouts ?? 0);
        return {
            modelsAttempted,
            modelsResponded,
            timeouts: Number.isFinite(timeouts) ? timeouts : 0,
        };
    }
    return null;
}

function getSourceQuality(reports: AIReport[]): SourceQuality | null {
    for (const report of reports) {
        const raw = report.report_json;
        if (!raw || typeof raw !== 'object') continue;
        const quality = (raw as { source_quality?: unknown }).source_quality;
        if (!quality || typeof quality !== 'object') continue;
        const obj = quality as Record<string, unknown>;
        const transcriptWords = Number(obj.transcript_words);
        return {
            transcriptUsed: typeof obj.transcript_used === 'boolean' ? obj.transcript_used : null,
            transcriptWords: Number.isFinite(transcriptWords) ? transcriptWords : null,
            transcriptMethod: typeof obj.transcript_method === 'string' ? obj.transcript_method : null,
            fromCache: obj.transcript_source === 'cache',
        };
    }
    return null;
}

interface PlainContent {
    plainVerdict: string | null;
    plainSummary: string | null;
    quotes: ReportQuote[] | null;
    fallacies: ReportFallacy[] | null;
    contentNature: ContentNature | null;
    externalEvidence: ReportExternalEvidence[] | null;
}

const EMPTY_PLAIN_CONTENT: PlainContent = {
    plainVerdict: null,
    plainSummary: null,
    quotes: null,
    fallacies: null,
    contentNature: null,
    externalEvidence: null,
};

const EXTERNAL_RELATION_BADGES: Record<ExternalRelation, { emoji: string; label: string; className: string }> = {
    coincide: {
        emoji: '✅',
        label: 'Coincide',
        className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    },
    difiere: {
        emoji: '⚠️',
        label: 'Difiere',
        className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    },
    no_comparable: {
        emoji: '◻️',
        label: 'No comparable',
        className: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    },
};

const FALLACY_LABELS: Record<FallacyType, string> = {
    asociacion: 'Asociación no probada',
    hombre_de_paja: 'Hombre de paja',
    falsa_dicotomia: 'Falsa dicotomía',
    apelacion_emocional: 'Apelación emocional',
    generalizacion: 'Generalización',
    whataboutism: 'Desviar la crítica con otra conducta',
    cherry_picking: 'Selección de datos a conveniencia',
};

function asPlainString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asContentNature(value: unknown): ContentNature | null {
    return value === 'opinion' || value === 'mixto' || value === 'factual' ? value : null;
}

function asQuotes(value: unknown): ReportQuote[] | null {
    if (!Array.isArray(value)) return null;
    const quotes: ReportQuote[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const obj = item as Record<string, unknown>;
        const text = asPlainString(obj.text);
        const assessment = asPlainString(obj.assessment);
        if (text && assessment) quotes.push({ text, assessment });
    }
    return quotes.length > 0 ? quotes : null;
}

function asFallacies(value: unknown): ReportFallacy[] | null {
    if (!Array.isArray(value)) return null;
    const fallacies: ReportFallacy[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const obj = item as Record<string, unknown>;
        const type = asPlainString(obj.type)?.toLowerCase();
        if (!type || !FALLACY_TYPES.includes(type as FallacyType)) continue;
        const quote = asPlainString(obj.quote);
        const explanation = asPlainString(obj.explanation);
        if (!quote || !explanation) continue;
        fallacies.push({ type: type as FallacyType, quote, explanation });
        if (fallacies.length >= 3) break;
    }
    return fallacies.length > 0 ? fallacies : null;
}

function asExternalEvidence(value: unknown): ReportExternalEvidence[] | null {
    if (!Array.isArray(value)) return null;
    const evidence: ReportExternalEvidence[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const obj = item as Record<string, unknown>;
        const claim = asPlainString(obj.claim);
        const officialValue = asPlainString(obj.official_value);
        const detail = asPlainString(obj.detail);
        const relation = asPlainString(obj.relation)?.toLowerCase();
        if (!claim || !officialValue || !detail) continue;
        if (!relation || !EXTERNAL_RELATIONS.includes(relation as ExternalRelation)) continue;
        evidence.push({
            claim,
            officialValue,
            source: asPlainString(obj.source) ?? 'Banco Central de Chile',
            relation: relation as ExternalRelation,
            detail,
        });
    }
    return evidence.length > 0 ? evidence : null;
}

function readPlainContent(report: AIReport): PlainContent {
    const raw = report.report_json;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_PLAIN_CONTENT;
    const obj = raw as Record<string, unknown>;
    return {
        plainVerdict: asPlainString(obj.plain_verdict),
        plainSummary: asPlainString(obj.plain_summary),
        quotes: asQuotes(obj.quotes),
        fallacies: asFallacies(obj.fallacies),
        contentNature: asContentNature(obj.content_nature),
        externalEvidence: asExternalEvidence(obj.external_evidence),
    };
}

interface ConsensusDiscard {
    discarded: boolean;
    reason: string | null;
}

const EMPTY_DISCARD: ConsensusDiscard = { discarded: false, reason: null };

function getConsensusDiscard(report: AIReport): ConsensusDiscard {
    const raw = report.report_json;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_DISCARD;
    const consensus = (raw as { _consensus?: unknown })._consensus;
    if (!consensus || typeof consensus !== 'object') return EMPTY_DISCARD;
    const obj = consensus as Record<string, unknown>;
    return {
        discarded: obj.discarded === true,
        reason: typeof obj.reason === 'string' ? obj.reason : null,
    };
}

const SCORE_CITATION_PATTERN = /\b\d{2}\b[\s\S]*?(puntaje|veracidad|coherencia|claridad)/i;

export function summaryCitesScores(text: string): boolean {
    return SCORE_CITATION_PATTERN.test(text);
}

function TechnicalFallacies({ report }: { report: AIReport }) {
    const fallacies = readPlainContent(report).fallacies;
    if (!fallacies || fallacies.length === 0) return null;
    return (
        <div>
            <strong className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-500 block mb-1">Falacias (tipo técnico)</strong>
            <ul className="space-y-1">
                {fallacies.map((fallacy, index) => (
                    <li key={index}>
                        <code className="rounded bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 text-xs">{fallacy.type}</code>
                    </li>
                ))}
            </ul>
        </div>
    );
}

const BADGE_CLASS: Record<VeracityColor, string> = {    green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
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
    const [retryingTranscript, setRetryingTranscript] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [transcriptError, setTranscriptError] = useState<{ message: string; retryable: boolean } | null>(null);

    const fetchReports = useCallback(async () => {
        const supabase = createClient();
        const [reportsRes, sourceRes] = await Promise.all([
            supabase.from('ai_reports').select('*').eq('source_id', sourceId),
            supabase.from('sources').select('verdict, verdict_score, mean_score, nature_override, consensus_agreement, jev_support, requires_review, status, analysis_error').eq('id', sourceId).maybeSingle(),
        ]);

        if (reportsRes.error) {
            console.error("Error fetching reports:", reportsRes.error);
        }

        const fetchedReports = reportsRes.data ?? [];
        const sourceVerdict: SourceVerdict | null = sourceRes.data
            ? {
                verdict: sourceRes.data.verdict ?? null,
                verdict_score: sourceRes.data.verdict_score ?? null,
                mean_score: sourceRes.data.mean_score ?? null,
                nature_override: sourceRes.data.nature_override === true,
                consensus_agreement: sourceRes.data.consensus_agreement ?? null,
                jev_support: sourceRes.data.jev_support ?? null,
                requires_review: sourceRes.data.requires_review ?? false,
                status: sourceRes.data.status ?? null,
                analysis_error: sourceRes.data.analysis_error ?? null,
            }
            : null;

        if (fetchedReports.length > 0) {
            setReports(fetchedReports);
            setLoading(false);
        }
        if (sourceVerdict) {
            setVerdict(sourceVerdict);
        }

        const done =
            fetchedReports.length > 0 ||
            (sourceVerdict?.verdict ?? null) !== null ||
            sourceVerdict?.status === 'requiere_revision';
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
        setTranscriptError(null);
        try {
            const res = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: sourceUrl, politicianId, force: true }),
            });
            const data = (await res.json().catch(() => null)) as {
                error?: string;
                reason?: string;
                retryable?: boolean;
            } | null;
            if (!res.ok) {
                setError(data?.error ?? 'No se pudo re-analizar la fuente.');
                if (data?.reason === 'sin_transcripcion' && data?.retryable === true) {
                    setTranscriptError({
                        message: data.error ?? 'YouTube está limitando las peticiones. Vuelve a intentarlo en unos minutos.',
                        retryable: true,
                    });
                }
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

    const handleRetryTranscript = async () => {
        setRetryingTranscript(true);
        setError(null);
        try {
            const res = await fetch(`/api/sources/${sourceId}/transcript`, { method: 'POST' });
            const data = (await res.json().catch(() => null)) as {
                ok?: boolean;
                reason?: string;
                retryable?: boolean;
            } | null;
            if (!res.ok || !data?.ok) {
                setTranscriptError({
                    message: data?.reason ?? 'No se pudo re-extraer la transcripción.',
                    retryable: data?.retryable !== false,
                });
                return;
            }
            setTranscriptError(null);
        } catch {
            setTranscriptError({
                message: 'No se pudo re-extraer la transcripción.',
                retryable: true,
            });
        } finally {
            setRetryingTranscript(false);
        }
    };

    const transcriptErrorBanner = transcriptError ? (
        <div className="mt-3 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
            <p className="text-sm text-amber-800 dark:text-amber-300">{transcriptError.message}</p>
            {transcriptError.retryable && (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRetryTranscript}
                    disabled={retryingTranscript}
                >
                    <RefreshCw className={retryingTranscript ? 'animate-spin' : ''} />
                    {retryingTranscript ? 'Reintentando...' : 'Reintentar'}
                </Button>
            )}
        </div>
    ) : null;

    const verdictColor = colorFromLabel(verdict?.verdict ?? null);

    const reviewBadge = (
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-sm font-semibold">
            <Activity className="h-4 w-4" />
            En revisión
        </span>
    );

    const renderVerdictBadge = () => {
        if (!verdict?.verdict) return reviewBadge;
        const display = displayLabel(verdict.verdict);
        const cls = BADGE_CLASS[verdictColor ?? "gray"];
        return (
            <>
                <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${cls} text-sm font-semibold`}>
                    {display ?? verdict.verdict}
                </span>
                {verdict.requires_review && reviewBadge}
            </>
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

        if (verdict?.status === 'requiere_revision' || verdict?.requires_review) {
            return (
                <div className="mt-4 p-5 border rounded-2xl bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/50 space-y-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-sm font-semibold">
                                <Activity className="h-4 w-4" />
                                En revisión
                            </span>
                        </div>
                        <ReanalyzeButton onClick={handleReanalyze} loading={reanalyzing} />
                    </div>
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                        El análisis no se completó o quedó pendiente de revisión. Puedes re-analizar la fuente.
                    </p>
                    {verdict?.analysis_error && (
                        <p className="text-xs text-amber-700/80 dark:text-amber-400/80">
                            {verdict.analysis_error}
                        </p>
                    )}
                    {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                    {transcriptErrorBanner}
                </div>
            );
        }

        if (!timedOut && (loading || verdict?.status === 'procesando')) {
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
                    {transcriptErrorBanner}

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
                    {transcriptErrorBanner}
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

    // Promedios del consenso: los reportes descartados no contaminan las cifras.
    const consensusReports = validReports.filter((report) => !getConsensusDiscard(report).discarded);
    const scoredReports = consensusReports.length > 0 ? consensusReports : validReports;

    // El verdict_score persistido ya es la mediana. Si aún no está disponible,
    // se calcula en cliente sobre todos los puntajes para no mostrar el promedio.
    const allScores = validReports.map((report) => report.veracity_score as number);
    const computedMedian = allScores.length > 0 ? median(allScores) : null;
    const verdictScoreValue = verdict?.verdict_score ?? computedMedian;
    const avgVeracity = Math.round(verdictScoreValue ?? 0);
    const meanScoreValue =
        verdict?.mean_score ??
        (scoredReports.length > 0
            ? scoredReports.reduce((acc, r) => acc + (r.veracity_score || 0), 0) / scoredReports.length
            : null);
    const avgCoherence = Math.round(
        scoredReports.reduce((acc, r) => acc + (r.coherence_score || 0), 0) / scoredReports.length
    );

    // Un modelo es outlier si se aleja más de 25 puntos de la mediana. Se
    // incluyen los descartados para que el disidente no quede invisible.
    let outlierReport: AIReport | null = null;
    let maxOutlierDistance = 0;
    if (computedMedian !== null) {
        for (const report of validReports) {
            const distance = Math.abs((report.veracity_score as number) - computedMedian);
            if (distance > maxOutlierDistance) {
                maxOutlierDistance = distance;
                outlierReport = report;
            }
        }
    }
    const outlierDetected =
        computedMedian !== null &&
        (maxOutlierDistance > 25 ||
            (meanScoreValue !== null && Math.abs(computedMedian - meanScoreValue) > 25));

    // Obtener un resumen y puntos clave (tomamos el primero válido, idealmente los modelos más potentes suelen venir primero o ultimo)
    const mainSummaryReport = scoredReports.find(r => r.summary);
    const mainSummary = mainSummaryReport?.summary;
    const keyClaims = scoredReports.find(r => r.key_claims && Array.isArray(r.key_claims) && r.key_claims.length > 0)?.key_claims || [];

    // Contenido en lenguaje ciudadano: se toma el primer reporte que lo traiga.
    const plainEntry = scoredReports
        .map((report) => ({ report, plain: readPlainContent(report) }))
        .find(
            ({ plain }) =>
                plain.plainVerdict ||
                plain.plainSummary ||
                plain.contentNature ||
                (plain.quotes && plain.quotes.length > 0) ||
                (plain.fallacies && plain.fallacies.length > 0)
        );
    const plainContent = plainEntry?.plain ?? EMPTY_PLAIN_CONTENT;
    const plainSummaryReport = plainEntry?.report ?? null;
    // Defensa ante respuestas antiguas: si el resumen cita cifras de puntaje,
    // se muestra el resumen técnico de ese mismo modelo en su lugar.
    const plainSummaryText = plainContent.plainSummary
        ? summaryCitesScores(plainContent.plainSummary)
            ? plainSummaryReport?.summary ?? mainSummary ?? null
            : plainContent.plainSummary
        : null;
    const plainSummaryModel = plainSummaryReport?.model_name ?? null;

    // Alertas de sesgo relevantes (filtramos las nulas y vacías, o donde dice "no se detecta gran sesgo")
    const biases = validReports.map(r => r.bias_analysis).filter(b => b && b.length > 20) as string[];

    // Verificación JEV y grado de completitud del triplete.
    const jevVerification = getJevVerification(reports);
    const jevLabel = jevVerification ? JEV_LABEL[jevVerification.choice] ?? jevVerification.choice : null;
    const jevSoportado = jevVerification?.soportado ?? null;
    // Dos señales separadas: el acuerdo entre modelos viene de `sources` y el
    // respaldo de JEV de `sources.jev_support` (con respaldo del reporte antiguo).
    const jevSupportPercent =
        typeof verdict?.jev_support === 'number'
            ? Math.round(verdict.jev_support)
            : typeof jevSoportado === 'number'
                ? Math.round(jevSoportado * 100)
                : null;
    const jevAmbiguous = verdict?.analysis_error === 'jev_ambiguous';
    // Diagnóstico de cuántos modelos se intentaron (incluye fallbacks) y respondieron.
    const diagnostics = getAnalysisDiagnostics(reports);
    const modelsAttempted = diagnostics?.modelsAttempted ?? EXPECTED_MODELS;
    const modelsResponded = diagnostics?.modelsResponded ?? validReports.length;
    const timedOutCount = diagnostics?.timeouts ?? 0;
    const isPartial = Boolean(verdict?.verdict) && validReports.length > 0 && modelsResponded < modelsAttempted;
    const reviewExplanation = isPartial
        ? `Solo respondieron ${modelsResponded} de ${modelsAttempted} modelos. El veredicto es preliminar.`
        : jevAmbiguous
            ? "La verificación automática no pudo confirmar ni descartar la justificación."
            : jevVerification?.choice === "no_soportado"
                ? "La verificación automática no confirmó la justificación."
                : "El veredicto requiere revisión.";

    // Calidad de la fuente: si algún modelo reportó que se analizó sin transcripción,
    // se avisa que el resultado puede ser parcial.
    const transcriptMissing = reports.some((report) => {
        const raw = report.report_json;
        if (!raw || typeof raw !== 'object') return false;
        const quality = (raw as { source_quality?: { transcript_used?: unknown } }).source_quality;
        return quality?.transcript_used === false;
    });
    const sourceQuality = getSourceQuality(reports);

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
                    {transcriptErrorBanner}

            {/* Veredicto en lenguaje ciudadano */}
            {(plainContent.plainVerdict || plainContent.plainSummary || plainContent.contentNature === 'opinion' || plainContent.quotes) && (
                <section className="space-y-4 border-b border-slate-200 dark:border-slate-800 pb-6">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                        {plainContent.plainVerdict && (
                            <p className="text-2xl md:text-3xl font-black leading-tight text-slate-900 dark:text-slate-100">
                                {plainContent.plainVerdict}
                            </p>
                        )}
                        <div className="flex items-center gap-3 flex-wrap shrink-0">
                            {renderVerdictBadge()}
                            <span className={`text-xl font-bold ${getScoreTextClass(avgVeracity)}`}>
                                {avgVeracity}%
                            </span>
                        </div>
                    </div>

                    {plainSummaryText && (
                        <div className="space-y-1">
                            <p className="text-base leading-relaxed text-slate-700 dark:text-slate-300">
                                {plainSummaryText}
                            </p>
                            {plainSummaryModel && (
                                <p className="text-xs text-slate-500 dark:text-slate-500">
                                    Resumen del modelo: <span className="font-medium">{plainSummaryModel}</span>
                                </p>
                            )}
                        </div>
                    )}

                    {verdict?.nature_override && (
                        <div className="flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm text-amber-800 dark:text-amber-300">
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                            <p>El veredicto se fijó en «no evaluable» porque la mayoría de los modelos clasificó el contenido como opinión, no como afirmaciones verificables.</p>
                        </div>
                    )}

                    {plainContent.contentNature === 'opinion' && (
                        <div className="flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm text-amber-800 dark:text-amber-300">
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                            <p>Este contenido es mayoritariamente opinión o propuesta política, no afirmaciones verificables. El porcentaje no mide si tiene razón.</p>
                        </div>
                    )}

                    {plainContent.quotes && plainContent.quotes.length > 0 && (
                        <div>
                            <h5 className="font-bold text-xs uppercase tracking-wider text-muted-foreground mb-3">Frases evaluadas</h5>
                            <ul className="space-y-3">
                                {plainContent.quotes.map((quote, index) => (
                                    <li key={index} className="rounded-xl border bg-slate-50 dark:bg-slate-900/50 p-4">
                                        <p className="italic text-slate-800 dark:text-slate-200 leading-relaxed">“{quote.text}”</p>
                                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                                            <span className="font-semibold">Qué se encontró: </span>
                                            {quote.assessment}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </section>
            )}

            {/* Contraste con datos oficiales: solo si el modelo lo reportó */}
            {plainContent.externalEvidence && plainContent.externalEvidence.length > 0 && (
                <section className="space-y-4 border-b border-slate-200 dark:border-slate-800 pb-6">
                    <h5 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">
                        Contraste con datos oficiales
                    </h5>
                    <ul className="space-y-3">
                        {plainContent.externalEvidence.map((evidence, index) => {
                            const badge = EXTERNAL_RELATION_BADGES[evidence.relation];
                            return (
                                <li key={index} className="rounded-xl border bg-slate-50 dark:bg-slate-900/50 p-4">
                                    <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${badge.className}`}>
                                        {badge.emoji} {badge.label}
                                    </span>
                                    <p className="mt-3 italic text-slate-800 dark:text-slate-200 leading-relaxed">
                                        “{evidence.claim}”
                                    </p>
                                    <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                                        <span className="font-semibold">Dato oficial: </span>
                                        {evidence.officialValue}
                                    </p>
                                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                                        {evidence.detail}
                                    </p>
                                    <a
                                        href="https://si3.bcentral.cl/siete/"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="mt-2 inline-block text-xs font-semibold text-primary underline underline-offset-2"
                                    >
                                        {evidence.source} · si3.bcentral.cl
                                    </a>
                                </li>
                            );
                        })}
                    </ul>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Dato oficial consultado al Banco Central. El porcentaje de veracidad mide otra cosa.
                    </p>
                </section>
            )}

            {/* Recursos retóricos detectados: solo si hay falacias claras */}
            {plainContent.fallacies && plainContent.fallacies.length > 0 && (
                <section className="space-y-4 border-b border-slate-200 dark:border-slate-800 pb-6">
                    <h5 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">Recursos retóricos detectados</h5>
                    <ul className="space-y-3">
                        {plainContent.fallacies.map((fallacy, index) => (
                            <li key={index} className="rounded-xl border bg-slate-50 dark:bg-slate-900/50 p-4">
                                <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                    {FALLACY_LABELS[fallacy.type]}
                                </span>
                                <p className="mt-3 italic text-slate-800 dark:text-slate-200 leading-relaxed">“{fallacy.quote}”</p>
                                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{fallacy.explanation}</p>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

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

                {transcriptMissing && (
                    <p className="mt-4 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        Este video se analizó sin transcripción (solo descripción). El resultado puede ser parcial.
                    </p>
                )}

                <p className="mt-4 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <BrainCircuit className="h-4 w-4 shrink-0" />
                    {modelsResponded} de {modelsAttempted} modelos respondieron
                    {timedOutCount > 0 ? ` (${timedOutCount} por timeout)` : ''}.
                </p>

                {typeof verdict?.consensus_agreement === 'number' && (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                        Acuerdo entre modelos: {Math.round(verdict.consensus_agreement)}%.
                    </p>
                )}

                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    Respaldo de la verificación:{' '}
                    {jevSupportPercent !== null ? `${jevSupportPercent}%` : 'sin verificación'}.
                </p>

                {jevVerification && (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                        Estabilidad de la verificación: {jevVerification.validRuns} de{' '}
                        {jevVerification.runs ?? jevVerification.validRuns} verificaciones
                        {jevVerification.spread !== null
                            ? ` (variación ${jevVerification.spread.toFixed(2)}${jevVerification.spread > 0.25 ? ' — resultado inestable' : ''})`
                            : ''}.
                    </p>
                )}

                {jevVerification?.spread !== null && jevVerification?.spread !== undefined && jevVerification.spread > 0.25 && (
                    <p className="mt-2 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                        <Activity className="h-4 w-4 shrink-0" />
                        La verificación automática dio resultados dispares en esta fuente; el veredicto puede ser revisado.
                    </p>
                )}

                {verdict?.verdict && (isPartial || verdict.requires_review) && (
                    <p className="mt-4 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                        <Activity className="h-4 w-4 shrink-0" />
                        {reviewExplanation}
                    </p>
                )}

                {jevLabel && jevVerification && (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                        JEV: {jevLabel} ({Math.round(jevVerification.confidence * 100)}% de confianza)
                    </p>
                )}
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
                        {mainSummaryReport && (
                            <p className="mt-2 text-xs text-slate-500 dark:text-slate-500">
                                Resumen del modelo: <span className="font-medium">{mainSummaryReport.model_name}</span>
                            </p>
                        )}
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
                {outlierDetected && outlierReport && computedMedian !== null && (
                    <p className="mb-3 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>
                            Un modelo difirió del resto: <strong>{outlierReport.model_name}</strong>{' '}
                            puntuó {(outlierReport.veracity_score as number)} frente a una mediana de{' '}
                            {computedMedian}.
                        </span>
                    </p>
                )}
                <Accordion type="single" collapsible className="w-full bg-slate-50 dark:bg-slate-900/30 rounded-xl border px-5">
                    {validReports.map((report, index) => {
                        const discard = getConsensusDiscard(report);
                        return (
                        <AccordionItem key={report.id} value={`item-${index}`} className="border-b-0 border-t border-slate-200 dark:border-slate-800 last:border-b-0 first:border-t-0">
                            <AccordionTrigger className="hover:no-underline py-4">
                                <div className="flex justify-between w-full pr-4 items-center">
                                    <span className="font-semibold text-sm flex items-center gap-2">
                                        {report.model_name.split('/').pop()}
                                        {discard.discarded && (
                                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                                descartado del consenso
                                            </span>
                                        )}
                                    </span>
                                    <div className="flex gap-4">
                                        <span className={`text-sm font-bold ${getScoreTextClass(report.veracity_score || 0)}`}>
                                            V: {report.veracity_score}%
                                        </span>
                                    </div>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="text-sm text-slate-600 dark:text-slate-400 pb-5 space-y-4">
                                {discard.discarded && (
                                    <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-amber-800 dark:text-amber-300">
                                        <p className="font-semibold">
                                            Descartado del consenso: naturaleza del contenido incoherente con el puntaje.
                                        </p>
                                        {discard.reason && (
                                            <p className="mt-1 text-xs opacity-80">Motivo: {discard.reason}</p>
                                        )}
                                    </div>
                                )}
                                {sourceQuality && (sourceQuality.transcriptMethod || sourceQuality.transcriptWords !== null || sourceQuality.fromCache) && (
                                    <div>
                                        <strong className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-500 block mb-1">Transcripción</strong>
                                        <p className="leading-relaxed">
                                            Método: {sourceQuality.fromCache ? 'cache' : sourceQuality.transcriptMethod ?? 'no disponible'}
                                            {sourceQuality.transcriptWords !== null ? ` · ${sourceQuality.transcriptWords} palabras` : ''}
                                        </p>
                                        {sourceQuality.fromCache && (
                                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                                                Transcripción reutilizada del primer análisis.
                                            </p>
                                        )}
                                    </div>
                                )}
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
                                <TechnicalFallacies report={report} />
                            </AccordionContent>
                        </AccordionItem>
                        );
                    })}
                </Accordion>
            </div>
        </div>
    );
}
