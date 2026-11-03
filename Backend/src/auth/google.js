import crypto from "node:crypto";

import config from "../config/index.js";
import logger from "../utils/logger.js";

/**
 * Google OpenID Connect sign-in.
 *
 * Uses the authorization-code flow with PKCE. No third-party dependency: the
 * token endpoint is called with the built-in fetch, and the ID token is verified
 * against Google's published JWKS with node:crypto.
 *
 * Google's job here is authentication only ("is this really this person?").
 * Authorisation is decided separately against ai_registry.users.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

/** Clock skew allowance when checking exp/iat (seconds). */
const CLOCK_SKEW_SECONDS = 120;
/** How long a JWKS response is reused before it is fetched again. */
const JWKS_TTL_MS = 60 * 60 * 1000;

let jwksCache = { keys: null, fetchedAt: 0 };

/**
 * @returns {boolean} true when the Google client credentials are configured
 */
export function isGoogleConfigured() {
  return Boolean(config.google.clientId && config.google.clientSecret);
}

/**
 * Base64url-decode a JWT segment into a Buffer.
 * @param {string} segment
 * @returns {Buffer}
 */
function base64UrlToBuffer(segment) {
  let str = String(segment).replace(/-/g, "+").replace(/_/g, "/");
  const remainder = str.length % 4;
  if (remainder) str += "=".repeat(4 - remainder);
  return Buffer.from(str, "base64");
}

/**
 * Fetch Google's signing keys, cached for a short while.
 * A cache is a performance optimisation only; a missing or stale entry simply
 * triggers a refetch rather than skipping verification.
 *
 * @param {boolean} [force] bypass the cache (used when a kid is unknown, i.e. after a key roll)
 * @returns {Promise<Array<object>>}
 */
async function getGoogleKeys(force = false) {
  const fresh = jwksCache.keys && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (fresh && !force) return jwksCache.keys;

  const res = await fetch(JWKS_URI, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Could not fetch Google signing keys (HTTP ${res.status}).`);
  }
  const body = await res.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  if (keys.length === 0) {
    throw new Error("Google returned no signing keys.");
  }
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

/**
 * Verify a Google ID token: signature (RS256 against Google's JWKS), issuer,
 * audience, expiry and the nonce we issued. Returns the verified claims.
 *
 * @param {string} idToken the raw ID token from the token endpoint
 * @param {{ nonce?: string }} [expected]
 * @returns {Promise<object>} verified claims
 * @throws {Error} when the token cannot be trusted
 */
export async function verifyGoogleIdToken(idToken, { nonce } = {}) {
  if (typeof idToken !== "string" || !idToken) {
    throw new Error("Missing ID token.");
  }

  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed ID token.");
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  let header;
  let claims;
  try {
    header = JSON.parse(base64UrlToBuffer(headerB64).toString("utf8"));
    claims = JSON.parse(base64UrlToBuffer(payloadB64).toString("utf8"));
  } catch {
    throw new Error("Malformed ID token.");
  }

  if (header?.alg !== "RS256") {
    throw new Error("Unsupported ID token algorithm.");
  }

  const keys = await getGoogleKeys();
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // A key may have rotated since the cache was filled.
    jwk = (await getGoogleKeys(true)).find((k) => k.kid === header.kid);
  }
  if (!jwk) {
    throw new Error("ID token was signed with an unknown key.");
  }

  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const valid = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${headerB64}.${payloadB64}`),
    publicKey,
    base64UrlToBuffer(signatureB64),
  );
  if (!valid) {
    throw new Error("Invalid ID token signature.");
  }

  if (!ISSUERS.has(claims.iss)) {
    throw new Error("ID token was issued by an unexpected issuer.");
  }
  if (claims.aud !== config.google.clientId) {
    throw new Error("ID token was issued for a different client.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || now >= claims.exp + CLOCK_SKEW_SECONDS) {
    throw new Error("ID token has expired.");
  }
  if (typeof claims.iat === "number" && claims.iat > now + CLOCK_SKEW_SECONDS) {
    throw new Error("ID token was issued in the future.");
  }

  if (nonce && claims.nonce !== nonce) {
    throw new Error("ID token does not match this sign-in attempt.");
  }
  if (!claims.sub) {
    throw new Error("ID token has no subject.");
  }
  if (claims.email && claims.email_verified === false) {
    throw new Error("Google account email is not verified.");
  }

  return claims;
}

/**
 * Build the Google authorization URL the browser is redirected to.
 *
 * @param {{ state: string, nonce: string, codeChallenge: string, redirectUri: string }} params
 * @returns {string}
 */
export function buildAuthUrl({ state, nonce, codeChallenge, redirectUri }) {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", config.google.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Always let the user choose the account, so a shared browser cannot silently
  // reuse someone else's Google session.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/**
 * Exchange an authorization code for tokens.
 *
 * @param {{ code: string, codeVerifier: string, redirectUri: string }} params
 * @returns {Promise<{ id_token: string, access_token?: string }>}
 */
export async function exchangeCode({ code, codeVerifier, redirectUri }) {
  const body = new URLSearchParams({
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload?.id_token) {
    const reason = payload?.error_description || payload?.error || `HTTP ${res.status}`;
    logger.warn("Google token exchange failed", { reason });
    throw new Error("Google sign-in could not be completed.");
  }
  return payload;
}

/**
 * PKCE helpers (RFC 7636, S256).
 * @returns {{ verifier: string, challenge: string }}
 */
export function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

/**
 * @returns {string} an unguessable value for `state` or `nonce`
 */
export function createRandomToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export default {
  isGoogleConfigured,
  buildAuthUrl,
  exchangeCode,
  verifyGoogleIdToken,
  createPkcePair,
  createRandomToken,
};
