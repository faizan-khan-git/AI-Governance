/**
 * End-to-end verification of the identity layer against a real database.
 *
 * Covers: bootstrap admins, invite-only enforcement, session lifecycle,
 * immediate suspension, the last-admin guard, transcripts and the admin log.
 *
 * Run: node --test test/identity.e2e.test.js  (needs DATABASE_URL)
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV ||= "test";
process.env.SEED_DEMO_DATA = "false";

/**
 * These tests need a real database. Modules are imported lazily so a plain
 * `npm test` (no database configured) skips them instead of failing on connect.
 */
const ready = Boolean(process.env.DATABASE_URL);
let db, pool, identity, users, transcripts, runIdentityMigrations, seedBootstrapAdmins;

/** Truncate the identity tables so each run starts clean. */
async function reset() {
  await pool.query(
    "TRUNCATE ai_registry.sessions, ai_registry.admin_actions, ai_registry.conversations, ai_registry.access_denials, ai_registry.users RESTART IDENTITY CASCADE",
  );
}

test("identity layer", async (t) => {
  if (!ready) {
    t.skip("DATABASE_URL not set - identity integration tests need a database");
    return;
  }

  ({ default: db } = await import("../src/config/db.js"));
  ({ runIdentityMigrations, seedBootstrapAdmins } = await import("../src/config/migrateIdentity.js"));
  identity = await import("../src/services/identity.service.js");
  users = await import("../src/services/users.service.js");
  transcripts = await import("../src/services/transcript.service.js");
  pool = db.pool;
  await runIdentityMigrations(pool);
  await reset();

  const ADMIN = "admin@example.com";
  const STAFF = "staff@example.com";

  await t.test("bootstrap admins become known users", async () => {
    await seedBootstrapAdmins(pool, [
      { address: ADMIN, end_user: identity.endUserIdForSubject(`invite:${ADMIN}`) },
    ]);
    const admin = await identity.findUser({ email: ADMIN });
    assert.ok(admin, "admin row exists");
    assert.equal(admin.role, "admin");
    assert.equal(admin.status, "invited");
  });

  await t.test("an uninvited person is denied even with a valid Google account", async () => {
    const outcome = await identity.authoriseSignIn({
      subject: "google-sub-outsider",
      email: "outsider@gmail.com",
      name: "Outsider",
    });
    assert.equal(outcome.allowed, false);
    assert.equal(outcome.reason, "not_invited");
  });

  await t.test("an invited person becomes active and binds their Google subject", async () => {
    const admin = await identity.findUser({ email: ADMIN });
    const invited = await users.inviteUser(
      { email: STAFF, role: "dev", displayName: "Staff Member" },
      admin,
      { ip: "127.0.0.1" },
    );
    assert.equal(invited.status, "invited");

    const outcome = await identity.authoriseSignIn({
      subject: "google-sub-staff",
      email: STAFF,
      name: "Staff Member",
    });
    assert.equal(outcome.allowed, true);
    assert.equal(outcome.user.status, "active");
    assert.equal(outcome.user.google_subject, "google-sub-staff");
    // The audit key is derived from the immutable subject.
    assert.equal(outcome.user.end_user, identity.endUserIdForSubject("google-sub-staff"));
    assert.equal(outcome.user.sign_in_count, 1);
  });

  await t.test("a second Google account cannot claim an already-bound invite", async () => {
    const outcome = await identity.authoriseSignIn({
      subject: "google-sub-attacker",
      email: STAFF,
    });
    assert.equal(outcome.allowed, false);
    assert.equal(outcome.reason, "identity_mismatch");
  });

  await t.test("session resolves to the user and can be destroyed", async () => {
    const user = await identity.findUser({ googleSubject: "google-sub-staff" });
    const { token, expiresAt } = await identity.createSession(user, { userAgent: "test" });
    assert.ok(expiresAt > new Date());

    const resolved = await identity.resolveSession(token);
    assert.equal(resolved.email, STAFF);
    assert.equal(resolved.role, "dev");

    await identity.destroySession(token);
    assert.equal(await identity.resolveSession(token), null, "destroyed session no longer resolves");
  });

  await t.test("suspension cuts access off immediately", async () => {
    const user = await identity.findUser({ googleSubject: "google-sub-staff" });
    const { token } = await identity.createSession(user, {});
    assert.ok(await identity.resolveSession(token), "session valid before suspension");

    const admin = await identity.findUser({ email: ADMIN });
    await users.updateStatus(user.end_user, "suspended", admin, {});

    assert.equal(await identity.resolveSession(token), null, "existing session rejected after suspension");
    const outcome = await identity.authoriseSignIn({ subject: "google-sub-staff", email: STAFF });
    assert.equal(outcome.allowed, false);
    assert.equal(outcome.reason, "account_suspended");
  });

  await t.test("the last administrator cannot be demoted, suspended or removed", async () => {
    const admin = await identity.findUser({ email: ADMIN });
    const actor = { email: ADMIN, end_user: admin.end_user };

    await assert.rejects(() => users.updateRole(admin.end_user, "dev", actor, {}), /last administrator/i);
    await assert.rejects(() => users.updateStatus(admin.end_user, "suspended", actor, {}), /last administrator/i);
    await assert.rejects(() => users.removeUser(admin.end_user, actor, {}), /last administrator/i);
  });

  await t.test("promoting a second admin lets the first be demoted", async () => {
    const admin = await identity.findUser({ email: ADMIN });
    const staff = await identity.findUser({ googleSubject: "google-sub-staff" });
    await users.updateStatus(staff.end_user, "invited", admin, {});
    await users.updateRole(staff.end_user, "admin", admin, {});

    const demoted = await users.updateRole(admin.end_user, "dev", { email: ADMIN }, {});
    assert.equal(demoted.role, "dev");
  });

  await t.test("transcripts are stored and every read is logged", async () => {
    await transcripts.saveTranscript({
      requestId: "req-e2e-1",
      endUser: "u_test_user",
      model: "gemini-flash",
      systemPrompt: "be brief",
      promptText: "What is Kubernetes?",
      responseText: "A container orchestrator.",
      historyCount: 0,
      usage: { prompt_tokens: 4, completion_tokens: 6 },
      statusCode: 200,
      latencyMs: 120,
    });

    const list = await transcripts.listTranscripts({ endUser: "u_test_user" });
    assert.equal(list.total, 1);
    assert.equal(list.data[0].prompt_text, "What is Kubernetes?");

    const before = await users.listAdminActions({ limit: 100 });
    const row = await transcripts.getTranscript(list.data[0].id, { email: ADMIN, end_user: "u_admin" }, {});
    assert.equal(row.response_text, "A container orchestrator.");

    const after = await users.listAdminActions({ limit: 100 });
    assert.equal(after.total, before.total + 1);
    assert.equal(after.data[0].action, "transcript.view", "opening a transcript is recorded");
  });

  await t.test("an admin can delete a single conversation", async () => {
    await pool.query("TRUNCATE ai_registry.conversations RESTART IDENTITY");
    await transcripts.saveTranscript({
      requestId: "req-del-1",
      endUser: "u_del",
      model: "gemini-flash",
      promptText: "prompt to delete",
      responseText: "reply",
      statusCode: 200,
    });
    const list = await transcripts.listTranscripts({ endUser: "u_del" });
    assert.equal(list.total, 1);

    const result = await transcripts.deleteTranscript(list.data[0].id, { email: ADMIN }, {});
    assert.equal(result.deleted, true);
    assert.equal((await transcripts.listTranscripts({ endUser: "u_del" })).total, 0);

    // Deleting the same row again reports "not found" rather than throwing.
    const again = await transcripts.deleteTranscript(list.data[0].id, { email: ADMIN }, {});
    assert.equal(again.deleted, false);
  });

  await t.test("bulk delete can be scoped to one user", async () => {
    await pool.query("TRUNCATE ai_registry.conversations RESTART IDENTITY");
    await transcripts.saveTranscript({ requestId: "a1", endUser: "u_x", promptText: "x1" });
    await transcripts.saveTranscript({ requestId: "a2", endUser: "u_x", promptText: "x2" });
    await transcripts.saveTranscript({ requestId: "b1", endUser: "u_y", promptText: "y1" });

    const removed = await transcripts.deleteTranscripts({ endUser: "u_x" }, { email: ADMIN }, {});
    assert.equal(removed, 2);
    assert.equal((await transcripts.listTranscripts({ endUser: "u_x" })).total, 0);
    assert.equal((await transcripts.listTranscripts({ endUser: "u_y" })).total, 1, "other users untouched");

    const all = await transcripts.deleteTranscripts({}, { email: ADMIN }, {});
    assert.equal(all, 1);
    assert.equal((await transcripts.listTranscripts({})).total, 0);
  });

  await t.test("deleting a conversation keeps the audit metadata", async () => {
    await pool.query("TRUNCATE ai_registry.conversations RESTART IDENTITY");
    // A unique request id keeps the assertion independent of rows other tests left.
    const requestId = `req-keep-${Date.now()}`;
    await pool.query(
      `INSERT INTO ai_registry.audit_log (request_id, end_user, model_requested, total_tokens, status_code)
       VALUES ($1, 'u_keep', 'gemini-flash', 42, 200)`,
      [requestId],
    );
    await transcripts.saveTranscript({ requestId, endUser: "u_keep", promptText: "secret" });
    assert.equal((await transcripts.listTranscripts({ requestId })).total, 1);

    await transcripts.deleteTranscripts({}, { email: ADMIN }, {});

    const audit = await pool.query(
      `SELECT total_tokens FROM ai_registry.audit_log WHERE request_id = $1`,
      [requestId],
    );
    assert.equal(audit.rowCount, 1, "audit row survives a transcript delete");
    assert.equal(audit.rows[0].total_tokens, 42);
    assert.equal((await transcripts.listTranscripts({ requestId })).total, 0, "transcript removed");
  });

  await t.test("every deletion is recorded in the admin action log", async () => {
    const actions = await users.listAdminActions({ limit: 100 });
    const kinds = actions.data.map((a) => a.action);
    assert.ok(kinds.includes("transcript.delete"), "single delete logged");
    assert.ok(kinds.includes("transcript.delete_user"), "scoped bulk delete logged");
    assert.ok(kinds.includes("transcript.delete_all"), "full bulk delete logged");
  });

  await t.test("expired transcripts are purged by the retention sweep", async () => {
    await pool.query(
      `INSERT INTO ai_registry.conversations (end_user, prompt_text, created_at)
       VALUES ('u_old', 'old prompt', NOW() - INTERVAL '200 days')`,
    );
    const deleted = await transcripts.purgeExpiredTranscripts();
    assert.ok(deleted >= 1, "old transcript removed");
    const remaining = await transcripts.listTranscripts({ endUser: "u_old" });
    assert.equal(remaining.total, 0);
  });

  await t.test("admin actions and denials are visible", async () => {
    const actions = await users.listAdminActions({ limit: 50 });
    assert.ok(actions.total > 0);
    const kinds = actions.data.map((a) => a.action);
    assert.ok(kinds.includes("user.invite"), "invite recorded");
    assert.ok(kinds.includes("user.suspend"), "suspend recorded");
  });

  await pool.end();
});
