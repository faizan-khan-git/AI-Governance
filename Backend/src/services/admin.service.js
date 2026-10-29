import { query } from "../config/db.js";
import ApiError from "../utils/ApiError.js";
import logger from "../utils/logger.js";

/**
 * Service providing database operations for the AI Governance Administrator Dashboard.
 * All queries are strictly parameterized to prevent SQL injection.
 */

/**
 * Fetch high-level governance KPI statistics.
 */
export async function getDashboardStats() {
  const statsQuery = `
    SELECT
      COUNT(id) AS total_requests,
      COUNT(DISTINCT end_user) AS active_users,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(prompt_tokens), 0) AS total_prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS total_completion_tokens,
      COALESCE(SUM(response_cost_usd), 0)::NUMERIC(10,4) AS total_cost_usd,
      ROUND(COALESCE(AVG(latency_ms), 0))::INTEGER AS avg_latency_ms,
      COUNT(id) FILTER (WHERE guardrail_security_triggered) AS security_blocks,
      COUNT(id) FILTER (WHERE guardrail_security_flagged) AS security_flags,
      COUNT(id) FILTER (WHERE guardrail_pii_triggered) AS pii_triggers,
      COUNT(id) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS requests_last_24h,
      COALESCE(SUM(total_tokens) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours'), 0) AS tokens_last_24h,
      COALESCE(SUM(response_cost_usd) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours'), 0)::NUMERIC(10,4) AS cost_last_24h,
      COUNT(id) FILTER (WHERE (guardrail_security_triggered OR guardrail_security_flagged) AND created_at >= NOW() - INTERVAL '24 hours') AS flags_last_24h
    FROM ai_registry.audit_log;
  `;

  const systemsQuery = `
    SELECT
      COUNT(id) AS total_systems,
      COUNT(id) FILTER (WHERE status = 'active') AS active_systems,
      COUNT(id) FILTER (WHERE risk_tier IN ('high', 'unacceptable')) AS high_risk_systems
    FROM ai_registry.ai_systems;
  `;

  const topUsersQuery = `
    SELECT
      COALESCE(a.end_user, 'anonymous') AS end_user,
      COALESCE(q.display_name, a.end_user, 'anonymous') AS display_name,
      COUNT(a.id) AS requests,
      COALESCE(SUM(a.total_tokens), 0) AS total_tokens,
      COALESCE(SUM(a.response_cost_usd), 0)::NUMERIC(10,4) AS cost_usd,
      COUNT(a.id) FILTER (WHERE a.guardrail_security_triggered OR a.guardrail_security_flagged) AS security_flags
    FROM ai_registry.audit_log a
    LEFT JOIN ai_registry.token_quotas q ON a.end_user = q.end_user
    WHERE a.end_user IS NOT NULL
    GROUP BY a.end_user, q.display_name
    ORDER BY total_tokens DESC
    LIMIT 5;
  `;

  const [statsRes, systemsRes, topUsersRes] = await Promise.all([
    query(statsQuery),
    query(systemsQuery),
    query(topUsersQuery),
  ]);

  return {
    kpis: {
      ...statsRes.rows[0],
      ...systemsRes.rows[0],
    },
    topUsers: topUsersRes.rows,
  };
}

/**
 * Fetch daily trend data over the last N days.
 * @param {number} days - Number of days to look back (default 30)
 */
export async function getDailyTrends(days = 30) {
  const sql = `
    SELECT
      day::TEXT,
      total_requests,
      active_users,
      total_tokens,
      prompt_tokens,
      completion_tokens,
      total_cost_usd,
      avg_latency_ms,
      security_blocks,
      security_flags,
      pii_triggers
    FROM ai_registry.v_daily_trends
    WHERE day >= (CURRENT_DATE - ($1 || ' days')::INTERVAL)
    ORDER BY day ASC;
  `;
  const res = await query(sql, [days]);
  return res.rows;
}

/**
 * Fetch paginated audit logs with dynamic filtering.
 */
