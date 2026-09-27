/**
 * Canonical RBAC roles recognized by the Backend.
 *
 * Each role maps 1:1 to a LiteLLM virtual key (configured via env). The key —
 * not the Backend — carries the model allowlist, rate limits, and monthly
 * budget that the gateway enforces. The Backend's only job is to authenticate
 * the caller and pick the correct key for their role.
 */
export const ROLES = Object.freeze({
  DEV: "dev",
  STANDARD: "standard",
  ADMIN: "admin",
});

/** @type {readonly string[]} */
export const ALL_ROLES = Object.freeze(Object.values(ROLES));

/**
 * @param {unknown} role
 * @returns {boolean} true if the value is a recognized role
 */
export function isValidRole(role) {
  return typeof role === "string" && ALL_ROLES.includes(role);
}

export default { ROLES, ALL_ROLES, isValidRole };
