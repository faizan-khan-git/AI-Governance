import logger from "../utils/logger.js";

/**
 * Identity, access-control and conversation-transcript schema.
 *
 * These tables are additive: nothing in this file alters or drops an existing
 * object, so the governance pipeline (gateway -> audit_log) keeps working
 * unchanged. Access is invite-only — a row here IS the authorisation.
 */

const IDENTITY_SQL = `
CREATE SCHEMA IF NOT EXISTS ai_registry;

-- ── Users: the admin-owned access list ───────────────────────────────────────
-- A person may use the console only if an admin created a row for them. Google
-- proves identity; this table decides authorisation and the role.
CREATE TABLE IF NOT EXISTS ai_registry.users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Pseudonymous id derived from the Google subject; the key audit rows use.
  end_user          VARCHAR(100) NOT NULL UNIQUE,
  -- Google's immutable account id ("sub"). Bound on first sign-in, never by email.
  google_subject    VARCHAR(255) UNIQUE,
  email             VARCHAR(255) NOT NULL,
  display_name      VARCHAR(255),
  role              VARCHAR(20)  NOT NULL DEFAULT 'dev',
  -- invited | active | suspended | removed
  status            VARCHAR(20)  NOT NULL DEFAULT 'invited',
  department        VARCHAR(255),
  notes             TEXT,
  invited_by        VARCHAR(255),
  invited_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_seen_at     TIMESTAMPTZ,
  last_sign_in_at   TIMESTAMPTZ,
  last_active_at    TIMESTAMPTZ,
  sign_in_count     INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_role_chk   CHECK (role   IN ('dev','standard','admin')),
  CONSTRAINT users_status_chk CHECK (status IN ('invited','active','suspended','removed'))
);

-- Emails are matched case-insensitively, so uniqueness must be too.
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_lower
  ON ai_registry.users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_status ON ai_registry.users (status);
CREATE INDEX IF NOT EXISTS idx_users_role   ON ai_registry.users (role);

-- ── Sessions: server-side, revocable ────────────────────────────────────────
-- Only a SHA-256 of the cookie token is stored, so a database read cannot mint
-- a usable session. Deleting a row logs that session out everywhere.
CREATE TABLE IF NOT EXISTS ai_registry.sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash     CHAR(64) NOT NULL UNIQUE,
  user_id        UUID NOT NULL REFERENCES ai_registry.users(id) ON DELETE CASCADE,
  user_agent     VARCHAR(400),
  ip_address     VARCHAR(60),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON ai_registry.sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON ai_registry.sessions (expires_at);

-- ── Admin action log: who changed what, and who looked at what ──────────────
CREATE TABLE IF NOT EXISTS ai_registry.admin_actions (
  id             BIGSERIAL PRIMARY KEY,
  actor_end_user VARCHAR(100),
  actor_email    VARCHAR(255),
  action         VARCHAR(60) NOT NULL,
  target_end_user VARCHAR(100),
  target_email   VARCHAR(255),
  detail         JSONB DEFAULT '{}'::jsonb,
  ip_address     VARCHAR(60),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_created ON ai_registry.admin_actions (created_at);
CREATE INDEX IF NOT EXISTS idx_admin_actions_actor   ON ai_registry.admin_actions (actor_end_user);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target  ON ai_registry.admin_actions (target_end_user);

-- ── Conversations: the prompt/reply transcript ──────────────────────────────
-- Written by the Backend AFTER the reply is returned, so a failed write can
-- never cost the user an answer. Joined to audit_log by request_id.
CREATE TABLE IF NOT EXISTS ai_registry.conversations (
  id                 BIGSERIAL PRIMARY KEY,
  request_id         VARCHAR(100),
  end_user           VARCHAR(100),
  model              VARCHAR(100),
  system_prompt      TEXT,
  prompt_text        TEXT,
  response_text      TEXT,
  history_count      INTEGER NOT NULL DEFAULT 0,
  prompt_tokens      INTEGER,
  completion_tokens  INTEGER,
  status_code        INTEGER NOT NULL DEFAULT 200,
  error_code         VARCHAR(60),
  latency_ms         INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_created  ON ai_registry.conversations (created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_end_user ON ai_registry.conversations (end_user, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_request  ON ai_registry.conversations (request_id);

-- ── Access denials: every rejected sign-in attempt ──────────────────────────
-- Lets an admin see who tried to get in without an invitation.
CREATE TABLE IF NOT EXISTS ai_registry.access_denials (
  id           BIGSERIAL PRIMARY KEY,
  email        VARCHAR(255),
  google_subject VARCHAR(255),
  reason       VARCHAR(60),
  user_agent   VARCHAR(400),
  ip_address   VARCHAR(60),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_denials_created ON ai_registry.access_denials (created_at);

-- ── Admin directory view ────────────────────────────────────────────────────
-- One row per user with their real-world identity plus governance usage.
CREATE OR REPLACE VIEW ai_registry.v_admin_user_directory AS
SELECT
  u.end_user,
  u.email,
  COALESCE(u.display_name, u.email) AS display_name,
  u.role,
  u.status,
  u.department,
  u.notes,
  u.invited_by,
  u.invited_at,
  u.first_seen_at,
  u.last_sign_in_at,
  u.last_active_at,
  u.sign_in_count,
  COALESCE(a.requests, 0)          AS total_requests,
  COALESCE(a.tokens, 0)            AS total_tokens,
  COALESCE(a.cost_usd, 0)::NUMERIC(12,4) AS total_cost_usd,
  COALESCE(a.blocked, 0)           AS security_blocks,
  COALESCE(a.flagged, 0)           AS security_flags,
  COALESCE(a.pii, 0)               AS pii_events,
  a.last_request_at
FROM ai_registry.users u
LEFT JOIN (
  SELECT
    end_user,
    COUNT(*)                                   AS requests,
    SUM(total_tokens)                          AS tokens,
    SUM(response_cost_usd)                     AS cost_usd,
    COUNT(*) FILTER (WHERE guardrail_security_triggered) AS blocked,
    COUNT(*) FILTER (WHERE guardrail_security_flagged)   AS flagged,
    COUNT(*) FILTER (WHERE guardrail_pii_triggered)      AS pii,
    MAX(created_at)                            AS last_request_at
  FROM ai_registry.audit_log
  WHERE end_user IS NOT NULL
  GROUP BY end_user
) a ON a.end_user = u.end_user;
`;

