import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectConfig } from "./validate.js";
import {
  parseApiKeyMap,
  parseList,
  parseTrustProxy,
  toFloat,
  toInt,
  toPositiveInt,
} from "./parsers.js";

dotenv.config();

// Also pick up per-role keys from tokens/.env.tokens (never overrides real env vars).
const tokensFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../tokens/.env.tokens",
);
if (existsSync(tokensFile)) {
  dotenv.config({ path: tokensFile });
}

/**
 * Centralized, validated application configuration.
 * Fails fast at startup if a required value is missing.
 */

/**
 * Front-end origins allowed when CORS_ORIGIN is not set: the Vite dev server.
 * Never "*" — a wildcard must be requested explicitly.
 */
const DEFAULT_CORS_ORIGINS = Object.freeze([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const roleTokens = {
  dev: process.env.LITELLM_DEV_TOKEN ?? "",
  standard: process.env.LITELLM_STANDARD_TOKEN ?? "",
  admin: process.env.LITELLM_ADMIN_TOKEN ?? "",
};

const apiKeyMap = parseApiKeyMap(process.env.RBAC_API_KEYS);
const corsOrigins = parseList(process.env.CORS_ORIGIN);
const jwtSecret =
  process.env.AUTH_JWT_SECRET ?? process.env.LITELLM_JWT_SECRET ?? "";

const config = {
  env: process.env.NODE_ENV ?? "development",
  // Bind to loopback by default; containers / clusters opt in with HOST=0.0.0.0.
  host: process.env.HOST?.trim() || "127.0.0.1",
  port: toInt(process.env.PORT, 8080),
  // Number of trusted reverse proxies in front of the app (false = trust none).
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY).value,

  litellm: {
    // Internal Kubernetes ClusterIP service for the LiteLLM proxy.
    baseUrl: (
      process.env.LITELLM_BASE_URL ??
      "http://litellm-internal.litellm.svc.cluster.local:4000"
    ).replace(/\/+$/, ""),
    // Internal JWT / virtual-key proxy token injected into the Authorization header.
    proxyToken: process.env.LITELLM_PROXY_TOKEN ?? "",
    chatCompletionsPath: "/v1/chat/completions",
    readinessPath: "/health/readiness",
    requestTimeoutMs: toInt(process.env.REQUEST_TIMEOUT_MS, 60000),
  },

  defaults: {
    model: process.env.DEFAULT_MODEL ?? "gemini-flash",
    temperature: toFloat(process.env.DEFAULT_TEMPERATURE, 0.7),
  },

  // Request-size guards enforced by the chat validator.
  limits: {
    maxTextLength: toPositiveInt(process.env.MAX_TEXT_LENGTH, 32000),
    maxSystemLength: toPositiveInt(process.env.MAX_SYSTEM_LENGTH, 8000),
    maxHistoryMessages: toPositiveInt(process.env.MAX_HISTORY_MESSAGES, 40),
    maxHistoryChars: toPositiveInt(process.env.MAX_HISTORY_CHARS, 64000),
  },

  // Optional: the AI Registry system (name or id) this Backend represents. When set it
  // is sent as request metadata so usage is attributed to that system, never guessed.
  aiSystem: (process.env.AI_SYSTEM ?? "").trim(),

  // ── RBAC: per-request role → LiteLLM virtual key ───────────────────────────
  // Each caller is authenticated and mapped to a role; the matching virtual key
  // is forwarded upstream so the gateway enforces that role's policy. RBAC is
  // always enforced — there is no unauthenticated mode.
  rbac: {
    enabled: true,
    jwtSecret,
    // Key for the pseudonymous end-user ids sent to the gateway (see auth/endUser.js).
    endUserKey: process.env.AUTH_END_USER_KEY?.trim() || jwtSecret,
    roleTokens,
    apiKeys: apiKeyMap.map,
  },

  cors: {
    origins: corsOrigins.length > 0 ? corsOrigins : [...DEFAULT_CORS_ORIGINS],
  },

  rateLimit: {
    windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 60000),
    max: toInt(process.env.RATE_LIMIT_MAX, 60),
  },
};

/**
 * Validate configuration before the server boots.
 * @returns {string[]} human-readable validation errors (empty if valid)
 */
export function validateConfig() {
  return inspectConfig(config, process.env).errors;
}

/**
 * Non-fatal configuration problems (e.g. weak example API keys or a wildcard
 * CORS origin outside production). They are logged at startup but do not stop it.
 * @returns {string[]}
 */
export function getConfigWarnings() {
  return inspectConfig(config, process.env).warnings;
}

export default config;
