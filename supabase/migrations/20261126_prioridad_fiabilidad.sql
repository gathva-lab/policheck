-- =============================================================================
-- Prioridad de modelos según fiabilidad medida
-- Idempotente: puede aplicarse dos veces sin errores.
--
-- Datos del caso de control (4 corridas sobre la misma fuente):
--   deepseek/deepseek-v4.1-flash          4 éxitos, 0 timeouts
--   tencent/hy4-flash                     3 éxitos, 1 timeout
--   qwen/qwen3-32b                        0 éxitos, 2 timeouts en fuentes largas
--   nvidia/nemotron-3-ultra-550b-a55b:free 2 éxitos, 2 timeouts
--
-- Objetivo: elegir primero el modelo más fiable (menor priority) y dejar los
-- free al final. qwen sigue disponible para fuentes cortas, pero no compite por
-- delante de los modelos con mejor tasa de éxito.
-- =============================================================================

ALTER TABLE "public"."ai_model_config"
ADD COLUMN IF NOT EXISTS "priority" INTEGER DEFAULT 100;

UPDATE "public"."ai_model_config"
SET priority = 5
WHERE model_id = 'deepseek/deepseek-v4.1-flash';

UPDATE "public"."ai_model_config"
SET priority = 15
WHERE model_id = 'tencent/hy4-flash';

UPDATE "public"."ai_model_config"
SET priority = 25
WHERE model_id = 'qwen/qwen3-32b';

-- Los free (nemotron y similares) se mantienen al final.
UPDATE "public"."ai_model_config"
SET priority = 50
WHERE tier = 'free';
