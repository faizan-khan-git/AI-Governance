import crypto from "node:crypto";

/** Domain-separation prefix so this HMAC can never collide with other uses of the secret. */
const DOMAIN = "end-user-id:v1:";

/** Used only when no secret is configured (API-key-only mode, where subjects are not personal data). */
const FALLBACK_KEY = "ai-governance-end-user";

/**
 * Derive a stable, pseudonymous end-user identifier from the authenticated subject.
 *
 * The identifier is sent to the gateway (x-litellm-end-user-id) so spend and the
 * AI Registry audit log can be attributed per caller. A keyed hash is used instead
 * of the raw subject because a JWT `sub` is often an email address — personal data
 * that must not end up in provider requests or audit tables. Anyone holding the key
 * can still recompute the id for a known subject (see scripts/end-user-id.mjs).
 *
 * @param {string} subject the authenticated subject (JWT `sub`, or `apikey:<role>`)
 * @param {string} [key] HMAC key; defaults to a fixed application constant
 * @returns {string} `u_` followed by 24 hex characters
 */
export function deriveEndUserId(subject, key) {
  const digest = crypto
    .createHmac("sha256", key || FALLBACK_KEY)
    .update(`${DOMAIN}${String(subject ?? "")}`)
    .digest("hex");
  return `u_${digest.slice(0, 24)}`;
}

export default { deriveEndUserId };
