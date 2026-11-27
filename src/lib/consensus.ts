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

export interface ConsensusResult {
  averageVeracity: number | null;
  averageCoherence: number | null;
  verdictLabel: VerdictLabel | null;
  consensusAgreement: number | null;
  requiresReview: boolean;
  // true cuando hay menos reportes que el mínimo pero al menos uno con veredicto.
  partial: boolean;
  usedReports: ModelReport[];
  discardedReports: ModelReport[];
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

export function computeConsensus(reports: ModelReport[], minimumValid = 2): ConsensusResult {
  const usedReports: ModelReport[] = [];
  const discardedReports: ModelReport[] = [];

  for (const report of reports) {
    if (report.veracityScore === null || report.verdictLabel === null) continue;
    if (report.summary && justificationContradictsVerdict(report.verdictLabel, report.summary)) {
      discardedReports.push(report);
    } else {
      usedReports.push(report);
    }
  }

  if (usedReports.length < minimumValid) {
    // Con un único reporte válido no hay consenso, pero se conserva su veredicto
    // como preliminar para no perder la señal del modelo.
    const singleReport = usedReports.length === 1 ? usedReports[0] : null;
    const partialLabel = singleReport?.verdictLabel ?? null;
    return {
      averageVeracity: average(usedReports.map((r) => r.veracityScore as number)),
      averageCoherence: average(
        usedReports.filter((r) => r.coherenceScore !== null).map((r) => r.coherenceScore as number)
      ),
      verdictLabel: partialLabel,
      consensusAgreement: partialLabel ? 0 : null,
      requiresReview: true,
      partial: partialLabel !== null,
      usedReports,
      discardedReports,
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
  const requiresReview = majorityLabel === null || consensusAgreement < 60;

  return {
    averageVeracity: average(usedReports.map((r) => r.veracityScore as number)),
    averageCoherence: average(
      usedReports.filter((r) => r.coherenceScore !== null).map((r) => r.coherenceScore as number)
    ),
    verdictLabel: requiresReview ? null : majorityLabel,
    consensusAgreement,
    requiresReview,
    partial: false,
    usedReports,
    discardedReports,
  };
}
