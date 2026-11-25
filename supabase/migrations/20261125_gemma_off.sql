-- =============================================================================
-- Gemma fuera del catálogo de modelos
-- Idempotente: puede aplicarse varias veces sin errores.
--
-- Evidencia: el models-check del 2026-11-25 en producción devolvió 429
-- (rate limit crónico) para google/gemma-4-31b-it:free (193 ms) y
-- google/gemma-4-26b-a4b-it:free (219 ms), mientras los modelos eco y los
-- Nemotron :free respondían 200. Se desactivan ambos Gemma.
-- =============================================================================

-- 1. Desactivar los dos modelos Gemma que fallan por rate limit.
UPDATE "public"."ai_model_config"
SET is_active = false
WHERE model_id IN (
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free'
);

-- 2. Limpiar cualquier fallback que apunte a un Gemma desactivado.
UPDATE "public"."ai_model_config" AS m
SET fallback_id = NULL
FROM "public"."ai_model_config" AS f
WHERE m.fallback_id = f.id
  AND f.model_id IN (
    'google/gemma-4-31b-it:free',
    'google/gemma-4-26b-a4b-it:free'
  );
