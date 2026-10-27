#!/usr/bin/env node
/**
 * end-user-id.mjs — print the pseudonymous end-user id the Backend sends to the
 * gateway for a given JWT subject (or API-key role).
 *
 * The Backend never forwards raw subjects (often email addresses) to the gateway,
 * the model provider or the audit log; it sends a keyed hash instead. Use this to
 * map an id seen in `ai_registry.audit_log.end_user` or the LiteLLM spend logs back
 * to a person.
 *
 * Usage:
 *   node scripts/end-user-id.mjs --sub alice@example.com
 *   node scripts/end-user-id.mjs --sub apikey:dev
 */
import config from "../src/config/index.js";
import { deriveEndUserId } from "../src/auth/endUser.js";

const flagIndex = process.argv.indexOf("--sub");
const subject = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;

if (!subject || subject.startsWith("--")) {
  process.stderr.write("Error: --sub <subject> is required.\n");
  process.exit(1);
}

process.stdout.write(`${deriveEndUserId(subject, config.rbac.endUserKey)}\n`);
