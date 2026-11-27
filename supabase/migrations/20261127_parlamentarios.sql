-- Padrón oficial de parlamentarios. Se sincroniza desde los servicios públicos
-- del Senado y se conserva entre sincronizaciones: solo se hace upsert por
-- parl_id, nunca se borran filas.
CREATE TABLE IF NOT EXISTS "public"."parliamentarians" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "parl_id" TEXT UNIQUE NOT NULL,
  "camara" TEXT NOT NULL CHECK (camara IN ('senado','diputados')),
  "nombre" TEXT NOT NULL,
  "nombre_normalizado" TEXT NOT NULL,
  "apellido_paterno" TEXT,
  "apellido_materno" TEXT,
  "region" TEXT,
  "circunscripcion" TEXT,
  "partido" TEXT,
  "email" TEXT,
  "curriculum_url" TEXT,
  "politician_id" UUID REFERENCES "public"."politicians"(id) ON DELETE SET NULL,
  "match_confirmado" BOOLEAN NOT NULL DEFAULT false,
  "origen" TEXT NOT NULL DEFAULT 'senado_wspublico',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parliamentarians_norm
  ON "public"."parliamentarians" ("nombre_normalizado");

COMMENT ON TABLE "public"."parliamentarians" IS
  'Padrón oficial de parlamentarios. parl_id es el identificador del Senado y no debe inferirse del nombre. El vínculo con politicians se confirma manualmente: un mapeo erróneo atribuiría votos a otra persona.';
