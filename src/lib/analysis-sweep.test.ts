import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sweepStuckSources, STUCK_ANALYSIS_AFTER_MS } from './analysis-sweep';

const NOW = new Date('2026-11-25T12:00:00.000Z').getTime();

interface UpdateCall {
  values: Record<string, unknown>;
  ids: string[];
}

function makeAdmin(candidateIds: string[], reportedIds: string[]) {
  const updates: UpdateCall[] = [];

  const admin = {
    from(table: string) {
      if (table === 'sources') {
        return {
          select: () => ({
            in: () => ({
              lt: (_column: string, cutoff: string) => {
                expect(cutoff).toBe(new Date(NOW - STUCK_ANALYSIS_AFTER_MS).toISOString());
                return Promise.resolve({ data: candidateIds.map((id) => ({ id })), error: null });
              },
            }),
          }),
          update: (values: Record<string, unknown>) => ({
            in: (_column: string, ids: string[]) => {
              updates.push({ values, ids });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'ai_reports') {
        return {
          select: () => ({
            in: (_column: string, ids: string[]) => {
              expect(ids).toEqual(candidateIds);
              return {
                is: (_column2: string, value: null) => {
                  expect(value).toBeNull();
                  return Promise.resolve({
                    data: reportedIds.map((id) => ({ source_id: id })),
                    error: null,
                  });
                },
              };
            },
          }),
        };
      }
      throw new Error(`tabla no esperada: ${table}`);
    },
  };

  return { admin: admin as unknown as SupabaseClient, updates };
}

describe('sweepStuckSources', () => {
  it('recupera una fuente de hace 10 minutos en procesando sin reportes', async () => {
    const { admin, updates } = makeAdmin(['vieja'], []);

    const recovered = await sweepStuckSources(admin, NOW);

    expect(recovered).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].ids).toEqual(['vieja']);
    expect(updates[0].values).toMatchObject({
      status: 'requiere_revision',
      requires_review: true,
    });
  });

  it('no recupera fuentes que ya tienen ai_reports', async () => {
    const { admin, updates } = makeAdmin(['con-reportes'], ['con-reportes']);

    const recovered = await sweepStuckSources(admin, NOW);

    expect(recovered).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
