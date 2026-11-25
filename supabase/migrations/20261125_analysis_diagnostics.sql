-- =============================================================================
-- Diagnóstico del pipeline de análisis
-- Idempotente: puede aplicarse dos veces sobre una BD ya poblada sin errores.
-- Permite saber en qué etapa quedó (o falló) cada fuente y recuperar las que
-- quedaron colgadas por la muerte del isolate de Cloudflare.
-- =============================================================================

ALTER TABLE "public"."sources" ADD COLUMN IF NOT EXISTS "analysis_stage" TEXT;
ALTER TABLE "public"."sources" ADD COLUMN IF NOT EXISTS "analysis_started_at" TIMESTAMPTZ;
ALTER TABLE "public"."sources" ADD COLUMN IF NOT EXISTS "analysis_finished_at" TIMESTAMPTZ;
ALTER TABLE "public"."sources" ADD COLUMN IF NOT EXISTS "analysis_error" TEXT;

CREATE INDEX IF NOT EXISTS idx_sources_analysis_started_at ON "public"."sources"(analysis_started_at);
CREATE INDEX IF NOT EXISTS idx_sources_analysis_status ON "public"."sources"(status, analysis_started_at);
