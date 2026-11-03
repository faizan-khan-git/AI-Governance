import { query } from "../config/db.js";
import ApiError from "../utils/ApiError.js";
import { ALL_ROLES } from "../auth/roles.js";
import {
  countActiveAdmins,
  destroyUserSessions,
  endUserIdForSubject,
  recordAdminAction,
} from "./identity.service.js";

/**
 * Administrator-managed access list.
 *
 * Only administrators reach this module (mounted behind requireAdmin), and every
 * mutation is written to the admin action log.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Statuses an admin may set explicitly. "active" is reached by signing in. */
const SETTABLE_STATUSES = new Set(["invited", "suspended"]);

/**
 * Create the provisional end_user id for an invitation.
 * Replaced by the subject-derived id on first sign-in.
 *
 * @param {string} email
 * @returns {string}
 */
function provisionalEndUserId(email) {
  return endUserIdForSubject(`invite:${String(email).toLowerCase()}`);
}

/**
 * List users with governance usage, newest invitations first.
 *
 * @param {{ search?: string, status?: string, role?: string, limit?: number, offset?: number }} [filters]
 * @returns {Promise<{ data: object[], total: number }>}
 */
export async function listUsers({ search, status, role, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(email ILIKE $${params.length} OR display_name ILIKE $${params.length})`);
  }
  if (status && ["invited", "active", "suspended", "removed"].includes(status)) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (role && ALL_ROLES.includes(role)) {
    params.push(role);
    conditions.push(`role = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [countRes, dataRes] = await Promise.all([
    query(`SELECT COUNT(*)::INT AS total FROM ai_registry.v_admin_user_directory ${where}`, params),
    query(
      `SELECT * FROM ai_registry.v_admin_user_directory
       ${where}
       ORDER BY (status = 'invited') DESC, last_active_at DESC NULLS LAST, invited_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, Math.min(Math.max(Number(limit) || 50, 1), 200), Math.max(Number(offset) || 0, 0)],
    ),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0]?.total ?? 0 };
}

/**
 * Fetch one user plus their recent conversations and audit rows.
 *
 * @param {string} endUser
 * @returns {Promise<object>}
 * @throws {ApiError} 404 when unknown
 */
export async function getUserDetail(endUser) {
  const userRes = await query(
    `SELECT * FROM ai_registry.v_admin_user_directory WHERE end_user = $1 LIMIT 1`,
    [endUser],
  );
  if (userRes.rowCount === 0) {
    throw new ApiError(404, "User not found.", { code: "not_found" });
  }

  const [auditRes, convoRes] = await Promise.all([
    query(
      `SELECT id, created_at, model_requested, model_used, total_tokens, response_cost_usd,
              latency_ms, status_code, guardrail_pii_triggered, guardrail_security_triggered,
              guardrail_security_flagged, error_message
         FROM ai_registry.audit_log
        WHERE end_user = $1
        ORDER BY created_at DESC
        LIMIT 100`,
      [endUser],
    ),
    query(
      `SELECT id, request_id, created_at, model, prompt_tokens, completion_tokens, status_code
         FROM ai_registry.conversations
        WHERE end_user = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [endUser],
    ),
  ]);

  return {
    user: userRes.rows[0],
    recentActivity: auditRes.rows,
    conversations: convoRes.rows,
  };
}

/**
 * Invite a person. They cannot use the console until they sign in with the
 * invited Google account.
 *
 * @param {{ email: string, role?: string, displayName?: string, department?: string, notes?: string }} input
 * @param {object} actor the acting admin
 * @param {{ ip?: string }} [context]
 * @returns {Promise<object>} the created user row
 */
export async function inviteUser(input, actor, { ip } = {}) {
  const email = String(input.email ?? "").trim().toLowerCase();
  const role = String(input.role ?? "dev").toLowerCase();

  if (!EMAIL_PATTERN.test(email)) {
    throw new ApiError(400, "A valid email address is required.", {
      code: "invalid_email",
    });
  }
  if (!ALL_ROLES.includes(role)) {
    throw new ApiError(400, `Role must be one of: ${ALL_ROLES.join(", ")}.`, {
      code: "invalid_role",
    });
  }

  const existing = await query(
    `SELECT end_user, status FROM ai_registry.users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email],
  );
  if (existing.rowCount > 0) {
    const row = existing.rows[0];
    if (row.status === "removed") {
      // Re-inviting a removed person reactivates the same row, preserving history.
      const revived = await query(
        `UPDATE ai_registry.users
            SET status = 'invited', role = $2, invited_by = $3, invited_at = NOW(),
                display_name = COALESCE(NULLIF($4,''), display_name),
                department = COALESCE(NULLIF($5,''), department),
                notes = COALESCE(NULLIF($6,''), notes),
                updated_at = NOW()
          WHERE end_user = $1
          RETURNING *`,
        [row.end_user, role, actor?.email ?? "admin", input.displayName ?? "", input.department ?? "", input.notes ?? ""],
      );
      await recordAdminAction({ actor, action: "user.reinvite", target: revived.rows[0], detail: { role }, ip });
      return revived.rows[0];
    }
    throw new ApiError(409, "A user with that email already exists.", {
      code: "user_exists",
    });
  }

  const created = await query(
    `INSERT INTO ai_registry.users
       (end_user, email, display_name, role, status, department, notes, invited_by)
     VALUES ($1, $2, $3, $4, 'invited', $5, $6, $7)
     RETURNING *`,
    [
      provisionalEndUserId(email),
      email,
      String(input.displayName ?? "").trim() || null,
      role,
      String(input.department ?? "").trim() || null,
      String(input.notes ?? "").trim() || null,
      actor?.email ?? "admin",
    ],
  );

  const row = created.rows[0];
  await recordAdminAction({ actor, action: "user.invite", target: row, detail: { role }, ip });
  return row;
}

/**
 * Change a user's role. The last remaining admin cannot be demoted, so the
 * console can never be locked out of its own administration.
 *
 * @param {string} endUser
 * @param {string} role
 * @param {object} actor
 * @param {{ ip?: string }} [context]
 * @returns {Promise<object>}
 */
export async function updateRole(endUser, role, actor, { ip } = {}) {
  const nextRole = String(role ?? "").toLowerCase();
  if (!ALL_ROLES.includes(nextRole)) {
    throw new ApiError(400, `Role must be one of: ${ALL_ROLES.join(", ")}.`, {
      code: "invalid_role",
    });
  }

  const current = await findOr404(endUser);
  if (current.role === nextRole) return current;

  if (current.role === "admin" && current.status !== "removed") {
    const admins = await countActiveAdmins();
    if (admins <= 1) {
      throw new ApiError(409, "The last administrator cannot be demoted.", {
        code: "last_admin",
        details: "Promote another administrator first.",
      });
    }
  }

  const res = await query(
    `UPDATE ai_registry.users SET role = $2, updated_at = NOW() WHERE end_user = $1 RETURNING *`,
    [endUser, nextRole],
  );
  const row = res.rows[0];
  await recordAdminAction({
    actor,
    action: "user.role_change",
    target: row,
    detail: { from: current.role, to: nextRole },
    ip,
  });
  return row;
}

/**
 * Update the status an admin may set (invited / suspended). Setting "active" or
 * "removed" has dedicated functions because both have side effects.
 *
 * @param {string} endUser
 * @param {string} status
 * @param {object} actor
 * @param {{ ip?: string }} [context]
 * @returns {Promise<object>}
 */
export async function updateStatus(endUser, status, actor, { ip } = {}) {
  const next = String(status ?? "").toLowerCase();
  if (!SETTABLE_STATUSES.has(next)) {
    throw new ApiError(400, "Status must be 'invited' or 'suspended'.", {
      code: "invalid_status",
    });
  }

  const current = await findOr404(endUser);

  if (next === "suspended" && current.role === "admin" && current.status !== "removed") {
    const admins = await countActiveAdmins();
    if (admins <= 1) {
      throw new ApiError(409, "The last administrator cannot be suspended.", {
        code: "last_admin",
        details: "Promote another administrator first.",
      });
    }
  }

  const res = await query(
    `UPDATE ai_registry.users SET status = $2, updated_at = NOW() WHERE end_user = $1 RETURNING *`,
    [endUser, next],
  );

  // A suspension must take effect immediately: drop every existing session.
  if (next === "suspended") {
    await destroyUserSessions(current.id);
  }

  const row = res.rows[0];
  await recordAdminAction({
    actor,
    action: next === "suspended" ? "user.suspend" : "user.reactivate",
    target: row,
    detail: { from: current.status, to: next },
    ip,
  });
  return row;
}

/**
 * Remove access. The row is kept (history and audit rows must survive) but the
 * person can no longer sign in, and every session is destroyed.
 *
 * @param {string} endUser
 * @param {object} actor
 * @param {{ ip?: string }} [context]
 * @returns {Promise<object>}
 */
export async function removeUser(endUser, actor, { ip } = {}) {
  const current = await findOr404(endUser);

  if (current.role === "admin") {
    const admins = await countActiveAdmins();
    if (admins <= 1) {
      throw new ApiError(409, "The last administrator cannot be removed.", {
        code: "last_admin",
        details: "Promote another administrator first.",
      });
    }
  }

  const res = await query(
    `UPDATE ai_registry.users
        SET status = 'removed', google_subject = NULL, updated_at = NOW()
      WHERE end_user = $1
      RETURNING *`,
    [endUser],
  );
  await destroyUserSessions(current.id);
  const row = res.rows[0];
  await recordAdminAction({ actor, action: "user.remove", target: row, ip });
  return row;
}

/**
 * Fetch a user or throw 404.
 * @param {string} endUser
 * @returns {Promise<object>}
 */
async function findOr404(endUser) {
  const res = await query(
    `SELECT id, end_user, email, role, status FROM ai_registry.users WHERE end_user = $1 LIMIT 1`,
    [endUser],
  );
  if (res.rowCount === 0) {
    throw new ApiError(404, "User not found.", { code: "not_found" });
  }
  return res.rows[0];
}

/**
 * The admin action log, newest first.
 *
 * @param {{ limit?: number, offset?: number }} [options]
 * @returns {Promise<{ data: object[], total: number }>}
 */
export async function listAdminActions({ limit = 100, offset = 0 } = {}) {
  const [countRes, dataRes] = await Promise.all([
    query(`SELECT COUNT(*)::INT AS total FROM ai_registry.admin_actions`),
    query(
      `SELECT id, created_at, actor_email, action, target_email, detail, ip_address
         FROM ai_registry.admin_actions
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2`,
      [Math.min(Math.max(Number(limit) || 100, 1), 500), Math.max(Number(offset) || 0, 0)],
    ),
  ]);
  return { data: dataRes.rows, total: countRes.rows[0]?.total ?? 0 };
}

/**
 * Rejected sign-in attempts, newest first.
 *
 * @param {{ limit?: number }} [options]
 * @returns {Promise<object[]>}
 */
export async function listAccessDenials({ limit = 50 } = {}) {
  const res = await query(
    `SELECT id, created_at, email, reason, ip_address
       FROM ai_registry.access_denials
      ORDER BY created_at DESC
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 50, 1), 200)],
  );
  return res.rows;
}

export default {
  listUsers,
  getUserDetail,
  inviteUser,
  updateRole,
  updateStatus,
  removeUser,
  listAdminActions,
  listAccessDenials,
};
