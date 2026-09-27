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

export const env = {
  apiBaseUrl: trimTrailingSlash(raw.VITE_API_BASE_URL),
  chatPath: raw.VITE_CHAT_PATH || "/api/chat",
  healthPath: raw.VITE_HEALTH_PATH || "/health",
  defaultModel: raw.VITE_DEFAULT_MODEL || "gemini-flash",
  models: String(raw.VITE_MODELS || "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),
  defaultTemperature: toFloat(raw.VITE_DEFAULT_TEMPERATURE, 0.7),
  requestTimeoutMs: toInt(raw.VITE_REQUEST_TIMEOUT_MS, 60000),
};

export default env;
