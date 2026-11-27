-- La mayoría de modelos puede declarar que el contenido es opinión y forzar el
-- veredicto a inchequeable. Se guarda la marca para que la UI explique el motivo.
ALTER TABLE "public"."sources"
  ADD COLUMN IF NOT EXISTS "nature_override" BOOLEAN DEFAULT false;

-- El promedio se conserva aparte porque el verdict_score ahora es la mediana.
-- La diferencia entre ambos permite detectar la disidencia de un solo modelo.
ALTER TABLE "public"."sources"
  ADD COLUMN IF NOT EXISTS "mean_score" DECIMAL(5,2);

COMMENT ON COLUMN "public"."sources"."verdict_score" IS
  'Mediana de los puntajes de veracidad de los modelos; estadístico robusto ante un outlier.';

COMMENT ON COLUMN "public"."sources"."mean_score" IS
  'Promedio de los puntajes de veracidad no descartados; se usa para detectar disidencia frente a la mediana.';

COMMENT ON COLUMN "public"."sources"."nature_override" IS
  'true cuando la mayoría de los modelos clasificó el contenido como opinión y el veredicto se forzó a inchequeable.';
