/**
 * Centralized, read-only view of the Vite environment. Nothing that touches the
 * API is hardcoded elsewhere — every consumer imports from here.
 */
const raw = import.meta.env;

const trimTrailingSlash = (value) => String(value ?? "").replace(/\/+$/, "");

const toFloat = (value, fallback) => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toPositiveInt = (value, fallback) => {
  const parsed = toInt(value, fallback);
  return parsed > 0 ? parsed : fallback;
};

export const env = {
  apiBaseUrl: trimTrailingSlash(raw.VITE_API_BASE_URL),
  chatPath: raw.VITE_CHAT_PATH || "/api/chat",
  // Readiness endpoint: the Backend is up AND can reach the AI gateway.
  readyPath: raw.VITE_READY_PATH || "/health/ready",
  defaultModel: raw.VITE_DEFAULT_MODEL || "gemini-flash",
  models: String(raw.VITE_MODELS || "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),
  defaultTemperature: toFloat(raw.VITE_DEFAULT_TEMPERATURE, 0.7),
  requestTimeoutMs: toInt(raw.VITE_REQUEST_TIMEOUT_MS, 60000),
  // How much of the conversation is sent with each request. Keep these at or below
  // the Backend's MAX_HISTORY_MESSAGES / MAX_HISTORY_CHARS.
  historyMaxMessages: toPositiveInt(raw.VITE_HISTORY_MAX_MESSAGES, 12),
  historyMaxChars: toPositiveInt(raw.VITE_HISTORY_MAX_CHARS, 24000),
};

export default env;
