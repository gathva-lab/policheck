-- =============================================================================
-- Fase A — Esquema completo + nuevas entidades del pipeline de análisis IA
-- Idempotente: puede aplicarse dos veces sobre una BD ya poblada sin errores.
-- Tabla de referencia: _diseno-pipeline-ia.md (vault Policheck, 2026-08-14)
-- =============================================================================

-- =============================================================================
-- 1. ESQUEMA BASE (7 tablas del plan) — idempotente
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."politicians" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    political_party TEXT,
    position TEXT,
    bio TEXT,
    profile_image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "public"."sources" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    politician_id UUID REFERENCES "public"."politicians"(id) ON DELETE CASCADE,
    url TEXT UNIQUE NOT NULL,
    title TEXT,
    source_type TEXT DEFAULT 'articulo_noticia',
    status TEXT DEFAULT 'no_verificada',
    submitted_by UUID REFERENCES "auth"."users"(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "public"."ai_reports" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID REFERENCES "public"."sources"(id) ON DELETE CASCADE,
    model_name TEXT NOT NULL,
    report_json JSONB,
    summary TEXT,
    veracity_score DECIMAL(5,2),
    coherence_score DECIMAL(5,2),
    bias_analysis TEXT,
    key_claims JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "public"."source_votes" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID REFERENCES "public"."sources"(id) ON DELETE CASCADE,
    user_id UUID REFERENCES "auth"."users"(id) ON DELETE CASCADE,
    vote_type TEXT CHECK (vote_type IN ('Veraz', 'Dudoso', 'Falso')),
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT source_votes_user_source_unique UNIQUE (source_id, user_id)
);

CREATE TABLE IF NOT EXISTS "public"."topic_categories" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    color_hex VARCHAR(7),
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "public"."topics" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES "public"."topic_categories"(id),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "public"."topic_votes" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES "auth"."users"(id) ON DELETE CASCADE,
    topic_id UUID REFERENCES "public"."topics"(id) ON DELETE CASCADE,
    points_allocated INTEGER CHECK (points_allocated BETWEEN 1 AND 3),
    vote_period DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT topic_votes_user_topic_period_unique UNIQUE (user_id, topic_id, vote_period)
);

-- =============================================================================
-- 2. NUEVAS ENTIDADES
-- =============================================================================

-- Partidos políticos (visión ampliada de Alejandro)
CREATE TABLE IF NOT EXISTS "public"."parties" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    acronym TEXT UNIQUE,
    color_hex VARCHAR(7),
    logo_url TEXT,
    bio TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Medios de comunicación (para ranking de medios, Fase C)
