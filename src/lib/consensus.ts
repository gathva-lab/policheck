import type { VerdictLabel } from './veracity';

export interface ReportQuote {
  text: string;
  assessment: string;
}

// Catálogo cerrado de falacias retóricas. Cualquier tipo fuera de esta lista se
// descarta al parsear para no romper el análisis.
export const FALLACY_TYPES = [
  'asociacion',
  'hombre_de_paja',
  'falsa_dicotomia',
  'apelacion_emocional',
  'generalizacion',
  'whataboutism',
  'cherry_picking',
] as const;

export type FallacyType = (typeof FALLACY_TYPES)[number];

export interface ReportFallacy {
  type: FallacyType;
  quote: string;
  explanation: string;
}

export type ContentNature = 'opinion' | 'mixto' | 'factual';

// Relación entre lo afirmado y el dato oficial. Catálogo cerrado: cualquier
// otro valor se descarta al parsear.
export const EXTERNAL_RELATIONS = ['coincide', 'difiere', 'no_comparable'] as const;

export type ExternalRelation = (typeof EXTERNAL_RELATIONS)[number];

export interface ReportExternalEvidence {
  claim: string;
  officialValue: string;
  source: string;
  relation: ExternalRelation;
  detail: string;
}

export interface ModelReport {
  modelName: string;
  verdictLabel: VerdictLabel | null;
  veracityScore: number | null;
  coherenceScore: number | null;
  summary: string | null;
  // Campos en lenguaje ciudadano. Pueden faltar en modelos antiguos o salidas
  // incompletas, por eso se toleran como null.
  plainVerdict: string | null;
  plainSummary: string | null;
  quotes: ReportQuote[] | null;
  fallacies: ReportFallacy[] | null;
  contentNature: ContentNature | null;
  // Contraste con fuentes oficiales (Banco Central). No afecta al veredicto ni
  // al veracity_score: es una señal independiente.
  externalEvidence: ReportExternalEvidence[] | null;
}

export type NatureOverrideReason = 'mayoria_opinion';

export interface ConsensusResult {
  // Mediana de los puntajes de los reportes con datos: es el verdict_score.
  verdictScore: number | null;
  // Promedio de los reportes no descartados, conservado para trazabilidad.
  meanScore: number | null;
  // Alias histórico de meanScore para consumidores antiguos.
  averageVeracity: number | null;
  averageCoherence: number | null;
  verdictLabel: VerdictLabel | null;
  consensusAgreement: number | null;
  requiresReview: boolean;
  // true cuando hay menos reportes que el mínimo pero al menos uno con veredicto.
  partial: boolean;
  // true cuando un modelo se aleja de la mediana más de lo razonable.
  outlierDetected: boolean;
  // Modelo cuyo puntaje está más lejos de la mediana (null si no hay outlier).
  outlierModel: string | null;
  // La mayoría de los modelos clasificó el contenido como opinión y se forzó
  // el veredicto a inchequeable, limitando el puntaje a la franja 0-4.
  natureOverride: boolean;
  natureOverrideReason: NatureOverrideReason | null;
  usedReports: ModelReport[];
  discardedReports: ModelReport[];
  // Motivo del descarte por nombre de modelo, para trazabilidad y UI.
  discardReasons: Record<string, string>;
}

const POSITIVE_KEYWORDS = [
  'verdadero',
  'veraz',
  'verdad',
  'correcto',
  'cierto',
  'acertado',
  'confirmado',
  'preciso',
  'exacto',
  'real',
  'avalado',
];

const NEGATIVE_KEYWORDS = [
  'falso',
  'falsedad',
  'falsific',
  'mentira',
  'mentiroso',
  'engano',
  'enganoso',
  'erroneo',
  'inexacto',
  'insostenible',
  'desmentid',
  'fake',
  'falacia',
  'manipulado',
];

const POSITIVE_LABELS: VerdictLabel[] = ['verdadero', 'verdadero_pero'];
const NEGATIVE_LABELS: VerdictLabel[] = ['apresurado', 'exagerado', 'enganoso', 'insostenible'];

function containsKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

