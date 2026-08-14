import type { VerdictLabel } from './veracity';

export interface ModelReport {
  modelName: string;
  verdictLabel: VerdictLabel | null;
  veracityScore: number | null;
  coherenceScore: number | null;
  summary: string | null;
}

export interface ConsensusResult {
  averageVeracity: number | null;
  averageCoherence: number | null;
  verdictLabel: VerdictLabel | null;
  consensusAgreement: number | null;
  requiresReview: boolean;
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
    return {
      averageVeracity: average(usedReports.map((r) => r.veracityScore as number)),
      averageCoherence: average(
        usedReports.filter((r) => r.coherenceScore !== null).map((r) => r.coherenceScore as number)
      ),
      verdictLabel: null,
      consensusAgreement: null,
      requiresReview: true,
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
    usedReports,
    discardedReports,
  };
}
