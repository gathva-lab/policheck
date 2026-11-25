-- =============================================================================
-- Separar el acuerdo entre modelos del respaldo de JEV
-- Idempotente: puede aplicarse dos veces sobre una BD ya poblada sin errores.
--
-- `consensus_agreement` (0–100) = acuerdo ENTRE MODELOS sobre el veredicto.
-- `jev_support` (0–100)         = respaldo de JEV a la justificación del veredicto.
-- Son señales distintas: un consenso unánime puede tener un respaldo bajo de JEV
-- y viceversa. No deben mezclarse en una sola columna.
-- =============================================================================

ALTER TABLE "public"."sources" ADD COLUMN IF NOT EXISTS "jev_support" INTEGER;

COMMENT ON COLUMN "public"."sources"."consensus_agreement" IS
  'Acuerdo entre modelos (0-100). Señal distinta del respaldo de JEV.';

COMMENT ON COLUMN "public"."sources"."jev_support" IS
  'Respaldo de JEV a la justificación del veredicto (0-100). Señal distinta del acuerdo entre modelos.';
