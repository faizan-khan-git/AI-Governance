import logger from "../utils/logger.js";

const SCHEMA_SQL = `
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

CREATE INDEX IF NOT EXISTS idx_ai_systems_risk_status ON ai_registry.ai_systems (risk_tier, status);
CREATE INDEX IF NOT EXISTS idx_ai_systems_team ON ai_registry.ai_systems (litellm_team_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_systems_system_name ON ai_registry.ai_systems (system_name);

CREATE TABLE IF NOT EXISTS ai_registry.audit_log (
  id                          BIGSERIAL PRIMARY KEY,
  request_id                  VARCHAR(100),
  ai_system_id                UUID REFERENCES ai_registry.ai_systems(id) ON DELETE SET NULL,
  litellm_team_id             VARCHAR(100),
  litellm_key_alias           VARCHAR(100),
  end_user                    VARCHAR(100),
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
  guardrail_security_flagged  BOOLEAN DEFAULT FALSE,
  guardrail_security_flagged_scanners JSONB DEFAULT '[]'::jsonb,
  error_message               TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON ai_registry.audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_system ON ai_registry.audit_log (ai_system_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_team ON ai_registry.audit_log (litellm_team_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_end_user ON ai_registry.audit_log (end_user);

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

CREATE INDEX IF NOT EXISTS idx_risk_reviews_system ON ai_registry.risk_reviews (ai_system_id);

CREATE TABLE IF NOT EXISTS ai_registry.token_quotas (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  end_user               VARCHAR(100) NOT NULL UNIQUE,
  display_name           VARCHAR(255),
  daily_token_limit      INTEGER,
  monthly_token_limit    INTEGER,
  daily_cost_limit_usd   NUMERIC(10,4),
  monthly_cost_limit_usd NUMERIC(10,4),
  is_blocked             BOOLEAN NOT NULL DEFAULT FALSE,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_quotas_end_user ON ai_registry.token_quotas (end_user);
CREATE INDEX IF NOT EXISTS idx_audit_log_end_user_created ON ai_registry.audit_log (end_user, created_at);

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
  COUNT(a.id) FILTER (WHERE a.guardrail_security_triggered) AS security_trigger_count,
  COUNT(a.id) FILTER (WHERE a.guardrail_security_flagged) AS security_flag_count
FROM ai_registry.ai_systems s
LEFT JOIN ai_registry.audit_log a ON a.ai_system_id = s.id
GROUP BY s.id, s.system_name, s.risk_tier, s.data_sensitivity, s.business_owner, s.status;

CREATE OR REPLACE VIEW ai_registry.v_high_risk_systems AS
SELECT * FROM ai_registry.v_system_usage_summary
WHERE risk_tier IN ('high', 'unacceptable');

CREATE OR REPLACE VIEW ai_registry.v_user_usage_summary AS
SELECT
  COALESCE(a.end_user, 'anonymous') AS end_user,
  q.display_name,
  q.daily_token_limit,
  q.monthly_token_limit,
  q.daily_cost_limit_usd,
  q.monthly_cost_limit_usd,
  COALESCE(q.is_blocked, FALSE) AS is_blocked,
  COUNT(a.id) AS total_requests,
  COALESCE(SUM(a.prompt_tokens), 0) AS total_prompt_tokens,
  COALESCE(SUM(a.completion_tokens), 0) AS total_completion_tokens,
  COALESCE(SUM(a.total_tokens), 0) AS total_tokens,
  COALESCE(SUM(a.response_cost_usd), 0)::NUMERIC(10,4) AS total_cost_usd,
  ROUND(COALESCE(AVG(a.latency_ms), 0))::INTEGER AS avg_latency_ms,
  MIN(a.created_at) AS first_seen_at,
  MAX(a.created_at) AS last_seen_at,
  COUNT(a.id) FILTER (WHERE a.guardrail_pii_triggered) AS pii_trigger_count,
  COUNT(a.id) FILTER (WHERE a.guardrail_security_triggered) AS security_trigger_count,
  COUNT(a.id) FILTER (WHERE a.guardrail_security_flagged) AS security_flag_count
FROM ai_registry.audit_log a
LEFT JOIN ai_registry.token_quotas q ON a.end_user = q.end_user
GROUP BY a.end_user, q.display_name, q.daily_token_limit, q.monthly_token_limit,
         q.daily_cost_limit_usd, q.monthly_cost_limit_usd, q.is_blocked;

CREATE OR REPLACE VIEW ai_registry.v_user_daily_usage AS
SELECT
  end_user,
  DATE_TRUNC('day', created_at) AS usage_date,
  COUNT(id) AS requests_count,
  COALESCE(SUM(total_tokens), 0) AS daily_tokens,
  COALESCE(SUM(response_cost_usd), 0)::NUMERIC(10,4) AS daily_cost_usd
FROM ai_registry.audit_log
WHERE end_user IS NOT NULL
GROUP BY end_user, DATE_TRUNC('day', created_at);

CREATE OR REPLACE VIEW ai_registry.v_flagged_prompts AS
SELECT
  a.id, a.request_id, a.created_at, a.end_user,
  q.display_name AS user_display_name,
  a.model_requested, a.model_used, a.status_code,
  a.guardrail_security_triggered, a.guardrail_security_scanners,
  a.guardrail_security_flagged, a.guardrail_security_flagged_scanners,
  a.error_message, s.system_name, a.total_tokens, a.response_cost_usd
FROM ai_registry.audit_log a
LEFT JOIN ai_registry.token_quotas q ON a.end_user = q.end_user
LEFT JOIN ai_registry.ai_systems s ON a.ai_system_id = s.id
WHERE a.guardrail_security_triggered = TRUE OR a.guardrail_security_flagged = TRUE;

CREATE OR REPLACE VIEW ai_registry.v_pii_incidents AS
SELECT
  a.id, a.request_id, a.created_at, a.end_user,
  q.display_name AS user_display_name,
  a.model_requested, a.guardrail_pii_triggered,
  a.guardrail_pii_entities, s.system_name, a.status_code
FROM ai_registry.audit_log a
LEFT JOIN ai_registry.token_quotas q ON a.end_user = q.end_user
LEFT JOIN ai_registry.ai_systems s ON a.ai_system_id = s.id
WHERE a.guardrail_pii_triggered = TRUE;

CREATE OR REPLACE VIEW ai_registry.v_daily_trends AS
SELECT
  DATE_TRUNC('day', created_at)::DATE AS day,
  COUNT(id) AS total_requests,
  COUNT(DISTINCT end_user) AS active_users,
  COALESCE(SUM(total_tokens), 0) AS total_tokens,
  COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
  COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
  COALESCE(SUM(response_cost_usd), 0)::NUMERIC(10,4) AS total_cost_usd,
  ROUND(COALESCE(AVG(latency_ms), 0))::INTEGER AS avg_latency_ms,
  COUNT(id) FILTER (WHERE guardrail_security_triggered) AS security_blocks,
  COUNT(id) FILTER (WHERE guardrail_security_flagged) AS security_flags,
  COUNT(id) FILTER (WHERE guardrail_pii_triggered) AS pii_triggers
FROM ai_registry.audit_log
GROUP BY DATE_TRUNC('day', created_at)::DATE;

INSERT INTO ai_registry.ai_systems
  (system_name, description, risk_tier, data_sensitivity, business_owner,
   business_unit, model_name, litellm_team_id, status, approved_at, review_due_at)
VALUES
  ('Customer Support Bot', 'Automated support agent handling tickets and FAQs.', 'limited', 'confidential', 'Sarah Chen', 'Support Operations', 'gemini-flash', 'team-dev', 'active', NOW() - INTERVAL '30 days', NOW() + INTERVAL '150 days'),
  ('Code Review Agent', 'AI code review assistant analyzing PRs for bugs and security vulnerabilities.', 'minimal', 'internal', 'James Rodriguez', 'Engineering', 'gemini-flash', 'team-dev', 'active', NOW() - INTERVAL '45 days', NOW() + INTERVAL '320 days'),
  ('Financial Analyst Agent', 'Analyzes quarterly reports, generates earnings forecasts, and produces risk assessments.', 'high', 'restricted', 'Michael Park', 'Finance', 'gpt-4o', 'team-standard', 'active', NOW() - INTERVAL '15 days', NOW() + INTERVAL '75 days'),
  ('HR Policy Assistant', 'Assists HR with policy interpretation and employee onboarding.', 'high', 'confidential', 'Priya Sharma', 'Human Resources', 'gpt-4o', 'team-admin', 'active', NOW() - INTERVAL '20 days', NOW() + INTERVAL '70 days'),
  ('Marketing Content Generator', 'Generates marketing copy and social media posts.', 'limited', 'public', 'Alex Thompson', 'Marketing', 'gpt-4o-mini', 'team-standard', 'active', NOW() - INTERVAL '10 days', NOW() + INTERVAL '170 days')
ON CONFLICT (system_name) DO NOTHING;
`;

export async function runAutoMigrations(pool) {
  if (!pool) return;
  try {
    const check = await pool.query("SELECT to_regclass('ai_registry.audit_log') as reg;");
    if (check.rows[0]?.reg) {
      logger.info("Database schema already exists, skipping initialization");
      return;
    }
    logger.info("Auto-initializing AI Governance database schemas on PostgreSQL...");
    await pool.query(SCHEMA_SQL);
    logger.info("AI Governance database schemas initialized successfully");
  } catch (err) {
    logger.warn("Auto-migration check notice (non-fatal)", { error: err.message });
  }
}
