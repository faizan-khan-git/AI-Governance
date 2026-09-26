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
  if (!config.litellm.proxyToken) {
    errors.push(
      "LITELLM_PROXY_TOKEN is required (the internal LiteLLM proxy/virtual key).",
    );
  }
  return errors;
}

export default config;