export async function getAuditLogs(filters = {}) {
  const {
    page = 1,
    limit = 50,
    end_user,
    model,
    status_code,
    flagged_only,
    pii_only,
    start_date,
    end_date,
    search,
  } = filters;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (end_user) {
    conditions.push(`a.end_user = $${paramIdx++}`);
    params.push(end_user);
  }

  if (model) {
    conditions.push(`(a.model_requested = $${paramIdx} OR a.model_used = $${paramIdx})`);
    paramIdx++;
    params.push(model);
  }

  if (status_code) {
    conditions.push(`a.status_code = $${paramIdx++}`);
    params.push(parseInt(status_code, 10));
  }

  if (flagged_only === "true" || flagged_only === true) {
    conditions.push(`(a.guardrail_security_triggered = TRUE OR a.guardrail_security_flagged = TRUE)`);
  }

  if (pii_only === "true" || pii_only === true) {
    conditions.push(`a.guardrail_pii_triggered = TRUE`);
  }

  if (start_date) {
    conditions.push(`a.created_at >= $${paramIdx++}`);
    params.push(new Date(start_date));
  }

  if (end_date) {
    conditions.push(`a.created_at <= $${paramIdx++}`);
    params.push(new Date(end_date));
  }

  if (search) {
    conditions.push(`(a.end_user ILIKE $${paramIdx} OR a.request_id ILIKE $${paramIdx} OR a.model_requested ILIKE $${paramIdx})`);
    paramIdx++;
    params.push(`%${search}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countSql = `SELECT COUNT(*) AS total FROM ai_registry.audit_log a ${whereClause}`;
  const countRes = await query(countSql, params);
  const total = parseInt(countRes.rows[0]?.total || "0", 10);

  const dataSql = `
    SELECT
      a.id,
      a.request_id,
      a.created_at,
      a.end_user,
      q.display_name AS user_display_name,
      a.model_requested,
      a.model_used,
      a.prompt_tokens,
      a.completion_tokens,
      a.total_tokens,
      a.response_cost_usd,
      a.latency_ms,
      a.status_code,
      a.guardrail_pii_triggered,
      a.guardrail_pii_entities,
      a.guardrail_security_triggered,
      a.guardrail_security_scanners,
      a.guardrail_security_flagged,
      a.guardrail_security_flagged_scanners,
      a.error_message,
      s.system_name
    FROM ai_registry.audit_log a
    LEFT JOIN ai_registry.token_quotas q ON a.end_user = q.end_user
    LEFT JOIN ai_registry.ai_systems s ON a.ai_system_id = s.id
    ${whereClause}
    ORDER BY a.created_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++};
  `;

  params.push(limitNum, offset);
  const dataRes = await query(dataSql, params);

  return {
    data: dataRes.rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  };
}

/**
 * Fetch detail for a single audit log record.
 */
export async function getAuditLogById(id) {
  const sql = `
    SELECT
      a.*,
      q.display_name AS user_display_name,
      s.system_name,
      s.risk_tier,
      s.business_owner
    FROM ai_registry.audit_log a
    LEFT JOIN ai_registry.token_quotas q ON a.end_user = q.end_user
    LEFT JOIN ai_registry.ai_systems s ON a.ai_system_id = s.id
    WHERE a.id = $1;
  `;
  const res = await query(sql, [id]);
  if (res.rows.length === 0) {
    throw new ApiError(404, "Audit log record not found.");
  }
  return res.rows[0];
}

/**
 * Fetch security-flagged and security-blocked requests.
 */
export async function getFlaggedPrompts(filters = {}) {
  const {
    page = 1,
    limit = 50,
    end_user,
    type, // 'blocked' or 'flagged' or undefined (both)
    scanner,
    start_date,
    end_date,
  } = filters;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (type === "blocked") {
    conditions.push(`guardrail_security_triggered = TRUE`);
  } else if (type === "flagged") {
    conditions.push(`guardrail_security_flagged = TRUE`);
  } else {
    conditions.push(`(guardrail_security_triggered = TRUE OR guardrail_security_flagged = TRUE)`);
  }

  if (end_user) {
    conditions.push(`end_user = $${paramIdx++}`);
    params.push(end_user);
  }

  if (start_date) {
    conditions.push(`created_at >= $${paramIdx++}`);
    params.push(new Date(start_date));
  }

  if (end_date) {
    conditions.push(`created_at <= $${paramIdx++}`);
    params.push(new Date(end_date));
  }

  if (scanner) {
    conditions.push(
      `(guardrail_security_scanners @> $${paramIdx}::jsonb OR guardrail_security_flagged_scanners @> $${paramIdx}::jsonb)`,
    );
    paramIdx++;
    params.push(JSON.stringify([scanner]));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countSql = `SELECT COUNT(*) AS total FROM ai_registry.v_flagged_prompts ${whereClause}`;
  const countRes = await query(countSql, params);
  const total = parseInt(countRes.rows[0]?.total || "0", 10);

  const dataSql = `
    SELECT * FROM ai_registry.v_flagged_prompts
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++};
  `;

  params.push(limitNum, offset);
  const dataRes = await query(dataSql, params);

  // Scanner frequency summary
  const scannerStatsSql = `
    SELECT
      elem AS scanner_name,
      COUNT(*) AS count
    FROM ai_registry.audit_log,
         LATERAL jsonb_array_elements_text(guardrail_security_scanners || guardrail_security_flagged_scanners) AS elem
    WHERE guardrail_security_triggered = TRUE OR guardrail_security_flagged = TRUE
    GROUP BY elem
    ORDER BY count DESC;
  `;
  const scannerStatsRes = await query(scannerStatsSql).catch(() => ({ rows: [] }));

  return {
    data: dataRes.rows,
    scannerStats: scannerStatsRes.rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  };
}

/**
 * Fetch PII detection incidents and entity-type distributions.
 */
export async function getPiiIncidents(filters = {}) {
  const {
    page = 1,
    limit = 50,
    end_user,
    start_date,
    end_date,
  } = filters;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (pageNum - 1) * limitNum;

  const conditions = ["guardrail_pii_triggered = TRUE"];
  const params = [];
  let paramIdx = 1;

  if (end_user) {
    conditions.push(`end_user = $${paramIdx++}`);
    params.push(end_user);
  }

  if (start_date) {
    conditions.push(`created_at >= $${paramIdx++}`);
    params.push(new Date(start_date));
  }

  if (end_date) {
    conditions.push(`created_at <= $${paramIdx++}`);
    params.push(new Date(end_date));
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const countSql = `SELECT COUNT(*) AS total FROM ai_registry.v_pii_incidents ${whereClause}`;
  const countRes = await query(countSql, params);
  const total = parseInt(countRes.rows[0]?.total || "0", 10);

  const dataSql = `
    SELECT * FROM ai_registry.v_pii_incidents
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++};
  `;

  params.push(limitNum, offset);
  const dataRes = await query(dataSql, params);

  // Aggregated entity counts (PERSON, EMAIL_ADDRESS, etc.)
  const entityStatsSql = `
    SELECT
      elem AS entity_type,
      COUNT(*) AS count
    FROM ai_registry.audit_log,
         LATERAL jsonb_array_elements_text(guardrail_pii_entities) AS elem
    WHERE guardrail_pii_triggered = TRUE
    GROUP BY elem
    ORDER BY count DESC;
  `;
  const entityStatsRes = await query(entityStatsSql).catch(() => ({ rows: [] }));

  return {
    data: dataRes.rows,
    entityStats: entityStatsRes.rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  };
}

/**
 * List all users with aggregated token and cost utilization statistics.
 */
export async function getUsersSummary(filters = {}) {
  const { page = 1, limit = 50, search } = filters;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (search) {
    conditions.push(`(end_user ILIKE $${paramIdx} OR display_name ILIKE $${paramIdx})`);
    paramIdx++;
    params.push(`%${search}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countSql = `SELECT COUNT(*) AS total FROM ai_registry.v_user_usage_summary ${whereClause}`;
  const countRes = await query(countSql, params);
  const total = parseInt(countRes.rows[0]?.total || "0", 10);

  const dataSql = `
    SELECT * FROM ai_registry.v_user_usage_summary
    ${whereClause}
    ORDER BY total_tokens DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++};
  `;

  params.push(limitNum, offset);
  const dataRes = await query(dataSql, params);

  return {
    data: dataRes.rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  };
}

