-- =============================================================================
-- Diagnóstico de finish_reason en las llamadas a modelos
-- Idempotente: puede aplicarse dos veces sin errores.
--
-- `finish_reason = 'length'` con `content` vacío indica que el presupuesto de
-- salida (max_tokens) se agotó razonando antes de emitir respuesta. En ese caso
-- el error_reason registrado es `empty_por_limite`, distinto de un vacío sin
-- causa conocida.
-- =============================================================================

ALTER TABLE "public"."ai_cost_log"
ADD COLUMN IF NOT EXISTS "finish_reason" TEXT;

COMMENT ON COLUMN "public"."ai_cost_log"."finish_reason" IS
  'Motivo de término del proveedor (choices[0].finish_reason). length con content vacío indica presupuesto de razonamiento agotado (empty_por_limite).';
