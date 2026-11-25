-- =============================================================================
-- Catálogo final de modelos + prioridad de elección + diagnóstico de fallos
-- Idempotente: puede aplicarse dos veces sin errores.
--
-- Objetivo:
--   1. Dejar un solo DeepSeek eco activo (deepseek-v4.1-flash).
--   2. Hacer determinista la elección del triplete con una prioridad explícita.
--   3. Registrar el motivo por el que un modelo no produjo reporte.
-- =============================================================================

-- 1. DeepSeek heredado: se desactiva para que no compita con v4.1-flash.
UPDATE "public"."ai_model_config"
SET is_active = false
WHERE model_id = 'deepseek/deepseek-v3.2';

-- 2. Prioridad explícita: menor número se elige antes.
ALTER TABLE "public"."ai_model_config"
ADD COLUMN IF NOT EXISTS "priority" INTEGER DEFAULT 100;

-- Eco operativos prioritarios.
UPDATE "public"."ai_model_config"
SET priority = 10
WHERE model_id IN ('deepseek/deepseek-v4.1-flash', 'tencent/hy4-flash');

-- Los free van después de los eco operativos, pero antes del resto.
UPDATE "public"."ai_model_config"
SET priority = 50
WHERE tier = 'free';

-- 3. Motivo de fallo por modelo (timeout, parse_failed, http_error, empty).
ALTER TABLE "public"."ai_cost_log"
ADD COLUMN IF NOT EXISTS "error_reason" TEXT;
