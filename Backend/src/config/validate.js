import { parseApiKeyMap, parseTrustProxy, toBool } from "./parsers.js";

const MIN_JWT_SECRET_LENGTH = 32;
const MIN_API_KEY_LENGTH = 32;

/** Values that look like documentation placeholders rather than real secrets. */
const PLACEHOLDER_PATTERN =
  /replace[-_ ]?with|change[-_ ]?me|your[-_ ]?(secret|key|token)|placeholder|example/i;

/** API keys that appear verbatim in the project documentation. */
const KNOWN_EXAMPLE_API_KEYS = new Set(["dev-abc123", "admin-xyz789"]);

/**
 * @param {unknown} value
 * @returns {boolean} true when the value looks like a copy-pasted placeholder
 */
export const isPlaceholderSecret = (value) =>
  PLACEHOLDER_PATTERN.test(String(value ?? ""));

/**
 * @param {string} key a static API key
 * @returns {boolean} true when it is short, a documented example, or a placeholder
 */
export const isWeakApiKey = (key) =>
  key.length < MIN_API_KEY_LENGTH ||
  KNOWN_EXAMPLE_API_KEYS.has(key) ||
  isPlaceholderSecret(key);

/**
 * Inspect a configuration object and report problems.
 *
 * Hard requirements are always errors. Hardening rules (weak API keys, wildcard
 * CORS) are errors in production but warnings elsewhere, so an existing local
 * development setup keeps running while still being told what to fix.
 *
 * @param {object} cfg the assembled configuration (see config/index.js)
 * @param {Record<string, string|undefined>} env the raw environment
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function inspectConfig(cfg, env = {}) {
  const errors = [];
  const warnings = [];
  const production = cfg.env === "production";
  const hardening = production ? errors : warnings;

  if (!cfg.litellm.baseUrl) {
    errors.push("LITELLM_BASE_URL is required.");
  }

  if (env.RBAC_ENABLED != null && !toBool(env.RBAC_ENABLED)) {
    errors.push(
      "RBAC_ENABLED=false is no longer supported; RBAC is always enforced. " +
        "Remove RBAC_ENABLED from the environment.",
    );
  }

  if (!Object.values(cfg.rbac.roleTokens).some(Boolean)) {
    errors.push(
      "No role tokens are set. Provide at least one of " +
        "LITELLM_DEV_TOKEN / LITELLM_STANDARD_TOKEN / LITELLM_ADMIN_TOKEN " +
        "(e.g. run tokens/generate-virtual-keys.sh to create tokens/.env.tokens).",
    );
  }

  const hasJwt = Boolean(cfg.rbac.jwtSecret);
  const apiKeys = Object.entries(cfg.rbac.apiKeys);
  if (!hasJwt && apiKeys.length === 0) {
    errors.push(
      "No auth method is configured. Set AUTH_JWT_SECRET " +
        "(JWT) and/or RBAC_API_KEYS (API-key → role JSON map).",
    );
  }
  if (!parseApiKeyMap(env.RBAC_API_KEYS).ok) {
    errors.push('RBAC_API_KEYS must be a JSON object of {"apiKey":"role"}.');
  }

  if (hasJwt) {
    if (cfg.rbac.jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
      errors.push(
        `AUTH_JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters.`,
      );
    }
    if (isPlaceholderSecret(cfg.rbac.jwtSecret)) {
      errors.push(
        "AUTH_JWT_SECRET looks like a documentation placeholder. " +
          "Generate a real one with: openssl rand -hex 32",
      );
    }
  }

  const weakRoles = [
    ...new Set(
      apiKeys.filter(([key]) => isWeakApiKey(key)).map(([, role]) => role),
    ),
  ];
  if (weakRoles.length > 0) {
    hardening.push(
      `RBAC_API_KEYS has weak or documented example keys for role(s): ${weakRoles.join(", ")}. ` +
        "Use random keys of at least 32 characters (openssl rand -hex 32).",
    );
  }

  if (cfg.cors.origins.includes("*")) {
    hardening.push(
      'CORS_ORIGIN="*" lets any website call this API from a browser. ' +
        "List the exact front-end origins instead.",
    );
  }

  if (!parseTrustProxy(env.TRUST_PROXY).valid) {
    errors.push(
      "TRUST_PROXY must be false, a hop count such as 1, or a list of trusted proxy " +
        'addresses/CIDRs. "true" is rejected because it lets clients spoof their IP ' +
        "address and bypass per-IP rate limiting.",
    );
  }

  return { errors, warnings };
}
