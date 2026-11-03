import { query } from "../config/db.js";
import config from "../config/index.js";
import logger from "../utils/logger.js";
import { recordAdminAction } from "./identity.service.js";

/**
 * Conversation transcripts (prompt and reply text).
 *
 * Written by the Backend *after* the response has been sent, so a storage
 * failure can never cost a user their answer. The gateway and its callbacks
 * never see this data, which keeps the existing audit pipeline untouched.
 *
 * Access is admin-only, every read is recorded in the admin action log, and
 * rows older than TRANSCRIPT_RETENTION_DAYS are deleted automatically.
 */

/**
 * Persist one exchange.
 *
 * @param {object} entry
 * @param {string} entry.requestId correlates the row with ai_registry.audit_log
 * @param {string} entry.endUser pseudonymous caller id
 * @param {string} entry.model
 * @param {string} [entry.systemPrompt]
 * @param {string} entry.promptText
 * @param {string} [entry.responseText]
 * @param {number} [entry.historyCount]
 * @param {object} [entry.usage] upstream token usage
 * @param {number} [entry.statusCode]
 * @param {string} [entry.errorCode]
 * @param {number} [entry.latencyMs]
 * @returns {Promise<void>} never rejects
 */
export async function saveTranscript(entry) {
  if (!config.identity.storeTranscripts || !entry?.promptText) return;

  try {
    await query(
      `INSERT INTO ai_registry.conversations
         (request_id, end_user, model, system_prompt, prompt_text, response_text,
          history_count, prompt_tokens, completion_tokens, status_code, error_code, latency_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        entry.requestId ?? null,
        entry.endUser ?? null,
        entry.model ?? null,
        entry.systemPrompt ?? null,
        entry.promptText,
        entry.responseText ?? null,
        entry.historyCount ?? 0,
        entry.usage?.prompt_tokens ?? null,
        entry.usage?.completion_tokens ?? null,
        entry.statusCode ?? 200,
        entry.errorCode ?? null,
        entry.latencyMs ?? null,
      ],
    );
  } catch (err) {
    // Transcript storage is best-effort by design; the user already has the answer.
    logger.warn("Could not store conversation transcript", { message: err.message });
  }
}

/**
 * List transcripts, optionally filtered to one user and/or one request.
 *
 * @param {{ endUser?: string, requestId?: string, limit?: number, offset?: number }} [filters]
 * @returns {Promise<{ data: object[], total: number }>}
 */
export async function listTranscripts({ endUser, requestId, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];

  if (endUser) {
    params.push(endUser);
    conditions.push(`c.end_user = $${params.length}`);
  }
  if (requestId) {
    params.push(requestId);
    conditions.push(`c.request_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [countRes, dataRes] = await Promise.all([
    query(`SELECT COUNT(*)::INT AS total FROM ai_registry.conversations c ${where}`, params),
    query(
      `SELECT c.id, c.request_id, c.end_user, c.created_at, c.model, c.prompt_text,
              c.response_text, c.status_code, c.error_code, c.prompt_tokens,
              c.completion_tokens, c.latency_ms,
              COALESCE(u.display_name, u.email) AS user_display_name, u.email AS user_email
         FROM ai_registry.conversations c
         LEFT JOIN ai_registry.users u ON u.end_user = c.end_user
         ${where}
         ORDER BY c.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, Math.min(Math.max(Number(limit) || 50, 1), 200), Math.max(Number(offset) || 0, 0)],
    ),
  ]);

  return { data: dataRes.rows, total: countRes.rows[0]?.total ?? 0 };
}

/**
 * Read one transcript, recording that an administrator opened it.
 *
 * @param {number} id
 * @param {object} actor the acting admin
 * @param {{ ip?: string }} [context]
 * @returns {Promise<object>}
 */
export async function getTranscript(id, actor, { ip } = {}) {
  const res = await query(
    `SELECT c.*, COALESCE(u.display_name, u.email) AS user_display_name, u.email AS user_email
       FROM ai_registry.conversations c
       LEFT JOIN ai_registry.users u ON u.end_user = c.end_user
      WHERE c.id = $1
      LIMIT 1`,
    [id],
  );
  if (res.rowCount === 0) return null;

  const row = res.rows[0];
  await recordAdminAction({
    actor,
    action: "transcript.view",
    target: { end_user: row.end_user, email: row.user_email },
    detail: { conversationId: row.id, requestId: row.request_id },
    ip,
  });
  return row;
}

/**
 * Delete transcripts past the retention window.
 * @returns {Promise<number>} rows deleted
 */
export async function purgeExpiredTranscripts() {
  const days = config.identity.transcriptRetentionDays;
  if (!Number.isFinite(days) || days <= 0) return 0;

  const res = await query(
    `DELETE FROM ai_registry.conversations
      WHERE created_at < NOW() - ($1 || ' days')::INTERVAL`,
    [String(days)],
  );
  if (res.rowCount > 0) {
    logger.info("Purged expired conversation transcripts", { rows: res.rowCount, days });
  }
  return res.rowCount ?? 0;
}

/**
 * Delete expired sessions (housekeeping).
 * @returns {Promise<number>}
 */
export async function purgeExpiredSessions() {
  const res = await query(`DELETE FROM ai_registry.sessions WHERE expires_at < NOW()`);
  return res.rowCount ?? 0;
}

export default {
  saveTranscript,
  listTranscripts,
  getTranscript,
  purgeExpiredTranscripts,
  purgeExpiredSessions,
};