export function justificationContradictsVerdict(label: VerdictLabel, summary: string): boolean {
  if (!summary) return false;
  if (POSITIVE_LABELS.includes(label)) return containsKeyword(summary, NEGATIVE_KEYWORDS);
  if (NEGATIVE_LABELS.includes(label)) return containsKeyword(summary, POSITIVE_KEYWORDS);
  return false;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((acc, v) => acc + v, 0) / values.length) * 100) / 100;
}

// Mediana robusta: con longitud par interpola los dos valores centrales. Es el
// estadístico correcto para 3 reportes porque un solo disidente no la arrastra.
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  return Math.round(value * 100) / 100;
}

// Naturaleza con mayoría estricta sobre el total de reportes. Un reporte sin
// naturaleza cuenta en el denominador: así 1 de 3 no alcanza la mayoría.
export function dominantContentNature(reports: ModelReport[]): ContentNature | null {
  if (reports.length === 0) return null;
  const counts: Record<ContentNature, number> = { opinion: 0, mixto: 0, factual: 0 };
  for (const report of reports) {
    if (report.contentNature) counts[report.contentNature] += 1;
  }
  for (const nature of ['opinion', 'mixto', 'factual'] as const) {
    if (counts[nature] * 2 > reports.length) return nature;
  }
  return null;
}

interface ConsensusStats {
  verdictScore: number | null;
  meanScore: number | null;
  outlierDetected: boolean;
  outlierModel: string | null;
}

// La mediana se calcula sobre todos los reportes con puntaje para que un
// disidente descartado no oculte la señal de outlier. El promedio usa solo los
// reportes que entran al consenso.
function computeStats(candidateReports: ModelReport[], usedReports: ModelReport[]): ConsensusStats {
  const candidateScores = candidateReports.map((report) => report.veracityScore as number);
  const usedScores = usedReports.map((report) => report.veracityScore as number);
  const verdictScore = candidateScores.length > 0 ? median(candidateScores) : null;
  const meanScore = average(usedScores);
  const candidateMean = average(candidateScores);

  let outlierDetected = false;
  let outlierModel: string | null = null;
  if (verdictScore !== null) {
    let maxDistance = 0;
    let farthestModel: string | null = null;
    for (const report of candidateReports) {
      const distance = Math.abs((report.veracityScore as number) - verdictScore);
      if (distance > maxDistance) {
        maxDistance = distance;
        farthestModel = report.modelName;
      }
    }
    const divergence =
      candidateMean !== null ? Math.abs(verdictScore - candidateMean) : 0;
    outlierDetected = divergence > 25 || maxDistance > 25;
    if (outlierDetected) outlierModel = farthestModel;
  }

  return { verdictScore, meanScore, outlierDetected, outlierModel };
}

function clampToInchequeable(score: number | null): number | null {
  if (score === null) return null;
  return Math.round(Math.min(4, Math.max(0, score)) * 100) / 100;
}

// Coherencia interna: la naturaleza del contenido debe ser compatible con el
// puntaje y con la etiqueta del veredicto. Devuelve el motivo del descarte o null.
export function detectInternalInconsistency(report: ModelReport): string | null {
  const score = report.veracityScore;
  if (score === null) return null;

  if (report.contentNature === 'mixto' && score < 10) {
    return 'mixto_con_score_inchequeable';
  }
  if (report.contentNature === 'factual' && score < 15) {
    return 'factual_con_score_bajo';
  }
  // Si el propio modelo declaró que el contenido es opinión, un puntaje de 40
  // o más implica que está evaluando afirmaciones que él mismo consideró no
  // verificables. El umbral anterior (75) dejaba pasar casos como opinión + 65.
  if (report.contentNature === 'opinion' && score > 40) {
    return 'opinion_con_score_alto';
  }
  if (
    report.contentNature === 'opinion' &&
    (report.verdictLabel === 'verdadero' || report.verdictLabel === 'verdadero_pero')
  ) {
    return 'opinion_con_veredicto_positivo';
  }
  return null;
}

