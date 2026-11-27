// Detección de inestabilidad entre dos corridas del mismo contenido. Un modelo
// que cambia mucho su veracidad, o su clasificación de naturaleza, explica que
// el resultado global oscile aunque la transcripción sea idéntica.
import type { ContentNature } from './consensus';

// Umbral de diferencia de veracidad que considera inestable a un modelo.
export const UNSTABLE_VERACITY_DELTA = 30;

export interface StabilityReport {
  modelName: string;
  veracityScore: number | null;
  contentNature: ContentNature | null;
}

export type UnstableReason = 'veracity_delta' | 'content_nature_changed';

export interface UnstableModel {
  modelName: string;
  previousVeracity: number | null;
  currentVeracity: number | null;
  // Diferencia absoluta; null si a alguna corrida le faltó el puntaje.
  veracityDelta: number | null;
  previousNature: ContentNature | null;
  currentNature: ContentNature | null;
  natureChanged: boolean;
  reasons: UnstableReason[];
}

// Compara la corrida actual contra la anterior y devuelve solo los modelos
// presentes en ambas que se desviaron lo suficiente como para auditar el caso.
export function detectUnstableModels(
  current: StabilityReport[],
  previous: StabilityReport[]
): UnstableModel[] {
  const previousByName = new Map(previous.map((report) => [report.modelName, report]));
  const unstable: UnstableModel[] = [];

  for (const report of current) {
    const before = previousByName.get(report.modelName);
    if (!before) continue;

    const veracityDelta =
      report.veracityScore !== null && before.veracityScore !== null
        ? Math.abs(report.veracityScore - before.veracityScore)
        : null;
    const natureChanged = report.contentNature !== before.contentNature;

    const reasons: UnstableReason[] = [];
    if (veracityDelta !== null && veracityDelta >= UNSTABLE_VERACITY_DELTA) {
      reasons.push('veracity_delta');
    }
    if (natureChanged) reasons.push('content_nature_changed');
    if (reasons.length === 0) continue;

    unstable.push({
      modelName: report.modelName,
      previousVeracity: before.veracityScore,
      currentVeracity: report.veracityScore,
      veracityDelta,
      previousNature: before.contentNature,
      currentNature: report.contentNature,
      natureChanged,
      reasons,
    });
  }

  return unstable;
}
