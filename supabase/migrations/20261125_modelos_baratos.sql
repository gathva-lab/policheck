-- =============================================================================
-- Catálogo de modelos baratos — free + eco operativos
-- Idempotente: puede aplicarse dos veces sin errores y no toca datos de usuario.
--
-- Objetivo: bajar el costo por análisis usando un free y dos eco baratos,
-- desactivando los eco caros heredados que pickTriplet podría elegir.
-- =============================================================================

-- Modelo inexistente en OpenRouter (lo añadió la migración del PR #9): se elimina.
DELETE FROM "public"."ai_model_config"
WHERE model_id = 'nvidia/nemotron-3-nano-30b-a3b:free';

-- Eco caro heredado: se desactiva para que pickTriplet no lo elija.
UPDATE "public"."ai_model_config"
SET is_active = false
WHERE model_id = 'meta-llama/llama-3.3-70b-instruct';

-- Eco baratos nuevos: activos.
INSERT INTO "public"."ai_model_config" (id, model_id, tier, fallback_id, is_active, context_window) VALUES
  ('00000000-0000-0000-0000-000000000017', 'deepseek/deepseek-v4.1-flash', 'eco', NULL, true, 1048576),
  ('00000000-0000-0000-0000-000000000018', 'tencent/hy4-flash',            'eco', NULL, true, 1048576)
ON CONFLICT (model_id) DO NOTHING;

-- Free nuevo que sustituye al modelo inexistente: activo.
INSERT INTO "public"."ai_model_config" (id, model_id, tier, fallback_id, is_active, context_window) VALUES
  ('00000000-0000-0000-0000-000000000019', 'google/gemma-4-26b-a4b-it:free', 'free', NULL, true, 262144)
ON CONFLICT (model_id) DO NOTHING;
