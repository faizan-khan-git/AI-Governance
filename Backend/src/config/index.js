import dotenv from "dotenv";

dotenv.config();

/**
 * Centralized, validated application configuration.
 * Fails fast at startup if a required value is missing.
 */

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toFloat = (value, fallback) => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value) => /^(1|true|yes|on)$/i.test(String(value ?? "").trim());

/**
 * Parse the RBAC_API_KEYS env var: a JSON object mapping API key -> role.
 * @param {string|undefined} raw
 * @returns {{ map: Record<string,string>, ok: boolean }}
 */
const parseApiKeyMap = (raw) => {
  if (!raw || !raw.trim()) {
    return { map: {}, ok: true };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { map: {}, ok: false };
    }
    const map = {};
    for (const [key, role] of Object.entries(parsed)) {
      if (typeof key === "string" && typeof role === "string") {
        map[key] = role;
      }
    }
    return { map, ok: true };
  } catch {
    return { map: {}, ok: false };
  }
};

const roleTokens = {
  dev: process.env.LITELLM_DEV_TOKEN ?? "",
  standard: process.env.LITELLM_STANDARD_TOKEN ?? "",
  admin: process.env.LITELLM_ADMIN_TOKEN ?? "",
};

const apiKeyMap = parseApiKeyMap(process.env.RBAC_API_KEYS);
const anyRoleToken = Object.values(roleTokens).some(Boolean);

const config = {
  env: process.env.NODE_ENV ?? "development",
  port: toInt(process.env.PORT, 8080),

  litellm: {
    // Internal Kubernetes ClusterIP service for the LiteLLM proxy.
    baseUrl: (
      process.env.LITELLM_BASE_URL ??
      "http://litellm-internal.litellm.svc.cluster.local:4000"
    ).replace(/\/+$/, ""),
    // Internal JWT / virtual-key proxy token injected into the Authorization header.
    proxyToken: process.env.LITELLM_PROXY_TOKEN ?? "",
    chatCompletionsPath: "/v1/chat/completions",
    requestTimeoutMs: toInt(process.env.REQUEST_TIMEOUT_MS, 60000),
  },

  defaults: {
    model: process.env.DEFAULT_MODEL ?? "gemini-flash",
    temperature: toFloat(process.env.DEFAULT_TEMPERATURE, 0.7),
  },

  // ── RBAC: per-request role → LiteLLM virtual key ───────────────────────────
  // Each caller is authenticated and mapped to a role; the matching virtual key
  // is forwarded upstream so the gateway enforces that role's policy. Enabled
  // automatically when any role token is present, unless RBAC_ENABLED overrides.
  rbac: {
    enabled:
      process.env.RBAC_ENABLED != null
        ? toBool(process.env.RBAC_ENABLED)
        : anyRoleToken,
    jwtSecret:
      process.env.AUTH_JWT_SECRET ?? process.env.LITELLM_JWT_SECRET ?? "",
    roleTokens,
    apiKeys: apiKeyMap.map,
  },

  cors: {
    origin: (process.env.CORS_ORIGIN ?? "*")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  },

  rateLimit: {
    windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 60000),
    max: toInt(process.env.RATE_LIMIT_MAX, 60),
  },
};

/**
 * Validate that mandatory configuration is present before the server boots.
 * @returns {string[]} list of human-readable validation errors (empty if valid)
 */
export function validateConfig() {
  const errors = [];
  if (!config.litellm.baseUrl) {
    errors.push("LITELLM_BASE_URL is required.");
  }

  if (config.rbac.enabled) {
    if (!anyRoleToken) {
      errors.push(
        "RBAC is enabled but no role tokens are set. Provide at least one of " +
          "LITELLM_DEV_TOKEN / LITELLM_STANDARD_TOKEN / LITELLM_ADMIN_TOKEN " +
          "(e.g. `source tokens/.env.tokens`).",
      );
    }
    const hasJwt = Boolean(config.rbac.jwtSecret);
    const hasApiKeys = Object.keys(config.rbac.apiKeys).length > 0;
    if (!hasJwt && !hasApiKeys) {
      errors.push(
        "RBAC is enabled but no auth method is configured. Set AUTH_JWT_SECRET " +
          "(JWT) and/or RBAC_API_KEYS (API-key → role JSON map).",
      );
    }
    if (!apiKeyMap.ok) {
      errors.push('RBAC_API_KEYS must be a JSON object of {"apiKey":"role"}.');
    }
  } else if (!config.litellm.proxyToken) {
    errors.push(
      "LITELLM_PROXY_TOKEN is required (the internal LiteLLM proxy/virtual key), " +
        "or enable RBAC by providing per-role tokens.",
    );
  }

  return errors;
}

export default config;