/**
 * Create the identity tables if they do not exist yet.
 * Safe to run on every boot: every statement is IF NOT EXISTS / OR REPLACE.
 *
 * @param {import('pg').Pool} pool
 */
export async function runIdentityMigrations(pool) {
  if (!pool) return;
  await pool.query(IDENTITY_SQL);
}

/**
 * Seed the bootstrap administrators. Only runs when explicitly asked for, so a
 * fresh database stays empty until the operator provisions the first admins.
 *
 * @param {import('pg').Pool} pool
 * @param {string[]} adminEmails emails that should hold the admin role
 */
export async function seedBootstrapAdmins(pool, adminEmails) {
  if (!pool || !adminEmails?.length) return [];
  const created = [];
  for (const email of adminEmails) {
    const res = await pool.query(
      `INSERT INTO ai_registry.users (end_user, email, display_name, role, status, invited_by, notes)
       VALUES ($1, $2, $3, 'admin', 'invited', 'bootstrap', 'Bootstrap administrator')
       ON CONFLICT DO NOTHING
       RETURNING email`,
      // end_user is derived by the caller (it needs the HMAC key); a placeholder
      // email-based id is replaced on first successful sign-in.
      [email.end_user, email.address, email.address],
    );
    if (res.rowCount > 0) created.push(email.address);
  }
  if (created.length) {
    logger.info("Bootstrap administrators created", { count: created.length });
  }
  return created;
}

export default { runIdentityMigrations, seedBootstrapAdmins };
