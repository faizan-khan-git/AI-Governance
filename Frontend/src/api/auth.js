import { ApiError, request } from "./client.js";
import env from "../config/env.js";

/**
 * Sign-in and identity endpoints.
 *
 * Authentication is a session cookie set by the Backend after Google sign-in,
 * so these calls carry no token: the browser includes the cookie automatically.
 */

/** Origin of the Backend, used to build the sign-in redirect URL. */
const backendOrigin = () => env.apiBaseUrl;

/**
 * Ask the Backend who the current session belongs to.
 * Never throws for an anonymous visitor: that is a normal state, not an error.
 *
 * @returns {Promise<{ authenticated: boolean, user?: object }>}
 */
export async function getSession() {
  try {
    const res = await request("/auth/me", { method: "GET" });
    return res?.data ?? { authenticated: false };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 0 || error.status >= 500)) {
      throw error;
    }
    return { authenticated: false };
  }
}

/**
 * Start sign-in by navigating to the Backend, which redirects to Google.
 * A full navigation (not fetch) is required: the OAuth handshake sets cookies
 * and Google must be able to show its own account chooser.
 */
export function startSignIn() {
  window.location.assign(`${backendOrigin()}/auth/google`);
}

/**
 * End the session and clear the cookie.
 * @returns {Promise<void>}
 */
export async function signOut() {
  await request("/auth/signout", { method: "POST" });
}

/**
 * Query which sign-in methods this deployment offers.
 * @returns {Promise<{ google: boolean, signInUrl: string }>}
 */
export async function getAuthConfig() {
  const res = await request("/auth/config", { method: "GET" });
  return res?.data ?? { google: false, signInUrl: "/auth/google" };
}

export default { getSession, startSignIn, signOut, getAuthConfig };
