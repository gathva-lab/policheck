-- =============================================================================
-- Estabilidad del consenso entre corridas
-- Idempotente: puede aplicarse más de una vez sobre una BD ya poblada.
--
-- verdict_score pasa a ser la mediana de los reportes usados. La mediana de
-- todos los candidatos se guarda aparte solo como diagnóstico de outlier.
-- Los reportes antiguos no se borran: se marcan con superseded_at para poder
-- comparar la corrida actual con la anterior y auditar modelos inestables.
-- =============================================================================

ALTER TABLE "public"."ai_reports"
  ADD COLUMN IF NOT EXISTS "superseded_at" TIMESTAMPTZ;

ALTER TABLE "public"."sources"
  ADD COLUMN IF NOT EXISTS "model_variance" JSONB;

ALTER TABLE "public"."sources"
  ADD COLUMN IF NOT EXISTS "candidate_median_score" DECIMAL(5,2);

COMMENT ON COLUMN "public"."ai_reports"."superseded_at" IS
  'Momento en que el reporte dejó de ser el vigente por un re-análisis. NULL en la corrida actual.';

COMMENT ON COLUMN "public"."sources"."verdict_score" IS
  'Mediana de los puntajes de veracidad de los reportes usados (no descartados).';

COMMENT ON COLUMN "public"."sources"."candidate_median_score" IS
  'Mediana de todos los candidatos, incluidos los descartados. Solo diagnóstico de outlier: no se muestra como veracidad.';

COMMENT ON COLUMN "public"."sources"."model_variance" IS
  'Modelos que cambiaron su veracidad en 30 puntos o más, o su content_nature, entre la corrida actual y la anterior.';

-- Las consultas vigentes leen solo los reportes actuales de una fuente.
CREATE INDEX IF NOT EXISTS idx_ai_reports_current
  ON "public"."ai_reports" (source_id)
  WHERE superseded_at IS NULL;
