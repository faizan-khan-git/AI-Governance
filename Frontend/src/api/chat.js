import { request } from "./client.js";
import env from "../config/env.js";

/**
 * Send a chat request to the Backend. The Backend authenticates the caller
 * (RBAC), forwards to the LiteLLM gateway with the role's virtual key, and
 * returns a sanitized response.
 *
 * @param {object} params
 * @param {string} params.text prompt text
 * @param {string} [params.model]
 * @param {number} [params.temperature]
 * @param {string} [params.system] optional system prompt
 * @param {{ scheme: string, token: string }} [params.auth]
 * @returns {Promise<{ success: boolean, data: object }>}
 */
export function sendChat({ text, model, temperature, system, auth }) {
  const body = { text, model, temperature };
  if (system && system.trim()) {
    body.system = system;
  }
  return request(env.chatPath, { method: "POST", body, auth });
}

export default { sendChat };
