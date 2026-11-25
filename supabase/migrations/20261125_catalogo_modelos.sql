-- =============================================================================
-- Catálogo de modelos IA — frontera desactivada + free faltante
-- Idempotente: puede aplicarse dos veces sin errores.
--
-- POLÍTICA DE PRODUCTO: los modelos de frontera existen pero NO se usan mientras
-- no haya presupuesto. Para activar un modelo de frontera basta con:
--   UPDATE ai_model_config SET is_active = true WHERE model_id = '...';
-- No hace falta tocar código.
-- =============================================================================

-- Modelos de frontera: is_active = false (solo se usan si se activan a mano).
INSERT INTO "public"."ai_model_config" (id, model_id, tier, fallback_id, is_active, context_window) VALUES
  ('00000000-0000-0000-0000-000000000011', 'anthropic/claude-sonnet-5.5',    'frontier', NULL, false, 200000),
  ('00000000-0000-0000-0000-000000000012', 'anthropic/claude-opus-5.5',      'frontier', NULL, false, 200000),
  ('00000000-0000-0000-0000-000000000013', 'openai/gpt-5.2-chat',            'frontier', NULL, false, 400000),
  ('00000000-0000-0000-0000-000000000014', 'google/gemini-3-flash-preview',  'frontier', NULL, false, 1000000),
  ('00000000-0000-0000-0000-000000000015', 'x-ai/grok-4.3',                  'frontier', NULL, false, 2000000)
ON CONFLICT (model_id) DO NOTHING;

-- Free que faltaba en el catálogo base: activo.
INSERT INTO "public"."ai_model_config" (id, model_id, tier, fallback_id, is_active, context_window) VALUES
  ('00000000-0000-0000-0000-000000000016', 'nvidia/nemotron-3-nano-30b-a3b:free', 'free', NULL, true, 1048576)
ON CONFLICT (model_id) DO NOTHING;