CREATE TABLE IF NOT EXISTS "public"."media_outlets" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    country TEXT DEFAULT 'CL',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Reputación de usuario (peso del voto por historial, Fase B)
CREATE TABLE IF NOT EXISTS "public"."user_reputation" (
    user_id UUID PRIMARY KEY REFERENCES "auth"."users"(id) ON DELETE CASCADE,
    impact_score DECIMAL(8,3) DEFAULT 0,
    votes_cast INT DEFAULT 0,
    accuracy DECIMAL(5,4),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Configuración de modelos IA (triplete activo + capas free/eco/frontier)
CREATE TABLE IF NOT EXISTS "public"."ai_model_config" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id TEXT NOT NULL UNIQUE,
    tier TEXT CHECK (tier IN ('free', 'eco', 'frontier')) NOT NULL DEFAULT 'eco',
    fallback_id UUID REFERENCES "public"."ai_model_config"(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    context_window INT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Registro de costos por análisis (dashboard Fase D)
CREATE TABLE IF NOT EXISTS "public"."ai_cost_log" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID REFERENCES "public"."sources"(id) ON DELETE CASCADE,
    model_id TEXT,
    input_tokens INT,
    output_tokens INT,
    cost_usd DECIMAL(10,6),
    latency_ms INT,
    tier TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 3. ALTERS IDEMPOTENTES (columnas nuevas)
-- =============================================================================

-- politicians.party_id → parties.id (nullable)
ALTER TABLE "public"."politicians" ADD COLUMN IF NOT EXISTS "party_id" UUID REFERENCES "public"."parties"(id);

-- sources: media outlet + veredicto de la taxonomía 8 niveles + score 0-100
ALTER TABLE "public"."sources" ADD COLUMN IF NOT EXISTS "media_outlet_id" UUID REFERENCES "public"."media_outlets"(id);
ALTER TABLE "public"."sources" ADD COLUMN IF NOT EXISTS "verdict" TEXT CHECK (
    verdict IN ('verdadero','verdadero_pero','discutible','apresurado','exagerado','enganoso','insostenible','inchequeable','anejo')
);
ALTER TABLE "public"."sources" ADD COLUMN IF NOT EXISTS "verdict_score" DECIMAL(5,2);
ALTER TABLE "public"."sources" ADD COLUMN IF NOT EXISTS "consensus_agreement" DECIMAL(5,2);
ALTER TABLE "public"."sources" ADD COLUMN IF NOT EXISTS "requires_review" BOOLEAN DEFAULT false;

-- source_votes: peso por reputación + factor ideológico + período (bridging simplificado, Fase B)
ALTER TABLE "public"."source_votes" ADD COLUMN IF NOT EXISTS "weight" DECIMAL(5,3) DEFAULT 1;
ALTER TABLE "public"."source_votes" ADD COLUMN IF NOT EXISTS "ideo_factor" DECIMAL(5,3);
ALTER TABLE "public"."source_votes" ADD COLUMN IF NOT EXISTS "vote_period" DATE DEFAULT CURRENT_DATE;

-- =============================================================================
-- 4. ÍNDICES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_source_votes_period ON "public"."source_votes"(vote_period);
CREATE INDEX IF NOT EXISTS idx_ai_reports_source_id ON "public"."ai_reports"(source_id);
CREATE INDEX IF NOT EXISTS idx_ai_cost_log_source_id ON "public"."ai_cost_log"(source_id);
CREATE INDEX IF NOT EXISTS idx_ai_model_config_tier ON "public"."ai_model_config"(tier);
CREATE INDEX IF NOT EXISTS idx_sources_politician_id ON "public"."sources"(politician_id);
CREATE INDEX IF NOT EXISTS idx_sources_submitted_by ON "public"."sources"(submitted_by);

-- =============================================================================
-- 5. ROW LEVEL SECURITY
-- =============================================================================

-- Lectura pública para entidades públicas
ALTER TABLE "public"."politicians" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "politicians_select_public" ON "public"."politicians";
CREATE POLICY "politicians_select_public" ON "public"."politicians"
    FOR SELECT USING (true);

ALTER TABLE "public"."parties" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "parties_select_public" ON "public"."parties";
CREATE POLICY "parties_select_public" ON "public"."parties"
    FOR SELECT USING (true);

ALTER TABLE "public"."media_outlets" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "media_outlets_select_public" ON "public"."media_outlets";
CREATE POLICY "media_outlets_select_public" ON "public"."media_outlets"
    FOR SELECT USING (true);

ALTER TABLE "public"."ai_model_config" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_model_config_select_public" ON "public"."ai_model_config";
CREATE POLICY "ai_model_config_select_public" ON "public"."ai_model_config"
    FOR SELECT USING (true);

-- Escritura restringida (autenticados) en sources
ALTER TABLE "public"."sources" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sources_select_public" ON "public"."sources";
CREATE POLICY "sources_select_public" ON "public"."sources"
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "sources_insert_authenticated" ON "public"."sources";
CREATE POLICY "sources_insert_authenticated" ON "public"."sources"
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ai_reports: lectura pública (para mostrar el consenso)
ALTER TABLE "public"."ai_reports" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_reports_select_public" ON "public"."ai_reports";
CREATE POLICY "ai_reports_select_public" ON "public"."ai_reports"
    FOR SELECT USING (true);

-- user_reputation: solo lectura-propietario (Fase B)
ALTER TABLE "public"."user_reputation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_reputation_select_owner" ON "public"."user_reputation";
CREATE POLICY "user_reputation_select_owner" ON "public"."user_reputation"
    FOR SELECT USING (auth.uid() = user_id);

-- ai_cost_log: solo service_role (nunca expuesto al cliente)
ALTER TABLE "public"."ai_cost_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_cost_log_service_role_only" ON "public"."ai_cost_log";
CREATE POLICY "ai_cost_log_service_role_only" ON "public"."ai_cost_log"
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- source_votes / topics / topic_categories / topic_votes: RLS para Fase B (básico)
ALTER TABLE "public"."source_votes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "source_votes_select_public" ON "public"."source_votes";
CREATE POLICY "source_votes_select_public" ON "public"."source_votes"
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "source_votes_insert_authenticated" ON "public"."source_votes";
CREATE POLICY "source_votes_insert_authenticated" ON "public"."source_votes"
    FOR INSERT WITH CHECK (auth.uid() = user_id);

ALTER TABLE "public"."topic_categories" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "topic_categories_select_public" ON "public"."topic_categories";
CREATE POLICY "topic_categories_select_public" ON "public"."topic_categories"
    FOR SELECT USING (true);

ALTER TABLE "public"."topics" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "topics_select_public" ON "public"."topics";
CREATE POLICY "topics_select_public" ON "public"."topics"
    FOR SELECT USING (true);

-- =============================================================================
-- 6. SEED DE MODELOS IA (triplete + capas free/eco; idempotente)
-- El pipeline /api/analyze lee el triplete activo de ai_model_config (tier free
-- primero, con fallback a la capa económica). Sin estos datos el análisis no
-- puede ejecutarse. Ver _diseno-pipeline-ia.md (vault Policheck, 2026-08-14).
-- =============================================================================

INSERT INTO "public"."ai_model_config" (id, model_id, tier, fallback_id, is_active, context_window) VALUES
  ('00000000-0000-0000-0000-000000000001', 'deepseek/deepseek-v3.2',            'eco',  NULL, true, 163840),
  ('00000000-0000-0000-0000-000000000002', 'qwen/qwen3-32b',                    'eco',  NULL, true, 32768),
  ('00000000-0000-0000-0000-000000000003', 'meta-llama/llama-3.3-70b-instruct', 'eco',  NULL, true, 131072)
ON CONFLICT (id) DO NOTHING;

INSERT INTO "public"."ai_model_config" (id, model_id, tier, fallback_id, is_active, context_window) VALUES
  ('00000000-0000-0000-0000-000000000004', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'free', '00000000-0000-0000-0000-000000000001', true, 1048576),
  ('00000000-0000-0000-0000-000000000005', 'nvidia/nemotron-3.5-lightning:free',     'free', '00000000-0000-0000-0000-000000000002', true, 1048576),
  ('00000000-0000-0000-0000-000000000006', 'google/gemma-4-31b-it:free',             'free', '00000000-0000-0000-0000-000000000003', true, 262144)
ON CONFLICT (id) DO NOTHING;
