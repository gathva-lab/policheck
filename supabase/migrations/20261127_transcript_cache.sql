-- =============================================================================
-- Caché de la transcripción en la propia fuente
-- Idempotente: puede aplicarse dos veces sin errores.
--
-- La transcripción es el dato más caro de obtener: pedirla de nuevo en cada
-- re-análisis expone al Worker a los límites de YouTube por IP compartida.
-- Se guarda completa para reutilizarla sin volver a consultar el video.
-- =============================================================================

ALTER TABLE "public"."sources"
  ADD COLUMN IF NOT EXISTS "transcript_text" TEXT,
  ADD COLUMN IF NOT EXISTS "transcript_method" TEXT,
  ADD COLUMN IF NOT EXISTS "transcript_words" INTEGER,
  ADD COLUMN IF NOT EXISTS "transcript_fetched_at" TIMESTAMPTZ;

COMMENT ON COLUMN "public"."sources"."transcript_text" IS
  'Transcripción completa ya extraída. Se reutiliza en los re-análisis para no volver a pedirla a YouTube.';

COMMENT ON COLUMN "public"."sources"."transcript_method" IS
  'Método que funcionó: youtube-transcript | caption-tracks | retry | description.';

COMMENT ON COLUMN "public"."sources"."transcript_words" IS
  'Cantidad de palabras de la transcripción guardada, calculada por espacios.';

COMMENT ON COLUMN "public"."sources"."transcript_fetched_at" IS
  'Momento en que se obtuvo y guardó la transcripción por última vez.';
