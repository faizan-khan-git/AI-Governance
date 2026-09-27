import env from "../config/env.js";

/**
 * Normalized client-side API error. Mirrors the Backend's error envelope
 * ({ error: { code, message, details } }) so the UI can react by code.
 */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Build the auth header for the configured scheme. The Backend accepts either
 * a Bearer JWT (role claim) or an X-API-Key mapped to a role.
 * @param {{ scheme: 'jwt'|'apikey', token: string }} [auth]
 */
function buildAuthHeaders(auth) {
  if (!auth?.token) return {};
  if (auth.scheme === "apikey") {
    return { "X-API-Key": auth.token };
  }
  return { Authorization: `Bearer ${auth.token}` };
}

/**
 * Low-level request helper: builds the URL from env, injects auth, enforces a
 * timeout, and normalizes both HTTP and network/timeout failures to ApiError.
 *
 * @param {string} path endpoint path (from env)
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {object} [options.body]
 * @param {{ scheme: string, token: string }} [options.auth]
 * @returns {Promise<any>} parsed JSON body
 */
export async function request(path, { method = "GET", body, auth } = {}) {
  const url = `${env.apiBaseUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.requestTimeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(auth),
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const err = data?.error ?? {};
      throw new ApiError(
        response.status,
        err.code ?? "http_error",
        err.message ?? `Request failed with status ${response.status}.`,
        err.details,
      );
    }

    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === "AbortError") {
      throw new ApiError(
        0,
        "timeout",
        "The request timed out. Please try again.",
      );
    }
    throw new ApiError(
      0,
      "network_error",
      "Cannot reach the backend. Make sure it is running and VITE_API_BASE_URL is correct.",
    );
  } finally {
    clearTimeout(timer);
  }
}

export default { request, ApiError };