/**
 * Fetch detailed metrics for a specific user, including daily utilization and recent activity.
 */
export async function getUserDetail(endUser) {
  const userSql = `
    SELECT * FROM ai_registry.v_user_usage_summary
    WHERE end_user = $1;
  `;
  const userRes = await query(userSql, [endUser]);

  if (userRes.rows.length === 0) {
    // If user has no audit rows yet, check if a quota was created for them
    const quotaSql = `SELECT * FROM ai_registry.token_quotas WHERE end_user = $1;`;
    const quotaRes = await query(quotaSql, [endUser]);
    if (quotaRes.rows.length === 0) {
      throw new ApiError(404, `User '${endUser}' not found.`);
    }
    return {
      user: {
        end_user: endUser,
        display_name: quotaRes.rows[0].display_name,
        total_requests: 0,
        total_tokens: 0,
        total_cost_usd: 0,
        is_blocked: quotaRes.rows[0].is_blocked,
        daily_token_limit: quotaRes.rows[0].daily_token_limit,
        monthly_token_limit: quotaRes.rows[0].monthly_token_limit,
        daily_cost_limit_usd: quotaRes.rows[0].daily_cost_limit_usd,
        monthly_cost_limit_usd: quotaRes.rows[0].monthly_cost_limit_usd,
      },
      dailyUsage: [],
      recentLogs: [],
      quota: quotaRes.rows[0],
    };
  }

  // Daily usage history for charts
  const historySql = `
    SELECT
      usage_date::DATE::TEXT AS date,
      requests_count,
      daily_tokens,
      daily_cost_usd
    FROM ai_registry.v_user_daily_usage
    WHERE end_user = $1 AND usage_date >= NOW() - INTERVAL '30 days'
    ORDER BY usage_date ASC;
  `;
  const historyRes = await query(historySql, [endUser]);

  // Recent 10 audit logs
  const logsSql = `
    SELECT
      id,
      request_id,
      created_at,
      model_requested,
      model_used,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      response_cost_usd,
      latency_ms,
      status_code,
      guardrail_security_triggered,
      guardrail_security_flagged,
      guardrail_pii_triggered
    FROM ai_registry.audit_log
    WHERE end_user = $1
    ORDER BY created_at DESC
    LIMIT 10;
  `;
  const logsRes = await query(logsSql, [endUser]);

  // Quota row
  const quotaSql = `SELECT * FROM ai_registry.token_quotas WHERE end_user = $1;`;
  const quotaRes = await query(quotaSql, [endUser]);

  return {
    user: userRes.rows[0],
    dailyUsage: historyRes.rows,
    recentLogs: logsRes.rows,
    quota: quotaRes.rows[0] || null,
  };
}

