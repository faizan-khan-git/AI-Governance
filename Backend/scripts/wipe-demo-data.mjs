#!/usr/bin/env node
/**
 * wipe-demo-data.mjs — remove demonstration and test telemetry from a database.
 *
 * Intended for the one-off cut-over to real usage. It is deliberately NOT an API
 * endpoint: exposing destructive SQL over HTTP is unnecessary risk. Run it from
 * a shell on the deployed service (Render > Shell) or locally with DATABASE_URL:
 *
 *   node scripts/wipe-demo-data.mjs --dry-run     # show what would be removed
 *   node scripts/wipe-demo-data.mjs --confirm     # actually delete
 *
 * What it deletes:
 *   - every row in ai_registry.audit_log  (usage history; all of it is demo/test on a fresh deployment)
 *   - every row in ai_registry.conversations
 *   - seeded ai_registry.ai_systems
 *   - seeded ai_registry.token_quotas
 *
 * What it keeps:
 *   - ai_registry.users (the access list, including bootstrap admins)
 *   - ai_registry.admin_actions and ai_registry.access_denials (the audit trail of who did what)
 *
 * Take a backup first: the counts printed by --dry-run are your record.
 */
import { query } from "../src/config/db.js";
import logger from "../src/utils/logger.js";

const args = new Set(process.argv.slice(2));
const confirmed = args.has("--confirm");
const dryRun = args.has("--dry-run") || !confirmed;

const TABLES = [
  { name: "ai_registry.audit_log", label: "audit rows (usage history)" },
  { name: "ai_registry.conversations", label: "stored conversations" },
  { name: "ai_registry.ai_systems", label: "registered AI systems" },
  { name: "ai_registry.token_quotas", label: "user quotas" },
];

async function counts() {
  const out = {};
  for (const { name } of TABLES) {
    const res = await query(`SELECT COUNT(*)::INT AS n FROM ${name}`);
    out[name] = res.rows[0]?.n ?? 0;
  }
  const users = await query(`SELECT COUNT(*)::INT AS n FROM ai_registry.users`);
  out["ai_registry.users"] = users.rows[0]?.n ?? 0;
  return out;
}

async function main() {
  const before = await counts();

  logger.info(dryRun ? "Dry run — nothing will be deleted" : "Deleting demonstration data");
  for (const { name, label } of TABLES) {
    logger.info(`  ${name}: ${before[name]} ${label}`);
  }
  logger.info(`  ai_registry.users: ${before["ai_registry.users"]} (kept)`);

  if (dryRun) {
    logger.info("Re-run with --confirm to delete the rows listed above.");
    process.exit(0);
  }

  // One transaction: a partial wipe is worse than none.
  await query("BEGIN");
  try {
    await query("DELETE FROM ai_registry.conversations");
    await query("DELETE FROM ai_registry.audit_log");
    await query("DELETE FROM ai_registry.token_quotas");
    await query("DELETE FROM ai_registry.ai_systems");
    await query("COMMIT");
  } catch (error) {
    await query("ROLLBACK");
    throw error;
  }

  const after = await counts();
  logger.info("Wipe complete", {
    auditRowsRemoved: before["ai_registry.audit_log"] - after["ai_registry.audit_log"],
    systemsRemoved: before["ai_registry.ai_systems"] - after["ai_registry.ai_systems"],
    usersKept: after["ai_registry.users"],
  });
  process.exit(0);
}

main().catch((error) => {
  logger.error("Wipe failed", { message: error.message });
  process.exit(1);
});
