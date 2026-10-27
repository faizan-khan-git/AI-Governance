import crypto from "node:crypto";

/**
 * Minimal, dependency-free HS256 (HMAC-SHA256) JWT implementation.
 *
 * Kept intentionally small and free of third-party libraries so the Backend
 * has no extra supply-chain surface. Supports exactly what this service needs:
 * sign + verify with signature, `exp`, and `nbf` checks.
 */

function base64urlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecodeToString(input) {
  let str = String(input).replace(/-/g, "+").replace(/_/g, "/");
  const remainder = str.length % 4;
  if (remainder) {
    str += "=".repeat(4 - remainder);
  }
  return Buffer.from(str, "base64").toString("utf8");
}

function signSegments(headerB64, payloadB64, secret) {
  return base64urlEncode(
    crypto
      .createHmac("sha256", secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest(),
  );
}

/**
 * Sign a payload as an HS256 JWT. Tokens always expire: a token that never
 * expires cannot be revoked short of rotating the signing secret.
 *
 * @param {object} payload claims to embed (e.g. { role, sub })
 * @param {string} secret HMAC secret
 * @param {object} options
 * @param {number} options.expiresInSeconds lifetime in seconds (positive integer); sets `exp`
 * @returns {string} the encoded JWT
 * @throws {Error} when the secret or a positive integer lifetime is missing
 */
export function signJwt(payload, secret, { expiresInSeconds } = {}) {
  if (!secret) {
    throw new Error("A JWT secret is required to sign a token.");
  }
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new Error(
      "expiresInSeconds (a positive integer) is required: tokens must expire.",
    );
  }
  const header = { alg: "HS256", typ: "JWT" };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims = { iat: nowSeconds, ...payload };
  claims.exp = nowSeconds + expiresInSeconds;
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(claims));
  const signature = signSegments(headerB64, payloadB64, secret);
  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Verify an HS256 JWT and return its decoded claims.
 *
 * @param {string} token the encoded JWT
 * @param {string} secret HMAC secret used at signing time
 * @returns {object} the decoded claims
 * @throws {Error} on a malformed token, bad signature, missing `exp`, or expiry/nbf failure
 */
export function verifyJwt(token, secret) {
  if (!secret) {
    throw new Error("JWT verification secret is not configured.");
  }
  if (typeof token !== "string" || !token) {
    throw new Error("Malformed token.");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed token.");
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  let header;
  try {
    header = JSON.parse(base64urlDecodeToString(headerB64));
  } catch {
    throw new Error("Malformed token header.");
  }
  if (!header || header.alg !== "HS256" || header.typ !== "JWT") {
    throw new Error("Unsupported token algorithm.");
  }

  const expected = signSegments(headerB64, payloadB64, secret);
  const provided = Buffer.from(signatureB64);
  const computed = Buffer.from(expected);
  if (
    provided.length !== computed.length ||
    !crypto.timingSafeEqual(provided, computed)
  ) {
    throw new Error("Invalid token signature.");
  }

  let claims;
  try {
    claims = JSON.parse(base64urlDecodeToString(payloadB64));
  } catch {
    throw new Error("Malformed token payload.");
  }
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
    throw new Error("Malformed token payload.");
  }

  // `exp` is mandatory: a token without an expiry would be valid forever.
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) {
    throw new Error("Token has no expiry.");
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds >= claims.exp) {
    throw new Error("Token has expired.");
  }
  if (typeof claims.nbf === "number" && nowSeconds < claims.nbf) {
    throw new Error("Token is not yet valid.");
  }

  return claims;
}

export default { signJwt, verifyJwt };
