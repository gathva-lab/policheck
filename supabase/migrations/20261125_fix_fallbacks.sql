-- =============================================================================
-- Reparación de fallbacks del catálogo de modelos
-- Idempotente: puede aplicarse varias veces sin errores.
--
-- Objetivo: que ningún fallback apunte a un modelo desactivado y que los free
-- caigan en los eco operativos baratos.
-- =============================================================================

-- 1. Nemotron Ultra → DeepSeek v4.1 Flash
UPDATE "public"."ai_model_config" AS m
SET fallback_id = f.id
FROM (
  SELECT id FROM "public"."ai_model_config"
  WHERE model_id = 'deepseek/deepseek-v4.1-flash'
) AS f
WHERE m.model_id = 'nvidia/nemotron-3-ultra-550b-a55b:free';

-- 2. Nemotron Lightning → Tencent Hy4 Flash
UPDATE "public"."ai_model_config" AS m
SET fallback_id = f.id
FROM (
  SELECT id FROM "public"."ai_model_config"
  WHERE model_id = 'tencent/hy4-flash'
) AS f
WHERE m.model_id = 'nvidia/nemotron-3.5-lightning:free';

-- 3. Gemma 4 31B → DeepSeek v4.1 Flash
UPDATE "public"."ai_model_config" AS m
SET fallback_id = f.id
FROM (
  SELECT id FROM "public"."ai_model_config"
  WHERE model_id = 'deepseek/deepseek-v4.1-flash'
) AS f
WHERE m.model_id = 'google/gemma-4-31b-it:free';

-- 4. Gemma 4 26B → Tencent Hy4 Flash
UPDATE "public"."ai_model_config" AS m
SET fallback_id = f.id
FROM (
  SELECT id FROM "public"."ai_model_config"
  WHERE model_id = 'tencent/hy4-flash'
) AS f
WHERE m.model_id = 'google/gemma-4-26b-a4b-it:free';

-- 5. Cualquier fallback que apunte a un modelo inactivo se deja en NULL.
UPDATE "public"."ai_model_config" AS m
SET fallback_id = NULL
FROM "public"."ai_model_config" AS f
WHERE m.fallback_id = f.id
  AND f.is_active = false;
