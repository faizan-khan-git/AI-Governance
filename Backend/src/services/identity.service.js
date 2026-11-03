import crypto from "node:crypto";

import { query } from "../config/db.js";
import config from "../config/index.js";
import logger from "../utils/logger.js";
import { deriveEndUserId } from "../auth/endUser.js";

/**
 * The access list. A person may use the console only if an administrator has
 * created a row for them here.
 *
 * Authentication (Google) answers "who is this?"; this module answers "may they
 * use it, and with which role?". Nothing else grants access — not the email
 * domain, not a self-service sign-up, not a token minted from the CLI.
 */

/** Session tokens are stored only as a hash, so a leaked table cannot be replayed. */
const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

/**
 * The pseudonymous id used in audit rows and sent to the gateway.
 * Derived from the immutable Google subject, so it survives an email change.
 *
 * @param {string} googleSubject
 * @returns {string}
 */
export function endUserIdForSubject(googleSubject) {
  return deriveEndUserId(`google:${googleSubject}`, config.rbac.endUserKey);
}

/**
 * Look up a user by Google subject (preferred) or, before first sign-in, by email.
 *
 * @param {{ googleSubject?: string, email?: string }} identity
 * @returns {Promise<object|null>} the users row
 */
export async function findUser({ googleSubject, email }) {
  if (googleSubject) {
    const bySubject = await query(
      `SELECT * FROM ai_registry.users WHERE google_subject = $1 LIMIT 1`,
      [googleSubject],
    );
    if (bySubject.rowCount > 0) return bySubject.rows[0];
  }
  if (email) {
    const byEmail = await query(
      `SELECT * FROM ai_registry.users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email],
    );
    if (byEmail.rowCount > 0) return byEmail.rows[0];
  }
  return null;
}

/**
 * Decide whether a verified Google identity may use the console.
 *
 * - No row                      -> denied (not invited)
 * - Row with another subject    -> denied (invite already claimed by someone else)
 * - status suspended / removed  -> denied
 * - invited                     -> activated, subject bound, counted as a sign-in
 * - active                      -> sign-in recorded
 *
 * @param {{ subject: string, email: string, name?: string }} identity verified claims
 * @returns {Promise<{ allowed: boolean, reason?: string, user?: object }>}
 */
export async function authoriseSignIn({ subject, email, name }) {
  if (!subject || !email) {
    return { allowed: false, reason: "missing_identity" };
  }

  const user = await findUser({ googleSubject: subject, email });
  if (!user) {
    return { allowed: false, reason: "not_invited" };
  }

  // The invite is bound to one Google account. A second account using the same
  // email address must not be able to take it over.
  if (user.google_subject && user.google_subject !== subject) {
    logger.warn("Sign-in rejected: invite already bound to another account", {
      endUser: user.end_user,
    });
    return { allowed: false, reason: "identity_mismatch" };
  }

  if (user.status === "suspended" || user.status === "removed") {
    return { allowed: false, reason: `account_${user.status}` };
  }

  const wasInvited = !user.google_subject || user.status === "invited";

  const updated = await query(
    `UPDATE ai_registry.users
        SET google_subject  = COALESCE(google_subject, $2),
            status          = 'active',
            display_name    = COALESCE(NULLIF($3, ''), display_name),
            first_seen_at   = COALESCE(first_seen_at, NOW()),
            last_sign_in_at = NOW(),
            last_active_at  = NOW(),
            sign_in_count   = sign_in_count + 1,
            updated_at      = NOW()
      WHERE id = $1
      RETURNING *`,
    [user.id, subject, name ?? ""],
  );

  const row = updated.rows[0];

  // Keep the audit key stable: if the row was created before its subject was
  // known, adopt the subject-derived id now and carry any existing usage over.
  const canonical = endUserIdForSubject(subject);
  if (row.end_user !== canonical) {
    const taken = await query(
      `SELECT 1 FROM ai_registry.users WHERE end_user = $1`,
      [canonical],
    );
    if (taken.rowCount === 0) {
      try {
        await query(
          `UPDATE ai_registry.users SET end_user = $2, updated_at = NOW() WHERE id = $1`,
          [row.id, canonical],
        );
        row.end_user = canonical;
      } catch (err) {
        // Never fail a sign-in because of the cosmetic id remap.
        logger.warn("Could not adopt canonical end_user id", { message: err.message });
      }
    }
  }

  if (wasInvited) {
    logger.info("Invited user activated on first sign-in", { endUser: row.end_user, role: row.role });
  }

  return { allowed: true, user: row };
}

/**
 * Create a session for an authorised user.
 *
 * @param {object} user users row
 * @param {{ userAgent?: string, ip?: string }} [context]
 * @returns {Promise<{ token: string, expiresAt: Date }>}
 */
export async function createSession(user, { userAgent, ip } = {}) {
  const token = crypto.randomBytes(32).toString("base64url");
  const ttlMs = config.identity.sessionTtlHours * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  await query(
    `INSERT INTO ai_registry.sessions (token_hash, user_id, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashToken(token), user.id, String(userAgent ?? "").slice(0, 400), String(ip ?? "").slice(0, 60), expiresAt],
  );

  return { token, expiresAt };
}

/**
 * Resolve a session token to its user, refreshing the activity timestamps.
 * Returns null when the session is unknown, expired, or the account is no
 * longer active — so a suspension takes effect on the very next request.
 *
 * @param {string} token
 * @returns {Promise<object|null>}
 */
export async function resolveSession(token) {
  if (!token) return null;

  const res = await query(
    `SELECT s.id AS session_id, s.expires_at, u.*
       FROM ai_registry.sessions s
       JOIN ai_registry.users u ON u.id = s.user_id
      WHERE s.token_hash = $1
      LIMIT 1`,
    [hashToken(token)],
  );
  if (res.rowCount === 0) return null;

  const row = res.rows[0];
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await query(`DELETE FROM ai_registry.sessions WHERE id = $1`, [row.session_id]);
    return null;
  }
  if (row.status !== "active") return null;

  // Throttle the activity write: at most once a minute per session.
  await query(
    `UPDATE ai_registry.sessions
        SET last_seen_at = NOW()
      WHERE id = $1
        AND last_seen_at < NOW() - INTERVAL '1 minute'`,
    [row.session_id],
  );
  await query(
    `UPDATE ai_registry.users
        SET last_active_at = NOW()
      WHERE id = $1
        AND (last_active_at IS NULL OR last_active_at < NOW() - INTERVAL '1 minute')`,
    [row.id],
  );

  return row;
}

