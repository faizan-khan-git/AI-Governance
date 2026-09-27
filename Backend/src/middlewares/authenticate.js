import config from "../config/index.js";
import ApiError from "../utils/ApiError.js";
import logger from "../utils/logger.js";
import { verifyJwt } from "../auth/jwt.js";
import { isValidRole } from "../auth/roles.js";
import { resolveVirtualKey } from "../auth/virtualKeyResolver.js";

/**
 * Determine the caller's role from the incoming credentials.
 *
 * Two mechanisms are supported (checked in this order):
 *   1. Authorization: Bearer <JWT>  — HS256, verified with the Backend's own
 *      AUTH_JWT_SECRET; the role is read from the `role` claim.
 *   2. X-API-Key: <key>             — a static key mapped to a role via config;
 *      useful for service-to-service callers.
 *
 * @param {import('express').Request} req
 * @returns {{ role: string, subject: string }}
 * @throws {ApiError} 401/403 when the caller cannot be authenticated
 */
function resolveCaller(req) {
  const authHeader = req.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (bearer) {
    if (!config.rbac.jwtSecret) {
      throw new ApiError(500, "JWT authentication is not configured.", {
        code: "auth_misconfigured",
      });
    }
    let claims;
    try {
      claims = verifyJwt(bearer, config.rbac.jwtSecret);
    } catch (error) {
      throw new ApiError(401, "Invalid or expired authentication token.", {
        code: "invalid_token",
        details: error.message,
      });
    }
    if (!isValidRole(claims.role)) {
      throw new ApiError(403, "Token does not carry a valid role claim.", {
        code: "invalid_role_claim",
      });
    }
    return { role: claims.role, subject: String(claims.sub ?? "unknown") };
  }

  const apiKey = (req.get("x-api-key") ?? "").trim();
  if (apiKey) {
    const role = config.rbac.apiKeys[apiKey];
    if (!role) {
      throw new ApiError(401, "Unrecognized API key.", {
        code: "invalid_api_key",
      });
    }
    return { role, subject: `apikey:${role}` };
  }

  throw new ApiError(401, "Authentication required.", {
    code: "unauthenticated",
    details:
      "Provide an 'Authorization: Bearer <token>' or 'X-API-Key' header.",
  });
}

/**
 * RBAC authentication middleware.
 *
 * On success it attaches `req.auth = { role, subject, virtualKey }`, where
 * `virtualKey` is the LiteLLM key the downstream service must forward.
 *
 * When RBAC is disabled (no role tokens configured) it falls back to the legacy
 * single-token behavior so existing deployments keep working unchanged.
 */
export default function authenticate(req, _res, next) {
  try {
    if (!config.rbac.enabled) {
      req.auth = {
        role: "default",
        subject: "legacy",
        virtualKey: config.litellm.proxyToken,
      };
      return next();
    }

    const { role, subject } = resolveCaller(req);
    const virtualKey = resolveVirtualKey(role);
    req.auth = { role, subject, virtualKey };
    logger.info("RBAC authenticated request", { role, subject });
    return next();
  } catch (error) {
    return next(error);
  }
}
