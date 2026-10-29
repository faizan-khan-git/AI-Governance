-- ═══════════════════════════════════════════════════════════════════════════
-- AI Registry Schema — Admin Governance, Token Quotas & Utilization Views
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Table: Token Quotas & Utilization Controls ─────────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_token_quotas_end_user
  ON ai_registry.token_quotas (end_user);

CREATE INDEX IF NOT EXISTS idx_audit_log_end_user_created
  ON ai_registry.audit_log (end_user, created_at);

-- ── View: Per-User Usage & Quota Summary ───────────────────────────────────
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

-- ── View: Per-User Daily Usage (for Quota Tracking) ────────────────────────
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

-- ── View: Flagged Prompts & Security Incidents ──────────────────────────────
CREATE OR REPLACE VIEW ai_registry.v_flagged_prompts AS
SELECT
  a.id,
  a.request_id,
  a.created_at,
  a.end_user,
  q.display_name AS user_display_name,
  a.model_requested,
  a.model_used,
  a.status_code,
  a.guardrail_security_triggered,
  a.guardrail_security_scanners,
  a.guardrail_security_flagged,
  a.guardrail_security_flagged_scanners,
  a.error_message,
  s.system_name,
  a.total_tokens,
  a.response_cost_usd
FROM ai_registry.audit_log a
LEFT JOIN ai_registry.token_quotas q ON a.end_user = q.end_user
LEFT JOIN ai_registry.ai_systems s ON a.ai_system_id = s.id
WHERE a.guardrail_security_triggered = TRUE OR a.guardrail_security_flagged = TRUE;

-- ── View: PII Incidents ────────────────────────────────────────────────────
CREATE OR REPLACE VIEW ai_registry.v_pii_incidents AS
SELECT
  a.id,
  a.request_id,
  a.created_at,
  a.end_user,
  q.display_name AS user_display_name,
  a.model_requested,
  a.guardrail_pii_triggered,
  a.guardrail_pii_entities,
  s.system_name,
  a.status_code
FROM ai_registry.audit_log a
LEFT JOIN ai_registry.token_quotas q ON a.end_user = q.end_user
LEFT JOIN ai_registry.ai_systems s ON a.ai_system_id = s.id
WHERE a.guardrail_pii_triggered = TRUE;

-- ── View: Daily Governance & Activity Trends ───────────────────────────────
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

COMMENT ON TABLE ai_registry.token_quotas IS 'Per-user token utilization limits and access control managed by administrators.';
COMMENT ON VIEW ai_registry.v_user_usage_summary IS 'Per-user aggregated token utilization, cost, and guardrail statistics.';
COMMENT ON VIEW ai_registry.v_flagged_prompts IS 'Security-flagged and security-blocked audit entries for administrator review.';