/**
 * Delete one session (sign-out).
 * @param {string} token
 */
export async function destroySession(token) {
  if (!token) return;
  await query(`DELETE FROM ai_registry.sessions WHERE token_hash = $1`, [hashToken(token)]);
}

/**
 * Delete every session for a user (used when suspending or removing them).
 * @param {string} userId users.id
 */
export async function destroyUserSessions(userId) {
  await query(`DELETE FROM ai_registry.sessions WHERE user_id = $1`, [userId]);
}

/**
 * Record a rejected sign-in attempt so admins can see who tried to get in.
 *
 * @param {{ email?: string, subject?: string, reason: string, userAgent?: string, ip?: string }} attempt
 */
export async function recordDenial({ email, subject, reason, userAgent, ip }) {
  try {
    await query(
      `INSERT INTO ai_registry.access_denials (email, google_subject, reason, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        String(email ?? "").slice(0, 255) || null,
        String(subject ?? "").slice(0, 255) || null,
        reason,
        String(userAgent ?? "").slice(0, 400),
        String(ip ?? "").slice(0, 60),
      ],
    );
  } catch (err) {
    logger.warn("Could not record access denial", { message: err.message });
  }
}

/**
 * Append to the admin action log. Admin visibility is itself accountable: every
 * change, and every transcript an admin opens, is recorded here.
 *
 * @param {object} action
 * @param {object} action.actor the acting admin (users row)
 * @param {string} action.action short verb, e.g. "user.invite"
 * @param {object} [action.target] the affected user (users row)
 * @param {object} [action.detail] extra JSON context
 * @param {string} [action.ip]
 */
export async function recordAdminAction({ actor, action, target, detail = {}, ip }) {
  try {
    await query(
      `INSERT INTO ai_registry.admin_actions
         (actor_end_user, actor_email, action, target_end_user, target_email, detail, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        actor?.end_user ?? null,
        actor?.email ?? null,
        action,
        target?.end_user ?? null,
        target?.email ?? null,
        JSON.stringify(detail),
        String(ip ?? "").slice(0, 60),
      ],
    );
  } catch (err) {
    logger.warn("Could not record admin action", { message: err.message });
  }
}

/**
 * Count users holding the admin role and still able to sign in.
 * @returns {Promise<number>}
 */
export async function countActiveAdmins() {
  const res = await query(
    `SELECT COUNT(*)::INT AS n FROM ai_registry.users
      WHERE role = 'admin' AND status IN ('invited','active')`,
  );
  return res.rows[0]?.n ?? 0;
}

export default {
  endUserIdForSubject,
  findUser,
  authoriseSignIn,
  createSession,
  resolveSession,
  destroySession,
  destroyUserSessions,
  recordDenial,
  recordAdminAction,
  countActiveAdmins,
};