/**
 * Fetch all configured token quotas.
 */
export async function getQuotas() {
  const sql = `
    SELECT
      q.*,
      COALESCE(u.total_tokens, 0) AS total_tokens_used,
      COALESCE(u.total_cost_usd, 0) AS total_cost_usd,
      COALESCE(u.total_requests, 0) AS total_requests,
      COALESCE(d.daily_tokens, 0) AS today_tokens_used,
      COALESCE(d.daily_cost_usd, 0) AS today_cost_usd
    FROM ai_registry.token_quotas q
    LEFT JOIN ai_registry.v_user_usage_summary u ON q.end_user = u.end_user
    LEFT JOIN (
      SELECT end_user, daily_tokens, daily_cost_usd
      FROM ai_registry.v_user_daily_usage
      WHERE usage_date = CURRENT_DATE
    ) d ON q.end_user = d.end_user
    ORDER BY q.created_at DESC;
  `;
  const res = await query(sql);
  return res.rows;
}

/**
 * Upsert token quota & access control limits for an end_user.
 */
export async function setQuota(endUser, quotaData) {
  const {
    display_name,
    daily_token_limit,
    monthly_token_limit,
    daily_cost_limit_usd,
    monthly_cost_limit_usd,
    is_blocked = false,
    notes,
  } = quotaData;

  const sql = `
    INSERT INTO ai_registry.token_quotas (
      end_user, display_name, daily_token_limit, monthly_token_limit,
      daily_cost_limit_usd, monthly_cost_limit_usd, is_blocked, notes, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (end_user) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      daily_token_limit = EXCLUDED.daily_token_limit,
      monthly_token_limit = EXCLUDED.monthly_token_limit,
      daily_cost_limit_usd = EXCLUDED.daily_cost_limit_usd,
      monthly_cost_limit_usd = EXCLUDED.monthly_cost_limit_usd,
      is_blocked = EXCLUDED.is_blocked,
      notes = EXCLUDED.notes,
      updated_at = NOW()
    RETURNING *;
  `;

  const res = await query(sql, [
    endUser,
    display_name || null,
    daily_token_limit ? parseInt(daily_token_limit, 10) : null,
    monthly_token_limit ? parseInt(monthly_token_limit, 10) : null,
    daily_cost_limit_usd ? parseFloat(daily_cost_limit_usd) : null,
    monthly_cost_limit_usd ? parseFloat(monthly_cost_limit_usd) : null,
    Boolean(is_blocked),
    notes || null,
  ]);

  return res.rows[0];
}

