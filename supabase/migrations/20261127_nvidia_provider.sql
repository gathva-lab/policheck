-- =============================================================================
-- Proveedor NVIDIA Build + coherencia interna de reportes
-- Idempotente: puede aplicarse dos veces sin errores.
--
-- Datos reales de models-stats (30 días) que justifican mover Nemotron a NVIDIA:
--   typesafe/jev-1.14                        22 llamadas · 100% éxito · 601 ms
--   deepseek/deepseek-v4.1-flash             10 llamadas ·  90% éxito · 2 750 ms
--   tencent/hy4-flash                        10 llamadas ·  80% éxito · 9 939 ms
--   nvidia/nemotron-3-ultra-550b-a55b:free    9 llamadas · 55,6% éxito · 26 695 ms
--   qwen/qwen3-32b                            2 llamadas ·  50% éxito · 1 506 ms
--
-- Nemotron falla 1 de cada 2 veces y tarda 26,7 s de media: es la cola de los
-- modelos :free de OpenRouter, no la demanda del modelo. NVIDIA Build sirve los
-- mismos modelos sin ese coste ni esa cola.
-- =============================================================================

-- 1. Proveedor por modelo y por llamada.
ALTER TABLE "public"."ai_model_config"
ADD COLUMN IF NOT EXISTS "provider" TEXT DEFAULT 'openrouter';

ALTER TABLE "public"."ai_cost_log"
ADD COLUMN IF NOT EXISTS "provider" TEXT DEFAULT 'openrouter';

-- 2. Los dos Nemotron pasan a servirse desde NVIDIA (mismos modelos que ya
-- estaban configurados en OpenRouter con sufijo :free).
UPDATE "public"."ai_model_config"
SET provider = 'nvidia'
WHERE model_id IN (
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3.5-lightning:free'
);

-- 3. Free de reserva con prioridad 60: no desplazan a los eco operativos.
-- minimax y glm estaban de pago en OpenRouter y son gratuitos en NVIDIA.
INSERT INTO "public"."ai_model_config"
  (id, model_id, tier, is_active, priority, provider, context_window)
VALUES
  ('20261127-0000-4000-8000-00000000001a', 'minimaxai/minimax-m3.1-flash', 'free', true, 60, 'nvidia', 1048576),
  ('20261127-0000-4000-8000-00000000001b', 'z-ai/glm-5.3-flash', 'free', true, 60, 'nvidia', 262144)
ON CONFLICT (model_id) DO NOTHING;
