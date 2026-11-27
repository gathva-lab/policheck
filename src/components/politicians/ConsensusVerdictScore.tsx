'use client';

import { Progress } from '@/components/ui/progress';

export interface ConsensusVerdictScoreProps {
    // Etiqueta del veredicto. Si es null no hay consenso y no se muestra cifra.
    verdict: string | null;
    verdictScore: number | null;
    agreement: number | null;
    // Modelo que más se alejó de la mediana de candidatos y su puntaje.
    outlierModel?: string | null;
    outlierScore?: number | null;
    candidateMedian?: number | null;
}

function scoreColor(score: number): string {
    if (score >= 70) return 'bg-emerald-500';
    if (score >= 40) return 'bg-amber-500';
    return 'bg-red-500';
}

function scoreTextClass(score: number): string {
    if (score >= 70) return 'text-emerald-600 dark:text-emerald-400';
    if (score >= 40) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-600 dark:text-red-400';
}

// Un número de veracidad sin veredicto no significa nada y sugiere una
// precisión que el consenso no tiene. Por eso el porcentaje y la barra solo se
// renderizan cuando existe una etiqueta de veredicto.
export function ConsensusVerdictScore({
    verdict,
    verdictScore,
    agreement,
    outlierModel = null,
    outlierScore = null,
    candidateMedian = null,
}: ConsensusVerdictScoreProps) {
    if (verdict === null) {
        return (
            <div data-testid="sin-consenso" className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                        Veracidad
                    </span>
                    <span className="text-lg font-black text-slate-700 dark:text-slate-300">
                        Sin consenso
                    </span>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                    Los modelos no coincidieron lo suficiente como para emitir un veredicto. Ver el
                    detalle por modelo.
                </p>
                {agreement !== null && (
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                        Acuerdo entre modelos: {Math.round(agreement)}%.
                    </p>
                )}
                {outlierModel !== null && candidateMedian !== null && outlierScore !== null && (
                    <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
                        <span>
                            El modelo <strong>{outlierModel}</strong> se desvió: puntuó{' '}
                            {outlierScore} frente a una mediana de candidatos de {candidateMedian}.
                        </span>
                    </p>
                )}
            </div>
        );
    }

    const score = verdictScore ?? 0;
    return (
        <div data-testid="veracidad" className="space-y-3">
            <div className="flex justify-between items-end">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    Veracidad
                </span>
                <span className={`text-3xl font-black leading-none ${scoreTextClass(score)}`}>
                    {verdictScore === null ? 'Sin dato' : `${Math.round(score)}%`}
                </span>
            </div>
            {verdictScore !== null && (
                <Progress
                    value={Math.round(score)}
                    className="h-3 bg-slate-100 dark:bg-slate-800"
                    indicatorClassName={scoreColor(Math.round(score))}
                />
            )}
        </div>
    );
}
