-- ═══════════════════════════════════════════════════════════════════════════
-- AI Registry Schema — Centralized AI System Classification & Audit Logging
-- Zero-Retention Architecture: audit_log has NO columns for prompt/response text.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS ai_registry;

DO $$ BEGIN
  CREATE TYPE ai_registry.risk_tier AS ENUM ('minimal','limited','high','unacceptable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ai_registry.data_sensitivity AS ENUM ('public','internal','confidential','restricted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ai_registry.system_status AS ENUM ('active','suspended','retired','under_review');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Table 1: AI Systems Registry ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_registry.ai_systems (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_name       VARCHAR(255) NOT NULL,
  description       TEXT,
  risk_tier         ai_registry.risk_tier NOT NULL DEFAULT 'limited',
  data_sensitivity  ai_registry.data_sensitivity NOT NULL DEFAULT 'internal',
  business_owner    VARCHAR(255) NOT NULL,
  business_unit     VARCHAR(255),
  model_name        VARCHAR(100),
  litellm_team_id   VARCHAR(100),
  status            ai_registry.system_status NOT NULL DEFAULT 'under_review',
  approved_at       TIMESTAMPTZ,
  review_due_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_systems_risk_status
  ON ai_registry.ai_systems (risk_tier, status);
CREATE INDEX IF NOT EXISTS idx_ai_systems_team
  ON ai_registry.ai_systems (litellm_team_id);

-- ── Table 2: Metadata-Only Audit Log (ZERO TEXT RETENTION) ───────────────
CREATE TABLE IF NOT EXISTS ai_registry.audit_log (
  id                          BIGSERIAL PRIMARY KEY,
  request_id                  VARCHAR(100),
  ai_system_id                UUID REFERENCES ai_registry.ai_systems(id) ON DELETE SET NULL,
  litellm_team_id             VARCHAR(100),
  litellm_key_alias           VARCHAR(100),
  model_requested             VARCHAR(100),
  model_used                  VARCHAR(100),
  prompt_tokens               INTEGER DEFAULT 0,
  completion_tokens           INTEGER DEFAULT 0,
  total_tokens                INTEGER DEFAULT 0,
  response_cost_usd           NUMERIC(10,6) DEFAULT 0,
  latency_ms                  INTEGER DEFAULT 0,
  status_code                 INTEGER DEFAULT 200,
  guardrail_pii_triggered     BOOLEAN DEFAULT FALSE,
  guardrail_pii_entities      JSONB DEFAULT '[]'::jsonb,
  guardrail_security_triggered BOOLEAN DEFAULT FALSE,
  guardrail_security_scanners JSONB DEFAULT '[]'::jsonb,
  error_message               TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON ai_registry.audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_system
  ON ai_registry.audit_log (ai_system_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_team
  ON ai_registry.audit_log (litellm_team_id);

-- ── Table 3: Governance Risk Reviews ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_registry.risk_reviews (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_system_id      UUID NOT NULL REFERENCES ai_registry.ai_systems(id) ON DELETE CASCADE,
  reviewer          VARCHAR(255) NOT NULL,
  risk_tier_before  ai_registry.risk_tier NOT NULL,
  risk_tier_after   ai_registry.risk_tier NOT NULL,
  findings          TEXT,
  next_review_at    TIMESTAMPTZ,
  reviewed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_reviews_system
  ON ai_registry.risk_reviews (ai_system_id);

-- ── View: System Usage Dashboard ─────────────────────────────────────────
CREATE OR REPLACE VIEW ai_registry.v_system_usage_summary AS
SELECT
  s.id AS system_id, s.system_name, s.risk_tier, s.data_sensitivity,
  s.business_owner, s.status,
  COUNT(a.id) AS total_requests,
  COALESCE(SUM(a.total_tokens), 0) AS total_tokens,
  COALESCE(SUM(a.response_cost_usd), 0)::NUMERIC(10,4) AS total_cost_usd,
  ROUND(COALESCE(AVG(a.latency_ms), 0))::INTEGER AS avg_latency_ms,
  MAX(a.created_at) AS last_used_at,
  COUNT(a.id) FILTER (WHERE a.guardrail_pii_triggered) AS pii_trigger_count,
  COUNT(a.id) FILTER (WHERE a.guardrail_security_triggered) AS security_trigger_count
FROM ai_registry.ai_systems s
LEFT JOIN ai_registry.audit_log a ON a.ai_system_id = s.id
GROUP BY s.id, s.system_name, s.risk_tier, s.data_sensitivity, s.business_owner, s.status;

-- ── View: High-Risk Systems ──────────────────────────────────────────────
CREATE OR REPLACE VIEW ai_registry.v_high_risk_systems AS
SELECT * FROM ai_registry.v_system_usage_summary
WHERE risk_tier IN ('high', 'unacceptable');

COMMENT ON SCHEMA ai_registry IS 'AI Governance Registry — Zero-retention audit logging.';
COMMENT ON TABLE ai_registry.audit_log IS 'Metadata-only audit log. NO raw prompt/response text columns exist by design.';

