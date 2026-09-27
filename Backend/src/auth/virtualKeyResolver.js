import config from "../config/index.js";
import { isValidRole } from "./roles.js";
import ApiError from "../utils/ApiError.js";

/**
 * Resolve the LiteLLM virtual key for a given role.
 *
 * The returned key is the credential forwarded upstream; it encodes the model
 * allowlist, rate limits, and budget the gateway enforces for that role.
 *
 * @param {string} role a recognized RBAC role
 * @returns {string} the LiteLLM virtual key (Bearer token) for this role
 * @throws {ApiError} 403 when the role is unknown or has no provisioned key
 */
export function resolveVirtualKey(role) {
  if (!isValidRole(role)) {
    throw new ApiError(403, "Your role is not permitted to use this service.", {
      code: "role_forbidden",
    });
  }

  const token = config.rbac.roleTokens[role];
  if (!token) {
    throw new ApiError(
      403,
      `No gateway credential is provisioned for role '${role}'.`,
      { code: "role_not_provisioned" },
    );
  }

  return token;
}

export default { resolveVirtualKey };
