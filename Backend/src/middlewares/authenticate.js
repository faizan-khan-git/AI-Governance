import config from "../config/index.js";
import ApiError from "../utils/ApiError.js";
import { verifyJwt } from "../auth/jwt.js";
import { isValidRole } from "../auth/roles.js";
import { resolveVirtualKey } from "../auth/virtualKeyResolver.js";
import { deriveEndUserId } from "../auth/endUser.js";
import { resolveSession } from "../services/identity.service.js";

/** Name of the httpOnly cookie that carries the sign-in session. */
export const SESSION_COOKIE = "aigov_session";

/**
 * Read a cookie value without adding a cookie-parser dependency.
 * @param {import('express').Request} req
 * @param {string} name
 * @returns {string}
 */
export function readCookie(req, name) {
  const header = req.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return "";
}

/**
 * Resolve a browser sign-in session into a caller identity.
 *
 * The session is checked against the database on every request, so suspending
 * or removing a user takes effect immediately rather than at token expiry.
 *
 * @param {import('express').Request} req
 * @returns {Promise<{ role: string, subject: string, endUserId: string, user: object }|null>}
 */
async function resolveFromSession(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;

  const user = await resolveSession(token);
  if (!user) {
    throw new ApiError(401, "Your session has expired. Please sign in again.", {
      code: "session_expired",
    });
  }

  return {
    role: user.role,
    subject: user.email,
    endUserId: user.end_user,
    user,
  };
}

/**
 * Resolve a service-account credential (JWT or static API key).
 *
 * Unchanged behaviour: this path exists for registered bots and scripts, not for
 * people. Browser access is only ever granted through a sign-in session.
 *
 * @param {import('express').Request} req
 * @returns {{ role: string, subject: string }|null}
 */
function resolveFromToken(req) {
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

  return null;
}

/**
 * Authentication middleware.
 *
 * Resolution order:
 *   1. Sign-in session cookie - the console. Access was granted by an admin.
 *   2. Bearer JWT / X-API-Key - a registered service account.
 *
 * On success attaches:
 *   req.auth = { role, subject, endUserId, virtualKey, user? }
 * `endUserId` is the pseudonymous id used for quota checks and audit attribution.
 *
 * Fails closed: every request must present a valid session or service credential.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 */
export default async function authenticate(req, _res, next) {
  try {
    let caller = await resolveFromSession(req);

    if (!caller) {
      const tokenCaller = resolveFromToken(req);
      if (tokenCaller) {
        caller = {
          ...tokenCaller,
          endUserId: deriveEndUserId(tokenCaller.subject, config.rbac.endUserKey),
        };
      }
    }

    if (!caller) {
      throw new ApiError(401, "Authentication required. Please sign in.", {
        code: "unauthenticated",
        details:
          "Open the console and sign in with your company account, or provide an " +
          "'Authorization: Bearer <token>' / 'X-API-Key' header for a registered service account.",
      });
    }

    const virtualKey = resolveVirtualKey(caller.role);
    req.auth = { ...caller, virtualKey };
    return next();
  } catch (error) {
    return next(error);
  }
}
