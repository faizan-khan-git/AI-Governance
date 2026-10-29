import { query } from "../config/db.js";
import ApiError from "../utils/ApiError.js";
import logger from "../utils/logger.js";

/**
 * Middleware enforcing administrator-configured token quotas and utilization boundaries.
 * Executes after authentication has resolved `req.auth.endUserId`.
 *
 * Designed with a fail-open philosophy: if the database is unreachable,
 * a warning is logged and the request proceeds so governance infrastructure
 * never creates a single point of failure for core chat completions.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 */
export default async function checkQuota(req, _res, next) {
  const endUserId = req.auth?.endUserId;
  if (!endUserId) {
    return next();
  }

  // Administrators bypass token utilization quotas
  if (req.auth?.role === "admin") {
    return next();
  }

  try {
    // 1. Look up any quota/access restrictions for this pseudonymous user
    const quotaSql = `
      SELECT
        daily_token_limit,
        monthly_token_limit,
        daily_cost_limit_usd,
        monthly_cost_limit_usd,
        is_blocked,
        display_name
      FROM ai_registry.token_quotas
      WHERE end_user = $1;
    `;

    const quotaRes = await query(quotaSql, [endUserId]);

    // If no quota record exists for this user, they are under default gateway budget
    if (quotaRes.rows.length === 0) {
      return next();
    }

    const quota = quotaRes.rows[0];

    // Check if administrator has blocked this user
    if (quota.is_blocked) {
      logger.warn("Request rejected: user is blocked by admin", {
        endUserId,
        displayName: quota.display_name,
      });
      return next(
        new ApiError(403, "Access restricted. Your account has been blocked by an administrator.", {
          code: "account_blocked",
          details: "Please contact your AI Governance administrator to request access.",
        }),
      );
    }

    // If no specific limits are set, allow through
    const hasDailyLimit = quota.daily_token_limit != null && quota.daily_token_limit > 0;
    const hasMonthlyLimit = quota.monthly_token_limit != null && quota.monthly_token_limit > 0;
    const hasDailyCostLimit = quota.daily_cost_limit_usd != null && Number(quota.daily_cost_limit_usd) > 0;
    const hasMonthlyCostLimit = quota.monthly_cost_limit_usd != null && Number(quota.monthly_cost_limit_usd) > 0;

    if (!hasDailyLimit && !hasMonthlyLimit && !hasDailyCostLimit && !hasMonthlyCostLimit) {
      return next();
    }

    // 2. Query usage for today and this month
    const usageSql = `
      SELECT
        COALESCE(SUM(total_tokens) FILTER (WHERE created_at >= CURRENT_DATE), 0) AS daily_tokens,
        COALESCE(SUM(total_tokens) FILTER (WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)), 0) AS monthly_tokens,
        COALESCE(SUM(response_cost_usd) FILTER (WHERE created_at >= CURRENT_DATE), 0)::NUMERIC(10,4) AS daily_cost,
        COALESCE(SUM(response_cost_usd) FILTER (WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)), 0)::NUMERIC(10,4) AS monthly_cost
      FROM ai_registry.audit_log
      WHERE end_user = $1;
    `;

    const usageRes = await query(usageSql, [endUserId]);
    const usage = usageRes.rows[0] || {
      daily_tokens: 0,
      monthly_tokens: 0,
      daily_cost: 0,
      monthly_cost: 0,
    };

    const dailyTokensUsed = parseInt(usage.daily_tokens, 10);
    const monthlyTokensUsed = parseInt(usage.monthly_tokens, 10);
    const dailyCostUsed = parseFloat(usage.daily_cost);
    const monthlyCostUsed = parseFloat(usage.monthly_cost);

    // Enforce daily token boundary
    if (hasDailyLimit && dailyTokensUsed >= quota.daily_token_limit) {
      logger.warn("Daily token quota exceeded", {
        endUserId,
        limit: quota.daily_token_limit,
        used: dailyTokensUsed,
      });
      return next(
        new ApiError(
          429,
          `Daily token quota exceeded. Limit: ${quota.daily_token_limit.toLocaleString()} tokens, Used today: ${dailyTokensUsed.toLocaleString()} tokens.`,
          {
            code: "quota_exceeded",
            details: {
              type: "daily_tokens",
              limit: quota.daily_token_limit,
              used: dailyTokensUsed,
              resetsAt: "Midnight UTC",
            },
          },
        ),
      );
    }

    // Enforce monthly token boundary
    if (hasMonthlyLimit && monthlyTokensUsed >= quota.monthly_token_limit) {
      logger.warn("Monthly token quota exceeded", {
        endUserId,
        limit: quota.monthly_token_limit,
        used: monthlyTokensUsed,
      });
      return next(
        new ApiError(
          429,
          `Monthly token quota exceeded. Limit: ${quota.monthly_token_limit.toLocaleString()} tokens, Used this month: ${monthlyTokensUsed.toLocaleString()} tokens.`,
          {
            code: "quota_exceeded",
            details: {
              type: "monthly_tokens",
              limit: quota.monthly_token_limit,
              used: monthlyTokensUsed,
              resetsAt: "First day of next month",
            },
          },
        ),
      );
    }

    // Enforce daily cost boundary
    if (hasDailyCostLimit && dailyCostUsed >= Number(quota.daily_cost_limit_usd)) {
      return next(
        new ApiError(
          429,
          `Daily budget exceeded. Limit: $${Number(quota.daily_cost_limit_usd).toFixed(2)}, Used today: $${dailyCostUsed.toFixed(2)}.`,
          {
            code: "cost_limit_exceeded",
            details: {
              type: "daily_cost",
              limit: quota.daily_cost_limit_usd,
              used: dailyCostUsed,
            },
          },
        ),
      );
    }

    // Enforce monthly cost boundary
    if (hasMonthlyCostLimit && monthlyCostUsed >= Number(quota.monthly_cost_limit_usd)) {
      return next(
        new ApiError(
          429,
          `Monthly budget exceeded. Limit: $${Number(quota.monthly_cost_limit_usd).toFixed(2)}, Used this month: $${monthlyCostUsed.toFixed(2)}.`,
          {
            code: "cost_limit_exceeded",
            details: {
              type: "monthly_cost",
              limit: quota.monthly_cost_limit_usd,
              used: monthlyCostUsed,
            },
          },
        ),
      );
    }

    return next();
  } catch (err) {
    // Fail-open: log warning and permit request so database hiccups don't break chat
    logger.warn("Quota validation failed open due to database error", {
      endUserId,
      error: err.message,
    });
    return next();
  }
}

