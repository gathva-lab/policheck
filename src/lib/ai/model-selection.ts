export interface ModelConfigLike {
  id: string;
  model_id: string;
  tier: string;
  is_active: boolean;
  fallback_id?: string | null;
  context_window?: number | null;
}

const ECO_FAMILIES = ['deepseek', 'qwen', 'llama'] as const;

function familyOf(modelId: string): string {
  const lower = modelId.toLowerCase();
  for (const family of ECO_FAMILIES) {
    if (lower.includes(family)) return family;
  }
  return lower.split('/')[0] ?? lower;
}

/**
 * Compone el triplete de modelos del análisis.
 *
 * Política de producto: los modelos operativos son free + eco. Garantiza 1 free,
 * completa con eco prefiriendo familias distintas y usa frontier solo como último
 * recurso. Nunca devuelve más de 3 modelos.
 */
export function pickTriplet<T extends ModelConfigLike>(configs: T[]): T[] {
  const active = configs.filter((config) => config.is_active);
  const free = active.filter((config) => config.tier === 'free');
  const eco = active.filter((config) => config.tier === 'eco');
  const frontier = active.filter((config) => config.tier === 'frontier');

  const selected: T[] = [];
  const usedIds = new Set<string>();
  const usedFamilies = new Set<string>();

  const add = (config: T) => {
    if (selected.length >= 3 || usedIds.has(config.id)) return;
    selected.push(config);
    usedIds.add(config.id);
    usedFamilies.add(familyOf(config.model_id));
  };

  // 1. Garantizar un modelo free si existe.
  if (free.length > 0) add(free[0]);

  // 2. Completar con eco, primero familias distintas (deepseek, qwen, llama).
  for (const config of eco) {
    if (selected.length >= 3) break;
    if (!usedFamilies.has(familyOf(config.model_id))) add(config);
  }
  for (const config of eco) {
    if (selected.length >= 3) break;
    add(config);
  }

  // 3. Free restantes antes de frontera: cubre el caso en que solo hay free.
  for (const config of free) {
    if (selected.length >= 3) break;
    add(config);
  }

  // 4. Frontera solo si free + eco no alcanzan para 3 modelos.
  for (const config of frontier) {
    if (selected.length >= 3) break;
    add(config);
  }

  return selected;
}
