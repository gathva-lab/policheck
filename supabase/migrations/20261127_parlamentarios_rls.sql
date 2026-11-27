-- El padrón es información pública: lectura abierta, escritura solo por servicio.
ALTER TABLE "public"."parliamentarians" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parliamentarians_select_public" ON "public"."parliamentarians";
CREATE POLICY "parliamentarians_select_public" ON "public"."parliamentarians"
  FOR SELECT USING (true);

COMMENT ON POLICY "parliamentarians_select_public" ON "public"."parliamentarians" IS
  'El padrón de parlamentarios es información pública: lectura anónima permitida. La escritura queda restringida a la clave de servicio (los endpoints de mantenimiento).';