/**
 * Remove quota for an end_user (revert to unlimited).
 */
export async function deleteQuota(endUser) {
  const sql = `DELETE FROM ai_registry.token_quotas WHERE end_user = $1 RETURNING *;`;
  const res = await query(sql, [endUser]);
  if (res.rows.length === 0) {
    throw new ApiError(404, `No quota found for user '${endUser}'.`);
  }
  return res.rows[0];
}

/**
 * Fetch all registered AI systems with usage statistics.
 */
export async function getAiSystems() {
  const sql = `
    SELECT
      s.*,
      COALESCE(u.total_requests, 0) AS total_requests,
      COALESCE(u.total_tokens, 0) AS total_tokens,
      COALESCE(u.total_cost_usd, 0) AS total_cost_usd,
      COALESCE(u.avg_latency_ms, 0) AS avg_latency_ms,
      u.last_used_at,
      COALESCE(u.pii_trigger_count, 0) AS pii_trigger_count,
      COALESCE(u.security_trigger_count, 0) AS security_trigger_count,
      COALESCE(u.security_flag_count, 0) AS security_flag_count
    FROM ai_registry.ai_systems s
    LEFT JOIN ai_registry.v_system_usage_summary u ON s.id = u.system_id
    ORDER BY s.risk_tier = 'high' DESC, s.created_at DESC;
  `;
  const res = await query(sql);
  return res.rows;
}

/**
 * Fetch detail for a specific AI system, including risk reviews.
 */
export async function getAiSystemById(id) {
  const systemSql = `
    SELECT
      s.*,
      COALESCE(u.total_requests, 0) AS total_requests,
      COALESCE(u.total_tokens, 0) AS total_tokens,
      COALESCE(u.total_cost_usd, 0) AS total_cost_usd,
      COALESCE(u.avg_latency_ms, 0) AS avg_latency_ms,
      u.last_used_at,
      COALESCE(u.pii_trigger_count, 0) AS pii_trigger_count,
      COALESCE(u.security_trigger_count, 0) AS security_trigger_count,
      COALESCE(u.security_flag_count, 0) AS security_flag_count
    FROM ai_registry.ai_systems s
    LEFT JOIN ai_registry.v_system_usage_summary u ON s.id = u.system_id
    WHERE s.id = $1;
  `;
  const systemRes = await query(systemSql, [id]);
  if (systemRes.rows.length === 0) {
    throw new ApiError(404, `AI system with ID '${id}' not found.`);
  }

  const reviewsSql = `
    SELECT * FROM ai_registry.risk_reviews
    WHERE ai_system_id = $1
    ORDER BY reviewed_at DESC;
  `;
  const reviewsRes = await query(reviewsSql, [id]);

  return {
    system: systemRes.rows[0],
    reviews: reviewsRes.rows,
  };
}

/**
 * Fetch all risk reviews across all registered AI systems.
 */
export async function getRiskReviews() {
  const sql = `
    SELECT
      r.*,
      s.system_name,
      s.business_owner,
      s.risk_tier AS current_risk_tier
    FROM ai_registry.risk_reviews r
    JOIN ai_registry.ai_systems s ON r.ai_system_id = s.id
    ORDER BY r.reviewed_at DESC;
  `;
  const res = await query(sql);
  return res.rows;
}