export function computeConsensus(reports: ModelReport[], minimumValid = 2): ConsensusResult {
  const usedReports: ModelReport[] = [];
  const discardedReports: ModelReport[] = [];
  const discardReasons: Record<string, string> = {};

  const candidates = reports.filter(
    (report) => report.veracityScore !== null && report.verdictLabel !== null
  );
  const inconsistencies = new Map<ModelReport, string>();
  for (const report of candidates) {
    const reason = detectInternalInconsistency(report);
    if (reason) inconsistencies.set(report, reason);
  }
  // Si todos los reportes válidos son incoherentes, no se descarta ninguno:
  // es preferible un consenso imperfecto a quedarse sin ninguna señal.
  const allInconsistent =
    candidates.length > 0 && candidates.every((report) => inconsistencies.has(report));

  for (const report of candidates) {
    if (allInconsistent) {
      usedReports.push(report);
      continue;
    }
    const inconsistency = inconsistencies.get(report);
    if (inconsistency) {
      discardedReports.push(report);
      discardReasons[report.modelName] = inconsistency;
      console.warn(
        `[consensus] Reporte descartado (${report.modelName}): ${inconsistency}`
      );
      continue;
    }
    if (
      report.summary &&
      report.verdictLabel &&
      justificationContradictsVerdict(report.verdictLabel, report.summary)
    ) {
      const reason = 'justificacion_contradice_veredicto';
      discardedReports.push(report);
      discardReasons[report.modelName] = reason;
      console.warn(`[consensus] Reporte descartado (${report.modelName}): ${reason}`);
      continue;
    }
    usedReports.push(report);
  }

  const stats = computeStats(candidates, usedReports);
  const dominantNature = dominantContentNature(usedReports);
  const natureOverride = dominantNature === 'opinion';
  const natureOverrideReason: NatureOverrideReason | null = natureOverride
    ? 'mayoria_opinion'
    : null;
  const verdictScore = natureOverride
    ? clampToInchequeable(stats.verdictScore)
    : stats.verdictScore;
  const averageCoherence = average(
    usedReports.filter((r) => r.coherenceScore !== null).map((r) => r.coherenceScore as number)
  );

  if (usedReports.length < minimumValid) {
    // Con un único reporte válido no hay consenso, pero se conserva su veredicto
    // como preliminar para no perder la señal del modelo.
    const singleReport = usedReports.length === 1 ? usedReports[0] : null;
    const partialLabel = singleReport?.verdictLabel ?? null;
    return {
      verdictScore,
      meanScore: stats.meanScore,
      averageVeracity: stats.meanScore,
      averageCoherence,
      verdictLabel: natureOverride ? 'inchequeable' : partialLabel,
      consensusAgreement: partialLabel ? 0 : null,
      requiresReview: true,
      partial: partialLabel !== null,
      outlierDetected: stats.outlierDetected,
      outlierModel: stats.outlierModel,
      natureOverride,
      natureOverrideReason,
      usedReports,
      discardedReports,
      discardReasons,
    };
  }

  const counts = new Map<VerdictLabel, number>();
  for (const report of usedReports) {
    if (!report.verdictLabel) continue;
    counts.set(report.verdictLabel, (counts.get(report.verdictLabel) ?? 0) + 1);
  }

  let majorityLabel: VerdictLabel | null = null;
  let maxCount = 0;
  for (const [label, count] of counts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      majorityLabel = label;
    }
  }

  const consensusAgreement = majorityLabel ? Math.round((maxCount / usedReports.length) * 100) : 0;
  const requiresReview = allInconsistent || majorityLabel === null || consensusAgreement < 60;
  // La naturaleza dominante solo puede endurecer el veredicto: si la mayoría
  // declaró opinión, no hay afirmaciones verificables que puntuar.
  const verdictLabel = natureOverride ? 'inchequeable' : requiresReview ? null : majorityLabel;

  return {
    verdictScore,
    meanScore: stats.meanScore,
    averageVeracity: stats.meanScore,
    averageCoherence,
    verdictLabel,
    consensusAgreement,
    requiresReview,
    partial: false,
    outlierDetected: stats.outlierDetected,
    outlierModel: stats.outlierModel,
    natureOverride,
    natureOverrideReason,
    usedReports,
    discardedReports,
    discardReasons,
  };
}
