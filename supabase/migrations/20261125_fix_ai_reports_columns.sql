-- =============================================================================
-- Corrección — columnas faltantes en ai_reports
-- Idempotente: puede aplicarse dos veces sin errores.
-- La migración de Fase A usó CREATE TABLE IF NOT EXISTS y la tabla ya existía
-- desde marzo 2026, por lo que estas columnas nunca se crearon y los INSERT
-- fallaban con PGRST204. Verificado contra la BD real en 2026-11-25.
-- =============================================================================

ALTER TABLE "public"."ai_reports" ADD COLUMN IF NOT EXISTS "coherence_score" DECIMAL(5,2);
ALTER TABLE "public"."ai_reports" ADD COLUMN IF NOT EXISTS "bias_analysis" TEXT;
ALTER TABLE "public"."ai_reports" ADD COLUMN IF NOT EXISTS "key_claims" JSONB;
