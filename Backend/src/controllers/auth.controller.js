import config from "../config/index.js";
import logger from "../utils/logger.js";
import ApiError from "../utils/ApiError.js";
import {
  buildAuthUrl,
  createPkcePair,
  createRandomToken,
  exchangeCode,
  isGoogleConfigured,
  verifyGoogleIdToken,
} from "../auth/google.js";
import {
  authoriseSignIn,
  createSession,
  destroySession,
  recordDenial,
  resolveSession,
} from "../services/identity.service.js";
import { SESSION_COOKIE, readCookie } from "../middlewares/authenticate.js";

/**
 * Browser sign-in endpoints (Google OpenID Connect).
 *
 * Access is invite-only: a verified Google identity is checked against
 * ai_registry.users, which an administrator controls.
 */

/** Transient cookie holding the CSRF state, nonce and PKCE verifier. */
const OAUTH_COOKIE = "aigov_oauth";
const isProduction = () => config.env === "production";

/**
 * Short-lived, signed-value cookie for the OAuth handshake.
 * @param {import('express').Response} res
 * @param {object} payload
 */
function setOauthCookie(res, payload) {
  const value = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const parts = [
    `${OAUTH_COOKIE}=${value}`,
    "Path=/auth",
    "HttpOnly",
    `Max-Age=${config.identity.oauthStateTtlSeconds}`,
    isProduction() ? "SameSite=None" : "SameSite=Lax",
  ];
  if (isProduction()) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

/**
 * Clear the handshake cookie.
 * @param {import('express').Response} res
 */
function clearOauthCookie(res) {
  const parts = [
    `${OAUTH_COOKIE}=`,
    "Path=/auth",
    "HttpOnly",
    "Max-Age=0",
    isProduction() ? "SameSite=None" : "SameSite=Lax",
  ];
  if (isProduction()) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

/**
 * Read and parse the handshake cookie.
 * @param {import('express').Request} req
 * @returns {object|null}
 */
function readOauthCookie(req) {
  const raw = readCookie(req, OAUTH_COOKIE);
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Set the session cookie. HttpOnly so page scripts cannot read it; the
 * frontend learns who it is from GET /auth/me instead.
 *
 * @param {import('express').Response} res
 * @param {string} token
 * @param {Date} expiresAt
 */
function setSessionCookie(res, token, expiresAt) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    `Expires=${expiresAt.toUTCString()}`,
    isProduction() ? "SameSite=None" : "SameSite=Lax",
  ];
  if (isProduction()) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

/**
 * Clear the session cookie.
 * @param {import('express').Response} res
 */
function clearSessionCookie(res) {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Max-Age=0",
    isProduction() ? "SameSite=None" : "SameSite=Lax",
  ];
  if (isProduction()) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

/** Public shape of a user, safe to send to the browser. */
const publicUser = (u) => ({
  endUser: u.end_user,
  email: u.email,
  displayName: u.display_name || u.email,
  role: u.role,
  status: u.status,
  department: u.department ?? null,
  lastSignInAt: u.last_sign_in_at ?? null,
});

/**
 * GET /auth/google — begin sign-in.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function beginGoogleSignIn(_req, res) {
  if (!isGoogleConfigured()) {
    return res.status(503).json({
      success: false,
      error: {
        code: "google_not_configured",
        message: "Company sign-in is not configured on this deployment.",
      },
    });
  }

  const state = createRandomToken();
  const nonce = createRandomToken();
  const { verifier, challenge } = createPkcePair();

  setOauthCookie(res, { state, nonce, verifier });

  const url = buildAuthUrl({
    state,
    nonce,
    codeChallenge: challenge,
    redirectUri: config.google.redirectUri,
  });
  return res.redirect(url);
}

/**
 * GET /auth/google/callback — finish sign-in.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function googleCallback(req, res, next) {
  const appUrl = config.google.appUrl;
  const fail = async (reason, status = 403) => {
    clearOauthCookie(res);
    await recordDenial({
      email: req.query.email,
      reason,
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });
    return res.redirect(`${appUrl}/?auth=denied&reason=${encodeURIComponent(reason)}`);
  };

  try {
    if (!isGoogleConfigured()) {
      return fail("google_not_configured", 503);
    }
    if (req.query.error) {
      return fail(String(req.query.error));
    }

    const handshake = readOauthCookie(req);
    if (!handshake) {
      return fail("state_missing");
    }
    if (!req.query.state || req.query.state !== handshake.state) {
      return fail("state_mismatch");
    }
    if (!req.query.code) {
      return fail("code_missing");
    }

    const tokens = await exchangeCode({
      code: String(req.query.code),
      codeVerifier: handshake.verifier,
      redirectUri: config.google.redirectUri,
    });

    const claims = await verifyGoogleIdToken(tokens.id_token, {
      nonce: handshake.nonce,
    });

    const outcome = await authoriseSignIn({
      subject: claims.sub,
      email: String(claims.email ?? "").toLowerCase(),
      name: claims.name,
    });

    if (!outcome.allowed) {
      clearOauthCookie(res);
      await recordDenial({
        email: claims.email,
        subject: claims.sub,
        reason: outcome.reason,
        userAgent: req.get("user-agent"),
        ip: req.ip,
      });
      logger.info("Sign-in denied", { reason: outcome.reason });
      return res.redirect(
        `${appUrl}/?auth=denied&reason=${encodeURIComponent(outcome.reason)}`,
      );
    }

    const { token, expiresAt } = await createSession(outcome.user, {
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });

    clearOauthCookie(res);
    setSessionCookie(res, token, expiresAt);
    logger.info("User signed in", { endUser: outcome.user.end_user, role: outcome.user.role });

    return res.redirect(`${appUrl}/?auth=ok`);
  } catch (error) {
    logger.warn("Sign-in failed", { message: error.message });
    clearOauthCookie(res);
    await recordDenial({
      reason: "verification_failed",
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });
    return res.redirect(`${appUrl}/?auth=error`);
  }
}

/**
 * POST /auth/signout — end the session.
 *
 * CSRF is not a concern here (signing out is not a state change an attacker
 * gains from), but the cookie is required so only the real session is destroyed.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function signOut(req, res) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) {
    try {
      await destroySession(token);
    } catch (error) {
      logger.warn("Could not destroy session", { message: error.message });
    }
  }
  clearSessionCookie(res);
  return res.status(200).json({ success: true });
}

/**
 * GET /auth/me — who am I?
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function me(req, res, next) {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) {
      return res.status(200).json({ success: true, data: { authenticated: false } });
    }

    const user = await resolveSession(token);
    if (!user) {
      return res.status(200).json({ success: true, data: { authenticated: false } });
    }

    return res.status(200).json({
      success: true,
      data: { authenticated: true, user: publicUser(user) },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /auth/config — what sign-in methods does this deployment offer?
 * @param {import('express').Request} _req
 * @param {import('express').Response} res
 */
export function authConfig(_req, res) {
  res.status(200).json({
    success: true,
    data: {
      google: isGoogleConfigured(),
      signInUrl: "/auth/google",
    },
  });
}

export default { beginGoogleSignIn, googleCallback, signOut, me, authConfig };
