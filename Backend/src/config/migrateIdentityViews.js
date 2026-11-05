import logger from "../utils/logger.js";

/**
 * Identity-aware views.
 *
 * These views resolved a caller's name only from ai_registry.token_quotas, which
 * stores quota assignments rather than people. Real users live in
 * ai_registry.users, so a signed-in user appeared as "Anonymous" even though
 * their name and email were on record.
 *
 * Each view now resolves, in order: the user's display name, their email, a
 * legacy quota label, then the pseudonymous id, so a row is never shown as
 * anonymous when the identity is known.
 *
 * Only views are touched: no table is altered or dropped and no stored audit
 * row changes. The views are dropped and recreated inside a transaction because
 * adding a column cannot be done with CREATE OR REPLACE VIEW.
 */

const VIEW_NAMES = [
  "ai_registry.v_flagged_prompts",
  "ai_registry.v_pii_incidents",
  "ai_registry.v_user_usage_summary",
];

const IDENTITY_VIEWS_SQL = `
-- Recreated rather than replaced: CREATE OR REPLACE VIEW cannot add a column or
-- widen an existing one, which is what the identity columns require.
${VIEW_NAMES.map((v) => `DROP VIEW IF EXISTS ${v} CASCADE;`).join("\n")}

-- ── Flagged / blocked requests ──────────────────────────────────────────────
CREATE OR REPLACE VIEW ai_registry.v_flagged_prompts AS
SELECT
  a.id, a.request_id, a.created_at, a.end_user,
  COALESCE(NULLIF(u.display_name, ''), NULLIF(u.email, ''), NULLIF(q.display_name, ''), a.end_user) AS user_display_name,
  u.email  AS user_email,
  u.role   AS user_role,
  a.model_requested, a.model_used, a.status_code,
  a.guardrail_security_triggered, a.guardrail_security_scanners,
  a.guardrail_security_flagged, a.guardrail_security_flagged_scanners,
  a.error_message, s.system_name, a.total_tokens, a.response_cost_usd
FROM ai_registry.audit_log a
LEFT JOIN ai_registry.users u        ON u.end_user = a.end_user
LEFT JOIN ai_registry.token_quotas q ON q.end_user = a.end_user
LEFT JOIN ai_registry.ai_systems s   ON s.id = a.ai_system_id
WHERE a.guardrail_security_triggered = TRUE OR a.guardrail_security_flagged = TRUE;

-- ── PII incidents ──────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW ai_registry.v_pii_incidents AS
SELECT
  a.id, a.request_id, a.created_at, a.end_user,
  COALESCE(NULLIF(u.display_name, ''), NULLIF(u.email, ''), NULLIF(q.display_name, ''), a.end_user) AS user_display_name,
  u.email  AS user_email,
  u.role   AS user_role,
  a.model_requested, a.guardrail_pii_triggered,
  a.guardrail_pii_entities, s.system_name, a.status_code
FROM ai_registry.audit_log a
LEFT JOIN ai_registry.users u        ON u.end_user = a.end_user
LEFT JOIN ai_registry.token_quotas q ON q.end_user = a.end_user
LEFT JOIN ai_registry.ai_systems s   ON s.id = a.ai_system_id
WHERE a.guardrail_pii_triggered = TRUE;

-- ── Per-user usage (User Directory) ────────────────────────────────────────
-- Drives from the access list so invited and suspended people are listed too,
-- plus any caller id that only appears in the audit log (legacy rows).
CREATE OR REPLACE VIEW ai_registry.v_user_usage_summary AS
WITH usage AS (
  SELECT
    a.end_user,
    COUNT(a.id)                                            AS total_requests,
    COALESCE(SUM(a.prompt_tokens), 0)                      AS total_prompt_tokens,
    COALESCE(SUM(a.completion_tokens), 0)                  AS total_completion_tokens,
    COALESCE(SUM(a.total_tokens), 0)                       AS total_tokens,
    COALESCE(SUM(a.response_cost_usd), 0)::NUMERIC(10,4)   AS total_cost_usd,
    ROUND(COALESCE(AVG(a.latency_ms), 0))::INTEGER         AS avg_latency_ms,
    MIN(a.created_at) AS first_seen_at,
    MAX(a.created_at) AS last_seen_at,
    COUNT(a.id) FILTER (WHERE a.guardrail_pii_triggered)      AS pii_trigger_count,
    COUNT(a.id) FILTER (WHERE a.guardrail_security_triggered) AS security_trigger_count,
    COUNT(a.id) FILTER (WHERE a.guardrail_security_flagged)   AS security_flag_count
  FROM ai_registry.audit_log a
  WHERE a.end_user IS NOT NULL
  GROUP BY a.end_user
)
SELECT
  COALESCE(u.end_user, a.end_user) AS end_user,
  COALESCE(NULLIF(u.display_name, ''), NULLIF(u.email, ''), NULLIF(q.display_name, '')) AS display_name,
  u.email      AS user_email,
  u.role       AS user_role,
  u.status     AS user_status,
  u.department,
  u.last_active_at,
  q.daily_token_limit,
  q.monthly_token_limit,
  q.daily_cost_limit_usd,
  q.monthly_cost_limit_usd,
  COALESCE(q.is_blocked, FALSE)          AS is_blocked,
  COALESCE(a.total_requests, 0)          AS total_requests,
  COALESCE(a.total_prompt_tokens, 0)     AS total_prompt_tokens,
  COALESCE(a.total_completion_tokens, 0) AS total_completion_tokens,
  COALESCE(a.total_tokens, 0)            AS total_tokens,
  COALESCE(a.total_cost_usd, 0)          AS total_cost_usd,
  COALESCE(a.avg_latency_ms, 0)          AS avg_latency_ms,
  a.first_seen_at,
  a.last_seen_at,
  COALESCE(a.pii_trigger_count, 0)       AS pii_trigger_count,
  COALESCE(a.security_trigger_count, 0)  AS security_trigger_count,
  COALESCE(a.security_flag_count, 0)     AS security_flag_count
FROM ai_registry.users u
FULL OUTER JOIN usage a ON a.end_user = u.end_user
LEFT JOIN ai_registry.token_quotas q ON q.end_user = COALESCE(u.end_user, a.end_user);
`;

/**
 * Replace the caller-identity views.
 *
 * @param {import('pg').Pool} pool
 */
export async function runIdentityViewMigrations(pool) {
  if (!pool) return;

  // Only run when the deployment actually needs it, so a normal boot does not
  // drop and recreate working views every time.
  const marker = await pool
    .query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'ai_registry'
          AND table_name = 'v_flagged_prompts'
          AND column_name = 'user_email'`,
    )
    .catch(() => ({ rowCount: 0 }));
  if (marker.rowCount > 0) return;

  // Dropping and recreating views is transactional, so readers never see a
  // missing view and a failure cannot leave a half-applied state.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(IDENTITY_VIEWS_SQL);
    await client.query("COMMIT");
    logger.info("Identity-aware audit views created");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    // Never stop the service from booting: the service layer also joins
    // ai_registry.users, so names still resolve without these views.
    logger.warn("Identity view migration failed; using service-layer joins", {
      message: error.message,
    });
  } finally {
    client.release();
  }
}

export default { runIdentityViewMigrations };
