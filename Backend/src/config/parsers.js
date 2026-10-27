/**
 * Pure helpers that turn raw environment strings into typed configuration values.
 *
 * They deliberately avoid dotenv and `process.env` so they can be unit-tested in
 * isolation and reused by the validation layer.
 */

/**
 * @param {string|undefined} value
 * @param {number} fallback
 * @returns {number} the parsed integer, or `fallback` when it is not a number
 */
export const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * @param {string|undefined} value
 * @param {number} fallback
 * @returns {number} the parsed integer when it is greater than zero, otherwise `fallback`
 */
export const toPositiveInt = (value, fallback) => {
  const parsed = toInt(value, fallback);
  return parsed > 0 ? parsed : fallback;
};

/**
 * @param {string|undefined} value
 * @param {number} fallback
 * @returns {number} the parsed float, or `fallback` when it is not a number
 */
export const toFloat = (value, fallback) => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** @param {unknown} value */
export const toBool = (value) =>
  /^(1|true|yes|on)$/i.test(String(value ?? "").trim());

/**
 * Split a comma-separated string into trimmed, non-empty items.
 * @param {string|undefined} raw
 * @returns {string[]}
 */
export const parseList = (raw) =>
  String(raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const TRUST_PROXY_KEYWORDS = new Set(["loopback", "linklocal", "uniquelocal"]);
const IP_OR_CIDR = /^[0-9a-f:.]+(\/\d{1,3})?$/i;

/**
 * Parse Express' `trust proxy` setting from TRUST_PROXY.
 *
 *  - unset / false / 0          → false (never trust X-Forwarded-For — the safe default)
 *  - 1, 2, ...                  → number of trusted reverse proxies in front of the app
 *  - loopback | linklocal | uniquelocal | IP / CIDR list → passed through to Express
 *  - true                       → rejected: it trusts every hop, so any client can spoof
 *                                 its IP address and sidestep per-IP rate limiting
 *
 * @param {string|undefined} raw
 * @returns {{ value: boolean|number|string, valid: boolean }}
 */
export function parseTrustProxy(raw) {
  const text = String(raw ?? "").trim();
  if (!text || /^(false|no|off|0)$/i.test(text)) {
    return { value: false, valid: true };
  }
  if (/^\d+$/.test(text)) {
    return { value: Number.parseInt(text, 10), valid: true };
  }
  if (/^(true|yes|on)$/i.test(text)) {
    return { value: false, valid: false };
  }
  const parts = parseList(text);
  const valid =
    parts.length > 0 &&
    parts.every((part) => TRUST_PROXY_KEYWORDS.has(part) || IP_OR_CIDR.test(part));
  return valid
    ? { value: parts.join(", "), valid: true }
    : { value: false, valid: false };
}

/**
 * Parse the RBAC_API_KEYS env var: a JSON object mapping API key -> role.
 * @param {string|undefined} raw
 * @returns {{ map: Record<string,string>, ok: boolean }}
 */
export function parseApiKeyMap(raw) {
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
}
